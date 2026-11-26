# Avant-Match — analyse foot avant le coup d'envoi

Projet d'études (HEC Liège). Un site qui analyse chaque match du Top 5 européen, de la Jupiler Pro League et des coupes d'Europe, et publie des probabilités sur tous les marchés **dès l'annonce des compositions officielles**.

## Ce que fait le site
- **Matchs** : calendrier des 8 prochains jours et résultats récents, avec la probabilité 1N2 de chaque match.
- **Fiche match** : probabilités sur ~40 marchés (1N2, double chance, buts, score exact, handicaps, mi-temps, 2UP/1UP, corners, cartons, tirs, buteurs, passeurs), cote « juste », comparaison avec la cote du bookmaker et calcul du gain moyen attendu pour 10 € ; compositions sur le terrain ; forme récente, moyennes, confrontations directes ; explication du pronostic.
- **Fiabilité** : comparaison systématique des pronostics avec les résultats (taux de réussite, score de Brier, calibration, comparaison au bookmaker, simulation de paris).
- **Méthode** : explication du modèle.

## Architecture
| Élément | Où | Rôle |
|---|---|---|
| `docs/` | GitHub Pages | Site statique (HTML/CSS/JS), lit les données en direct |
| Supabase (Postgres) | cloud | Matchs, compos, stats joueurs, pronostics |
| `supabase/functions/engine` | Supabase Edge Function | Import ESPN, entraînement du modèle, publication des pronostics |
| `pg_cron` | Supabase | Toutes les 5 min : détection des compos et publication · chaque heure : calendrier et résultats · chaque nuit : réentraînement |

## Le modèle (résumé)
Modèle de Poisson hiérarchique (famille Maher / Dixon-Coles) : attaque et défense par équipe, niveau par championnat, avantage du terrain par compétition, pondération temporelle (demi-vie 150 jours), cible mixte buts réels / buts attendus estimés à partir des tirs. Covariables estimées sur l'historique : force offensive du onze aligné, stabilité de la compo, gardien remplaçant, fatigue. Corners, cartons et tirs : modèles binomiaux négatifs de même structure. 2UP : programmation dynamique minute par minute. Joueurs : part de chaque titulaire dans la production de son équipe, lissée vers la moyenne de son poste.

## Données
API publique (non officielle) d'ESPN. Cotes : DraftKings via ESPN.

## Avertissement
Les probabilités sont des estimations statistiques. Parier comporte des risques de perte. Aide en Belgique : https://joueurs.aide-en-ligne.be
