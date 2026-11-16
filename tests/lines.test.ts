import { describe, expect, it } from 'vitest';
import { TARGET_LINES, TARGET_LINE_IDS, isTargetLine } from '@/lib/lines';

describe('catalogue des lignes', () => {
  it('contient exactement 38 lignes réparties par mode', () => {
    expect(TARGET_LINES).toHaveLength(38);
    expect(TARGET_LINES.filter((l) => l.mode === 'metro')).toHaveLength(16);
    expect(TARGET_LINES.filter((l) => l.mode === 'rer')).toHaveLength(5);
    expect(TARGET_LINES.filter((l) => l.mode === 'tram')).toHaveLength(15);
    expect(
      TARGET_LINES.filter((l) => l.mode === 'transilien').map((l) => l.id).sort(),
    ).toEqual(['C01739', 'C01740']);
  });

  it('a des identifiants uniques', () => {
    expect(TARGET_LINE_IDS.size).toBe(38);
  });

  it('reconnaît les lignes ciblées', () => {
    expect(isTargetLine('C01742')).toBe(true);
    expect(isTargetLine('C99999')).toBe(false);
  });
});
