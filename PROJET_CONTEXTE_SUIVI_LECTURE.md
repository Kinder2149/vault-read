# PROJET_CONTEXTE — « Suivi Lecture »

> Document de référence du projet. Il fixe les décisions ; il ne décrit pas du
> code qui n'existe pas encore, et il est tenu à jour quand une décision se
> révèle fausse à l'usage.
>
> **Dépôt** : https://github.com/Kinder2149/TBDB-_-The-Book-DataBase
> **État au 2026-08-21** : les huit tranches du §8 sont écrites et vérifiées sur
> appareil, plus une série de corrections d'usage (§12). Ce qui reste à faire
> est listé au §11 — c'est court, et cela dépend du matériel de Kinder.
>
> Ce projet est le **second** d'une famille. Le premier — « Suivi Films & Séries » —
> est en production sur Android. Son document d'extraction technique
> (`EXTRACTION_TECHNIQUE_SUIVI_FILMS_SERIES.md`) est la source de toutes les
> décisions marquées « héritée ». Les décisions marquées « écart » s'en éloignent
> volontairement, avec leur raison.

---

## 0. L'application en une phrase

Application **React mono-page, 100 % locale et hors-serveur**, empaquetée en
**application Android via Capacitor**, qui interroge **Google Books** (et
**Open Library** en secours) directement depuis le client, et stocke toute la
bibliothèque de l'utilisateur dans un **SQLite embarqué dans l'appareil**.

Aucun compte, aucune synchronisation, aucun serveur, aucun abonnement.
Aucune donnée ne quitte l'appareil.

---

## 1. Stack — héritée sans discussion

| Élément | Valeur |
|---|---|
| Langage | **JavaScript ESM pur** (`"type": "module"`). Pas de TypeScript. |
| Framework | **React 18**, composants fonctionnels + hooks uniquement |
| Bundler | **Vite 6** + `@vitejs/plugin-react` |
| Paquets | **npm** |
| Base locale | **SQLite** : `sql.js` (WASM) au navigateur, `@capacitor-community/sqlite` sur Android |
| Persistance web | `idb-keyval` (dump binaire de la base dans IndexedDB) |
| Empaquetage | **Capacitor 8** (`@capacitor/core`, `/android`, `/app`, `/filesystem`, `/share`) |
| Router | **aucun** — un `switch` sur l'onglet actif |
| Librairie d'état | **aucune** — le composant racine est le store |
| CSS | **un seul fichier global écrit à la main**, nommage BEM, tokens en variables CSS |
| Dates | manipulation de chaînes ISO, aucune librairie |
| Icônes | SVG maison, **aucun émoji** (rendus en carré vide sur certains Android) |
| Lint / tests | aucun (assumé) |

**Règle de dépendances : on n'ajoute une dépendance que si elle est native
(Capacitor) ou impossible à écrire en moins de 50 lignes.** Le projet séries
tourne avec 11 dépendances et un APK de 13 Mo ; c'est la cible.

Seule dépendance nouvelle prévue, et seulement à la tranche 7 :
`@capacitor-mlkit/barcode-scanning` pour le scan de code-barres ISBN.

---

## 2. Architecture — héritée, non négociable

Quatre couches, dans cet ordre strict :

```
composants (.jsx)  →  api.js  →  store.js  →  db.js
                        ↘  books.js  →  sources/google.js
                                        sources/openlibrary.js
```

**Règles absolues :**

1. **Aucun composant n'importe autre chose que `api.js`** (+ `status.js`,
   `types.js` et `notify.js`). Pas de `db.js`, pas de `store.js`, pas de
   `books.js` dans un `.jsx`. `notify.js` est dans la liste parce que le canal
   d'erreurs traverse toutes les couches par construction (§7) : c'est un
   canal, pas une donnée métier. Seules exceptions tolérées au-delà :
   l'écran de sauvegarde importe `backup.js` et `files.js`.
2. **`api.js` est une façade à signatures stables, toutes `async` dès le premier
   jour**, même quand l'implémentation est synchrone. C'est ce qui a permis au
   projet séries de supprimer un serveur Express entier sans toucher un seul
   écran. Toute fonction de la façade injecte elle-même le profil actif.
3. **Un seul `fetch` par source externe**, dans `sources/*.js`. Nulle part ailleurs.
4. **`books.js` est le seul endroit qui connaît l'existence de deux sources.**
   `store.js` et l'UI ne savent pas d'où vient une donnée.
5. **`api.js` est le seul à orchestrer les deux branches.** Une fonction qui a
   besoin du réseau *et* de la base appelle `books.js` puis `store.js`, dans cet
   ordre, depuis `api.js`. **`store.js` n'importe jamais `books.js`** : c'est ce
   qui garantit la règle 4 au lieu de la souhaiter. `api.js` ne contient pour
   autant aucune règle métier : il enchaîne, il ne décide pas.

### 2.1 `api.js` — les signatures, figées avant d'écrire le reste

Toutes `async`, toutes injectant le profil actif elles-mêmes. **C'est le contrat
du projet : ces noms ne changent plus.** Si une implémentation devient
impossible, on change l'implémentation, pas la signature.

Précision apportée après relecture : le gel porte sur la **modification** et la
**suppression**, pas sur l'ajout. Une tranche qui découvre un besoin légitime
**ajoute** une signature ; elle n'en tord jamais une existante. Sans cette
nuance, la façade aurait été violée dès la tranche 5 (édition audio, §5.5).

```
// Profils
listProfiles()                       createProfile(name)
renameProfile(id, name)              deleteProfile(id)
getActiveProfileId()                 setActiveProfileId(id)

// Catalogue (lecture seule, réseau)
rechercher(texte, mode)              // mode: 'titre'|'auteur'|'isbn'
getSuggestions()

// Bibliothèque
getBibliotheque()                    // toutes les œuvres du profil + édition active
getOeuvre(oeuvreId)
ajouterOeuvre(resultat)              // crée œuvre + première édition, 1 transaction
retirerOeuvre(oeuvreId)
setStatut(oeuvreId, statut)
setNote(oeuvreId, note)

// Éditions
getEditions(oeuvreId)                ajouterEdition(oeuvreId, resultat)
ajouterEditionManuelle(oeuvreId, saisie)  // édition créée à la main : audio, VO, exemplaire non catalogué
setEditionActive(oeuvreId, editionId)
supprimerEdition(editionId)
setMetrique(editionId, metriques)    // { nbPages } ou { dureeMinutes } — une seule des deux

// Identité
regrouperOeuvres(sourceId, cibleId)  detacherEdition(editionId)

// Progression
setPosition(oeuvreId, position)      getProgression(oeuvreId)   // local, sans réseau

// Cycles
setCycle(oeuvreId, nom, tome)        // pose cycle_manuel = 1
listCycles()                         // pour l'autocomplétion

// Listes
getListes()                          createListe(name)
deleteListe(id)                      getListeItems(id)
addToListe(listeId, oeuvreId)        removeFromListe(listeId, oeuvreId)
```

Règle héritée du projet séries : **ajouter à une liste implique de suivre**.
`addToListe` appelle `ajouterOeuvre` si nécessaire.

### 2.2 Arborescence cible

```
client/
├── index.html
├── vite.config.js
├── capacitor.config.json
├── .env.example              ← VITE_GOOGLE_BOOKS_API_KEY (optionnelle)
├── public/
│   ├── assets/sql-wasm.wasm  ← copié à la main, non résolu par le bundler
│   ├── icon.svg
│   ├── manifest.json
│   └── sw.js                 ← passthrough, uniquement pour l'installabilité PWA
├── src/
│   ├── main.jsx              ← bootstrap + pose du thème AVANT le rendu
│   ├── App.jsx               ← coquille + état partagé + navigation. Cible : < 300 lignes
│   ├── screens/
│   │   ├── Recherche.jsx
│   │   ├── MaLecture.jsx
│   │   ├── Bibliotheque.jsx
│   │   └── Reglages.jsx
│   ├── api.js                ← FAÇADE
│   ├── store.js              ← métier + SQL
│   ├── db.js                 ← schéma + migrations + 2 moteurs
│   ├── books.js              ← orchestration des sources + normalisation
│   ├── sources/
│   │   ├── google.js
│   │   └── openlibrary.js
│   ├── types.js              ← @typedef JSDoc — voir §7
│   ├── status.js             ← les 4 statuts + règles dérivées
│   ├── backup.js
│   ├── files.js
│   ├── notify.js             ← canal d'erreurs unique
│   ├── styles.css
│   └── components/
│       ├── Icon.jsx  SearchBar.jsx  BookCard.jsx  Detail.jsx
│       ├── Modal.jsx  Toast.jsx  EditionPicker.jsx  ProgressBar.jsx
│       ├── Progression.jsx  ← ajouté en tranche 5 : le Modal « J'en suis à… »
│       ├── Backup.jsx  About.jsx  ProfileSelector.jsx
│       └── ErrorBoundary.jsx  ← seul composant classe du projet (voir §7.5)
└── android/
```

### 2.3 Conventions

- Composants : `PascalCase.jsx`, un par fichier, `export default function`.
- Modules logiques : `camelCase.js` court, **exports nommés uniquement**.
- Colonnes SQL : `snake_case`. Champs JS : `camelCase`. **La conversion se fait
  dans le SELECT par des alias** (`SELECT o.cycle_tome AS cycleTome`), il n'existe
  aucune fonction de mapping.
- Classes CSS : BEM strict, modificateurs `.on` / `.is-active`.
- UI et commentaires **en français**. Les commentaires expliquent le **pourquoi**
  (décision appliquée, piège évité), jamais le comment. Chaque fichier s'ouvre
  sur un bloc de 3–6 lignes qui dit son rôle et ses règles.

---

## 3. Modèle de données

### 3.1 Décision structurante : Œuvre + Éditions

Une **œuvre** est le livre en tant que texte (« Dune », Frank Herbert).
Une **édition** est un exemplaire concret : poche, broché, numérique, audio, VO.

Le suivi (statut, progression, note, listes) est porté par **l'œuvre**.
Les métadonnées physiques (ISBN, nombre de pages, éditeur, format) sont portées
par **l'édition**. Une œuvre a une **édition active** : celle qu'on lit, celle
qui donne le nombre de pages servant à la progression.

### 3.2 Identité d'une œuvre

**Open Library est l'autorité d'identité du projet**, parce que c'est la seule
des deux sources qui possède déjà le modèle Œuvre / Édition : une œuvre y est la
collection logique des éditions d'un même texte (traductions, rééditions), une
édition portant l'ISBN, l'éditeur et la jaquette. Google Books, lui, ne connaît
que des volumes — c'est-à-dire des éditions.

La clé d'œuvre est donc **résolue, pas devinée**. Les trois chemins ci-dessous
forment une **cascade**, pas des cas exclusifs — correction apportée en
tranche 1 après mesure sur 37 livres français réels :

| Chemin | Taux de résolution mesuré |
|---|---|
| 1. ISBN chez Open Library | **35 %** |
| 2. puis recherche titre + auteur | **+43 %** |
| 3. puis titre nettoyé de sa mention de tome | **+11 %** |
| échec → empreinte locale | **~11 %** |

Le contexte présentait l'ISBN comme « le chemin normal » et la recherche comme
le cas des livres sans ISBN. **C'est faux pour l'édition française** : beaucoup
d'ISBN français répondent 404 chez Open Library alors que le livre y existe
sous son titre. En chemin exclusif, l'ISBN seul laissait 65 % des livres en
empreinte locale — or l'empreinte est censée être un filet pour « les vieux
fonds, l'autoédition et les livres non catalogués ».

Ordre appliqué :

1. ISBN connu → `GET /isbn/{isbn}.json` → le champ `works[0].key`
   → `oeuvre_id = "ol:OL45883W"`. **C'est le chemin normal.**
2. Pas d'ISBN → `GET /search.json?q=…&fields=key,title,author_name,editions`
   (une seule requête rend l'œuvre et ses éditions imbriquées) → clé de la
   meilleure correspondance.
2 bis. Recherche infructueuse → **même recherche, titre nettoyé de sa mention
   de tome** (« Dune - Tome 5 Les Hérétiques de Dune » → « Dune Les Hérétiques
   de Dune »). Les titres français portent le tome dans le titre ; Open Library
   indexe surtout la VO et ne reconnaît alors plus rien. Mesuré : 4 échecs sur 6
   résolus. Le second appel n'est payé que si le premier a échoué.
3. Livre absent d'Open Library ou sans ISBN → **empreinte locale**
   `oeuvre_id = "fp:dune|frank-herbert"` (titre + auteurs, minuscules,
   accents et ponctuation retirés, sous-titre après `:` coupé).
   C'est un **filet, pas le mécanisme principal** : il ne doit concerner que les
   vieux fonds, l'autoédition et les livres non catalogués.

**Forme exacte de l'empreinte** : `fp:<titre>|<premier auteur>`, minuscules,
accents et ponctuation retirés, sous-titre coupé.

*J'avais arbitré en relecture une variante « tous les auteurs, triés », pour
rendre l'empreinte indépendante de l'ordre. **Les appels réels l'ont invalidée** :
`author_name` d'Open Library mélange les translittérations dans la même liste
(pour Dune : `['Frank Herbert', 'Френк Герберт']`), et trier aurait fait entrer
du cyrillique dans la clé. Retour à la formulation d'origine du contexte, qui
était la bonne : le premier auteur concorde entre les deux sources sur tous les
cas observés.*

**Domicile unique du calcul** : une fonction `empreinteOeuvre(titre, auteurs)`
exportée par `books.js`, appelée de partout, écrite **une seule fois**. Le projet
séries a laissé son équivalent (`keyOf`) se redéfinir dans quatre fichiers ; deux
normalisations légèrement différentes de la même clé, c'est la déduplication qui
tombe sans bruit.

**Deux rattrapages obligatoires dans la fiche**, parce que l'identité est
faillible dans les deux sens :

- **Regrouper** — « Rattacher à une œuvre existante » : l'empreinte a créé deux
  œuvres pour un même livre.
- **Séparer** — « Détacher cette édition » : Open Library documente que des
  éditeurs ont réutilisé un même ISBN pour des ouvrages sans rapport. Le
  détachement crée une nouvelle œuvre à partir de l'édition, en
  **`fp:<uuid>`** — pas en empreinte calculée. Raison : l'empreinte est
  déterministe, elle reproduirait exactement la clé de l'œuvre qu'on quitte et
  `INSERT OR IGNORE` rendrait le détachement silencieusement sans effet. Le
  préfixe reste `fp:` : il signifie « identité locale, non résolue », et c'est
  lui qui déclenche la mention « identification incomplète » (§6).
  La nouvelle œuvre hérite du **titre et des auteurs portés par l'édition**
  (§3.3), et d'elle seule : c'est précisément le cas où le titre de l'œuvre
  d'origine est faux.

**Arbitrage du regroupement** (le contexte était muet, et le suivi entre en
collision des deux côtés) : **la cible gagne**. Statut, note, position, dates et
cycle de l'œuvre cible sont conservés tels quels ; la source lui apporte ses
éditions et ses appartenances de liste (fusionnées en `INSERT OR IGNORE`), puis
disparaît. L'opération est irréversible hors sauvegarde : Modal de confirmation
qui **nomme les deux œuvres et dit ce qui est perdu**.

Ces deux actions écrivent en une transaction : déplacement de la ou des lignes
`editions`, recalcul de `edition_active`, réaffectation des `liste_items`.

### 3.3 Schéma SQL

Défini une seule fois en constante `SCHEMA` dans `db.js`, exécuté à chaque
ouverture en `CREATE TABLE IF NOT EXISTS`, précédé de `PRAGMA foreign_keys = ON`.

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,               -- crypto.randomUUID(), portable
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oeuvres (
  profile_id      TEXT NOT NULL,
  oeuvre_id       TEXT NOT NULL,             -- voir §3.2
  titre           TEXT NOT NULL,
  auteurs         TEXT,                      -- "A, B" — pas de table auteurs en V1
  annee           TEXT,
  date_publication TEXT,                     -- 'YYYY-MM-DD' ou 'YYYY'
  couverture_url  TEXT,
  resume          TEXT,                      -- cliché complet, voir §3.4
  categories      TEXT,
  langue          TEXT,
  cycle_nom       TEXT,                      -- nom de la saga, si connu
  cycle_tome      INTEGER,                   -- numéro de tome, si connu
  cycle_manuel    INTEGER NOT NULL DEFAULT 0,-- 1 = corrigé à la main, ne jamais écraser
  statut          TEXT NOT NULL DEFAULT 'a_lire',   -- a_lire|en_cours|lu|abandonne
  note            INTEGER,                   -- 1..5, NULL si non noté
  position        INTEGER NOT NULL DEFAULT 0,-- page courante, ou minute si audio
  edition_active  TEXT,                      -- edition_id
  ajoute_le       TEXT NOT NULL DEFAULT (datetime('now')),
  commence_le     TEXT,
  termine_le      TEXT,
  PRIMARY KEY (profile_id, oeuvre_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS editions (
  profile_id       TEXT NOT NULL,
  edition_id       TEXT NOT NULL,            -- "gb:<volumeId>" | "ol:<olid>" | "manuel:<uuid>"
  oeuvre_id        TEXT NOT NULL,
  source           TEXT NOT NULL,            -- 'google'|'openlibrary'|'manuel'
  titre            TEXT NOT NULL,            -- titre de CETTE édition (VO, retraduction, titre alternatif)
  auteurs          TEXT,                     -- idem ; sans ces deux colonnes, "Détacher" est impossible (§3.2)
  format           TEXT NOT NULL DEFAULT 'papier',  -- papier|numerique|audio
  isbn13           TEXT,
  isbn10           TEXT,
  editeur          TEXT,
  date_publication TEXT,
  nb_pages         INTEGER,
  duree_minutes    INTEGER,                  -- audio uniquement
  couverture_url   TEXT,
  langue           TEXT,
  ajoute_le        TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, edition_id),
  FOREIGN KEY (profile_id, oeuvre_id) REFERENCES oeuvres(profile_id, oeuvre_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS listes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (profile_id, name),                 -- la sauvegarde exporte les listes par leur nom (§3.6) :
                                             -- deux homonymes rendraient l'export non réversible
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS liste_items (
  liste_id   INTEGER NOT NULL,
  profile_id TEXT NOT NULL,
  oeuvre_id  TEXT NOT NULL,
  added_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (profile_id, liste_id, oeuvre_id),   -- écart : le projet séries laissait profile_id
                                                   -- hors de la clé, et payait à chaque restauration
  FOREIGN KEY (liste_id) REFERENCES listes(id) ON DELETE CASCADE,
  FOREIGN KEY (profile_id, oeuvre_id) REFERENCES oeuvres(profile_id, oeuvre_id) ON DELETE CASCADE
);

-- Index : le projet séries n'en avait aucun, parce que chacune de ses tables se
-- lisait par sa clé primaire. Ici, editions et liste_items se lisent presque
-- toujours par oeuvre_id, qui n'est dans aucune clé primaire : sans ces deux
-- lignes, getEditions, getBibliotheque, regrouper et détacher balayent la table.
CREATE INDEX IF NOT EXISTS idx_editions_oeuvre    ON editions(profile_id, oeuvre_id);
CREATE INDEX IF NOT EXISTS idx_liste_items_oeuvre ON liste_items(profile_id, oeuvre_id);
```

**`sessions_lecture` ne fait pas partie de la v1.** Elle appartient à la
migration **v2**, écrite à la tranche 6 avec les signatures de façade qui la
servent. La laisser dans `SCHEMA` en la commentant « ne pas créer avant d'en
avoir l'usage » était contradictoire : `SCHEMA` **est** la v1 et s'exécute au
jour 1. Bénéfice second : le mécanisme de migration est réellement exercé une
fois, au lieu de rester un dispositif jamais emprunté.

```sql
-- migration v2, tranche 6 uniquement
CREATE TABLE IF NOT EXISTS sessions_lecture (
  profile_id   TEXT NOT NULL,
  oeuvre_id    TEXT NOT NULL,
  jour         TEXT NOT NULL,                -- 'YYYY-MM-DD'
  position_fin INTEGER NOT NULL,
  PRIMARY KEY (profile_id, oeuvre_id, jour),
  FOREIGN KEY (profile_id, oeuvre_id) REFERENCES oeuvres(profile_id, oeuvre_id) ON DELETE CASCADE
);
```

**Deux pièges `sql.js` vérifiés à l'exécution en tranche 0** — à ne jamais
redécouvrir, car aucun des deux ne produit d'erreur :

1. **`db.export()` recycle la connexion SQLite**, et `PRAGMA foreign_keys` est un
   réglage **de connexion**. Comme le moteur navigateur exporte après *chaque*
   écriture (§3.2 du projet séries), les clés étrangères sont actives à
   l'ouverture puis **silencieusement mortes dès la deuxième écriture** : plus
   aucune cascade, juste des lignes orphelines. Le PRAGMA est donc reposé
   **après chaque export**, pas seulement à l'ouverture.
2. **`PRAGMA foreign_keys = ON` ne prend pas via `db.run()`**, seulement via
   `db.exec()`. La porte `exec` du moteur navigateur utilise `db.exec`.
   Corollaire : `PRAGMA` n'accepte pas d'alias de colonne
   (`PRAGMA foreign_keys AS v` est une erreur de syntaxe que sql.js remonte
   **sans message**).

**Principes hérités, à conserver tels quels :**

- `profile_id` est **dans la clé primaire** de chaque table, pas une simple
  colonne : le multi-profil est structurel.
- Clé métier composite en clé primaire → `INSERT OR IGNORE` suffit à
  l'idempotence, aucun code de déduplication nulle part.
- Toutes les dates sont des **chaînes**, comparées lexicographiquement.
  **Écart : « aujourd'hui » se calcule en heure locale, pas en UTC.** Le projet
  séries utilise `new Date().toISOString().slice(0,10)` et se décale d'un jour en
  soirée (défaut encore présent chez lui). Une fonction `aujourdhui()` dans
  `status.js`, et elle seule.
- **Volumétrie cible : 2 000 œuvres.** Repère mesuré sur le projet séries :
  432 titres et 4 109 épisodes, restauration en moins de 6 s sur téléphone. Le
  cliché complet (§3.5) alourdit chaque ligne mais une bibliothèque de lecture
  compte bien moins de lignes qu'un suivi de séries. Au-delà de 2 000 œuvres, le
  dump intégral dans IndexedDB après chaque écriture est à remettre en question.
- `crypto.randomUUID()` pour les profils : portable d'un appareil à l'autre,
  c'est ce qui rend la restauration possible.
- Les listes sont exportées **par leur nom**, pas par leur id auto-incrémenté.

### 3.4 Migrations — à poser au jour 1 (écart, dette payée)

Le projet séries n'a aucun mécanisme de migration et le regrette. Ici :

```js
const MIGRATIONS = [
  /* v1 */ SCHEMA,
  /* v2 */ SESSIONS_LECTURE,   // tranche 6 — première migration réelle du projet
];
// lire PRAGMA user_version, appliquer les migrations manquantes en transaction,
// écrire PRAGMA user_version = MIGRATIONS.length
```

Vingt lignes, écrites avant la première ligne de métier.

### 3.5 Cliché complet (écart assumé)

Le projet séries ne stocke que 7 champs et refetch tout le reste, parce qu'une
série évolue. **Un livre publié ne change jamais** : on stocke donc le résumé,
les catégories, l'éditeur, la pagination, les ISBN.

Conséquence directe et voulue : **hors ligne, tout fonctionne sauf la recherche
et l'ajout.** Fiches, progression, listes, statuts, sauvegarde : tout est local.

### 3.6 Format de sauvegarde

```jsonc
{
  "format": "suivi-lecture",
  "version": 1,
  "exportedAt": "…",
  "profile": { "id": "<uuid>", "name": "…" },
  "oeuvres":  [ { …tous les champs, sans profile_id… } ],
  "editions": [ { …tous les champs, sans profile_id… } ],
  "listes":   [ { "name": "…", "createdAt": "…", "items": [ { "oeuvreId", "addedAt" } ] } ]
}
```

Le fichier porte **un seul profil**. Trois cas à la restauration, tranchés :
l'`id` du fichier existe déjà → ce profil est **vidé puis remplacé**, et la
confirmation le **nomme** ; l'`id` n'existe pas → le profil est **créé avec cet
id** et activé ; dans les deux cas les autres profils ne sont **jamais** touchés.
C'est l'UUID portable qui rend cela possible.

**Précision apportée en tranche 3 : « une seule transaction » vaut pour les
œuvres et les éditions, pas pour les listes.** Le vidage et la réinsertion de
toutes les œuvres et éditions tiennent en un seul `executeSet(..., true)` — la
partie volumineuse, celle qui coûtait plus d'une minute au projet séries. Les
listes suivent ensuite, une par une : chacune a besoin de l'`id`
auto-incrémenté que l'insertion précédente vient de produire, ce qu'un lot
préparé à l'avance ne peut pas connaître. Leur volume est négligeable.

Restauration : valider le `format` et refuser une `version` supérieure → décrire
le contenu en clair à l'utilisateur → **confirmation explicite** → vider le
profil → réinsérer **en une seule transaction** (`executeSet(..., true)` sur
Android, sinon plus d'une minute au lieu de 6 secondes) → filtrer les items de
liste orphelins avant insertion, sinon la clé étrangère composite explose.

Export additionnel : **CSV Goodreads** (`Title, Author, ISBN, My Rating,
Date Read, Bookshelves`), en annonçant ce qui est écarté.

---

## 4. Sources de données

**Répartition des rôles — décision structurante :**

> **Google Books découvre. Open Library identifie.**
>
> Google Books a la meilleure pertinence en français, les meilleurs résumés et
> les meilleures couvertures : c'est lui qui répond quand on tape du texte.
> Open Library a le modèle Œuvre / Édition : c'est lui qui décide de ce qui est
> « le même livre », dès qu'un ISBN est disponible.
>
> Un livre trouvé chez Google est **résolu chez Open Library** par son ISBN.
> **Mais l'ajout n'attend pas cette résolution** — correction d'usage du
> 2026-08-21, après mesure : l'écriture en base prend 4 ms, la résolution
> jusqu'à 12 s. Le livre entre donc immédiatement avec ce qu'on sait déjà
> (identité en cache, ou empreinte locale), et l'identité est **promue en
> tâche de fond** quand Open Library répond. C'était déjà la lettre de cette
> section — « la résolution ne bloque jamais l'ajout » — que l'implémentation
> ne respectait pas.

### 4.1 Google Books — découverte

- Base : `https://www.googleapis.com/books/v1`
- Endpoints : `/volumes?q=…`, `/volumes/{volumeId}`
- Opérateurs de requête : `intitle:`, `inauthor:`, `isbn:`, `subject:`
- Clé API **obligatoire en pratique**. Sans clé, les requêtes de tous les
  clients d'une même application sont comptées ensemble par Google et se font
  rejeter alors qu'on n'a personnellement lancé que trois recherches. La clé
  vit dans `VITE_GOOGLE_BOOKS_API_KEY` et est donc **embarquée en clair dans
  l'APK** — décision identique au projet séries et assumée : catalogue public,
  aucune donnée personnelle, aucun budget exposé. Pas de relais serveur.
  Restreindre la clé à la seule Books API dans la console Google Cloud.
  **Ne PAS poser de restriction « Applications Android »** : elle exige des
  en-têtes de paquet et d'empreinte que `CapacitorHttp` n'émet pas, et la clé
  serait rejetée sur l'appareil. La restriction par API est la seule qui
  fonctionne ici.
  **La clé apparaît en clair dans `logcat`** : `CapacitorHttp` journalise l'URL
  complète, paramètres compris. Constaté en tranche 0. C'est une exposition de
  plus que le seul APK — assumée pour un catalogue public, mais à connaître.
  La vraie clé vit dans `client/.env` (ignoré par git), **jamais** dans
  `.env.example`, qui est un modèle versionné.
  **En revanche, NE PAS poser de restriction « application Android » sur la
  clé** : ce garde-fou repose sur les en-têtes `X-Android-Package` et
  `X-Android-Cert` que seul le SDK Google ajoute. Nos appels passent par
  CapacitorHttp, en HTTP brut : la clé serait rejetée à chaque requête.
  Conséquence assumée, cohérente avec la décision ci-dessus : la clé reste
  extractible de l'APK, et un tiers qui la pompe consomme le quota.
- **Constaté dès le premier appel réel (tranche 0) : sans clé, Google Books
  répond `HTTP 429`.** La prédiction « la clé est obligatoire en pratique » est
  donc vérifiée, pas théorique : il n'y a pas de mode dégradé sans clé.
- **Quota par défaut : 1 000 requêtes par jour** (augmentable sur demande, mais
  on ne compte pas dessus). D'où une discipline d'appels non négociable :
  minimum **3 caractères** avant de lancer une recherche, debounce 350 ms,
  `maxResults=20`, cache mémoire TTL 30 min sur les résultats, et **aucun appel
  Google à l'ajout d'un livre** (l'ajout n'appelle qu'Open Library).
  En mode ISBN, pas de debounce : on lance dès que 10 ou 13 chiffres sont saisis.
- Paramètres imposés : `langRestrict=fr`, `printType=books`, `country` non forcé.
  **La langue est figée en V1**, sans réglage utilisateur.
- **Pièges vérifiés sur appels réels (2026-08-20)** :
  - `pageCount` vaut **`0`** pour « inconnu », pas `null`. Un test de vérité
    suffit ; un test d'existence laisserait entrer des livres à zéro page.
  - `imageLinks` arrive en **`http://`** → forcer `https`, sinon un WebView en
    https bloque l'image. Et il est **absent 3 fois sur 5** : le repli textuel
    « Pas de couverture » n'est pas un cas rare, c'est le cas courant.
  - `industryIdentifiers` peut ne contenir qu'un ISBN 10, ou **aucun ISBN**
    (uniquement un `OTHER` de type OCLC).
  - `publishedDate` est tantôt `'YYYY'` tantôt `'YYYY-MM-DD'` — ce qui valide
    `estAParaitre()` et sa comparaison en fin de période (§5.2).
  - **`ratingsCount` et `averageRating` sont absents de tous les résultats
    testés.** Vrai, et toujours vrai : *Google Books* n'expose aucune
    popularité. Mais cela ne valait que pour Google — voir la **tranche 28**,
    qui rouvre l'arbitrage 16 : Open Library, elle, en expose une.

### 4.2 Open Library — identité **et ordre**

> Depuis la tranche 28, cette source a **deux** rôles. Elle identifie les
> œuvres (ci-dessous), et elle décide de l'**ordre** des résultats de recherche
> par titre. Le second rôle n'était pas prévu : il vient de l'infirmation de
> l'arbitrage 16.

- Base : `https://openlibrary.org`
- Endpoints :
  - `/isbn/{isbn}.json` → édition : `works[0].key`, `number_of_pages`,
    `isbn_10`/`isbn_13`, `publishers`, `publish_date`, `covers`, `series`
  - `/search.json?q=…&fields=key,title,author_name,editions,editions.*`
    → œuvre **et ses éditions imbriquées en un seul appel**
  - `/works/{olid}.json` → description, sujets, `first_publish_date`
  - `/search.json?q=…&fields=key,title,author_name,readinglog_count`
    → les **œuvres notoires** d'une recherche (tranche 28). `fields=` est
    **obligatoire** : `readinglog_count` n'est pas rendu par défaut. Et il doit
    rester **court** — une projection à 6 champs monte à 9,5 s, celle-ci tient
    en 556 ms de médiane.
  - couvertures : `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg`
- Sans clé, sans quota strict. Envoyer un `User-Agent` descriptif.
- **Vérifié en tranche 0, depuis un navigateur** : `/isbn/{isbn}.json` répond en
  CORS sans configuration, en ~1 s, et le premier niveau de la réponse porte
  bien `identifiers, title, authors, publish_date, publishers, series`. Le choix
  des sources n'est donc pas remis en cause. Reste à confirmer **sur appareil**,
  à travers CapacitorHttp.
- **Pièges vérifiés sur appels réels (2026-08-20)**, à ne pas redécouvrir :
  - `/isbn/{isbn}.json` répond **302** vers `/books/{olid}.json`. `fetch` suit ;
    un client qui ne suit pas les redirections rend une réponse vide.
  - `/works/{olid}.json` peut rendre un **`/type/redirect`** avec un champ
    `location` au lieu de la fiche (œuvres fusionnées). Sans le saut, le résumé
    est vide sans raison apparente.
  - Les `authors` d'une **édition** ne sont que des **clés** (`/authors/OL79034A`),
    **sans aucun nom lisible**. Les colonnes `titre` et `auteurs` de la table
    `editions` (§3.3) doivent donc être remplies depuis Google.
  - `publish_date` est du **texte libre non ISO** : « Aug 26, 2021 ». Tranché en
    tranche 2 : une date Open Library est **convertie à l'entrée** en ISO
    partielle (`YYYY-MM-DD`, `YYYY-MM`) ou réduite à son année, et abandonnée si
    rien n'est lisible. **Jamais stockée brute** : comparée lexicographiquement
    comme l'exige §3.3, « Aug 26, 2021 » se rangerait avant « 1978 ».
  - Les couvertures se prennent par **identifiant** (`/b/id/{cover_i}-L.jpg`),
    pas par ISBN : la voie ISBN rend une image minuscule en **statut 200**
    quand la couverture n'existe pas, donc des vignettes fantômes.
- Pièges : `description` peut être une **chaîne ou un objet** `{type, value}` —
  normaliser les deux ; les descriptions sont majoritairement en anglais ;
  `number_of_pages_median` est une **médiane sur toutes les éditions**, pas la
  pagination de l'édition précise — elle n'est **jamais écrite en base**, voir la
  formulation unique en §5.4.

### 4.3 Règles d'orchestration (`books.js`)

| Cas | Chemin |
|---|---|
| Recherche par titre / auteur | **Google** (`intitle:` / `inauthor:`), `langRestrict=fr` |
| Ajout d'un résultat Google | résolution Open Library par ISBN → œuvre + éditions |
| Recherche par ISBN et **scan** | **Google `isbn:` sans `langRestrict`** pour la fiche, puis la cascade d'identification de §3.2 (qui commence par Open Library) — corrigé en tranche 7, voir ci-dessous |
| Livre sans ISBN | Open Library `/search.json`, sinon empreinte locale |
| Couverture absente ou en `http://` | Open Library covers par ISBN ; forcer `https` |
| Résumé absent chez Google | `/works/{olid}.json`, **même en anglais** — un résumé anglais vaut mieux qu'un vide, on ne traduit pas |
| Open Library injoignable | **l'app continue** en empreinte locale, et signale « identification incomplète » dans la fiche |

**Pourquoi le scan ne passe PAS par Open Library en premier** (correction de
tranche 7). Le contexte envoyait le scan sur `/isbn/` directement. Deux mesures
l'ont invalidé : **35 % seulement** des ISBN français y répondent (§3.2), et
quand ils répondent, la fiche d'édition ne porte **aucun nom d'auteur** ni
description (§4.2) — de quoi afficher une carte vide sur le cas d'usage
principal, un livre pris sur son étagère en France. Google rend une fiche
complète ; Open Library garde son rôle d'autorité d'identité, appliqué juste
après par la cascade de §3.2. La répartition « Google découvre, Open Library
identifie » n'est pas abandonnée : elle est appliquée dans le bon ordre.

### 4.4 Cycles et tomes — lecture automatique, correction manuelle

Aucune des deux sources n'a de données de série fiables : Google Books n'expose
rien d'exploitable, Open Library a un champ `series` sur les éditions, renseigné
de façon très irrégulière.

Règle : **on lit ce qui existe, on n'invente rien, et la correction de
l'utilisateur gagne toujours.**

1. À l'ajout, si l'édition Open Library porte un `series`, le parser et remplir
   les deux colonnes. **Forme réelle observée, très différente de celle que ce
   document imaginait** : `["Dune (1); Dune Chronicles, Book 1"]` — un tableau,
   en anglais, plusieurs séries séparées par des points-virgules, numéro entre
   parenthèses. Le lecteur gère quatre formes (`, tome N` · `Book/vol. N` ·
   `(N)` · `#N`), ne retient que ce qui précède le premier point-virgule, et
   rend deux `null` quand rien ne correspond.
2. La fiche affiche ces champs comme **modifiables**, avec autocomplétion sur
   les `cycle_nom` déjà présents en base — c'est ce qui garantit qu'un cycle ne
   se dédouble pas sur une faute de frappe.
3. Toute édition manuelle pose `cycle_manuel = 1`. **Une valeur corrigée à la
   main n'est plus jamais écrasée par une lecture automatique.** Seule sortie :
   **vider entièrement le champ cycle remet `cycle_manuel = 0`** et rend l'œuvre
   à la lecture automatique. Sans cette porte, une faute de frappe gelait l'œuvre
   définitivement.
4. Aucune information de cycle ne s'affiche tant qu'elle n'est pas connue : pas
   de « Tome ? », pas de bandeau vide.

Conséquence sur les suggestions : « Tome suivant » ne travaille que sur les
cycles réellement renseignés, et se contente de proposer une **recherche**
`cycle_nom` + tome `n+1` — jamais d'affirmer qu'un tome existe.

Chaque source expose **un seul normaliseur** vers la forme interne. Aucune
autre partie du code ne construit un objet œuvre ou édition à la main.

### 4.5 Transport réseau — à vérifier dès la tranche 1

Deux contraintes que `fetch` seul ne sait pas satisfaire sur Android :

- **CORS.** Dans un WebView Capacitor, l'origine est `https://localhost`. Google
  Books répond correctement en CORS ; Open Library est réputé permissif mais
  **ce point est à vérifier en premier, avant d'écrire quoi que ce soit d'autre
  dans la tranche 1** : c'est le seul blocage capable de remettre en cause le
  choix des sources.
- **En-tête `User-Agent`.** Open Library demande un `User-Agent` descriptif ; un
  navigateur **interdit** de le définir depuis `fetch`.

**`CapacitorHttp` est le seul mécanisme de ce projet sans précédent dans la
famille.** Le projet séries ne l'a jamais utilisé : TMDB répond
`Access-Control-Allow-Origin: *` et n'exige aucun en-tête. Or le plugin agit
**globalement** — il remplace `fetch` pour toute l'application, y compris le
chargement de `sql-wasm.wasm`, qui est justement la seule chose que le projet
séries a prouvée. D'où le déplacement de cette vérification **en tranche 0**, et
non en tranche 1 : si elle casse le chargement du WASM, elle remet en cause la
tranche 0 elle-même, et la découvrir après avoir écrit les deux sources serait
la découvrir trop tard.

Solution retenue : activer **`CapacitorHttp`** dans `capacitor.config.json`.
Le plugin remplace `fetch`/`XHR` par un appel HTTP natif sur Android — ce qui
supprime la question CORS **et** autorise les en-têtes personnalisés. Sur le
chemin navigateur (développement), `fetch` reste natif au navigateur : pas de
`User-Agent`, et CORS s'applique. Le code appelle `fetch` normalement dans les
deux cas ; aucune branche à écrire.

### 4.6 Suggestions — algorithme

Repris du projet séries, adapté. À vide, l'écran Recherche affiche :

1. **Graines** : les **6** dernières œuvres `lu` ou `en_cours` (les plus récemment
   touchées), pas plus — c'est le garde-fou de quota.
   *Écart délibéré : le projet séries en prend 12, mais TMDB n'a **aucun quota
   journalier** ; ses 12 graines bornaient la latence, pas la consommation. Avec
   1 000 requêtes par jour partagées par tous les porteurs de la clé (§4.1), 12
   graines = 24 appels par actualisation, soit une journée épuisée en 40 clics.
   6 graines = 12 appels, pour une qualité indiscernable après le tri par score.*
2. Pour chaque graine, deux requêtes Google au plus : `inauthor:<auteur>` et
   `subject:<première catégorie>`. Chaque appel est enveloppé d'un
   `.catch(() => [])` : une graine qui échoue ne casse pas l'écran.
3. Agrégation : exclusion de tout ce qui est déjà en bibliothèque (par
   `oeuvre_id` **et** par ISBN), dédoublonnage, score = nombre de graines qui
   ont ramené le titre, tri par score puis — à égalité — par **ordre d'arrivée
   Google**, coupe à 20.
   *Correction : le contexte disait « tri par popularité », hérité de
   `popularity` chez TMDB. **Google Books n'expose aucun champ de popularité
   équivalent** et rien n'en est stocké en base. L'ordre de Google est déjà un
   ordre de pertinence : on s'en sert au lieu d'inventer une note. Si un champ
   d'audience utilisable apparaît à la vérification des appels réels
   (tranche 1), on rouvrira ce point — pas avant de l'avoir vu.*
4. Chaque carte porte sa raison (« Parce que vous avez lu X »).
5. **Tome suivant** : pour chaque cycle dont l'utilisateur a lu le tome `n`,
   proposer une **recherche** `cycle_nom` + tome `n+1`. On ne prétend jamais
   qu'un tome existe : si la recherche ne rend rien, la carte n'apparaît pas.
6. Les suggestions sont **calculées à la demande**, avec un bouton
   « Actualiser », jamais au démarrage de l'application (quota, §4.1).

### 4.7 Erreurs, courses, cache

- Une seule fonction `xxxGet` privée par source, `throw new Error(...)` sur
  `!ok`, message **traduit en français** avant remontée (écart : le projet
  séries affichait `Erreur TMDB (429)` brut à l'utilisateur).
- **Compteur de séquence anti-course** sur la recherche au fil de la frappe
  (`const seq = ++searchSeq.current`), 3 lignes, hérité tel quel.
- Debounce **350 ms** sur le champ de recherche, hérité.
- **Cache mémoire `Map` avec TTL 30 min sur les résultats de recherche
  uniquement.** Les fiches n'en ont pas besoin : elles sont en base (§3.5).
- **Délai maximal de 12 s sur tout appel réseau, par `AbortController`** —
  ramené à **8 s pour Google Books** en tranche 8 : un appel qui aboutit répond
  en moins de 1,1 s, et ce plafond borne CHAQUE essai.
  Corrigé après constat en tranche 0 : sans lui, une source qui ne répond pas
  laisse le bouton sur « Vérification… » indéfiniment, sans message et sans
  issue. Le contexte le jugeait « souhaitable mais non bloquant » ; c'est faux
  dès qu'une source traine. L'échec de délai est un message comme un autre.
- **CINQ réessais, et uniquement sur `503` : `[0, 0, 250, 750, 1500]` ms** —
  révisé en tranche 8 après comparaison A/B (§12, correction 70). Google Books
  rend des `503 Service temporarily unavailable` sur **25 à 40 %** des appels,
  mesuré en rafale *et* espacé de 4 s : ce n'est pas une panne, c'est le régime
  normal de la source, et rien dans la forme de la requête n'y change quoi que
  ce soit. Deux faits commandent la forme retenue : un `503` revient en
  **170-650 ms** quand un `200` prend **430-1000 ms** — l'échec coûte moins
  cher que le succès, donc les deux premiers réessais sont quasi gratuits ; mais
  les `503` arrivent **en rafales**, donc les réessais purement immédiats ne
  suffisent pas, d'où les pauses tardives, qui ne se paient que dans ces cas
  rares.
  Le `429` (quota, §4.1) n'est **PAS** réessayé : insister l'aggrave.
  Le « aucun retry » hérité venait de TMDB, qui ne rendait pas de 503.
- **Le message d'erreur traduit par la source remonte jusqu'à l'écran.** Il ne
  doit pas être remplacé par une phrase générique : « Google Books est
  momentanément indisponible » et « Trop de recherches pour aujourd'hui »
  n'appellent pas la même réaction de l'utilisateur.

---

## 5. Statuts et progression

### 5.1 Les 4 statuts

`a_lire` · `en_cours` · `lu` · `abandonne` — mêmes couleurs sémantiques que le
projet séries, distinctes de l'accent.

### 5.2 Écart majeur : le statut est manuel

Dans le projet séries, le statut d'une série est **dérivé** de la progression et
verrouillé. Ici, **non** : on lit beaucoup de livres papier sans jamais saisir
une page. Le statut est donc toujours modifiable à la main, et la progression le
**suggère** seulement :

- saisir une position > 0 sur une œuvre `a_lire` → proposer `en_cours`
- atteindre `nb_pages` → proposer `lu` et remplir `termine_le`
- changer un statut vers `lu` sans progression saisie → ne rien exiger

La suggestion passe par une confirmation légère, jamais par une écriture d'office.

**Qui écrit `commence_le` et `termine_le`** (le contexte ne le disait nulle part) :
`setStatut` et lui seul. Passage à `en_cours` → `commence_le` reçoit la date du
jour **si elle est nulle**. Passage à `lu` → `termine_le` reçoit la date du jour.
Retour à `a_lire` → les deux sont effacées et `position` retombe à 0.

**Relecture** : passer de `lu` à `en_cours` remet `position` à 0, efface
`termine_le` et réécrit `commence_le` à la date du jour. La V1 ne conserve
**aucun historique de lectures antérieures** — c'est une limite assumée, pas un
oubli ; l'historique appartiendrait à `sessions_lecture` (v2, tranche 6).

**« Non encore paru » n'est pas un cinquième statut.** C'est un **dérivé** calculé
par `estAParaitre()` dans `status.js` : l'œuvre garde `statut = 'a_lire'`, elle
est seulement sortie du **compteur** « À lire » et montrée dans sa propre section
(§6). Une date incomplète est comparée **à la fin de sa période** (`'2026'` →
`'2026-12-31'`, `'2026-03'` → `'2026-03-31'`) : Google Books rend très souvent
l'année seule, et une comparaison lexicographique brute classerait un livre daté
`'2026'` comme paru le 31 décembre 2025. TMDB rendait toujours une date complète
— c'est le seul endroit où la transposition depuis le projet séries est fausse.

### 5.3 Progression

`position` / (`nb_pages` ou `duree_minutes` de l'**édition active**).
**Aucun appel réseau** : c'est une soustraction. C'est l'écart le plus rentable
avec le projet séries, où le calcul de progression était le point le plus coûteux
de l'application.

### 5.4 Le nombre de pages — cascade, jamais de question à l'ajout

`pageCount` est absent ou faux chez Google Books très souvent. La pagination est
donc résolue en cascade, à la première écriture d'édition :

1. `volumeInfo.pageCount` de l'édition Google
2. `number_of_pages` de l'édition Open Library (via son ISBN) — **exact**
3. `number_of_pages_median` de l'œuvre Open Library — **approximatif**. Formulation
   unique, qui remplace les deux du contexte initial : la médiane n'est **jamais
   écrite en base**. Elle sert uniquement de **valeur pré-remplie** dans le champ
   de saisie, avec la mention `~ estimation` à côté du champ. Validée par
   l'utilisateur, elle devient une valeur exacte comme une autre.
4. saisie manuelle

**Règle d'interaction : ajouter un livre ne pose jamais de question.** Une œuvre
sans pagination connue s'ajoute normalement ; la demande n'arrive qu'au moment
où l'utilisateur saisit une progression, dans le même Modal (« Tu en es à la
page … sur … »). S'il refuse, la progression bascule en **pourcentage** et
l'œuvre reste parfaitement utilisable.

**Un seul Modal, jamais deux empilés.** Saisir une progression sur un livre sans
pagination déclencherait sinon la demande de pagination (ici) **puis** la
suggestion de changement de statut (§5.2). Les deux tiennent dans le même Modal,
en deux temps : la pagination si elle manque, puis la suggestion de statut sur la
même validation.


### 5.5 Le cas des livres audio

Ni Google Books ni Open Library ne cataloguent correctement les versions audio.
Une édition `format = 'audio'` est donc **toujours créée à la main**
(`edition_id = "manuel:<uuid>"`), avec sa durée en minutes saisie par
l'utilisateur, rattachée à une œuvre existante. La progression s'exprime alors
en minutes, et l'affichage en `h min`. Aucun appel réseau n'est tenté.

---

## 6. Écrans et navigation

Quatre onglets, pas de router, un `switch` sur `view` + des overlays.

**1. Recherche** — champ + segment de mode `Titre | Auteur | ISBN`, scan de
code-barres à droite du champ (tranche 7). À vide : **les suggestions**
(« Du même auteur », « Tome suivant de vos cycles », « Même catégorie »).

**2. Ma lecture** — l'onglet de reprise, **sans suggestions** : « En cours »
(carte + barre de progression + bouton « J'en suis à… »), « Tome suivant à lire »
des cycles entamés, « À paraître » (dates de publication futures).

**3. Bibliothèque** — grille 2×2 des 4 statuts avec compteurs, puis les listes
personnalisées, puis les résultats. Filtre `Tout | Papier | Numérique | Audio`, qui porte sur le format de
l'**édition active** — pas sur l'ensemble des éditions possédées. C'est ce que
`getBibliotheque()` rend (§2.1) et c'est la lecture la plus honnête : le filtre
répond à « sur quel support je le lis », pas à « sous quels supports je le
possède ». Un livre en poche et en audio apparaît donc sous le format qu'on est
en train d'écouter ou de lire, et bascule quand on change d'édition active.
Les livres non encore parus sont **exclus du décompte « À lire »** — mais restent
visibles dans la liste, dans leur propre section (voir §5.2, `estAParaitre`).

**4. Réglages** — Profil (sélection, création, renommage et **suppression avec
confirmation** — absente du projet séries depuis la V1, on ne reproduit pas
l'oubli), Affichage (thème), Mes données (sauvegarde + compteur),
À propos (attribution Google Books et Open Library).

**Retrait d'un livre** — supprimer une œuvre supprime ses éditions et ses
appartenances aux listes en cascade. C'est irréversible hors sauvegarde : Modal
de confirmation obligatoire, qui **dit combien d'éditions partent avec**.

**Overlays** : `Detail`, `Backup`, `About`, `Modal`.

**Fiche détail** — couverture + titre/auteurs/année → suivre/retirer → sélecteur
de statut → **sélecteur d'édition active** + « Ajouter une édition » →
progression (si suivie) → **cycle et tome, modifiables avec autocomplétion** →
résumé → listes → zone « Identification » en bas : « Rattacher à une œuvre
existante » et « Détacher cette édition », plus la mention « identification
incomplète » si l'œuvre est en empreinte locale.

### Interactions décidées

- **Appui long sur une carte → changement de statut direct.** (Manque identifié
  sur l'app séries, où le changement n'était possible que depuis la fiche.)
- **Bouton retour Android** : overlay → onglet → onglet d'accueil → sortie.
  Écouteur ré-abonné à chaque changement d'état d'affichage.
- Grille : **3 colonnes fixes sur téléphone**, `auto-fill minmax(150px, 1fr)`
  au-delà de 560 px. Format de couverture 2:3, identique aux affiches.
- `env(safe-area-inset-*)` sur l'appbar et la tabbar, `viewport-fit=cover`.

---

## 7. Garde-fous propres à ce projet

Ces quatre points existent parce que le modèle Œuvre/Édition est plus riche que
le modèle du projet séries, et que le projet est en JavaScript sans typage.

1. **`types.js`** : les `@typedef` JSDoc de `Oeuvre`, `Edition`, `ResultatRecherche`,
   importés en commentaire dans chaque module qui les manipule. C'est le seul
   contrat de forme du projet — il doit être écrit avant `books.js`.
2. **Un seul normaliseur par source.** Interdiction absolue de composer un objet
   œuvre ou édition ailleurs que dans `sources/*.js`.
3. **`Modal.jsx` dès le premier besoin.** Zéro `window.prompt`, zéro
   `window.confirm` (le projet séries en compte cinq, hors charte sur Android).
4. **`notify(message)` + `Toast.jsx`.** Zéro variable `error` globale, zéro
   `.catch(() => {})` muet. Toute erreur remonte, traduite, et s'efface seule.
5. **`ErrorBoundary.jsx` autour de l'application.** Le projet séries n'en a pas :
   une erreur de rendu y donne un **écran blanc** sans message ni issue. C'est
   l'unique **exception** à la règle « composants fonctionnels uniquement » (§1) :
   React n'offre aucun équivalent en hook. Exception écrite ici plutôt que
   découverte dans le code.
6. **Une clé d'identité, un domicile.** `empreinteOeuvre()` vit dans `books.js`
   et nulle part ailleurs (§3.2).

---

## 8. Plan de travail — une tranche à la fois, testée avant la suivante

Le projet séries a mené ses six chantiers V2 en parallèle et l'a regretté ; le
chantier Android, mené tranche par tranche, s'est bien passé. **On applique la
seconde méthode.** Chaque tranche se termine par un test sur appareil réel, pas
seulement dans le navigateur.

| # | Tranche | Fini quand |
|---|---|---|
| 0 | Squelette Vite + React, `db.js` (2 moteurs, migrations, `user_version`), thème, tokens CSS, `Icon`, `Modal`, `notify`, `ErrorBoundary`, **et la vérification `CapacitorHttp` sur appareil** | l'app ouvre une base, crée un profil par défaut, bascule de thème — **sur téléphone**, et un appel de test atteint les deux sources |
| 1 | `types.js`, `sources/google.js`, `sources/openlibrary.js`, `books.js` (dont la résolution d'œuvre par ISBN), écran Recherche | on cherche « Dune », on voit des résultats normalisés, et le journal montre la clé `ol:` résolue |
| 2 | `store.js` + `api.js` : ajout au suivi, statuts, écran Bibliothèque, appui long | on constitue une bibliothèque et on la retrouve après relance |
| 3 | **Sauvegarde / restauration** + export CSV Goodreads | un export restauré sur une base vide rend la même bibliothèque |
| 4 | Fiche détail, éditions multiples, édition active, **regrouper et détacher** | un livre en poche et en numérique tient dans une seule œuvre, et un mauvais regroupement se défait |
| 5 | Progression, cascade de pagination, écran Ma lecture, cycles | « J'en suis à la page 210 » met la barre à jour hors ligne |
| 6 | Listes, suggestions, `sessions_lecture` si voulu | la recherche à vide propose du pertinent |
| 7 | Scan de code-barres ISBN | scanner un livre de l'étagère l'ajoute en 3 secondes |
| 8 | Android : icône, `appId`, signature conditionnelle, politique de confidentialité, build AAB | un AAB signé se construit |

**Les huit tranches sont écrites et vérifiées sur appareil.** Ce qui reste
tient à Kinder et à son matériel, et est listé en §11.

`appId` : `com.kinder.suivilecture` — `appName` : « Suivi Lecture ».
`versionCode` / `versionName` : **à incrémenter à la main à chaque publication**
(oubli constaté sur le projet séries).

---

## 9. Décisions figées, à ne pas rouvrir

**Propres à ce projet :** Google découvre / Open Library identifie · une œuvre
n'existe jamais sans au moins une édition, créées dans la même transaction,
`edition_active` jamais nul · l'unité de `position` est **déduite** du format de
l'édition active (page, minute, pourcentage), elle n'est pas stockée ·
l'ajout d'un livre ne pose jamais de question · un résumé en anglais vaut mieux
qu'un résumé vide, et on ne traduit pas · une donnée corrigée à la main n'est
jamais écrasée par une lecture automatique.

**Héritées du projet séries :**

*Une exception, constatée en tranche 2 : la « `Map` du suivi en mémoire » ne se
transpose pas telle quelle. Dans le projet séries elle donnait l'appartenance
en O(1) depuis n'importe quelle grille, parce que l'identifiant TMDB était
connu dès la recherche. Ici, une carte de recherche ne connaît PAS encore son
identifiant d'œuvre — le résoudre demanderait un appel Open Library par
résultat, ce que §4.3 interdit. L'équivalent utile est un **`Set` des clés
d'édition**, qui sont celles des résultats eux-mêmes. La `Map` par `oeuvre_id`
reviendra quand un écran en aura l'usage.*

clé métier composite en clé primaire ·
`INSERT OR IGNORE` · rechargement complet après chaque écriture (pas de mise à
jour optimiste) · compteur de séquence anti-course · debounce 350 ms · tokens CSS
en trois blocs de thème (clair / préférence système / choix explicite) · thème
posé sur `<html>` avant le rendu React · icônes SVG maison sans émoji · textes
d'état vide qui **disent quoi faire ensuite** plutôt que de constater le vide ·
client autonome sans serveur, sans Docker, sans proxy.

---

## 10. Journal des arbitrages — relecture croisée du 2026-08-20

Relecture du contexte contre lui-même et contre
`EXTRACTION_TECHNIQUE_SUIVI_FILMS_SERIES.md`. Chaque ligne a été reportée dans la
section concernée ; ce tableau existe pour qu'on sache **pourquoi** une décision
a changé, sans relire l'échange.

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 1 | « Détacher cette édition » impossible : `editions` n'a ni titre ni auteur | colonnes `titre` / `auteurs` ajoutées à `editions` | §3.3 |
| 2 | Empreinte déterministe : détacher recrée la même clé, l'action est sans effet | le détachement produit `fp:<uuid>` ; le préfixe `fp:` garde son sens | §3.2 |
| 3 | Édition audio (§5.5) inaccessible depuis la façade | `ajouterEditionManuelle` ajoutée ; `setPagination` → `setMetrique` ; le gel de §2.1 interdit de modifier, pas d'ajouter | §2.1 |
| 4 | `editions` et `liste_items` toujours lues par `oeuvre_id`, absent de leurs clés | deux index déclarés dans `SCHEMA` | §3.3 |
| 5 | Le calcul d'empreinte n'avait pas de domicile | `empreinteOeuvre()` dans `books.js`, une seule fois | §3.2, §7 |
| 6 | « auteur principal » non déterministe entre les deux sources | empreinte sur **tous** les auteurs, triés | §3.2 |
| 7 | `profile_id` hors de la clé de `liste_items` (défaut hérité) | remis dans la clé primaire | §3.3 |
| 8 | `sessions_lecture` dans `SCHEMA` **et** interdite avant la tranche 6 | sortie de la v1, devient la migration v2 | §3.3, §3.4 |
| 9 | Le diagramme mettait `books.js` sous `store.js`, contre la règle 4 | `api.js` orchestre ; `store.js` n'importe jamais `books.js` | §2 |
| 10 | Regroupement : aucune règle sur le suivi en collision | la cible gagne ; la source apporte éditions et listes | §3.2 |
| 11 | Filtre de format : œuvre à plusieurs éditions non tranché | porte sur l'édition active | §6 |
| 12 | « À paraître » : date `'YYYY'` classée comme passée | `estAParaitre()` compare à la fin de période ; ce n'est pas un 5ᵉ statut | §5.2 |
| 13 | « aujourd'hui » en UTC (bug hérité, décalage d'un jour en soirée) | `aujourdhui()` en heure locale, dans `status.js` | §3.3 |
| 14 | Médiane de pagination décrite de deux façons | formulation unique : jamais écrite en base, seulement pré-remplie | §4.2, §5.4 |
| 15 | `commence_le` écrite par personne ; relecture non traitée | `setStatut` porte les deux dates ; relecture définie | §5.2 |
| 16 | « tri par popularité » : aucun champ ne le produit chez Google Books | ~~tri par score puis ordre d'arrivée Google~~ — **ROUVERT ET INFIRMÉ le 2026-08-28 (tranche 28)** : la clause « à rouvrir sur appel réel » a joué. Open Library expose `readinglog_count` ; la recherche s'en sert désormais pour classer | §4.2, §4.6 |
| 17 | 12 graines héritées d'un monde **sans quota** (TMDB) | ramenées à 6 : 12 appels par actualisation au lieu de 24 | §4.6 |
| 18 | Deux Modals empilés (pagination puis statut) | un seul Modal, deux temps | §5.4 |
| 19 | `cycle_manuel` sans porte de sortie | vider le champ remet `cycle_manuel = 0` | §4.4 |
| 20 | Deux listes homonymes cassent l'export par nom | `UNIQUE (profile_id, name)` | §3.3 |
| 21 | Restauration multi-profil non traitée | trois cas tranchés, les autres profils intacts | §3.6 |
| 22 | `langRestrict=fr` appliqué à une recherche ISBN | repli Google `isbn:` sans `langRestrict` | §4.3 |
| 23 | Crash de rendu = écran blanc (défaut hérité) | `ErrorBoundary.jsx`, seule exception à « hooks uniquement » | §7 |
| 24 | `CapacitorHttp` sans précédent, et global | vérification déplacée en tranche 0 | §4.5, §8 |
| 25 | Volumétrie cible absente | 2 000 œuvres, repère 432/4109 du projet séries | §3.3 |
| 26 | Appel réseau sans délai maximal : blocage sans issue (constaté sur appareil) | `AbortController`, 12 s, sur tout appel | §4.7 |
| 27 | Google Books rend des 503 passagers, contrairement à TMDB | « aucun retry » marqué à rouvrir en tranche 1 | §4.7 |
| 28 | Restriction « Applications Android » de la clé : incompatible CapacitorHttp | restriction par API uniquement | §4.1 |
| 29 | La clé API est journalisée en clair dans logcat | consigné ; la clé vit dans `.env`, jamais dans `.env.example` | §4.1 |

**Tranche 1 — corrections issues des appels réels du 2026-08-20.** Aucune n'a
été devinée : chacune vient d'une réponse observée, plusieurs d'une mesure.

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 30 | L'ISBN n'identifie que **35 %** des livres français (404 chez Open Library) | les trois chemins de §3.2 deviennent une **cascade** : 78 % résolus | §3.2 |
| 31 | Les titres français portent le tome dans le titre, ce qui casse la recherche | second essai sur titre nettoyé : **89 %** résolus | §3.2 |
| 32 | « Tous les auteurs triés » (arbitrage 6) fait entrer du cyrillique dans la clé | **annulé** : retour au premier auteur, comme le contexte le disait d'origine | §3.2 |
| 33 | Les auteurs d'une édition Open Library n'ont **pas de nom**, que des clés | `editions.titre` et `editions.auteurs` seront remplies depuis Google | §4.2 |
| 34 | `publish_date` d'Open Library est du texte libre non ISO | signalé, **à trancher en tranche 2** | §4.2 |
| 35 | `/works/` peut rendre une redirection ; `/isbn/` répond 302 | les deux sauts sont traités | §4.2 |
| 36 | `series` n'a pas la forme supposée (anglais, point-virgule, parenthèses) | lecteur à quatre motifs, silencieux si rien ne correspond | §4.4 |
| 37 | `pageCount` vaut 0 pour « inconnu » ; couverture absente 3 fois sur 5 | traités dans le normaliseur | §4.1 |

**Tranche 2 — corrections issues de l'exécution.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 38 | Google rend `503` une fois sur deux (`200 503 200 503 200 503` mesuré) | **un** réessai à 800 ms, sur 503 uniquement ; jamais sur 429 | §4.7 |
| 39 | L'écran écrasait le message traduit par une phrase générique | le message de la source remonte tel quel | §4.7 |
| 40 | La « `Map` du suivi » héritée ne se transpose pas : l'œuvre est inconnue à la recherche | `Set` des clés d'édition à la place | §9 |
| 41 | Dates Open Library en texte libre (point 34) | converties à l'entrée, jamais stockées brutes | §4.2 |
| 42 | Ouvrir une fiche puis « Suivre » relançait deux fois la résolution Open Library | cache d'identité 30 min dans `books.js`, signatures inchangées | §4.7 |
| 43 | `BookCard` recevait deux formes d'`auteurs` (tableau et chaîne) et plantait | test explicite, commenté ; l'ErrorBoundary avait fait son office | §7 |

**Tranche 3 — sauvegarde et restauration.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 44 | « Une seule transaction » impossible pour les listes : chaque `id` auto-incrémenté dépend de l'insertion précédente | œuvres et éditions en un lot ; listes ensuite, volume négligeable | §3.6 |
| 45 | L'ISBN du CSV sortait avec des guillemets en quadruple | la valeur brute `="978…"` est donnée à l'échappement, qui pose seul les guillemets CSV | §3.6 |

**Tranche 4 — éditions, identité, cycles.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 46 | Supprimer la dernière édition, ou la détacher, viderait l'œuvre | les deux sont **refusés** avec un message qui dit quoi faire à la place ; les boutons n'apparaissent pas quand il n'y a qu'une édition | §9 |
| 47 | Le résumé de la fiche était coupé en plein mot | `max-height` retiré : la feuille défile déjà, une zone de défilement imbriquée clipait sans le dire | §6 |
| 48 | Une fiche ouverte sur une œuvre regroupée ou retirée affichait un livre disparu | la fiche est désignée par son identifiant, pas par une copie : elle se ferme d'elle-même | §6 |

**Tranche 5 — progression, pagination, Ma lecture.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 49 | `Progression.jsx` n'était pas dans l'arborescence de §2.2 | ajouté : c'est le Modal en trois temps de l'arbitrage 18, il ne pouvait pas vivre dans `ProgressBar.jsx` | §2.2 |
| 50 | « Tome suivant à lire » de §6 peut se lire de deux façons | en tranche 5 il ne montre que **ce que l'utilisateur possède déjà** — local, sans réseau. La proposition de recherche du tome n+1 (§4.6) reste aux suggestions, tranche 6 | §6 |

**Tranche 6 — listes, suggestions, migration v2.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 51 | `sessions_lecture` était « si voulu » (§8) | **retenue**, avec un consommateur réel : `setPosition` écrit la trace du jour, ce qui permet de dire « N pages cette semaine » sans historique de lectures antérieures. Et c'est ce qui fait **réellement tourner** le mécanisme de migration posé au jour 1 | §3.4 |
| 52 | §4.6 exclut les suggestions « par `oeuvre_id` ET par ISBN » | l'identifiant d'œuvre d'un résultat n'est PAS connu sans un appel Open Library par résultat (interdit par §4.3) : **l'empreinte locale en tient lieu**, elle se calcule hors ligne | §4.6 |
| 53 | Le champ de progression, pré-rempli, faisait s'AJOUTER la saisie : taper 260 sur 210 enregistrait 210260 | `select()` au focus | §5.4 |
| 54 | Le texte de raison débordait sous la carte sur Android | `max-height` explicite en plus du `line-clamp` | §6 |

**Tranche 7 — scan de code-barres.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 55 | §4.3 envoyait le scan sur Open Library `/isbn/` en premier | **inversé** : Google pour la fiche, Open Library pour l'identité juste après. 35 % de réponses seulement côté OL, et sans nom d'auteur quand elle répond | §4.3 |
| 56 | Le plugin ne déclare **pas** la permission caméra (son manifeste est vide) | `CAMERA` ajoutée au manifeste de l'application, plus `uses-feature camera required="false"` pour qu'un appareil sans caméra puisse installer | §8 |
| 57 | Tout code-barres n'est pas un livre | un EAN-13 doit commencer par **978 ou 979** ; sinon on le dit au lieu de lancer une recherche vide | tranche 7 |
| 58 | Le module de lecture Google n'est pas embarqué dans l'APK | il est installé explicitement au premier scan, sinon le premier échoue là où les suivants marchent | tranche 7 |

**Poids de l'APK.** Il passe de 14 à **36 Mo** avec le scan. À décomposer avant
de s'alarmer : **26,7 Mo sont des bibliothèques natives réparties sur quatre
architectures**, dont un téléphone n'installe qu'une seule (arm64 : 6,8 Mo).
Un APK arm64 seul pèserait environ **16 Mo**, et l'AAB du Play Store fait cette
séparation automatiquement. La cible de 13 Mo du §1 reste tenable.
*À examiner en tranche 8* : le plugin tire **deux** moteurs de lecture — le
modèle embarqué `com.google.mlkit:barcode-scanning` (que nous n'utilisons pas,
puisque nous appelons `scan()`) et `play-services-code-scanner` (celui qui
sert). Exclure le premier ferait gagner près d'un mégaoctet d'assets, au risque
d'une erreur de chargement de classe : à tester, pas à décider à l'aveugle.

**Vérifié sur appareil** : le bouton de scan apparaît à droite du champ et
**uniquement sur Android** ; la demande de permission s'affiche au nom de
« Suivi Lecture » ; le scanner Google démarre et **traite réellement les images
de la caméra** ; l'annulation revient à l'écran sans erreur ; le refus de la
caméra affiche « Sans accès à la caméra, le scan est impossible. Tu peux saisir
l'ISBN à la main. » La reconnaissance des ISBN est éprouvée sur sept cas —
978, 979, ISBN 10 acceptés ; codes produit et longueurs invalides rejetés.

**NON vérifié, et c'est la limite de cette tranche** : la lecture d'un vrai
code-barres. Un émulateur n'a pas de caméra devant laquelle poser un livre ;
la tentative d'injecter une image dans sa scène virtuelle n'a pas abouti.
**C'est le premier geste à faire sur l'appareil réel.**

**Tranche 8 — publication.**

| # | Point | Arbitrage | Section |
|---|---|---|---|
| 59 | L'exclusion du moteur ML Kit embarqué était notée « à tester, pas à décider à l'aveugle » | **testée, puis retenue** : APK de 36 → **18 Mo**, scanner intact, aucune erreur de chargement de classe. Le gain estimé était d'un mégaoctet ; il est de dix-huit — le modèle embarqué tirait aussi des bibliothèques natives | §8 |
| 60 | L'icône Android était encore celle de Capacitor | dessin propre au projet — livre ouvert, page brique et page crème sur fond sombre, aux couleurs des tokens (§6) | §8 |

**Poids réels, mesurés** : APK de test **18 Mo** pour quatre architectures ;
**AAB de publication 9,4 Mo**. La cible de 13 Mo du §1 est tenue, et large.

**Signature conditionnelle vérifiée dans LES DEUX SENS**, sur un magasin de
clés jetable ensuite détruit :
avec `signature.properties`, l'AAB sort **signé** (`jar verified`,
SHA256withRSA 2048 bits) ; sans lui, la version debug se construit toujours et
l'AAB de publication sort non signé. Aucun secret n'est entré dans le dépôt.
**La vraie clé de publication reste à créer par Kinder** : elle ne doit pas
être générée par un tiers, et la perdre interdit toute mise à jour.

**Politique de confidentialité** : `docs/index.html`, à publier sur GitHub
Pages. Elle décrit ce que l'application fait réellement — rien ne quitte
l'appareil, deux services publics interrogés sans aucun identifiant
d'utilisateur, la caméra utilisée seulement pendant un scan.

**Budget d'appels mesuré** : **2 appels par graine** (auteur + sujet), soit 15 au
maximum par actualisation avec 6 graines et 3 cycles. Le contexte prévoyait
12 graines, soit 24 appels — chiffre hérité de TMDB, qui n'a aucun quota
journalier (arbitrage 17).

**Vérifié** : la migration **v2 s'est appliquée sur la base réelle de
l'appareil**, qui contenait déjà des données — `user_version` passe à 2,
`sessions_lecture` apparaît, la position de 210 pages est intacte ;
les listes refusent les homonymes, l'ajout est idempotent, et un item dont
l'œuvre n'est pas suivie est refusé (« ajouter à une liste implique de
suivre ») ;
une liste **survit à une sauvegarde-restauration**, retrouvée par son nom avec
son contenu ;
les suggestions rendent 20 livres pertinents, **chacun avec sa raison**, et un
livre ajouté depuis les suggestions **disparaît** de la liste suivante.

**Limite d'outillage à connaître** : les tests par `import()` manuel dans la
page de développement créent une **seconde instance** des modules (Vite ajoute
un paramètre de version aux imports de l'application), donc une seconde base
sql.js dans le même onglet. Deux diagnostics de cette tranche s'en sont
trouvés faussés. **Le verdict se prend sur l'appareil**, où le bundle n'a
qu'une seule instance.

**Vérifié**, avec le critère du §8 pris au mot :
la barre passe à « page 210 sur 587 — 36 % » **sur appareil**, et la position
est en base ;
les trois unités déduites du format de l'édition active fonctionnent —
`page 210 sur 587`, `3 h 25 sur 9 h 10` pour une édition audio saisie à la
main (§5.5), et `40 %` quand aucune métrique n'est connue (repli de §5.4) ;
changer d'édition active change l'unité, qui n'est jamais stockée (§9) ;
le pourcentage est **borné à 100** même sur dépassement — le projet séries a
là un défaut connu (barre au-delà de 100 %), il ne se reproduit pas ;
arriver au bout **suggère** « Lu » sans l'écrire, et refuser est une réponse
acceptée (§5.2).

**Test hors ligne concluant** : `fetch` neutralisé, progression, changement de
statut et lecture de la bibliothèque fonctionnent avec **zéro appel réseau**.
C'est la promesse de §3.5 vérifiée, pas déduite.

**Vérifié**, chaque point du « fini quand » de §8 :
un livre porte deux éditions sous une seule œuvre, et changer d'édition active
change la pagination suivie (587 p. → 623 p.) ;
« Détacher » produit bien une clé **`fp:<uuid>`** — la forme aléatoire arbitrée
en relecture (arbitrage 2), sans laquelle l'opération serait restée sans effet ;
l'œuvre détachée hérite du **titre porté par l'édition** (arbitrage 1), et
l'œuvre d'origine retrouve une édition active valide ;
« Rattacher » réunit les deux, **la cible gagne** (statut `lu` conservé face à
`abandonne`, arbitrage 10), la source disparaît ;
`setCycle` pose `cycle_manuel = 1`, et vider le nom le remet à `0` — la porte
de sortie de l'arbitrage 19.

**Vérifié de bout en bout sur appareil** : export → feuille de partage Android →
fichier relu par le sélecteur du système → validation → confirmation nommant le
profil → remplacement. Un titre témoin planté dans le fichier a été retrouvé
dans la base de l'appareil, avec son édition active et sa pagination.
Les quatre refus sont éprouvés : fichier illisible, format étranger, version
future, sauvegarde sans profil. Les entrées de liste orphelines sont filtrées.
| 26 | `db.export()` de sql.js remet `foreign_keys` à 0 (trouvé à l'exécution, tranche 0) | PRAGMA reposé après chaque export | §3.3 |
| 27 | `PRAGMA` ne prend pas via `db.run()` et n'accepte pas d'alias | la porte `exec` passe par `db.exec` | §3.3 |
| 28 | Google Books sans clé : `HTTP 429` dès le premier appel | confirme §4.1, aucun mode dégradé possible | §4.1 |
| 29 | Open Library : CORS et forme de réponse confirmés au navigateur | choix des sources maintenu ; reste à confirmer sur appareil | §4.2 |

**Points laissés ouverts, délibérément** — ils ne bloquent aucune tranche et
seront tranchés quand ils se présenteront :

- La forme exacte des réponses Google Books et Open Library n'est **pas** vérifiée.
  Aucun normaliseur ne sera écrit avant un appel réel, en début de tranche 1.
- Aucun historique de lectures antérieures en V1 (voir §5.2).
- `renommerListe` n'existe pas : aucun écran ne le demande.
- Le poids du dump IndexedDB reste à surveiller au-delà de 2 000 œuvres (§3.3).



---

## 11. Ce qui reste à faire — état au 2026-08-20

Les huit tranches du §8 sont écrites, et chacune a été vérifiée sur appareil
avant de passer à la suivante. Trois choses ne peuvent pas l'être depuis un
poste de développement, et appartiennent à Kinder.

### À vérifier sur le téléphone réel

1. **Le scan d'un vrai code-barres.** Toute la chaîne est éprouvée — permission,
   démarrage du scanner, traitement des images, refus de la caméra, validation
   de l'ISBN — sauf la lecture d'un code posé devant l'objectif : un émulateur
   n'a pas de caméra devant laquelle poser un livre.
2. ~~L'appui long sur une carte~~ — **résolu et vérifié sur appareil** le
   2026-08-21. Il s'annulait au moindre glissement du doigt.
3. **La feuille de partage de la sauvegarde.** Sur l'émulateur elle propose
   Quick Share, Gmail et Drive. Sur un vrai téléphone, il doit y avoir
   « Enregistrer dans Fichiers » ou équivalent — c'est par là que passe la
   sauvegarde locale. Si l'option n'existe pas, il faudra écrire directement
   dans le dossier Téléchargements plutôt que passer par le partage.

### À faire avant de publier

4. **Créer la clé de signature** (`README.md`, section Publier). Elle ne doit
   pas être générée par un tiers, et la perdre interdit toute mise à jour.
5. **Régénérer la clé Google Books** si ce n'est pas déjà fait : elle est
   apparue en clair dans les journaux Android pendant le développement (§4.1).
6. **Publier `docs/index.html`** sur GitHub Pages et coller son URL dans la
   fiche Play Store.
7. **Incrémenter `versionCode`** à chaque publication.

### Points laissés ouverts, sans urgence

- **Aucun historique de lectures antérieures** : relire un livre écrase la
  précédente lecture (§5.2). `sessions_lecture` ne garde que la progression du
  jour, pas les lectures passées.
- **`renommerListe` n'existe pas** : aucun écran ne le demande.
- **Le poids du dump IndexedDB** reste à surveiller au-delà de 2 000 œuvres
  (§3.3). Ne concerne que le chemin navigateur, pas Android.
- **Google Books rend un `503` une fois sur deux.** Un réessai suffit presque
  toujours ; deux échecs d'affilée restent possibles et se voient. Si ça devient
  gênant à l'usage, il faudra un délai croissant plutôt qu'un réessai fixe (§4.7).


---

## 12. Corrections d'usage — 2026-08-21

Six remarques de Kinder après usage réel, chacune creusée jusqu'à la cause
avant d'être corrigée. Deux ont infirmé mon hypothèse de départ.

| # | Symptôme rapporté | Cause RÉELLE, mesurée | Correction |
|---|---|---|---|
| 61 | « Temps de latence quand j'ajoute un livre » | Pas l'ajout : il prend **4 ms** et zéro appel réseau. C'est l'**ouverture de la fiche** qui bloquait jusqu'à **12 s** — le délai maximal — parce qu'Open Library répond entre 1,3 et 7,7 s et que `/isbn/` coûte **deux allers-retours** (redirection 302) | Ajout **instantané** avec l'identité connue ou l'empreinte locale, puis **promotion d'identité en tâche de fond**. Budget d'identification interactive ramené à 4 s. Mesuré après : ajout en **2 ms**, promotion en `ol:` à 9 s, invisible |
| 62 | « Je voudrais retrouver le bouton d'ajout rapide » | Il n'avait **jamais existé** : j'avais fait de la fiche le seul chemin d'ajout | Bouton `+` en coin d'affiche, sur les résultats **et** les suggestions |
| 63 | « Et l'appui long pour choisir ma catégorie » | Il s'annulait sur `onPointerLeave`, donc dès que le doigt glissait d'un pixel — et un doigt bouge toujours | Tolérance de 12 px, annulation sur le **mouvement** et non sur la sortie ; `user-select: none` global, sinon Android ouvrait SON menu de sélection par-dessus le nôtre |
| 64 | « Le profil affiche Moi, je ne peux pas choisir » | `ProfileSelector.jsx` était listé au §2.2 et **n'existait pas** ; et l'en-tête affichait le profil créé au premier démarrage, **pas le profil actif** | Carte Profil complète — choisir, créer, renommer, supprimer avec confirmation — et l'en-tête lit enfin le profil actif |
| 65 | « Beaucoup de résultats sans couverture » | **65 %** de couvertures chez Google, mesuré sur 100 résultats réels | Repli Open Library par ISBN, avec `default=false` — sans ce paramètre une couverture absente rend une image d'UN pixel en statut 200. Mesuré après : **17 sur 20** |
| 66 | « Sur deux recherches ISBN, une seule a trouvé » | Sur huit ISBN français testés, **trois n'existent NI chez Google NI chez Open Library**. Aucune source ne les fera apparaître | Deux réponses : repli Open Library (y compris quand Google est **en panne**, cas qui manquait), et surtout **création manuelle d'un livre** — §3.2 prévoyait l'empreinte locale pour les livres non catalogués, rien ne permettait d'en créer un |
| 67 | « Je n'ai pas de suggestions » | La section ne s'affiche que dans l'état « vide », et l'écran n'y revenait **jamais** après la première recherche, même en vidant le champ | Champ vidé = retour à l'accueil, donc aux suggestions |

**Deux corrections nées des tests eux-mêmes :**

| # | Point | Correction |
|---|---|---|
| 68 | Le repli ISBN d'Open Library ne se déclenchait que sur « zéro résultat », pas sur une **panne** de Google — or c'est le cas le plus fréquent | Repli sur les deux cas ; si les deux sources sont muettes ET Google en panne, l'erreur remonte, pour ne pas faire croire que le livre n'existe pas |
| 69 | Un seul réessai laissait **25 %** des recherches en échec visible (Google rend un `503` une requête sur deux), et ça s'est produit en usage | **Deux** réessais, délais croissants (800 ms puis 2 s) : environ 12 % d'échecs. Le `429` de quota n'est toujours jamais réessayé. *(Révisé en tranche 8, voir 70.)* |

---

### Tranche 8 — 2026-08-21 : « Google Books n'est pas disponible, et c'est lent »

Deux symptômes rapportés, un seul creusement. **Une hypothèse de départ a été
mesurée puis abandonnée, et une affirmation de mon propre audit était fausse.**

| # | Point | Ce que la mesure a dit |
|---|---|---|
| 70 | Les réessais de la correction 69 attendaient **800 ms puis 2 s** | Un `503` revient en **170-650 ms**, un `200` en **430-1000 ms** : l'échec coûte MOINS cher que le succès. Ces pauses ajoutaient **2,8 s** à chaque recherche difficile. Nouvelle forme `[0, 0, 250, 750, 1500]` : **A/B sur 45 recherches par stratégie**, alternées — ancien 41/45 en 1685 ms de moyenne, nouveau 43/45 en **811 ms**. Vérifié dans l'application : **20/20, 696 ms de moyenne, 1326 ms au pire** |
| 71 | Hypothèse posée puis **INVALIDÉE** : « attendre n'achète rien, tous les réessais peuvent être immédiats » | Les `503` arrivent **en rafales**, pas isolément. La stratégie purement immédiate `[0,0,0]` retombe dans la même rafale : 42/45 contre 43/45, et surtout elle échoue là où une pause de 250 ms suffisait. Les pauses sont gardées, mais **tardives** : elles ne se paient que dans les cas rares |
| 72 | Hypothèse posée puis **INVALIDÉE** : « Open Library peut servir de repli quand Google tombe en mode Titre/Auteur » | Open Library met **6 à 21 s** et part en dépassement de délai ; sa pertinence en français est mauvaise (recherche « les fourmis » → il répond « Dune »). Remplacer une panne par 20 s d'attente et un mauvais résultat n'est pas une correction. **Repli abandonné** — la réponse est le cache persistant et un bouton « Réessayer » |
| 73 | Affirmation **fausse de mon propre audit** : « ouvrir une fiche bloque l'écran 4 à 36 s » | `Recherche.jsx` appelle `setOuvert(resultat)` **avant** d'attendre Open Library : la fiche s'affiche déjà instantanément. Ce qui traîne est son **contenu** (bloc identité, résumé), pas son ouverture. La latence ressentie venait d'abord de **la recherche elle-même** |
| 74 | Le plafond de 12 s bornait **chaque** essai | Avec six essais possibles, l'utilisateur pouvait rester plus d'une minute sur « Recherche en cours… » avant le moindre message. Ramené à **8 s** pour Google : un appel qui aboutit répond en moins de 1,1 s |

---

### Tranche 9 — 2026-08-21 : le contenu de la fiche, et ce qu'on repaie pour rien

| # | Point | Correction, et ce qu'elle a donné |
|---|---|---|
| 75 | `completer()` appelait `oeuvreParCle` **sans budget** : plafond de 12 s, et 12 s de plus si l'œuvre avait été fusionnée — **24 s pour un champ de confort**, le plus long appel du parcours et le moins essentiel | Budget de **4 s**, comme l'identification. Et le saut de redirection reçoit le temps **restant**, pas le budget entier : sinon deux sauts coûtent deux fois le plafond et le « budget » n'en est pas un. Garantie désormais bornée : **8 s au pire pour une fiche** (4 s d'identité + 4 s de résumé) contre 28 s |
| 76 | Le cache d'identité ne gardait que les **réussites**. Or **65 %** des ISBN français échouent (§3.2) : les livres les plus lents étaient exactement ceux qu'on réinterrogeait le plus souvent, à chaque ouverture et à chaque ajout | Les échecs sont mémorisés **avec le budget sous lequel ils sont survenus**. Un budget égal ou plus petit se contente du cache ; un budget **plus grand** retente — ce qui préserve exactement la reprise en tâche de fond de la correction 61. Vérifié : redemande à 4 s → **0 ms**, à 2 s → **0 ms**, à 15 s → **2361 ms**, l'appel a bien lieu |
| 77 | *(trouvé par la mesure de 76)* L'identification était bien mise en cache, mais le **résumé** était redemandé à chaque ouverture : rouvrir cinq livres déjà vus coûtait encore **1,3 s** de réseau pour un texte déjà obtenu | Cache des fiches d'œuvre, `null` compris — une œuvre sans description n'en aura pas davantage plus tard. Mesuré sur 5 fiches : 1re ouverture **7032 ms**, 2e et 3e **0 ms** |

---

### Tranche 10 — 2026-08-21 : une panne de Google n'est plus un écran vide

Six essais laissent encore **~4 %** des recherches en échec, parce que les
`503` arrivent en rafales. Deux replis ont été envisagés puis **écartés par la
mesure** : Open Library en source de découverte (correction 72), et une seconde
clé — le quota Google est **par projet, pas par clé**. Restait ce qu'on avait
déjà : la même recherche, faite plus tôt.

| # | Point | Correction |
|---|---|---|
| 78 | Une panne de Google donnait un message et **rien d'autre**, même sur une recherche faite deux minutes plus tôt | **Archive persistante** des recherches dans `idb-keyval` — déjà installé, déjà utilisé par `db.js` : aucune dépendance nouvelle. Durée de vie **7 jours** et non 30 min : ce n'est pas un cache de performance (celui-là reste en mémoire, au-dessus), c'est un filet contre une panne de source, et un résultat d'il y a trois jours reste bon pour un catalogue de livres |
| 79 | L'utilisateur ne devait pas croire que ces résultats sont frais | Bandeau `.hint--archive` : « Google Books ne répond pas. Voici ta recherche **de tout à l'heure**, gardée sur l'appareil. » L'âge est **relatif** — ce qui compte n'est pas quand la recherche a été faite, mais à quel point elle est vieille. Ton neutre (`--muted`) et non `--danger` : la liste en dessous est valide, seulement ancienne |
| 80 | Sur une recherche **jamais faite**, l'erreur restait un cul-de-sac : il fallait retaper | Bouton **« Réessayer »**, qui rejoue la dernière recherche sans retaper |

**§2.1 s'enrichit, ne se modifie pas** — même règle qu'en tranche 6 :
`rechercher(texte, mode)` garde sa signature figée et rend toujours un tableau
(`Detail.jsx`, qui cherche une édition à rattacher, n'a que faire de l'âge des
résultats). La nouvelle `rechercherAvecEtat(texte, mode)` rend
`{resultats, ancien, pose}` et ne sert qu'à l'écran de recherche.

**Vérifié dans l'application, Google coupé à 100 % :**

| Cas | Résultat |
|---|---|
| Recherche vive | 20 livres, archive écrite sur disque |
| Panne, même recherche, cache mémoire encore chaud | 20 livres, **pas** de bandeau — c'est le cache qui sert, ils sont frais |
| Panne, **application relancée** (cache vidé, archive intacte) | **20 livres, aucune erreur, bandeau affiché** |
| Panne, recherche jamais faite | message d'erreur **+ bouton « Réessayer »** |

---

### Tranche 11 — 2026-08-21 : cinq retours après essai sur téléphone

| # | Symptôme rapporté | Cause RÉELLE, mesurée | Correction |
|---|---|---|---|
| 81 | « La recherche par auteur me donne des livres plutôt qu'une liste d'auteurs et leurs œuvres » | Une vraie liste d'auteurs a été **mesurée puis écartée** : `/search/authors.json` d'Open Library met **3,8 à 51 s** et rend des doublons (« BernarD Werber » et « Bernard Werber » sont deux fiches). Google Books n'a **aucun** point d'entrée « auteurs » | Regroupement **côté application**, sur ce que Google rend déjà : un intertitre « Bernard Werber — 20 livres » par auteur, l'auteur cherché en tête, les homonymes sous un séparateur. **Zéro appel réseau en plus, zéro attente** |
| 82 | « Si le nombre de pages ne correspond pas à ma version je ne peux pas modifier » | Exact. L'étape de pagination était **sautée** dès que la source avait donné une valeur (`etape = metriqueConnue ? 'position' : 'metrique'`) : une pagination fausse était **définitive**. Or elle est fausse souvent — poche, club et grand format n'ont pas la même pagination | Lien « Ce n'est pas *N* pages dans mon exemplaire » à l'étape de position, **là où l'écart se constate**, et champ pré-rempli : on vient corriger, pas retaper |
| 83 | « Je n'ai pas d'appui long sur un livre pour choisir la catégorie, je suis obligé d'aller sur sa page » | Le geste existait et était branché sur la **Bibliothèque**, mais `BookCard` le refusait quand le livre n'était pas déjà suivi (`if (!suivi)`) — donc jamais sur l'écran de **Recherche**, qui est justement l'endroit demandé | La condition ne porte plus que sur la présence d'un gestionnaire : c'est l'écran qui décide s'il y a quelque chose à faire, pas la carte. Un appui long sur un résultat **ajoute le livre ET lui pose son statut d'un seul geste** (`suivre()` rend désormais l'identifiant, il était muet) |
| 84 | « Si j'ai pas de couverture je veux pouvoir en ajouter une moi-même » | Google illustre **65 %** des résultats, le repli Open Library monte à **75 %** : pour le dernier quart, aucune source ne viendra jamais | Bouton sur la vignette de la fiche. L'image est **réduite à 400 px en JPEG avant d'entrer en base** — ce n'est pas un confort : une photo de téléphone brute (3024×4032) irait telle quelle dans `couverture_url`, donc dans SQLite, donc dans le fichier de **sauvegarde**. Mesuré : **97 % de gain**, 100 couvertures pèsent **0,4 Mo** au lieu de 14 Mo |
| 85 | « Le bloc Cycle ne sert à rien, on supprime » | — | Section d'édition du cycle retirée de la fiche, avec son état et son appel `listCycles()`. **L'affichage** du cycle sous le titre est conservé (« Dune, tome 3 ») : c'est une information, pas un bloc de saisie. `setCycle` reste dans la façade, plus aucun écran ne l'appelle |

**Pièges rencontrés en écrivant cette tranche**, tous deux corrigés :

- Le motif d'accents `[̀-ͯ]` s'est écrit une première fois en
  **caractères bruts** dans `Recherche.jsx` — exactement ce que `books.js`
  met en garde depuis la tranche 2 : ce sont des signes combinants invisibles.
  Vérifié par `cat -v`, réécrit en échappement.
- La clé de regroupement d'auteur a d'abord pris « le mot le plus long » pour
  nom de famille. Elle échouait sur « **Herbert** George **Wells** », où le
  prénom est plus long que le nom, et laissait Wells en **quatre** groupes.
  Corrigée en « dernier mot de plus d'une lettre », avec initiales
  **dédoublonnées**. Vérifié : Wells, Tolkien et Dumas rendent chacun **un seul
  groupe de 20 livres** là où ils en donnaient trois ou quatre.

---

### Tranche 12 — 2026-08-21 : le quota, enfin visible et ménagé

| # | Point | Correction, et ce qu'elle a donné |
|---|---|---|
| 86 | Le bouton « Actualiser » des suggestions consommait **jusqu'à 15** des 1 000 requêtes quotidiennes, **à chaque clic** | Cache **journalier**, et non 7 jours comme l'archive de recherche : des suggestions sont une proposition de lecture, en revoir les mêmes une semaine durant serait pire que de payer quinze requêtes. Mesuré : 1er « Actualiser » **6 requêtes en 1066 ms**, 2e **0 requête en 2 ms** |
| 87 | Un cache figé serait pire que pas de cache : marquer un livre « lu » doit changer les suggestions | La clé de cache est **l'empreinte des graines**, pas le profil. Un livre marqué lu change la clé, donc invalide le cache **de lui-même** — aucun bouton, aucun réglage. Vérifié : après changement de bibliothèque, **8 requêtes**, le recalcul a bien lieu |
| 88 | Le quota était **invisible** : on découvrait l'avoir épuisé en recevant « Trop de recherches pour aujourd'hui », c'est-à-dire quand il n'y avait plus rien à faire de la journée | Carte « Recherches du jour » dans les Réglages : `15 / 1000`. Le compteur porte sur **chaque appel HTTP, réessais de 503 compris** — c'est ainsi que Google compte. Sur `localStorage` et non en base : la valeur est jetable et n'a rien à faire dans la sauvegarde du profil |
| 89 | Un lot de suggestions vide aurait été mis en cache | Un résultat vide vient presque toujours d'une panne de source : le mettre en cache **figerait un écran vide pour la journée**. Seuls les lots non vides sont gardés |

---

### Tranche 13 — 2026-08-21 : « CreateConnection: Connection lecture already exists »

Symptôme : l'application s'arrête toute seule pendant l'essai, puis **tout
ajout de livre** échoue sur ce message, en anglais, jusqu'au redémarrage.

| # | Point | Cause RÉELLE | Correction |
|---|---|---|---|
| 90 | La connexion SQLite était déjà reprise via `isConnection()` — et le message est apparu quand même | Une connexion SQLite vit du côté **natif** et survit au rechargement du WebView ; le pool JavaScript, lui, repart vide. `isConnection()` interroge **ce pool JavaScript** : après un rechargement il répond « non » alors que la connexion existe toujours côté natif, et `createConnection` échoue. C'est exactement ce qui se produit quand Android relance l'application après l'avoir mise en veille ou tuée pour récupérer de la mémoire | `checkConnectionsConsistency()` — la méthode prévue par le plugin pour resynchroniser les deux mondes — appelée **avant** toute interrogation. Et parce qu'une course reste possible, la création est doublée d'un rattrapage : si elle échoue *parce que la connexion existe*, on la reprend au lieu d'abandonner |
| 91 | *(trouvé en cherchant 90)* Une fois la première erreur survenue, **toutes** les opérations suivantes échouaient sur la même erreur, définitivement | `initDb()` mémorisait la promesse d'ouverture — y compris quand elle était **rejetée**. Une panne passagère devenait donc permanente jusqu'au redémarrage : c'est ce qui faisait revenir le bandeau à chaque tentative | Une tentative ratée est oubliée, la suivante repart proprement. Vérifié : à l'ancien comportement, 3 tentatives → 3 échecs ; au nouveau, la 2ᵉ réussit |

**Non élucidé, et dit comme tel** : *pourquoi* l'application s'est arrêtée
reste inconnu — cela demande les journaux du téléphone (`logcat`), qui n'ont
pas été capturés. Les corrections ci-dessus traitent les **conséquences** de
cet arrêt, qui étaient bien réelles et bloquantes ; elles n'en traitent pas la
cause. Si l'arrêt se reproduit, c'est cette cause-là qu'il faudra chercher.

---

### Tranche 14 — 2026-08-25 : des vérifications automatiques, enfin

Le projet comptait **6 161 lignes et zéro test**. Trois familles ont été
écrites, **75 vérifications**, qui tournent en **15 secondes** par `npm test`.

| Famille | Ce qu'elle protège | Nombre |
|---|---|---|
| 1. Règles métier | empreintes d'œuvre, dates Open Library, cycles, code-barres, progression, regroupement par auteur, âge des archives | 33 |
| 2. Base de données | migrations, clés étrangères, ajout sans doublon, éditions multiples, promotion d'identité, listes, cloisonnement des profils | 19 |
| 3. Résistance aux pannes | réessais 503, refus de réessayer un 429, quota, normalisation Google, archive hors ligne, cache des identifications ratées, cache journalier des suggestions | 23 |

**Choix : aucun appel réseau réel.** Des vérifications dépendant de l'humeur de
Google échoueraient au hasard 25 à 40 % du temps, consommeraient le quota, et
ne permettraient plus de distinguer un défaut d'une panne passagère. Un script
séparé, `npm run controle-sources`, interroge les vraies sources à la demande
et rend un verdict lisible — il vérifie aussi que **la clé Google est bien
restreinte à la seule Books API**.

**La base tourne pour de vrai** (sql.js en mémoire, le moteur du navigateur) :
seul le chemin du fichier `.wasm` est redirigé. Simuler la base n'aurait rien
prouvé.

| # | Ce que les vérifications ont trouvé | Correction |
|---|---|---|
| 92 | **Bug réel, trouvé par la toute première campagne** : `progressionDe()` rendait **-2 %** sur une position négative — le repli en pourcentage bornait à 0, le calcul normal non. `setPosition` interdit les valeurs négatives, mais **une sauvegarde restaurée n'est pas filtrée** : la donnée peut entrer par là | Bornage par le bas ajouté |
| 93 | `createListe()` rend le **nom** de la liste, alors que `addToListe()` et `deleteListe()` attendent un **identifiant** | Incohérence relevée, non corrigée : aucun écran n'en souffre, et la changer toucherait la façade. Notée ici pour ne pas être redécouverte |
| 94 | Cinq fonctions de `Recherche.jsx` n'étaient pas exportées, donc invérifiables | Exportées **sans être déplacées** — le découpage du fichier viendra ensuite, avec ces vérifications pour filet |

**Dette reconnue et datée** : `Recherche.jsx` était à **653 lignes**, quand
§2.2 justifie son existence même par le reproche fait au projet séries d'un
`App.jsx` à 656 lignes. Les tranches 10 et 11 l'ont fait grossir. **Traité en
tranche 15, ci-dessous.**

---

### Tranche 15 — 2026-08-25 : le découpage, sous filet

Fait **après** les vérifications et non avant : c'était le sens de l'ordre
choisi. Les 75 vérifications ont été relancées à chaque étape, et l'écran
réellement manipulé dans le navigateur — elles ne couvrent pas le rendu.

| Fichier | Avant | Après |
|---|---|---|
| `screens/Recherche.jsx` | **653** | **441** |
| `App.jsx` | 334 | **274** — sous la cible de 300 de §2.2, pour la première fois |

**Cinq modules nés de ce découpage**, tous prévus ou justifiés :

| Nouveau | Contenu | Pourquoi |
|---|---|---|
| `auteurs.js` | `sansAccent`, `cleAuteur`, `nomComparable`, `grouperParAuteur` | Fonctions **pures** — aucun état, aucun rendu, aucun réseau. Elles n'avaient rien à faire dans un composant |
| `screens/Reglages.jsx` | profil, affichage, données, quota, diagnostic | **Prévu par §2.2 depuis le premier jour**, jamais extrait |
| `components/FicheResultat.jsx` | la fiche d'un livre trouvé, avant ajout | 92 lignes de présentation pure |
| `components/CreationManuelle.jsx` | créer un livre qu'aucun catalogue ne connaît | 58 lignes |
| `components/MenuCategorie.jsx` | le choix de catégorie sur appui long | 35 lignes |

`ageLisible()` rejoint `status.js`, qui rassemblait déjà les règles d'affichage
dérivées (`enHeures`, `libelleProgression`).

Deux actions qui vivaient **dans le JSX** — créer un livre à la main, ranger un
résultat dans une catégorie — sont devenues des fonctions nommées
(`creerALaMain`, `rangerDansCategorie`). Une fonction anonyme de trente lignes
au milieu d'un `onClick` ne se relit pas, et ne se teste pas.

**Vérifié dans le navigateur après découpage** : recherche (20 livres), fiche
(4 lignes + bloc identité), appui long (les 4 catégories), création manuelle
**enregistrée en base puis retirée**, bascule de thème, compteur de quota.
Aucune erreur JavaScript.

**Reste à surveiller** : `store.js` à 807 lignes est désormais le plus gros
fichier du projet. Il n'a pas grossi récemment et reste cohérent — un seul
sujet, le SQL — mais c'est le prochain sur la liste si le besoin s'en fait
sentir.

---

---

### Tranche 16 — 2026-08-25 : « plein de trucs bizarres »

Retour d'usage : « j'ajoute des livres tout va bien, je scan un livre il le
reconnaît, je l'ajoute, et puis je reviens dans ma bibliothèque il n'est plus
là ? j'ai une catégorie audio ? » — suivi de : « l'application n'est pas finie
et même bâclée parfois ».

**Le jugement était fondé.** Quatre défauts, dont un que j'avais moi-même
introduit et livré trois fois.

| # | Symptôme | Cause RÉELLE, mesurée | Correction |
|---|---|---|---|
| 95 | **La fiche de détail plantait à l'ouverture**, sur les trois derniers APK livrés | `choisirCouverture` avait été insérée **à l'intérieur d'une autre fonction** en tranche 11 : elle était donc invisible depuis le rendu, et React levait `choisirCouverture is not defined`. **Ni le build ni les 95 vérifications ne l'ont vu** — c'est une erreur d'exécution, pas de compilation, et rien n'ouvrait alors un écran. L'`ErrorBoundary` masquait la casse | Fonction remise au bon niveau, et **famille 6 de vérifications créée** (voir plus bas) |
| 96 | Un livre scanné « disparaissait » de la bibliothèque | Il n'avait pas disparu : il était rangé sous « Pas encore paru ». `finDePeriode('2026')` rendait **31 décembre 2026**, donc au 25 août 2026 **tout livre publié dans l'année en cours** était déclaré à venir. Or Google ne donne souvent **que l'année** : c'est le cas le plus fréquent, pas un cas limite | `debutDePeriode()` remplace `finDePeriode()` : face à une date incomplète, on suppose que le livre **est sorti**. Se tromper ainsi l'affiche un peu tôt ; se tromper dans l'autre sens le fait disparaître aux yeux de son propriétaire. **Les deux erreurs ne se valent pas** |
| 97 | Un livre marqué **Lu** restait rangé « À paraître » et ne comptait dans **aucun** statut | La mise de côté ignorait le statut. **Le projet films/séries ne fait pas cette erreur** : `Upcoming` y filtre sur `status === 'a_voir'`. Cette condition manquait ici | `estEnAttenteDeParution(oeuvre)` : un livre qu'on a commencé, lu ou abandonné appartient à sa bibliothèque, quelle que soit la date du catalogue |
| 98 | « J'ai une catégorie audio ? » | Un filtre Tout / Papier / Numérique / Audio occupait une ligne entière en permanence. Et il était **faux** : sur 4 livres papier, toucher « Audio » en affichait 1, parce que la section « Pas encore paru » ignorait les filtres | Le filtre ne s'affiche **que si la bibliothèque contient plusieurs formats**, et la section « Pas encore paru » lui obéit enfin |

**Couvertures manquantes** — seconde priorité désignée par Kinder. Mesure sur
80 résultats réels :

| | |
|---|---|
| couverture fournie par Google | **81 %** |
| rattrapées par le repli Open Library | **0 sur 15** |
| aucune couverture possible | **19 %** |

Le repli Open Library par ISBN, annoncé au §4.2 comme rattrapant « deux sur
cinq », **n'en rattrape aucun**. Une autre piste a été testée puis écartée :
l'URL de couverture Google construite à la main rend une **image générique de
1 269 octets**, jamais la vraie. Ces 19 % n'auront donc jamais de photo.

D'où `CouvertureDessinee.jsx` : au lieu d'une case grise « Pas de couverture »,
le titre et l'auteur sur une teinte **calculée depuis le titre** — stable d'une
session à l'autre, pour que l'œil retrouve le livre dans la grille. Un seul
domicile, partagé par la grille et la fiche.

### Famille 6 de vérifications — « les écrans se rendent sans planter »

La vérification qui manquait, et qui a coûté trois versions. Elle **dessine**
chaque écran avec des données crédibles et vérifie qu'il ne lève pas d'erreur.
Cela n'atteste pas qu'un écran est joli — cela atteste qu'il s'affiche, ce qui
est le minimum.

**Preuve faite** : le bug 95 a été réintroduit volontairement, la famille 6 l'a
signalé immédiatement (`choisirCouverture is not defined`), puis il a été
retiré. Total : **115 vérifications**.

**Leçon, écrite ici pour ne pas être réapprise** : les familles 1 à 3
vérifiaient des *pièces*. Un projet d'interface a besoin qu'on vérifie aussi
que l'*assemblage* s'affiche. Sans cela, on livre du code qui compile et qui
plante.

---

---

### Tranche 17 — 2026-08-25 : cinq retours d'usage (suite)

| # | Symptôme | Ce que la mesure a dit | Correction |
|---|---|---|---|
| 99 | « Quand j'ajoute un livre j'ai une notification, j'en veux pas » | — | **Aucun message à l'ajout.** Le retour visuel existe déjà : la carte se marque. Un bandeau qui annonce ce qu'on vient de faire soi-même n'apprend rien. Les **erreurs** continuent de parler |
| 100 | « Je ne vois pas mon historique de recherche » | Il n'existait pas | Les **douze dernières recherches** en puces sur l'écran d'accueil, les plus récentes en tête, sans doublon. Toucher l'une d'elles la relance — c'est ce qui évite de retaper un titre long sur un clavier de téléphone. Bouton « Effacer » |
| 101 | « J'ai une saga de 5 tomes à la maison, il n'en voit qu'un » | Google annonce jusqu'à **300 résultats** et l'application n'en montrait que **20**, sans pagination ni indication. Sur « Le Trône de fer », la première page rend les tomes 1, 2, 3, 5, 6, 7, 8, 9, 11 à 15 — les autres étaient **hors de portée** | Bouton **« Voir plus de livres »**, qui ajoute la page suivante à la suite sans remplacer l'existant, et écarte les doublons. Vérifié : 20 → 40 livres. Jamais propose en mode ISBN — un ISBN désigne un livre |
| 102 | « Google Books me dit parfois qu'il fonctionne pas » | **Réel, et extérieur à l'application.** Contrôle du 25/08 à 21 h : Google ne répond qu'**1 fois sur 6**. À ce taux, les six essais laissent encore environ une recherche sur trois en échec | Rien à corriger dans le code : le réessai, l'archive hors ligne et le bouton « Réessayer » sont déjà en place. `npm run controle-sources` permet de distinguer une panne de source d'un défaut de l'application |

**La vraie cause du « il n'en voit qu'un »** — trouvée après que Kinder a
précisé qu'il cherchait **par titre**. Les tomes ne manquaient pas : ils
arrivaient **dans un désordre complet**, noyés parmi des résultats sans
numéro. Ordre réellement rendu par Google pour « La Quête d'Ewilan » :

```
- 1 - - - 2 3 1 - 5 2 7 - 6 - 2 - - 7 4
```

Personne ne peut lire une série là-dedans. C'était un problème de
**présentation**, pas de catalogue.

D'où `tomes.js` : `numeroDeTome()` et `separerLesTomes()`, fonctions pures.
L'écran affiche désormais **« La série, dans l'ordre »** puis « Autres
résultats ». Vérifié sur deux sagas réelles :

| Recherche | Avant | Après |
|---|---|---|
| La Quête d'Ewilan | 1, 2, 7, 5, 3 mêlés à 13 sans numéro | **12 tomes ordonnés** |
| Le Trône de fer | 3, 1, 7, 6, 15, 14, 5… | **16 tomes ordonnés** |

**Règle la plus importante de ce module : ne JAMAIS inventer un tome.** Un
numéro doit être annoncé par un mot (tome, T., livre, volume) ou des
parenthèses finales. Sans cette exigence, « 1984 » deviendrait le tome 1984.
Et en dessous de **trois** tomes distincts, rien n'est réorganisé : deux
livres numérotés peuvent n'avoir aucun rapport.

**Hypothèse testée puis ÉCARTÉE** : `langRestrict=fr` soupçonné de faire
disparaître des sagas entières. Une première mesure semblait le confirmer
(« La Roue du Temps » → 0 résultat), mais c'était un **503 déguisé** : le code
de test comptait `items` sans distinguer l'échec de l'absence. Vérification
refaite avec 12 essais : `langRestrict=fr` rend autant de résultats que sans.
Le coupable était la pagination, pas la langue.

---

---

### Tranche 18 — 2026-08-25 : les suggestions vides, et le bouton de trop

| # | Symptôme | Cause RÉELLE | Correction |
|---|---|---|---|
| 104 | « J'ai déjà ajouté 10 livres et rien ne s'affiche » | Les suggestions n'acceptaient comme **graines** que les livres marqués « lu » ou « en cours ». Or un livre ajouté entre en **« à lire »** : dix ajouts donnaient donc **zéro graine** et un écran vide. Le message d'aide demandait un travail — marquer ses livres — que personne n'a envie de faire pour obtenir des propositions | **Tous** les livres servent de graine, ceux qu'on a lus ou commencés simplement placés devant. Vérifié : 5 livres tous en « à lire » → **20 propositions**. Le message d'état vide corrigé en conséquence |
| 105 | « Je dois appuyer sur un bouton pour afficher les 20 suivants, et ainsi de suite » | Google **plafonne à 20 résultats par requête** : mesure du 2026-08-25, demander `maxResults=40` en rend 20 quand même, avec ou sans `langRestrict`. Enchaîner les pages est donc la seule voie — mais la faire déclencher par l'utilisateur était une corvée | **Chargement automatique au défilement**, jusqu'à **5 pages (100 livres)**. Au-delà, le bouton reprend la main : continuer devient un choix, c'est le quota qui l'impose. Vérifié : 20 → 40 → 60 → 80 → 100, puis bouton |

**Deux pièges rencontrés en écrivant le chargement automatique**, tous deux
résolus à l'exécution et non par raisonnement :

1. La sentinelle de fin de liste avait une **hauteur de 0 px**. Un élément sans
   hauteur n'est jamais considéré comme visible par `IntersectionObserver` :
   le chargement ne partait jamais.
2. Même avec une hauteur, l'observateur **ne se déclenchait toujours pas** —
   pas davantage posé à la main sur la même sentinelle, alors qu'elle était
   bien dans la fenêtre (632 px pour une hauteur de 720). Quelque chose dans la
   mise en page l'en empêchait. **`IntersectionObserver` a été abandonné** au
   profit d'un simple écouteur de défilement : il ne dépend d'aucune subtilité
   de rendu et se comporte pareil dans un WebView Android. Chercher la cause
   exacte aurait coûté plus cher que la solution simple.

**Règle conservée** : la suggestion du **tome suivant** continue de n'utiliser
que les livres « lu » ou « en cours ». Proposer le tome 2 d'un livre qu'on n'a
pas encore ouvert serait prématuré.

**129 vérifications** (famille 4 enrichie du cas « dix livres à lire »).

---

---

### Tranche 19 — 2026-08-26 : le choix des sources, remis en cause et arbitré

Question posée : *« est-ce qu'on n'a pas mieux ? j'ai l'impression qu'il est
limité, pas complet »*. Quatre sources mesurées sur les mêmes recherches.

| Source | Fiabilité | Latence | Couvertures | Résumés | Quota | Clé |
|---|---|---|---|---|---|---|
| **Google Books** | **4/6** — et 1/6 deux heures plus tôt | 851 ms | **81 %** | oui | 1 000/j | oui |
| **Open Library** | variable | **4 à 21 s** | **0 sur 15** | oui, en anglais | non | non |
| **BnF (SRU)** | **10/10 puis 6/6** | 300–1 300 ms | non | non | **aucun** | **aucune** |
| **Wikidata** | ok | **10,5 s** | non | non | non | non |

**Le diagnostic corrige l'impression** : Google Books n'est pas *incomplet*, il
est **instable**. Quand une recherche échoue, l'utilisateur conclut que le
livre n'existe pas — alors qu'il est là.

**Écartées** : Wikidata (10,5 s, résultats bruités — personnages et éditions
norvégiennes), Goodreads (API fermée depuis 2020), Babelio (aucune API
publique), ISBNdb / WorldCat / Electre (payants), Amazon (compte affilié).

**Retenue : la BnF, en FILET et jamais en premier.** C'est le dépôt légal
français — tout livre publié en France y figure par obligation légale — en
HTTPS, avec `Access-Control-Allow-Origin: *`.

| # | Point | Détail |
|---|---|---|
| 106 | Google tombe une fois sur trois et l'écran affichait une erreur | La BnF prend le relais **avant** l'archive. Vérifié, Google coupé à 100 % : « les fourmis » rend **20 livres, les bons**, en 3,8 s |
| 107 | Des ISBN français qu'aucune source ne connaissait | Troisième chance à la BnF après Google et Open Library. Elle répond aux trois ISBN de référence en **76 à 128 ms**, et rattrape 1 des 3 que Google ignore |

**Trois pièges, tous vérifiés sur appels réels :**

1. **Elle contient tout le dépôt légal** — une recherche « asterix » rendait
   des cassettes vidéo. D'où le filtre `bib.doctype any "a"` (texte imprimé).
2. **Elle indexe les livres antérieurs à 2007 en ISBN-10.** Chercher
   « 9782226052575 » ne rend **rien** ; « 2226052577 » rend *Les Fourmis*.
   D'où `isbn13Vers10()`, avec recalcul de la clé de contrôle.
3. **Sa pertinence est franchement moins bonne que Google** : « germinal » y
   rend une revue de Lormont avant le roman de Zola, et « werber » en mode
   auteur rend Gerson et Eva Bell Werber avant Bernard. **C'est la raison
   pour laquelle elle reste un filet** — une vérification s'assure d'ailleurs
   qu'elle n'est *pas* appelée quand Google répond.

Le XML est lu **sans `DOMParser`** : il n'existe pas sous Node, où tournent les
vérifications. Le format SRU est régulier, quelques expressions suffisent, et
le code reste identique des deux côtés.

**141 vérifications** (famille 8, 14 cas). `npm run controle-sources` teste
désormais aussi le filet — sans consommer de quota, la BnF n'en ayant pas.

---

---

### Tranche 20 — 2026-08-26 : les éditions qu'on possède, et un mot trompeur

| # | Demande | Ce qui existait | Correction |
|---|---|---|---|
| 108 | « Le terme *rattacher à une œuvre existante* est trompeur : on rattache à notre bibliothèque » | Exact. « Œuvre existante » évoquait un catalogue extérieur, alors qu'il s'agit de **réunir deux livres en double dans sa propre bibliothèque** | Bouton : « **C'est le même livre qu'un autre de ma bibliothèque** ». Modale : « **Réunir deux livres de ma bibliothèque** ». Le texte explique désormais que c'est un doublon qu'on fusionne |
| 109 | « J'aimerais que les éditions associées s'affichent et qu'on puisse choisir celle qu'on a (une ou plusieurs), et choisir celle qui s'affiche » | Il fallait **chercher chaque édition à la main**, une par une, en tapant son titre — alors que les catalogues savent les lister | La modale s'ouvre désormais sur **les éditions déjà trouvées**, avec éditeur, année et ISBN. On en coche **plusieurs à la suite** sans qu'elle se referme, et l'`EditionPicker` existant choisit celle qui s'affiche |

**La BnF passe ici EN PREMIER**, contrairement à la recherche générale où elle
n'est qu'un filet. C'est le seul endroit où elle bat Google, et la mesure est
nette : « les fourmis » + « werber » y rend **12 éditions françaises** — France
Loisirs, Albin Michel, Livre de Poche… — avec éditeur, année et ISBN, en
**645 ms**. C'est exactement la question qu'on lui pose : *quelles éditions de
ce texte existent en France ?* Google, lui, mélange les tomes et les livres qui
*parlent* de l'œuvre. Repli sur Google pour un livre étranger non traduit.

**Open Library mesuré puis écarté pour cet usage** : `/works/{id}/editions`
rend **161 à 252 éditions en 7,5 à 8,4 s**, toutes langues confondues — de
l'italien, du portugais, du polonais, de l'hébreu. Inutilisable pour retrouver
l'exemplaire posé sur son étagère.

**Vérifié de bout en bout** : 13 éditions proposées, deux cochées à la suite
sans fermeture, 3 éditions en base, changement de celle qui s'affiche — la
pagination de la fiche suit.

### Famille 9 de vérifications — les hooks avant tout retour

**Deuxième fois qu'une insertion mal placée coûte une version.** Un `useState`
avait été posé **après** le `if (sousModale) { return … }` de `Detail.jsx` :
le hook n'était jamais initialisé à l'ouverture d'une sous-modale, et l'écran
mourait sur « Cannot access 'propositions' before initialization ». C'est une
règle universelle de React, que ni le build ni le rendu d'un écran ne peuvent
voir — il faut *ouvrir* la sous-modale.

Un contrôle lit donc le code lui-même. **Deux pièges en l'écrivant, tous deux
instructifs :**

1. La première version ne repérait le `return` qu'à quatre espaces
   d'indentation — dans `Detail.jsx` il est imbriqué, donc à six. Elle ne
   mordait pas.
2. Elle serait passée même en n'analysant **aucun fichier**. Un garde-fou
   exige désormais qu'au moins dix fichiers soient lus : *un contrôle qui
   n'analyse rien passe toujours*.

Preuve faite : le hook a été remis au mauvais endroit, le contrôle l'a nommé
(`components\Detail.jsx:415`), puis il a été remis en place. **143 vérifications.**

---

---

### Tranche 21 — 2026-08-26 : l'édition ajoutée, et la couverture qui suit

| # | Symptôme | Cause | Correction |
|---|---|---|---|
| 110 | « J'ajoute une édition mais c'est pas pris en compte, j'ai dû appuyer sur l'édition actuelle pour que ça charge » | `prendreEdition` appelait `onChange()`, qui rafraîchit la bibliothèque d'`App` — mais la liste d'éditions de la **fiche** a son propre chargement. L'édition existait en base et ne s'affichait pas | `charger()` **et** `onChange()`. Vérifié à l'écran : 1 → 2 éditions sans rien toucher d'autre |
| 111 | « Changer l'édition ne prenait pas en compte le changement de l'image de couverture, j'aimerais que la pochette s'adapte si on l'a » | La couverture venait toujours de la table `oeuvres`. La pagination suivait l'édition active, l'image non — alors que `editions.couverture_url` existait **déjà** et était remplie | La requête de bibliothèque choisit désormais l'image dans cet ordre |

**L'ordre des couvertures, et pourquoi** — il applique §9, *« une donnée
corrigée à la main n'est jamais écrasée par une lecture automatique »* :

1. une **photo prise par l'utilisateur** (`data:`) l'emporte toujours ;
2. sinon la couverture de **l'édition active**, si elle en a une ;
3. sinon celle de l'œuvre — puis la couverture dessinée.

L'étape 2 sans l'étape 1 aurait fait disparaître la photo personnelle dès qu'on
change d'édition. L'étape 3 est indispensable : **les éditions venues de la BnF
n'ont aucune image**, et sans elle, choisir une édition BnF aurait vidé la
vignette.

**Vérifié de bout en bout** : la grille et la fiche montrent la couverture de
l'édition active, et elle change quand on bascule d'une édition à l'autre —
Google pour Albin Michel, Open Library pour France Loisirs.

**147 vérifications** (4 cas ajoutés à la famille 2, dont la primauté de la
photo personnelle).

---

---

### Tranche 22 — 2026-08-26 : mon avis sur un livre

Demande : *« j'aimerais pour chaque livre pouvoir ajouter une note dessus, peu
importe l'édition, note et commentaire associés »*.

**Constat en ouvrant le code** : la colonne `note` existait **depuis le premier
jour**, avec son `setNote()` dans `store.js` **et** dans la façade — mais aucun
écran ne l'a jamais proposée. Elle était inaccessible. Seul le commentaire
manquait vraiment (**migration 3**).

Les deux portent sur l'**œuvre** et non sur l'édition, comme demandé : ce qu'on
pense d'un texte ne change pas parce qu'on l'a lu en poche plutôt qu'en grand
format.

| # | Point | Détail |
|---|---|---|
| 112 | Note et commentaire | Bloc « Mon avis » dans la fiche, après la progression — on note un livre quand on vient d'avancer dedans, pas au moment de le ranger. Cinq étoiles, et **retoucher la même étoile efface la note** : c'est le seul moyen de revenir en arrière |
| 113 | *(trouvé en écrivant les vérifications)* La **promotion d'identité** recopie les colonnes une à une | Sans ajout explicite de `commentaire`, l'avis aurait disparu **le jour où Open Library reconnaît enfin le livre** — silencieusement. Vérifié |
| 114 | *(trouvé de même)* **Réunir deux livres** supprimait l'avis de celui qu'on absorbe | §6 dit « c'est l'autre qui gagne », et cela reste vrai pour le statut et la progression. Mais un commentaire est un **texte écrit à la main** : le supprimer en silence est la pire chose qu'on puisse faire. Il est désormais **récupéré si le livre conservé n'a rien** — et n'écrase jamais un avis existant |

**Deux rythmes d'enregistrement, et c'est voulu** : l'étoile s'enregistre **au
clic** — noter est un geste unique, attendre une validation serait absurde ; le
commentaire s'enregistre à la sortie du champ **et** par un bouton qui
n'apparaît que si le texte a changé. Le `onBlur` seul est capricieux sur
téléphone, et perdre un texte qu'on vient d'écrire est inacceptable.

**Migration vérifiée sur une base existante** : schéma v3, les livres et leurs
données conservés.

**155 vérifications** (8 cas ajoutés, dont la survie de l'avis à la promotion
d'identité et à la fusion).

---

---

### Tranche 23 — 2026-08-26 : la qualité des résultats, mesurée puis corrigée

Trois sujets posés ensemble : *« les couvertures sont rarement affichées et ce
sont souvent les vieilles »*, *« j'aimerais pouvoir trier »*, *« pourquoi le
bloc de la série n'apparaît pas depuis le début ? »*.

| # | Symptôme | Ce que la mesure a dit | Correction |
|---|---|---|---|
| 115 | « Les couvertures sont rarement affichées » | **Elles ne manquaient pas.** 13 à 20 sur 20 dans les résultats, et **13 sur 13 se chargeaient sans erreur** en HTTPS. Elles faisaient **128 × 207 pixels** — une vignette floue et grise qu'on ne « voit » pas sur un téléphone —, avec un effet de page cornée par-dessus | `zoom=2` dans l'adresse de l'image : **300 × 474**, sans **aucune** requête supplémentaire, c'est la même adresse et un chiffre qui change. `edge=curl` retiré. Vérifié à l'écran : **300 × 462 chargés**, 38 couvertures sur 40 livres |
| 116 | « Pourquoi le bloc de la série n'apparaît qu'après ? » | Le bloc exige **3 tomes**. Or la première page de « game of thrones » n'en contient que **DEUX** — le reste est constitué d'essais *sur* la série (« une métaphysique des meurtres », « le livre des festins », « comprendre le leadership avec la série »). Le seuil n'était atteint qu'en page 2, donc **après deux défilements** : le bloc surgissait alors en haut et tout se réorganisait sous les yeux | **Série pressentie** : deux tomes vus et trois pas atteints → la page suivante est chargée **immédiatement**, en silence. Une requête de plus, uniquement dans ce cas. Vérifié : le bloc apparaît **sans défiler** |

**Le tri : mesuré, puis abandonné à la demande de Kinder.** Google **ignore**
la consigne de tri — testé, `orderBy=newest` renvoie exactement le même ordre
que par défaut, mêmes titres et mêmes années. Un tri aurait donc dû se faire
dans l'application, sur les résultats déjà reçus. Interrogé sur les tris
souhaités, Kinder n'a retenu que **« Pertinence »**, qui est l'ordre actuel :
le sujet devient sans objet et **rien n'a été ajouté**. Point signalé, car sa
demande initiale mentionnait la date de sortie.

**Deux pistes mesurées puis écartées pour les couvertures manquantes** — celles
des livres venus du filet BnF, qui ne fournit aucune image :

| Rattrapage tenté | Résultat |
|---|---|
| Google Books par ISBN | **1 sur 5** |
| Open Library par ISBN | **3 sur 5** |

Le repli Open Library est **déjà en place** (`avecCouvertureDeRepli`) et
s'applique aux résultats de la BnF. Rien à ajouter ; le quart restant garde sa
couverture dessinée.

**159 vérifications** (4 cas ajoutés à la famille 7).

---

---

### Tranche 24 — 2026-08-26 : la vignette de chaque édition

| # | Demande | Correction |
|---|---|---|
| 117 | « Dans la liste des éditions d'un livre, j'aimerais voir la miniature de l'édition » | Vignette de **38 × 57 px**, format 2:3 comme toutes les couvertures du projet, **aux deux endroits** : la liste des éditions possédées (`EditionPicker`) et celle des éditions proposées à l'ajout |

La donnée était déjà là — `editions.couverture_url` est remplie depuis
l'origine, et `getEditions()` la rendait déjà. Il n'y avait qu'à l'afficher.

**Pourquoi les deux endroits** : choisir entre « A. Michel 1991 » et « le Livre
de poche 2024 » sur la foi de deux lignes de texte demande de connaître ses
éditions par cœur ; leurs couvertures se reconnaissent d'un coup d'œil. C'est
au moment de **cocher** qu'on en a le plus besoin.

**Repli en cascade, comme partout ailleurs** : vraie couverture → couverture
dessinée si l'édition n'en a pas (cas de la BnF) → couverture dessinée aussi si
l'adresse de l'image ne répond plus (`onError`). Mesuré sur *Les Fourmis* :
**10 éditions sur 10 illustrées**, dont 8 vraies couvertures et 2 dessinées.

**Fausse alerte relevée puis écartée** : un premier comptage annonçait « une
ligne sans vignette ». C'était le bouton **« Saisir un exemplaire à la main »**,
qui partage la classe `.ligne-resultat` — pas une édition. Aucune correction
n'était nécessaire, et il aurait été facile de « réparer » ce qui allait bien.

---

---

### Tranche 25 — 2026-08-26 : le cache qui ne servait qu'aux pannes

| # | Symptôme | Cause RÉELLE | Correction |
|---|---|---|---|
| 118 | « Je fais une recherche, je quitte, je reprends la même recherche, il doit toujours charger » | **Défaut de conception.** Le cache mémoire meurt avec l'application, et l'archive persistante — qui contenait pourtant déjà les résultats — n'était lue **que dans le `catch`**, c'est-à-dire uniquement quand Google tombait. On rappelait Google alors qu'on avait la réponse sous la main | L'archive est lue **avant** l'appel réseau, si elle a moins de **24 h**. Un catalogue de livres ne change pas dans la journée, et chaque appel évité est un appel de moins sur les 1 000 quotidiens |
| 119 | « Quand je refais la même recherche, le bloc *La série dans l'ordre* ne s'affiche pas, je dois reprendre le même processus » | **Même cause.** La confirmation de série demande la page 2 ; celle-ci repassait par le réseau à chaque fois, avec ses pannes et ses secondes d'attente | Résolu par la correction 118 : la page 2 vient de l'archive, donc le bloc apparaît **immédiatement** |

**Mesuré, sur la même recherche après relance de l'application :**

| | Avant | Après |
|---|---|---|
| Appels réseau | 1 | **0** |
| Temps | 785 ms | **10 ms** |
| Bloc « La série, dans l'ordre » | absent | **affiché** |

**Distinction posée** : l'archive a désormais **deux rôles**. En dessous de 24 h
elle est un **cache** et se donne pour fraîche ; entre 24 h et 7 jours elle
reste un **filet** en cas de panne, annoncé comme « ancien » à l'utilisateur.

**Trois pièges dans les vérifications elles-mêmes**, tous instructifs :

1. Une `Response` ne se lit qu'**une fois**. Réutiliser la même pour plusieurs
   appels donne « Body has already been read » — il faut en fabriquer une neuve
   à chaque appel.
2. Un test devenu **faux par la correction** : il attendait `ancien === true`
   sur une archive fraîche, qui est désormais servie comme un cache. Il
   **vieillit** maintenant l'archive de deux jours pour tester le vrai repli.
3. L'archive s'écrit **sans être attendue** (pour ne pas retarder l'affichage) :
   la vieillir aussitôt ne trouvait rien. Une respiration de 30 ms, et une
   assertion qui vérifie que l'archive existe bien avant de la manipuler.

**162 vérifications.**

---

---

### Tranche 26 — 2026-08-26 : le tri, enfin

| # | Demande | Détail |
|---|---|---|
| 120 | « J'aimerais pouvoir trier par pertinence ou date de sortie » | Sélecteur **Pertinence / Plus récent** au-dessus des résultats, affiché seulement au-delà de 3 livres — en dessous, il occuperait plus de place qu'il n'en ferait gagner |

**Le tri vit dans l'application, pas chez Google** : mesuré le 2026-08-26,
`orderBy=newest` rend **exactement le même ordre** que par défaut, mêmes titres
et mêmes années. Google ignore la consigne. Comme l'année de chaque livre est
déjà là, trier soi-même est instantané et fiable.

**Deux règles posées :**

- Le tri s'applique **avant** le regroupement en série. Les « autres
  résultats » suivent donc l'ordre choisi, tandis que **les tomes gardent le
  leur** — un tome 3 doit rester entre le 2 et le 4, c'est toute la raison
  d'être de ce bloc.
- Les livres **sans date vont à la fin**, jamais en tête. Un livre non daté
  n'est pas un livre récent, et le placer en premier d'un tri « plus récent »
  serait trompeur.

**Vérifié à l'écran**, sur « game of thrones » :

```
Pertinence   2019 2017 2024 2021 2025 2017 2003 2020
Plus récent  2025 2025 2024 2024 2021 2020 2019 2019
```

*Note de méthode* : ce tri avait été écarté deux tranches plus tôt, Kinder
n'ayant retenu que « Pertinence » dans une question à choix multiple — alors
que sa demande initiale mentionnait la date. Le point lui a été **signalé**
plutôt que classé, et il l'a confirmé. Une réponse à une question fermée ne
remplace pas toujours une demande écrite.

**168 vérifications.**

---

**Le cycle ouvert par la tranche 8 est refermé.** Les cinq causes du symptôme
initial — « Google Books n'est pas disponible, et c'est lent » — ont été
traitées : réessais (8), budgets de la fiche (9), archive hors ligne (10),
retours d'usage (11), quota (12).

**Nouvelles fonctions de la façade** (§2.1 s'enrichit, ne se modifie pas) :
`creerOeuvreManuelle(saisie)` et `surChangementDeFond(fn)` — ce dernier permet
à l'écran de suivre une promotion d'identité survenue après coup.
Côté `store.js` : `promouvoirIdentite()` et `creerOeuvreManuelle()`.


---

### Tranche 27 — 2026-08-27 : la recherche, réparée en quatre temps

> Remontée ici le 2026-08-28, depuis `PLAN_MISSION_RECHERCHE.md`, désormais
> supprimé. Six symptômes rapportés, **quatre causes réelles** dans le code.

| # | Symptôme | Cause |
|---|---|---|
| 121 | Les premiers résultats sont peu pertinents ; il faut défiler | A |
| 123 | Il faut revenir en arrière pour retrouver ce qu'on avait ; « rien n'est en cache » | B |
| 122 | Peu de couvertures en recherche, mais les bonnes dans « autre édition » | C + D |

**Cause A — personne ne jugeait la pertinence à part Google.** L'écran affichait
`intitle:` dans l'ordre d'arrivée, et le tri dit « Pertinence » ne faisait
rien : le tri par défaut était l'absence de tri.

**Cause B — l'écran de recherche était détruit à chaque changement d'onglet.**
Le cache fonctionnait pourtant ; c'est l'écran qui se vidait.

**Cause C — la couverture dépend de l'ISBN**, que `intitle:` n'a presque jamais.

**Cause D — aucun regroupement des doublons.** La fiche pauvre s'affichait à la
place de la bonne, présente quinze lignes plus bas dans la même liste.

**Les quatre temps :**

1. **Classer nous-mêmes** (`scorePertinence`, dans `tomes.js`) : correspondance
   du titre, sérieux de la fiche, langue française ; pénalité aux titres bien
   plus longs que la recherche, signature de l'essai. **Le score classe, il ne
   filtre jamais.**
2. **Fusionner les doublons** (`fusionnerDoublons`, dans `books.js`) : une carte
   par œuvre, la mieux classée, **complétée** par ce que les autres savent.
   « germinal » passe de 20 fiches à 16 cartes, toutes illustrées.
3. **Garder l'écran en vie** : la Recherche est **masquée**, plus démontée.
   Trois allers-retours entre onglets laissent 12 cartes sur 12 et **zéro appel
   réseau**.
4. **Compléter par la BnF**, en parallèle de Google. Résultat plus nuancé
   qu'annoncé : **+16 % d'éditeurs**, mais seulement +3,5 % d'ISBN. La tranche a
   raté sa cible annoncée et en a atteint une autre ; gardée quand même, un
   appel sans clé ni quota se paie de lui-même.

**Quatre corrections après audit sur données réelles**, le même jour :

| # | Correction | Vérifié |
|---|---|---|
| 1 | **Champ auteur facultatif** en mode Titre (`intitle:` + `inauthor:`) | « les fourmis » + « werber » → Werber **1ᵉʳ** |
| 2 | **Séries nommées**, classées selon leur pertinence et non en tête d'office | « la quête d'Ewilan » ne mélange plus trois cycles |
| 3 | **Clé de regroupement insensible à l'ordre du nom** | « emile zola » et « Zola, Emile » → une seule carte |
| 4 | **Mots comptés sur le titre brut** | une édition russe ne passe plus pour une correspondance parfaite |

**Décision de conception importante** : la correction 3 crée une clé de
regroupement **propre à la recherche** (`cleRegroupement`). L'empreinte d'œuvre
de §3.2 n'est pas touchée — elle est écrite en base et sert de clé étrangère.
**Deux besoins, deux fonctions.**

---

### Tranche 28 — 2026-08-28 : ce que le projet séries avait, et l'ordre des résultats

> Mission cadrée après audit du projet `TMDB _ The Movie Database`, pris comme
> exemple. Remontée ici depuis `PLAN_MISSION_V2.md`, désormais supprimé.

#### Ce que le cadrage a économisé

Six manques avaient été annoncés face au projet séries. **La lecture du code en
a invalidé deux et redimensionné un troisième**, avant d'écrire une ligne :

- l'**export CSV Goodreads** existait déjà (`backup.js`) ;
- l'écran **« à paraître »** existait déjà (`MaLecture.jsx`) ;
- **« Que lire maintenant ? »** existait déjà — c'est `MaLecture` : il n'était
  simplement pas l'écran d'accueil.

#### Le banc d'essai, avant tout le reste

`npm run banc` rejoue la chaîne complète d'affichage — vraie fusion, vrai score,
vrais blocs de série — sur **sept recherches de référence**, et imprime la place
du livre cherché. Ce n'est pas une vérification automatique : **il n'échoue
jamais, il montre.**

Il a payé immédiatement : au premier lancement il a **infirmé une affirmation du
plan** (« le trône de fer ne trouve rien » — faux, il était 2ᵉ), et il a montré
que le problème était plus étroit qu'annoncé : **5 recherches sur 7 étaient déjà
bonnes**.

#### L'accueil

`ACCUEIL` passe de `'recherche'` à `'lecture'`. L'application ouvrait sur un
champ vide et un clavier ; elle ouvre désormais sur « tu es à la page 210 de
Germinal ». Une constante — l'écran existait déjà.

Conséquence à connaître : le bouton retour d'Android ramène désormais à
« Ma lecture » depuis la Recherche, au lieu de quitter l'application.

#### Les statistiques, en bas de la Bibliothèque

Pas un cinquième onglet : la barre en porte déjà quatre. Pages lues sur 7 /
30 jours et l'année, livres terminés par mois sur douze mois, note moyenne,
avis, faits d'armes.

**Quatre règles posées :**

- **la répartition par statut n'y figure pas** — les quatre pavés en haut de la
  même page la donnent déjà ;
- **pages et minutes ne s'additionnent jamais** (§5.3). Un profil sans livre
  audio ne lit jamais le mot « minute » ;
- **un livre sans pagination est écarté du total** : sa position est un
  pourcentage (§5.4) ;
- **aucun temps de lecture, aucune vitesse** : le projet ne stocke pas de durée
  de session. Ce serait un chiffre inventé affiché avec autorité.

**Un défaut trouvé en construisant l'écran, corrigé dans `store.js`.**
`rythmeDepuis` comptait l'écart entre la position la plus récente et la plus
ancienne **de la fenêtre** : avec une seule saisie, l'écart vaut zéro — donc
**la toute première fois qu'on note sa page ne comptait jamais**. Le calcul part
désormais de la dernière position connue **avant** la fenêtre, et de zéro à
défaut. Corrigé dans l'unique domicile de la règle : « Ma lecture » lit le même
calcul et y gagne aussi.

#### Open Library décide l'ordre — l'arbitrage 16 infirmé

**Google Books est un catalogue de documents ; Open Library est un catalogue
d'œuvres, avec une popularité.** C'est l'avantage que TMDB donnait au projet
séries, et que ce projet s'était cru privé.

Sur « game of thrones », le roman de Martin arrivait **4ᵉ**, derrière trois
essais. Le score n'y pouvait rien : tous ses signaux sont des propriétés du
*document*, et **un essai bien édité est un excellent document**.

**On rapproche par l'AUTEUR, pas par le titre.** Open Library indexe sous le
titre canonique anglais — « A Game of Thrones » ne rejoindrait jamais « Le Trône
de Fer ». L'auteur, lui, traverse les traductions. Et c'est le bon signal :
**les essais sur une œuvre ne sont pas écrits par l'auteur de l'œuvre.**

**Le rang, pas le compte.** Utiliser le *nombre de lecteurs* a été essayé puis
écarté par la mesure : sur « les fourmis », le roman de Werber marque 119 contre
149 au documentaire jeunesse, et les trente points d'écart viennent de la
**complétude de la notice**, pas du livre. Or 36 lecteurs ne rattrapent jamais
cela — Open Library est anglophone. Le **rang** est relatif, donc immunisé :
Werber est 1ᵉʳ sur « les fourmis » comme Martin sur « game of thrones ».
Barème : 36 points au 1ᵉʳ rang, −4 par rang. Le plafond doit renverser un écart
de complétude (35 au plus) sans jamais renverser un écart de titre.

**Le cache de notoriété, qui n'était pas prévu et qui est la pièce maîtresse.**
Open Library n'a ni clé ni quota, mais **aucun engagement de service** : mesuré
en fenêtre dégradée, **2 réponses sur 12**. Sans cache, le classement dépendait
de l'humeur du service à la seconde où l'on tapait. On garde donc les œuvres
notoires **sept jours** — ce n'est pas un catalogue, c'est le fait que Martin
écrit *Game of Thrones*, et cela ne change pas d'une semaine à l'autre — et
**en panne, on ressort la version périmée**.

Il a aussi corrigé un défaut non vu : la notoriété n'entrait que dans les vingt
premiers volumes, si bien qu'un tome trouvé en page 2 se rangeait au hasard
parmi des cartes classées. L'appel étant gratuit au-delà de la première page,
il est fait sur **toutes** les pages.

**Deux pièges de source, tous deux invisibles sans mesure :**

- `readinglog_count` **n'est pas rendu par défaut**. Une première version s'en
  passait pour la vitesse et attachait « 0 lecteur » à tout, en silence.
  **C'est le banc qui l'a vu, pas le code.**
- la projection `fields=` doit rester **courte** : 6 champs → jusqu'à 9,5 s et
  un échec ; les 4 champs utiles → 556 ms de médiane.

**Résultat, mesuré au banc :**

| Recherche | Avant | Après |
|---|---|---|
| `game of thrones` | 4 | **1** |
| `les fourmis` | 16 | **1** |
| `le trône de fer` | 2 | **1** |
| les quatre autres | 1 | 1 |

**7 / 7** en première position. Vérifié aussi dans l'application lancée.

#### Quatre missions supprimées par la mesure

Le plan en prévoyait huit. **Quatre sont tombées** parce que leur prémisse était
fausse — et c'est le résultat le plus utile du banc et du cadrage.

| Mission | Ce qu'on croyait | Ce que la mesure a montré |
|---|---|---|
| Pont FR ↔ VO | « le trône de fer » ne trouve rien | Il était déjà 2ᵉ. Réduite à une règle d'affichage, puis sans objet |
| Bibliographie d'auteur | Le mode Auteur rend des thèses | **Faux.** « tolkien » rend *Le Seigneur des anneaux*, *Le Silmarillion*, *Bilbo* ; « werber » rend Werber. Aucune thèse |
| Parutions à venir | Les catalogues annoncent les sorties | **La donnée n'existe pas.** Zéro date future sur 40 résultats, pour trois auteurs, triés du plus récent |
| Recommandations | Les sujets d'une œuvre sont exploitables | **Erratiques** : 67 sujets pour *Game of Thrones*, 100 pour *1984*, **0 pour *Bilbo***. Une fonction muette sur un des livres les plus connus du catalogue |

#### Vérifications

**264** (168 avant la mission). Nouvelles familles : **10 — statistiques**
(21 cas) et **11 — notoriété** (11 cas), plus 6 cas de résistance aux pannes et
6 sur le comptage des pages en base.

*Piège de vérification relevé au passage* : six cas cherchaient tous le même
mot, et le **cache mémoire de `books.js` survit d'un cas à l'autre** — l'un
relisait le résultat déjà classé d'un autre et passait au vert sans rien
exercer. **Un mot par cas.**

---

### Tranche 29 — 2026-08-30 : la recherche, reprise à la racine

> Remontée ici depuis `PLAN_MISSION_RECHERCHE_V3.md`, désormais supprimé.
> Déclencheur : un test sur téléphone où la recherche a été jugée non
> fonctionnelle, **après** que la tranche 28 eut annoncé « 7 / 7 ».

| # | Symptôme rapporté | Cause mesurée |
|---|---|---|
| 124 | Les résultats ne sont toujours pas pertinents | L'archive de 24 h resservait la page 1 **non classée** |
| 125 | Les vrais résultats n'apparaissent **qu'en défilant** | Même cause : page 1 en conserve, pages suivantes fraîches donc classées |
| 126 | La couverture est parfois **complètement fausse**, la description ne correspond pas au titre | La clé de fusion **coupait le titre au « : »** |
| 127 | Le titre ne précise pas le tome | Le lecteur de tomes ratait **100 %** du format BnF |

#### La leçon de méthode, avant tout le reste

**La tranche 28 avait annoncé 7 / 7 pendant que l'application était
inutilisable.** Son banc d'essai ne mesurait qu'une chose : la place du livre
cherché. Ni la couverture, ni le résumé, ni le tome. **Trois des quatre
reproches lui étaient structurellement invisibles**, et il donnait donc le
droit de se déclarer satisfait.

> Un instrument qui ne mesure pas ce dont on se plaint est **pire** que pas
> d'instrument.

Le banc a donc été refait **en premier**, et il vérifie désormais LA CARTE :
d'où vient la couverture affichée, d'où vient le résumé, si un champ a été
emprunté à une fiche portant un **autre titre**, le tome lu, les cartes sans
image. Il a aussitôt attrapé les deux défauts rapportés.

#### Le cache ne fige plus le classement

L'intention était écrite pour la fusion — « l'archive garde les résultats tels
que la source les a rendus » — mais la notoriété la violait : elle était
attachée **avant** l'archivage. Une recherche déjà faite ressortait donc avec le
classement de la version précédente, une journée entière.

L'archive ne contient plus que du **brut**. Classement et fusion se recalculent
à chaque affichage : une correction se voit immédiatement, y compris sur les
recherches déjà archivées.

Un bouton **« vider le cache de recherche »** est ajouté dans Réglages. Il ne
touche ni la bibliothèque ni l'historique — c'est toute sa raison d'être :
vider les données de l'application depuis Android aurait emporté les livres.

**Défaut introduit puis corrigé dans la même journée** : pour ne pas redemander
la notoriété à chaque affichage, les **échecs** d'Open Library avaient été
archivés une heure. Vérifié aussitôt dans l'application, « harry potter »
rendait trois essais devant Rowling parce qu'**un seul appel lent** avait été
enregistré comme « rien à dire » — alors que la source répondait en 535 ms juste
après. **Un échec n'est pas une donnée** : il vit maintenant deux minutes en
mémoire et meurt avec la session.

#### La clé de fusion — la décision structurante

La clé coupait le titre au « : », jetant le morceau qui distingue les livres, et
gardait le sous-titre, où se trouve le bruit d'édition. **Elle faisait l'inverse
de ce qu'il fallait.**

Mesure comparative sur **212 volumes réels** :

```
cle              fusions fausses   cartes rendues
ACTUELLE                       3   reference
TITRE ENTIER                   0   +1 a +2 seulement
ISBN SEUL                      0   +23 sur « germinal » (15 -> 38)
```

**Il n'y avait aucun arbitrage à faire entre « mentir » et « dupliquer ».** Et
l'ISBN seul, envisagé d'abord et présenté comme une vertu, était la **mauvaise**
piste.

Règle retenue — deux raisons de fusionner, **cumulatives et transitives** :

- **le même ISBN** : une preuve, qui vaut même si les titres diffèrent ;
- **ou le même titre entier + auteur + tome**.

A et B par l'ISBN, B et C par le titre → les trois ensemble. D'où un petit
« qui appartient à qui » plutôt qu'une simple clé : une seule clé ne saurait pas
exprimer deux raisons.

Le **sous-titre** n'entre plus dans la clé (les 24 fiches de Germinal ne
diffèrent que par lui). Le **numéro de tome** y entre (deux tomes réunis
effaçaient le tome de la carte). Le groupe étant fiable, **les fiches se
complètent de nouveau entre elles** — c'était l'intérêt de fusionner.

#### Le tome, lu à la manière de la BnF

La BnF n'écrit jamais « tome » : elle pose le numéro après un point ou une
virgule — `Le trône de fer. 1 : roman`, `Le Seigneur des anneaux. 4, Appendices
et index`. Le lecteur en ratait **cent pour cent** : 0 tome reconnu sur les
20 notices de chaque saga, alors que 17 y étaient écrits.

Ajouté : le chiffre après ponctuation, et le chiffre **romain** jusqu'à X. La
règle de prudence d'origine est conservée et renforcée — la ponctuation est
**exigée**, et le chiffre doit finir le titre ou introduire un sous-titre.

#### L'auteur, écrit autrement

Open Library écrit « J.R.R. Tolkien », Google « John Ronald Reuel Tolkien ». La
clé triait les mots du nom : elle rapprochait « Zola, Émile » de « Émile Zola »,
mais pas deux abréviations. Seconde clé ajoutée : **nom de famille + initiales**.
Les initiales sont gardées délibérément — sur le seul nom de famille, « Martin »
rapprocherait George R. R. Martin de n'importe quel Martin.

Elle sert au **classement seulement**. La fusion garde la clé stricte :
rapprocher deux fiches pour les fondre demande plus de certitude que leur
donner un bonus.

#### Deux missions annulées par la mesure

| Mission | Ce qu'on croyait | Ce que la mesure a montré |
|---|---|---|
| Supprimer le repli de couverture | 0 couverture récupérée sur 39 | En réélargissant **avant** de supprimer : **10 sur 35 (29 %)**. Le premier chiffre n'était pas faux, il était **partiel** — quatre sagas modernes qu'Open Library ne couvre pas. On ne touche à rien |
| Open Library choisit les œuvres | Cela écarterait les carnets et les making-of | **Une vraie édition de Tolkien serait effacée.** 88 % des cartes écartées sur « le seigneur des anneaux ». Le signal est assez bon pour classer, beaucoup trop faible pour filtrer |

**La leçon commune** : une mesure sur un seul type de requête ne se généralise
pas, et un signal ne se transpose pas d'un usage à l'autre.

#### La limite assumée

**Harry Potter ne porte aucun numéro de tome, nulle part** — 0 détecté sur
40 fiches Google et 20 notices BnF. *À l'École des sorciers*, *la Chambre des
secrets* : l'information n'existe pas dans les titres français. Open Library
l'ordonnerait par année de première parution, mais cette année appartient à
l'**œuvre**, alors que nos cartes portent celle de leur **édition**.

**Pour une saga sans numéro dans ses titres, l'ordre n'est pas garanti.** Écrit
ici pour ne pas être redécouvert comme un bug.

#### Résultat

```
  recherche                    cartes  defauts  sans image  place du livre
  « harry potter »                 35        0            4         1
  « le seigneur des anneaux »      29        0           14         1
  « le trone de fer »              37        0            1         1
  « la quete d'ewilan »            16        0            6         1
  « la passe-miroir »              15        0            7         1
  « game of thrones »              34        0           13         1
  « germinal »                     16        0            2         1
  « les fourmis »                  33        0           11         1
```

**Aucun défaut de carte. Le livre cherché en 1ʳᵉ place sur les huit
recherches.** **290 vérifications** (283 → 290, familles 12 « fusion » et
compléments).

---

## 13. Comment lire ce document

Il a été écrit avant la première ligne de code, puis corrigé **120 fois** au fil
de l'exécution. Les corrections ne sont pas des repentirs : ce sont des
décisions que seule la confrontation au réel pouvait trancher.

- Les sections **§1 à §9** sont le contexte d'origine, amendé sur place. Ce
  qu'on y lit est vrai aujourd'hui.
- Le **§10** journalise les arbitrages 1 à 60, avec pour chacun le point, la
  décision et la section touchée.
- Le **§11** dit ce qui reste à faire, et par qui.
- Le **§12** documente les corrections d'usage et les **tranches 8 à 29**,
  celles nées de l'utilisation réelle de l'application et non des tests. Les
  deux dernières y ont été remontées depuis leurs plans de mission, supprimés
  une fois leur contenu ici.

**Les quatre corrections qui ont le plus changé le projet**, si l'on ne devait
en retenir que quatre :

1. **L'ISBN n'identifie que 35 % des livres français** chez Open Library. Les
   trois chemins de §3.2 sont devenus une cascade : 89 % de résolution.
2. **L'empreinte locale devait être aléatoire au détachement**, sinon
   « Détacher une édition » reproduisait la clé quittée et ne faisait
   silencieusement rien.
3. **L'ajout d'un livre ne doit pas attendre l'identification** : 4 ms
   d'écriture contre 12 s d'attente réseau. L'identité se promeut après coup.
4. **Google Books rend un `503` une requête sur deux.** Le « aucun retry »
   hérité du projet séries ne tenait pas contre cette source.
