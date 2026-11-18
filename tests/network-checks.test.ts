import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Network } from '../lib/types';
import { checkNetwork, siriQuaysOfTargetLines } from '../lib/static/network-checks';

const NET = path.join(__dirname, '../public/data/network.json');
const net = JSON.parse(readFileSync(NET, 'utf8')) as Network;
const et = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/et-sample.json'), 'utf8'));

describe('committed network.json (Task 3 Step 6 invariants)', () => {
  it('passes every check', () => {
    const failed = checkNetwork(net, statSync(NET).size, et).filter((c) => !c.ok);
    expect(failed).toEqual([]);
  });
});

describe('checkNetwork', () => {
  it('flags a broken network', () => {
    const broken: Network = {
      ...net,
      lines: Object.fromEntries(Object.entries(net.lines).slice(1)),
      patterns: net.patterns.filter((p) => p.lineId !== 'C01742'),
      segments: {},
    };
    const failed = checkNetwork(broken, 9e6, et).filter((c) => !c.ok).map((c) => c.label);
    expect(failed.some((l) => l.includes('lignes'))).toBe(true);
    expect(failed.some((l) => l.startsWith('RER A'))).toBe(true);
    expect(failed.some((l) => l.startsWith('patterns complets'))).toBe(true);
    expect(failed.some((l) => l.startsWith('taille'))).toBe(true);
  });

  it('extracts line+quay pairs of target lines only from SIRI', () => {
    const sample = {
      Siri: { ServiceDelivery: { EstimatedTimetableDelivery: [{ EstimatedJourneyVersionFrame: [{ EstimatedVehicleJourney: [
        { LineRef: { value: 'STIF:Line::C01371:' }, EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:22083:' } }] } },
        { LineRef: { value: 'STIF:Line::C99999:' }, EstimatedCalls: { EstimatedCall: [{ StopPointRef: { value: 'STIF:StopPoint:Q:1:' } }] } },
      ] }] }] } },
    };
    expect([...siriQuaysOfTargetLines(sample)]).toEqual(['C01371 22083']);
  });
});
