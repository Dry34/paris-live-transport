'use client';
import { useEffect, useState } from 'react';
import type { Disruption, Mode, Network, Snapshot } from '@/lib/types';
import { LineBadge, MODE_LABELS, lineName } from './LineBadge';

const MODES: Mode[] = ['metro', 'rer', 'tram', 'transilien'];

export interface SidePanelProps {
  network: Network | null;
  snapshot: Snapshot | null;
  disruptions: Disruption[];
  hiddenLines: ReadonlySet<string>;
  shownCount: number;
  onToggleLine: (lineId: string) => void;
  onToggleMode: (mode: Mode, visible: boolean) => void;
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

export function SidePanel({ network, snapshot, disruptions, hiddenLines, shownCount, onToggleLine, onToggleMode }: SidePanelProps) {
  const [open, setOpen] = useState(true);
  const now = useNow(1000);
  // On phones the panel is a bottom sheet: start folded so the map stays visible.
  useEffect(() => {
    if (window.matchMedia('(max-width: 720px)').matches) setOpen(false);
  }, []);
  const lines = network ? Object.values(network.lines) : [];

  return (
    <section className={`side-panel${open ? ' is-open' : ''}`} aria-label="Filtres et état du trafic">
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
        {MODES.map((mode) => {
          const modeLines = lines.filter((l) => l.mode === mode);
          if (modeLines.length === 0) return null;
          const visible = modeLines.some((l) => !hiddenLines.has(l.id));
          return (
            <div key={mode} className="mode-group">
              <div className="mode-head">
                <h2>{MODE_LABELS[mode]}</h2>
                <button type="button" className="mode-switch" aria-pressed={visible} onClick={() => onToggleMode(mode, !visible)}>
                  {visible ? 'Tout masquer' : 'Tout afficher'}
                </button>
              </div>
              <div className="line-grid">
                {modeLines.map((l) => {
                  const shown = !hiddenLines.has(l.id);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="line-toggle"
                      aria-pressed={shown}
                      aria-label={`${lineName(l)} : ${shown ? 'affichée' : 'masquée'}`}
                      onClick={() => onToggleLine(l.id)}
                    >
                      <LineBadge line={l} />
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="disruptions">
          <h2>Info trafic</h2>
          {disruptions.length === 0 ? (
            <p className="disruptions-empty">Aucune perturbation signalée sur ces lignes.</p>
          ) : (
            <ul>
              {disruptions.map((d) => (
                <li key={d.id} className={`disruption sev-${d.severity.toLowerCase()}`}>
                  <details>
                    <summary>
                      <span className="disruption-lines">
                        {d.lineIds.map((id) => network?.lines[id] && <LineBadge key={id} line={network.lines[id]} size="sm" />)}
                      </span>
                      <span className="disruption-title">{d.title}</span>
                    </summary>
                    <p className="disruption-message">{d.message}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="side-foot">
          Positions estimées à partir des horaires temps réel d’Île-de-France Mobilités. Touchez une rame ou une station pour le détail.
        </p>
      </div>
    </section>
  );
}
