# Real Vehicles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fiche rame avec le vrai modèle de la ligne (profil dessiné fidèle, nom, photo libre en option), code mission, numéro de train et train long/court.

**Architecture:** Le parser SIRI garde mission / numéro / longueur des courses SNCF ; `lib/rollingStock.ts` décrit les modèles (paramètres de dessin, livrée, photo) et le matériel par ligne ; `TrainIllustration` dessine un profil à partir des paramètres du modèle ; `VehiclePopup` affiche le tout.

**Tech Stack:** existant — Next.js 15, React, Vitest, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-11-17-real-vehicles-design.md`

## Global Constraints

- Aucun appel PRIM. Requêtes autorisées : Wikipédia / Wikimedia Commons (lecture) pour la Task 2 uniquement, sans aucune information personnelle dans les requêtes (User-Agent générique `live-transport-paris/1.0`).
- **Interdit :** `npm run build` / `next build` / `next start` / tout ce qui écrit dans `.next/` (serveur de l'utilisateur sur le port 3000). Vérifications : `npx vitest run`, `npx tsc --noEmit`, `npm run lint`, GET en lecture sur `http://localhost:3000`.
- Jamais de `.env*` commité. Interface en français.
- Mission / numéro / longueur : uniquement si `DatedVehicleJourneyRef.value` commence par `SNCF_`, sinon `null`.
- Photos : uniquement licences libres (CC BY, CC BY-SA, CC0, domaine public) ; auteur et licence lus dans l'API Commons ; crédit toujours affiché avec la photo.

## Review Focus

1. Course RATP (aucun champ) : la fiche n'affiche ni mission ni numéro, pas de « null » / « undefined » → test Task 1 et Task 3.
2. Fusion de doublons dans `buildRuns` : les nouveaux champs survivent à la fusion (on garde la valeur non nulle).
3. Ligne absente du catalogue de matériel : repli sur le dessin générique du mode, jamais d'exception → test Task 2.
4. Catalogue : chaque ligne de `TARGET_LINES` a une entrée ; chaque photo a `url`, `page`, `author`, `license` non vides et une licence libre → test Task 2.
5. Aucune requête vers Commons avant le clic sur le nom du modèle (Task 3).

---

### Task 1: Mission, numéro de train et longueur dans le temps réel

**Files:** Modify `lib/types.ts`, `lib/realtime/siri.ts`, `lib/realtime/runs.ts` ; Test `tests/siri.test.ts`, `tests/runs.test.ts`

- Produces: `Journey` et `VehicleRun` gagnent `mission?: string | null; trainNumber?: string | null; length?: 'long' | 'short' | null`.
- [ ] Tests qui échouent (course SNCF avec `JourneyNote [{value:'QIWI'}]`, `VehicleJourneyName [{value:'QIWI60'}]`, `VehicleFeatureRef ['longTrain']` → `mission 'QIWI'`, `trainNumber 'QIWI60'`, `length 'long'` ; course RATP avec `VehicleFeatureRef ['shortTrain']` → tout `null` ; `buildRuns` recopie les champs ; fusion de deux doublons dont un seul porte les champs → conservés) → FAIL → implémenter → PASS, suite + tsc + lint verts.
- [ ] Compter sur la fixture la part de courses SNCF avec mission/numéro/longueur ; noter dans le rapport.
- [ ] Commit `feat: keep SNCF mission code, train number and length`.

### Task 2: Catalogue du matériel roulant

**Files:** Create `lib/rollingStock.ts`, `tests/rollingStock.test.ts`

- Produces (exports exacts) :
  - `type NoseShape = 'rounded' | 'flat' | 'sloped' | 'tram'`
  - `interface Livery { body: string; band: string; skirt: string; front: string; window: string; door: string }` (couleurs hex)
  - `interface StockPhoto { url: string; page: string; author: string; license: string }`
  - `interface RollingStockModel { id: string; name: string; mode: Mode; cars: number; levels: 1 | 2; doorsPerCar: number; nose: NoseShape; livery: Livery; photo: StockPhoto | null }`
  - `const MODELS: Record<string, RollingStockModel>`
  - `const LINE_STOCK: Record<string, string[]>` (lineId → ids de modèles, principal d'abord)
  - `function stockForLine(lineId: string): RollingStockModel[]` ([] si inconnue)
  - `function stockLabel(models: RollingStockModel[]): string | null` (noms joints par « / », null si vide)
- [ ] Recherche : pour chacune des 45 lignes de `TARGET_LINES` (`lib/lines.ts`), le matériel en service (Wikipédia FR de la ligne, état nov. 2026). Lister les sources par ligne dans le rapport.
- [ ] Paramètres de dessin et livrée de chaque modèle d'après des photos de profil réelles (nombre de voitures d'une unité, niveaux, portes par face et par voiture, forme du nez, couleurs).
- [ ] Photo : via l'API Commons (`action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800`), choisir une photo de profil ou trois-quarts lisible par modèle, licence libre ; recopier `thumburl`, `descriptionurl`, `Artist` (texte sans HTML), `LicenseShortName`. Rien trouvé → `photo: null`.
- [ ] Tests : chaque ligne de `TARGET_LINES` a ≥ 1 modèle ; tous les ids de `LINE_STOCK` existent dans `MODELS` ; photos non nulles complètes avec licence libre (regex `^(CC BY|CC BY-SA|CC0|Public domain)`) et `url` sur `upload.wikimedia.org` ; `stockForLine('inconnue')` → [] ; `stockLabel` d'une ligne mixte → « A / B ».
- [ ] Commit `feat: rolling stock catalogue per line`.

### Task 3: Profil fidèle, mission et photo dans la fiche

**REQUIRED SUB-SKILL:** frontend-design:frontend-design.

**Files:** Modify `components/TrainIllustration.tsx`, `components/VehiclePopup.tsx`, `app/globals.css` ; Test `tests/trainIllustration.test.ts` (logique pure de dessin si extraite, ex. `lib/client/trainProfile.ts`)

- `TrainIllustration({ mode, color, model, units })` : `model` absent → dessin générique actuel du mode ; sinon profil d'après les paramètres (`cars × units` voitures, niveaux, portes, nez aux deux extrémités, livrée). Hauteur ~48 px, largeur 100 %, `preserveAspectRatio` correct quand il y a beaucoup de voitures.
- Fiche : nom du modèle (`stockLabel`) sous le profil ; « {mission} · train {trainNumber} » si présents (chaque partie seulement si présente) ; `units = run.length === 'long' ? 2 : 1`.
- Clic sur le nom du modèle (bouton, si le modèle principal a une photo) → la photo remplace le profil, avec « Photo : {auteur}, {licence} » lien vers `page` (nouvel onglet, `rel="noopener noreferrer"`) ; reclic → retour au profil. `<img loading="lazy">` rendu seulement après le clic.
- [ ] Tests de la logique pure (nombre de voitures = cars × units ; modèle inconnu → générique), suite + tsc + lint verts. **Pas de build.**
- [ ] Smoke en lecture : `/` et `/lignes/m14` → 200 sur le serveur de l'utilisateur.
- [ ] Commit `feat: real rolling stock profile, mission and photo in the vehicle card`.
