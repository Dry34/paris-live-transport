'use client';
import { useCallback, useState } from 'react';
import type { Mode } from '@/lib/types';
import { useLiveData } from '@/lib/client/useLiveData';
import { LiveMap } from '@/components/LiveMap';
import { SidePanel } from '@/components/SidePanel';
import { StationPanel } from '@/components/StationPanel';

export default function HomePage() {
  const { network, snapshot, disruptions, error } = useLiveData();
  const [hiddenLines, setHiddenLines] = useState<ReadonlySet<string>>(() => new Set());
  const [stationId, setStationId] = useState<string | null>(null);
  const [shownCount, setShownCount] = useState(0);

  const toggleLine = useCallback((lineId: string) => {
    setHiddenLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }, []);

  const toggleMode = useCallback(
    (mode: Mode, visible: boolean) => {
      if (!network) return;
      const ids = Object.values(network.lines).filter((l) => l.mode === mode).map((l) => l.id);
      setHiddenLines((prev) => {
        const next = new Set(prev);
        for (const id of ids) {
          if (visible) next.delete(id);
          else next.add(id);
        }
        return next;
      });
    },
    [network],
  );

  const closeStation = useCallback(() => setStationId(null), []);

  return (
    <main className="app">
      {network && (
        <LiveMap
          network={network}
          snapshot={snapshot}
          hiddenLines={hiddenLines}
          onStationClick={setStationId}
          onShownCountChange={setShownCount}
        />
      )}
      {error && (
        <p className="error-banner" role="status">
          {error}
        </p>
      )}
      <SidePanel
        network={network}
        snapshot={snapshot}
        disruptions={disruptions}
        hiddenLines={hiddenLines}
        shownCount={shownCount}
        onToggleLine={toggleLine}
        onToggleMode={toggleMode}
      />
      {network && stationId && <StationPanel stationId={stationId} network={network} onClose={closeStation} />}
    </main>
  );
}
