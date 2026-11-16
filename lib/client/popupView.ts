// Keeps the train card inside the part of the map the side panel leaves visible.

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** MapLibre popup padding: the panel's inset plus a margin on every side, so the card avoids the panel when placed. */
export function popupPadding(inset: { left: number; bottom: number }, margin: number) {
  return { top: margin, right: margin, bottom: margin + inset.bottom, left: margin + inset.left };
}

/** One axis: how far the view must pan so [lo, hi] fits in [min, max] (aligned on `min` when it is too long). */
function axisPan(lo: number, hi: number, min: number, max: number): number {
  if (lo < min || hi - lo > max - min) return lo - min;
  if (hi > max) return hi - max;
  return 0;
}

/** `map.panBy` offset that brings the card's screen box inside the free area; [0, 0] when it already fits. */
export function panIntoView(box: Box, area: Box): [number, number] {
  return [axisPan(box.left, box.right, area.left, area.right), axisPan(box.top, box.bottom, area.top, area.bottom)];
}
