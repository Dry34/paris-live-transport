# Task 5 report: quota-safe PRIM poller with persistence and replay

BASE 951d09a7c34ae60c9ccc74093af2c0457b46e035 -> commit 4196f8f (feat: quota-safe PRIM poller with persistence and replay)

## What I built
- `lib/realtime/schedule.ts`: `parisDay`, `inServiceWindow` (Intl, Europe/Paris, handles DST), `nextDelayMs` (null if cap reached or outside the window; otherwise `max(0, lastFetch + min(interval*2^failures, 15min) - now)`, also capped at 15 min).
- `lib/realtime/prim-client.ts`: `PrimError { status }`, `fetchEstimatedTimetable(apiKey)` (`/estimated-timetable?LineRef=ALL`), `fetchDisruptions(apiKey)` (`/disruptions_bulk/disruptions/v2`). Sends the `apikey` and `Accept-Encoding: gzip` headers, uses `no-store`, and times out after 60 s.
- `lib/realtime/store.ts`: `loadBudget`, `recordCall` (resets when the Paris day changes), a `callsToday(dir, kind, now)` helper, `load/saveSnapshot` (`{fetchedAt, journeys, runs}`) and `load/saveDisruptions` (`{fetchedAt, disruptions: Disruption[]}`). Writes are atomic: a tmp file in the same directory, then rename. A corrupt or missing file reads as null or an empty budget.
- `lib/realtime/poller.ts`: `Poller` with injectable `{ now, fetchEt, fetchDisruptions, dir, live }`, plus `start()` (idempotent setTimeout loop, unref'd), `tick()` (one step, returns the delay to the next step; this is how the tests drive it), `snapshot()`, `disruptions()` and `status()`. `getPoller()` returns a singleton on `globalThis.__ltpPoller`. `getNetwork()` reads `public/data/network.json` once per module.
  - Live mode: when started, the poller loads the persisted snapshot as `source:'cache'` and sets lastFetch/lastAttempt = fetchedAt. This means nothing is called while the snapshot is under 100 s old (Review Focus 1). The call is recorded in budget.json BEFORE the fetch, because failed calls also use quota. On success it saves the snapshot (`source:'live'`) and resets failures to 0. On error it increments failures, keeps the old snapshot, and the next delay is 100 s * 2^failures. When the cap is reached or the time is outside the window, it rechecks every 5 min.
  - Replay mode (`!live`, or live without `PRIM_API_KEY`, which logs an error): reads `tests/fixtures/et-sample.json` once, shifts it once by `now - responseTime`, and rebuilds runs every 100 s with buildRuns (previous runs passed in). Makes no network calls and records nothing in the budget.
  - `live = PRIM_LIVE === '1' || NODE_ENV === 'production'`, unless `deps.live` is passed.

## Tests
- `tests/schedule.test.ts` (11): window edges 04:59/05:00/01:29/01:30 in winter, 04:59/05:00 in summer; parisDay across midnight in winter and summer; nextDelayMs cases 0 / 60 000 / 0 (never negative) / 360 000 / 900 000 / null at cap / null outside the window.
- `tests/poller.test.ts` (9), using a temp dir, a counting fake fetchEt and an injected clock:
  - store: budget reset at Paris midnight (23:58/23:59 then 00:01); atomic write leaves only snapshot.json; an empty dir gives a zero budget and a null snapshot.
  - persisted snapshot 30 s old: 0 calls, delay 70 s, snapshot `cache`.
  - two successive pollers on the same dir: callsToday 1 then 2 (budget.json et = 2).
  - 429: 1 call, failures 1, delay 200 s, old snapshot kept (in memory and on disk), lastFetch unchanged; console.error spied on and asserted.
  - cap 900 reached: 0 calls, 5 min. Outside the window: 0 calls, 5 min.
  - replay: no fetchEt/fetchDisruptions call, `source 'replay'`, a run with `stops[1].arr > now`; rebuilt 100 s later (fetchedAt = new clock), budget still 0.

### TDD evidence
RED: `npx vitest run tests/schedule.test.ts` failed with an import error on `@/lib/realtime/schedule` ("Test Files 1 failed, Tests no tests"). `npx vitest run tests/poller.test.ts` failed the same way on the missing modules. Both failures were expected because the modules did not exist yet.
GREEN:
```
npx vitest run tests/poller.test.ts tests/schedule.test.ts
 Test Files  2 passed (2)
      Tests  20 passed (20)
npm test
 Test Files  10 passed (10)
      Tests  71 passed (71)
npx tsc --noEmit  -> OK ; npx eslint lib tests -> OK
```
No live PRIM calls were made and PRIM_LIVE was not set.

## Files
Created: lib/realtime/{schedule,prim-client,store,poller}.ts, tests/{schedule,poller}.test.ts.

## Self-review / concerns
- Disruption polling is NOT wired in, because Task 6 says "brancher le polling des perturbations dans le poller". The `fetchDisruptions` dependency is accepted but not used yet. `disruptions()` returns the persisted disruptions.json (live) or [] (replay). The shape I chose for disruptions.json is `{fetchedAt, disruptions: Disruption[]}`.
- `failures` and the time of the last failed attempt are not persisted. After a restart that follows a failure, if the snapshot is over 100 s old, the poller calls immediately (once per restart). The daily cap of 900 still bounds this. The brief's budget shape `{day, calls}` has no field for it.
- Replay does not trim passed calls. That follows the brief literally ("reconstruit avec le même décalage"). Runs keep their stops in the past, so Task 7's interpolation has to handle runs whose times are all past (the fixture runs out after a while).
- `fetchedAt` = clock time at the start of the call, not the SIRI ResponseTimestamp. This keeps it consistent with the restart rule.
- Extra exports beyond the brief: `getNetwork()` (Task 6 needs the network for departuresForStation), `callsToday()` in store.ts, and `Poller.tick()` (used by the tests).
