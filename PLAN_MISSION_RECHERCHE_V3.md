# PLAN DE MISSION — Refonte de la recherche

> Document de travail temporaire. Ses décisions remontent dans
> `PROJET_CONTEXTE_SUIVI_LECTURE.md` (§12) à la fin, puis ce fichier est
> supprimé — comme les deux plans précédents.
>
> Cadré le 2026-08-30, après un test sur téléphone où la recherche a été jugée
> non fonctionnelle. **Tout ce qui suit est mesuré**, sur les sagas de test :
> Harry Potter, Le Seigneur des Anneaux, Le Trône de Fer, La Quête d'Ewilan,
> La Passe-Miroir, Hunger Games, plus Germinal et Les Fourmis.

---

## 0. Pourquoi la mission précédente a échoué

Elle avait annoncé « 7 / 7 » au banc d'essai. Le téléphone a dit l'inverse.

**Le banc ne mesurait qu'une chose : la place du livre cherché.** Il ne
regardait ni la couverture, ni le résumé, ni le tome. Trois des quatre
reproches lui étaient structurellement invisibles.

C'est la leçon de méthode de cette mission, et elle décide de l'ordre des
travaux : **un instrument qui ne mesure pas ce dont on se plaint est pire que
pas d'instrument**, parce qu'il donne le droit de se déclarer satisfait.

---

## 1. Les causes, toutes mesurées

| Symptôme rapporté | Cause | Preuve |
|---|---|---|
| Résultats pas pertinents | L'archive de 24 h ressert la page 1 **non classée** : la lecture de l'archive sort de la fonction *avant* le classement | Lecture du code + le symptôme suivant |
| Les vrais résultats n'apparaissent **qu'en défilant** | Même cause : page 1 en conserve, pages suivantes cherchées en direct donc classées | Concordance exacte avec le symptôme |
| Couverture **fausse**, résumé qui ne colle pas | La clé de fusion **coupe le titre au « : »** et jette ce qui distingue les livres | `« LOTR : la communauté de l'anneau »` fusionné avec `« LOTR : les deux tours »` |
| Couverture **absente** | Le repli Open Library par ISBN récupère **0 couverture sur 39** | Endpoint vérifié bon par ailleurs (Dune, 1984, LOTR : 200 + image) |
| Le **tome** n'apparaît pas | Le lecteur exige « tome » ou « T. » et rate le format BnF `. 1` | **17 tomes ratés** sur les sagas de test |

---

## 2. La décision structurante : la clé de fusion

Mesure sur **212 volumes réels** :

```
                              vol.   ACTUELLE      TITRE-ENTIER   ISBN SEUL
                                    cartes/faux    cartes/faux     cartes
harry potter                    40     34 / 0        34 / 0          40
le seigneur des anneaux         20     15 / 2        17 / 0          20
le trone de fer                 40     37 / 0        37 / 0          38
la quete d'ewilan               14     12 / 0        12 / 0          12
la passe-miroir                 18     15 / 0        15 / 0          15
germinal                        40     15 / 1        16 / 0          38
les fourmis                     40     32 / 0        32 / 0          35
────────────────────────────────────────────────────────────────────────
fusions FAUSSES                          3             0
```

**Trois conclusions, dont deux qui corrigent mes propres propositions :**

1. **L'ISBN seul est une mauvaise clé.** Germinal passe de 15 à **38 cartes**.
   J'allais le proposer comme une vertu ; c'est le déluge de doublons refusé.
2. **La bonne clé est le titre ENTIER** — ce qui suit le « : » compris — plus
   l'auteur et le numéro de tome. **Zéro fusion fausse, +1 à +2 cartes.**
3. **Le sous-titre ne doit jamais entrer dans la clé.** Les 24 fiches de
   Germinal ne diffèrent que par lui (« roman », « Large Print »,
   « Les Rougon-Macquart ») : c'est du bruit d'édition, pas de l'identité.

**Il n'y a donc aucun arbitrage à faire entre « mentir » et « dupliquer ».**
La règle retenue :

- **même ISBN → même livre** (preuve ; ne peut qu'**ajouter** des fusions) ;
- **sinon : titre entier + auteur + tome identiques** ;
- **rien d'autre ne fusionne** ;
- le groupe étant fiable, **les fiches se complètent de nouveau entre elles**.

---

## 3. La limite que l'on ne peut pas franchir

**Harry Potter ne porte aucun numéro de tome, nulle part** — 0 détecté sur
40 fiches Google et 20 notices BnF. *À l'École des sorciers*, *la Chambre des
secrets* : l'information n'existe pas dans les titres français.

Open Library ordonnerait la saga par année de première parution (1997 → 2007
donne exactement les tomes 1 à 7), mais cette année appartient à l'**œuvre**,
alors que nos cartes portent l'année de leur **édition** : un retirage de 2015
du tome 1 passerait après le tome 7.

**Donc : pour une saga sans numéro dans ses titres, l'ordre n'est pas
garanti.** C'est écrit ici pour ne pas être redécouvert plus tard comme un bug.
Les cinq autres sagas testées affichent leur bloc « dans l'ordre » dès la
page 1.

---

## 4. Les six missions

Ordre imposé par les dépendances, pas par l'importance.

### M1 — Le banc d'essai vérifie la CARTE

**Ce qui change.** Le banc contrôle, pour chaque carte : le titre affiché, la
provenance de la **couverture**, la provenance du **résumé**, le **tome** lu, et
signale toute carte dont un champ vient d'une fiche qui porte un autre titre.

**Pourquoi en premier.** C'est l'instrument. Le précédent a validé des cartes
cassées ; tant qu'il n'est pas refait, aucune mesure de cette mission ne vaut.

**Test.** Il doit afficher **les défauts actuels** — fusions fausses,
couvertures manquantes. Un banc qui trouve tout bon est un banc cassé.

**FAIT le 2026-08-30.** Il a immédiatement attrapé les deux reproches :

```
CARTE FAUTIVE : « Le seigneur des anneaux »
    FUSION — « Le Seigneur des anneaux: Le Retour du roi » + « Le seigneur des anneaux »
    TOMES  — tomes 3 et 1 sur une seule carte

CARTE FAUTIVE : « Le Seigneur des anneaux »
    EMPRUNT — couverture prise sur « … La communauté de l'anneau. Les coulisses du film »
```

Un défaut de l'instrument corrigé en route : avec les réessais de
l'application, Google a rendu 503 sur **cinq recherches sur huit** et le bilan
était à moitié vide. Le banc réessaie désormais douze fois et respire entre
deux recherches — personne ne l'attend.

### M2 — Le cache cesse de mentir

**Ce qui change.** L'archive stocke les résultats **bruts** ; fusion et
classement se recalculent à l'affichage. Plus un bouton **« vider le cache de
recherche »** dans Réglages, qui ne touche pas à la bibliothèque.

**Pourquoi en deuxième.** Sans lui, aucune correction n'est visible avant 24 h
sur les recherches déjà faites — exactement ce qui a fait tester l'ancienne
version sans le savoir.

**Test.** Chercher, corriger une règle, rechercher le même mot : le changement
se voit **immédiatement**.

**FAIT le 2026-08-30.** Vérifié dans l'application.

- **L'archive ne contient plus que du brut.** Ni notoriété, ni fusion : tout se
  recalcule à l'affichage. Une archive écrite par une version antérieure
  ressort donc **classée par les règles d'aujourd'hui**.
- **Le bouton « Vider » fonctionne et ne touche que le cache** :
  `db:lecture` et `historiqueRecherches` intacts, `recherche:…` et
  `notoriete:…` supprimés. Message : « Cache vidé — 2 recherches oubliées ».

**Un défaut introduit par cette mission, trouvé et corrigé dans la foulée.**
Pour éviter de redemander la notoriété à chaque affichage, j'avais archivé les
**échecs** d'Open Library pendant une heure. Vérification immédiate dans
l'application : « harry potter » rendait trois essais devant Rowling, parce
qu'**un seul appel lent** avait été enregistré comme « rien à dire » et gelait
le classement pour l'heure suivante — alors qu'Open Library répondait en
535 ms à la requête d'après.

Corrigé : un échec ne va plus sur disque, il vit **deux minutes en mémoire** et
meurt avec la session. Un échec n'est pas une donnée.

Après correction, « harry potter » rend Rowling en **1ʳᵉ, 2ᵉ, 3ᵉ et 4ᵉ
positions**.

**270 vérifications** (264 avant), dont 6 qui verrouillent M2 : l'archive
contient du brut, une archive ancienne est reclassée, le bouton ne touche ni la
bibliothèque ni l'historique.

### M3 — La clé de fusion corrigée

**Ce qui change.** La règle du §2. Les fiches d'un groupe se complètent de
nouveau, sans risque.

**Test.** Au banc : 0 fusion fausse. À l'écran : la carte du *Seigneur des
Anneaux* ne porte plus la couverture du making-of.

**FAIT le 2026-08-30.** Banc complet, 8 recherches sur 8 mesurées :

```
  recherche                    cartes  defauts  sans image  place du livre
  « harry potter »                 35        0            4         1
  « le seigneur des anneaux »      29        0           14         1
  « le trone de fer »              37        0            1         1
  « la quete d'ewilan »            16        0            6         1
  « la passe-miroir »              15        0            7         1
  « game of thrones »              34        0           13         1
  « germinal »                     15        0            2         1
  « les fourmis »                  33        0           11         1
```

**Aucun défaut de carte. Le livre cherché en 1ʳᵉ place partout.** Et le coût
annoncé se confirme : Germinal reste à 15 cartes, Le Seigneur des Anneaux passe
de 24 à 29.

**Comment c'est fait.** Deux raisons de fusionner, qui se **cumulent** et se
chaînent : le même ISBN (une preuve, qui vaut même si les titres diffèrent) ou
le même titre entier + auteur + tome. La relation est transitive — A et B par
l'ISBN, B et C par le titre, donc les trois ensemble — d'où un petit
« qui appartient à qui » plutôt qu'une simple clé : une seule clé ne saurait pas
exprimer deux raisons.

13 vérifications nouvelles (famille 12), écrites sur les fiches réelles :
le making-of ne rejoint pas le roman, deux tomes ne fusionnent pas, les
24 éditions de Germinal n'en font qu'une, et **une carte ne prend jamais la
couverture d'un livre au titre différent**.

**283 vérifications.**

### M4 — ANNULÉE le 2026-08-30 : le repli fonctionne

**Ce que cette mission devait faire.** Supprimer le repli Open Library par
ISBN, mesuré à **0 couverture récupérée sur 39**.

**Pourquoi elle est annulée.** Avant de supprimer une fonction, j'ai réélargi
la mesure. Le résultat contredit le premier :

```
germinal          1 sans couverture mais avec ISBN ->  0 recuperees
les fourmis       6                                ->  1
dune              8                                ->  6
la peste          6                                ->  0
le petit prince   5                                ->  1
1984              9                                ->  2
                                        TOTAL  10/35  (29 %)
```

**Le premier chiffre n'était pas faux, il était partiel.** Il portait sur
quatre sagas modernes — Harry Potter, Le Seigneur des Anneaux, La Passe-Miroir,
Hunger Games — dont les éditions françaises récentes ne sont pas couvertes par
Open Library. Sur des classiques très réédités, le repli rend 29 %, ce qui
rejoint l'ordre de grandeur annoncé à l'origine (« environ deux sur cinq »).

**Décision : on ne touche à rien.** Le repli ne consomme aucun quota — c'est
une adresse d'image, pas un appel d'API — et il récupère entre 0 et 29 % des
couvertures manquantes selon le type de livre. Les requêtes d'image qui
échouent retombent proprement sur la couverture dessinée (`onError` dans
`BookCard`).

**Leçon de méthode, la troisième de cette mission** : une mesure sur un seul
type de requête ne se généralise pas. J'ai failli supprimer une fonction qui
marche.

### M5 — Le lecteur de tomes apprend la BnF

**Ce qui change.** Les formes `. 1 :`, `. 4,`, `, 1`, `, II` sont reconnues.
Mesuré : **+17 tomes** sur les sagas de test.

**Test.** L'écran des éditions affiche le tome des notices BnF.

**FAIT le 2026-08-30.** La BnF n'écrit jamais « tome » : elle pose le numéro
après un point ou une virgule — `Le trône de fer. 1 : roman`,
`Le Seigneur des anneaux. 4, Appendices et index`. Le lecteur en ratait
**cent pour cent**.

Deux formes ajoutées : le chiffre après ponctuation, et le chiffre **romain**
(`La Passe-miroir, II : Les disparus du Clairdelune`).

La règle de prudence d'origine est conservée et renforcée : la ponctuation est
**exigée** avant le chiffre, qui doit finir le titre ou introduire un
sous-titre. Vérifié qu'on n'invente toujours rien — `1984`,
`Germinal, 1885 édition originale`, `Les Rougon-Macquart (13/20)` et
`Le seigneur des anneaux, J. R. R. Tolkien` ne donnent aucun tome.

**288 vérifications** (5 nouvelles).

### M6 — Open Library choisit les œuvres

**Ce qui change.** Open Library ne décide plus seulement de l'ordre, mais de
**ce qui entre** dans la liste. C'est ce qui écarte les carnets de notes et les
making-of.

**Test.** « harry potter » ne rend que des livres de Rowling en tête.

**Risque, à surveiller.** Filtrer peut faire disparaître un livre légitime
qu'Open Library ignore. À mesurer au banc avant de l'activer : combien de
résultats seraient écartés, et lesquels.

### M7 — Clôture

Remontée dans `PROJET_CONTEXTE_SUIVI_LECTURE.md` §12, suppression de ce plan.

---

## 5. Le critère de fin

Sur le téléphone, sur les sagas de test : **aucune carte ne montre la
couverture ou le résumé d'un autre livre**, le livre cherché est dans les trois
premières cartes sans défiler, et une correction se voit immédiatement sans
attendre 24 h.
