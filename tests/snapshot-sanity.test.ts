// Regression test on a real live capture: the map must not draw parked, invented or duplicated trains.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { positionAt } from '@/lib/client/interpolate';
import { departuresForStation } from '@/lib/realtime/departures';
import { buildRuns } from '@/lib/realtime/runs';
import type { Journey, Network, VehicleRun } from '@/lib/types';

const net = JSON.parse(readFileSync(path.join(__dirname, '../public/data/network.json'), 'utf8')) as Network;
const sample = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/live-journeys-sample.json'), 'utf8')) as {
  fetchedAt: number;
  journeys: Journey[];
};
const T0 = sample.fetchedAt;
const LINE_1 = 'C01371';
const LINE_6 = 'C01376';
const RER_A = 'C01742';

function drawn(runs: VehicleRun[], now: number) {
  return runs.flatMap((run) => {
    const p = positionAt(run, net, now);
    return p ? [{ run, p }] : [];
  });
}

describe('snapshot sanity (capture live lignes 1, 6, RER A)', () => {
  const runs = buildRuns(sample.journeys, net, null, T0);
  // Next poll, 100 s later: SIRI no longer lists the calls already passed.
  const T1 = T0 + 100_000;
  const nextJourneys = sample.journeys
    .map((j) => ({ ...j, calls: j.calls.filter((c) => (c.arr ?? c.dep)! >= T1) }))
    .filter((j) => j.calls.length > 0);
  const second = buildRuns(nextJourneys, net, runs, T1);

  // The simulated next poll has no dwelling train at t+0 (calls already reached are dropped), so a train
  // briefly waiting at its real previous stop weighs more there: a looser share applies.
  const scenarios = [
    ['premier instantané', runs, T0, 0.3],
    ['instantané suivant apparié', second, T1, 0.5],
  ] as const;
  for (const [label, rs, base, maxWaitingShare] of scenarios) {
    for (const dt of [0, 30_000, 60_000, 90_000]) {
      const now = base + dt;
      it(`${label} à +${dt / 1000} s : aucune rame garée longtemps, ni empilée, ni en surnombre`, () => {
        const d = drawn(rs, now);
        const waiting = d.filter((x) => x.p.state === 'waiting');
        for (const { p } of waiting) expect(p.nextTime! - now).toBeLessThanOrEqual(10 * 60_000);
        const perQuay = new Map<string, number>();
        for (const { p } of waiting) perQuay.set(p.nextQuay!, (perQuay.get(p.nextQuay!) ?? 0) + 1);
        expect(Math.max(0, ...perQuay.values())).toBeLessThanOrEqual(2);
        // Most drawn trains move or dwell; waiting ones are a minority, and only a terminus run waits long.
        expect(waiting.length).toBeLessThan(maxWaitingShare * d.length);
        for (const { run, p } of waiting) if (run.hasPrevious) expect(p.nextTime! - now).toBeLessThanOrEqual(60_000);
        // Roughly the fleet in service (about 50 trains on line 1, 40 on line 6, 60 on RER A).
        const count = (lineId: string) => d.filter((x) => x.run.lineId === lineId).length;
        expect(count(LINE_1)).toBeGreaterThan(10);
        expect(count(LINE_1)).toBeLessThanOrEqual(55);
        expect(count(LINE_6)).toBeLessThanOrEqual(45);
        expect(count(RER_A)).toBeLessThanOrEqual(65);
      });
    }
  }

  it('chaque rame, fusionnée ou non, ne suit que des segments du réseau', () => {
    for (const r of [...runs, ...second]) {
      for (let i = 0; i + 1 < r.stops.length; i++) expect(net.segments[`${r.stops[i].quay}>${r.stops[i + 1].quay}`]).toBeDefined();
    }
  });

  it('prochains passages : aucun horaire inventé, aucun doublon à moins de 30 s', () => {
    const snap = { fetchedAt: T0, source: 'cache' as const, runs };
    const now = T0 + 30_000;
    const real = new Set(sample.journeys.flatMap((j) => j.calls.flatMap((c) => [c.dep, c.arr]).filter((t) => t !== null)));
    let total = 0;
    for (const stationId of Object.keys(net.stations)) {
      for (const list of Object.values(departuresForStation(snap, net, stationId, now, 50))) {
        total += list.length;
        list.forEach((d, i) => {
          expect(real.has(d.time)).toBe(true);
          if (i > 0) expect(d.time - list[i - 1].time).toBeGreaterThanOrEqual(30_000);
        });
      }
    }
    expect(total).toBeGreaterThan(100);
  });
});
