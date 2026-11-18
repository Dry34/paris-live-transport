# Live Transport Paris — Design

Date : 2026-11-16 · Statut : brouillon, à valider

## Intention

Projet perso : un équivalent parisien de livetransportmontpellier.fr (site d'un ami). Une carte où l'on voit **les rames du métro, du RER, du tram et des Transilien J et L avancer en temps réel**, avec une page par ligne, les prochains passages en station et l'info trafic. Le plaisir de voir le réseau vivre prime sur l'exhaustivité.

## Objectifs

- Carte plein écran (MapLibre) avec les tracés colorés des lignes ciblées et une icône par rame en circulation, animée en continu (interpolation entre stations).
- Lignes couvertes :
  - Métro 1–14, 3bis, 7bis (C01371–C01384, C01386, C01387)
  - RER A–E (C01742, C01743, C01727, C01728, C01729)
  - Tram T1–T14 (C01389, C01390, C01391, C01679, C01843, C01684, C01794, C01774, C01795, C02317, C02528, C01999, C02529, C02344, C02732)
  - Transilien J (C01739) et L (C01740)
- Clic sur une rame : ligne, direction/destination, prochaine station + heure estimée.
- Clic sur une station : prochains passages par ligne/direction.
- Panneau latéral : filtre par mode / par ligne, info trafic en cours.
- Page `/lignes/[id]` : liste ordonnée des stations de la ligne (par branche), rames positionnées entre les stations, perturbations de la ligne.
- Interface en français, utilisable sur mobile.

## Non-objectifs (v1)

Bus, autres lignes Transilien, calcul d'itinéraire, statistiques de ponctualité, blog, historique des véhicules, comptes utilisateurs, notifications, déploiement en production (on tourne en local d'abord).

## Anti-objectifs (échec même si « ça marche »)

- Dépasser le quota PRIM (HTTP 429 en pleine journée → carte morte).
- Exposer la clé API dans le navigateur ou dans git.
- Des rames qui sautent, reculent ou sortent du tracé : mieux vaut masquer une rame que l'afficher n'importe où.

## Contraintes (vérifiées le 2026-11-16)

- **Quota PRIM : 1 000 appels/jour par endpoint** (headers `x-ratelimit-limit-day: 1000`). Auth via header `apikey`.
- `GET https://prim.iledefrance-mobilites.fr/marketplace/estimated-timetable?LineRef=ALL` : ~4,6 Mo (gzip demandé), ~3 s, ~14 300 trajets pour toute l'IDF. Toutes nos lignes présentes. Chaque trajet : `LineRef`, `DirectionRef`, `DatedVehicleJourneyRef`, `DestinationName`, `EstimatedCalls.EstimatedCall[]` (`StopPointRef` = `STIF:StopPoint:Q:<arrid>:`, `Expected/AimedArrival/DepartureTime`). Seuls les **arrêts restants** sont listés.
- Les identifiants de trajet RATP ne sont pas fiables d'un appel à l'autre (compteur technique) ; ceux de la SNCF (RER B/C/D/E partiel, J, L) le sont.
- Pas de GPS en open data pour ces modes : **les positions sont estimées**.
- Info trafic : `GET /marketplace/disruptions_bulk/disruptions/v2` (quota séparé de 1 000/jour).
- Données statiques (open data IDFM, API Opendatasoft, sans clé) : `traces-des-lignes-de-transport-en-commun-idfm` (tracés + `route_color`), `referentiel-des-lignes` (couleurs, noms courts), `arrets` (arrid, zdaid, coordonnées), `arrets-lignes` / `relations` (liens arrêt ↔ ligne). GTFS complet (112 Mo) disponible si nécessaire pour l'ordre des stations.
- Clé dans `.env.local` (`PRIM_API_KEY`), jamais commitée.

## Approches envisagées

1. **Next.js, un seul serveur Node avec poller intégré** — *retenue*. Un seul projet, une commande pour tout lancer, le poller garde l'instantané en mémoire et le sert à tous les clients. Simple à comprendre et à faire évoluer. Implique un serveur qui tourne en continu (pas de serverless pur).
2. Site statique + Cloudflare Worker (cron toutes les 2 min, stockage KV). Hébergement gratuit, mais deux artefacts à déployer et dev local moins fluide.
3. Navigateur qui appelle PRIM directement — écartée : clé exposée et quota consommé par visiteur.

## Architecture (décidée)

- **Next.js (App Router, TypeScript)**, servi par `next start` / `next dev` (process Node long).
- **MapLibre GL JS**, fond de carte Carto (Positron clair / Dark Matter sombre selon le thème).
- **Données statiques pré-générées** par un script (`npm run build:data`) qui interroge l'open data IDFM et produit dans `data/` (commité) :
  - tracés des lignes ciblées (GeoJSON simplifié) + couleurs ;
  - stations et quais (arrid → nom, coordonnées, zdaid, lignes) ;
  - pour chaque ligne et chaque branche : la séquence ordonnée des stations et la géométrie du tracé entre deux stations consécutives (pour interpoler le long des rails, pas en ligne droite).
- **Poller serveur** (singleton dans le process) :
  - `estimated-timetable` toutes les **100 s** entre 05:00 et 01:30 (heure de Paris) → ~740 appels/jour, soit ~260 de marge sur 1 000 pour redémarrages, retries et tests manuels. Hors service : arrêt. Sur 429/erreur : backoff exponentiel, on garde le dernier instantané (marqué « données de il y a X min »). *(Choix du rédacteur.)*
  - **Budget protégé** : le poller tient un compteur d'appels du jour et le dernier instantané sur disque (`.cache/`, gitignoré). Au démarrage il recharge l'instantané et n'appelle PRIM que si le dernier date de plus de 100 s ; il refuse d'appeler au-delà de 900 appels/jour. Singleton conservé sur `globalThis` pour survivre au hot reload de `next dev`.
  - **Mode replay en dev** : par défaut en développement, le poller lit une réponse PRIM enregistrée (fixture) en décalant ses horaires sur l'heure courante ; `PRIM_LIVE=1` active les vrais appels. *(Choix du rédacteur.)*
  - `disruptions_bulk` toutes les **5 min** (~290/jour).
  - Filtre les trajets sur nos lignes, puis construit pour chaque rame un **parcours** : station précédente (+ heure de départ) suivie de **toute la liste des arrêts restants avec leurs heures attendues**, ligne, direction, destination. Ainsi le navigateur fait avancer la rame de station en station même entre deux instantanés (sinon elle resterait bloquée jusqu'à 100 s à chaque station). *(Choix du rédacteur.)*
  - Station précédente : déduite de l'instantané précédent (le premier arrêt qui a disparu de la liste) ; à défaut, la station qui précède la prochaine dans la séquence de la ligne, avec une heure de départ estimée à partir du temps de parcours.
  - Rapprochement des trajets d'un instantané à l'autre : par `DatedVehicleJourneyRef` pour la SNCF ; pour la RATP, par (ligne, direction, destination, prochaine station, heure attendue proche).
- **API interne** (lecture seule, aucun appel PRIM déclenché par un visiteur) :
  - `GET /api/vehicles` → instantané des parcours de rames + horodatage.
  - `GET /api/stops/[id]` → prochains passages, calculés depuis le même instantané.
  - `GET /api/disruptions` → perturbations filtrées sur nos lignes.
- **Client** : rafraîchit `/api/vehicles` toutes les ~30 s (récupère le nouvel instantané dès qu'il existe). À chaque frame, il trouve dans le parcours de la rame la paire d'arrêts qui encadre `now` et la positionne entre les deux, le long de la géométrie ; entre l'heure d'arrivée et l'heure de départ d'un arrêt, elle est en station. Au-delà du dernier arrêt connu, elle reste au terminus puis disparaît. Les rames dont la position n'est pas cohérente (station inconnue, tronçon absent de la séquence) sont masquées.

## Laissé au builder

- Le découpage exact des modules, la structure des dossiers, la librairie de tests (Vitest proposé) et de gestion d'état.
- L'algorithme précis pour obtenir l'ordre des stations par branche (via `arrets-lignes` + projection sur le tracé, ou via le GTFS `stop_times`), tant que les lignes à branches (RER A/B/C/D/E, 7, 13, J, L) sont correctes.
- Le style visuel détaillé (passer par le skill frontend-design) : il doit rester lisible, avec les couleurs officielles des lignes.
- Le lissage de l'animation lorsqu'un nouvel instantané corrige une position (pas de saut en arrière visible).

## Tests attendus

Tests unitaires sur : le parsing SIRI, la construction des parcours (y compris la déduction de la station précédente), l'interpolation le long d'une géométrie, la planification du poller (fenêtre horaire, backoff, budget d'appels/jour, persistance, mode replay). Un fichier d'exemple réel de réponse PRIM (réduit) sert de fixture.
