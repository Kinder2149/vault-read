# CHANGELOG — Vault Read

Journal court : une ligne par étape. Le détail, les mesures et les raisons sont
dans `PROJET_CONTEXTE.md` (§8 pour les tranches 0 à 8, §12 pour les suivantes).
Ce fichier ne contient aucune décision : il ne fait que renvoyer.

Dernier état connu : **311 vérifications automatiques passent** (2026-09-19).
Pas encore publié : `versionCode` 1, `versionName` « 1.0 ».

## Tranches de construction (§8)

- **2026-08-20** — Tranches 0 à 8 : squelette, sources, base locale, sauvegarde,
  fiche et éditions, progression, listes et suggestions, scan de code-barres,
  préparation Android. Vérifiées sur appareil.

## Corrections d'usage (§12)

- **2026-08-21** — Tranche 8 : Google Books instable et lent, réessais et délais.
- **2026-08-21** — Tranche 9 : contenu de la fiche, moins de rechargements inutiles.
- **2026-08-21** — Tranche 10 : une panne de Google n'est plus un écran vide.
- **2026-08-21** — Tranche 11 : cinq retours après essai sur téléphone.
- **2026-08-21** — Tranche 12 : quota Google visible et ménagé.
- **2026-08-21** — Tranche 13 : erreur de connexion à la base après redémarrage.
- **2026-08-25** — Tranche 14 : 75 vérifications automatiques, sans réseau réel.
- **2026-08-25** — Tranche 15 : découpage de `Recherche.jsx` et `App.jsx`, sous filet.
- **2026-08-25** — Tranche 16 : correction de la fiche et des livres qui disparaissaient.
- **2026-08-25** — Tranche 17 : cinq retours d'usage (historique, pagination, notifications).
- **2026-08-25** — Tranche 18 : suggestions vides, bouton en trop.
- **2026-08-26** — Tranche 19 : choix des sources remis en cause ; la BnF ajoutée en filet.
- **2026-08-26** — Tranche 20 : éditions possédées, mot trompeur.
- **2026-08-26** — Tranche 21 : l'édition ajoutée s'affiche, la couverture suit l'édition active.
- **2026-08-26** — Tranche 22 : note et avis par livre.
- **2026-08-26** — Tranche 23 : qualité des résultats mesurée puis corrigée.
- **2026-08-26** — Tranche 24 : vignette de chaque édition.
- **2026-08-26** — Tranche 25 : le cache de recherche sert enfin de cache.
- **2026-08-26** — Tranche 26 : tri par pertinence ou par date.
- **2026-08-27** — Tranche 27 : recherche réparée en quatre temps.
- **2026-08-28** — Tranche 28 : banc d'essai de la recherche, notoriété et ordre des résultats (Open Library).
- **2026-08-30** — Tranche 29 : cache qui ne fige plus le classement, clé de fusion,
  tome lu à la manière de la BnF, banc d'essai refait.
- **2026-09-06** — Renommage de l'application : « Vault Read ».
- **2026-09-07** — Tranche 30 (enregistrée le 2026-09-19) : une carte par livre,
  hors-sujet écarté. À mesurer avant de la juger acquise (voir §12).
- **2026-09-19** — Tranche 31 (en attente des captures de Kinder) : coffrets et
  intégrales ne fusionnent plus avec un livre seul ; banc adapté, 0 défaut sur 8
  recherches. Le filtre du hors-sujet écarte beaucoup : à cadrer (voir §12).
- **2026-09-19** — Tranche 32 (en attente des captures de Kinder) : le filtre du
  hors-sujet reconnaît mieux l'auteur ; les 3 vraies éditions écartées à tort
  réapparaissent, rien d'autre ne bouge. Option `npm run banc -- --ecartees`.

- **2026-10-04** — Mission « recherche satisfaisante » figée (aucun code touché) :
  mesure de 20 recherches (3 satisfaisantes), six décisions en §9. Plan à faire.

- **2026-10-04** — Mission « recherche satisfaisante », étape 1 (validée par Kinder
  le 2026-10-04) : un « 0 résultat » de Google vaut une panne, chaîne de repli
  Google libre → BnF → « Aucun livre trouvé ». 324 vérifications passent.
- **2026-10-04** — Mission « recherche satisfaisante », étape 2 (validée par Kinder
  le 2026-10-04) : le filtre ne perd plus de vrais livres (rôle entre
  parenthèses ignoré, prénoms composés, titre exact sans sous-titre conservé).
  332 vérifications passent.
- **2026-10-04** — Mission « recherche satisfaisante », étape 3 (validée par Kinder
  le 2026-10-04) : la recherche de titre est complétée par l'auteur (3
  auteurs au plus, via Open Library), archivée avec le reste. 345 vérifications
  passent.
- **2026-10-04** — Mission « recherche satisfaisante », étape 4 (validée par Kinder
  le 2026-10-04) : une seule définition de « même livre » pour la fusion et
  la complétion BnF (auteur lu avec tolérance, même tome, titres compatibles).
  364 vérifications passent. Limite connue reportée à l'étape 5 : deux tomes sans
  numéro de même titre peuvent encore partager une carte.

- **2026-10-04** — Mission « recherche satisfaisante », étape 5 (validée par Kinder
  le 2026-10-04) : les traductions qu'Open Library rattache à la même œuvre
  fusionnent (12 ISBN au plus, 3,5 s au plus, réponses mémorisées), édition
  française en vitrine. Résultat partiel : Open Library ne connaît presque rien
  des livres récents. 380 vérifications passent.

- **2026-10-04** — Mission « recherche satisfaisante », étape 6 (validée par Kinder
  le 2026-10-04) : le livre cherché passe avant les parasites (trois niveaux :
  cherché, même auteur, reste), rien ne disparaît. 391 vérifications passent.

- **2026-10-04** — Contrôle de clôture (étape 7) : 3 recherches satisfaisantes sur 20,
  écrans vides 6 → 0, vrais livres perdus 9 → 1, mais plus de bruit et de doublons.
  Open Library tombée deux fois (290 requêtes en 4 min). Mission non close.
- **2026-10-04** — Mission « recherche satisfaisante », étape 8 (validée par Kinder sur les
  vérifications automatiques ; mesure réelle en attente : Open Library ne répond plus) : budget de 10 requêtes Open Library
  par recherche, calcul des tomes limité au livre cherché, livre de référence choisi
  par l'auteur que désigne Open Library. 404 vérifications passent.

- **2026-10-04** — Mission « recherche satisfaisante », étape 9 (en attente des captures
  de Kinder) : repli « Voir aussi » — le livre cherché reste visible avec trois « autres »
  au plus, les autres livres de l'auteur et les éditions en d'autres langues passent
  sous un repli, rien ne disparaît. 415 vérifications passent.

- **2026-10-04** — Mission « recherche satisfaisante », étape 10 (validée par Kinder
  le 2026-10-04) : doublons restants — nom de l'auteur dans le titre, genre après le
  deux-points, « texte intégral », faute de frappe sur un tome, intégrale en sous-titre,
  titre coupé. 433 vérifications passent. À mesurer au contrôle final.

## À venir

Voir `PROJET_CONTEXTE.md` §11 (publication) — rien n'est cadré au-delà.
