# Live Transport Paris

Carte en direct des métros, RER, tramways et Transilien J/L de Paris, avec positions estimées à partir des données SIRI de PRIM (Île-de-France Mobilités).

## Lancer

1. `npm i`
2. Copier `.env.example` vers `.env.local` et renseigner `PRIM_API_KEY` (clé PRIM, lue côté serveur uniquement).
3. `npm run build:data` : télécharge le GTFS et génère `public/data/network.json`.
4. `npm run dev` : mode replay (fixture `tests/fixtures/et-sample.json`), aucun appel PRIM.
5. `PRIM_LIVE=1 npm run dev` : vrais appels PRIM (quota 1 000/jour/endpoint).

Autres commandes : `npm test`, `npm run build`, `npm run fixture -- <raw.json> <out.json>`.
