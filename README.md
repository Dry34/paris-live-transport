# Live Transport Paris

Carte en direct des métros, RER, tramways et Transilien J/L de Paris, avec positions estimées à partir des données SIRI de PRIM (Île-de-France Mobilités).

## Fonctionnalités

- Carte MapLibre avec les rames de 45 lignes (16 métros, 5 RER, 15 tramways, 9 Transilien : H, J, K, L, N, P, R, U, V), aux couleurs officielles des lignes.
- Positions des rames estimées en continu entre deux arrêts, avec une garde anti-recul quand un nouvel instantané corrige légèrement une rame.
- Panneau latéral : pastilles des lignes (un clic met la ligne en focus), informations sur une rame (ligne, destination, prochain arrêt).
- Panneau de station : prochains passages par ligne et direction.
- Perturbations en cours (disruptions PRIM) affichées par ligne.
- Focus ligne (`/lignes/[id]`) : la carte cadre la ligne choisie et n’affiche plus que son tracé, ses rames et ses arrêts.
- Interface en français.

## Limites

- **Positions estimées** : PRIM ne fournit pas de GPS. Chaque rame est placée par interpolation entre ses horaires estimés d'arrivée et de départ, le long du tracé GTFS. Ce n'est pas la position réelle.
- Une rame dont la position est incohérente (arrêt inconnu du réseau statique, horaires manquants, tronçon sans tracé) est masquée, jamais placée hors tracé. En pratique, environ 92 à 95 % des rames du RER A et de la ligne 1 ont une position à un instant donné.
- **Quota PRIM** : 1 000 appels/jour/endpoint. L'application interroge `estimated-timetable` toutes les 100 s et les perturbations toutes les 5 min, uniquement entre 05:00 et 01:30 (Europe/Paris), avec un plafond dur de 900 appels/jour. Backoff exponentiel (max 15 min) sur erreur ou 429.
- Le dernier instantané et le compteur du jour sont persistés dans `.cache/` : un redémarrage du serveur ne déclenche aucun appel tant que l'instantané a moins de 100 s.
- Les données sont rafraîchies toutes les 100 s environ ; entre deux instantanés, les rames avancent selon les horaires estimés.

## Lancer

1. `npm i`
2. Copier `.env.example` vers `.env.local` et renseigner `PRIM_API_KEY` (clé PRIM, lue côté serveur uniquement, jamais exposée au navigateur).
3. `npm run build:data` : télécharge le GTFS et génère `public/data/network.json`.
4. `npm run dev` : mode replay (fixture `tests/fixtures/et-sample.json`), aucun appel PRIM.
5. `PRIM_LIVE=1 npm run dev` : vrais appels PRIM (quota 1 000/jour/endpoint).

Autres commandes : `npm test`, `npm run build`, `npm run check:data`, `npm run fixture -- <raw.json> <out.json>`.

## Vérification en conditions réelles

Contrôlée le 2026-11-16 avec `PRIM_LIVE=1` : 3 appels `estimated-timetable` et 1 appel perturbations en environ 4 minutes (`.cache/budget.json`), `/api/vehicles` renvoie `source: "live"` avec des rames sur métro, RER, tram, J et L. Après redémarrage du serveur, aucun appel supplémentaire (`source: "cache"`).
