import { describe, expect, it } from 'vitest';
import { TARGET_LINES, TARGET_LINE_IDS, isTargetLine } from '@/lib/lines';

describe('catalogue des lignes', () => {
  it('contient exactement 45 lignes réparties par mode', () => {
    expect(TARGET_LINES).toHaveLength(45);
    expect(TARGET_LINES.filter((l) => l.mode === 'metro')).toHaveLength(16);
    expect(TARGET_LINES.filter((l) => l.mode === 'rer')).toHaveLength(5);
    expect(TARGET_LINES.filter((l) => l.mode === 'tram')).toHaveLength(15);
    expect(
      TARGET_LINES.filter((l) => l.mode === 'transilien').map((l) => l.id).sort(),
    ).toEqual(['C01730','C01731','C01736','C01737','C01738','C01739','C01740','C01741','C02711']);
  });

  it('a des identifiants uniques', () => {
    expect(TARGET_LINE_IDS.size).toBe(45);
  });

  it('reconnaît les lignes ciblées', () => {
    expect(isTargetLine('C01742')).toBe(true);
    expect(isTargetLine('C99999')).toBe(false);
  });
});
