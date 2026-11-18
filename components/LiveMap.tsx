'use client';
// Full-screen MapLibre map: line shapes, stations and estimated train positions animated
// with requestAnimationFrame (capped at ~30 fps) from the latest snapshot. With a focused line the map frames
// it, fades the other shapes and only draws that line's trains and stations.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DataDrivenPropertyValueSpecification, GeoJSONSource, IControl, Map as MlMap, Popup } from 'maplibre-gl';
import type { Network, Snapshot, VehicleRun } from '@/lib/types';
import { createSmoother, positionAt, type RunPosition } from '@/lib/client/interpolate';
import { fadeColor, lineBounds } from '@/lib/client/lineFocus';
import { maplibreWorkerUrl } from '@/lib/client/maplibreWorker';
import { panIntoView, popupPadding } from '@/lib/client/popupView';
import { VehiclePopup } from './VehiclePopup';
import { createTrain3dLayer, type Train3d, type Train3dLayer } from './train3dLayer';
import { model3dForLine, MODEL_MIN_ZOOM, trackAround } from '@/lib/client/train3d';

const STYLE_LIGHT = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
const STYLE_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const CENTER: [number, number] = [2.3488, 48.8534];
const FRAME_MS = 1000 / 30;
const LINE_WIDTH = { metro: 3.2, rer: 3.6, transilien: 3, tram: 2 } as const;
const CAMERA_MS = 800;
const FIT_PADDING = 40;
const STATION_ZOOM = 14;
/** Station layers' minimum zoom without a focus (with one, the line's stations show at any zoom). */
const STATIONS_MINZOOM = 12;
const STATION_LABELS_MINZOOM = 14;
const FADED_OPACITY = 0.12;
/** Basemap background colors (Positron, Dark Matter) the faded lines are blended into. */
const BASEMAP_BG = { light: '#fafaf8', dark: '#0e0e0e' } as const;

type FC = GeoJSON.FeatureCollection;
const featureCollection = (features: GeoJSON.Feature[]): FC => ({ type: 'FeatureCollection', features });

/** Direction arrow drawn as an SDF icon: a triangle sticking out of a centred circle of ARROW_CIRCLE_PX radius. */
const ARROW_IMAGE = 'vehicle-arrow';
const ARROW_SIZE_PX = 96;
const ARROW_CIRCLE_PX = 18;
function arrowImage(): ImageData {
  const size = ARROW_SIZE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const base = c - ARROW_CIRCLE_PX + 3; // base hidden under the circle's edge
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.moveTo(c, 4); // tip, pointing north
  ctx.lineTo(c + 16, base);
  ctx.lineTo(c - 16, base);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}
/** Vehicle circle radius by zoom; the arrow icon is scaled so its inner circle matches it. */
const VEHICLE_RADIUS: [number, number][] = [[9, 3], [12, 7], [15, 11]];

export interface LiveMapProps {
  network: Network;
  snapshot: Snapshot | null;
  /** Line shown alone (others faded), or null for the whole network. */
  focusLineId: string | null;
  /** Station to ease to (zoom at least 14), or null. */
  centerStationId: string | null;
  /** Map area covered by the side panel, kept clear when framing. */
  panelInset: { left: number; bottom: number };
  onStationClick: (stationId: string) => void;
  /** Header of the train card clicked: focus that line. */
  onOpenLine: (lineId: string) => void;
  onShownCountChange?: (count: number) => void;
}

interface SelectedView { run: VehicleRun; runs: VehicleRun[]; fetchedAt: number; position: RunPosition; now: number }
/** Train card width on desktop; narrower screens keep a 12 px margin on each side. */
const POPUP_MAX_WIDTH = 'min(340px, calc(100vw - 24px))';
/** Gap kept between the train card and the map edges or the side panel. */
const POPUP_MARGIN = 12;
const POPUP_PAN_MS = 300;

function shapesData(network: Network, dark: boolean): FC {
  const features: GeoJSON.Feature[] = [];
  const background = dark ? BASEMAP_BG.dark : BASEMAP_BG.light;
  for (const line of Object.values(network.lines)) {
    const faded = fadeColor(line.color, background, FADED_OPACITY);
    for (const coords of line.shapes) {
      features.push({
        type: 'Feature',
        properties: { lineId: line.id, color: line.color, faded, w: LINE_WIDTH[line.mode], sort: line.mode === 'tram' ? 0 : 1 },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }
  return featureCollection(features);
}

function stationsData(network: Network, focus: string | null): FC {
  return featureCollection(
    Object.values(network.stations)
      .filter((s) => (focus ? s.lines.includes(focus) : s.lines.some((id) => network.lines[id])))
      .map((s) => ({
        type: 'Feature',
        properties: { id: s.id, name: s.name },
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      })),
  );
}

const isFocus = (focus: string): ['==', ['get', 'lineId'], string] => ['==', ['get', 'lineId'], focus];
/** Other lines take their color pre-blended at 12 % into the basemap (opaque, so overlapping shapes don't add up). */
const lineColor = (focus: string | null): DataDrivenPropertyValueSpecification<string> =>
  focus ? ['case', isFocus(focus), ['get', 'color'], ['get', 'faded']] : ['get', 'color'];
/** The focused line is drawn above every other shape. */
const lineSortKey = (focus: string | null): DataDrivenPropertyValueSpecification<number> =>
  focus ? ['case', isFocus(focus), 2, ['get', 'sort']] : ['get', 'sort'];

/** Line layer styling and station layer zoom ranges for a focus (or none). */
function applyFocusStyle(m: MlMap, focus: string | null) {
  m.setPaintProperty('lines', 'line-color', lineColor(focus));
  m.setLayoutProperty('lines', 'line-sort-key', lineSortKey(focus));
  m.setLayerZoomRange('stations', focus ? 0 : STATIONS_MINZOOM, 24);
  m.setLayerZoomRange('station-labels', focus ? 0 : STATION_LABELS_MINZOOM, 24);
}

const TILT_PITCH = 60;
const TILT_ZOOM = 15;

/** "3D" button: tilts the camera (zooming in so the 3D trains show) or flattens it back. */
function tiltControl(): IControl {
  let container: HTMLDivElement | null = null;
  return {
    onAdd(map) {
      container = document.createElement('div');
      container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ltp-tilt';
      button.textContent = '3D';
      button.title = 'Vue 3D';
      button.setAttribute('aria-label', 'Basculer la vue 3D');
      const sync = () => button.setAttribute('aria-pressed', String(map.getPitch() > 5));
      button.addEventListener('click', () => {
        if (map.getPitch() > 5) map.easeTo({ pitch: 0, duration: CAMERA_MS });
        else map.easeTo({ pitch: TILT_PITCH, zoom: Math.max(map.getZoom(), TILT_ZOOM), duration: CAMERA_MS });
      });
      map.on('pitchend', sync);
      sync();
      container.appendChild(button);
      return container;
    },
    onRemove() {
      container?.remove();
    },
  };
}

export function LiveMap({ network, snapshot, focusLineId, centerStationId, panelInset, onStationClick, onOpenLine, onShownCountChange }: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const focusRef = useRef(focusLineId);
  const insetRef = useRef(panelInset);
  /** Line the camera last framed (null: whole network), so a style reload or new props don't refit. */
  const framedRef = useRef<string | null>(null);
  const positionsRef = useRef(new Map<string, RunPosition>());
  const selectedRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onStationClick, onOpenLine, onShownCountChange });
  const popupRef = useRef<Popup | null>(null);
  const [mapLib, setMapLib] = useState<typeof import('maplibre-gl') | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popupNode, setPopupNode] = useState<HTMLDivElement | null>(null);
  const [selectedView, setSelectedView] = useState<SelectedView | null>(null);
  const [mapReady, setMapReady] = useState(false);

  snapshotRef.current = snapshot;
  callbacksRef.current = { onStationClick, onOpenLine, onShownCountChange };
  insetRef.current = panelInset;
  selectedRef.current = selectedId;

  // Map creation, layers and the animation loop.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;
    const media = window.matchMedia(DARK_QUERY);
    const smooth = createSmoother();
    let trains3d: Train3dLayer | null = null;
    /** Hidden where a 3D model is drawn instead (zoomed in, line with a model). */
    const flatOpacity = ['step', ['zoom'], 1, MODEL_MIN_ZOOM, ['case', ['get', 'm3d'], 0, 1]] as DataDrivenPropertyValueSpecification<number>;

    const addLayers = (m: MlMap) => {
      if (m.getSource('lines')) return;
      const firstSymbol = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
      m.addSource('lines', { type: 'geojson', data: shapesData(network, media.matches) });
      m.addSource('stations', { type: 'geojson', data: stationsData(network, focusRef.current) });
      m.addSource('vehicles', { type: 'geojson', data: featureCollection([]) });
      m.addLayer(
        {
          id: 'lines',
          type: 'line',
          source: 'lines',
          layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': lineSortKey(focusRef.current) },
          paint: {
            'line-color': lineColor(focusRef.current),
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
          minzoom: focusRef.current ? 0 : STATIONS_MINZOOM,
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
        minzoom: focusRef.current ? 0 : STATION_LABELS_MINZOOM,
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
      if (!m.hasImage(ARROW_IMAGE)) m.addImage(ARROW_IMAGE, arrowImage(), { sdf: true });
      m.addLayer({
        id: 'vehicle-arrows',
        type: 'symbol',
        source: 'vehicles',
        filter: ['has', 'bearing'],
        layout: {
          'icon-image': ARROW_IMAGE,
          'icon-size': ['interpolate', ['linear'], ['zoom'], ...VEHICLE_RADIUS.flatMap(([z, r]) => [z, r / ARROW_CIRCLE_PX])] as DataDrivenPropertyValueSpecification<number>,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-pitch-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          // Contrasting fill + halo (not the line colour): the arrow sits on the track and must stand out.
          'icon-color': media.matches ? '#ffffff' : '#141821',
          'icon-halo-color': media.matches ? '#141821' : '#ffffff',
          'icon-halo-width': 1.6,
          'icon-opacity': flatOpacity,
        },
      });
      m.addLayer({
        id: 'vehicles',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], ...VEHICLE_RADIUS.flat()] as DataDrivenPropertyValueSpecification<number>,
          'circle-color': ['get', 'color'],
          'circle-stroke-color': media.matches ? '#10141b' : '#ffffff',
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.8, 14, 2],
          'circle-opacity': flatOpacity,
          'circle-stroke-opacity': flatOpacity,
        },
      });
      trains3d = createTrain3dLayer();
      m.addLayer(trains3d);
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
      setMapReady(true);
    };

    const draw = () => {
      if (!map || !readyRef.current) return;
      const source = map.getSource<GeoJSONSource>('vehicles');
      if (!source) return;
      const snap = snapshotRef.current;
      const now = Date.now();
      // Only the focused line's trains enter the shared `vehicles` source, which filters the
      // vehicles, vehicle-labels and vehicle-halo layers alike (and the shown-trains count).
      const focus = focusRef.current;
      const positions = new Map<string, RunPosition>();
      const features: GeoJSON.Feature[] = [];
      const models: Train3d[] = [];
      const show3d = map.getZoom() >= MODEL_MIN_ZOOM;
      for (const run of snap?.runs ?? []) {
        const line = network.lines[run.lineId];
        if (!line || (focus && run.lineId !== focus)) continue;
        const p = smooth(run, positionAt(run, network, now), now, run.id === selectedRef.current);
        if (!p) continue;
        positions.set(run.id, p);
        const model = model3dForLine(run.lineId);
        if (model && show3d) models.push({ spec: model, track: trackAround(run, network, p), coord: p.coord, bearing: p.bearing });
        features.push({
          type: 'Feature',
          properties: { id: run.id, color: line.color, textColor: line.textColor, label: line.shortName, m3d: model !== null, ...(p.bearing === null ? {} : { bearing: p.bearing }) },
          geometry: { type: 'Point', coordinates: p.coord },
        });
      }
      positionsRef.current = positions;
      void source.setData(featureCollection(features));
      trains3d?.update(models);
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
      ml.setWorkerUrl(maplibreWorkerUrl(ml.getVersion()));
      map = new ml.Map({
        container: containerRef.current,
        style: media.matches ? STYLE_DARK : STYLE_LIGHT,
        center: CENTER,
        zoom: 11,
        attributionControl: false,
      });
      mapRef.current = map;
      setMapLib(ml);
      // No `compact` option: full credits stay visible on wide screens (compact: true folds them to an "i" on the first
      // drag); MapLibre switches to the foldable compact form by itself under 640 px.
      map.addControl(new ml.AttributionControl({ customAttribution: 'Données IDFM (PRIM)' }), 'bottom-right');
      map.addControl(new ml.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
      map.addControl(tiltControl(), 'top-right');
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
      setMapReady(false);
      framedRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [network]);

  // Focus: fade the other shapes, keep only the line's stations, and frame the line (or go back to Paris).
  useEffect(() => {
    focusRef.current = focusLineId;
    const map = mapRef.current;
    if (!map || !mapReady || !readyRef.current) return;
    applyFocusStyle(map, focusLineId);
    map.getSource<GeoJSONSource>('stations')?.setData(stationsData(network, focusLineId));
    if (framedRef.current === focusLineId) return;
    const wasFocused = framedRef.current !== null;
    framedRef.current = focusLineId;
    const bounds = focusLineId ? lineBounds(network, focusLineId) : null;
    if (bounds) {
      const inset = insetRef.current;
      map.fitBounds(bounds, {
        padding: { top: FIT_PADDING, right: FIT_PADDING, bottom: FIT_PADDING + inset.bottom, left: FIT_PADDING + inset.left },
        duration: CAMERA_MS,
      });
    } else if (!focusLineId && wasFocused) {
      map.easeTo({ center: CENTER, zoom: 11, duration: CAMERA_MS });
    }
  }, [focusLineId, network, mapReady]);

  // Station picked in the panel: ease to it, centered in the part of the map the panel leaves visible.
  useEffect(() => {
    const map = mapRef.current;
    const station = centerStationId ? network.stations[centerStationId] : undefined;
    if (!map || !mapReady || !station) return;
    const inset = insetRef.current;
    map.easeTo({
      center: [station.lon, station.lat],
      zoom: Math.max(map.getZoom(), STATION_ZOOM),
      offset: [inset.left / 2, -inset.bottom / 2],
      duration: CAMERA_MS,
    });
  }, [centerStationId, network, mapReady]);

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
    const popup = new mapLib.Popup({
      closeOnClick: false,
      offset: 14,
      maxWidth: POPUP_MAX_WIDTH,
      focusAfterOpen: false,
      padding: popupPadding(insetRef.current, POPUP_MARGIN),
    })
      .setLngLat(pos.coord)
      .setDOMContent(node)
      .addTo(map);
    popup.on('close', () => setSelectedId((id) => (id === selectedId ? null : id)));
    popupRef.current = popup;
    setPopupNode(node);

    // Keep the card inside the free map area (off the side panel, above the bottom sheet) when it opens, grows (fold
    // opened) or after a programmatic camera move (line framed from the header). A drag or zoom by the user disarms
    // it until the next click inside the card, so the map never fights the user.
    let armed = true;
    let ownPan = false;
    const el = popup.getElement();
    const keepInView = () => {
      if (!armed || map.isMoving()) return;
      const c = map.getContainer().getBoundingClientRect();
      const pad = popupPadding(insetRef.current, POPUP_MARGIN);
      const area = { left: c.left + pad.left, top: c.top + pad.top, right: c.right - pad.right, bottom: c.bottom - pad.bottom };
      const [x, y] = panIntoView(el.getBoundingClientRect(), area);
      if (Math.abs(x) < 1 && Math.abs(y) < 1) return;
      ownPan = true;
      map.panBy([x, y], { duration: POPUP_PAN_MS });
    };
    const arm = () => (armed = true);
    const onMoveStart = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) armed = false;
    };
    const onMoveEnd = () => {
      if (ownPan) ownPan = false;
      else keepInView();
    };
    const resizes = new ResizeObserver(keepInView);
    resizes.observe(el);
    el.addEventListener('click', arm);
    map.on('movestart', onMoveStart);
    map.on('moveend', onMoveEnd);
    return () => {
      resizes.disconnect();
      el.removeEventListener('click', arm);
      map.off('movestart', onMoveStart);
      map.off('moveend', onMoveEnd);
      popupRef.current = null;
      popup.remove();
      setPopupNode(null);
      if (readyRef.current && mapRef.current) mapRef.current.setFilter('vehicle-halo', ['==', ['get', 'id'], '']);
    };
  }, [selectedId, mapLib]);

  // The panel's size changes (sheet dragged, window resized): the open card keeps avoiding it.
  useEffect(() => {
    popupRef.current?.setPadding(popupPadding(panelInset, POPUP_MARGIN));
  }, [panelInset]);

  // Popup text and the shown-trains counter refresh once per second (not per frame).
  useEffect(() => {
    const tick = () => {
      callbacksRef.current.onShownCountChange?.(positionsRef.current.size);
      const id = selectedRef.current;
      if (!id) {
        setSelectedView(null);
        return;
      }
      const snap = snapshotRef.current;
      const run = snap?.runs.find((r) => r.id === id);
      const position = positionsRef.current.get(id);
      if (!snap || !run || !position) {
        setSelectedId(null);
        setSelectedView(null);
        return;
      }
      setSelectedView({ run, runs: snap.runs, fetchedAt: snap.fetchedAt, position, now: Date.now() });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [selectedId]);

  const selectedLine = selectedView ? network.lines[selectedView.run.lineId] : null;

  return (
    <>
      <div ref={containerRef} className="live-map" role="region" aria-label="Carte des rames en circulation" />
      {popupNode &&
        selectedView &&
        selectedLine &&
        createPortal(
          <VehiclePopup
            key={selectedView.run.id}
            network={network}
            run={selectedView.run}
            runs={selectedView.runs}
            position={selectedView.position}
            fetchedAt={selectedView.fetchedAt}
            now={selectedView.now}
            onOpenLine={(lineId) => callbacksRef.current.onOpenLine(lineId)}
          />,
          popupNode,
        )}
    </>
  );
}
