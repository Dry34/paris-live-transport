'use client';
import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLiveData } from '@/lib/client/useLiveData';
import { diagramBranches } from '@/lib/client/lineDiagram';
import { LineBadge, lineName } from './LineBadge';
import { LineDiagram } from './LineDiagram';
import { StationPanel } from './StationPanel';

export function LinePageClient({ lineId }: { lineId: string }) {
  const { network, snapshot, disruptions, error } = useLiveData();
  const [stationId, setStationId] = useState<string | null>(null);
  const closeStation = useCallback(() => setStationId(null), []);
  const branches = useMemo(() => (network ? diagramBranches(network, lineId) : []), [network, lineId]);
  const line = network?.lines[lineId];
  const lineDisruptions = disruptions.filter((d) => d.lineIds.includes(lineId));
  const count = (snapshot?.runs ?? []).filter((r) => r.lineId === lineId).length;

  return (
    <main className="app">
      <div className="line-scroll">
        <header className="line-head" style={line ? { background: line.color, color: line.textColor } : undefined}>
          <Link href="/" className="line-back" aria-label="Retour à la carte">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Carte
          </Link>
          {line ? (
            <div className="line-head-main">
              <span className="line-head-badge"><LineBadge line={line} size="lg" /></span>
              <div>
                <h1>{lineName(line)}</h1>
                <p>{line.longName}</p>
              </div>
            </div>
          ) : (
            <h1>Chargement de la ligne…</h1>
          )}
          {snapshot && <p className="line-head-count">{count} {count > 1 ? 'rames en circulation' : 'rame en circulation'}{snapshot.source === 'replay' ? ' (données rejouées)' : ''}</p>}
        </header>

        <div className="line-content">
          {error && <p className="error-inline" role="status">{error}</p>}
          <div className="disruptions line-disruptions">
            <h2>Info trafic</h2>
            {lineDisruptions.length === 0 ? (
              <p className="disruptions-empty">Aucune perturbation signalée sur cette ligne.</p>
            ) : (
              <ul>
                {lineDisruptions.map((d) => (
                  <li key={d.id} className={`disruption sev-${d.severity.toLowerCase()}`}>
                    <details>
                      <summary><span className="disruption-title">{d.title}</span></summary>
                      <p className="disruption-message">{d.message}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {network && branches.length === 0 && <p className="disruptions-empty">Le tracé de cette ligne n’est pas disponible.</p>}
          <div className="diagrams">
            {network &&
              branches.map((b, i) => {
                const first = network.stations[b.stations[0]]?.name ?? '';
                const dup = branches.filter((o, j) => j !== i && o.directionId === b.directionId).length > 0;
                const title = `Direction ${b.headsign || network.stations[b.stations[b.stations.length - 1]]?.name || ''}${dup ? ` (depuis ${first})` : ''}`;
                return (
                  <LineDiagram
                    key={`${b.directionId}-${i}`}
                    network={network}
                    lineId={lineId}
                    branch={b}
                    title={title}
                    snapshot={snapshot}
                    selectedStation={stationId}
                    onStationClick={setStationId}
                  />
                );
              })}
          </div>
        </div>
      </div>
      {network && stationId && <StationPanel stationId={stationId} network={network} onClose={closeStation} />}
    </main>
  );
}
