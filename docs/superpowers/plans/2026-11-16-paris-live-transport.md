# Live Transport Paris Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carte temps réel des rames Métro / RER / Tram / Transilien J-L de Paris, animées entre les stations à partir des prochains passages PRIM.

**Architecture:** Un script hors-ligne transforme le GTFS IDFM en un fichier réseau compact (lignes, quais, stations, séquences d'arrêts, géométrie + temps de parcours entre deux quais consécutifs). Un poller singleton dans le serveur Next.js interroge PRIM (`estimated-timetable` toutes les 100 s, `disruptions_bulk` toutes les 5 min) dans un budget d'appels persisté, et expose des parcours de rames via `/api/*`. Le navigateur interpole la position de chaque rame à chaque frame le long de la géométrie.

**Tech Stack:** Next.js 15 (App Router, TypeScript strict), MapLibre GL JS 4, Vitest, tsx (scripts), yauzl + csv-parse (streaming GTFS). Node ≥ 20.

**Spec:** `docs/superpowers/specs/2026-11-16-paris-live-transport-design.md`

## Global Constraints

- Lignes ciblées (IDs IDFM, exactement 38) : Métro C01371 C01372 C01373 C01386 C01374 C01375 C01376 C01377 C01387 C01378 C01379 C01380 C01381 C01382 C01383 C01384 ; RER C01742 C01743 C01727 C01728 C01729 ; Tram C01389 C01390 C01391 C01679 C01843 C01684 C01794 C01774 C01795 C02317 C02528 C01999 C02529 C02344 C02732 ; Transilien C01739 C01740.
- Correspondance d'IDs (vérifiée) : SIRI `STIF:StopPoint:Q:22083:` ↔ GTFS `IDFM:22083` ↔ `quayId = "22083"`. SIRI `STIF:Line::C01371:` ↔ GTFS `IDFM:C01371` ↔ `lineId = "C01371"`.
- PRIM : base `https://prim.iledefrance-mobilites.fr/marketplace`, header `apikey: $PRIM_API_KEY`, `Accept-Encoding: gzip`. Quota 1 000/jour/endpoint.
- `estimated-timetable?LineRef=ALL` toutes les **100 s**, fenêtre **05:00–01:30 Europe/Paris**, plafond dur **900 appels/jour** (jour calendaire Europe/Paris). `disruptions_bulk/disruptions/v2` toutes les **5 min**, même fenêtre, même plafond.
- Backoff sur erreur/429 : `100 s × 2^échecs`, max 15 min ; on garde le dernier instantané.
- Persistance dans `.cache/` (gitignoré) : `snapshot.json`, `disruptions.json`, `budget.json`.
- Mode replay par défaut en dev ; `PRIM_LIVE=1` pour les vrais appels. La clé n'est lue que côté serveur (`process.env.PRIM_API_KEY`), jamais préfixée `NEXT_PUBLIC_`.
- Interface en français. Couleurs officielles depuis `routes.txt` (`route_color`, `route_text_color`).
- Une rame dont la position est incohérente est masquée, jamais placée hors tracé.

## Review Focus

1. **Redémarrages répétés du serveur** (hot reload, crash) : aucun appel PRIM tant que le dernier instantané persisté a moins de 100 s, et le compteur du jour survit au redémarrage → test dans Task 5.
2. **Nouvel instantané qui « recule » une rame** de quelques secondes : la rame affichée ne recule pas visiblement sur le même tronçon → test dans Task 7.
3. **Rame à son premier arrêt (terminus de départ)** sans station précédente : elle reste au quai jusqu'à son départ, pas masquée, pas inventée → test dans Task 4.
4. **Arrêt SIRI inconnu du réseau statique** (quai neuf, données incomplètes) : la rame est masquée, pas de crash → tests dans Task 4 et Task 7.
5. **Passage de minuit / changement de jour Paris** : fenêtre de service 05:00–01:30 et remise à zéro du budget à minuit Europe/Paris, y compris en heure d'été/hiver → test dans Task 5.

---

## File Structure

```
lib/
  lines.ts                  catalogue des 38 lignes ciblées (id, mode)
  types.ts                  types partagés (Network, VehicleRun, Snapshot, Disruption…)
  geo.ts                    géométrie : distance, projection sur polyligne, découpe, point à une fraction
  static/gtfs-build.ts      fonctions pures : patterns, segments, stations depuis des lignes GTFS
  realtime/siri.ts          parsing estimated-timetable → journeys filtrés
  realtime/runs.ts          construction des VehicleRun (station précédente, appariement)
  realtime/departures.ts    prochains passages d'une station
  realtime/schedule.ts      fenêtre de service, budget, backoff (pur)
  realtime/prim-client.ts   fetch PRIM
  realtime/store.ts         persistance .cache/
  realtime/poller.ts        singleton globalThis, orchestration
  realtime/disruptions.ts   parsing + filtrage disruptions_bulk
  client/interpolate.ts     position d'une rame à l'instant t + garde anti-recul
scripts/build-data.ts       télécharge le GTFS et écrit public/data/network.json
scripts/make-fixture.ts     réduit une réponse PRIM brute à nos lignes
app/
  page.tsx                  carte principale
  lignes/[id]/page.tsx      page ligne
  api/vehicles/route.ts
  api/stops/[id]/route.ts
  api/disruptions/route.ts
components/                 Map, VehicleLayer, SidePanel, StationPanel, VehiclePopup, LineDiagram
tests/                      *.test.ts + fixtures/
```

## Shared types (`lib/types.ts`, créé en Task 1, utilisés partout)

```ts
export type Mode = 'metro' | 'rer' | 'tram' | 'transilien';
export type LngLat = [number, number];

export interface LineInfo { id: string; shortName: string; mode: Mode; color: string; textColor: string; longName: string }
export interface Quay { id: string; name: string; lon: number; lat: number; stationId: string }
export interface Station { id: string; name: string; lon: number; lat: number; quays: string[]; lines: string[] }
export interface Pattern { lineId: string; directionId: 0 | 1; quays: string[]; trips: number; headsign: string }
export interface Segment { coords: LngLat[]; seconds: number }           // clé "A>B" (quayIds)
export interface Network {
  generatedAt: string;
  lines: Record<string, LineInfo & { shapes: LngLat[][] }>;
  quays: Record<string, Quay>;
  stations: Record<string, Station>;
  patterns: Pattern[];
  segments: Record<string, Segment>;
}

export interface Journey {          // sortie du parsing SIRI
  ref: string; lineId: string; direction: string; destination: string; operator: 'RATP' | 'SNCF' | 'OTHER';
  calls: { quay: string; arr: number | null; dep: number | null }[];   // epoch ms
}
export interface RunStop { quay: string; arr: number | null; dep: number | null }
export interface VehicleRun {
  id: string; lineId: string; direction: string; destination: string;
  stops: RunStop[];                  // stops[0] = station précédente si connue
  hasPrevious: boolean; prevInferred: boolean;
}
export interface Snapshot { fetchedAt: number; source: 'live' | 'replay' | 'cache'; runs: VehicleRun[] }
export interface Departure { lineId: string; destination: string; direction: string; time: number; runId: string }
export interface Disruption { id: string; lineIds: string[]; title: string; message: string; severity: string; periods: { begin: number; end: number }[] }
```

---

### Task 1: Projet Next.js, outillage, catalogue des lignes, fixture

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.env.example`, `lib/types.ts`, `lib/lines.ts`, `scripts/make-fixture.ts`, `tests/fixtures/et-sample.json`, `tests/lines.test.ts`
- Modify: `README.md`, `.gitignore` (déjà : `.env*.local`, `.cache/`, `node_modules/`, `.next/`)

**Interfaces:**
- Produces: `TARGET_LINES: { id: string; mode: Mode }[]`, `TARGET_LINE_IDS: Set<string>`, `isTargetLine(id: string): boolean` dans `lib/lines.ts` ; tous les types de `lib/types.ts`.

- [ ] **Step 1:** `npx create-next-app@15 . --ts --app --eslint --no-tailwind --src-dir=false --import-alias "@/*" --use-npm` (garder README/docs/.gitignore existants), puis `npm i maplibre-gl yauzl csv-parse` et `npm i -D vitest tsx @types/yauzl`. Scripts npm : `test: vitest run`, `build:data: tsx scripts/build-data.ts`, `fixture: tsx scripts/make-fixture.ts`.
- [ ] **Step 2: Test qui échoue** `tests/lines.test.ts` :
```ts
expect(TARGET_LINES).toHaveLength(38);
expect(TARGET_LINES.filter(l => l.mode === 'metro')).toHaveLength(16);
expect(TARGET_LINES.filter(l => l.mode === 'rer')).toHaveLength(5);
expect(TARGET_LINES.filter(l => l.mode === 'tram')).toHaveLength(15);
expect(TARGET_LINES.filter(l => l.mode === 'transilien').map(l => l.id).sort()).toEqual(['C01739', 'C01740']);
expect(isTargetLine('C01742')).toBe(true); expect(isTargetLine('C99999')).toBe(false);
```
- [ ] **Step 3:** `npx vitest run tests/lines.test.ts` → FAIL (module absent).
- [ ] **Step 4:** Écrire `lib/types.ts` (bloc ci-dessus) et `lib/lines.ts` (IDs de Global Constraints).
- [ ] **Step 5:** `npx vitest run tests/lines.test.ts` → PASS.
- [ ] **Step 6:** `scripts/make-fixture.ts <raw.json> <out.json>` : garde la structure SIRI mais seulement les `EstimatedVehicleJourney` dont `LineRef` est ciblé, et au plus 12 trajets par ligne. Lancer sur la réponse brute déjà téléchargée `/private/tmp/claude-501/-Users-thibauttavernier-Documents-Dry34-paris-live-transport/d7b19407-eb09-4824-a68f-85d7e00a0a93/scratchpad/prim/et.json` (si absente : un appel `curl` à PRIM avec la clé de `.env.local`) → `tests/fixtures/et-sample.json`. Vérifier : fichier < 1 Mo, contient C01371, C01743, C01739, C01740.
- [ ] **Step 7:** `.env.example` avec `PRIM_API_KEY=` et `PRIM_LIVE=0`. Créer `.env.local` avec la clé fournie par l'utilisateur (le contrôleur la donne ; ne jamais la commiter). README : comment lancer (`npm i`, `npm run build:data`, `npm run dev`, `PRIM_LIVE=1 npm run dev`).
- [ ] **Step 8:** `npm run build && npm test` → OK. Commit `chore: scaffold Next.js, line catalogue, PRIM fixture`.

### Task 2: Géométrie

**Files:** Create `lib/geo.ts`, `tests/geo.test.ts`

**Interfaces:**
- Produces:
  - `distanceM(a: LngLat, b: LngLat): number` (haversine)
  - `cumulativeLengths(line: LngLat[]): number[]`
  - `projectOnLine(line: LngLat[], p: LngLat, cum?: number[]): { along: number; dist: number }` (point le plus proche, `along` en mètres depuis le début)
  - `sliceLine(line: LngLat[], fromAlong: number, toAlong: number): LngLat[]` (si `from > to`, renvoie la portion inversée)
  - `pointAtFraction(line: LngLat[], f: number): LngLat` (f borné à [0,1], par longueur)

- [ ] **Step 1: Tests qui échouent** :
  - `distanceM([2.35,48.85],[2.36,48.85])` ≈ 732 m (±5).
  - Ligne en L `[[0,0],[0,0.01],[0.01,0.01]]` (en degrés près de l'équateur) : `projectOnLine(L,[0.0001,0.005]).along` ≈ 556 m (±5), `dist` ≈ 11 m (±2).
  - `sliceLine(L, 556, 1668)` commence près de `[0,0.005]`, contient `[0,0.01]`, finit près de `[0.005,0.01]` ; `sliceLine(L,1668,556)` = la même inversée.
  - `pointAtFraction(L,0.5)` ≈ `[0,0.01]` ; `pointAtFraction(L,-1)` = `[0,0]` ; `pointAtFraction(L,2)` = `[0.01,0.01]` ; ligne à un point → ce point.
- [ ] **Step 2:** `npx vitest run tests/geo.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter dans `lib/geo.ts`.
- [ ] **Step 4:** → PASS. Commit `feat: geometry helpers`.

### Task 3: Construction du réseau statique depuis le GTFS

**Files:** Create `lib/static/gtfs-build.ts`, `scripts/build-data.ts`, `tests/gtfs-build.test.ts`, `tests/fixtures/gtfs-mini/*.txt` ; génère `public/data/network.json` (commité).

**Interfaces:**
- Consumes: `lib/geo.ts`, `TARGET_LINE_IDS`.
- Produces (fonctions pures, entrées = lignes CSV déjà parsées en objets) :
  - `buildPatterns(trips: GtfsTrip[], stopTimesByTrip: Map<string, GtfsStopTime[]>): Pattern[]` — groupe par (route, direction, séquence exacte de quays) ; `trips` = nombre de trajets ; `headsign` le plus fréquent ; supprime les patterns représentant < 2 % des trajets de leur ligne+direction.
  - `buildSegments(patterns: Pattern[], quays: Record<string, Quay>, shapeOfPattern: Map<Pattern, LngLat[]>, runtimes: Map<string, number[]>): Record<string, Segment>` — pour chaque paire consécutive `A>B` : projeter A puis B sur la shape en imposant `alongB ≥ alongA` (chercher la projection de B uniquement après `alongA`), `coords = sliceLine(...)` ; si `dist` de A ou B > 150 m ou shape absente → `coords = [A, B]` ; `seconds = médiane(runtimes.get("A>B"))` (arrivée B − départ A), à défaut `distance / 10 m/s`.
  - `buildStations(stops: GtfsStop[], usedQuays: Set<string>, patterns: Pattern[]): { quays; stations }` — `stationId` = `parent_station` sans préfixe `IDFM:` (sinon le quay lui-même) ; `lines` = lignes dont un pattern passe par un quai de la station.
  - Types `GtfsTrip { trip_id; route_id; direction_id; shape_id; trip_headsign }`, `GtfsStopTime { trip_id; stop_id; stop_sequence; arrival_time; departure_time }`, `GtfsStop { stop_id; stop_name; stop_lat; stop_lon; parent_station }` exportés.
- `scripts/build-data.ts` : télécharge `https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip` dans `.cache/gtfs.zip` (réutilisé s'il a < 24 h), lit en **streaming** (yauzl + csv-parse ; `stop_times.txt` fait ~680 Mo et `shapes.txt` ~130 Mo décompressés, ne jamais les charger en entier) : `routes` → lignes ciblées, `trips` filtrés, `stop_times` filtrés par trip_id, `shapes` filtrés par shape_id utilisés (shape du pattern = shape_id le plus fréquent de ses trajets), `stops`. Écrit `public/data/network.json` avec coordonnées arrondies à 5 décimales et shapes de lignes (`lines[id].shapes` = shapes distinctes des patterns, simplifiées Douglas-Peucker ~5 m).

- [ ] **Step 1:** Fixture `tests/fixtures/gtfs-mini/` : une ligne `IDFM:C01371`, 4 quais A B C D (parents S1..S4) sur une shape droite, 10 trajets direction 0 A→B→C→D, 10 direction 1 D→C→B→A, 1 trajet direction 0 A→B→C (pattern rare < 2 % → doit être supprimé si 50 trajets ; ajuster pour que le test le prouve), runtimes A→B de 60, 70, 80 s.
- [ ] **Step 2: Tests qui échouent** :
  - `buildPatterns` → 2 patterns, `quays` `['A','B','C','D']` / `['D','C','B','A']`, `trips` 10 ; le pattern rare est absent.
  - `buildSegments` → `segments['A>B'].seconds === 70` ; `segments['A>B'].coords[0]` ≈ coordonnées de A (±1 m) ; un quay à 300 m de la shape → `coords.length === 2`.
  - `buildStations` → `stations['S1'].quays` contient `'A'`, `stations['S1'].lines` = `['C01371']`.
- [ ] **Step 3:** → FAIL. **Step 4:** Implémenter `lib/static/gtfs-build.ts`. **Step 5:** → PASS.
- [ ] **Step 6:** Écrire `scripts/build-data.ts` et lancer `npm run build:data`. Vérifier par un petit script : 38 lignes, chaque ligne a ≥ 2 patterns, ligne 1 a 25 stations, RER A a ≥ 4 patterns par direction (branches), J et L ont des patterns, < 5 % des segments en fallback droit, `network.json` < 8 Mo. Tous les quays présents dans `tests/fixtures/et-sample.json` pour nos lignes existent dans `network.quays` à ≥ 98 % (afficher les manquants).
- [ ] **Step 7:** Commit `feat: build static network from IDFM GTFS` (inclure `public/data/network.json`).

### Task 4: Parsing SIRI et construction des parcours

**Files:** Create `lib/realtime/siri.ts`, `lib/realtime/runs.ts`, `lib/realtime/departures.ts`, `tests/siri.test.ts`, `tests/runs.test.ts`, `tests/departures.test.ts`

**Interfaces:**
- Consumes: types, `isTargetLine`, `Network`.
- Produces:
  - `parseEstimatedTimetable(raw: unknown): { responseTime: number; journeys: Journey[] }` — chemin `Siri.ServiceDelivery.EstimatedTimetableDelivery[0].EstimatedJourneyVersionFrame[].EstimatedVehicleJourney[]` ; `lineId` extrait de `STIF:Line::C01371:` ; `quay` de `STIF:StopPoint:Q:22083:` ; `arr = Expected ?? Aimed Arrival`, `dep = Expected ?? Aimed Departure` ; `operator` = 'RATP' si `OperatorRef` ou `DatedVehicleJourneyRef` contient `RATP`, 'SNCF' si `SNCF`, sinon 'OTHER' ; ne garde que les lignes ciblées ; calls triés par temps ; journeys sans call ignorés ; `responseTime` = `ServiceDelivery.ResponseTimestamp`.
  - `buildRuns(journeys: Journey[], network: Network, previous: VehicleRun[] | null, now: number): VehicleRun[]`
  - `departuresForStation(snapshot: Snapshot, network: Network, stationId: string, now: number, limit = 4): Record<string, Departure[]>` — clé `lineId|direction` ; heures `dep ?? arr` > now ; triés ; `limit` par clé.

Règles de `buildRuns` (algorithme non déterminé par les tests seuls) :
1. Appariement à l'instantané précédent : SNCF → même `ref`. Sinon → même `lineId`, `direction`, `destination`, et le premier quay du journey figure dans les stops du run précédent avec un écart de temps ≤ 120 s. Un run précédent ne s'apparie qu'une fois. Le `id` du run est conservé si apparié, sinon `ref` (ou `lineId:direction:quay0:time0` si `ref` vide).
2. Station précédente : si apparié et que des stops du run précédent ont disparu avant le premier call actuel → le dernier disparu (avec ses heures) devient `stops[0]`, `hasPrevious = true`, `prevInferred = false`. Sinon chercher un pattern de la ligne où `calls[0].quay` apparaît à l'index > 0 et, si `calls[1]` existe, est suivi de `calls[1].quay` ; prédécesseur `p` ; `dep = (calls[0].arr ?? calls[0].dep) − segments['p>q0'].seconds × 1000` ; `hasPrevious = true`, `prevInferred = true`. Sinon (premier arrêt) `hasPrevious = false`.
3. Un run dont `calls[0]` (ou la paire précédente→calls[0]) n'existe pas dans `network.quays` / `network.segments` est écarté.
4. Écarter les runs dont tous les calls sont à plus de 30 min dans le futur (rames pas encore parties hors du terminus) **sauf** si leur premier call est un terminus (alors ils restent au quai).

- [ ] **Step 1: Tests qui échouent** (`tests/siri.test.ts`) sur `tests/fixtures/et-sample.json` : seulement des lignes ciblées ; un journey ligne 1 a `lineId 'C01371'`, des `calls[].quay` numériques en chaîne, temps croissants ; un JSON vide/malformé → `journeys: []` sans exception.
- [ ] **Step 2: Tests qui échouent** (`tests/runs.test.ts`) avec un mini `Network` construit en mémoire (ligne C01371, quais A B C D, segments `A>B`,`B>C`,`C>D` de 60 s) :
  - Pas d'instantané précédent, journey `[B@t+30s, C@t+90s]` → `stops[0].quay === 'A'`, `prevInferred === true`, `stops[0].dep === tB − 60000`.
  - Instantané précédent `[A,B,C]` puis journey `[B,C]` (ref RATP différente, même ligne/direction/destination, heure B à 40 s près) → même `id`, `stops[0].quay === 'A'` avec ses heures d'origine, `prevInferred === false`.
  - Journey qui commence au terminus `[A@t+5min, B, …]` → `hasPrevious === false`, run conservé.
  - Journey dont le premier quay `'ZZZ'` est inconnu → écarté.
  - Deux journeys proches qui pourraient s'apparier au même run précédent → un seul hérite de l'id.
- [ ] **Step 3: Test qui échoue** (`tests/departures.test.ts`) : snapshot avec 3 runs passant à la station S2 (quai B) à t+1, t+5, t−1 min → 2 départs, triés, celui du passé exclu.
- [ ] **Step 4:** → FAIL. **Step 5:** Implémenter. **Step 6:** → PASS. Commit `feat: SIRI parsing, vehicle runs, departures`.

### Task 5: Poller, budget, persistance, replay

**Files:** Create `lib/realtime/schedule.ts`, `lib/realtime/prim-client.ts`, `lib/realtime/store.ts`, `lib/realtime/poller.ts`, `tests/schedule.test.ts`, `tests/poller.test.ts`

**Interfaces:**
- Consumes: `parseEstimatedTimetable`, `buildRuns`, `network.json` (lu depuis `public/data/network.json` via `fs` côté serveur, mis en cache module).
- Produces:
  - `parisDay(now: number): string` (`YYYY-MM-DD` Europe/Paris), `inServiceWindow(now: number): boolean` (05:00 ≤ heure Paris < 01:30 le lendemain, c.-à-d. faux entre 01:30 et 05:00)
  - `nextDelayMs(now: number, s: { lastFetch: number | null; failures: number; callsToday: number; intervalMs: number; cap: number }): number | null` — `null` = ne pas appeler (budget atteint ou hors fenêtre → le poller revérifie dans 5 min) ; sinon délai avant le prochain appel : `max(0, lastFetch + intervalMs × 2^failures − now)` borné à 15 min.
  - `Budget` dans `store.ts` : `loadBudget(dir): { day: string; calls: Record<'et' | 'disruptions', number> }`, `recordCall(dir, kind, now)` (remise à zéro si `parisDay` change), `loadSnapshot(dir)`, `saveSnapshot(dir, s: { fetchedAt: number; journeys: Journey[]; runs: VehicleRun[] })`, idem `loadDisruptions/saveDisruptions`. Écriture atomique (fichier temporaire + rename).
  - `fetchEstimatedTimetable(apiKey: string): Promise<unknown>`, `fetchDisruptions(apiKey: string): Promise<unknown>` — lèvent une `PrimError { status }` si non-2xx.
  - `getPoller(): Poller` — singleton sur `globalThis.__ltpPoller` ; `Poller.start()`, `Poller.snapshot(): Snapshot | null`, `Poller.disruptions(): Disruption[]`, `Poller.status(): { mode: 'live' | 'replay'; lastFetch: number | null; callsToday: number; failures: number }`. Le constructeur accepte des dépendances injectables `{ now, fetchEt, fetchDisruptions, dir, live }` pour les tests.
  - Replay : si `!live`, lit `tests/fixtures/et-sample.json` une fois, décale **une seule fois au démarrage** tous les horaires de `(now − responseTime)`, puis reconstruit les runs toutes les 100 s avec ce même décalage (les rames avancent naturellement jusqu'à épuisement de la fixture). `source: 'replay'`. Aucun appel réseau.
  - `live = process.env.PRIM_LIVE === '1' || process.env.NODE_ENV === 'production'` ; sans `PRIM_API_KEY` en live → log d'erreur, repli replay.

- [ ] **Step 1: Tests qui échouent** (`tests/schedule.test.ts`) :
  - `inServiceWindow` : 2026-11-16 04:59 Paris → false ; 05:00 → true ; 2026-11-17 01:29 → true ; 01:30 → false ; vérifier aussi un instant en heure d'été (2026-07-01 05:00 Paris = 03:00Z → true).
  - `parisDay(Date.parse('2026-11-16T23:30:00Z')) === '2026-11-17'`.
  - `nextDelayMs` : `lastFetch null` en fenêtre → 0 ; `lastFetch = now − 40 s` → 60 000 ; `failures 2` → `400 s − écoulé` ; `failures 10` → ≤ 900 000 ; `callsToday 900` → null ; hors fenêtre → null.
- [ ] **Step 2: Tests qui échouent** (`tests/poller.test.ts`, dossier temporaire, faux `fetchEt` compteur, horloge injectée) :
  - Démarrage avec un `snapshot.json` persisté datant de 30 s → `fetchEt` appelé 0 fois au démarrage, `snapshot()` non nul (`source 'cache'`).
  - Deux pollers créés successivement sur le même dossier le même jour : `callsToday` cumulé.
  - `fetchEt` qui rejette `PrimError{status:429}` → `failures` 1, ancien snapshot conservé, prochain délai 200 s.
  - Replay : `fetchEt` jamais appelé, `snapshot().source === 'replay'`, au moins un run dont `stops[1].arr > now`.
- [ ] **Step 3:** → FAIL. **Step 4:** Implémenter. **Step 5:** → PASS. Commit `feat: quota-safe PRIM poller with persistence and replay`.

### Task 6: Info trafic et routes API

**Files:** Create `lib/realtime/disruptions.ts`, `app/api/vehicles/route.ts`, `app/api/stops/[id]/route.ts`, `app/api/disruptions/route.ts`, `tests/disruptions.test.ts`, `tests/fixtures/disruptions-sample.json`

**Interfaces:**
- Consumes: `getPoller()`, `departuresForStation`.
- Produces:
  - `parseDisruptions(raw: unknown, now: number): Disruption[]` — ne garde que les perturbations liées à une ligne ciblée (via le tableau `lines[]` et ses `impactedObjects` / ids `line:IDFM:Cxxxxx` ou `IDFM:Cxxxxx`) et actives à `now` (une période contient `now`) ; `message` = texte sans HTML ; tri par sévérité puis date.
  - `GET /api/vehicles` → `{ fetchedAt, source, runs }` (`Cache-Control: no-store`), 503 `{ error }` si aucun snapshot.
  - `GET /api/stops/[id]` → `{ stationId, name, departures }` ; 404 si station inconnue.
  - `GET /api/disruptions` → `Disruption[]` (option `?line=C01371`).
  - Les routes appellent `getPoller().start()` (idempotent). `export const runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

- [ ] **Step 1:** Récupérer **un** échantillon réel : `curl -H "apikey: $PRIM_API_KEY" --compressed .../disruptions_bulk/disruptions/v2 > tests/fixtures/disruptions-sample.json` (1 appel sur le quota), puis le réduire à ≤ 30 perturbations dont au moins une sur une ligne ciblée et une hors cible. Noter la forme réelle des champs dans un commentaire en tête de `disruptions.ts`.
- [ ] **Step 2: Tests qui échouent** : seules des perturbations de lignes ciblées ; une perturbation dont la période est passée est exclue ; `message` ne contient pas `<` ; entrée malformée → `[]`.
- [ ] **Step 3:** → FAIL. **Step 4:** Implémenter `parseDisruptions` + brancher le polling des perturbations dans le poller (5 min, même budget/fenêtre ; replay → fixture). **Step 5:** → PASS.
- [ ] **Step 6:** `npm run dev` (replay) puis `curl -s localhost:3000/api/vehicles | head -c 300` → JSON avec `source:"replay"` et des runs ; `curl localhost:3000/api/stops/<un stationId de la ligne 1>` → départs ; `curl localhost:3000/api/disruptions` → tableau. Commit `feat: disruptions and API routes`.

### Task 7: Interpolation côté client

**Files:** Create `lib/client/interpolate.ts`, `tests/interpolate.test.ts`

**Interfaces:**
- Consumes: `VehicleRun`, `Network`, `pointAtFraction`.
- Produces:
  - `type RunPosition = { coord: LngLat; state: 'moving' | 'dwelling' | 'waiting'; segmentKey: string | null; fraction: number; nextQuay: string | null; nextTime: number | null }`
  - `positionAt(run: VehicleRun, network: Network, now: number): RunPosition | null` — `t(stop, 'arr') = arr ?? dep`, `t(stop,'dep') = dep ?? arr`. Avant `dep(stops[0])` → au quai 0 (`'waiting'`). Entre `arr(i)` et `dep(i)` → au quai i (`'dwelling'`). Entre `dep(i)` et `arr(i+1)` → `pointAtFraction(segments['qi>qi+1'].coords, (now − dep)/(arr − dep))` (`'moving'`). Après `arr(dernier)` + 60 s → null. Segment manquant ou quai inconnu → null.
  - `createSmoother(): (runId: string, p: RunPosition | null) => RunPosition | null` — si même `runId` et même `segmentKey` qu'au frame précédent et `fraction` < précédente, garder la précédente (pas de recul) ; si la différence dépasse 0,5 ou segment différent, accepter la nouvelle.

- [ ] **Step 1: Tests qui échouent** avec mini-réseau (A→B segment droit de 2 points, 60 s) :
  - run `[A dep t0, B arr t0+60s]` : à `t0+30s` → coord au milieu, `'moving'` ; à `t0−10s` → coord de A, `'waiting'` ; à `t0+60s+61s` → null.
  - dwell : `B arr t1, dep t1+20s` à `t1+10s` → coord de B, `'dwelling'`.
  - segment `A>X` absent → null.
  - smoother : fraction 0,5 puis 0,45 sur même segment → 0,5 ; puis 0,6 → 0,6 ; puis segment différent fraction 0,1 → accepté.
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. **Step 4:** → PASS. Commit `feat: client-side run interpolation`.

### Task 8: Carte principale

**REQUIRED SUB-SKILL:** frontend-design:frontend-design pour la direction visuelle.

**Files:** Create `app/page.tsx`, `app/layout.tsx` (modifier), `app/globals.css`, `components/LiveMap.tsx`, `components/SidePanel.tsx`, `components/StationPanel.tsx`, `components/VehiclePopup.tsx`, `lib/client/useLiveData.ts`

**Interfaces:**
- Consumes: `/data/network.json`, `/api/vehicles`, `/api/stops/[id]`, `/api/disruptions`, `positionAt`, `createSmoother`.
- Produces: `useLiveData(): { network: Network | null; snapshot: Snapshot | null; disruptions: Disruption[]; error: string | null }` (réseau chargé une fois ; `/api/vehicles` toutes les 30 s ; `/api/disruptions` toutes les 2 min).

Exigences :
- MapLibre plein écran, fond Carto Positron (clair) / Dark Matter (sombre, `prefers-color-scheme`), centré sur Paris (2.3488, 48.8534, zoom 11). Attribution : © OpenStreetMap, © CARTO, données IDFM (PRIM).
- Couche tracés : `lines[id].shapes` avec `color`, largeur métro/RER > tram. Couche stations (cercles, visibles à partir du zoom 12).
- Couche rames : une source GeoJSON mise à jour par `requestAnimationFrame` (≤ 30 fps), cercle à la couleur de la ligne + `shortName` en texte (`textColor`). Les rames des lignes masquées par le filtre ne sont pas dessinées.
- Clic rame → popup : pastille ligne, « vers {destination} », prochaine station + « dans X min », mention « position estimée ».
- Clic station → `StationPanel` : nom, prochains passages groupés par ligne/direction (rafraîchis toutes les 30 s).
- `SidePanel` : filtres par mode (Métro / RER / Tram / Transilien) et par ligne (pastilles), liste des perturbations actives, indicateur « Mis à jour il y a X s » + badge « Données rejouées » si `source === 'replay'`, nombre de rames affichées. Repliable ; en mobile, panneau en bas.
- Erreur réseau → bandeau discret, la carte continue avec le dernier instantané.

- [ ] **Step 1:** Implémenter les composants (pas de tests unitaires UI ; la logique testée vit dans Task 7).
- [ ] **Step 2:** `npm run build` → OK sans erreurs de type.
- [ ] **Step 3:** `npm run dev`, ouvrir `http://localhost:3000` (navigateur via le skill claude-in-chrome si disponible, sinon capture manuelle par l'utilisateur) : tracés visibles, rames qui bougent, popup et panneau station fonctionnels, filtre qui masque une ligne. Capture d'écran.
- [ ] **Step 4:** Commit `feat: live map UI`.

### Task 9: Page ligne

**Files:** Create `app/lignes/[id]/page.tsx`, `components/LineDiagram.tsx`, `lib/client/lineDiagram.ts`, `tests/lineDiagram.test.ts`

**Interfaces:**
- Consumes: `Network`, `Snapshot`, `positionAt`, `Disruption[]`.
- Produces: `diagramBranches(network: Network, lineId: string): { directionId: 0 | 1; headsign: string; stations: string[] }[]` — pour chaque direction, les patterns triés par `trips` décroissant, en gardant un pattern seulement s'il n'est pas une sous-séquence d'un pattern déjà gardé ; stations = `stationId` des quais (dédoublonnés consécutivement). `placeRunsOnDiagram(branch, runs, network, now): { runId; afterIndex: number; fraction: number }[]`.

- [ ] **Step 1: Tests qui échouent** : avec patterns `A-B-C-D` (100 trajets) et `A-B-C` (30) même direction → une seule branche `[S1,S2,S3,S4]` ; avec `A-B-C-D` et `A-B-E` → deux branches. Une rame entre B et C à mi-parcours → `afterIndex 1`, `fraction ≈ 0.5`.
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. **Step 4:** → PASS.
- [ ] **Step 5:** Page `/lignes/[id]` (id = `C01371` ou `shortName` en minuscules, ex. `/lignes/rer-a`, `/lignes/m1`, `/lignes/t3a`, `/lignes/j` — slug `m{n}`, `rer-{x}`, `t{n}`, `j`/`l`) : en-tête aux couleurs de la ligne, perturbations, schéma vertical par branche avec les rames animées entre les stations (même boucle d'animation que la carte), clic station → prochains passages. Lien vers chaque ligne depuis le `SidePanel`. Slug inconnu → `notFound()`.
- [ ] **Step 6:** `npm run build` → OK ; vérifier `/lignes/m1`, `/lignes/rer-b`, `/lignes/j` dans le navigateur. Commit `feat: line pages`.

### Task 10: Vérification en conditions réelles

**Files:** Modify `README.md`

- [ ] **Step 1:** `npm test && npm run build` → tout vert.
- [ ] **Step 2:** `PRIM_LIVE=1 npm run dev` pendant ~5 min : `.cache/budget.json` montre ≤ 4 appels `et`, `/api/vehicles` renvoie `source:"live"` avec des runs sur métro, RER, tram, J et L ; redémarrer le serveur → aucun appel supplémentaire immédiat.
- [ ] **Step 3:** Contrôle visuel : au moins 80 % des rames du RER A et de la ligne 1 ont une position (pas masquées) ; aucune rame hors tracé.
- [ ] **Step 4:** README : fonctionnalités, limites (positions estimées, quota), commandes. Commit `docs: README and live verification`.
