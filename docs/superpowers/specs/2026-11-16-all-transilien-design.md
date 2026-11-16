# Toutes les lignes Transilien — Design

Date : 2026-11-16 · Statut : approuvé par l'utilisateur
Complète : `2026-11-16-paris-live-transport-design.md`

## Intention
Afficher toutes les lignes Transilien, pas seulement J et L.

## Périmètre
Ajouter au catalogue les 7 lignes Transilien ferrées actives (référentiel IDFM, `transportsubmode = suburbanRailway`) : **H C01737, K C01738, N C01736, P C01730, R C01731, U C01741, V C02711**, en plus de J C01739 et L C01740. Les entrées homonymes sans sous-mode (C018xx, C02712) et « BUS SNCF » sont exclues.

Total : 45 lignes (16 métro, 5 RER, 15 tram, 9 Transilien).

## Conséquences
- Aucun appel PRIM supplémentaire : l'appel global `estimated-timetable` contient déjà ces trains, le filtre `isTargetLine` les laissera passer.
- `public/data/network.json` est régénéré depuis le GTFS IDFM (`npm run build:data`) avec les nouvelles lignes.
- Grille, focus ligne, branches, flèches et fiche rame s'appliquent sans changement de code.
