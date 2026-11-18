'use client';
// Shared client root of `/` and `/lignes/[id]`: live data, the map, the side panel and the station panel.
// Holds the focused line (mirrored in the URL with history.replaceState) and the station selection.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveData } from '@/lib/client/useLiveData';
import { lineSlug } from '@/lib/lineSlug';
import { LiveMap } from '@/components/LiveMap';
import { SidePanel } from '@/components/SidePanel';
import { StationPanel } from '@/components/StationPanel';

const MOBILE_QUERY = '(max-width: 720px)';
const NO_INSET = { left: 0, bottom: 0 };

/** Map area hidden by the panel: its right edge on desktop, its height when it is a bottom sheet on phones. */
function usePanelInset() {
  const panelRef = useRef<HTMLElement>(null);
  const [inset, setInset] = useState(NO_INSET);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const media = window.matchMedia(MOBILE_QUERY);
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = media.matches ? { left: 0, bottom: Math.round(rect.height) } : { left: Math.round(rect.right), bottom: 0 };
      setInset((prev) => (prev.left === next.left && prev.bottom === next.bottom ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    media.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', measure);
    };
  }, []);
  return { panelRef, inset };
}

export function AppShell({ initialLineId }: { initialLineId: string | null }) {
  const { network, snapshot, disruptions, error } = useLiveData();
  const [focusLineId, setFocusLineId] = useState<string | null>(initialLineId);
  const [stationId, setStationId] = useState<string | null>(null);
  const [centerStationId, setCenterStationId] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(0);
  const { panelRef, inset } = usePanelInset();

  const onFocusLine = useCallback((lineId: string | null) => setFocusLineId(lineId), []);

  /** A station picked in the panel: center the map on it and open its departures. */
  const onStationSelect = useCallback((id: string) => {
    setStationId(id);
    setCenterStationId(id);
  }, []);

  const closeStation = useCallback(() => {
    setStationId(null);
    setCenterStationId(null);
  }, []);

  // Keep the URL in step with the focus, without a navigation.
  useEffect(() => {
    if (focusLineId && !network) return;
    const line = focusLineId ? network?.lines[focusLineId] : undefined;
    const path = line ? '/lignes/' + lineSlug(line) : '/';
    if (window.location.pathname !== path) window.history.replaceState(null, '', path);
  }, [focusLineId, network]);

  return (
    <main className="app">
      {network && (
        <LiveMap
          network={network}
          snapshot={snapshot}
          focusLineId={focusLineId}
          centerStationId={centerStationId}
          panelInset={inset}
          onStationClick={setStationId}
          onOpenLine={onFocusLine}
          onShownCountChange={setShownCount}
        />
      )}
      {error && (
        <p className="error-banner" role="status">
          {error}
        </p>
      )}
      <SidePanel
        panelRef={panelRef}
        network={network}
        snapshot={snapshot}
        disruptions={disruptions}
        shownCount={shownCount}
        focusLineId={focusLineId}
        onFocusLine={onFocusLine}
        onStationSelect={onStationSelect}
      />
      {network && stationId && <StationPanel key={stationId} stationId={stationId} network={network} onClose={closeStation} />}
    </main>
  );
}
