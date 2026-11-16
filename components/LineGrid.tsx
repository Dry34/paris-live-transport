'use client';
// Home view of the side panel: line pastilles grouped by mode, each with its traffic status, then the disruptions.
import type { Disruption, Mode, Network, Snapshot } from '@/lib/types';
import { lineStatus, type LineStatus } from '@/lib/client/lineFocus';
import { LineBadge, MODE_LABELS } from './LineBadge';

const MODES: Mode[] = ['metro', 'rer', 'tram', 'transilien'];

const STATUS_LABELS: Record<LineStatus, string> = {
  ok: 'trafic normal',
  disrupted: 'trafic perturbé',
  'no-service': 'pas de rame',
};

/** Small corner mark: check (normal), exclamation (disrupted), crescent moon (no train running). */
function StatusMark({ status }: { status: LineStatus }) {
  return (
    <span className={`status-mark status-${status}`} aria-hidden="true">
      <svg viewBox="0 0 12 12" width="10" height="10">
        {status === 'ok' && (
          <path d="M3 6.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {status === 'disrupted' && (
          <>
            <path d="M6 2.6v4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            <circle cx="6" cy="9.1" r="1.1" fill="currentColor" />
          </>
        )}
        {status === 'no-service' && <path d="M8.6 8.4A3.7 3.7 0 0 1 4.1 2.6a3.7 3.7 0 1 0 4.5 5.8z" fill="currentColor" />}
      </svg>
    </span>
  );
}

export function DisruptionList({ network, disruptions, emptyText }: { network: Network | null; disruptions: Disruption[]; emptyText: string }) {
  if (disruptions.length === 0) return <p className="disruptions-empty">{emptyText}</p>;
  return (
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
  );
}

export function LineGrid({
  network,
  snapshot,
  disruptions,
  now,
  onSelect,
}: {
  network: Network | null;
  snapshot: Snapshot | null;
  disruptions: Disruption[];
  now: number;
  onSelect: (lineId: string) => void;
}) {
  const lines = network ? Object.values(network.lines) : [];
  const runs = snapshot?.runs ?? [];

  return (
    <>
      {MODES.map((mode) => {
        const modeLines = lines.filter((l) => l.mode === mode);
        if (modeLines.length === 0) return null;
        return (
          <section key={mode} className="mode-group" aria-label={MODE_LABELS[mode]}>
            <h2 className="mode-head">
              {MODE_LABELS[mode]} · {modeLines.length}
            </h2>
            <div className="line-grid">
              {modeLines.map((l) => {
                // Until the first snapshot arrives the status is unknown: no mark rather than a false "no train".
                const status = snapshot ? lineStatus(l.id, disruptions, runs, now) : null;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className="line-pick"
                    aria-label={status ? `Ligne ${l.shortName}, ${STATUS_LABELS[status]}` : `Ligne ${l.shortName}`}
                    onClick={() => onSelect(l.id)}
                  >
                    <LineBadge line={l} />
                    {status && <StatusMark status={status} />}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="disruptions">
        <h2>Info trafic</h2>
        <DisruptionList network={network} disruptions={disruptions} emptyText="Aucune perturbation signalée sur ces lignes." />
      </div>
    </>
  );
}
