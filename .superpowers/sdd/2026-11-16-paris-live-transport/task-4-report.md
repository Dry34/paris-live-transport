# Task 4 report: SIRI parsing, vehicle runs, departures

BASE b07643c2225e2fe6c48c0883de464c474a1c372b → HEAD 3e927d982051d104379d7dd3c97e14a1fee9ffa2 (commit `feat: SIRI parsing, vehicle runs, departures`), branch feat/live-map.

## What I built
- `lib/realtime/siri.ts`, `parseEstimatedTimetable(raw)`: follows the path given in the brief. `lineId` comes from `::C\d+:`. Arrival is Expected ?? Aimed, and so is departure. `operator` is RATP or SNCF if `OperatorRef` or `DatedVehicleJourneyRef` contains that string, otherwise OTHER. Only target lines are kept. Calls with no quay or no time at all are dropped, the rest are sorted by `arr ?? dep`, and journeys left with no call are dropped. `responseTime` = `ResponseTimestamp`, or 0. Malformed input never throws and gives `journeys: []`.
  - **Quay id, change made on evidence:** for a `STIF:StopPoint:Q:N:` ref the quay is `N`, as the brief says. SNCF journeys (RER/J/L) use `STIF:StopArea:SP:N:` instead. That maps to the network's quay id `monomodalStopPlace:N`: in the fixture, 657 of 657 calls are found in `public/data/network.json`. Their `ExpectedQuayRef` maps 0 of 657. I map SP to `monomodalStopPlace:N` and only fall back to `ExpectedQuayRef` after that. Without this, every RER/Transilien run was discarded as an unknown quay. There is a test for it.
- `lib/realtime/runs.ts`, `buildRuns(journeys, network, previous, now)`:
  - Matching: SNCF matches on the same `ref` (previous run `id`). Other operators match on the same line, direction and destination, with `calls[0].quay` found in the previous stops within 120 s (time = `arr ?? dep`). The candidate pairs are assigned greedily, smallest time gap first, so each previous run is used at most once. The id is kept on a match. Otherwise it is `ref`, or `lineId:direction:quay0:time0` when `ref` is empty or would duplicate an id already given.
  - Previous station, rule 2: when matched, the last previous stop that disappeared before `calls[0]` keeps its original times and `prevInferred=false`. If nothing disappeared and the previous run had a previous station, that stop and its flag are carried over. Otherwise the previous station is inferred from patterns: `calls[0]` at index > 0, followed by `calls[1]` when it exists. The pattern with the most trips that has the segment wins, and `dep = (arr ?? dep) − seconds×1000`. With no such pattern, `hasPrevious=false`.
  - Rule 3: a run is discarded if `calls[0].quay` is unknown, or if the previous→`calls[0]` segment is missing. That includes the case where candidate patterns exist but none has the segment.
  - Rule 4: a run is discarded if its first call (the earliest, since calls are sorted) is more than 30 min ahead, unless that quay is `quays[0]` of a pattern of the line (a terminus).
- `lib/realtime/departures.ts`, `departuresForStation(snapshot, network, stationId, now, limit=4)`: covers every stop of every run on the station's quays where `dep ?? arr > now`. The key is `lineId|direction`. Each key is sorted and cut to `limit`. An unknown station gives `{}`.

## TDD evidence
RED (before any implementation):
```
$ npx vitest run tests/siri.test.ts tests/runs.test.ts tests/departures.test.ts
Error: Cannot find package '@/lib/realtime/siri' ...   (same for runs, departures)
Test Files  3 failed (3)
```
This was the expected failure: the modules did not exist yet.
GREEN after the implementation: `Test Files 3 passed (3) / Tests 16 passed (16)`.
RED for the SP mapping test, once the network data showed the problem:
```
× mappe ref, direction, ... (expected "monomodalStopPlace:58937", received "474040")
× SNCF (StopArea:SP) → quai réseau monomodalStopPlace ... expected true, received false
Tests 2 failed | 3 passed (5)
```
GREEN: `Tests 17 passed (17)`.
Full suite before the commit: `npx vitest run` gave `Test Files 8 passed (8), Tests 48 passed (48)`. `npx tsc --noEmit` and `npx eslint lib/realtime tests/{siri,runs,departures}.test.ts` printed nothing.

What the tests cover. `siri`: on the fixture, only target lines appear; line 1 journeys are RATP with numeric quays and increasing times; malformed inputs give an empty list; a synthetic journey checks the full field mapping, the operator classes and the dropping of untimed calls and empty journeys; SNCF calls get 100% network coverage. `runs`: every case in the brief (inferred A with `dep = tB − 60000`; matched run keeps its id and A with its original times; terminus start kept even at 45 min; unknown `ZZZ` discarded; two journeys competing for one previous run, only one inherits it), plus SNCF matching by ref, the >30 min discard, a missing segment, no match beyond 120 s or across destinations, and the composite id. `departures`: the case in the brief (2 of 3, sorted, past one excluded), the limit and an unknown station.

Smoke run (scratch script, not committed) on the fixture with the real `network.json`: 222 journeys gave 219 runs; 109 of them have an inferred previous station; rebuilding with those runs as `previous` keeps all 219 ids; 1 journey has an unknown first quay (C01374).

## Files
- Created `lib/realtime/siri.ts`, `lib/realtime/runs.ts`, `lib/realtime/departures.ts`
- Created `tests/siri.test.ts`, `tests/runs.test.ts`, `tests/departures.test.ts`

## Self-review
- The diff reviewed in full. Exported names match the brief. Shared types are used unchanged. No new dependencies.
- The greedy smallest-gap matching is a deliberate choice: the brief leaves the tie-break open, and "first come" would let journey order decide.
- The id-collision fallback keeps run ids unique within a snapshot.

## Concerns
1. **SNCF quay ids differ from the shared context's correspondence note.** Rail lines in the GTFS/network use `monomodalStopPlace:N`, mapped from SIRI `StopArea:SP:N`, not `Q:` quays. I handle this in `siri.ts`. Task 3's `siriQuaysOfTargetLines` only counts `:Q:` refs, so its 98% coverage check silently leaves out all rail calls. Later tasks (7, interpolation) should know that rail "quays" are stop places.
2. **The inference rule is strict about `calls[1]`.** On real data, 47 of 219 runs start mid-pattern but get `hasPrevious=false`, because `calls[1]` does not follow `calls[0]` in any pattern. RATP tram SIRI, for example, gives non-consecutive or opposite-platform quays. Also, 211 of 1487 consecutive call pairs are not network segments. Task 7 may hide or misplace these runs. I followed the brief literally and did not relax the rule.
3. Departures include terminus arrivals (last stop, `dep` null, `arr` used), as the brief specifies `dep ?? arr`. The UI may want to filter these.

---

## Fix round 1

BASE b07643c2225e2fe6c48c0883de464c474a1c372b → HEAD 956a3571baad80eb37aa356051b9f4652e379c49 (fix commit `fix: split non-contiguous SIRI journeys into runs, harden run ids`, on top of 3e927d9).

### Finding 1: real-data runs. Verified as REAL, now fixed
Reproduced with a scratch script (not committed) on `tests/fixtures/et-sample.json` + `public/data/network.json`, using `now = responseTime`, before the fix: 222 journeys gave 219 runs. 47 runs start mid-pattern (not a terminus) with `hasPrevious=false`. 211 of 1487 consecutive stop pairs are not network segments, all of them on RATP lines (metro and tram), none on RER or Transilien.
Root cause, from the raw SIRI: a RATP "journey" often groups passages of several trains. Example: line 3 Retour sorted by time goes Europe 11:03:39 → Porte de Champerret 11:03:54 → Saint-Lazare 11:05:09. These stations are not consecutive and the 15 s gaps are impossible. So the calls do not form one train's path. That made the `calls[1]` inference fail. Task 7's `positionAt` would also return null on every missing segment, so these trains would vanish mid-run.
Fix (`lib/realtime/runs.ts`):
- New `splitAtGaps`. A journey is cut wherever two consecutive calls are not a `network.segments` key. Each contiguous piece goes through the unchanged rules 1-4 as its own run. Piece k>0 gets ref `ref#k`, or the composite id when the ref is empty.
- Rule 3 is applied to the whole journey first, so an unknown first quay still drops the whole journey (the brief's `ZZZ` case). A later piece that starts on an unknown quay is dropped.
After the fix, on the same data: 414 runs. 0 runs are mid-pattern with no previous station (the 40 remaining `hasPrevious=false` all start at a terminus). 0 of 1498 consecutive pairs are non-segments. 414 ids are unique, and rebuilding with these runs as `previous` keeps all 414 ids. Only 1 pair of runs on the same line has its first real call at the same quay within 30 s, so the split adds almost no duplicates. Trade-off: 1563 of 1619 SIRI calls end up in runs, against 1597 before. The 34 calls lost belong to pieces dropped by rule 3 or 4 (unknown quay, missing previous segment, more than 30 min ahead), so `departuresForStation` no longer sees those times.

Minor review items fixed at the same time:
- The id collision is now checked in a loop (`fallbackId#n`). Matched previous ids are reserved before any id is assigned, so an unmatched journey can no longer take a matched run's id.
- The return type of `inheritedPrevious` is narrowed to `Exclude<Previous,'reject'> | null`.
- Patterns are indexed by lineId once per `Network` (a WeakMap), used by `inferredPrevious` and `isTerminus`.
- Added a comment on SNCF `index = -1`, which falls back to inference.
Not changed, and left to the UI as the brief specifies: terminus arrivals in departures, a loop passing the same quay twice, and inference that ignores direction.

### Covering tests (TDD)
Added to `tests/runs.test.ts`:
- `coupe un journey aux paires qui ne sont pas des segments`: [B, D] gives runs `r1` = [A*, B] and `r1#1` = [C*, D], both inferred, with `dep = tD − 60000`, and every stop pair is a segment.
- `un morceau qui commence par un quai inconnu est écarté, le reste est gardé`: [B, ZZZ] gives a single run [A, B].
- `ids des morceaux uniques avec une ref vide`: two distinct composite ids.

RED, before the implementation:
```
$ npx vitest run tests/runs.test.ts
 × coupe un journey aux paires qui ne sont pas des segments ...  AssertionError: expected [ 'r1' ] to deeply equal [ 'r1', 'r1#1' ]
 × un morceau qui commence par un quai inconnu ...                AssertionError: expected [ 'B', 'ZZZ' ] to deeply equal [ 'A', 'B' ]
 × ids des morceaux uniques avec une ref vide                    AssertionError: expected [ 'C01371:Aller:B:1794823230000' ] to deeply equal [ Array(2) ]
 Tests  3 failed | 10 passed (13)
```
GREEN: `npx vitest run tests/runs.test.ts` gave `Tests 13 passed (13)`.

### Finding 2: test results re-run in this round, not copied from the report
```
$ npx vitest run tests/runs.test.ts tests/siri.test.ts tests/departures.test.ts
      Tests  20 passed (20)
$ npx vitest run
 Test Files  8 passed (8)
      Tests  51 passed (51)
$ npx tsc --noEmit && echo TSC_OK
TSC_OK
$ npx eslint lib/realtime tests/siri.test.ts tests/runs.test.ts tests/departures.test.ts && echo ESLINT_OK
ESLINT_OK
```
That is 48 tests from before plus the 3 new ones.

### Files changed
- `lib/realtime/runs.ts`, `tests/runs.test.ts`

### Concerns
- Splitting interprets RATP pseudo-journeys as several trains. Each piece is placed by inferring its previous station. That is plausible but still an estimate, and the number of runs roughly doubles (219 → 414 on the fixture).
- Departures lose the times of dropped pieces (34 of 1619 calls on the fixture).
