# All Transilien Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter les Transilien H, K, N, P, R, U, V au catalogue et au réseau statique.

**Architecture:** Le catalogue `lib/lines.ts` pilote le filtrage temps réel et la génération du réseau ; on l'étend, on régénère `public/data/network.json`, on adapte les tests/contrôles qui figent le nombre de lignes.

**Tech Stack:** existant.

**Spec:** `docs/superpowers/specs/2026-11-16-all-transilien-design.md`

## Global Constraints
- IDs à ajouter (mode `transilien`) : C01737 (H), C01738 (K), C01736 (N), C01730 (P), C01731 (R), C01741 (U), C02711 (V). Total 45 lignes : 16 métro, 5 RER, 15 tram, 9 Transilien.
- Aucun appel PRIM. Interdit : `npm run build` / `next build` / `next start` / tout ce qui écrit dans `.next/` (serveur utilisateur sur le port 3000). `npm run build:data` est autorisé (réutilise `.cache/gtfs.zip` s'il a < 24 h).
- `public/data/network.json` doit rester < 8 Mo.

## Review Focus
1. Une ligne Transilien ajoutée sans aucun pattern dans le GTFS (ligne V récente) : le contrôle de données le signale clairement au lieu de passer en silence → Task 1 step 3.
2. Les branches de K, N, P, R, U (lignes très ramifiées) restent lisibles : noter dans le rapport le nombre de branches par sens via `lineBranches`.
3. Le test des quais SIRI couverts (`network-checks`) continue de passer avec la fixture existante (qui ne contient pas les nouvelles lignes).

---

### Task 1: Catalogue + réseau régénéré

**Files:** Modify `lib/lines.ts`, `tests/lines.test.ts`, éventuellement `lib/static/network-checks.ts` ; régénère `public/data/network.json`.

**Interfaces:** `TARGET_LINES` / `TARGET_LINE_IDS` / `isTargetLine` inchangés en signature.

- [ ] **Step 1: Test qui échoue** : `tests/lines.test.ts` → `TARGET_LINES` de longueur 45, `TARGET_LINE_IDS.size === 45`, 9 lignes `transilien` dont la liste triée vaut `['C01730','C01731','C01736','C01737','C01738','C01739','C01740','C01741','C02711']`. `npx vitest run tests/lines.test.ts` → FAIL.
- [ ] **Step 2:** Ajouter les IDs dans `lib/lines.ts` → PASS.
- [ ] **Step 3:** `npm run build:data` puis `npm run check:data` : 45 lignes, chaque nouvelle ligne a ≥ 1 pattern par sens (si une ligne n'en a pas, l'ajouter comme contrôle explicite dans `network-checks.ts` avec un message clair et le signaler en DONE_WITH_CONCERNS), taille de `network.json` < 8 Mo. Coller la sortie dans le rapport, ainsi que, par un script tsx jetable dans le scratchpad, le nombre de branches par sens (`lineBranches` de `lib/client/lineFocus.ts`) pour H, K, N, P, R, U, V.
- [ ] **Step 4:** `npx vitest run`, `npx tsc --noEmit`, `npm run lint` → verts.
- [ ] **Step 5:** Vérifier sur le serveur de l'utilisateur (lecture seule) après un cycle de polling (≤ 110 s après la modification, rechargement à chaud) : `curl -s localhost:3000/api/vehicles` contient des runs pour au moins 5 des 7 nouvelles lignes ; noter les comptes par ligne dans le rapport.
- [ ] **Step 6:** Commit `feat: add all Transilien lines (H, K, N, P, R, U, V)` (inclure `public/data/network.json`).
