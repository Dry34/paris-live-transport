'use client';
import { useEffect, useState } from 'react';
import type { Departure, Network } from '@/lib/types';
import { LineBadge, lineName } from './LineBadge';

const REFRESH_MS = 30_000;

interface StopResponse { stationId: string; name: string; departures: Record<string, Departure[]> }

function formatWait(time: number, now: number): string {
  const min = Math.floor((time - now) / 60_000);
  return min < 1 ? '< 1 min' : `${min} min`;
}

export function StationPanel({ stationId, network, onClose }: { stationId: string; network: Network; onClose: () => void }) {
  const station = network.stations[stationId];
  const [data, setData] = useState<StopResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // A new station remounts the panel (key in AppShell), so data and failure start empty.
    let alive = true;
    const load = () =>
      fetch(`/api/stops/${encodeURIComponent(stationId)}`, { cache: 'no-store' })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          return r.json() as Promise<StopResponse>;
        })
        .then((d) => {
          if (!alive) return;
          setData(d);
          setFailed(false);
          setNow(Date.now());
        })
        .catch(() => alive && setFailed(true));
    load();
    const timer = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [stationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lineOrder = Object.keys(network.lines);
  const groups = Object.values(data?.departures ?? {})
    .map((list) => list.filter((d) => d.time > now))
    .filter((list) => list.length > 0 && network.lines[list[0].lineId])
    .sort((a, b) =>
      a[0].lineId === b[0].lineId
        ? a[0].time - b[0].time
        : lineOrder.indexOf(a[0].lineId) - lineOrder.indexOf(b[0].lineId),
    );

  return (
    <aside className="station-panel" aria-labelledby="station-panel-title">
      <header className="station-panel-head">
        <div>
          <h2 id="station-panel-title">{data?.name ?? station?.name ?? 'Station'}</h2>
          <div className="station-panel-lines">
            {(station?.lines ?? []).map((id) => network.lines[id] && <LineBadge key={id} line={network.lines[id]} size="sm" />)}
          </div>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Fermer la fiche de la station">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
      </header>

      {failed && !data && <p className="station-panel-empty">Les prochains passages n’ont pas pu être chargés. Nouvel essai dans 30 s.</p>}
      {!failed && !data && <p className="station-panel-empty">Chargement des prochains passages…</p>}
      {data && groups.length === 0 && <p className="station-panel-empty">Aucun passage annoncé pour le moment.</p>}

      {groups.length > 0 && (
        <ul className="departures">
          {groups.map((list) => {
            const line = network.lines[list[0].lineId];
            return (
              <li key={`${list[0].lineId}|${list[0].direction}`} className="departure-row">
                <LineBadge line={line} />
                <div className="departure-main">
                  <span className="sr-only">{lineName(line)}, </span>
                  <span className="departure-dest">{list[0].destination}</span>
                  <span className="departure-times">
                    {list.map((d, i) => (
                      <span key={d.runId} className={i === 0 ? 'departure-first' : undefined}>
                        {formatWait(d.time, now)}
                      </span>
                    ))}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="station-panel-foot">Horaires temps réel, actualisés toutes les 30 s</p>
    </aside>
  );
}
