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
import { numeroDeTome, scorePertinence } from './tomes.js';

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
function cleRegroupement(titre, auteurs, sousTitre = null) {
  const premier = Array.isArray(auteurs) ? auteurs[0] : auteurs;
  const nom = cleAuteur(premier);
  const t = normaliser(titre, false);
  if (!t || !nom) return null;
  const tome = numeroDeTome(`${titre || ''} ${sousTitre || ''}`);
  return `grp:${t}|${nom}|t${tome ?? ''}`;
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

  // 2. Le titre entier, l'auteur, le tome.
  const parTitre = new Map();
  liste.forEach((r) => {
    const cle = cleRegroupement(r.titre, r.auteurs, r.sousTitre);
    if (!cle) return;   // sans titre ou sans auteur : la fiche reste seule
    if (parTitre.has(cle)) unir(parTitre.get(cle), r.cleSource);
    else parTitre.set(cle, r.cleSource);
  });

  const groupes = new Map();
  liste.forEach((r) => {
    const g = racine(r.cleSource);
    if (!groupes.has(g)) groupes.set(g, []);
    groupes.get(g).push(r);
  });

  return [...groupes.values()].map((groupe) => fondre(groupe, requete));
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
  let base = groupe[0];
  let meilleur = scorePertinence(base, requete);
  groupe.slice(1).forEach((r) => {
    const note = scorePertinence(r, requete);
    if (note > meilleur) { base = r; meilleur = note; }
  });

  const fondu = { ...base, clesSource: [...new Set(groupe.flatMap(clesDe))] };

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

  const brut = await rechercherBrut(texte, mode, page, auteur);

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
  return {
    ...brut,
    nbSource: brut.resultats.length,
    resultats: fusionnerDoublons(classes, texte),
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

async function rechercherBrut(texte, mode, page = 0, auteur = '') {
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
  const completes = completerDepuisBnf(resultats, promesseBnf ? await promesseBnf : []);
  /*
   * On archive du BRUT : ni notoriete, ni fusion (M2). Elles se recalculent a
   * l'affichage, dans `rechercher`. Voir le commentaire la-bas.
   */
  const illustres = completes.map(avecCouvertureDeRepli);
  const pose = Date.now();
  cacheRecherche.set(cle, { pose, resultats: illustres });
  // Volontairement non attendu : archiver ne doit pas retarder l'affichage.
  if (illustres.length) void ecrireArchive(cle, pose, illustres);
  if (illustres.length && page === 0) void noterDansHistorique(requete, mode);
  return { resultats: illustres, ancien: false, pose };
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

  const parEmpreinte = new Map();
  notices.forEach((n) => {
    const auteur = Array.isArray(n.auteurs) ? n.auteurs[0] : n.auteurs;
    if (!n.titre || !auteur) return;
    // Meme cle lache qu'a la fusion : la BnF ecrit « Zola, Emile » la ou
    // Google ecrit « Emile Zola », et l'ordre du nom ne doit pas empecher le
    // rapprochement.
    const cle = cleRegroupement(n.titre, n.auteurs, n.sousTitre);
    if (!cle) return;
    // La PREMIERE notice gagne : la BnF rend ses editions de la plus proche a
    // la plus lointaine, et prendre la derniere donnerait l'edition la plus
    // obscure du lot.
    if (!parEmpreinte.has(cle)) parEmpreinte.set(cle, n);
  });

  return (resultats || []).map((r) => {
    const auteur = Array.isArray(r.auteurs) ? r.auteurs[0] : r.auteurs;
    if (!r.titre || !auteur) return r;
    const cleR = cleRegroupement(r.titre, r.auteurs, r.sousTitre);
    const notice = cleR ? parEmpreinte.get(cleR) : null;
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
  const parAuteur = new Map();
  oeuvres.forEach((o, rang) => {
    (o.auteurs || []).forEach((nom) => {
      const cle = cleAuteur(nom);
      if (!cle) return;
      // Un auteur peut porter plusieurs oeuvres de la reponse (Martin en a six
      // sur dix). On garde la MIEUX CLASSEE : c'est elle qui dit la place de
      // l'ecrivain dans la reponse a cette recherche.
      const connu = parAuteur.get(cle);
      if (!connu || rang < connu.rang) parAuteur.set(cle, { rang, lecteurs: o.lecteurs });
    });
  });
  if (parAuteur.size === 0) return resultats || [];

  return (resultats || []).map((r) => {
    // Un livre a plusieurs auteurs : le mieux classe decide. Une edition
    // annotee « Zola, Emile / Untel » ne doit pas perdre Zola en chemin.
    let meilleur = null;
    (r.auteurs || []).forEach((nom) => {
      const trouve = parAuteur.get(cleAuteur(nom));
      if (trouve && (!meilleur || trouve.rang < meilleur.rang)) meilleur = trouve;
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
