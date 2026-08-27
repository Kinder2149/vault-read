# PLAN DE MISSION — Réparer la recherche

> Document de travail temporaire. Il vit le temps de la mission, puis ses
> décisions retenues remontent dans `PROJET_CONTEXTE_SUIVI_LECTURE.md` (§12,
> retours d'usage) et ce fichier est supprimé.
>
> Cadré le 2026-08-27. Périmètre : la chaîne recherche → affichage. Rien
> d'autre n'est touché : ni la base, ni la bibliothèque, ni les fiches, ni la
> sauvegarde.

---

## 0. Ce qui a été constaté, et ce qui le cause

Six symptômes rapportés, quatre causes réelles trouvées dans le code.

| Symptôme rapporté | Cause |
|---|---|
| Les premiers résultats sont peu pertinents | A |
| Il faut défiler pour voir ce qu'on cherche | A |
| Il faut revenir en arrière pour retrouver ce qu'on avait | B |
| Peu de couvertures en recherche, mais les bonnes dans « autre édition » | C |
| Rien ne semble mis en cache | B (le cache existe pourtant) |
| Un livre connu sans éditeur ni couverture, à côté d'un tome 1 complet | C + D |

### Cause A — personne ne juge la pertinence à part Google

`google.rechercherParTitre` envoie `intitle:<texte>` et l'écran affiche la
réponse **dans l'ordre exact d'arrivée**. `trierResultats` (tomes.js) rend la
liste telle quelle quand le tri vaut « pertinence » : le tri par défaut est
donc l'absence de tri. Rien ne fait remonter le livre dont le titre correspond
exactement, qui a un auteur, un ISBN, un éditeur et une couverture. Les essais
*sur* une œuvre passent devant l'œuvre.

### Cause B — l'écran de recherche est détruit dès qu'on le quitte

`App.jsx` monte l'écran par `{view === 'recherche' && <Recherche …/>}` :
changer d'onglet le démonte. Résultats, pages défilées, tri, position de
défilement — tout est perdu. Au retour on repart de la page 1.

Le cache, lui, fonctionne : mémoire 30 min plus archive IndexedDB servie
directement pendant 24 h (`books.rechercher`). Ce n'est donc pas la donnée qui
manque, c'est l'écran qui se vide. Corriger B suffit à faire disparaître le
symptôme « rien n'est en cache » ; il n'y a rien à ajouter au cache lui-même.

### Cause C — la couverture dépend de l'ISBN, que la recherche par titre n'a presque jamais

`avecCouvertureDeRepli` ne sait aller chercher une couverture Open Library
qu'**à partir d'un ISBN**. Les volumes rendus par `intitle:` sont souvent des
fiches pauvres sans ISBN : aucun repli possible. L'écran des éditions, lui,
interroge la BnF, qui donne toujours ISBN et éditeur — le repli y marche à tous
les coups. D'où l'écart constaté : ce n'est pas la même source qui répond.

### Cause D — aucun regroupement des doublons

Le même livre revient sous plusieurs fiches Google de qualité inégale. Rien ne
les fusionne : `books.suggestions` le fait par empreinte, `books.rechercher`
non. La fiche pauvre s'affiche donc à la place de la bonne, présente plus bas
dans la même liste.

---

## 1. Hypothèse de travail à valider

**La BnF est utilisée largement, plus seulement en secours.** Les tranches 2 et
4 ajoutent **un seul** appel BnF par recherche (pas un par résultat), en
parallèle de Google. Justification : elle a répondu 16 fois sur 16 aux mesures
du 2026-08-25/26, sans clé ni quota, en 76 à 1300 ms, et elle porte exactement
ce qui manque à Google — ISBN et éditeur des livres publiés en France.

Si cette hypothèse est refusée, les tranches 2 et 4 se replient sur les seules
données Google : la fusion reste possible, le gain sur les couvertures devient
marginal.

---

## 2. Les quatre tranches

Une tranche à la fois. Chacune est vérifiée à l'écran avant la suivante.
L'ordre n'est pas négociable : la tranche 1 change ce qui s'affiche en premier,
donc elle change la perception de toutes les autres.

### Tranche 1 — Classer les résultats nous-mêmes

**Ce qui change.** Un score de pertinence calculé dans l'application, sans
aucun appel réseau, appliqué avant tout affichage. Il vit dans `tomes.js` à
côté de `trierResultats` — le seul endroit qui décide déjà d'un ordre.

Ce que le score récompense, par ordre d'importance :
1. le titre correspond exactement à la recherche, puis commence par elle, puis
   la contient ;
2. le livre porte un auteur, un ISBN, un éditeur, une couverture — chaque
   information présente est un signe de fiche sérieuse ;
3. la langue est le français.

Ce qu'il pénalise : les titres nettement plus longs que la recherche, signature
des essais et analyses (« Game of Thrones, une métaphysique des meurtres »).

Le tri « Plus récent » n'est pas touché. Le bloc « La série, dans l'ordre »
n'est pas touché : les tomes gardent leur ordre de numéro.

**Fichiers.** `client/src/tomes.js` (le calcul), `client/src/screens/Recherche.jsx`
(l'appliquer).

**Test.** Chercher « game of thrones », « germinal », « les fourmis »,
« la quête d'Ewilan ». Le livre attendu est dans les trois premières cartes,
sans défiler.

**Risque.** Un score trop sévère peut enterrer un livre légitime au titre long.
Le score classe, il ne filtre jamais : aucun résultat ne disparaît.

**FAIT le 2026-08-27.** Vérifié sur appels réels. Deux ajustements décidés en
cours de route :
- l'**article de tête** est ignoré des deux côtés de la comparaison. Sans cela,
  « A Game of Thrones » de Martin arrivait DERNIER sur une recherche
  « game of thrones », pour un « A » que personne ne tape.
- la pénalité de longueur compte le **sous-titre**, où Google range le propos
  des essais (« Game of Thrones » / « une métaphysique des meurtres »).

Limite constatée et assumée : quand dix livres portent EXACTEMENT le même titre
(« Les fourmis » — le roman de Werber et neuf documentaires jeunesse), le titre
ne départage plus rien, et aucun signal de popularité n'est disponible
(arbitrage 16). Le roman remonte de la 14e à la 9e place, pas en tête. À revoir
seulement si l'usage le confirme comme gênant.

---

### Tranche 2 — Fusionner les doublons

**Ce qui change.** Une seule carte par livre. Les résultats sont regroupés par
empreinte (`books.empreinteOeuvre`, déjà en place et déjà utilisé par les
suggestions) ; le groupe garde la fiche la mieux classée, **complétée** par ce
que les autres fiches du même groupe apportent : éditeur, ISBN, couverture,
résumé, nombre de pages. Une fiche vide et une fiche complète du même livre
donnent une seule carte complète.

Le regroupement se fait dans `books.js` — le seul endroit qui a déjà le droit
de connaître les sources — et non dans l'écran : ainsi la pagination et la
détection de série voient déjà des résultats propres.

**Point d'attention.** Deux éditions réellement différentes du même texte ont
la même empreinte et seront fusionnées en recherche. C'est voulu : le choix
d'édition a son écran dédié (`EditionPicker`), la recherche sert à trouver
*l'œuvre*. En mode ISBN, aucune fusion — un ISBN désigne une édition précise.

**Fichiers.** `client/src/books.js`.

**Test.** Le livre « sans éditeur ni couverture » signalé s'affiche complet,
comme son tome 1. Une recherche de vingt résultats en montre moins, tous
distincts.

**FAIT le 2026-08-27.** Vérifié sur appels réels : « germinal » passe de 20
fiches à 16 cartes, **toutes illustrées** (16 images sur 16 cartes) ; « les
fourmis » passe de 22 à 18 cartes.

Un défaut découvert et corrigé en cours de route : l'écran décidait s'il existe
une page suivante en comptant les **cartes affichées**. La fusion en supprimant,
il concluait « plus rien à charger » et la pagination mourait — c'était le
retour d'usage 101 qui revenait par la fenêtre. La recherche rend désormais
`nbSource`, le compte de ce que la source a réellement donné, et c'est lui qui
décide.

Deux points de conception nés de l'implémentation :
- la fusion est **idempotente** — l'écran refond la liste entière à chaque page
  ajoutée, plutôt que d'écarter les clés déjà vues : la meilleure fiche d'un
  livre arrive souvent en page 2, et l'écarter comme doublon perdrait justement
  l'éditeur et la couverture attendus ;
- une carte fusionnée porte **toutes** ses clés de source (`clesSource`), sinon
  un livre déjà suivi perdait sa coche dès qu'une autre de ses fiches était
  retenue pour l'affichage.

---

### Tranche 3 — Garder l'écran de recherche en vie

**Ce qui change.** L'état de la recherche — texte, mode, résultats, page
atteinte, tri, position de défilement — survit au changement d'onglet et à la
fermeture d'une fiche.

Décision de méthode : on **ne démonte plus** l'écran, on le masque. `App.jsx`
garde `<Recherche>` monté et le cache en CSS quand un autre onglet est actif.
C'est la correction la plus petite qui règle le symptôme, et elle ne déplace
aucun état hors de l'écran — donc aucun risque sur les autres onglets.

Conséquence à surveiller : l'écouteur de défilement de `Recherche.jsx` est posé
sur la fenêtre ; masqué, l'écran ne doit plus charger de pages. Il sera
désactivé quand l'onglet n'est pas actif.

**Fichiers.** `client/src/App.jsx`, `client/src/screens/Recherche.jsx`,
`client/src/styles.css`.

**Test.** Chercher, défiler jusqu'à charger deux pages, aller dans
Bibliothèque, revenir : les mêmes livres, au même endroit, sans aucun
rechargement. Ouvrir une fiche puis la fermer : idem.

**FAIT le 2026-08-27.** Mesuré dans l'application : après une recherche
« la quête d'Ewilan » et un défilement, trois allers-retours entre les onglets
(Ma lecture, Réglages, Bibliothèque) laissent **12 cartes sur 12**, la position
de défilement au pixel près, le texte de la recherche intact, et **zéro appel
réseau supplémentaire** (2 avant, 2 après).

Trois points de conception :
- l'écran est **masqué**, pas démonté — `display: none`, pour qu'il n'occupe
  aucune hauteur sous l'onglet affiché ;
- le défilement automatique est **coupé** quand l'écran est masqué : celui
  qu'il verrait est celui d'un autre onglet ;
- ses **surcouches ne sont pas rendues** pendant le masquage. Une fiche
  ouverte resterait sinon dans le document, invisible, et le bouton retour
  d'Android — qui cherche `.sheet` — aurait fermé une fenêtre que personne ne
  voit au lieu de revenir à l'accueil. L'état est conservé : revenir sur
  l'onglet rouvre la fiche.

La position de défilement est notée **en continu** tant que l'écran est
visible, et non au moment de le masquer : à cet instant la page a déjà perdu sa
hauteur et le navigateur a ramené le défilement à zéro.

---

### Tranche 4 — Combler les couvertures et les éditeurs manquants

**Ce qui change.** Un appel BnF unique lancé **en parallèle** de la recherche
Google (mode titre et auteur ; jamais en ISBN, déjà couvert). Ses notices sont
rapprochées des résultats Google par empreinte, et servent à compléter ce qui
manque : ISBN, éditeur, année. L'ISBN ainsi récupéré ouvre le repli couverture
Open Library qui existe déjà — aucune requête d'image supplémentaire.

Les notices BnF sans correspondance Google ne sont **pas** ajoutées à la liste :
leur pertinence est mauvaise (cf. `books.js`, commentaire du filet BnF). Elles
complètent, elles n'apportent pas de résultats.

Si la BnF ne répond pas, la recherche s'affiche exactement comme aujourd'hui :
cet appel n'est jamais bloquant et n'a pas de repli.

Le mécanisme de rapprochement par empreinte est le même qu'en tranche 2, ce qui
explique l'ordre : la tranche 2 le construit, la tranche 4 le réutilise.

**Fichiers.** `client/src/books.js`.

**Test.** Une grille de vingt résultats est illustrée presque partout, et
l'éditeur apparaît sur les fiches qui n'en avaient pas.

**FAIT le 2026-08-27 — avec un résultat plus nuancé que prévu.**

Mesure sur **114 volumes réels**, six recherches (germinal, les fourmis, la
horde du contrevent, la quête d'Ewilan, le nom de la rose, la peste) :

| Ce que la BnF ajoute | Gain |
|---|---|
| Éditeurs | **+18 volumes (16 %)** |
| ISBN | +4 volumes (3,5 %) |
| Couvertures rendues possibles | +4 volumes (3,5 %) |

**L'éditeur est le vrai gain, pas la couverture.** Google porte déjà un ISBN
dans la grande majorité des cas, et là où il n'en a pas, la BnF ne connaît
souvent pas le livre non plus. La tranche a donc raté sa cible annoncée et en a
atteint une autre. Deux exemples nets : « la horde du contrevent » passe de 11
volumes sans éditeur à 1, « le nom de la rose » de 11 à 5.

**Correction du diagnostic du §0.** L'écart de couvertures ressenti entre la
recherche et l'écran des éditions venait surtout de la **cause D**, pas de la
cause C : c'est la fusion des doublons (tranche 2) qui réunit sur une seule
carte la fiche portant l'image et celle portant l'ISBN. Un A/B en conditions
réelles confirme : sur « la horde du contrevent », couper la BnF ne change
strictement rien à l'affichage (16 cartes, 15 illustrées, dans les deux cas).

**Gardée quand même** : un appel sans clé ni quota, lancé en parallèle donc
sans attente supplémentaire, pour 16 % d'éditeurs en plus. Il se paie de
lui-même — et il remplace l'appel de secours qui existait déjà, au lieu de s'y
ajouter, quand Google tombe.

---

## 3. Ce qui n'est PAS dans cette mission

- Changer de source principale de découverte. Google reste le moteur.
- Toucher à la base, aux migrations, à la sauvegarde.
- Toucher aux écrans Bibliothèque, Ma Lecture, Réglages.
- Ajouter un réglage ou une option à l'utilisateur. Chaque tranche améliore le
  comportement par défaut, sans rien demander (§9).
- Modifier le cache : il fonctionne, la tranche 3 suffit.

## 4. Test final, après les quatre tranches

Sur l'appareil, en une session : chercher successivement un roman connu, une
saga, un auteur, puis scanner un ISBN. Aller et venir entre les onglets. Le
critère est simple — **ne jamais avoir à défiler pour trouver ce qu'on
cherchait, et ne jamais rien reperdre en changeant d'écran.**

---

## 5. Reprise après audit — le besoin, relu (2026-08-27)

Les quatre premières tranches traitaient la chaîne **en aval** de la réponse de
Google : l'ordre, les doublons, la persistance, l'enrichissement. Un audit sur
données réelles a montré que le haut de l'écran — c'est-à-dire ce que
l'utilisateur voit en premier — n'avait jamais été examiné, et que le manque
principal était ailleurs.

### Ce que l'audit a trouvé

**Un défaut livré en tranche 1.** Sur « germinal », trois pages chargées, une
édition russe (« Germinal / Жерминаль ») arrivait **première**. La comparaison
de titres réduit tout à l'alphabet latin : le cyrillique disparaissait avant
d'être compté, le titre passait pour une correspondance parfaite et n'écopait
d'aucune pénalité de longueur. Le classement changeait donc sous les yeux de
l'utilisateur au fil du défilement.

**Un défaut jamais examiné : le bloc « La série, dans l'ordre ».** Placé avant
tout le reste, il était faux sur deux plans. Il **mélangeait des séries
différentes** — sur « la quête d'Ewilan », les tomes 1 de *La Quête d'Ewilan*,
des *Mondes d'Ewilan* et de *L'Autre* dans un seul bloc, parce que le
regroupement se faisait sur le NUMÉRO et jamais sur le nom. Et il **faisait
passer une adaptation avant l'œuvre** : sur « game of thrones », la bande
dessinée *La Bataille des rois* occupait le haut de l'écran.

**Un doublon que la fusion ne voyait pas.** Sur « germinal » : `emile zola`
(28 fiches), `Zola, Emile` (3 fiches) — deux cartes pour un seul roman, l'ordre
du nom suffisant à les séparer.

**Un signal gratuit inutilisé.** Après fusion, le nombre d'éditions est connu :
28 pour le Germinal de Zola, 8 pour Le nom de la rose d'Eco, au plus 3 pour
tout le reste. C'est la seule approximation de notoriété disponible.

**Une hypothèse écartée par la mesure.** Mettre le titre entre guillemets dans
la requête Google (`intitle:"..."`) : sur 6 recherches, aucun gain — et sur
« la quête d ewilan », **zéro résultat** au lieu de sept tomes. Abandonnée.

**Une inquiétude vérifiée et non fondée.** La fusion n'écrase jamais deux tomes
différents : contrôlé sur 234 volumes réels, zéro cas. Le numéro de tome est
toujours dans le titre, jamais seulement dans le sous-titre.

### Le manque structurel

Sur « les fourmis » ou « le nom de la rose », dix livres portent exactement le
même titre. Aucun signal ne permet de **deviner** lequel est voulu — et
l'application ne permettait pas non plus de le **dire** : les modes Titre,
Auteur et ISBN s'excluent. Mesuré, titre + auteur combinés donnent le bon livre
en premier résultat dans **quatre cas sur quatre**.

### Les quatre corrections, faites et vérifiées

| # | Correction | Vérifié dans l'application |
|---|---|---|
| 1 | **Champ auteur facultatif** en mode Titre ; `intitle:` + `inauthor:` | « les fourmis » seul → Werber 4ᵉ ; + « werber » → **1ᵉʳ**. « game of thrones » + « martin » → le roman de Martin **1ᵉʳ** |
| 2 | **Séries nommées, placées selon leur pertinence** | « la quête d'Ewilan » → un bloc **« La Quête d'Ewilan — 6 tomes »**, les autres cycles hors du bloc. « game of thrones » → deux séries distinctes et nommées, plus en tête d'office |
| 3 | **Clé de regroupement insensible à l'ordre du nom** | « germinal » → une carte pour le roman |
| 4 | **Notoriété plafonnée + mots comptés sur le titre brut** | « germinal » → Zola 1ᵉʳ, l'édition russe passe 4ᵉ ; 15 cartes sur 15 illustrées |

**Décision de conception importante** : la correction 3 crée une clé de
regroupement **propre à la recherche**. L'empreinte d'œuvre de `books.js` n'est
pas touchée — elle est écrite en base et sert de clé étrangère (§3.2) ; la
changer demanderait une migration. Deux besoins, deux fonctions.

**Limite assumée** : une translittération (« Эмиль Золя ») ne rejoint pas
« Emile Zola ». Les deux noms ne partagent aucune lettre, et les rapprocher
demanderait une règle qu'on ne sait pas écrire sans risque.

**Seul changement d'interface de toute la mission** : le champ auteur. Il est
facultatif, discret, et n'apparaît qu'en mode Titre.
