# Vehicle Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la popup d'une rame par une fiche riche : arrêts à venir jusqu'au terminus, illustration, vitesse, retard, âge des données, écarts avec les rames voisines.

**Architecture:** Le parser SIRI conserve l'écart théorique/attendu par arrêt. Un module pur `lib/client/vehicleDetails.ts` calcule tout le contenu de la fiche. `VehiclePopup` affiche ce contenu ; `LiveMap` lui passe l'instantané et un rappel pour ouvrir le focus ligne.

**Tech Stack:** existant — Next.js 15, React, MapLibre GL, Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-11-16-vehicle-card-design.md`

## Global Constraints

- Aucun nouvel appel PRIM, aucune nouvelle route API.
- Temps : « imminent » si < 60 s, sinon « N min » avec `Math.floor(s / 60)` ; arrêts estimés préfixés « ~ ».
- Arrêts estimés : cumul de `network.segments["A>B"].seconds` + **20 s** d'arrêt par station intermédiaire, à partir du dernier arrêt connu.
- Fiche : **4** prochains arrêts, puis dépliant « +N arrêts », puis terminus.
- Retard affiché seulement si connu : ≥ 60 s → « +N min » (orange) ; < 60 s en valeur absolue → « à l'heure » (vert) ; avance ≥ 60 s → « −N min ».
- Écarts voisins : même `lineId` et même `direction`, mesurés à la prochaine station de la rame, heures réelles uniquement (`stops[0]` exclu quand `prevInferred`).
- Pas de nom de modèle, ni numéro, ni année.
- Interface en français.
- **Interdit aux sous-agents :** `npm run build` / `next build` / `next start` et tout ce qui écrit dans `.next/` (le serveur de l'utilisateur tourne sur le port 3000 depuis ce dossier). Vérifications : `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, et des requêtes GET en lecture sur `http://localhost:3000`.

## Review Focus

1. **Rame RATP dont le SIRI ne donne qu'un arrêt à venir** : la fiche montre quand même la suite jusqu'au terminus en « ~ » → test Task 2.
2. **Destination qui ne correspond à aucun terminus de pattern** (mission partielle, nom différent) : repli sur le pattern le plus fréquent, sinon liste limitée aux arrêts connus, jamais d'exception → test Task 2.
3. **Rame à quai ou au départ** (pas en mouvement) : pas de vitesse affichée → test Task 2.
4. **Rame seule dans son sens** (pas de voisine) : les écarts sont absents, pas « NaN » → test Task 2.
5. **Rame sélectionnée qui disparaît de l'instantané** : la fiche se ferme proprement (comportement actuel de `LiveMap` conservé) → vérification Task 3.

---

### Task 1: Retard par arrêt dans les données temps réel

**Files:** Modify `lib/types.ts`, `lib/realtime/siri.ts`, `lib/realtime/runs.ts` ; Test `tests/siri.test.ts`, `tests/runs.test.ts`

**Interfaces:**
- Produces: `Journey.calls[]` et `RunStop` gagnent `delaySec?: number | null` = secondes (attendu − théorique) sur l'arrivée si `ExpectedArrivalTime` et `AimedArrivalTime` existent, sinon sur le départ, sinon `null`. `buildRuns` recopie `delaySec` dans les stops (y compris un stop précédent hérité ; un stop précédent inféré a `delaySec: null`).

- [ ] **Step 1: Tests qui échouent** : un call SIRI avec `AimedArrivalTime 10:00:00Z`, `ExpectedArrivalTime 10:02:05Z` → `delaySec === 125` ; avec seulement `Expected*` → `null` ; avance (`Expected` 30 s avant) → `-30`. `buildRuns` : le `delaySec` d'un call se retrouve sur le stop correspondant du run ; stop précédent inféré → `null`.
- [ ] **Step 2:** `npx vitest run tests/siri.test.ts tests/runs.test.ts` → FAIL.
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** → PASS ; suite complète, `npx tsc --noEmit`, `npm run lint` verts. Compter sur `tests/fixtures/et-sample.json` la part de calls avec `delaySec !== null` par opérateur et la noter dans le rapport.
- [ ] **Step 5:** Commit `feat: keep per-stop delay from SIRI aimed/expected times`.

### Task 2: Contenu de la fiche (logique pure)

**Files:** Create `lib/client/vehicleDetails.ts`, `tests/vehicleDetails.test.ts`

**Interfaces:**
- Consumes: `Network`, `VehicleRun`, `RunStop.delaySec` (Task 1), `RunPosition` + `positionAt` (`lib/client/interpolate.ts`), `distanceM`/`cumulativeLengths` (`lib/geo.ts`), `correspondences` (`lib/client/lineFocus.ts`).
- Produces:
  - `interface UpcomingStop { quay: string; stationId: string; name: string; time: number; estimated: boolean; correspondences: string[] }`
  - `upcomingStops(run: VehicleRun, network: Network, now: number): UpcomingStop[]` — stops connus futurs (`arr ?? dep` ≥ now − 30 s ; `stops[0]` exclu si `hasPrevious`), dans l'ordre, puis prolongement estimé jusqu'au terminus (règle du spec, section Décisions) ; dernier élément = terminus quand le prolongement existe.
  - `formatEta(time: number, now: number, estimated: boolean): string` → `'imminent'` | `'N min'` | `'~N min'` (`'~imminent'` interdit : un arrêt estimé < 60 s affiche `'~1 min'`).
  - `estimatedSpeedKmh(run: VehicleRun, position: RunPosition, network: Network): number | null` — seulement `state === 'moving'` : longueur du tronçon `position.segmentKey` (m) ÷ durée (dep → arr du tronçon) × 3.6, arrondi ; null sinon ou si durée ≤ 0.
  - `currentDelaySec(run: VehicleRun, position: RunPosition): number | null` — `delaySec` du stop `position.nextQuay`.
  - `formatDelay(sec: number | null): { text: string; tone: 'late' | 'on-time' | 'early' } | null` (règles des Global Constraints).
  - `neighborGaps(run: VehicleRun, runs: VehicleRun[], network: Network, now: number): { aheadMin: number | null; behindMin: number | null }` — à la station de la prochaine arrivée de la rame : rame devant = plus proche heure < celle de la rame, derrière = plus proche heure > ; minutes arrondies (`Math.round`).

- [ ] **Step 1: Tests qui échouent** (mini-réseau en mémoire : ligne L, stations S1..S6, quais q1..q6, segments consécutifs de 90 s avec coordonnées espacées de 1 km, patterns `S1..S6` (100 trajets, terminus nommé « Terminus Six ») et `S1..S4` (20 trajets)) :
  - run `{ destination: 'Terminus Six', stops: [q2 (prev réel), q3 arr now+60s] }` → `upcomingStops` = q3 (réel, non estimé) puis q4 à now+60+20+90 s, q5, q6 estimés ; dernier = q6.
  - destination inconnue « Ailleurs » → prolongement par le pattern le plus fréquent contenant q2→q3 (S1..S6).
  - aucun pattern contenant les arrêts connus → seulement les arrêts connus, pas d'exception.
  - `formatEta` : 30 s → `'imminent'` ; 125 s → `'2 min'` ; estimé 30 s → `'~1 min'` ; estimé 125 s → `'~2 min'`.
  - `estimatedSpeedKmh` : rame en mouvement sur un tronçon de 1 000 m parcouru en 90 s → 40 ; rame `dwelling` → null.
  - `formatDelay(125)` → `{ text: '+2 min', tone: 'late' }` ; `formatDelay(30)` → `{ text: "à l'heure", tone: 'on-time' }` ; `formatDelay(-90)` → `{ text: '−1 min', tone: 'early' }` ; `formatDelay(null)` → null.
  - `neighborGaps` : trois rames même sens arrivant à S4 à now+60 s, now+240 s (la rame testée), now+480 s → `{ aheadMin: 3, behindMin: 4 }` ; rame seule → `{ aheadMin: null, behindMin: null }` ; une rame de l'autre sens ignorée.
- [ ] **Step 2:** → FAIL. **Step 3:** Implémenter. **Step 4:** → PASS, suite + tsc + lint verts.
- [ ] **Step 5:** Vérification sur données réelles par un script tsx jetable (dans le scratchpad, non commité) sur `.cache/snapshot.json` : pour 3 rames du métro 1 et 3 du RER B, afficher `upcomingStops` (nom, formatEta) et `neighborGaps` ; coller la sortie dans le rapport.
- [ ] **Step 6:** Commit `feat: vehicle card content (upcoming stops, speed, delay, gaps)`.

### Task 3: Fiche rame (UI)

**REQUIRED SUB-SKILL:** frontend-design:frontend-design (cohérence avec le panneau « verre dépoli » existant de `app/globals.css`).

**Files:** Modify `components/VehiclePopup.tsx`, `components/LiveMap.tsx`, `components/AppShell.tsx`, `app/globals.css` ; Create `components/TrainIllustration.tsx`

**Interfaces:**
- Consumes: Task 2 exports ; `LineBadge` ; `AppShell` `onFocusLine`.
- Produces:
  - `VehiclePopupProps = { network: Network; run: VehicleRun; runs: VehicleRun[]; position: RunPosition; fetchedAt: number; now: number; onOpenLine: (lineId: string) => void }`.
  - `TrainIllustration({ mode, color }: { mode: Mode; color: string })` — SVG inline, silhouette distincte par mode (métro court 5 voitures, RER à deux niveaux, tram articulé bas, Transilien), couleur de caisse = `color`, vitres sombres ; largeur 100 %, hauteur ~48 px.
  - `LiveMapProps` gagne `onOpenLine: (lineId: string) => void` ; `AppShell` le relie à `onFocusLine`.

Exigences :
- Mise en page de haut en bas : en-tête (bouton : pastille + terminus en gras + chevron « › », `aria-label="Voir la ligne {nom}"`) → liste des arrêts (trait vertical couleur ligne, gros point pour le prochain arrêt et le terminus, petits points sinon ; nom ; temps à droite ; pastilles de correspondances sous le nom ; dépliant « +N arrêts » entre le 4ᵉ arrêt et le terminus quand N > 0, segment pointillé quand replié) → `TrainIllustration` → pied (vitesse · retard coloré · « il y a N s » ; à droite « ‹ N′ » devant / pastille / « N′ › » derrière).
- La fiche se met à jour chaque seconde (temps, âge des données) avec l'instantané courant ; si la rame disparaît, comportement actuel conservé (fermeture).
- Largeur max ~340 px sur desktop ; sur mobile, la fiche reste lisible et défilable.
- Mention discrète « Positions et horaires estimés » conservée.

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` → verts. **Ne pas lancer de build.**
- [ ] **Step 3:** Smoke en lecture sur le serveur de l'utilisateur (déjà lancé, rechargement à chaud) : `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/` → 200 et `/lignes/m1` → 200 après la modification ; aucune erreur de compilation dans la réponse.
- [ ] **Step 4:** Commit `feat: rich vehicle card with upcoming stops and train illustration`.
