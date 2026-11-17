# Vrais véhicules dans la fiche rame — Design

Date : 2026-11-17 · Statut : approuvé par l'utilisateur
Complète : `2026-11-16-vehicle-card-design.md` (lève la règle « pas de nom de modèle »)

## Intention

Se rapprocher de la fiche de Montpellier (profil fidèle du tram, numéro, modèle) avec ce que le temps réel d'Île-de-France Mobilités fournit réellement.

## Ce que donnent les données (vérifié sur `tests/fixtures/et-sample.json`)

- **Aucun identifiant de rame** (pas de `VehicleRef`), ni RATP ni SNCF → pas de « rame 2115 ».
- Courses SNCF (`DatedVehicleJourneyRef` commençant par `SNCF_`) : `JourneyNote[0].value` = **code mission** (QIWI, PAPE…), `VehicleJourneyName[0].value` = **numéro de train** (137594, « 128602-128603 »), `VehicleFeatureRef` = `longTrain` / `shortTrain`.
- Courses RATP : rien de tout cela.

## Objectifs

1. **Matériel de la ligne** : un catalogue statique `ligne → modèle(s)` (modèle principal en premier ; lignes mixtes = plusieurs modèles, on ne sait pas lequel roule). La fiche affiche le nom (« MP14 », « MI09 », « Francilien (Z 50000) »…) ; ligne mixte → « MI79 / MI84 ».
2. **Profil dessiné fidèle** remplaçant l'illustration générique : un moteur SVG unique paramétré par modèle (forme du nez, nombre de voitures, 1 ou 2 niveaux, portes par voiture, couleurs de livrée réelles : caisse, bandeau, bas de caisse, face avant), même style pour toutes les lignes, vue de profil droite, sans fond.
3. **Train long / court** (SNCF) : `longTrain` → deux unités attelées dessinées ; `shortTrain` ou inconnu → une unité.
4. **Code mission + numéro de train** sous le profil, à la place du numéro de rame de Montpellier : « QIWI · train 137594 ». Absent pour la RATP (rien affiché, pas de « — »).
5. **Photo réelle en option** : clic sur le nom du modèle → la photo (Wikimedia Commons, licence libre) s'affiche dans la fiche avec le crédit « Photo : {auteur}, {licence} » lié à la page Commons. Aucune requête externe tant qu'on ne clique pas.

## Non-objectifs

Pas de numéro de rame ; pas de devinette du modèle sur les lignes mixtes ; pas de nouvel appel PRIM ; pas de photo non libre.

## Décisions

- Champs temps réel ajoutés à `Journey` et `VehicleRun` : `mission?: string | null`, `trainNumber?: string | null`, `length?: 'long' | 'short' | null`, lus uniquement sur les courses SNCF.
- Catalogue `lib/rollingStock.ts` vérifié sur sources publiques (Wikipédia FR des lignes, état novembre 2026 ; lignes en transition = modèles multiples) ; chaque entrée de photo porte `url` (miniature `upload.wikimedia.org` ≤ 800 px), `page` (page `commons.wikimedia.org/wiki/File:…`), `author`, `license` — tous relus via l'API Commons (`extmetadata`), jamais inventés. Modèle sans photo libre trouvée → pas d'option photo.
- Images affichées via `<img>` (pas de changement de `next.config`).
