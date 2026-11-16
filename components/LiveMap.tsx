'use client';
// Full-screen MapLibre map: line shapes, stations and estimated train positions animated
// with requestAnimationFrame (capped at ~30 fps) from the latest snapshot.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FilterSpecification, GeoJSONSource, Map as MlMap, Popup } from 'maplibre-gl';
import type { Network, Snapshot, VehicleRun } from '@/lib/types';
import { createSmoother, positionAt, type RunPosition } from '@/lib/client/interpolate';
import { VehiclePopup } from './VehiclePopup';

const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const CENTER: [number, number] = [2.3488, 48.8534];
const FRAME_MS = 1000 / 30;
const LINE_WIDTH = { metro: 3.2, rer: 3.6, transilien: 3, tram: 2 } as const;

type FC = GeoJSON.FeatureCollection;
const featureCollection = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });

export interface LiveMapProps {
  network: Network;
  snapshot: Snapshot | null;
  hiddenLines: ReadonlySet<string>;
  onStationClick: (stationId: string) => void;
  onShownCountChange: (count: number) => void;
}

interface SelectedView { run: VehicleRun; position: RunPosition; now: number }

function shapesData(network: Network): FC {
  const features: GeoJSON.Feature[] = [];
  for (const line of Object.values(network.lines)) {
    for (const coords of line.shapes) {
      features.push({
        type: 'Feature',
        properties: { lineId: line.id, color: line.color, w: LINE_WIDTH[line.mode], sort: line.mode === 'tram' ? 0 : 1 },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }
  return featureCollection(features);
}

function stationsData(network: Network, hidden: ReadonlySet<string>): FC {
  return featureCollection(
    Object.values(network.stations)
      .filter((s) => s.lines.some((id) => network.lines[id] && !hidden.has(id)))
      .map((s) => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
  );
}

const lineFilter = (hidden: ReadonlySet<string>): FilterSpecification => ['!', ['in', ['get', 'lineId'], ['literal', [...hidden]]]];

export function LiveMap({ network, snapshot, hiddenLines, onStationClick, onShownCountChange }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const hiddenRef = useRef(hiddenLines);
  const positionsRef = useRef(new Map<string, RunPosition>());
  const selectedRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onStationClick, onShownCountChange });
  const popupRef = useRef<Popup | null>(null);
  const [mapLib, setMapLib] = useState<typeof import('maplibre-gl') | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const [selectedView, setSelectedView] = useState<SelectedView | null>(null);

  snapshotRef.current = snapshot;
  callbacksRef.current = { onStationClick, onShownCountChange };
  selectedRef.current = selectedId;

  // Map creation, layers and the animation loop.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;
    const media = window.matchMedia(DARK_QUERY);
    const smooth = createSmoother();

    const addLayers = (m: MlMap) => {
      if (m.getSource('lines')) return;
      const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      m.addSource('lines', { type: 'geojson', data: shapesData(network) });
      m.addSource('stations', { type: 'geojson', data: stationsData(network, hiddenRef.current) });
      m.addSource('vehicles', { type: 'geojson', data: featureCollection([]) });
      m.addLayer(
        {
          id: 'lines',
          type: 'line',
          source: 'lines',
          filter: lineFilter(hiddenRef.current),
          layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['get', 'sort'] },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, ['*', ['get', 'w'], 0.5], 12, ['get', 'w'], 16, ['*', ['get', 'w'], 2.2]],
          },
        },
        firstSymbol,
      );
      m.addLayer(
        {
          id: 'stations',
          type: 'circle',
          source: 'stations',
          minzoom: 12,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.5, 16, 6],
            'circle-color': media.matches ? '#1c2230' : '#ffffff',
            'circle-stroke-color': media.matches ? '#e6eaf0' : '#1f2633',
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 2],
          },
        },
        firstSymbol,
      );
      m.addLayer({
        id: 'station-labels',
        type: 'symbol',
        source: 'stations',
        minzoom: 14,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Regular'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: {
          'text-color': media.matches ? '#c9d0db' : '#3a4352',
          'text-halo-color': media.matches ? '#10141b' : '#ffffff',
          'text-halo-width': 1.4,
        },
      });
      m.addLayer({
        id: 'vehicle-halo',
        type: 'circle',
        source: 'vehicles',
        filter: ['==', ['get', 'id'], selectedRef.current ?? ''],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 18],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.25,
        },
      });
      m.addLayer({
        id: 'vehicles',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 12, 7, 15, 11],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': media.matches ? '#10141b' : '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
        },
      });
      m.addLayer({
        id: 'vehicle-labels',
        type: 'symbol',
        source: 'vehicles',
        minzoom: 11.5,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 7.5, 15, 11],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': ['get', 'textColor'] },
      });
      readyRef.current = true;
    };

    const draw = () => {
      if (!map || !readyRef.current) return;
      const source = map.getSource<GeoJSONSource>('vehicles');
      if (!source) return;
      const snap = snapshotRef.current;
      const now = Date.now();
      const hidden = hiddenRef.current;
      const positions = new Map<string, RunPosition>();
      const features: GeoJSON.Feature[] = [];
      for (const run of snap?.runs ?? []) {
        const line = network.lines[run.lineId];
        if (!line || hidden.has(run.lineId)) continue;
        const p = smooth(run.id, positionAt(run, network, now));
        if (!p) continue;
        positions.set(run.id, p);
        features.push({
          type: 'Feature',
          properties: { id: run.id, color: line.color, textColor: line.textColor, label: line.shortName },
          geometry: { type: 'Point', coordinates: p.coord },
        });
      }
      positionsRef.current = positions;
      void source.setData(featureCollection(features));
      const sel = selectedRef.current;
      if (sel && popupRef.current) {
        const p = positions.get(sel);
        if (p) popupRef.current.setLngLat(p.coord);
      }
    };

    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < FRAME_MS) return;
      last = t;
      draw();
    };

    void import('maplibre-gl').then((ml) => {
      if (cancelled || !containerRef.current) return;
      map = new ml.Map({
        container: containerRef.current,
        style: media.matches ? STYLE_DARK : STYLE_LIGHT,
        center: CENTER,
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;
      setMapLib(ml);
      map.addControl(new ml.AttributionControl({ compact: true, customAttribution: 'Données IDFM (PRIM)' }), 'bottom-right');
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      map.on('style.load', () => {
        readyRef.current = false;
        addLayers(map!);
      });

      map.on('click', (e) => {
        const m = map!;
        if (!readyRef.current) return;
        const box: [[number, number], [number, number]] = [
          [e.point.x - 6, e.point.y - 6],
          [e.point.x + 6, e.point.y + 6],
        ];
        const vehicle = m.queryRenderedFeatures(box, { layers: ['vehicles'] })[0];
        if (vehicle) {
          setSelectedId(String(vehicle.properties.id));
          return;
        }
        setSelectedId(null);
        const station = m.queryRenderedFeatures(box, { layers: ['stations'] })[0];
        if (station) callbacksRef.current.onStationClick(String(station.properties.id));
      });
      for (const layer of ['vehicles', 'stations']) {
        map.on('mouseenter', layer, () => (map!.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map!.getCanvas().style.cursor = ''));
      }
      raf = requestAnimationFrame(frame);
    });

    const onScheme = () => {
      readyRef.current = false;
      map?.setStyle(media.matches ? STYLE_DARK : STYLE_LIGHT, { diff: false });
    };
    media.addEventListener('change', onScheme);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      media.removeEventListener('change', onScheme);
      readyRef.current = false;
      map?.remove();
      mapRef.current = null;
    };
  }, [network]);

  // Line filter: hide shapes, stations and (in the loop) trains of hidden lines.
  useEffect(() => {
    hiddenRef.current = hiddenLines;
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setFilter('lines', lineFilter(hiddenLines));
    map.getSource<GeoJSONSource>('stations')?.setData(stationsData(network, hiddenLines));
  }, [hiddenLines, network]);

  // Popup that follows the selected train.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLib || !selectedId) return;
    const pos = positionsRef.current.get(selectedId);
    if (!pos) {
      setSelectedId(null);
      return;
    }
    if (readyRef.current) map.setFilter('vehicle-halo', ['==', ['get', 'id'], selectedId]);
    const node = document.createElement('div');
    const popup = new mapLib.Popup({ closeOnClick: false, offset: 14, maxWidth: '280px', focusAfterOpen: false })
      .setLngLat(pos.coord)
      .setDOMContent(node)
      .addTo(map);
    popup.on('close', () => setSelectedId((id) => (id === selectedId ? null : id)));
    popupRef.current = popup;
    setPopupNode(node);
    return () => {
      popupRef.current = null;
      popup.remove();
      setPopupNode(null);
      if (readyRef.current && mapRef.current) mapRef.current.setFilter('vehicle-halo', ['==', ['get', 'id'], '']);
    };
  }, [selectedId, mapLib]);

  // Popup text and the shown-trains counter refresh once per second (not per frame).
  useEffect(() => {
    const tick = () => {
      callbacksRef.current.onShownCountChange(positionsRef.current.size);
      const id = selectedRef.current;
      if (!id) {
        setSelectedView(null);
        return;
      }
      const run = snapshotRef.current?.runs.find((r) => r.id === id);
      const position = positionsRef.current.get(id);
      if (!run || !position) {
        setSelectedId(null);
        setSelectedView(null);
        return;
      }
      setSelectedView({ run, position, now: Date.now() });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [selectedId]);

  const selectedLine = selectedView ? network.lines[selectedView.run.lineId] : null;
  const nextQuay = selectedView?.position.nextQuay;

  return (
    <>
      <div ref={containerRef} className="live-map" role="region" aria-label="Carte des rames en circulation" />
      {popupNode &&
        selectedView &&
        selectedLine &&
        createPortal(
          <VehiclePopup
            line={selectedLine}
            destination={selectedView.run.destination}
            position={selectedView.position}
            nextStopName={nextQuay ? (network.quays[nextQuay]?.name ?? null) : null}
            now={selectedView.now}
          />,
          popupNode,
        )}
    </>
  );
}
