# Task 3 report: Static network from IDFM GTFS

Status: DONE
BASE 65652025e0f5bb5ec18a5e98371c0296234379fd → HEAD 92d64dd45934bba8c0e48cb627e7c213d7fde270 (`feat: build static network from IDFM GTFS`)

## What I built
- `lib/static/gtfs-build.ts` (pure functions):
  - exported types `GtfsTrip`, `GtfsStopTime`, `GtfsStop`
  - `buildPatterns` groups trips by (route, direction, exact quay sequence ordered by stop_sequence). It records the trip count and the most frequent headsign, and drops patterns with less than 2 % of their line+direction's trips. A pattern at exactly 2 % is kept.
  - `buildSegments`:
    - projects A onto the shape, then projects B only onto the part of the shape after A (`sliceLine(shape, alongA, total)`), then `coords = sliceLine(shape, alongA, alongA+alongB)`.
    - draws a straight `[A,B]` when A or B is more than 150 m from the shape or the shape is missing.
    - `seconds` = median of runtimes (arrival B − departure A), or distance / 10 m/s when there is none.
    - When several patterns share a key, the pattern with the most trips wins, and a later pattern only replaces a straight fallback.
  - `buildStations`: `stationId` = `parent_station` without `IDFM:` (or the quay itself). Name and coordinates come from the parent stop. `lines` is sorted.
  - helpers: `stripIdfm`, `gtfsTimeToSeconds`, `groupStopTimes`, `patternKey`, `computeRuntimes`/`addTripRuntimes`, `simplifyLine` (Douglas-Peucker, tolerance in metres).
- `scripts/build-data.ts`:
  - downloads to `.cache/gtfs.zip`, reusing it if it is less than 24 h old (written as `.part` then renamed).
  - streams the zip entries with yauzl + csv-parse: routes → trips (38 lines) → stop_times filtered by trip_id → shapes filtered by the shape_ids in use (shape of a pattern = most frequent shape_id of its trips) → stops.
  - writes `public/data/network.json`: coordinates rounded to 5 decimals, seconds rounded, `lines[id].shapes` = distinct pattern shapes simplified at 5 m, colors `#RRGGBB` from routes.txt.
  - Run: 72 s, peak RSS 660 MB. stop_times: 8.36 M rows streamed, about 1.7 M kept in memory.
- Fixture `tests/fixtures/gtfs-mini/` (following the ruling):
  - 1 line `IDFM:C01371`, quays A–D with parents S1–S4, straight shapes SH0/SH1.
  - direction 0: 50 trips A→B→C→D plus 1 rare trip A→B→C (1/51 < 2 %).
  - direction 1: 10 trips D→C→B→A, one of them with headsign "Autre".
  - A→B runtimes cycle through 60/70/80 s (median 70).

## TDD evidence
- RED: `npx vitest run tests/gtfs-build.test.ts` → `FAIL tests/gtfs-build.test.ts ... Error: Cannot find module '../lib/static/gtfs-build'`. Expected, because the module did not exist yet.
- GREEN: same command → `Test Files 1 passed (1) / Tests 12 passed (12)`.
- Full suite before commit: `npm test` → `Test Files 3 passed (3) / Tests 21 passed (21)`. `npx tsc --noEmit` and eslint on the new files are clean. The only output is a vite configLoader warning that was already there (vitest.config.ts, not my change).

## Tests (tests/gtfs-build.test.ts, 12)
- patterns: 2 patterns, ABCD/DCBA, trips 50/10, rare one absent; most frequent headsign; 2 % boundary kept.
- segments: 6 keys; runtimes A>B has 51 values, seconds 70, B>C 90; coords start at A and end at B within 1 m (and the same for B>A); quay 300 m away → 2 coords plus distance/10 s; missing shape → 2 coords; loop shape → B is searched after A.
- stations: S1 contains A, lines `['C01371']`, quay shape; a quay with no parent becomes its own station.
- simplifyLine: drops a point within 5 m and keeps corners.

## Step 6 verification (scratch script on the generated network.json)
```
OK   38 lignes (38)
OK   chaque ligne a >= 2 patterns
OK   ligne 1 : 25 stations (25)
OK   RER A >= 4 patterns/direction (9 / 7)
OK   J (23) et L (21) ont des patterns
OK   fallback droit 5/2039 = 0.25 %
OK   taille 2.07 Mo
OK   quays SIRI couverts 605/607 (99.67 %) manquants: C01374 483279, C01383 22239
```
Totals: 272 patterns, 832 stations, 1672 quays, 2039 segments. Segment seconds: min 36 / median 100 / max 1110.

## Files
lib/static/gtfs-build.ts, scripts/build-data.ts, tests/gtfs-build.test.ts, tests/fixtures/gtfs-mini/{routes,stops,shapes,trips,stop_times}.txt, public/data/network.json

## Self-review / concerns
- In the script, the pattern key used to assign shapes is built inline (`lineId|directionId|quays`) rather than with `patternKey` (which uses the raw direction_id string). Both give the same result for the "0"/"1" direction values in the IDFM data. This is minor duplication.
- Segment keys `A>B` are shared across lines. That is safe because IDFM quays are per line and mode, but a quay pair used by two lines would share one geometry.
- Segment polylines are rounded but not simplified (only `lines[].shapes` are simplified, as the brief says). The file is 2.07 MB, well under 8 MB.
- The 2 SIRI quays missing from the network (483279 on line 5, 22239 on line 13) are presumably absent from the current GTFS or only on dropped rare patterns. Task 4/7 will hide those trains, as the review focus requires.

---

## Fix round 1

HEAD before fix: 92d64dd45934bba8c0e48cb627e7c213d7fde270 → fix commit f156b659bb1e118ea62dc3ca8ae0402285061718 (`fix: test GTFS download/cache path, commit Step 6 network checks`). Task range: BASE 65652025e0f5bb5ec18a5e98371c0296234379fd.

### Finding 1: GTFS download and 24 h cache path had no tests and was not re-run
Verified. Reading the old code turned up two real gaps:
- an empty or truncated `.cache/gtfs.zip` younger than 24 h was reused;
- a download that failed midway left `.cache/gtfs.zip.part` behind.

Changes:
- New `lib/static/gtfs-download.ts`: `ensureGtfsZip({ zipPath, url, maxAgeMs, force?, fetchFn?, now? }) → 'cache' | 'downloaded'`.
  - It reuses the cache only when the file is non-empty and younger than `maxAgeMs`.
  - Otherwise it streams the download to `.part` and renames it. On a stream error it deletes `.part`. On an HTTP error it throws and leaves the previous zip untouched.
- `scripts/build-data.ts` now calls it. It adds a `--force` flag (`npm run build:data -- --force`) and logs either cache reuse or download time and size.
- New `tests/gtfs-download.test.ts` (7 tests: fake fetch, temporary directory) covers:
  - no cache → download, and the directory is created
  - fresh cache → no fetch
  - cache older than 24 h → re-download
  - empty cache → re-download
  - `force`
  - HTTP 503 → throws, old zip kept, no `.part`
  - stream failure midway → no zip and no `.part`

TDD:
- RED: `npx vitest run tests/gtfs-download.test.ts` → `FAIL ... Error: Cannot find module '../lib/static/gtfs-download'`
- GREEN: same command → `Test Files 1 passed (1) / Tests 7 passed (7)`

Real end-to-end re-run against the live IDFM URL:
```
$ /usr/bin/time -l npm run build:data -- --force
Téléchargement forcé https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip
GTFS téléchargé en 17 s (112.5 Mo)
  routes.txt : 2026 lignes lues
  trips.txt : 383355 lignes lues
  stop_times.txt : 8356903 lignes lues
  shapes.txt : 3469687 lignes lues
  stops.txt : 53436 lignes lues
network.json : 38 lignes, 272 patterns, 832 stations, 1672 quais, 2039 segments, 2.07 Mo
       93,55 real   ...   710557696  maximum resident set size
$ npm run build:data          # immediately after
GTFS en cache (< 24 h), pas de téléchargement
network.json : 38 lignes, 272 patterns, 832 stations, 1672 quais, 2039 segments, 2.07 Mo
```
The zip's mtime and size were unchanged by the second run (`Nov 16 12:24:56 2026 112524223`). The regenerated network.json is byte-identical to the committed one apart from `generatedAt` (checked with a JSON compare), so I restored the committed file and did not recommit the JSON.

### Finding 2: the Step 6 claims rested on an uncommitted scratch script
Verified and made reproducible:
- New `lib/static/network-checks.ts` holds `checkNetwork(net, sizeBytes, etSample)` and `siriQuaysOfTargetLines(et)`.
- New `scripts/check-data.ts` runs it (`npm run check:data`, script added to package.json).
- It checks the following:
  - the Step 6 list: 38 target lines, ≥ 2 patterns per line, line 1 = 25 stations, RER A ≥ 4 patterns per direction, J and L have patterns, straight fallback < 5 %, size < 8 MB, SIRI quay coverage ≥ 98 %
  - the reviewer's structural invariants: every consecutive pattern pair has a segment, every pattern quay exists, and no segment has fewer than 2 coords or seconds ≤ 0
- New `tests/network-checks.test.ts` (3 tests):
  - the committed network.json passes every check (so the claims now run in `npm test`);
  - a deliberately broken network fails the line-count, RER A, completeness and size checks;
  - SIRI extraction keeps only target lines.
- These tests were written right after the check module, not before it. It is a verification utility, not a behaviour change.

Output on the freshly downloaded GTFS:
```
$ npm run check:data
OK   38 lignes (attendu 38)
OK   chaque ligne a >= 2 patterns
OK   ligne 1 : 25 stations (attendu 25)
OK   RER A >= 4 patterns/direction (9 / 7)
OK   J (23) et L (21) ont des patterns
OK   fallback droit 5/2039 = 0.25 % (< 5 %)
OK   patterns complets (segments manquants 0, quays manquants 0)
OK   segments valides (>= 2 coords, seconds > 0) : 0 invalides
OK   taille 2.07 Mo (< 8 Mo)
OK   quays SIRI couverts 605/607 (99.67 %) manquants: C01374 483279, C01383 22239
```
This matches the original report's figures exactly.

### Full verification before commit
- `npm test` → `Test Files 5 passed (5) / Tests 31 passed (31)`
- `npx tsc --noEmit` → clean
- `npx eslint` on all new and changed files → clean
- `scripts/make-fixture.ts` (Task 1) has 4 `no-explicit-any` lint errors. They were already there before this round (checked with git stash) and are untouched.

### Files changed
lib/static/gtfs-download.ts (new), lib/static/network-checks.ts (new), scripts/check-data.ts (new), tests/gtfs-download.test.ts (new), tests/network-checks.test.ts (new), scripts/build-data.ts, package.json

### Concerns
- `tests/network-checks.test.ts` checks the committed network.json. A future GTFS refresh that breaks an invariant (for example line 1 ≠ 25 stations) will fail `npm test`. This is intended.
- The minor review notes (inline pattern key vs `patternKey`, the `s >= 0` runtime, the per-segment cumulative length) were outside this round's findings and were left as they are.
