import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEstimatedTimetable } from '@/lib/realtime/siri';
import { isTargetLine } from '@/lib/lines';

const sample = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/et-sample.json'), 'utf8'));

const wrap = (journeys: unknown[], ts = '2026-11-16T10:00:00.000Z') => ({
  Siri: {
    ServiceDelivery: {
      ResponseTimestamp: ts,
      EstimatedTimetableDelivery: [{ EstimatedJourneyVersionFrame: [{ EstimatedVehicleJourney: journeys }] }],
    },
  },
});

describe('parseEstimatedTimetable', () => {
  it('lit le ResponseTimestamp et ne garde que les lignes ciblées', () => {
    const { responseTime, journeys } = parseEstimatedTimetable(sample);
    expect(responseTime).toBe(Date.parse('2026-11-16T10:52:01.386Z'));
    expect(journeys.length).toBeGreaterThan(50);
    expect(journeys.every((j) => isTargetLine(j.lineId))).toBe(true);
    expect(journeys.every((j) => j.calls.length > 0)).toBe(true);
  });

  it('extrait un journey ligne 1 avec quais numériques et temps croissants', () => {
    const { journeys } = parseEstimatedTimetable(sample);
    const l1 = journeys.filter((j) => j.lineId === 'C01371');
    expect(l1.length).toBeGreaterThan(0);
    for (const j of l1) {
      expect(j.operator).toBe('RATP');
      for (const c of j.calls) expect(c.quay).toMatch(/^\d+$/);
      const times = j.calls.map((c) => c.arr ?? c.dep ?? 0);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  it('JSON vide ou malformé → journeys vides sans exception', () => {
    for (const raw of [null, undefined, {}, 'x', 42, { Siri: {} }, { Siri: { ServiceDelivery: { EstimatedTimetableDelivery: 'oops' } } }]) {
      expect(parseEstimatedTimetable(raw).journeys).toEqual([]);
    }
  });

  it('mappe ref, direction, destination, opérateur, Expected ?? Aimed et ignore les lignes non ciblées', () => {
    const raw = wrap([
      {
        LineRef: { value: 'STIF:Line::C01742:' },
        DirectionRef: { value: 'Retour' },
        DatedVehicleJourneyRef: { value: 'SNCF_MAGENTA_PRD:VehicleJourney::abc:LOC' },
        DestinationName: [{ value: 'Marne-la-Vallée Chessy' }],
        OperatorRef: {},
        EstimatedCalls: {
          EstimatedCall: [
            {
              StopPointRef: { value: 'STIF:StopArea:SP:58937:' },
              DepartureStopAssignment: { ExpectedQuayRef: { value: 'STIF:StopPoint:Q:474040:' } },
              AimedArrivalTime: '2026-11-16T10:05:00.000Z',
              AimedDepartureTime: '2026-11-16T10:05:30.000Z',
              ExpectedDepartureTime: '2026-11-16T10:06:00.000Z',
            },
            { StopPointRef: { value: 'STIF:StopPoint:Q:22083:' }, ExpectedArrivalTime: '2026-11-16T10:01:00.000Z' },
            { StopPointRef: { value: 'STIF:StopPoint:Q:99:' } }, // sans horaire → ignoré
          ],
        },
      },
      {
        LineRef: { value: 'STIF:Line::C99999:' },
        DatedVehicleJourneyRef: { value: 'RATP-SIV:x' },
        EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:1:' }, ExpectedArrivalTime: '2026-11-16T10:01:00.000Z' }] },
      },
      { LineRef: { value: 'STIF:Line::C01371:' }, EstimatedCalls: { EstimatedCall: [] } },
      {
        LineRef: { value: 'STIF:Line::C01389:' },
        OperatorRef: { value: 'RATP-SIV:Operator::RATP.SAE-TRAM.T1:' },
        EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:5:' }, ExpectedArrivalTime: '2026-11-16T10:01:00.000Z' }] },
      },
      {
        LineRef: { value: 'STIF:Line::C01999:' },
        DatedVehicleJourneyRef: { value: '022_KIDF:VehicleJourney::1:' },
        EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:6:' }, ExpectedArrivalTime: '2026-11-16T10:01:00.000Z' }] },
      },
    ]);
    const { responseTime, journeys } = parseEstimatedTimetable(raw);
    expect(responseTime).toBe(Date.parse('2026-11-16T10:00:00.000Z'));
    expect(journeys).toHaveLength(3);
    expect(journeys[0]).toEqual({
      ref: 'SNCF_MAGENTA_PRD:VehicleJourney::abc:LOC',
      lineId: 'C01742',
      direction: 'Retour',
      destination: 'Marne-la-Vallée Chessy',
      operator: 'SNCF',
      mission: null,
      trainNumber: null,
      length: null,
      calls: [
        { quay: '22083', arr: Date.parse('2026-11-16T10:01:00.000Z'), dep: null, delaySec: null },
        { quay: 'monomodalStopPlace:58937', arr: Date.parse('2026-11-16T10:05:00.000Z'), dep: Date.parse('2026-11-16T10:06:00.000Z'), delaySec: 30 },
      ],
    });
    expect(journeys[1].operator).toBe('RATP');
    expect(journeys[2].operator).toBe('OTHER');
  });

  it('SNCF (StopArea:SP) → quai réseau monomodalStopPlace, couvert à 100 % par network.json', () => {
    const net = JSON.parse(readFileSync(path.join(__dirname, '../public/data/network.json'), 'utf8'));
    const rail = parseEstimatedTimetable(sample).journeys.filter((j) => j.operator === 'SNCF');
    expect(rail.length).toBeGreaterThan(0);
    const quays = rail.flatMap((j) => j.calls.map((c) => c.quay));
    expect(quays.every((q) => q.startsWith('monomodalStopPlace:'))).toBe(true);
    expect(quays.filter((q) => net.quays[q])).toHaveLength(quays.length);
  });
});

describe('delaySec par arrêt', () => {
  const call = (extra: Record<string, string>) => ({
    LineRef: { value: 'STIF:Line::C01371:' },
    DirectionRef: { value: 'Aller' },
    DatedVehicleJourneyRef: { value: 'RATP:VJ:1' },
    DestinationName: [{ value: 'X' }],
    EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:123:' }, ...extra }] },
  });
  const delayOf = (extra: Record<string, string>) => parseEstimatedTimetable(wrap([call(extra)])).journeys[0].calls[0].delaySec;

  it('attendu - théorique sur l\'arrivée', () => {
    expect(delayOf({ AimedArrivalTime: '2026-11-16T10:00:00Z', ExpectedArrivalTime: '2026-11-16T10:02:05Z' })).toBe(125);
  });
  it('avance négative', () => {
    expect(delayOf({ AimedArrivalTime: '2026-11-16T10:00:30Z', ExpectedArrivalTime: '2026-11-16T10:00:00Z' })).toBe(-30);
  });
  it('repli sur le départ', () => {
    expect(delayOf({ AimedDepartureTime: '2026-11-16T10:00:00Z', ExpectedDepartureTime: '2026-11-16T10:01:00Z' })).toBe(60);
  });
  it('Aimed sans Expected → null', () => {
    expect(delayOf({ AimedArrivalTime: '2026-11-16T10:00:00Z' })).toBeNull();
  });
  it('arrivée sans Aimed → repli sur le départ', () => {
    expect(
      delayOf({
        ExpectedArrivalTime: '2026-11-16T10:02:05Z',
        AimedDepartureTime: '2026-11-16T10:00:00Z',
        ExpectedDepartureTime: '2026-11-16T10:01:00Z',
      }),
    ).toBe(60);
  });
  it('seulement Expected → null', () => {
    expect(delayOf({ ExpectedArrivalTime: '2026-11-16T10:02:05Z' })).toBeNull();
  });
});

describe('mission, numéro de train et longueur', () => {
  const j = (ref: string, extra: Record<string, unknown>) => ({
    LineRef: { value: 'STIF:Line::C01742:' },
    DirectionRef: { value: 'Aller' },
    DatedVehicleJourneyRef: { value: ref },
    DestinationName: [{ value: 'X' }],
    EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:123:' }, ExpectedArrivalTime: '2026-11-16T10:01:00Z' }] },
    ...extra,
  });

  it('course SNCF : mission, numéro et longueur', () => {
    const [a] = parseEstimatedTimetable(
      wrap([j('SNCF_X:VehicleJourney::1:LOC', { JourneyNote: [{ value: 'QIWI' }], VehicleJourneyName: [{ value: 'QIWI60' }], VehicleFeatureRef: ['longTrain'] })]),
    ).journeys;
    expect([a.mission, a.trainNumber, a.length]).toEqual(['QIWI', 'QIWI60', 'long']);
  });

  it('shortTrain → short ; champs absents → null', () => {
    const [a, b] = parseEstimatedTimetable(
      wrap([j('SNCF_X:1', { VehicleFeatureRef: ['shortTrain'] }), j('SNCF_X:2', {})]),
    ).journeys;
    expect(a.length).toBe('short');
    expect([b.mission, b.trainNumber, b.length]).toEqual([null, null, null]);
  });

  it('course RATP : tout null même si les champs sont présents', () => {
    const [a] = parseEstimatedTimetable(
      wrap([j('RATP-SIV:1', { JourneyNote: [{ value: 'QIWI' }], VehicleJourneyName: [{ value: 'QIWI60' }], VehicleFeatureRef: ['shortTrain'] })]),
    ).journeys;
    expect([a.mission, a.trainNumber, a.length]).toEqual([null, null, null]);
  });

  it('fixture : part des courses SNCF avec mission / numéro / longueur', () => {
    const rail = parseEstimatedTimetable(sample).journeys.filter((x) => x.operator === 'SNCF');
    expect(rail.length).toBeGreaterThan(0);
    for (const k of ['mission', 'trainNumber', 'length'] as const) {
      expect(rail.filter((x) => x[k]).length).toBe(rail.length);
    }
  });
});
