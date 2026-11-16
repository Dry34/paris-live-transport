'use client';
// Vertical diagram of one line branch: stations as rows, estimated trains animated between them
// (same 30 fps requestAnimationFrame loop as the map, steady 1 s tick with reduced motion).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Network, Snapshot } from '@/lib/types';
import { createDiagramSmoother, placeRunsOnDiagram, type DiagramBranch } from '@/lib/client/lineDiagram';

const FRAME_MS = 1000 / 30;
const ROW = 44;

function useAnimatedNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const t = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(t);
    }
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      if (ts - last >= FRAME_MS) {
        last = ts;
        setNow(Date.now());
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

export interface LineDiagramProps {
  network: Network;
  lineId: string;
  branch: DiagramBranch;
  title: string;
  snapshot: Snapshot | null;
  selectedStation: string | null;
  onStationClick: (stationId: string) => void;
}

export function LineDiagram({ network, lineId, branch, title, snapshot, selectedStation, onStationClick }: LineDiagramProps) {
  const line = network.lines[lineId];
  const now = useAnimatedNow();
  const runs = useMemo(() => (snapshot?.runs ?? []).filter((r) => r.lineId === lineId), [snapshot, lineId]);
  // A new snapshot may re-estimate a run a few seconds back: never move a train backwards within a section.
  const smooth = useRef(createDiagramSmoother()).current;
  const placed = smooth(placeRunsOnDiagram(branch, runs, network, now));
  const last = branch.stations.length - 1;

  return (
    <section className="diagram" aria-label={title}>
      <h2 className="diagram-title">{title}</h2>
      <div className="diagram-body" style={{ ['--line' as string]: line.color, ['--row' as string]: `${ROW}px` }}>
        <div className="diagram-track" aria-hidden="true" style={{ top: ROW / 2, height: last * ROW }} />
        <ol className="diagram-stations">
          {branch.stations.map((id, i) => (
            <li key={`${id}-${i}`} className={i === 0 || i === last ? 'is-terminus' : undefined}>
              <button type="button" className="diagram-station" aria-pressed={selectedStation === id} onClick={() => onStationClick(id)}>
                <span className="diagram-dot" aria-hidden="true" />
                <span className="diagram-name">{network.stations[id]?.name ?? id}</span>
              </button>
            </li>
          ))}
        </ol>
        {placed.map((p) => (
          <span key={p.runId} className="diagram-train" aria-hidden="true" style={{ top: (p.afterIndex + p.fraction) * ROW + ROW / 2 }} />
        ))}
      </div>
      <p className="sr-only" aria-live="off">{placed.length} rames sur ce sens</p>
    </section>
  );
}
