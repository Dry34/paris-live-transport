'use client';
// Focused line view of the side panel: direction and branch pickers, the line's disruptions,
// then the branch's stations with the wait for the next train at each.
// Mounted with key={lineId}: switching lines starts again on direction 0 and the first branch.
import { useMemo, useState, type CSSProperties } from 'react';
import type { Disruption, Network, Snapshot } from '@/lib/types';
import {
  correspondences,
  directionLabel,
  lineBranches,
  nextArrivalsAlongBranch,
  type StationArrival,
} from '@/lib/client/lineFocus';
import { LineBadge, lineName } from './LineBadge';
import { DisruptionList } from './LineGrid';

function formatArrival(a: StationArrival | undefined): string {
  if (!a) return '—';
  if (a.atPlatform) return 'à quai';
  if (a.seconds === null) return '—';
  return `${Math.max(1, Math.floor(a.seconds / 60))} min`;
}

export function LineSheet({
  network,
  snapshot,
  disruptions,
  lineId,
  now,
  onBack,
  onStationSelect,
}: {
  network: Network;
  snapshot: Snapshot | null;
  disruptions: Disruption[];
  lineId: string;
  now: number;
  onBack: () => void;
  onStationSelect: (stationId: string) => void;
}) {
  const line = network.lines[lineId];
  const branches = useMemo(() => lineBranches(network, lineId), [network, lineId]);
  const [direction, setDirection] = useState<0 | 1>(() =>
    branches.length > 0 && !branches.some((b) => b.directionId === 0) ? 1 : 0,
  );
  const [branchIndex, setBranchIndex] = useState(0);
  const runs = useMemo(() => (snapshot?.runs ?? []).filter((r) => r.lineId === lineId), [snapshot, lineId]);

  const dirBranches = branches.filter((b) => b.directionId === direction);
  const branch = dirBranches[branchIndex] ?? dirBranches[0];
  const arrivals = branch ? nextArrivalsAlongBranch(branch, runs, network, now) : {};
  const lineDisruptions = disruptions.filter(
    (d) => d.lineIds.includes(lineId) && d.periods.some((p) => p.begin <= now && now <= p.end),
  );

  const pickDirection = (d: 0 | 1) => {
    setDirection(d);
    setBranchIndex(0);
  };

  if (!line) return null;
  const directions = ([0, 1] as const).map((d) => ({ id: d, label: directionLabel(branches, d) })).filter((d) => d.label);

  return (
    <div className="line-sheet" style={{ '--line-color': line.color } as CSSProperties}>
      <header className="line-sheet-head" style={{ background: line.color, color: line.textColor }}>
        <button type="button" className="line-sheet-back" onClick={onBack} aria-label="Retour aux lignes">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="line-sheet-badge">
          <LineBadge line={line} size="lg" />
        </span>
        <h2 className="line-sheet-title">{lineName(line)}</h2>
      </header>

      {directions.length > 0 && (
        <div className="direction-switch" role="group" aria-label="Sens de circulation">
          {directions.map((d) => (
            <button
              key={d.id}
              type="button"
              className="direction-button"
              aria-pressed={direction === d.id}
              onClick={() => pickDirection(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      {dirBranches.length >= 2 && (
        <div className="branch-chips" role="group" aria-label="Branche">
          {dirBranches.map((b, i) => (
            <button
              key={b.terminusStationId}
              type="button"
              className="branch-chip"
              aria-pressed={b === branch}
              onClick={() => setBranchIndex(i)}
            >
              vers {b.terminusName}
            </button>
          ))}
        </div>
      )}

      {lineDisruptions.length > 0 && (
        <div className="disruptions line-sheet-disruptions">
          <h2>Info trafic</h2>
          <DisruptionList network={network} disruptions={lineDisruptions} emptyText="" />
        </div>
      )}

      {!branch ? (
        <p className="line-sheet-empty">Aucun arrêt connu pour cette ligne.</p>
      ) : (
        <ol className="stop-list" aria-label={`Arrêts vers ${branch.terminusName}`}>
          {branch.stations.map((stationId, i) => {
            const station = network.stations[stationId];
            const a = arrivals[stationId];
            const time = formatArrival(a);
            const links = correspondences(network, stationId, lineId);
            const end = i === 0 || i === branch.stations.length - 1;
            return (
              <li key={stationId} className={`stop${end ? ' is-end' : ''}`}>
                <button type="button" className="stop-button" onClick={() => onStationSelect(stationId)}>
                  <span className="stop-rail" aria-hidden="true" />
                  <span className="stop-main">
                    <span className="stop-name">{station?.name ?? stationId}</span>
                    {links.length > 0 && (
                      <span className="stop-links">
                        {links.map((id) => (
                          <LineBadge key={id} line={network.lines[id]} size="sm" />
                        ))}
                      </span>
                    )}
                  </span>
                  <span className={`stop-time${a?.atPlatform ? ' is-now' : ''}${time === '—' ? ' is-none' : ''}`}>{time}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
