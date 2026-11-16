import type { Mode } from './types';

const ids = (mode: Mode, list: string): { id: string; mode: Mode }[] =>
  list.split(' ').map((id) => ({ id, mode }));

export const TARGET_LINES: { id: string; mode: Mode }[] = [
  ...ids('metro', 'C01371 C01372 C01373 C01386 C01374 C01375 C01376 C01377 C01387 C01378 C01379 C01380 C01381 C01382 C01383 C01384'),
  ...ids('rer', 'C01742 C01743 C01727 C01728 C01729'),
  ...ids('tram', 'C01389 C01390 C01391 C01679 C01843 C01684 C01794 C01774 C01795 C02317 C02528 C01999 C02529 C02344 C02732'),
  ...ids('transilien', 'C01739 C01740'),
];

export const TARGET_LINE_IDS: Set<string> = new Set(TARGET_LINES.map((l) => l.id));

export function isTargetLine(id: string): boolean {
  return TARGET_LINE_IDS.has(id);
}
