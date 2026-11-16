
# Task 2 report: geometry helpers
Built lib/geo.ts (distanceM, cumulativeLengths, projectOnLine, sliceLine, pointAtFraction) and tests/geo.test.ts (6 tests).
RED: `npx vitest run tests/geo.test.ts` failed (module ../lib/geo missing, no tests ran).
GREEN: same command, 6/6 passed. Full suite and `tsc --noEmit` clean. Commit: feat: geometry helpers.
Projection uses a local equirectangular frame per segment, clamped to the segment; slice clamps to line bounds and reverses when from > to; empty line throws in pointAtFraction.
Concerns: none (vitest config prints an unrelated ESM warning from Task 1).

## Fix round 1

Finding: RED/GREEN and tsc results were not independently verified by the reviewer.
Changes: none to code needed; re-ran verification (finding not a real defect).
Command: `npx vitest run tests/geo.test.ts` and `npx tsc --noEmit`
Output: Test Files 1 passed (1); Tests 6 passed (6); tsc exit 0, no errors.
