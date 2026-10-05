/*
 * books.js — SEUL endroit qui sait qu'il existe deux sources (§2, règle 4).
 * Orchestre : Google découvre, Open Library identifie. store.js et l'UI
 * ignorent d'où vient une donnée ; store.js n'importe jamais ce fichier.
 * Domicile unique du calcul d'empreinte (§3.2) : le projet séries a laissé son
 * équivalent se redéfinir dans quatre fichiers, et deux normalisations
 * différentes de la même clé font tomber la déduplication sans bruit.
 */

import * as google from './sources/google.js';
import * as ol from './sources/openlibrary.js';
import * as bnf from './sources/bnf.js';
/*
 * `tomes.js` est un module PUR — aucun reseau, aucune base, aucune dependance.
 * L'importer ici ne cree donc pas de cycle et ne fait pas entrer une source
 * dans un fichier de presentation : c'est l'inverse, on emprunte un calcul.
 * Il sert a designer, dans un groupe de doublons, la fiche qui fera la carte.
 */
import { numeroDeTome, scorePertinence, filtrerHorsSujet, niveauxDeRecherche } from './tomes.js';

/** @typedef {import('./types.js').ResultatRecherche} ResultatRecherche */
/** @typedef {import('./types.js').Identite} Identite */

const CACHE_TTL_MS = 30 * 60 * 1000;
const cacheRecherche = new Map();

/*
 * Cache d'identité, même durée. Sans lui, ouvrir une fiche puis toucher
 * « Suivre » lance DEUX fois la même résolution Open Library — c'est-à-dire
 * l'appel le plus lent du projet (jusqu'à 9 s sur téléphone en 5G), payé deux
 * fois pour rien. Le cache est ici plutôt qu'un paramètre ajouté à la façade :
 * les signatures de §2.1 ne se modifient pas.
 *
 * Il mémorise aussi les ÉCHECS, avec le budget sous lequel ils sont survenus.
 * Corrigé en tranche 9 : la version précédente ne gardait que les réussites,
 * donc un livre qu'Open Library ne connaît pas — c'est-à-dire 65 % des ISBN
 * français (§3.2) — était réinterrogé INTÉGRALEMENT à chaque ouverture de
 * fiche et à chaque ajout. Les livres les plus lents étaient exactement ceux
 * qu'on repayait le plus souvent.
 * Le budget mémorisé est ce qui permet de garder la reprise en tâche de fond :
 * un échec à 4 s ne dit rien d'un essai à 15 s, donc un budget PLUS GRAND
 * retente ; un budget égal ou plus petit se contente du cache.
 */
const cacheIdentite = new Map();

/*
 * Cache des fiches d'oeuvre — le resume de complement (§4.3). Mesure de la
 * tranche 9 : sans lui, l'identification etait bien mise en cache mais le
 * resume, lui, etait redemande a CHAQUE ouverture de fiche. Rouvrir cinq
 * livres deja vus coutait encore 1,3 s d'appels reseau pour un texte qu'on
 * avait deja. Les `null` sont memorises aussi : une oeuvre sans description
 * n'en aura pas davantage a la lecture suivante.
 */
const cacheOeuvre = new Map();

/*
 * Budget de l'identification INTERACTIVE — celle qui fait attendre devant la
 * fiche. Mesure du 2026-08-20 : Open Library repond entre 1,3 s et 7,7 s selon
 * l'heure, et /isbn/ coute DEUX allers-retours a cause d'une redirection ; le
 * delai general de 12 s se traduisait par 12 secondes d'attente reelle.
 * 4 s suffisent quand la source va bien, et l'echec n'est pas une perte : le
 * livre entre en empreinte locale et l'identite est reprise en tache de fond.
 */
const BUDGET_INTERACTIF_MS = 4000;

/*
 * Budget du RESUME de complement. Il n'en avait aucun : `completer()` appelait
 * Open Library sans rien passer, donc retombait sur le plafond de 12 s — et
 * 12 s de plus si l'oeuvre avait ete fusionnee, soit 24 s pour un champ de
 * confort. C'est le plus long appel du parcours, et le moins essentiel :
 * §4.3 dit qu'un resume anglais vaut mieux qu'un vide, pas qu'il vaut une
 * demi-minute d'attente. 4 s, comme l'identification, et la fiche reste
 * lisible sans lui.
 */
const BUDGET_RESUME_MS = 4000;

/*
 * Empreinte locale — le FILET de §3.2, pas le mécanisme principal.
 * Elle n'utilise que le PREMIER auteur, décision corrigée après appels réels :
 * la variante « tous les auteurs triés » se brise sur Open Library, qui rend
 * les translittérations dans la même liste (author_name pour Dune contient
 * « Frank Herbert » ET « Френк Герберт »). Le premier élément, lui, concorde
 * entre les deux sources sur tous les cas observés.
 */
export function empreinteOeuvre(titre, auteurs) {
  const premier = Array.isArray(auteurs) ? auteurs[0] : auteurs;
  return `fp:${normaliser(titre, true)}|${normaliser(premier, false)}`;
}

function normaliser(texte, couperSousTitre) {
  if (!texte) return '';
  let t = String(texte);
  if (couperSousTitre) t = t.split(':')[0];
  return t
    .toLowerCase()
    .normalize('NFD')
    // ̀-ͯ = les accents isolés par NFD. Écrits en échappement et non
    // en caractères bruts : ce sont des signes combinants invisibles, qu'un
    // éditeur ou une copie peut avaler sans que rien ne le signale.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')       // ponctuation et espaces
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// FUSIONNER LES DOUBLONS DE RECHERCHE (retour d'usage 122, tranche 2)
// ---------------------------------------------------------------------------

/*
 * « Je trouve un livre plutot connu qui apparait sans editeur et sans
 * couverture, alors que le tome 1 est complet juste a cote. »
 *
 * Diagnostic : le meme livre revient plusieurs fois chez Google sous des
 * fiches de qualite tres inegale — l'une porte l'editeur, l'autre la
 * couverture, une troisieme n'a ni l'un ni l'autre. Rien ne les rapprochait.
 * `suggestions()` regroupait deja par empreinte ; la recherche, non. La fiche
 * pauvre s'affichait donc a la place de la bonne, qui etait dans la MEME
 * liste, quinze lignes plus bas.
 *
 * On regroupe par empreinte d'oeuvre — la meme que partout ailleurs (§3.2), et
 * c'est bien pour cela qu'elle n'a qu'un seul domicile. Le groupe rend UNE
 * carte : la fiche la mieux classee, COMPLETEE par ce que les autres savent.
 *
 * Deux limites assumees, et connues :
 *  - deux editions reellement differentes du meme texte n'en font plus qu'une
 *    en recherche. C'est voulu : le choix d'edition a son ecran (§3.1), la
 *    recherche sert a trouver l'OEUVRE ;
 *  - une fiche sans auteur ne rejoint pas la fiche du meme titre qui en a un,
 *    puisque l'auteur entre dans l'empreinte. Regrouper sur le seul titre
 *    ferait fusionner « Les fourmis » de Werber avec neuf documentaires
 *    jeunesse homonymes : on prefere une carte de trop a un livre efface.
 */

/*
 * CLE DE REGROUPEMENT DE RECHERCHE — a ne pas confondre avec l'empreinte
 * d'oeuvre (correction 3).
 *
 * `empreinteOeuvre` est l'IDENTITE d'une oeuvre en base (§3.2) : elle est
 * ecrite dans les tables, elle sert de cle etrangere, et la changer
 * demanderait une migration. On n'y touche pas.
 *
 * Ce dont la recherche a besoin est plus lache : rapprocher deux FICHES qui
 * decrivent le meme livre, le temps d'un affichage. Mesure du 2026-08-27 sur
 * « germinal », trois pages : le meme roman se presentait sous « emile zola »
 * (28 fiches), « Zola, Emile » (3 fiches) et « Эмиль Золя ». L'empreinte les
 * separe — a juste titre pour la base, a tort pour l'ecran, qui affichait
 * trois cartes du meme livre.
 *
 * On trie donc les mots du nom : « emile zola » et « zola emile » donnent la
 * meme cle. Une translitteration (« Эмиль Золя ») reste a part : elle ne
 * partage aucune lettre, et rien ne permet de la rattacher sans risque.
 *
 * -------------------------------------------------------------------------
 * CORRIGE LE 2026-08-30 — LE TITRE N'EST PLUS COUPE AU « : ».
 *
 * C'etait LA cause des couvertures fausses. La cle appelait
 * `normaliser(titre, true)`, qui tronque au deux-points ; elle jetait donc
 * exactement le morceau qui distingue deux livres, et gardait le sous-titre,
 * ou se trouve le bruit. Elle faisait l'inverse de ce qu'il fallait.
 *
 * Deux fusions reellement fausses, relevees a l'ecran :
 *   « Le Seigneur des Anneaux : La communaute de l'anneau. Les coulisses du
 *     film »  reuni avec  « Le Seigneur des anneaux »
 *   « ... : la communaute de l'anneau »  reuni avec  « ... : les deux tours »
 * La carte affichait alors le titre de l'un, la couverture de l'autre et le
 * resume d'un troisieme.
 *
 * Mesure comparative sur 212 volumes reels, trois cles :
 *
 *   cle              fusions fausses   cartes rendues
 *   ACTUELLE                       3   reference
 *   TITRE ENTIER                   0   +1 a +2 seulement
 *   ISBN SEUL                      0   +23 sur « germinal » (15 -> 38)
 *
 * Conclusions, toutes contre-intuitives :
 *  - le TITRE ENTIER ne coute presque aucune carte et supprime TOUTES les
 *    fusions fausses. Il n'y a donc aucun arbitrage a faire entre « mentir »
 *    et « dupliquer » : on peut avoir les deux ;
 *  - l'ISBN SEUL, envisage d'abord, est une MAUVAISE cle : il fait exploser
 *    « germinal » en 38 cartes. Il reste utilise, mais comme PREUVE qui
 *    ajoute des fusions (voir `fusionnerDoublons`), jamais comme separateur ;
 *  - le SOUS-TITRE ne doit pas entrer dans la cle : les 24 fiches de Germinal
 *    ne different que par lui (« roman », « Large Print »,
 *    « Les Rougon-Macquart »). C'est du bruit d'edition, pas de l'identite.
 *
 * Le NUMERO DE TOME entre en revanche dans la cle : deux tomes d'une meme
 * serie portent parfois le meme titre reduit, et les reunir efface le tome
 * sur la carte — le defaut « le titre ne precise pas le tome ».
 *
 * Rend `null` quand il manque le titre ou l'auteur : la fiche reste alors
 * seule plutot que d'aspirer les autres.
 */
/*
 * MOTS DE FORMAT ET D'EDITION — retour d'usage : « les editions d'un meme
 * livre ne sont pas regroupees, alors qu'on voudrait une seule carte par
 * livre et choisir l'edition dans la fiche ».
 *
 * Ces mots distinguent deux EXEMPLAIRES du meme texte, pas deux textes. Le
 * regroupement les ignore, pour qu'une « Edition de luxe » et une edition
 * poche du MEME tome ne fassent plus qu'une carte. Le NUMERO de tome, lui,
 * reste dans la cle (composante `t` plus bas) : un tome 1 ne fusionne jamais
 * avec un tome 3, meme depouilles de leurs mentions d'edition.
 *
 * Verifie en vrai le 2026-09-07 : sur « game of thrones », les cinq editions
 * de l'integrale (« Tome 1 . Edition de luxe », « Tome 3 . Edition illustree »…)
 * restaient cinq cartes distinctes du meme tome faute de ce depouillement.
 */
const MOTS_EDITION = new Set([
  'luxe', 'deluxe', 'illustree', 'illustre',
  'edition', 'editions', 'poche', 'broche', 'brochee', 'relie', 'reliee',
  'collector', 'grand', 'format', 'nouvelle', 'revue', 'augmentee',
  'definitive', 'anniversaire', 'tome', 'tomes', 'volume', 'vol',
  // Etape 4 (2026-10-04), vus sur « germinal » et « le grand meaulnes » :
  'large', 'print', 'annotee', 'annote', 'abregee', 'abrege', 'scolaire',
  'bilingue', 'enrichie',
  // Etape 10 (R3), vus sur « germinal » : une faute de frappe courante d'« illustree ».
  'illustrer', 'illustres', 'illustrees',
]);

/*
 * ETAPE 10 (R2) — un GENRE ecrit apres le deux-points n'est pas une partie du
 * titre : « L'elegance du herisson : roman » est « L'elegance du herisson ». Seul
 * le segment FINAL, et seulement s'il ne contient que ces mots.
 */
const MOTS_DE_GENRE = new Set([
  'roman', 'romans', 'nouvelle', 'nouvelles', 'recit', 'recits', 'essai', 'essais',
  'poeme', 'poemes', 'theatre', 'piece', 'conte', 'contes', 'fable', 'fables',
  'biographie', 'autobiographie', 'document', 'chronique', 'chroniques', 'et', 'de', 'la', 'le', 'un', 'une',
]);

function sansGenreFinal(titre) {
  const brut = String(titre || '');
  const i = brut.lastIndexOf(':');
  if (i < 0) return brut;
  const segment = normaliser(brut.slice(i + 1), false).split('-').filter(Boolean);
  const genreSeul = segment.length > 0 && segment.every((m) => MOTS_DE_GENRE.has(m))
    && segment.some((m) => !['et', 'de', 'la', 'le', 'un', 'une'].includes(m));
  return genreSeul ? brut.slice(0, i) : brut;
}

/*
 * TRANCHE 31 — « coffret » et « integrale » NE SONT PAS des mentions de format.
 * Mesure du banc du 2026-09-19 : 14 cartes fautives, dont « Harry Potter » +
 * « Harry Potter Coffret » (couverture du coffret sur le livre seul) et
 * « Les fourmis » + « Les Fourmis - Integrale » (couverture ET resume de
 * l'integrale sur le premier roman).
 *
 *  - un COFFRET reunit plusieurs livres : jamais « le » livre. Le mot reste
 *    donc dans la cle, et le coffret garde sa carte ;
 *  - une INTEGRALE sans numero reunit plusieurs romans : meme regle. Avec un
 *    NUMERO (« Le Trone de fer l'Integrale Tome 1 ») c'est un tome numerote, et
 *    sa fusion avec le tome 1 est ce qui a ete demande (tranche 30) : le mot
 *    part alors, le numero reste.
 * Principe herite de la tranche 29 : mieux vaut une carte en double qu'une
 * fusion fausse.
 */
const MOTS_INTEGRALE = new Set(['integrale', 'integrales']);

/*
 * Le titre reduit a l'OEUVRE, pour RAPPROCHER deux editions — jamais affiche.
 * C'est ce qui autorise un nettoyage franc, impensable sur un titre montre a
 * l'ecran :
 *  - les PARENTHESES partent (rappel de VO « (A game of Thrones) », mention
 *    d'annee, de collection) ;
 *  - les mentions d'EDITION partent (voir MOTS_EDITION) ;
 *  - les ANNEES a quatre chiffres partent (« Guide 2024 ») ; les AUTRES NOMBRES
 *    RESTENT (tranche 31) : les retirer faisait fusionner « L'integrale 1 » et
 *    « L'integrale - 3 » quand le tome n'etait pas lu. « Tome 01 » et « Tome 1 »
 *    donnent le meme nombre ;
 *  - les PETITS MOTS (2 lettres ou moins) partent : articles, prepositions et
 *    residus d'elision (« l'Integrale » -> « l », « de luxe » -> « de »)
 *    faisaient echouer le rapprochement sur les vrais titres mesures le
 *    2026-09-07. Les retirer de PARTOUT, de facon identique, garde la cle
 *    coherente sans rien confondre — l'auteur et le tome departagent le reste.
 *    Les nombres, eux, ne sont jamais des « petits mots » : « 1 » est garde ;
 *  - « integrale » part SEULEMENT si un nombre reste dans le titre (voir
 *    MOTS_INTEGRALE) ; « coffret » ne part jamais.
 * Ne rend JAMAIS une chaine vide (« 1984 », « Ca ») : on retombe alors sur le
 * titre entier normalise, quitte a moins regrouper, plutot que de tout fondre.
 */
const ESTNOMBRE = /^\d+$/;
const ESTANNEE = /^\d{4}$/;

/** Les mots de l'oeuvre, sous forme d'ensemble — voir `memeLivre`. */
function motsDeLOeuvre(titre) {
  // Une parenthese jamais refermee est un titre COUPE par la source (« … (Par>
  // Louis-Ferdinand Celine (Pseud ») : ce qui suit n'est pas le titre.
  const sansParentheses = sansGenreFinal(titre).replace(/\([^)]*\)/g, ' ').replace(/\([^)]*$/, ' ');
  const brutes = normaliser(sansParentheses, false).split('-').filter(Boolean);
  // Etape 10 (R3) : « texte integral » est une mention d'edition (le texte entier
  // d'UN livre), a ne pas confondre avec une « integrale » qui en reunit plusieurs.
  const sansTexteIntegral = brutes.filter((m, i) => !((m === 'texte' && brutes[i + 1] === 'integral')
    || (m === 'integral' && brutes[i - 1] === 'texte')));
  const mots = sansTexteIntegral
    .filter((mot) => !ESTANNEE.test(mot))
    .map((mot) => (ESTNOMBRE.test(mot) ? String(Number(mot)) : mot));
  const numerote = mots.some((mot) => ESTNOMBRE.test(mot));
  const filtre = mots
    .filter((mot) => ESTNOMBRE.test(mot)
      || (mot.length > 2 && !MOTS_EDITION.has(mot) && !(numerote && MOTS_INTEGRALE.has(mot))));
  return new Set(filtre.length ? filtre : [normaliser(titre, false)].filter(Boolean));
}

/*
 * UNE SEULE DEFINITION DE « MEME LIVRE » POUR LA RECHERCHE (mission « recherche
 * satisfaisante », etape 4, decision 6).
 *
 * Elle remplace `cleRegroupement`, qui exigeait le MEME titre reduit et le meme
 * nom d'auteur ecrit pareil. Mesure du 2026-10-04 : le tome 3 du Seigneur des
 * anneaux sortait en 4 cartes (« Le seigneur des anneaux » + sous-titre « Le
 * retour du roi. Tome 3 », « … T3 Le retour du roi », « … (Tome 3) - Le Retour
 * du Roi »), Germinal en 3 (« Large Print », « Annotee »), Le Grand Meaulnes
 * sous deux ecritures d'Alain-Fournier.
 *
 * Deux fiches sont le meme livre si, au choix :
 *   1. elles portent le meme ISBN — la preuve (voir `fusionnerDoublons`) ;
 *   2. elles ont le meme AUTEUR (lecture tolerante de `memeAuteur`), le meme
 *      NUMERO DE TOME, et des titres compatibles :
 *        - sans tome : les memes mots, une fois retirees les mentions d'edition ;
 *        - avec un tome : les mots de l'un sont inclus dans ceux de l'autre.
 *
 * Ce que cette regle NE fait PAS, volontairement : rapprocher une fiche AVEC
 * tome d'une fiche SANS tome (« La Passe-miroir (Livre 3) - La Memoire de Babel »
 * et « La memoire de Babel »), ni deux titres francais differents pour un meme
 * tome. Sans autre preuve, cela collerait « Harry Potter » (la saga) sur un de ses
 * tomes. C'est l'affaire de l'etape 5, avec la confirmation d'Open Library.
 * Mieux vaut une carte en double qu'une fusion fausse (tranche 29).
 */
function identiteDeLivre(r) {
  const nom = Array.isArray(r.auteurs) ? r.auteurs[0] : r.auteurs;
  const auteur = nom ? profilAuteur(nom) : null;
  if (!r.titre || !auteur) return null;
  return {
    auteur,
    mots: motsDeLaFiche(r),
    tome: numeroDeTome(`${r.titre || ''} ${r.sousTitre || ''}`),
  };
}

/*
 * ETAPE 10 — LES MOTS D'UNE FICHE : ceux de son titre, avec deux corrections.
 *
 *  R1. Le NOM DE L'AUTEUR ecrit dans le titre n'en fait pas partie :
 *      « Le Grand Meaulnes Alain-Fournier illustree », « A Game of Thrones,
 *      George R R Martin ». Seuls les noms des auteurs de CETTE fiche partent, et
 *      jamais au point de vider le titre (« Stephen King » reste « Stephen King »).
 *  R5. Une mention « l'integrale » en SOUS-TITRE rejoint le titre : « La quete
 *      d'Ewilan » + [l'integrale] est « L'integrale La Quete d'Ewilan ». Seulement
 *      si le sous-titre ne dit que cela, et si le titre ne porte pas de numero (une
 *      integrale numerotee est un tome, tranche 31).
 */
function motsDeLaFiche(r) {
  const mots = motsDeLOeuvre(r.titre);

  const nomsAuteurs = new Set((Array.isArray(r.auteurs) ? r.auteurs : [r.auteurs]).slice(0, 4)
    .flatMap((nom) => normaliser(String(nom || '').replace(/\([^)]*\)/g, ' '), false).split('-'))
    .filter((m) => m.length > 2 && !ESTNOMBRE.test(m)));
  /*
   * GARDE-FOU, trouve en rejouant la mesure : « Voyage au bout de la nuit DE
   * Louis-Ferdinand Celine (fiche de lecture) » serait devenu le roman. Un nom
   * d'auteur precede de « de », « du » ou « d' » designe un livre SUR l'oeuvre
   * (fiche de lecture, analyse, etude) : alors les noms restent dans le titre.
   */
  const jetons = normaliser(r.titre, false).split('-');
  const livreSurLAuteur = jetons.some((j, i) => i > 0 && nomsAuteurs.has(j) && ['de', 'du', 'des', 'd'].includes(jetons[i - 1]));
  const sansAuteur = livreSurLAuteur ? [...mots] : [...mots].filter((m) => !nomsAuteurs.has(m));
  const resultat = new Set(sansAuteur.length > 0 ? sansAuteur : mots);

  const sous = normaliser(r.sousTitre || '', false).split('-')
    .filter((m) => m.length > 2 && !MOTS_EDITION.has(m));
  const titreNumerote = [...resultat].some((m) => ESTNOMBRE.test(m));
  if (sous.length === 1 && MOTS_INTEGRALE.has(sous[0]) && !titreNumerote) resultat.add('integrale');
  return resultat;
}

/*
 * ETAPE 5 — DEUX FICHES QU'OPEN LIBRARY RATTACHE A LA MEME OEUVRE sont le meme
 * livre, meme ecrit dans deux langues. Mesure du 2026-10-04 : « Philosopher's
 * Stone » (anglais) et « A l'ecole des sorciers » (francais) pointent la meme
 * oeuvre ; Open Library connait aussi des oeuvres en DOUBLE et colle volontiers
 * un coffret sur le 1er tome — d'ou trois garde-fous, car mieux vaut une carte
 * en double qu'une fusion fausse :
 *   - le meme auteur (lecture tolerante) ;
 *   - aucun conflit de numero de tome (le tome 2 n'est jamais le tome 3) ;
 *   - jamais un coffret, une integrale ou un « box set » : ils reunissent
 *     plusieurs livres, quelle que soit l'oeuvre que leur prete Open Library.
 */
const MOTIF_PLUSIEURS_LIVRES = /\b(coffret|box|boxed|boxset|set|integrale|integral|collection|complete|completes|series|serie|oeuvres|omnibus|volumes|tomes)\b/;

function reunitPlusieursLivres(r) {
  const texte = normaliser(`${r.titre || ''} ${r.sousTitre || ''}`, false).replace(/-/g, ' ');
  return MOTIF_PLUSIEURS_LIVRES.test(texte);
}

function memeOeuvreOL(a, b) {
  if (!a.oeuvreOL || a.oeuvreOL !== b.oeuvreOL) return false;
  if (reunitPlusieursLivres(a) || reunitPlusieursLivres(b)) return false;
  const ia = identiteDeLivre(a);
  const ib = identiteDeLivre(b);
  if (!ia || !ib || !memeAuteur(ia.auteur, ib.auteur)) return false;
  if (ia.tome !== null && ib.tome !== null && ia.tome !== ib.tome) return false;
  return true;
}

function estInclus(petit, grand) {
  return [...petit].every((mot) => grand.has(mot));
}

/*
 * ETAPE 10 (R4) — INCLUSION TOLERANTE A UNE FAUTE DE FRAPPE, pour deux fiches
 * deja reconnues du MEME auteur et du MEME numero de tome : un mot d'au moins
 * cinq lettres qui COMMENCE un autre mot compte comme present (« forter » dans
 * « forteresse »). Jamais sans numero de tome : ce serait fusionner a l'aveugle.
 */
function estInclusTolerant(petit, grand) {
  return [...petit].every((mot) => grand.has(mot)
    || (mot.length >= 5 && [...grand].some((g) => g.length >= 5 && (g.startsWith(mot) || mot.startsWith(g)))));
}

function memeLivre(a, b) {
  if (!a || !b) return false;
  if (!memeAuteur(a.auteur, b.auteur)) return false;
  if (a.tome !== b.tome) return false;
  if (a.tome === null) return a.mots.size === b.mots.size && estInclus(a.mots, b.mots);
  // Avec un tome : l'inclusion, mais jamais sur un titre reduit a des chiffres.
  const [petit, grand] = a.mots.size <= b.mots.size ? [a.mots, b.mots] : [b.mots, a.mots];
  return [...petit].some((mot) => !ESTNOMBRE.test(mot)) && estInclusTolerant(petit, grand);
}

/*
 * UN ISBN, reduit a ce qui le rend comparable : chiffres et X final. Les
 * sources l'ecrivent avec ou sans tirets.
 * Note : la forme a 10 chiffres et la forme a 13 du MEME livre restent
 * differentes ici. C'est une fusion manquee, jamais une fusion fausse — et la
 * cle de titre la rattrape presque toujours.
 */
function cleIsbn(valeur) {
  const brut = String(valeur || '').replace(/[^0-9Xx]/g, '').toUpperCase();
  return brut.length >= 10 ? brut : null;
}

/*
 * UN NOM D'AUTEUR, reduit a ce qui ne change pas d'une source a l'autre.
 * Les mots sont TRIES : « emile zola » et « Zola, Emile » donnent la meme cle.
 * Extrait de `cleRegroupement` pour etre reutilise par la notoriete (M3), qui
 * doit reconnaitre le meme ecrivain entre Google et Open Library.
 */
function cleAuteur(nom) {
  return normaliser(nom, false).split('-').filter(Boolean).sort().join('-');
}

/*
 * LE MEME ECRIVAIN, ECRIT AUTREMENT — nom de famille et initiales.
 *
 * `cleAuteur` trie les mots : elle rapproche « Emile Zola » de « Zola,
 * Emile », ce qui suffisait tant qu'on comparait deux fiches de Google. Elle
 * ne suffit plus depuis qu'on rapproche Google et Open Library, qui abregent
 * differemment. Mesure du 2026-08-30 sur « le seigneur des anneaux » : Open
 * Library ecrit « J.R.R. Tolkien », Google « John Ronald Reuel Tolkien », et
 * la moitie des editions de Tolkien ne recevaient AUCUNE notoriete.
 *
 * On fabrique donc une seconde cle : le nom de famille, plus les initiales
 * des prenoms.
 *   « J.R.R. Tolkien »              -> tolkien|jrr
 *   « John Ronald Reuel Tolkien »   -> tolkien|jrr
 *   « Zola, Emile » et « Emile Zola » -> zola|e
 *
 * Les INITIALES sont gardees, et c'est deliberé : sur le seul nom de famille,
 * « Martin » rapprocherait George R. R. Martin de n'importe quel Martin — et
 * la notoriete de « game of thrones » atterrirait sur un homonyme.
 *
 * La virgule decide du nom de famille quand elle est la (« Zola, Emile ») ;
 * sinon c'est le dernier mot. Un nom d'un seul mot n'a pas d'initiales et se
 * compare tel quel.
 */
/*
 * TRANCHE 32 — des initiales COMPATIBLES, et non plus identiques.
 *
 * Mesure du 2026-09-19 : le filtre du hors-sujet ecartait trois vraies
 * editions, toutes pour la meme cause — l'auteur ecrit autrement :
 *   « JRR Tolkien »       lu « tolkien|j »   contre « J.R.R. » -> « tolkien|jrr »
 *   « George Martin »     lu « martin|g »    contre « George R. R. » -> « martin|grr »
 *   « Emile Emile Zola »  lu « zola|ee »     contre « Emile Zola » -> « zola|e »
 * L'egalite stricte des initiales les separait.
 *
 * Regle : meme nom de famille, ET l'une des deux series d'initiales COMMENCE PAR
 * l'autre (« g » avec « grr », « jr » avec « jrr »). Un prenom different reste
 * different (« jean » n'est pas « george », « jk » n'est pas « jrr »). Et une
 * serie VIDE ne rapproche rien : « Martin » seul reste ecarte, sinon on
 * retrouverait l'homonyme que les initiales sont la pour eviter.
 *
 * Un mot repete de suite (« Emile Emile Zola ») compte pour un seul.
 *
 * Cette regle ne sert qu'a la notoriete et au filtre : la cle de FUSION des
 * fiches (cleAuteur, plus haut) est inchangee, elle exige plus de certitude.
 */
function profilAuteur(nom) {
  /*
   * ETAPE 2 (mission « recherche satisfaisante ») — le ROLE entre parentheses ne
   * fait pas partie du nom : « Christelle Dabos (autrice) » est Christelle Dabos.
   * Mesure du 2026-10-04 : c'est ce qui faisait ecarter l'adaptation en BD de
   * La Passe-miroir. Seule cette fonction nettoie : la cle de FUSION (cleAuteur)
   * garde son exigence.
   */
  const brut = String(nom || '').replace(/\([^)]*\)/g, ' ').trim();
  const complet = cleAuteur(brut);
  const avantVirgule = brut.includes(',') ? brut.split(',')[0] : null;
  const mots = normaliser(brut, false).split('-').filter(Boolean)
    .filter((m, i, tous) => i === 0 || m !== tous[i - 1]);
  if (mots.length === 0) return null;

  const familleVirgule = avantVirgule
    ? normaliser(avantVirgule, false).split('-').filter(Boolean)
    : null;
  const famille = familleVirgule ? familleVirgule.join('') : mots[mots.length - 1];
  if (!famille) return null;

  const autres = familleVirgule
    ? mots.filter((m) => !famille.startsWith(m) || m.length > 2)
      .filter((m) => !familleVirgule.includes(m))
    : mots.slice(0, -1);
  return { complet, famille, initiales: autres.map((m) => m[0]).join('') };
}

function memeAuteur(a, b) {
  if (a.complet && a.complet === b.complet) return true;
  if (a.famille !== b.famille) return false;
  if (!a.initiales || !b.initiales) return !a.initiales && !b.initiales;
  return estSousSuite(a.initiales, b.initiales) || estSousSuite(b.initiales, a.initiales);
}

/*
 * ETAPE 2 — les initiales de l'une sont-elles une SOUS-SUITE de l'autre ?
 * « a » dans « ha » (Alain-Fournier / Henri Alain-Fournier), « a » dans « haa »
 * (Henri-Alban Alain-Fournier) : le prenom compose et le nom d'usage. Un simple
 * debut commun ne les rapprochait pas. Un prenom different reste different
 * (« jk » n'est pas une sous-suite de « jrr »).
 */
function estSousSuite(court, long) {
  if (court.length > long.length) return false;
  let i = 0;
  for (const c of long) if (c === court[i]) i += 1;
  return i === court.length;
}

/*
 * Ce qui se complete d'une fiche a l'autre. `titre`, `sousTitre` et
 * `cleSource` n'y sont PAS : ils font l'identite de la carte et viennent de la
 * fiche retenue, sans quoi on afficherait le titre de l'une et l'annee de
 * l'autre.
 */
const CHAMPS_A_COMPLETER = [
  'couvertureUrl', 'resume', 'langue', 'isbn13', 'isbn10',
  'nbPages', 'editeur', 'annee', 'datePublication',
];

function estVide(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return true;
  return Array.isArray(valeur) && valeur.length === 0;
}

/**
 * Regroupe les doublons d'une liste de resultats.
 *
 * @param {ResultatRecherche[]} resultats
 * @param {string} requete ce qui a ete tape — sert a choisir la fiche retenue
 * @returns {ResultatRecherche[]} un resultat par oeuvre, dans l'ordre d'arrivee
 *   de la premiere fiche du groupe. Chaque carte porte en plus `clesSource`,
 *   la liste des cles fusionnees : un livre deja suivi doit rester marque meme
 *   si c'est une AUTRE de ses fiches qui a ete retenue.
 */
export function fusionnerDoublons(resultats, requete = '') {
  const liste = resultats || [];

  /*
   * DEUX RAISONS DE FUSIONNER, ET ELLES SE CUMULENT :
   *   1. le meme ISBN — une PREUVE, qui vaut meme si les titres different ;
   *   2. le meme titre entier + auteur + tome.
   * Deux fiches liees par l'une OU l'autre finissent sur la meme carte, et la
   * relation est transitive : A et B par l'ISBN, B et C par le titre, donc
   * A, B et C ensemble. D'ou ce petit « qui appartient a qui » plutot qu'une
   * simple Map de cles — une seule cle ne saurait pas exprimer deux raisons.
   */
  const chef = new Map();
  liste.forEach((r) => chef.set(r.cleSource, r.cleSource));
  const racine = (x) => {
    let c = x;
    while (chef.get(c) !== c) { chef.set(c, chef.get(chef.get(c))); c = chef.get(c); }
    return c;
  };
  const unir = (a, b) => {
    const ra = racine(a);
    const rb = racine(b);
    if (ra !== rb) chef.set(rb, ra);
  };

  // 1. La preuve : le meme ISBN. Elle ne peut qu'AJOUTER des fusions.
  const parIsbn = new Map();
  liste.forEach((r) => {
    [r.isbn13, r.isbn10].map(cleIsbn).filter(Boolean).forEach((i) => {
      if (parIsbn.has(i)) unir(parIsbn.get(i), r.cleSource);
      else parIsbn.set(i, r.cleSource);
    });
  });

  // 2. L'auteur, le tome, des titres compatibles (voir `memeLivre`). Rangees
  //    par nom de famille : on ne compare que des fiches qui ont une chance.
  const parFamille = new Map();
  liste.forEach((r) => {
    const identite = identiteDeLivre(r);
    if (!identite) return;   // sans titre ou sans auteur : la fiche reste seule
    const famille = identite.auteur.famille;
    if (!parFamille.has(famille)) parFamille.set(famille, []);
    const deja = parFamille.get(famille);
    // Tous les freres, pas seulement le premier : la regle n'est pas transitive
    // (inclusion), et l'issue ne doit pas dependre de l'ordre d'arrivee.
    deja.filter((autre) => memeLivre(autre.identite, identite))
      .forEach((frere) => unir(frere.cleSource, r.cleSource));
    deja.push({ cleSource: r.cleSource, identite });
  });

  // 3. L'oeuvre d'Open Library, quand elle est connue (etape 5, decision 2) : la
  //    preuve qui relie une traduction a son original. Voir `memeOeuvreOL`.
  const parOeuvre = new Map();
  liste.forEach((r) => {
    if (!r.oeuvreOL) return;
    if (!parOeuvre.has(r.oeuvreOL)) parOeuvre.set(r.oeuvreOL, []);
    const deja = parOeuvre.get(r.oeuvreOL);
    deja.filter((autre) => memeOeuvreOL(autre, r)).forEach((frere) => unir(frere.cleSource, r.cleSource));
    deja.push(r);
  });

  const groupes = new Map();
  liste.forEach((r) => {
    const g = racine(r.cleSource);
    if (!groupes.has(g)) groupes.set(g, []);
    groupes.get(g).push(r);
  });

  return [...groupes.values()].map((groupe) => fondre(groupe, requete));
}

/**
 * FUSION + FILTRE, dans cet ordre : c'est ce que l'ECRAN doit montrer.
 *
 * `fusionnerDoublons` reste pur (il regroupe, il ne juge pas) ; ce wrapper y
 * ajoute le retrait de ce qui n'est pas l'oeuvre (mission « le bruit
 * d'abord », voir `filtrerHorsSujet` dans tomes.js). On l'appelle des deux
 * cotes — la recherche initiale et l'ajout des pages suivantes — pour qu'une
 * carte ecartee comme hors-sujet le reste quand les pages s'accumulent.
 *
 * Le filtre est fail-open : sans signal d'auteur (modes Auteur et ISBN, ou
 * Open Library muette), il rend la liste inchangee.
 *
 * @param {ResultatRecherche[]} resultats
 * @param {string} requete
 * @returns {ResultatRecherche[]}
 */
export function fusionnerDoublonsAffichage(resultats, requete = '') {
  return filtrerHorsSujet(fusionnerDoublons(resultats, requete), requete);
}

/*
 * TOME CONNU D'OPEN LIBRARY, QUAND LE TITRE N'ECRIT RIEN — tranche 33,
 * chantier 3. Retour d'usage : « Harry Potter, aucun tome ne s'affiche ».
 * Les titres francais de cette saga n'ecrivent jamais « tome N » : le texte
 * ne porte rien a lire (§4.4, tomes.js ne peut rien inventer).
 *
 * Open Library porte pourtant ce numero dans le champ `series` de ses
 * editions — la MEME donnee que §3.2/§4.4 lisent deja a l'ajout d'un livre
 * (`identiteParRecherche`). On la lit ici un cran plus tot, pour l'affichage
 * de la recherche, SEULEMENT pour les cartes que le texte a laissees muettes
 * — un titre qui ecrit son tome fait toujours foi sur lui-meme, on ne le
 * recouvre jamais.
 *
 * Sans quota strict chez Open Library (§4.2), mais chaque appel coute de la
 * latence : plafonne a un budget court par carte, et une carte dont Open
 * Library ne dit rien (panne, silence, pas de serie) reste SANS numero —
 * jamais un numero invente.
 */
const BUDGET_TOME_MS = 4000;
/*
 * Ne PAYER cet appel que pour une saga PRESSENTIE — au moins 3 cartes du meme
 * auteur sans numero de tome lisible dans leur titre. En dessous, ce n'est
 * jamais une saga muette (§4.6, meme seuil que separerLesTomes) : ce serait
 * un appel Open Library de plus sur CHAQUE livre simple de la recherche, pour
 * un gain nul l'immense majorite du temps.
 */
const SEUIL_SAGA_PRESSENTIE = 3;

/*
 * L'IDENTITE LA PLUS FIABLE POUR CETTE CARTE — tranche 33, chantier 3 ter.
 * Verifie en vrai sur Harry Potter (2026-09-27) : la recherche par TITRE
 * (`identiteParRecherche`) se trompe d'oeuvre — « Coupe de Feu », « Prisonnier
 * d'Azkaban » et « Chambre des Secrets » sont tous les trois resolus vers la
 * MEME oeuvre par la « meilleure correspondance » d'Open Library, ce qui rend
 * la deduction par date impossible (trois memes annees).
 *
 * L'ISBN, quand Google en fournit un, identifie l'EDITION EXACTE (§3.2, « le
 * chemin normal ») : aucune ambiguite possible. On l'utilise en priorite pour
 * trouver l'oeuvre, PUIS on relit sa premiere publication par la CLE de cette
 * oeuvre (`premierePublicationParOeuvre`) — jamais par une nouvelle recherche
 * texte, qui reintroduirait la meme confusion.
 * Sans ISBN, seul reste le repli par titre, moins sur mais mieux que rien.
 */
async function identiteFiablePourTome(carte, budget = null) {
  const isbn = carte.isbn13 || carte.isbn10;
  if (isbn) {
    // Memorisee (etape 5) : la recherche vient peut-etre deja de la demander.
    // `undefined` = le budget de la recherche est epuise : on ne demande pas.
    const parIsbn = await identiteOLMemorisee(isbn, BUDGET_TOME_MS, budget);
    if (parIsbn === undefined) return null;
    if (parIsbn && parIsbn.oeuvreId) {
      // Etape 8 : memorisee elle aussi, et partagee par toutes les editions de
      // l'oeuvre (le francais et l'anglais ne coutent qu'une requete).
      const premierePublication = await publicationOLMemorisee(parIsbn.oeuvreId, BUDGET_TOME_MS, budget)
        .catch(() => null);
      return { ...parIsbn, premierePublication: premierePublication ?? null };
    }
  }
  if (!depenserBudgetOL(budget)) return null;
  return ol.identiteParRecherche(carte.titre, carte.auteurs[0], BUDGET_TOME_MS);
}

export async function enrichirTomesConnus(cartes, requete = '', budget = null) {
  const liste = cartes || [];
  /*
   * ETAPE 8 : avec une recherche, on ne s'interesse qu'au LIVRE CHERCHE (niveau
   * 0). Les autres livres de l'auteur, les essais et les homonymes n'ont pas a
   * faire payer Open Library pour un numero de tome que personne ne verra. Sans
   * recherche (appel isole), comportement inchange.
   */
  const niveaux = /[a-z0-9]/i.test(String(requete || '')) ? niveauxDeRecherche(liste, requete) : null;
  const sansTome = liste.filter((c) => numeroDeTome(`${c.titre || ''} ${c.sousTitre || ''}`) === null
    && (c.auteurs || [])[0]
    && (!niveaux || niveaux.get(c) === 0));

  const parAuteur = new Map();
  sansTome.forEach((c) => {
    const cle = cleAuteur(c.auteurs[0]);
    if (!parAuteur.has(cle)) parAuteur.set(cle, []);
    parAuteur.get(cle).push(c);
  });

  const aEnrichir = new Set();
  parAuteur.forEach((groupe) => {
    if (groupe.length >= SEUIL_SAGA_PRESSENTIE) groupe.forEach((c) => aEnrichir.add(c));
  });
  if (aEnrichir.size === 0) return liste;

  const identites = new Map();
  // Les mieux classees d'abord : si le budget s'epuise, ce sont elles qui l'ont eu.
  const ordreDemande = [...aEnrichir].sort((a, b) => scorePertinence(b, requete) - scorePertinence(a, requete));
  await Promise.all(ordreDemande.map(async (carte) => {
    try {
      identites.set(carte, await identiteFiablePourTome(carte, budget));
    } catch { /* silence : la carte reste sans numero, comme le veut §4.4 */ }
  }));

  const enrichies = new Map();
  identites.forEach((identite, carte) => {
    if (identite && Number.isInteger(identite.cycleTome) && identite.cycleNom) {
      enrichies.set(carte, { ...carte, cycleTome: identite.cycleTome, cycleNom: identite.cycleNom });
    }
  });

  deduireTomesParDate(parAuteur, identites, enrichies);

  return liste.map((c) => enrichies.get(c) || c);
}

/*
 * DEDUCTION PAR DATE — tranche 33, chantier 3 bis. Critere ecrit par Kinder
 * (2026-09-27) : Open Library ne connait pas non plus le tome de Harry Potter
 * (verifie sur de vraies editions Gallimard et Pottermore, champ `series`
 * vide). Faute de source qui l'ECRIT, on le DEDUIT de la date de TOUTE
 * PREMIERE publication (`premierePublication`, Open Library) — une donnee
 * reelle, mais une deduction, pas une lecture. Une carte deduite porte
 * `tomeDeduit: true` : l'ecran l'affiche autrement (« tome N (deduit) »),
 * jamais comme un fait aussi sur qu'un numero lu.
 *
 * La date vient d'OPEN LIBRARY, jamais de Google : verifie sur Harry Potter,
 * la date d'edition de Google est celle d'une REIMPRESSION — cinq tomes
 * differents partagent la meme date francaise (« 2015-12-08 »), ce qui rend
 * tout ordre par date Google inutilisable. `first_publish_year` d'Open
 * Library distingue vraiment les sept tomes (1997 a 2007).
 *
 * Conditions, toutes requises, pour ne jamais deviner a moitie :
 *  - le groupe (meme auteur, >= 3, sans numero) n'a reçu AUCUN numero ECRIT
 *    d'Open Library — un groupe partiellement connu ne se complete pas par
 *    date, cela melangerait deux origines de numero sur une seule serie ;
 *  - CHAQUE carte du groupe a une premiere publication connue d'Open
 *    Library ;
 *  - toutes les annees sont DISTINCTES — deux memes annees rendent l'ordre
 *    ambigu, mieux vaut n'en numeroter aucune ;
 *  - les titres partagent un DEBUT commun (« Harry Potter ») : sans nom a
 *    donner a la serie, il n'y a rien a annoncer a l'ecran.
 */
/*
 * Un connecteur final SEUL ne nomme rien (« Harry Potter et » — le dernier mot
 * commun aux 7 titres est la conjonction qui introduit CHAQUE sous-titre, pas
 * la serie). On le retire s'il termine le prefixe trouve.
 */
const CONNECTEURS_FINAUX = new Set(['et', 'de', 'du', 'des', 'la', 'le', 'les', 'l']);

function debutCommun(cartes) {
  const mots = cartes.map((c) => String(c.titre || '').trim().split(/\s+/));
  const min = Math.min(...mots.map((m) => m.length));
  let n = 0;
  while (n < min && mots.every((m) => normaliser(m[n], false) === normaliser(mots[0][n], false))) n += 1;
  while (n > 0 && CONNECTEURS_FINAUX.has(normaliser(mots[0][n - 1], false))) n -= 1;
  return n > 0 ? mots[0].slice(0, n).join(' ') : null;
}

function deduireTomesParDate(parAuteur, identites, enrichies) {
  parAuteur.forEach((groupe) => {
    if (groupe.length < SEUIL_SAGA_PRESSENTIE) return;
    if (groupe.some((c) => enrichies.has(c))) return;   // Open Library a ECRIT un numero pour au moins une

    const annees = groupe.map((c) => identites.get(c)?.premierePublication ?? null);
    if (annees.some((a) => a === null)) return;          // une date manquante : on n'invente rien
    if (new Set(annees).size !== annees.length) return;  // deux memes annees : ordre ambigu

    const nom = debutCommun(groupe);
    if (!nom) return;                                     // pas de nom a donner a la serie

    groupe
      .map((carte, i) => [carte, annees[i]])
      .sort((a, b) => a[1] - b[1])
      .forEach(([carte], i) => {
        enrichies.set(carte, { ...carte, cycleTome: i + 1, cycleNom: nom, tomeDeduit: true });
      });
  });
}

/*
 * Toutes les cles d'une fiche — y compris celles qu'elle a deja absorbees.
 * C'est ce qui rend la fusion IDEMPOTENTE : l'ecran refond la liste entiere a
 * chaque page chargee, et refondre un resultat deja fondu ne doit pas lui
 * faire oublier ce qu'il a avale au tour precedent.
 */
function clesDe(r) {
  return Array.isArray(r.clesSource) && r.clesSource.length ? r.clesSource : [r.cleSource];
}

/* Une carte a partir d'un groupe de fiches du meme livre. */
function fondre(groupe, requete) {
  if (groupe.length === 1) return { ...groupe[0], clesSource: clesDe(groupe[0]) };

  /*
   * La fiche RETENUE est la mieux classee — le meme calcul que celui qui range
   * l'ecran (tranche 1), pour que la carte affichee soit bien celle qui aurait
   * gagne. A egalite, la premiere arrivee : l'ordre de Google reste une
   * information.
   */
  /*
   * ETAPE 5 (decision 2) : quand le groupe reunit plusieurs LANGUES, l'edition
   * FRANCAISE passe en vitrine. Sinon une traduction mieux classee prendrait la
   * place de l'edition que l'utilisateur lit.
   */
  const francaises = groupe.filter((r) => /^fr/i.test(String(r.langue || '')));
  const candidates = francaises.length > 0 && francaises.length < groupe.length ? francaises : groupe;
  let base = candidates[0];
  let meilleur = scorePertinence(base, requete);
  candidates.slice(1).forEach((r) => {
    const note = scorePertinence(r, requete);
    if (note > meilleur) { base = r; meilleur = note; }
  });

  const fondu = { ...base, clesSource: [...new Set(groupe.flatMap(clesDe))] };
  // La fiche retenue peut ne pas porter l'oeuvre d'Open Library que porte une
  // autre du groupe : on la garde, pour que la refonte d'une page suivante relie
  // encore cette carte a ses traductions.
  if (!fondu.oeuvreOL) {
    const porteuse = groupe.find((r) => r.oeuvreOL);
    if (porteuse) fondu.oeuvreOL = porteuse.oeuvreOL;
  }

  // On ne REMPLACE jamais ce que la fiche retenue sait deja : on ne comble que
  // ses trous, avec la premiere fiche du groupe qui a la reponse.
  CHAMPS_A_COMPLETER.forEach((champ) => {
    if (!estVide(fondu[champ])) return;
    const donneur = groupe.find((r) => !estVide(r[champ]));
    if (donneur) fondu[champ] = donneur[champ];
  });

  // `auteurs` et `categories` sont des listes : meme regle, comblement seul.
  if (estVide(fondu.auteurs)) {
    const donneur = groupe.find((r) => !estVide(r.auteurs));
    if (donneur) fondu.auteurs = donneur.auteurs;
  }
  if (estVide(fondu.categories)) {
    const donneur = groupe.find((r) => !estVide(r.categories));
    if (donneur) fondu.categories = donneur.categories;
  }

  return fondu;
}

/**
 * Recherche. Cache mémoire 30 min sur les résultats uniquement : les fiches
 * n'en ont pas besoin, elles seront en base (§3.5).
 * @param {string} texte
 * @param {'titre'|'auteur'|'isbn'} mode
 * @returns {Promise<ResultatRecherche[]>}
 */
export async function rechercher(texte, mode, page = 0, auteur = '') {
  const requete = String(texte || '').trim();

  /*
   * LA NOTORIETE PART D'ICI, ET NON PLUS DE `rechercherBrut` (M2).
   *
   * Elle doit toujours se recouvrir avec l'appel Google — d'ou son lancement
   * AVANT lui — mais elle ne doit plus etre ARCHIVEE avec les resultats. Voir
   * le commentaire ci-dessous : c'est tout l'objet de cette correction.
   */
  const promesseNotoriete = (mode === 'titre' && requete) ? notorieteDe(requete) : null;

  const brut = await rechercherBrut(texte, mode, page, auteur, promesseNotoriete);

  /*
   * TOUT CE QUI SE DECIDE SE DECIDE ICI, A LA SORTIE, ET RIEN N'EST ARCHIVE
   * DEJA TRANSFORME (M2).
   *
   * L'intention etait deja ecrite pour la fusion — « l'archive garde les
   * resultats tels que la source les a rendus » — mais la notoriete l'a
   * violee : elle etait attachee AVANT l'archivage. Consequence mesuree sur le
   * telephone : une recherche deja faite ressortait de l'archive de 24 h avec
   * le classement de la version PRECEDENTE, et la correction restait invisible
   * une journee entiere. L'utilisateur voyait donc sa page 1 en conserve et
   * ses pages suivantes fraiches — d'ou « les vrais resultats n'apparaissent
   * qu'en defilant ».
   *
   * Regle desormais tenue des deux cotes : l'archive ne contient QUE ce que
   * les sources ont rendu ; le classement et la fusion se recalculent a chaque
   * affichage. Toute correction se voit immediatement, y compris sur les
   * recherches deja archivees.
   *
   * Mode ISBN excepte : un ISBN designe UNE edition precise, il n'y a rien a
   * regrouper et fusionner y serait mentir.
   */
  if (mode === 'isbn') return { ...brut, nbSource: brut.resultats.length };

  const classes = attribuerNotoriete(
    brut.resultats,
    promesseNotoriete ? await promesseNotoriete : [],
  );

  /*
   * `nbSource` = combien la SOURCE a rendu, avant fusion. L'ecran en a besoin
   * pour savoir s'il existe une page suivante : il comptait jusqu'ici les
   * cartes affichees, ce qui devient faux des que la fusion en supprime.
   * Mesure du 2026-08-27 : « germinal » rend 20 volumes et 6 cartes — sans ce
   * compte, l'ecran concluait « plus rien a charger » et la saga suivante
   * redevenait hors de portee, exactement le bug du retour d'usage 101.
   */
  // Etape 5 : les traductions qu'Open Library rattache a la meme oeuvre se
  // fondent ensemble. Mode Titre seulement, comme la notoriete.
  const budgetOL = nouveauBudgetOL();
  const rattachees = mode === 'titre' ? await rattacherAuxOeuvres(classes, texte, page === 0, budgetOL) : classes;
  const cartes = fusionnerDoublonsAffichage(rattachees, texte);

  /*
   * Tranche 33 : le numero de tome qu'aucun titre n'ecrit (Harry Potter) est
   * rattrape par Open Library, mode Titre seulement — c'est le seul mode ou
   * une saga a du sens. Mode Auteur et ISBN : inchange.
   */
  return {
    ...brut,
    nbSource: brut.resultats.length,
    resultats: mode === 'titre' ? await enrichirTomesConnus(cartes, texte, budgetOL) : cartes,
  };
}

/*
 * VIDER LE CACHE DE RECHERCHE (M2).
 *
 * Sans ce bouton, une correction du classement reste invisible pendant 24 h
 * sur les recherches deja faites : c'est ce qui a fait tester une version
 * ancienne en croyant tester la nouvelle. Vider les donnees de l'application
 * n'etait PAS une solution — la bibliotheque vit dans le meme stockage et
 * aurait ete perdue avec.
 *
 * Ne touche donc QUE le cache : les resultats archives, la notoriete, et le
 * cache memoire. Ni la base, ni l'historique des recherches, qui est une
 * commodite que personne ne demande a effacer en meme temps.
 */
export async function viderCacheRecherche() {
  cacheRecherche.clear();
  echecsNotoriete.clear();
  try {
    const { keys, delMany } = await import('idb-keyval');
    const toutes = await keys();
    const aJeter = toutes.filter((k) => typeof k === 'string'
      && (k.startsWith(PREFIXE_ARCHIVE) || k.startsWith(PREFIXE_NOTORIETE)));
    if (aJeter.length) await delMany(aJeter);
    return aJeter.length;
  } catch {
    return 0;   // IndexedDB indisponible : le cache memoire est deja vide
  }
}

async function rechercherBrut(texte, mode, page = 0, auteur = '', promesseNotoriete = null) {
  const requete = texte.trim();
  if (!requete) return { resultats: [], ancien: false, pose: null };

  /*
   * L'auteur entre dans la CLE DE CACHE : « les fourmis » et « les fourmis de
   * Werber » sont deux questions differentes, et servir la reponse de l'une
   * pour l'autre annulerait tout l'interet du champ.
   */
  const precise = String(auteur || '').trim().toLowerCase();
  const cle = `${mode}:${requete.toLowerCase()}${precise ? `@${precise}` : ''}${page ? `#${page}` : ''}`;
  const enCache = cacheRecherche.get(cle);
  if (enCache && Date.now() - enCache.pose < CACHE_TTL_MS) {
    return { resultats: enCache.resultats, ancien: false, pose: enCache.pose };
  }

  /*
   * L'ARCHIVE SERT DE CACHE, et non plus seulement de filet (correction 118).
   *
   * Retour d'usage : « je fais une recherche, je quitte, je reprends la meme
   * recherche, il doit toujours charger ». C'etait exact et c'etait un defaut
   * de conception : le cache memoire meurt avec l'application, et l'archive —
   * qui contenait pourtant deja les resultats — n'etait lue QUE dans le
   * `catch`, c'est-a-dire uniquement quand Google tombait. On rappelait donc
   * Google alors qu'on avait la reponse sous la main.
   *
   * Vingt-quatre heures : un catalogue de livres ne change pas dans la
   * journee, et chaque appel evite est un appel de moins sur les 1 000
   * quotidiens. Au-dela, on redemande — l'archive de sept jours reste
   * disponible en cas de panne, plus bas.
   */
  const recente = await lireArchive(cle, ARCHIVE_FRAICHE_MS);
  if (recente) {
    cacheRecherche.set(cle, { pose: recente.pose, resultats: recente.resultats });
    return { resultats: recente.resultats, ancien: false, pose: recente.pose };
  }

  /*
   * LA BnF PART EN MEME TEMPS QUE GOOGLE (tranche 4). Elle n'attend plus que
   * Google tombe : elle sert desormais A CHAQUE recherche, pour combler ce qui
   * manque aux fiches de Google — ISBN, editeur, annee. Voir
   * `completerDepuisBnf` plus bas pour le pourquoi.
   *
   * Elle part AVANT l'appel Google et non apres, pour que les deux temps
   * d'attente se recouvrent : la BnF repond en 76 a 1300 ms, Google en 430 a
   * 1000 ms. Lancee en sequence, elle doublerait l'attente ; lancee en
   * parallele, elle ne coute presque rien.
   *
   * Un seul appel par recherche, sur la PREMIERE page uniquement : la BnF ne
   * pagine pas, et les pages suivantes profitent de toute facon de la fusion
   * (tranche 2), qui rapproche leurs fiches de celles deja completees.
   *
   * `catch` des la creation : une promesse rejetee que personne n'attend
   * encore ferait tomber l'application avant meme qu'on la regarde.
   */
  const promesseBnf = (mode !== 'isbn' && page === 0)
    ? interrogerBnf(requete, mode, auteur).catch(() => [])
    : null;

  let resultats;
  try {
    resultats = await interroger(requete, mode, page, auteur);
  } catch (panne) {
    /*
     * FILET BnF (tranche 19). Google n'est pas incomplet, il est INSTABLE :
     * mesure du 2026-08-25, 4 recherches sur 6 abouties — et 1 sur 6 deux
     * heures plus tot. Le catalogue de la Bibliotheque nationale, lui, a
     * repondu 10 fois sur 10 puis 6 fois sur 6, sans cle ni quota.
     *
     * Il n'arrive qu'ICI, en repli, et jamais en premier : sa pertinence est
     * franchement moins bonne — une recherche « germinal » y rend une revue
     * de Lormont avant le roman de Zola — et il ne fournit ni couverture ni
     * resume. Mieux vaut ses resultats que le message « Google Books est
     * momentanement indisponible ».
     */
    if (mode !== 'isbn') {
      try {
        // L'appel est deja parti au-dessus : on attend son resultat plutot que
        // d'en lancer un second pour la meme question.
        const secours = promesseBnf ? await promesseBnf : await interrogerBnf(requete, mode, auteur);
        if (secours.length) {
          const pose = Date.now();
          const illustres = secours.map(avecCouvertureDeRepli);
          cacheRecherche.set(cle, { pose, resultats: illustres });
          return { resultats: illustres, ancien: false, pose };
        }
      } catch { /* la BnF non plus : on passe a l'archive */ }
    }

    /*
     * ARCHIVE — le dernier recours, et le seul qui reste (tranche 10).
     * Six essais laissent encore environ 4 % des recherches en echec, parce
     * que les 503 de Google arrivent en rafales (§4.7). Deux replis ont ete
     * envisages puis ecartes par la mesure : Open Library en source de
     * decouverte (6 a 21 s, pertinence francaise mauvaise — correction 72),
     * et une seconde cle (le quota est par PROJET, pas par cle).
     * Restait ce qu'on avait deja : la meme recherche, faite plus tot. Mieux
     * vaut des resultats d'hier annonces comme tels qu'un ecran vide.
     */
    const archive = await lireArchive(cle);
    if (archive) return { resultats: archive.resultats, ancien: true, pose: archive.pose };
    throw panne;
  }

  /*
   * L'ordre compte : on complete D'ABORD avec la BnF — qui apporte les ISBN —
   * puis on illustre. C'est l'ISBN nouvellement connu qui ouvre la couverture
   * Open Library, sans une seule requete de plus (c'est une adresse d'image).
   * Et tout cela AVANT l'archivage : la recherche rejouee demain sortira
   * completee, sans rappeler personne.
   */
  /*
   * UN « 0 RESULTAT » VAUT UNE PANNE (mission « recherche satisfaisante »,
   * etape 1). Google peut repondre 200 avec zero volume, sans erreur : mesure
   * du 2026-10-04, c'est ce qui rendait vides germinal, 1984, l'anomalie,
   * l'elegance du herisson et les recherches par auteur. Le filet BnF ci-dessus
   * ne partait que sur une erreur, donc l'ecran restait vide.
   *
   * Chaine de repli, 1re page seulement (une page suivante vide, c'est la fin
   * des resultats) : la question posee librement a Google, puis la BnF, deja
   * partie en parallele. L'ISBN a sa propre chaine dans `interroger`.
   *
   * Un resultat de repli n'est NI mis en cache NI archive : si Google redevient
   * normal, la recherche suivante doit lui redemander la bonne reponse plutot
   * que servir pendant 24 h la reponse bruyante.
   */
  let repli = false;
  let depuisBnf = false;
  if (resultats.length === 0 && page === 0 && mode !== 'isbn') {
    repli = true;
    try {
      resultats = await google.rechercherLibre(requete, auteur);
    } catch {
      resultats = [];   // Google est muet ou en panne : la BnF est la suivante
    }
    if (resultats.length === 0) {
      const secours = promesseBnf ? await promesseBnf : [];
      if (secours.length) { resultats = secours; depuisBnf = true; }
    }
  }

  /*
   * COMPLETER PAR L'AUTEUR (mission « recherche satisfaisante », etape 3).
   * Mesure du 2026-10-04 : `intitle:` seul laisse le livre cherche hors de la
   * 1re page (Mauvignier pour « la maison vide », les tomes 1, 13, 14 et 15 du
   * Trone de fer, les editions francaises de 1984) alors que Google les a des
   * qu'on lui donne l'auteur. Archive avec le reste : c'est du brut de Google.
   */
  if (mode === 'titre' && page === 0 && !String(auteur || '').trim()
    && promesseNotoriete && !depuisBnf) {
    resultats = await completerParAuteurs(requete, resultats, promesseNotoriete);
  }

  const completes = depuisBnf
    ? resultats   // ce sont deja des notices BnF : rien a completer
    : completerDepuisBnf(resultats, promesseBnf ? await promesseBnf : []);
  /*
   * On archive du BRUT : ni notoriete, ni fusion (M2). Elles se recalculent a
   * l'affichage, dans `rechercher`. Voir le commentaire la-bas.
   */
  const illustres = completes.map(avecCouvertureDeRepli);
  const pose = Date.now();
  if (repli) {
    if (illustres.length) void noterDansHistorique(requete, mode);
    return { resultats: illustres, ancien: false, pose };
  }
  cacheRecherche.set(cle, { pose, resultats: illustres });
  // Volontairement non attendu : archiver ne doit pas retarder l'affichage.
  if (illustres.length) void ecrireArchive(cle, pose, illustres);
  if (illustres.length && page === 0) void noterDansHistorique(requete, mode);
  return { resultats: illustres, ancien: false, pose };
}

// ---------------------------------------------------------------------------
// COMPLETER PAR L'AUTEUR (mission « recherche satisfaisante », etape 3)
// ---------------------------------------------------------------------------

/** Plafond d'auteurs interroges en plus : chacun coute une requete Google (§4.1). */
export const MAX_AUTEURS_COMPLEMENT = 3;

const ARTICLES_DE_TETE = new Set(['a', 'an', 'the', 'le', 'la', 'les', 'l', 'un', 'une', 'des']);

/** Un titre reduit pour savoir s'il est « exactement » la recherche : sans accent,
 * sans ponctuation, sans article de tete. */
function titreExact(texte) {
  const mots = normaliser(texte, false).split('-').filter(Boolean);
  return (mots.length > 1 && ARTICLES_DE_TETE.has(mots[0]) ? mots.slice(1) : mots).join('-');
}

/**
 * Les auteurs a qui poser une question de plus a Google, 3 au plus :
 *  1. ceux des oeuvres Open Library dont le titre est EXACTEMENT la recherche,
 *     les plus lues d'abord (« la maison vide » : Mauvignier, Gutman, Bernard) ;
 *  2. a defaut de place, l'auteur arrive EN TETE chez Open Library — Open
 *     Library ecrit souvent le titre autrement (« Nineteen Eighty-Four »,
 *     « A Game of Thrones »), l'auteur, lui, traverse les traductions.
 *
 * @param {string} requete
 * @param {Array<{titre: string, auteurs: string[], lecteurs: number}>} oeuvres
 * @returns {string[]} noms tels qu'Open Library les ecrit
 */
export function auteursACompleter(requete, oeuvres) {
  const liste = oeuvres || [];
  const cherche = titreExact(requete);
  if (!cherche || liste.length === 0) return [];

  const exacts = liste
    .filter((o) => titreExact(o.titre) === cherche)
    .sort((a, b) => (b.lecteurs || 0) - (a.lecteurs || 0));

  const noms = [];
  const profils = [];
  [...exacts, liste[0]].forEach((o) => {
    const nom = (o.auteurs || [])[0];
    const profil = nom ? profilAuteur(nom) : null;
    if (!profil || noms.length >= MAX_AUTEURS_COMPLEMENT) return;
    if (profils.some((p) => memeAuteur(p, profil))) return;
    profils.push(profil);
    noms.push(nom);
  });
  return noms;
}

/**
 * Ajoute aux resultats de Google ceux de « titre + auteur », sans doublon. Ne
 * rejette jamais : une question en echec est simplement ignoree, et sans
 * Open Library on n'ajoute rien — la recherche reste ce qu'elle etait.
 */
async function completerParAuteurs(requete, resultats, promesseNotoriete) {
  let oeuvres = [];
  try { oeuvres = await promesseNotoriete; } catch { /* aucune notoriete : rien a completer */ }
  const noms = auteursACompleter(requete, oeuvres);
  if (noms.length === 0) return resultats;

  const lots = await Promise.all(noms.map((nom) => google.rechercherLibre(requete, nom).catch(() => [])));
  const vus = new Set(resultats.map((r) => r.cleSource));
  const ajouts = [];
  lots.flat().forEach((r) => {
    if (vus.has(r.cleSource)) return;
    vus.add(r.cleSource);
    ajouts.push(r);
  });
  return [...resultats, ...ajouts];
}

// ---------------------------------------------------------------------------
// RATTACHER LES FICHES A LEUR OEUVRE OPEN LIBRARY (mission « recherche
// satisfaisante », etape 5, decision 2)
// ---------------------------------------------------------------------------

/*
 * Mesure du 2026-10-04 : Open Library rattache a la meme oeuvre l'edition
 * anglaise et l'edition francaise des tomes celebres de Harry Potter (12 ISBN
 * sur 14 reconnus), mais presque rien des livres recents (le zoo de Dicker,
 * l'elegance du herisson, la Passe-miroir : 1 a 2 ISBN reconnus sur 2 a 8). Et
 * elle est lente : 1 a 6 s par ISBN quand on en interroge plusieurs d'un coup.
 * D'ou : un plafond, une limite de temps, et une memoire des reponses.
 */
const MAX_RECHERCHES_OEUVRE = 4;      // etape 8 : la part du rattachement des traductions
const BUDGET_OEUVRES_MS = 3500;       // ce que la recherche accepte d'attendre
const DELAI_FICHE_OL_MS = 12000;      // ce qu'une requete a le droit de durer, elle
                                      // continue en fond et sa reponse sert la fois suivante
const PREFIXE_IDENTITE_ISBN = 'oeuvre-isbn:';
const VIE_IDENTITE_CONNUE_MS = 30 * 24 * 60 * 60 * 1000;
const VIE_IDENTITE_INCONNUE_MS = 7 * 24 * 60 * 60 * 1000;

const identitesOL = new Map();   // isbn -> { pose, identite | null }
const identitesEnCours = new Map();

function entreeFraiche(entree) {
  if (!entree) return false;
  const vie = entree.identite ? VIE_IDENTITE_CONNUE_MS : VIE_IDENTITE_INCONNUE_MS;
  return Date.now() - entree.pose < vie;
}

async function chargerIdentiteIsbn(isbn) {
  if (entreeFraiche(identitesOL.get(isbn))) return;
  try {
    const { get } = await import('idb-keyval');
    const entree = await get(PREFIXE_IDENTITE_ISBN + isbn);
    if (entreeFraiche(entree)) identitesOL.set(isbn, entree);
  } catch { /* IndexedDB indisponible : on demandera a la source */ }
}

/*
 * BUDGET DE REQUETES OPEN LIBRARY PAR RECHERCHE (mission « recherche
 * satisfaisante », etape 8, volet A). Mesure du 2026-10-04 : 290 requetes en 4
 * minutes (5 a 27 par recherche, 16 en moyenne) et Open Library qui cesse de
 * repondre deux fois dans la soiree. La cause : le calcul des tomes de saga se
 * declenchait des qu'un auteur avait trois cartes sans numero — ce que la
 * completion par l'auteur (etape 3) rend presque systematique — et interrogeait
 * Open Library pour CHACUNE (une requete par edition, une par oeuvre).
 *
 * Dix requetes RESEAU au plus par recherche, notoriete non comprise. Ce qui est
 * deja en memoire ne coute rien : une saga se complete donc recherche apres
 * recherche, au lieu de tout payer d'un coup.
 */
export const BUDGET_REQUETES_OL = 10;

function nouveauBudgetOL() {
  return { reste: BUDGET_REQUETES_OL };
}

/** Prend une unite du budget. Sans budget (appel isole), tout est permis. */
function depenserBudgetOL(budget) {
  if (!budget) return true;
  if (budget.reste <= 0) return false;
  budget.reste -= 1;
  return true;
}

// Premiere publication d'une oeuvre : meme memoire que l'identite d'une edition.
const PREFIXE_PUBLICATION = 'publication-oeuvre:';
const publicationsOL = new Map();   // oeuvreId -> { pose, annee | null }
const publicationsEnCours = new Map();

async function publicationOLMemorisee(oeuvreId, budgetMs, budget = null) {
  let entree = publicationsOL.get(oeuvreId);
  if (!entreeFraiche({ pose: entree?.pose, identite: entree })) {
    entree = null;
    try {
      const { get } = await import('idb-keyval');
      const lue = await get(PREFIXE_PUBLICATION + oeuvreId);
      if (lue && entreeFraiche({ pose: lue.pose, identite: lue })) { publicationsOL.set(oeuvreId, lue); entree = lue; }
    } catch { /* IndexedDB indisponible */ }
  }
  if (entree) return entree.annee;

  if (!publicationsEnCours.has(oeuvreId)) {
    if (!depenserBudgetOL(budget)) return undefined;
    const requete = ol.premierePublicationParOeuvre(oeuvreId, budgetMs)
      .then(async (annee) => {
        const nouvelle = { pose: Date.now(), annee: annee ?? null };
        publicationsOL.set(oeuvreId, nouvelle);
        try {
          const { set } = await import('idb-keyval');
          await set(PREFIXE_PUBLICATION + oeuvreId, nouvelle);
        } catch { /* ecrire la memoire n'est jamais une raison d'echouer */ }
        return nouvelle.annee;
      })
      .finally(() => publicationsEnCours.delete(oeuvreId));
    publicationsEnCours.set(oeuvreId, requete);
  }
  return publicationsEnCours.get(oeuvreId);
}

/**
 * L'identite Open Library d'une edition (oeuvre, serie, tome), MEMORISEE : en
 * memoire, puis sur l'appareil (30 jours si connue, 7 jours si inconnue). Une
 * panne ou un delai depasse REJETTENT et ne sont jamais memorises — seule une
 * reponse d'Open Library l'est, « je ne connais pas cet ISBN » comprise.
 */
export async function identiteOLMemorisee(isbn, budgetMs, budget = null) {
  await chargerIdentiteIsbn(isbn);
  const connue = identitesOL.get(isbn);
  if (entreeFraiche(connue)) return connue.identite;

  if (!identitesEnCours.has(isbn)) {
    // Etape 8 : une reponse deja en memoire est GRATUITE, une requete reseau
    // coute une unite du budget de la recherche. Budget epuise : on ne demande pas.
    if (!depenserBudgetOL(budget)) return undefined;
    const requete = ol.identiteParIsbn(isbn, budgetMs)
      .then(async (identite) => {
        const entree = { pose: Date.now(), identite: identite || null };
        identitesOL.set(isbn, entree);
        try {
          const { set } = await import('idb-keyval');
          await set(PREFIXE_IDENTITE_ISBN + isbn, entree);
        } catch { /* ecrire la memoire n'est jamais une raison d'echouer */ }
        return entree.identite;
      })
      .finally(() => identitesEnCours.delete(isbn));
    identitesEnCours.set(isbn, requete);
  }
  return identitesEnCours.get(isbn);
}

/**
 * Attache `oeuvreOL` aux fiches dont Open Library connait l'oeuvre. Ne sert que
 * s'il y a de quoi fusionner : un meme auteur dont les fiches melangent plusieurs
 * LANGUES. Sinon, aucun appel. Ne rejette jamais.
 *
 * @param {ResultatRecherche[]} fiches avant fusion
 * @param {string} requete
 * @param {boolean} autoriserReseau false pour les pages suivantes : on n'y lit que
 *   ce que la memoire connait deja
 */
async function rattacherAuxOeuvres(fiches, requete, autoriserReseau, budget = null) {
  const liste = fiches || [];
  try {
    const langues = new Map();
    liste.forEach((r) => {
      const nom = Array.isArray(r.auteurs) ? r.auteurs[0] : r.auteurs;
      const profil = nom ? profilAuteur(nom) : null;
      const langue = String(r.langue || '').slice(0, 2).toLowerCase();
      if (!profil || !langue) return;
      if (!langues.has(profil.famille)) langues.set(profil.famille, new Set());
      langues.get(profil.famille).add(langue);
    });
    const familles = new Set([...langues].filter(([, s]) => s.size >= 2).map(([f]) => f));
    if (familles.size === 0) return liste;

    const candidates = liste.filter((r) => {
      const nom = Array.isArray(r.auteurs) ? r.auteurs[0] : r.auteurs;
      const profil = nom ? profilAuteur(nom) : null;
      return profil && familles.has(profil.famille) && cleIsbn(r.isbn13 || r.isbn10);
    });
    const isbnDe = (r) => cleIsbn(r.isbn13 || r.isbn10);
    const uniques = [...new Map(candidates.map((r) => [isbnDe(r), r])).entries()]
      .sort((a, b) => scorePertinence(b[1], requete) - scorePertinence(a[1], requete))
      .map(([isbn]) => isbn);

    await Promise.all(uniques.map(chargerIdentiteIsbn));
    const inconnus = uniques.filter((isbn) => !entreeFraiche(identitesOL.get(isbn)));

    if (autoriserReseau && inconnus.length > 0) {
      const attente = Promise.all(inconnus.slice(0, MAX_RECHERCHES_OEUVRE)
        .map((isbn) => identiteOLMemorisee(isbn, DELAI_FICHE_OL_MS, budget).catch(() => null)));
      let minuteur;
      await Promise.race([attente, new Promise((fin) => { minuteur = setTimeout(fin, BUDGET_OEUVRES_MS); })]);
      clearTimeout(minuteur);
    }

    return liste.map((r) => {
      const isbn = isbnDe(r);
      const entree = isbn ? identitesOL.get(isbn) : null;
      const oeuvre = entree && entreeFraiche(entree) && entree.identite ? entree.identite.oeuvreId : null;
      return oeuvre ? { ...r, oeuvreOL: oeuvre } : r;
    });
  } catch {
    return liste;
  }
}

// ---------------------------------------------------------------------------
// COMPLETER LES FICHES DE GOOGLE AVEC LA BnF (retour d'usage 122, tranche 4)
// ---------------------------------------------------------------------------

/*
 * « Les couvertures des livres ne s'affichent que tres peu dans la recherche,
 * alors qu'en allant chercher une autre edition du livre, on trouve la bonne
 * couverture. »
 *
 * Diagnostic : ce n'est pas la meme source qui repond. `avecCouvertureDeRepli`
 * ne sait aller chercher une image Open Library qu'A PARTIR D'UN ISBN — et les
 * volumes rendus par `intitle:` chez Google n'en portent souvent aucun. L'ecran
 * des editions, lui, interroge la BnF, qui donne TOUJOURS ISBN et editeur : le
 * repli y fonctionne a tous les coups. D'ou l'ecart ressenti.
 *
 * La BnF ne remplace donc pas Google, elle le COMPLETE : ses notices sont
 * rapprochees des resultats par empreinte d'oeuvre, et servent a combler les
 * trous. Aucune notice sans correspondance n'est ajoutee a la liste — sa
 * pertinence en decouverte est mauvaise (une recherche « germinal » y rend une
 * revue de Lormont avant le roman de Zola), et ce n'est pas ce qu'on lui
 * demande ici.
 *
 * Si la BnF ne repond pas, la recherche s'affiche exactement comme avant :
 * cette etape n'a pas de repli et n'en a pas besoin.
 *
 * CE QU'ELLE RAPPORTE VRAIMENT — mesure du 2026-08-27 sur 114 volumes reels,
 * six recherches (germinal, les fourmis, la horde du contrevent, la quete
 * d'Ewilan, le nom de la rose, la peste) :
 *
 *   + 18 editeurs   (16 % des volumes en gagnent un)
 *   +  4 ISBN       (3,5 %), donc autant de couvertures rendues possibles
 *
 * L'EDITEUR est donc le vrai gain, pas la couverture : Google porte deja un
 * ISBN dans la grande majorite des cas, et la ou il n'en a pas, la BnF ne
 * connait souvent pas le livre non plus. L'ecart de couvertures ressenti
 * entre la recherche et l'ecran des editions venait donc surtout d'ailleurs —
 * de la fusion des doublons (tranche 2), qui reunit sur une seule carte la
 * fiche qui porte l'image et celle qui porte l'ISBN.
 * On garde tout de meme cette etape : un appel sans quota ni cle, lance en
 * parallele, pour 16 % d'editeurs en plus, se paie de lui-meme. Deux exemples
 * mesures : « la horde du contrevent » passe de 11 volumes sans editeur a 1,
 * « le nom de la rose » de 11 a 5.
 */

/*
 * Ce que la BnF sait et que Google ignore parfois. Ni `couvertureUrl` ni
 * `resume` ni `nbPages` : elle n'en fournit aucun (voir sources/bnf.js). Ni
 * `titre` ni `auteurs` : ils font l'identite du resultat, et c'est justement
 * sur eux qu'on a fait le rapprochement — les remplacer serait circulaire.
 */
const CHAMPS_DE_LA_BNF = ['isbn13', 'isbn10', 'editeur', 'annee', 'datePublication', 'categories'];

/**
 * Complete des resultats avec les notices BnF qui leur correspondent.
 *
 * @param {ResultatRecherche[]} resultats ce que Google a rendu
 * @param {ResultatRecherche[]} notices ce que la BnF a rendu pour la meme recherche
 * @returns {ResultatRecherche[]} meme liste, meme ordre, trous combles
 */
export function completerDepuisBnf(resultats, notices) {
  if (!notices || notices.length === 0) return resultats || [];

  // Meme definition de « meme livre » qu'a la fusion (`memeLivre`) : la BnF ecrit
  // « Zola, Emile » la ou Google ecrit « Emile Zola », et l'ordre du nom ne doit
  // pas empecher le rapprochement. La PREMIERE notice qui correspond gagne : la
  // BnF rend ses editions de la plus proche a la plus lointaine, et prendre la
  // derniere donnerait l'edition la plus obscure du lot.
  const identites = notices
    .map((n) => ({ notice: n, identite: identiteDeLivre(n) }))
    .filter((x) => x.identite);

  return (resultats || []).map((r) => {
    const identiteR = identiteDeLivre(r);
    if (!identiteR) return r;
    const trouve = identites.find((x) => memeLivre(x.identite, identiteR));
    const notice = trouve ? trouve.notice : null;
    if (!notice) return r;

    // Meme regle qu'a la fusion : on comble, on n'ecrase jamais. Google reste
    // la source principale, y compris quand la BnF le contredit.
    let complete = r;
    CHAMPS_DE_LA_BNF.forEach((champ) => {
      if (!estVide(complete[champ]) || estVide(notice[champ])) return;
      complete = { ...complete, [champ]: notice[champ] };
    });
    return complete;
  });
}

// ---------------------------------------------------------------------------
// ATTRIBUER LA NOTORIETE (mission V2, M3)
// ---------------------------------------------------------------------------

/*
 * LE RAPPROCHEMENT SE FAIT SUR L'AUTEUR, PAS SUR LE TITRE. C'est la decision
 * de conception de cette tranche, et elle merite son explication.
 *
 * Le reflexe serait de rapprocher par titre, comme la fusion (§ cleRegroupement)
 * et la completion BnF. Ici cela ne marche pas : Open Library indexe les
 * oeuvres sous leur titre CANONIQUE, presque toujours anglais. « A Game of
 * Thrones » ne rejoindrait jamais « Le Trone de Fer », ni « The Fellowship of
 * the Ring » « La communaute de l'anneau » — c'est-a-dire exactement les cas
 * qu'on cherche a reparer.
 *
 * L'auteur, lui, traverse les traductions : Martin s'ecrit Martin en francais.
 * Et c'est le signal qui repond au defaut constate — « les essais SUR une
 * oeuvre passent devant l'oeuvre » —, parce que les essais ne sont PAS ecrits
 * par l'auteur de l'oeuvre. Rapprocher par auteur remet donc l'ecrivain devant
 * ses commentateurs, ce qu'aucun signal de fiche ne savait faire.
 *
 * CE QUE CELA COUTE, assume : un carnet de notes signe du meme auteur touche
 * la meme notoriete que son roman. C'est sans consequence — la notoriete
 * DEPARTAGE, elle ne fabrique pas un classement (voir le plafond dans
 * `tomes.js`), et la correspondance de titre reste dominante.
 *
 * Les auteurs sont rapproches par `cleAuteur`, la meme reduction que la fusion :
 * insensible aux accents, a la ponctuation et a l'ORDRE du nom — Open Library
 * ecrit « George R. R. Martin » la ou Google ecrit parfois « Martin, George
 * R.R. ». Une translitteration (« Френк Герберт ») ne rejoint personne, et
 * c'est pourquoi on garde TOUTES les graphies rendues par la source.
 */

/**
 * Attache a chaque resultat le nombre de lecteurs de l'oeuvre Open Library qui
 * lui correspond.
 *
 * @param {ResultatRecherche[]} resultats ce que Google a rendu
 * @param {Array<{auteurs: string[], lecteurs: number}>} oeuvres ce qu'Open Library a rendu
 * @returns {ResultatRecherche[]} meme liste, meme ordre, `lecteurs` en plus
 */
export function attribuerNotoriete(resultats, oeuvres) {
  if (!oeuvres || oeuvres.length === 0) return resultats || [];

  /*
   * Un auteur peut porter plusieurs oeuvres dans la reponse (Martin en a six
   * sur dix). On garde la PLUS LUE : c'est celle qui dit la notoriete de
   * l'ecrivain pour cette recherche.
   */
  const auteursOL = [];
  oeuvres.forEach((o, rang) => {
    (o.auteurs || []).forEach((nom) => {
      const profil = profilAuteur(nom);
      if (profil) auteursOL.push({ profil, rang, lecteurs: o.lecteurs });
    });
  });
  if (auteursOL.length === 0) return resultats || [];

  return (resultats || []).map((r) => {
    // Un livre a plusieurs auteurs : le mieux classe decide. Une edition
    // annotee « Zola, Emile / Untel » ne doit pas perdre Zola en chemin.
    // Un auteur peut porter plusieurs oeuvres de la reponse (Martin en a six
    // sur dix). On garde la MIEUX CLASSEE : c'est elle qui dit la place de
    // l'ecrivain dans la reponse a cette recherche.
    let meilleur = null;
    (r.auteurs || []).forEach((nom) => {
      const profil = profilAuteur(nom);
      if (!profil) return;
      auteursOL.forEach((o) => {
        if (memeAuteur(profil, o.profil) && (!meilleur || o.rang < meilleur.rang)) meilleur = o;
      });
    });
    if (!meilleur) return r;
    /*
     * `rangAuteur` est ce qui PESE dans le score ; `lecteurs` n'est la que pour
     * etre lu au banc d'essai. Voir `tomes.js` pour le pourquoi du rang plutot
     * que du compte.
     */
    return { ...r, rangAuteur: meilleur.rang, lecteurs: meilleur.lecteurs };
  });
}

/* Le repli BnF. Un seul appel, jamais de reessai : si elle ne repond pas,
 * l'archive prend la suite. */
async function interrogerBnf(requete, mode, auteur = '') {
  if (mode === 'auteur') return bnf.rechercherParAuteur(requete);
  /*
   * Avec un auteur, on pose a la BnF la question qu'elle sait le mieux traiter
   * — « quelles editions de ce texte, de cet auteur ? » — plutot qu'une
   * recherche par titre seul. C'est la meme requete que l'ecran des editions.
   */
  const precise = String(auteur || '').trim();
  if (precise) return bnf.rechercherEditions(requete, precise);
  return bnf.rechercherParTitre(requete);
}

/* Le chemin reseau, inchange — extrait pour que `rechercher` ne fasse plus que
 * decider entre le vif, le cache et l'archive. */
async function interroger(requete, mode, page = 0, auteur = '') {
  let resultats;
  if (mode === 'auteur') {
    resultats = await google.rechercherParAuteur(requete, page);
  } else if (mode === 'isbn') {
    const chiffres = requete.replace(/[^0-9Xx]/g, '');
    /*
     * Repli Open Library sur DEUX cas, pas un seul :
     *  - Google ne connait pas l'ISBN (zero resultat) ;
     *  - Google ne repond pas du tout (503 une fois sur deux, §4.7).
     * Le second cas manquait, et c'est celui qui frappe le plus souvent : une
     * panne passagere de Google rendait la recherche par ISBN inutilisable
     * alors qu'Open Library, lui, repondait.
     * Mesure honnete : sur huit ISBN francais testes, trois n'existent NI chez
     * Google NI chez Open Library. L'autre moitie de la reponse est la saisie
     * manuelle (§3.2 prevoit l'empreinte locale pour « les vieux fonds,
     * l'autoedition et les livres non catalogues » ; encore faut-il pouvoir en
     * creer un).
     */
    let panneGoogle = null;
    try {
      resultats = await google.rechercherParIsbn(chiffres);
    } catch (e) {
      panneGoogle = e;
      resultats = [];
    }

    if (resultats.length === 0) {
      try {
        const secours = await ol.livreParIsbn(chiffres);
        if (secours) resultats = [secours];
      } catch { /* Open Library injoignable aussi */ }
    }

    /*
     * TROISIEME chance : la BnF (tranche 19). C'est le depot legal francais,
     * donc le catalogue le plus complet pour un livre achete en France — et
     * elle rattrape des ISBN que ni Google ni Open Library ne connaissent.
     * Verifie : sur trois ISBN francais absents de Google, elle en trouve un,
     * et elle repond aux trois ISBN de reference en 76 a 128 ms.
     * Piege traite dans la source : elle indexe les livres anterieurs a 2007
     * en ISBN-10, la conversion est faite la-bas.
     */
    if (resultats.length === 0) {
      try {
        const secours = await bnf.livreParIsbn(chiffres);
        if (secours) resultats = [secours];
      } catch { /* la BnF non plus */ }
    }

    // Les deux sources muettes ET Google en panne : c'est une panne, pas une
    // absence. Le message doit le dire, sinon l'utilisateur croit que son
    // livre n'existe pas.
    if (resultats.length === 0 && panneGoogle) throw panneGoogle;
  } else {
    resultats = await google.rechercherParTitre(requete, page, auteur);
  }

  return resultats;
}

// ---------------------------------------------------------------------------
// Archive persistante des recherches (tranche 10)
// ---------------------------------------------------------------------------

/*
 * `idb-keyval`, deja installe et deja utilise par db.js pour le cliche de la
 * base : aucune dependance nouvelle. Duree de vie 7 jours et non 30 minutes —
 * ce n'est pas un cache de performance (celui-la est en memoire, au-dessus),
 * c'est un filet contre une panne de source. Un resultat d'il y a trois jours
 * reste un bon resultat pour un catalogue de livres.
 */
const ARCHIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/*
 * Duree pendant laquelle une archive est servie SANS rappeler la source. Au
 * dela, elle reste utilisable en cas de panne (jusqu'a ARCHIVE_TTL_MS), mais
 * on prefere redemander.
 */
const ARCHIVE_FRAICHE_MS = 24 * 60 * 60 * 1000;
const PREFIXE_ARCHIVE = 'recherche:';

async function lireArchive(cle, duree = ARCHIVE_TTL_MS) {
  try {
    const { get } = await import('idb-keyval');
    const entree = await get(PREFIXE_ARCHIVE + cle);
    if (!entree || Date.now() - entree.pose > duree) return null;
    return entree;
  } catch {
    return null;   // IndexedDB indisponible : on n'a simplement pas de filet
  }
}

/*
 * HISTORIQUE DES RECHERCHES (retour d'usage 100 : « je ne vois pas mon
 * historique de recherche »). Douze entrees au plus, les plus recentes en
 * tete, sans doublon. C'est une commodite, pas une donnee du profil : elle vit
 * a cote de l'archive et ne part pas dans la sauvegarde.
 */
const CLE_HISTORIQUE = 'historiqueRecherches';
const MAX_HISTORIQUE = 12;

export async function historiqueRecherches() {
  try {
    const { get } = await import('idb-keyval');
    return (await get(CLE_HISTORIQUE)) || [];
  } catch {
    return [];
  }
}

export async function oublierHistorique() {
  try {
    const { del } = await import('idb-keyval');
    await del(CLE_HISTORIQUE);
  } catch { /* rien a oublier */ }
}

async function noterDansHistorique(texte, mode) {
  try {
    const { get, set } = await import('idb-keyval');
    const avant = (await get(CLE_HISTORIQUE)) || [];
    const sansDoublon = avant.filter((e) => !(e.mode === mode && e.texte === texte));
    await set(CLE_HISTORIQUE, [{ texte, mode, pose: Date.now() }, ...sansDoublon].slice(0, MAX_HISTORIQUE));
  } catch { /* l'historique n'est jamais une raison d'echouer */ }
}

async function ecrireArchive(cle, pose, resultats) {
  try {
    const { set } = await import('idb-keyval');
    await set(PREFIXE_ARCHIVE + cle, { pose, resultats });
  } catch { /* ecrire l'archive n'est jamais une raison d'echouer */ }
}

// ---------------------------------------------------------------------------
// LA NOTORIETE SE GARDE LONGTEMPS (mission V2, M3)
// ---------------------------------------------------------------------------

/*
 * POURQUOI UN CACHE A PART, ET SI LONG.
 *
 * Open Library n'a ni cle ni quota — mais elle n'a pas non plus d'engagement
 * de service, et c'est mesure, pas suppose. Le 2026-08-28, sur une fenetre
 * degradee : 2 reponses sur 12 a une requete triviale espacee de 20 s. Le
 * meme jour, en fenetre normale : mediane 479 ms. Autrement dit, le classement
 * d'une recherche dependait de l'humeur du service AU MOMENT PRECIS ou on
 * tapait — sur un lancement du banc, « game of thrones » etait la seule des
 * sept a ne rien recevoir, et donc la seule a rester mal classee.
 *
 * SEPT JOURS, et non les 24 h de l'archive de recherche. Ce qu'on garde ici
 * n'est pas un catalogue : c'est le fait que Martin ecrit « Game of Thrones »
 * et Werber « Les fourmis ». Cela ne change pas d'une semaine a l'autre. Une
 * notoriete d'hier vaut donc exactement une notoriete d'aujourd'hui, alors
 * qu'une liste de resultats vieillit.
 *
 * ET SURTOUT : EN PANNE, ON RESSORT LA PERIMEE. C'est tout l'interet. Une
 * notoriete de la semaine derniere classe aussi bien que celle de maintenant,
 * et infiniment mieux que rien. C'est la meme regle que l'archive de recherche
 * (tranche 10) — « mieux vaut des resultats d'hier qu'un ecran vide » —
 * appliquee a une donnee qui, elle, ne se perime pratiquement pas.
 */
const NOTORIETE_FRAICHE_MS = 7 * 24 * 60 * 60 * 1000;

/*
 * LES ECHECS SE MEMORISENT EN MEMOIRE, ET DEUX MINUTES.
 *
 * Il en faut un : depuis que le classement se recalcule a l'affichage (M2),
 * CHAQUE recherche demande la notoriete — y compris celles servies depuis le
 * cache. Sans cela, une recherche repetee pendant qu'Open Library est muette
 * la rappelle a chaque fois.
 *
 * Mais PAS sur disque, et PAS longtemps. Premiere version ecrite le
 * 2026-08-30 : l'echec etait archive une heure. Verifie dans l'application
 * immediatement apres — « harry potter » a rendu trois essais devant Rowling,
 * parce qu'UN appel lent avait ete enregistre comme « rien a dire » et gelait
 * le classement pour l'heure suivante. Open Library repondait pourtant en
 * 535 ms a la requete suivante.
 *
 * Deux enseignements, appliques ici :
 *  - un echec n'est pas une donnee : il ne va pas dans le stockage durable,
 *    il meurt avec la session ;
 *  - deux minutes suffisent a ne pas harceler la source ; au-dela, mieux vaut
 *    retenter, parce que ses pannes sont courtes et frequentes.
 */
const NOTORIETE_ECHEC_MS = 2 * 60 * 1000;
const echecsNotoriete = new Map();
const PREFIXE_NOTORIETE = 'notoriete:';

async function lireNotoriete(cle, duree) {
  try {
    const { get } = await import('idb-keyval');
    const entree = await get(PREFIXE_NOTORIETE + cle);
    if (!entree) return null;
    if (duree !== Infinity && Date.now() - entree.pose > duree) return null;
    return entree.oeuvres || [];
  } catch {
    return null;   // IndexedDB indisponible : on demandera a la source
  }
}

async function ecrireNotoriete(cle, oeuvres) {
  try {
    const { set } = await import('idb-keyval');
    await set(PREFIXE_NOTORIETE + cle, { pose: Date.now(), oeuvres });
  } catch { /* ecrire le cache n'est jamais une raison d'echouer */ }
}

/**
 * Les oeuvres notoires d'une recherche : du cache si possible, de la source
 * sinon, du cache PERIME en dernier recours.
 * Ne rejette jamais : l'absence d'ordre n'est pas une panne.
 */
async function notorieteDe(requete) {
  const cle = requete.trim().toLowerCase();

  const fraiche = await lireNotoriete(cle, NOTORIETE_FRAICHE_MS);
  if (fraiche && fraiche.length) return fraiche;

  // Un echec tout recent : on ne rappelle pas la source dans les deux minutes.
  const echec = echecsNotoriete.get(cle);
  if (echec && Date.now() - echec < NOTORIETE_ECHEC_MS) return [];

  try {
    const oeuvres = await ol.oeuvresNotoires(requete);
    if (oeuvres.length) {
      echecsNotoriete.delete(cle);
      void ecrireNotoriete(cle, oeuvres);
      return oeuvres;
    }
    // Une reponse vide n'est pas une reponse : on la traite comme un echec,
    // et surtout on ne l'ecrit PAS sur disque.
    echecsNotoriete.set(cle, Date.now());
    return [];
  } catch {
    /*
     * Panne. Une notoriete PERIMEE vaut infiniment mieux que rien — Martin
     * ecrivait deja « Game of Thrones » la semaine derniere.
     */
    const vieux = await lireNotoriete(cle, Infinity);
    if (vieux && vieux.length) return vieux;
    echecsNotoriete.set(cle, Date.now());
    return [];
  }
}

/**
 * LES EDITIONS D'UN LIVRE — celles qu'on pourrait posseder (§3.1).
 *
 * Retour d'usage 109 : « j'aimerais que les editions associees s'affichent et
 * qu'on puisse choisir celle qu'on a ». Jusqu'ici il fallait les CHERCHER a la
 * main, une par une, en tapant leur titre.
 *
 * La BnF passe ICI EN PREMIER, contrairement a la recherche generale ou elle
 * n'est qu'un filet. C'est le seul endroit ou elle est meilleure que Google, et
 * la mesure est nette (2026-08-26) : « les fourmis » + « werber » y rend
 * DOUZE editions francaises avec editeur, annee et ISBN — France Loisirs,
 * Albin Michel, Livre de Poche… — en 1,3 s. C'est precisement la question
 * qu'on lui pose : « quelles editions de ce texte existent en France ? »
 * Google, lui, melange les tomes et les livres qui PARLENT de l'oeuvre.
 *
 * Open Library a ete mesure puis ecarte pour cet usage : /works/{id}/editions
 * rend 161 a 252 editions en 7,5 a 8,4 s, toutes langues confondues — de
 * l'italien, du portugais, du polonais, de l'hebreu. Inutilisable pour
 * quelqu'un qui cherche l'exemplaire pose sur son etagere.
 *
 * @returns {Promise<ResultatRecherche[]>}
 */
export async function editionsDe(titre, auteur) {
  const propre = String(titre || '').split(':')[0].trim();
  if (!propre) return [];

  let trouvees = [];
  try {
    trouvees = await bnf.rechercherEditions(propre, auteur);
  } catch { /* la BnF ne repond pas : Google prendra le relais */ }

  /*
   * Repli Google — indispensable pour un livre etranger non traduit, dont la
   * BnF n'a aucune trace.
   */
  if (trouvees.length === 0) {
    try {
      const requete = auteur ? `${propre} ${auteur}` : propre;
      trouvees = await google.rechercherParTitre(requete);
    } catch { /* aucune source : la fiche le dira */ }
  }

  return trouvees.map(avecCouvertureDeRepli);
}

/**
 * Résout l'identité d'œuvre d'un résultat (§3.2). Ne bloque JAMAIS : une
 * résolution impossible rend une empreinte locale, pas une erreur.
 * @param {ResultatRecherche} resultat
 * @returns {Promise<Identite>}
 */
export async function identifier(resultat, budgetMs = BUDGET_INTERACTIF_MS) {
  const enCache = cacheIdentite.get(resultat.cleSource);
  const frais = enCache && Date.now() - enCache.pose < CACHE_TTL_MS;

  if (frais) {
    // Une identite RESOLUE est definitive.
    if (enCache.identite.resolue) return enCache.identite;
    // Un echec ne vaut que pour le temps qu'on lui a laisse : retenter n'a de
    // sens qu'avec PLUS de temps (c'est le cas de la reprise en tache de fond).
    if (budgetMs <= enCache.budget) return enCache.identite;
  }

  const identite = await resoudre(resultat, budgetMs);
  cacheIdentite.set(resultat.cleSource, { pose: Date.now(), identite, budget: budgetMs });
  return identite;
}

/** Identite deja connue, sans aucun appel. Rend null si on ne sait pas encore. */
export function identiteConnue(cleSource) {
  const enCache = cacheIdentite.get(cleSource);
  return enCache && enCache.identite.resolue ? enCache.identite : null;
}

/** Empreinte locale immediate, pour entrer en base sans attendre le reseau. */
export function identiteImmediate(resultat) {
  return {
    oeuvreId: empreinteOeuvre(resultat.titre, resultat.auteurs),
    resolue: false,
    cycleNom: null,
    cycleTome: null,
    nbPages: resultat.nbPages,
    couvertureUrl: resultat.couvertureUrl,
  };
}

async function resoudre(resultat, budgetMs) {
  const repli = {
    oeuvreId: empreinteOeuvre(resultat.titre, resultat.auteurs),
    resolue: false,
    cycleNom: null,
    cycleTome: null,
    nbPages: resultat.nbPages,
    couvertureUrl: resultat.couvertureUrl,
  };

  try {
    /*
     * CASCADE, et non alternative. Corrigé après mesure sur appels réels :
     * §3.2 présentait l'ISBN comme « le chemin normal » et la recherche comme
     * le cas des livres sans ISBN. C'est faux pour l'édition française —
     * beaucoup d'ISBN français répondent 404 chez Open Library
     * (9782221127520 et 9782744131929 par exemple, tous deux chez Google).
     * Prendre l'ISBN comme chemin exclusif faisait donc tomber en empreinte
     * locale des livres qu'une simple recherche identifie très bien.
     * Ordre : ISBN, puis recherche titre+auteur, puis seulement l'empreinte.
     */
    const isbn = resultat.isbn13 || resultat.isbn10;

    let identite = isbn ? await ol.identiteParIsbn(isbn, budgetMs) : null;
    if (!identite || !identite.oeuvreId) {
      identite = await ol.identiteParRecherche(resultat.titre, resultat.auteurs[0], budgetMs);
    }

    if (!identite || !identite.oeuvreId) return repli;

    return {
      ...identite,
      // Cascade de pagination §5.4 : exact d'Open Library d'abord, Google ensuite.
      nbPages: identite.nbPages || resultat.nbPages,
      couvertureUrl: resultat.couvertureUrl || identite.couvertureUrl,
    };
  } catch {
    // Open Library injoignable : l'application continue en empreinte locale et
    // signalera « identification incomplète » dans la fiche (§4.3).
    return repli;
  }
}

// ---------------------------------------------------------------------------
// Suggestions (§4.6)
// ---------------------------------------------------------------------------

const MAX_GRAINES = 6;
const MAX_CYCLES = 3;
const COUPE = 20;

/*
 * Budget d'appels, calculé et non subi : 6 graines × 2 requêtes + 3 cycles au
 * plus = 15 appels par actualisation. Le contexte prévoyait 12 graines (24
 * appels), chiffre hérité de TMDB qui n'a AUCUN quota journalier ; Google en a
 * un de 1 000, partagé par tous les porteurs de la clé (arbitrage 17).
 * Chaque appel est enveloppé : une graine qui échoue ne casse pas l'écran.
 */
export async function suggestions(graines, cycles, exclusions, cleCache) {
  /*
   * CACHE JOURNALIER (§4.6 point 6, tranche 12). Une actualisation coute
   * jusqu'a 15 des 1 000 requetes quotidiennes : une poignee de clics suffit
   * a entamer serieusement la journee, et l'utilisateur n'a aucun moyen de
   * le savoir. Or le resultat ne change PAS tant que la bibliotheque ne
   * change pas — les memes graines produisent les memes suggestions.
   * La cle porte donc l'empreinte des graines : marquer un livre « lu »
   * invalide le cache tout seul, sans bouton ni reglage.
   */
  if (cleCache) {
    const garde = await lireSuggestions(cleCache);
    if (garde) return garde;
  }

  const lots = [];

  for (const g of graines.slice(0, MAX_GRAINES)) {
    const auteur = (g.auteurs || '').split(',')[0].trim();
    const sujet = (g.categories || '').split(',')[0].trim();
    if (auteur) {
      lots.push(google.rechercherParAuteur(auteur)
        .then((r) => ({ raison: `Parce que vous avez lu ${g.titre}`, resultats: r }))
        .catch(() => ({ raison: '', resultats: [] })));
    }
    if (sujet) {
      lots.push(google.rechercherParSujet(sujet)
        .then((r) => ({ raison: `Dans le même genre que ${g.titre}`, resultats: r }))
        .catch(() => ({ raison: '', resultats: [] })));
    }
  }

  /*
   * Tome suivant — §4.6 point 5. On propose une RECHERCHE du tome n+1, on
   * n'affirme jamais qu'il existe : si la recherche ne rend rien, aucune carte
   * n'apparaît. C'est la différence entre suggérer et inventer.
   */
  for (const c of cycles.slice(0, MAX_CYCLES)) {
    lots.push(google.rechercherParTitre(`${c.nom} tome ${c.tomeSuivant}`)
      .then((r) => ({ raison: `Suite de ${c.nom}, tome ${c.tomeSuivant}`, resultats: r }))
      .catch(() => ({ raison: '', resultats: [] })));
  }

  const reponses = await Promise.all(lots);

  /*
   * Exclusion de ce qu'on possède déjà. §4.6 dit « par oeuvre_id ET par
   * ISBN » — mais l'identifiant d'œuvre d'un résultat n'est PAS connu sans un
   * appel Open Library par résultat, ce que §4.3 interdit. L'empreinte locale
   * en tient lieu : elle se calcule hors ligne sur le titre et l'auteur.
   */
  const parCle = new Map();
  let rang = 0;

  reponses.forEach(({ raison, resultats }) => {
    const vus = new Set();
    resultats.forEach((r) => {
      const empreinte = empreinteOeuvre(r.titre, r.auteurs);
      if (exclusions.empreintes.has(empreinte)) return;
      if (r.isbn13 && exclusions.isbn.has(r.isbn13)) return;
      if (vus.has(empreinte)) return;      // doublon dans la même réponse
      vus.add(empreinte);

      const existant = parCle.get(empreinte);
      if (existant) { existant.score += 1; return; }
      rang += 1;
      parCle.set(empreinte, { ...r, raison, score: 1, rang });
    });
  });

  // Tri par score, puis par ordre d'arrivée Google — qui est déjà un ordre de
  // pertinence. Aucune popularité n'est disponible (arbitrage 16, confirmé).
  const retenues = [...parCle.values()]
    .sort((a, b) => (b.score - a.score) || (a.rang - b.rang))
    .slice(0, COUPE);

  // Un lot vide ne se garde pas : il vient presque toujours d'une panne de
  // source, et le mettre en cache figerait un ecran vide pour la journee.
  if (cleCache && retenues.length) void ecrireSuggestions(cleCache, retenues);
  return retenues;
}

/*
 * Les suggestions vivent jusqu'a la fin de la JOURNEE, pas 7 jours comme
 * l'archive de recherche : elles sont une proposition de lecture, et en
 * revoir exactement les memes une semaine durant serait pire que de payer
 * quinze requetes.
 */
async function lireSuggestions(cle) {
  try {
    const { get } = await import('idb-keyval');
    const entree = await get('suggestions:' + cle);
    if (!entree || entree.jour !== jourCourant()) return null;
    return entree.resultats;
  } catch {
    return null;
  }
}

async function ecrireSuggestions(cle, resultats) {
  try {
    const { set } = await import('idb-keyval');
    await set('suggestions:' + cle, { jour: jourCourant(), resultats });
  } catch { /* sans cache, on paiera les requetes : degradation acceptable */ }
}

function jourCourant() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/*
 * Couverture de repli. Mesure du 2026-08-20 sur 100 resultats reels : Google
 * n'en illustre que 65 %. Des 35 manquantes, 24 portent un ISBN, et Open
 * Library en fournit environ deux sur cinq — de quoi passer d'environ 65 a
 * 75 % d'illustrations, sans un seul appel d'API supplementaire (c'est une
 * URL d'image, pas une requete de donnees).
 * `default=false` est indispensable : sans lui, Open Library rend une image
 * d'UN PIXEL avec un statut 200 quand la couverture n'existe pas.
 */
export function avecCouvertureDeRepli(resultat) {
  if (resultat.couvertureUrl) return resultat;
  const isbn = resultat.isbn13 || resultat.isbn10;
  if (!isbn) return resultat;
  return { ...resultat, couvertureUrl: ol.couvertureParIsbn(isbn) };
}

/**
 * Complète un résultat dont Google n'a pas donné le résumé, depuis la fiche
 * d'œuvre Open Library — même en anglais : un résumé anglais vaut mieux qu'un
 * vide, et on ne traduit pas (§9).
 * @returns {Promise<ResultatRecherche>}
 */
export async function completer(resultat, identite, budgetMs = BUDGET_RESUME_MS) {
  if (resultat.resume || !identite.resolue) return resultat;
  try {
    const enCache = cacheOeuvre.get(identite.oeuvreId);
    const frais = enCache && Date.now() - enCache.pose < CACHE_TTL_MS;

    const oeuvre = frais
      ? enCache.oeuvre
      : await ol.oeuvreParCle(identite.oeuvreId, budgetMs);
    if (!frais) cacheOeuvre.set(identite.oeuvreId, { pose: Date.now(), oeuvre });

    if (!oeuvre) return resultat;
    return {
      ...resultat,
      resume: oeuvre.resume || resultat.resume,
      categories: resultat.categories.length ? resultat.categories : oeuvre.categories,
      couvertureUrl: resultat.couvertureUrl || oeuvre.couvertureUrl,
    };
  } catch {
    return resultat;
  }
}
