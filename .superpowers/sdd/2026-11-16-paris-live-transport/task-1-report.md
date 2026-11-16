# Task 1 report
BASE f4e4cbda61bf10bd5db297694dd4447e578c8602, HEAD 44ca1b065c4c40f48ff02a8aea1c3847f74202b5

## Built
Next.js 15.5 scaffold (scaffolded in a temp dir, copied in; README/docs/.gitignore preserved, .gitignore merged; the scaffold's blanket `.env*` rule removed so `.env.example` is tracked while `.env*.local` stays ignored). Deps: maplibre-gl, yauzl, csv-parse; dev: vitest, tsx, @types/yauzl. @types/node bumped to ^22 (vitest 5 peer conflict with ^20). npm scripts test/build:data/fixture added. vitest.config.ts with `@` alias. lib/types.ts (verbatim), lib/lines.ts, scripts/make-fixture.ts, tests/lines.test.ts, fixture, .env.example, README.

## TDD
RED: `npx vitest run tests/lines.test.ts` -> `Error: Cannot find package '@/lib/lines'`, Test Files 1 failed (module absent, expected).
GREEN: same command -> 1 file passed, 3 tests passed.
Full: `npm run build` OK; `npm test` 3/3 passing.

## Fixture
Brief says <1 Mo with max 12 journeys/line; 12 gave 1.67 MB, so cap lowered to 6 journeys/line -> 837 KB, 38 lines present incl. C01371, C01743, C01739, C01740 (verified).

## Concerns
- Fixture cap 6 rather than 12 (size constraint).
- .env.local untouched, not committed, key never printed.
- build:data script (scripts/build-data.ts) does not exist yet (later task).
- app/ is the default create-next-app page; later tasks replace it.

## Fix round 1

Finding: build and test results not independently verified.
Changes: none to code (finding was verification only).
Command: `npm test` -> vitest: 1 file passed, 3 tests passed (3/3).
Command: `npm run build` -> Next build succeeded, 5/5 static pages, routes / and /_not-found prerendered.
