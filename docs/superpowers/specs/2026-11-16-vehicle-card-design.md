# Fiche rame (popup véhicule) — Design

Date : 2026-11-16 · Statut : approuvé par l'utilisateur
Complète : `2026-11-16-paris-live-transport-design.md`, `2026-11-16-line-focus-design.md`

## Intention
Clic sur une rame → une fiche riche comme sur le site de Montpellier : où va la rame, ses prochains arrêts avec le temps, jusqu'au terminus, une illustration, et quelques infos de marche.

## Contenu de la fiche
1. **En-tête** : pastille de ligne + « {terminus} » en gras + chevron ; clic sur l'en-tête → focus sur la ligne (même effet qu'un clic sur la pastille dans la grille).
2. **Arrêts à venir** sur un trait vertical à la couleur de la ligne : les **4 prochains** (nom, temps, correspondances en petites pastilles), puis un dépliant « +N arrêts » (repliable), puis le **terminus** avec son heure. Temps : « imminent » si < 60 s, sinon « N min » (`Math.floor`). Les arrêts au-delà de ce que donne PRIM sont **estimés** depuis les temps de parcours théoriques (`segments[...].seconds` + 20 s d'arrêt par station) et affichés « ~N min ».
3. **Illustration** : silhouette SVG de rame dessinée aux couleurs de la ligne, une par mode (métro, RER, tram, Transilien). Aucun nom de modèle ni numéro (pas de données fiables).
4. **Pied** : vitesse estimée « ~N km/h » (rame en mouvement : longueur du tronçon ÷ durée), retard « +N min » (orange, seulement si PRIM donne l'heure théorique et l'écart ≥ 60 s ; « à l'heure » en vert si écart < 60 s ; rien si inconnu), âge des données « il y a N s » (depuis `snapshot.fetchedAt`), écarts avec la rame **devant** et **derrière** sur la même ligne et le même sens (« ‹ 3′ » / « 4′ › », à la prochaine station, heures réelles uniquement).

## Non-objectifs
Numéro de rame, année, modèle exact ; historique ; aucun nouvel appel PRIM.

## Décisions
- Retard = heure attendue − heure théorique (`Expected − Aimed`) du prochain arrêt, quand les deux existent dans le SIRI.
- Prolongement jusqu'au terminus : pattern de la ligne qui contient les derniers arrêts connus de la rame dans l'ordre et dont le terminus porte le nom de la destination ; à défaut, le pattern le plus fréquent qui les contient ; à défaut, pas de prolongement.
