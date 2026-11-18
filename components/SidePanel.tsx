'use client';
import { useEffect, useState, type Ref } from 'react';
import type { Disruption, Network, Snapshot } from '@/lib/types';
import { LineGrid } from './LineGrid';
import { LineSheet } from './LineSheet';

export interface SidePanelProps {
  network: Network | null;
  snapshot: Snapshot | null;
  disruptions: Disruption[];
  shownCount: number;
  focusLineId: string | null;
  onFocusLine: (lineId: string | null) => void;
  /** Centers the map on a station and opens its panel (used by the line sheet). */
  onStationSelect: (stationId: string) => void;
  /** The panel element, measured by the shell to keep the map's focus framing clear of it. */
  panelRef?: Ref<HTMLElement>;
}

function formatAge(fetchedAt: number, now: number): string {
  const s = Math.max(0, Math.round((now - fetchedAt) / 1000));
  if (s < 90) return `Mis à jour il y a ${s} s`;
  const min = Math.round(s / 60);
  return min < 90 ? `Mis à jour il y a ${min} min` : `Mis à jour il y a ${Math.round(min / 60)} h`;
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function SidePanel({ network, snapshot, disruptions, shownCount, focusLineId, onFocusLine, onStationSelect, panelRef }: SidePanelProps) {
  const [open, setOpen] = useState(true);
  const now = useNow(1000);
  // On phones the panel is a bottom sheet: start folded so the map stays visible.
  useEffect(() => {
    if (window.matchMedia('(max-width: 720px)').matches) setOpen(false);
  }, []);

  return (
    <section ref={panelRef} className={`side-panel${open ? ' is-open' : ''}`} aria-label="Lignes et état du trafic">
      <header className="side-head">
        <div className="side-title">
          <h1>Paris, rames en direct</h1>
          <p className="side-status" aria-live="polite">
            <span className={`live-dot${snapshot?.source === 'live' ? ' is-live' : ''}`} aria-hidden="true" />
            {snapshot ? formatAge(snapshot.fetchedAt, now) : 'Chargement des positions…'}
            {snapshot?.source === 'replay' && <span className="replay-badge">Données rejouées</span>}
          </p>
          <p className="side-count">
            <strong>{shownCount}</strong> {shownCount > 1 ? 'rames affichées' : 'rame affichée'}
          </p>
        </div>
        <button
          type="button"
          className="icon-button side-toggle"
          aria-expanded={open}
          aria-controls="side-body"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Replier le panneau' : 'Déplier le panneau'}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </header>

      <div id="side-body" className="side-body" hidden={!open}>
        {network && focusLineId && network.lines[focusLineId] ? (
          <LineSheet
            key={focusLineId}
            network={network}
            snapshot={snapshot}
            disruptions={disruptions}
            lineId={focusLineId}
            now={now}
            onBack={() => onFocusLine(null)}
            onStationSelect={onStationSelect}
          />
        ) : (
          <LineGrid network={network} snapshot={snapshot} disruptions={disruptions} now={now} onSelect={onFocusLine} />
        )}

        <p className="side-foot">
          Positions estimées à partir des horaires temps réel d’Île-de-France Mobilités. Touchez une rame ou une station pour le détail.
        </p>
      </div>
    </section>
  );
}
