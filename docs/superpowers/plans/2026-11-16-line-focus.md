# Line Focus Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grille de pastilles avec état + mode focus ligne (carte cadrée sur la ligne, fiche ligne avec sens/branches et temps avant la prochaine rame à chaque station).

**Architecture:** La logique (branches par terminus, temps par station, état des lignes, emprise) vit dans un module pur testé `lib/client/lineFocus.ts`. `LiveMap` gagne des props de focus (filtres/opacité MapLibre + `fitBounds`). Le panneau devient deux vues (grille / fiche) pilotées par un composant racine partagé entre `/` et `/lignes/[id]`.

**Tech Stack:** existant — Next.js 15 App Router, React, MapLibre GL, Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-11-16-line-focus-design.md` (complète `docs/superpowers/specs/2026-11-16-paris-live-transport-design.md`)

## Global Constraints

- Aucun nouvel appel PRIM, aucune nouvelle route API ; tout est calculé côté client depuis `Network` (`/data/network.json`), `Snapshot` (`/api/vehicles`), `Disruption[]` (`/api/disruptions`) et `/api/stops/[id]` existant.
- Branche = terminus représentant **≥ 5 %** des trajets du sens ; séquence = pattern le plus fréquent vers ce terminus ; branches triées par trajets décroissants.
- Libellé du sens : `vers A / B` (deux termini principaux ; un seul s'il n'y en a qu'un).
- Temps à une station : plus petite heure future `arr ?? dep` d'une rame de la ligne desservant la station dans le sens de la branche ; heures inférées exclues (`stops[0]` quand `prevInferred`) ; « à quai » si rame `dwelling` à la station ou attendue dans **< 30 s** ; « — » sinon. Affichage « N min » = `Math.floor(secondes / 60)`, minimum 1.
- État ligne : `disrupted` (perturbation active) > `no-service` (0 rame de la ligne dans l'instantané) > `ok`.
- URLs : `/lignes/{slug}` (slug via `lineSlug`/`resolveLineId` de `lib/lineSlug.ts`) ouvre le focus ; focus → `history.replaceState` vers `/lignes/{slug}` ; retour → `/`.
- Les filtres masquer/afficher par ligne et par mode sont supprimés. La page ligne à schéma vertical (`LinePageClient`, `LineDiagram`, `lib/client/lineDiagram.ts` + son test) est supprimée.
- Interface en français. Couleurs officielles (`LineInfo.color`, `textColor`). Mobile : panneau en bas (comportement existant de `.side-panel`).

## Review Focus

1. **Ligne sans rame (nuit, ligne pas encore ouverte comme T14 hors service)** : la fiche s'affiche avec « — » partout et la pastille 🌙, pas de crash → test Task 1 (`nextArrivalsAlongBranch` avec runs vides, `lineStatus` no-service).
2. **Rame qui dessert la station dans l'autre sens** (même quai partagé, ex. terminus ou tram à quai central) : elle ne compte pas pour la branche affichée → test Task 1.
3. **Arrêt terminus de la branche** : le temps affiché est l'arrivée de la rame qui y termine (pas de station suivante) → test Task 1.
4. **Slug inconnu `/lignes/zzz`** : 404 comme aujourd'hui → vérification Task 2.
5. **Changement de ligne en focus directement depuis une autre ligne focus** (URL + carte + sens/branche réinitialisés à la première branche) → vérification Task 3.

---

## File Structure

```
lib/client/lineFocus.ts        logique pure du focus (nouveau)
tests/lineFocus.test.ts        (nouveau)
components/AppShell.tsx        racine client partagée / et /lignes/[id] (nouveau, reprend app/page.tsx)
components/LiveMap.tsx         + props focusLineId, centerStationId, panelInset
components/LineGrid.tsx        vue grille (nouveau, remplace le contenu filtres de SidePanel)
components/LineSheet.tsx       vue fiche ligne (nouveau)
components/SidePanel.tsx       conteneur : en-tête état + bascule grille/fiche
app/page.tsx                   <AppShell initialLineId={null} />
app/lignes/[id]/page.tsx       <AppShell initialLineId={lineId} /> (notFound conservé)
supprimés : components/LinePageClient.tsx, components/LineDiagram.tsx, lib/client/lineDiagram.ts, tests/lineDiagram.test.ts
```

---

### Task 1: Logique du focus ligne

**Files:** Create `lib/client/lineFocus.ts`, `tests/lineFocus.test.ts`

**Interfaces:**
- Consumes: `Network`, `VehicleRun`, `Disruption` (`lib/types.ts`), `positionAt` (`lib/client/interpolate.ts`).
- Produces:
  - `interface FocusBranch { directionId: 0 | 1; terminusStationId: string; terminusName: string; stations: string[]; trips: number }`
  - `lineBranches(network: Network, lineId: string): FocusBranch[]` — tous sens confondus, triées par `directionId` puis `trips` décroissant ; règle ≥ 5 % par sens ; `stations` = stationIds du pattern le plus fréquent vers ce terminus (doublons consécutifs retirés) ; `terminusName` = `network.stations[id].name`.
  - `directionLabel(branches: FocusBranch[], directionId: 0 | 1): string` → `'vers A / B'`.
  - `interface StationArrival { seconds: number | null; atPlatform: boolean }`
  - `nextArrivalsAlongBranch(branch: FocusBranch, runs: VehicleRun[], network: Network, now: number): Record<string, StationArrival>` — une entrée par station de la branche.
  - `correspondences(network: Network, stationId: string, lineId: string): string[]` — autres lignes de `stations[id].lines`, ordre métro, rer, tram, transilien puis `shortName` (tri naturel : 2 < 10).
  - `type LineStatus = 'ok' | 'disrupted' | 'no-service'`
  - `lineStatus(lineId: string, disruptions: Disruption[], runs: VehicleRun[], now: number): LineStatus` — perturbation active = une période contient `now`.
  - `lineBounds(network: Network, lineId: string): [[number, number], [number, number]] | null` — emprise de `lines[id].shapes` ([[minLon,minLat],[maxLon,maxLat]]), null si aucune shape.

Règle « dans le sens de la branche » pour une rame et une station `S = branch.stations[i]` : trouver dans `run.stops` un arrêt `k` dont le quai appartient à `S` ; la rame compte si `run.stops[k+1]` est à `branch.stations[i+1]`, ou si `k` est son dernier arrêt, `i` est le dernier index de la branche et `run.stops[k-1]` est à `branch.stations[i-1]`. Heure = `arr ?? dep` de `stops[k]`, ignorée si `k === 0 && run.prevInferred` ou si ≤ `now − 0` (passée), sauf `atPlatform` : vrai si `positionAt(run, network, now)` donne `state === 'dwelling'` à un quai de `S` avec la même règle de sens, ou si l'heure est dans `[now, now + 30 s)`.

- [ ] **Step 1: Tests qui échouent** (`tests/lineFocus.test.ts`), sur un mini-réseau en mémoire : ligne `L1`, stations S1..S5 (quais q1..q5, et q1b..q5b pour le sens retour), patterns sens 0 : `S1-S2-S3-S4` (90 trajets), `S1-S2-S3-S5` (30 trajets), `S1-S2` (3 trajets) ; sens 1 : `S4-S3-S2-S1` (100 trajets). Segments de 60 s entre quais consécutifs.
  - `lineBranches` → 3 branches : sens 0 termini S4 (90) puis S5 (30) ; S2 exclu (3/123 < 5 %) ; sens 1 terminus S1. `stations` de la branche S5 = `['S1','S2','S3','S5']`.
  - `directionLabel(branches, 0) === 'vers S4 / S5'` (noms de stations) ; `directionLabel(branches, 1) === 'vers S1'`.
  - `nextArrivalsAlongBranch` (branche S4, `now = t`) : run A sens 0 `[q2 dep t+60s, q3 arr t+120s, q4 arr t+180s]` et run B sens 1 `[q3b arr t+30s, q2b arr t+90s]` → `S3.seconds === 120`, `S4.seconds === 180` (terminus), `S2.seconds === 60`, `S1.seconds === null`, run B ignoré ; une rame avec `prevInferred` dont `stops[0]` est q1 à t+10s ne donne pas `S1` ; rame à t+20s → `atPlatform === true` ; runs vides → toutes `{ seconds: null, atPlatform: false }`.
  - Une rame sens 0 allant vers S5 ne compte pas pour `S4` dans la branche S4, mais compte pour `S2` et `S3`.
  - `correspondences` : station avec lignes `['C01371','C01743','C01390','C01739']`, ligne focus C01371 → `['C01743','C01390','C01739']` (rer, tram, transilien) avec un `network.lines` minimal.
  - `lineStatus` : perturbation active → `'disrupted'` même sans rame ; perturbation expirée et 0 rame → `'no-service'` ; rames présentes → `'ok'`.
  - `lineBounds` : shapes `[[[2,48],[2.5,48.9]]]` → `[[2,48],[2.5,48.9]]` ; ligne inconnue → null.
- [ ] **Step 2:** `npx vitest run tests/lineFocus.test.ts` → FAIL (module absent).
- [ ] **Step 3:** Implémenter `lib/client/lineFocus.ts`.
- [ ] **Step 4:** → PASS ; `npx vitest run` complet vert ; `npx tsc --noEmit` propre.
- [ ] **Step 5:** Vérifier sur les vraies données : petit script tsx (non commité) qui charge `public/data/network.json` et affiche les branches de C01743 (RER B), C01739 (J), C01371 (M1), C01391 (T3a) : RER B sens nord doit proposer CDG 2 et Mitry-Claye ; M1 une branche par sens. Coller la sortie dans le rapport.
- [ ] **Step 6:** Commit `feat: line focus logic (branches by terminus, arrivals, status)`.

### Task 2: Carte en mode focus + racine partagée + routage

**Files:** Create `components/AppShell.tsx` ; Modify `components/LiveMap.tsx`, `app/page.tsx`, `app/lignes/[id]/page.tsx` ; Delete `components/LinePageClient.tsx`, `components/LineDiagram.tsx`, `lib/client/lineDiagram.ts`, `tests/lineDiagram.test.ts` (déplacer `createDiagramSmoother`/autres exports encore utilisés s'il y en a — vérifier par grep).

**Interfaces:**
- Consumes: `lineBounds` (Task 1), `lineSlug`, `resolveLineId`.
- Produces:
  - `LiveMapProps` devient `{ network; snapshot; focusLineId: string | null; centerStationId: string | null; panelInset: { left: number; bottom: number }; onStationClick: (id: string) => void; onShownCountChange?: (n: number) => void }` (`hiddenLines` supprimé).
  - `AppShell({ initialLineId }: { initialLineId: string | null })` — état `focusLineId`, `stationId`, `centerStationId`; expose à `SidePanel` : `focusLineId`, `onFocusLine(lineId: string | null)`, `onStationSelect(stationId: string)` (centre la carte + ouvre `StationPanel`).

Exigences carte quand `focusLineId` est non nul :
- `fitBounds(lineBounds, { padding: { top: 40, right: 40, bottom: 40 + panelInset.bottom, left: 40 + panelInset.left }, duration: 800 })`.
- Couche `lines` : opacité `0.12` pour les autres lignes, `1` pour la ligne focus (expression `case` sur la propriété de ligne) ; la ligne focus dessinée au-dessus (tri ou couche dédiée `lines-focus`).
- Rames : seules celles de `focusLineId` (filtre sur les couches `vehicles`, `vehicle-labels`, `vehicle-halo`).
- Stations : seules celles dont `lines` contient `focusLineId`, visibles dès le zoom de cadrage (pas de seuil zoom 12) avec leur nom.
- `centerStationId` non nul → `easeTo` sur la station (zoom ≥ 14).
- `focusLineId` null → toutes les lignes à opacité normale, toutes les rames, stations selon le comportement actuel, retour à la vue Paris (2.3488, 48.8534, zoom 11).
- `panelInset` : `{ left: largeur du panneau, bottom: 0 }` sur desktop, `{ left: 0, bottom: hauteur du panneau }` sous 720 px (mesuré dans `AppShell` via `ResizeObserver` sur le panneau ou valeurs CSS fixes).

Routage :
- `app/page.tsx` → `<AppShell initialLineId={null} />` ; `app/lignes/[id]/page.tsx` → garde `generateMetadata` et `notFound()`, rend `<AppShell initialLineId={lineId} />`.
- `AppShell` : à chaque changement de focus, `window.history.replaceState(null, '', focus ? '/lignes/' + lineSlug(line) : '/')`.

- [ ] **Step 1:** Implémenter (pas de test unitaire UI ; la logique testée est en Task 1). Temporairement, `SidePanel` reçoit `focusLineId`/`onFocusLine` et, en attendant Task 3, un clic sur une pastille de la liste existante appelle `onFocusLine` à la place de masquer la ligne.
- [ ] **Step 2:** `npm test && npm run lint && npm run build` → vert.
- [ ] **Step 3:** Smoke en mode replay (`PORT=3124 npm run dev`, PRIM_LIVE non défini) : `/` 200, `/lignes/m1` 200 et contient le nom de la ligne dans `<title>`, `/lignes/rer-b` 200, `/lignes/zzz` 404. Arrêter le serveur.
- [ ] **Step 4:** Commit `feat: map line focus mode and shared app shell`.

### Task 3: Panneau — grille de pastilles et fiche ligne

**REQUIRED SUB-SKILL:** frontend-design:frontend-design pour la direction visuelle (panneau sombre « verre dépoli », cohérent avec les styles existants de `app/globals.css`).

**Files:** Create `components/LineGrid.tsx`, `components/LineSheet.tsx` ; Modify `components/SidePanel.tsx`, `app/globals.css`, `components/AppShell.tsx` (si besoin de câblage).

**Interfaces:**
- Consumes: `lineBranches`, `directionLabel`, `nextArrivalsAlongBranch`, `correspondences`, `lineStatus` (Task 1) ; `AppShell` props (Task 2) ; `LineBadge`, `lineName`, `MODE_LABELS` (`components/LineBadge.tsx`).
- Produces:
  - `LineGrid({ network, snapshot, disruptions, now, onSelect }: { …; onSelect: (lineId: string) => void })`.
  - `LineSheet({ network, snapshot, disruptions, lineId, now, onBack, onStationSelect }: { …; onBack: () => void; onStationSelect: (stationId: string) => void })`.
  - `SidePanel` affiche l'en-tête d'état existant (« Mis à jour… », « Données rejouées », nombre de rames) puis `LineGrid` si `focusLineId` est null, sinon `LineSheet`. Les props `hiddenLines`, `onToggleLine`, `onToggleMode` disparaissent.

Exigences :
- **Grille** : une section par mode (`MODE_LABELS`, avec le nombre de lignes : « MÉTRO · 16 »), pastilles `LineBadge` cliquables (boutons, `aria-label` « Ligne X, trafic normal / perturbé / pas de rame ») avec un petit badge en coin : ✓ vert `ok`, ⚠ orange `disrupted`, 🌙 bleu nuit `no-service`. Sous la grille : la liste des perturbations actives existante.
- **Fiche** : en-tête aux couleurs de la ligne avec bouton retour (`aria-label="Retour aux lignes"`), pastille et nom ; deux boutons de sens `directionLabel(…, 0)` / `(…, 1)` (sens 0 sélectionné par défaut) ; si le sens a ≥ 2 branches, rangée de puces « vers {terminusName} » (première sélectionnée par défaut) ; perturbations actives de la ligne ; liste verticale des stations de la branche : trait vertical à la couleur de la ligne, nom, à droite le temps (« à quai » / « N min » / « — »), en dessous les `LineBadge size="sm"` des correspondances ; la ligne de la station est un bouton → `onStationSelect`.
- Changer de ligne (via URL ou carte) réinitialise sens = 0 et branche = première (clé React `lineId` sur `LineSheet`).
- Les temps se rafraîchissent chaque seconde (le `now` existant de `SidePanel`).

- [ ] **Step 1:** Implémenter.
- [ ] **Step 2:** `npm test && npm run lint && npm run build` → vert.
- [ ] **Step 3:** Smoke en replay : récupérer le HTML de `/lignes/rer-b` après hydratation n'est pas possible par curl ; à la place, un test de rendu léger n'est pas requis — vérifier par un script tsx que pour l'instantané de `.cache/snapshot.json` (ou la fixture replay) `nextArrivalsAlongBranch` sur la première branche de C01371 donne au moins une station avec `seconds !== null`, et le noter dans le rapport. Vérifier que `components/LineGrid.tsx` et `LineSheet.tsx` ne contiennent aucun texte anglais visible.
- [ ] **Step 4:** Commit `feat: line grid with status and line sheet with arrivals`.
