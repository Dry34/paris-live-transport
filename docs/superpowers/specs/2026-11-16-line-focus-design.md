# Mode « focus ligne » — Design

Date : 2026-11-16 · Statut : approuvé par l'utilisateur (validation d'office)
Complète : `2026-11-16-paris-live-transport-design.md`

## Intention

Reproduire l'expérience du site de Montpellier : on choisit une ligne dans une grille de pastilles, la carte zoome sur cette ligne et n'en montre plus que le tracé, les rames et les arrêts ; le panneau affiche la liste des arrêts de la branche choisie avec le temps avant la prochaine rame à chacun.

## Objectifs

1. **Grille d'accueil** (panneau) : pastilles groupées par Métro / RER / Tram / Transilien, chacune avec un badge d'état : ✓ trafic normal, ⚠ perturbation active, 🌙 aucune rame en circulation. Garde l'indicateur « Mis à jour il y a X s », le badge « Données rejouées » et la liste des perturbations.
2. **Clic sur une pastille → focus** : la carte cadre le tracé de la ligne (en tenant compte du panneau) ; les autres tracés sont fortement estompés ; seules les rames de la ligne sont dessinées ; seules les stations de la ligne sont affichées, avec leur nom.
3. **Fiche ligne** (panneau) : en-tête (pastille, nom, bouton retour), boutons de sens « vers {terminus principaux} », choix de branche par **terminus** quand un sens en a plusieurs, perturbations actives de la ligne, puis la **liste verticale des stations** de la branche : nom, temps avant la prochaine rame (« 3 min », « à quai », « — » si aucune), pastilles des correspondances. Clic sur une station → la carte se centre dessus et le panneau station existant s'ouvre.
4. **Bouton retour** → grille, carte revenue à la vue d'ensemble, toutes les lignes visibles.
5. **URLs** : `/lignes/{slug}` ouvre directement la carte en focus sur cette ligne ; le focus met à jour l'URL (`history.replaceState`), le retour remet `/`. La page ligne séparée actuelle (schéma vertical) est remplacée.

## Non-objectifs

Aucun nouvel appel PRIM ; pas d'horaires théoriques ni de calendrier ; pas de calcul d'itinéraire ; les filtres masquer/afficher par ligne et par mode disparaissent (remplacés par le focus).

## Décisions (rédacteur)

- **Branches par terminus** : dans un sens, les patterns sont regroupés par station terminus ; chaque terminus représentant ≥ 5 % des trajets du sens devient une branche ; la séquence de stations affichée est celle du pattern le plus fréquent vers ce terminus. Branches triées par nombre de trajets. Libellé du sens : « vers A / B » avec les deux termini principaux.
- **Temps avant la prochaine rame** à une station = plus petite heure future (`arr ?? dep`) parmi les rames de la ligne qui desservent cette station **dans le sens de la branche** (la rame va ensuite vers la station suivante de la branche, ou arrive au terminus depuis la précédente). Les heures inférées (station précédente estimée) ne comptent pas. « à quai » si une rame est en station (état `dwelling`) ou attendue dans moins de 30 s.
- **État d'une ligne** : `disrupted` si une perturbation active la concerne ; sinon `no-service` si aucune rame de la ligne dans l'instantané ; sinon `ok`.
- Style : panneau sombre « verre dépoli », lisible, couleurs officielles ; en mobile, panneau en bas.
