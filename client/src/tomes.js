/*
 * tomes.js — reconnaitre le numero de tome dans un titre, et remettre une
 * saga dans l'ordre.
 *
 * Retour d'usage 101 : « j'ai une saga de 5 tomes a la maison, il n'en voit
 * qu'un ». Mesure du 2026-08-25 : les tomes sont bien rendus par Google, mais
 * DANS UN DESORDRE COMPLET et noyes parmi des resultats sans numero. Pour
 * « La Quete d'Ewilan », l'ordre d'arrivee etait :
 *
 *     - 1 - - - 2 3 1 - 5 2 7 - 6 - 2 - - 7 4
 *
 * Personne ne peut y lire une serie. Les tomes n'etaient pas absents : ils
 * etaient illisibles. C'est un probleme de PRESENTATION, pas de catalogue.
 *
 * Fonctions pures : aucun etat, aucun rendu, aucun reseau.
 */

import { cleAuteur as cleEcrivain } from './auteurs.js';

/*
 * Un numero de tome doit etre ANNONCE par un mot : tome, t., livre, volume,
 * vol., cycle — ou entre parentheses en fin de titre. Sans cette exigence,
 * « 1984 » deviendrait le tome 1984, et « Harry Potter » suivi d'un chiffre
 * quelconque serait mal range. On prefere manquer un tome que d'en inventer.
 */
const MOTIFS = [
  /\b(?:tome|livre|volume)\s*0*(\d{1,3})\b/i,
  // « T5 », « T. 5 », « T01 ». La MAJUSCULE est exigee : un « t » minuscule
  // apparait dans trop de mots courants pour qu'on puisse s'y fier.
  /\bT\.?\s*0*(\d{1,3})\b/,
  /\bvol\.?\s*0*(\d{1,3})\b/i,
  /\((\d{1,3})\)\s*$/,               // « Le Trone de Fer (3) »
  /#(\d{1,3})\b/,

  /*
   * LES FORMES DE LA BnF (2026-08-30). Elle n'ecrit JAMAIS « tome » : elle
   * pose le numero apres un point ou une virgule, suivi du sous-titre.
   *   « Le trone de fer. 1 : roman »
   *   « Le Seigneur des anneaux. 4, Appendices et index »
   *   « La Passe-miroir : la tempete des echos. 4 »
   *   « La Passe-miroir, 1 »
   * Mesure : le lecteur en ratait CENT POUR CENT — 0 tome reconnu sur les
   * 20 notices de chaque saga, alors que 17 y etaient ecrits noir sur blanc.
   *
   * La ponctuation est EXIGEE avant le chiffre, et le chiffre doit finir le
   * titre ou introduire un sous-titre. Sans cette exigence, une annee ou un
   * nombre quelconque en fin de titre deviendrait un tome. Le garde-fou de
   * 1 a 200 reste par-dessus.
   */
  /[.,]\s*0*(\d{1,3})\s*(?:[:,]|$)/,
];

/*
 * Le chiffre ROMAIN apres une ponctuation : « La Passe-miroir, II : Les
 * disparus du Clairdelune ». A part, parce qu'une expression reguliere ne
 * sait pas convertir. Jusqu'a X seulement : au-dela aucune saga ne les
 * utilise, et les sigles commencent a s'y confondre.
 */
const ROMAINS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};
const MOTIF_ROMAIN = /[.,]\s*([ivx]{1,4})\s*(?:[:,]|$)/i;

/**
 * Numero de tome lu dans un titre, ou null.
 * @param {string} titre
 * @returns {number|null}
 */
export function numeroDeTome(titre) {
  const t = String(titre || '');
  for (const motif of MOTIFS) {
    const m = t.match(motif);
    if (m) {
      const n = Number(m[1]);
      // Un tome 0 n'existe pas, et au-dela de 200 c'est une annee ou un prix.
      if (n >= 1 && n <= 200) return n;
    }
  }
  const rom = t.match(MOTIF_ROMAIN);
  if (rom) {
    const n = ROMAINS[rom[1].toLowerCase()];
    if (n) return n;
  }
  return null;
}

/**
 * Separe les resultats en « une serie, dans l'ordre » et « le reste ».
 *
 * Le seuil de TROIS tomes est deliberé : avec deux, on peut tomber sur deux
 * livres sans rapport qui portent un numero. A partir de trois, c'est une
 * serie, et l'utilisateur a besoin de la voir ordonnee.
 *
 * @returns {{tomes: Array, autres: Array}} `tomes` vide si ce n'est pas une serie
 */
/*
 * LE NOM DE LA SERIE, lu dans le titre d'un tome (correction 2).
 * « La Quete d'Ewilan - Tome 01 » -> « La Quete d'Ewilan ».
 * On coupe A PARTIR du marqueur de tome et on jette ce qui suit : le
 * sous-titre du tome (« La glace et le feu ») nomme l'episode, pas la serie.
 */
export function nomDeSerie(titre) {
  return String(titre || '')
    .replace(/[-–—,:]?\s*\b(?:tome|livre|volume|vol\.?|t\.?)\s*0*\d{1,3}\b[\s\S]*$/i, '')
    .replace(/\s*\(\d{1,3}\)\s*$/, '')
    .replace(/\s*#\d{1,3}\b[\s\S]*$/, '')
    // « Le Trone de Fer (Tome 3) - La bataille des rois » laisse une
    // parenthese ouvrante orpheline : elle part avec le reste.
    .replace(/[\s\-–—,:.([]+$/, '')
    .trim();
}

function cleDeSerie(titre) {
  return comparable(nomDeSerie(titre)).replace(/ /g, '-');
}

/*
 * LE TOME ET LE NOM DE SERIE D'UN RESULTAT — tranche 33, chantier 3.
 *
 * Retour d'usage : « Harry Potter, aucun tome ne s'affiche ». Cause : les
 * titres francais n'ecrivent jamais « tome N » (« Harry Potter et la Coupe de
 * Feu »). Le texte ne porte rien a lire — ce module ne peut pas l'inventer
 * (§4.4). `books.js` sait, lui, aller lire le meme champ `series` qu'Open
 * Library expose deja a l'ajout (§3.2), et pose `cycleTome`/`cycleNom` sur la
 * carte quand le titre est resté muet. On ne s'en sert ICI qu'en dernier
 * recours, jamais avant le texte : un titre qui ecrit son tome fait
 * toujours foi sur lui-meme.
 */
function cleEtNomDeSerie(r) {
  const nTexte = numeroDeTome(r.titre);
  if (nTexte !== null) {
    return { tome: nTexte, nom: nomDeSerie(r.titre), cle: cleDeSerie(r.titre) };
  }
  if (Number.isInteger(r.cycleTome) && r.cycleNom) {
    return { tome: r.cycleTome, nom: r.cycleNom, cle: comparable(r.cycleNom).replace(/ /g, '-') };
  }
  return { tome: null, nom: '', cle: '' };
}

/**
 * Separe les resultats en SERIES NOMMEES et « le reste ».
 *
 * Reecrit apres l'audit du 2026-08-27. La version precedente collectait tout
 * titre portant un numero, SANS REGARDER DE QUELLE SERIE il s'agissait, et
 * appelait le tas « La serie, dans l'ordre ». Deux consequences mesurees :
 *
 *  - « la quete d'Ewilan » assemblait en une seule « serie » les tomes 1 de
 *    « La Quete d'Ewilan », des « Mondes d'Ewilan » et de « L'Autre » ;
 *  - « game of thrones » melait la bande dessinee « La Bataille des rois » et
 *    les romans « Le Trone de fer », et installait la BD en tete d'ecran.
 *
 * On groupe donc par NOM de serie, et chaque serie s'annonce par le sien.
 *
 * Le seuil de TROIS tomes distincts est conserve, mais il s'applique
 * desormais PAR SERIE : deux tomes peuvent etre deux livres sans rapport, trois
 * tomes du meme titre sont une serie.
 *
 * @returns {{series: Array<{cle: string, nom: string, tomes: Array}>, autres: Array}}
 */
export function separerLesTomes(resultats) {
  const parSerie = new Map();
  const sansNumero = [];

  (resultats || []).forEach((r) => {
    const { tome: n, nom, cle } = cleEtNomDeSerie(r);
    // Un titre qui n'est QUE « Tome 3 » ne nomme aucune serie : il rejoint le
    // reste plutot que de fonder une serie anonyme.
    if (n === null || !cle) { sansNumero.push(r); return; }
    if (!parSerie.has(cle)) parSerie.set(cle, []);
    parSerie.get(cle).push({ ...r, tome: n, nomSerie: nom });
  });

  const series = [];
  const autres = [...sansNumero];

  parSerie.forEach((tomes, cle) => {
    const distincts = new Set(tomes.map((t) => t.tome));
    if (distincts.size < 3) { autres.push(...tomes); return; }
    /*
     * Tri par numero, puis par ordre d'arrivee — qui est deja un ordre de
     * pertinence. Deux editions du meme tome restent voisines, la meilleure
     * en premier.
     */
    series.push({ cle, nom: tomes[0].nomSerie, tomes: [...tomes].sort((a, b) => a.tome - b.tome) });
  });

  return { series, autres };
}

/**
 * L'ORDRE DE L'ECRAN : series et livres isoles dans une seule suite, classes
 * par pertinence (correction 2).
 *
 * Le bloc « serie » passait AVANT TOUT le reste, quoi qu'il contienne. Sur
 * « game of thrones », il installait donc une bande dessinee au-dessus du
 * roman de Martin — c'est-a-dire tout en haut d'un ecran ou l'utilisateur
 * cherchait justement le roman.
 *
 * Une serie vaut desormais ce que vaut son MEILLEUR tome. Elle passe devant si
 * elle le merite, et derriere sinon.
 *
 * @returns {Array<{type: 'serie', nom: string, tomes: Array}|{type: 'livres', livres: Array}>}
 *   les livres isoles consecutifs sont rassembles en une seule grille.
 */
export function organiserLEcran(resultats, requete) {
  const { series, autres } = separerLesTomes(resultats || []);

  // Etape 6 : le niveau passe avant la note (1000 points de plus par niveau).
  // Par identifiant : les tomes d'une serie sont des COPIES des cartes, le niveau
  // ne se retrouverait pas par identite d'objet.
  const niveauParCle = new Map();
  niveauxDeRecherche(resultats || [], requete).forEach((niveau, r) => niveauParCle.set(r.cleSource, niveau));
  // Le niveau d'abord, puis le rang de l'auteur chez Open Library (etape 8), puis
  // la note : 100 000 points par niveau, 1 000 par rang, la note reste sous 300.
  const malus = (r) => (niveauParCle.get(r.cleSource) || 0) * 100000 + rangDe(r) * 1000;

  const blocs = [
    ...series.map((s) => ({
      bloc: { type: 'serie', cle: s.cle, nom: s.nom, tomes: s.tomes },
      note: Math.max(...s.tomes.map((t) => scorePertinence(t, requete) - malus(t))),
    })),
    ...autres.map((r) => ({ bloc: { type: 'livre', livre: r }, note: scorePertinence(r, requete) - malus(r) })),
  ];

  // Sans requete, l'ordre d'arrivee fait foi (mode Auteur) : on ne classe pas.
  if (comparable(requete)) blocs.sort((a, b) => b.note - a.note);

  // Les livres isoles qui se suivent forment une seule grille.
  const suite = [];
  blocs.forEach(({ bloc }) => {
    if (bloc.type === 'serie') { suite.push(bloc); return; }
    const dernier = suite[suite.length - 1];
    if (dernier && dernier.type === 'livres') dernier.livres.push(bloc.livre);
    else suite.push({ type: 'livres', livres: [bloc.livre] });
  });
  return suite;
}

/*
 * Combien de tomes DIFFERENTS dans ces resultats ? Sert a repérer une serie
 * PRESSENTIE : deux tomes ne suffisent pas a l'affirmer, mais suffisent a
 * aller regarder la page suivante.
 */
export function nombreDeTomes(resultats) {
  const vus = new Set();
  (resultats || []).forEach((r) => {
    const { tome: n } = cleEtNomDeSerie(r);
    if (n !== null) vus.add(n);
  });
  return vus.size;
}

/**
 * Faut-il aller chercher la page suivante pour confirmer une serie ?
 *
 * Retour d'usage 116 : « en cherchant game of thrones, a un moment tout en
 * haut apparait un bloc "La serie dans l'ordre" avec les bons livres, trop
 * bien, mais pourquoi il n'apparait pas depuis le debut ? »
 *
 * Mesure du 2026-08-26 : la premiere page de « game of thrones » ne contient
 * que DEUX tomes — le reste est constitue d'essais SUR la serie (« une
 * metaphysique des meurtres », « le livre des festins », « comprendre le
 * leadership avec la serie »). Le seuil de trois n'etait donc atteint qu'en
 * page 2, c'est-a-dire apres deux defilements : le bloc surgissait alors en
 * haut et tout se reorganisait sous les yeux de l'utilisateur.
 *
 * On va donc chercher la confirmation TOUT DE SUITE, mais seulement quand il
 * y a lieu : deux tomes vus, trois pas encore atteints. Une requete de plus,
 * dans ce cas precis, et le bloc apparait en une seconde au lieu de surgir
 * plus tard.
 */
export function serieAConfirmer(resultats) {
  const n = nombreDeTomes(resultats);
  return n === 2;
}

/*
 * TRIER DES RESULTATS DE RECHERCHE (retour d'usage 120 : « j'aimerais pouvoir
 * trier par pertinence ou date de sortie »).
 *
 * Le tri se fait ICI, dans l'application, et non chez Google : mesure du
 * 2026-08-26, `orderBy=newest` rend EXACTEMENT le meme ordre que par defaut —
 * memes titres, memes annees. Google ignore la consigne. Comme on a deja
 * l'annee de chaque livre, trier soi-meme est instantane et fiable.
 */
export const TRIS = [
  { cle: 'pertinence', libelle: 'Pertinence' },
  { cle: 'recent', libelle: 'Plus récent' },
];

/** Annee comparable d'un resultat, ou 0 s'il n'en a pas. */
function anneeDe(r) {
  const brut = r.datePublication || r.annee || '';
  const m = String(brut).match(/(\d{4})/);
  return m ? Number(m[1]) : 0;
}

// ---------------------------------------------------------------------------
// PERTINENCE (retour d'usage 121, tranche 1)
// ---------------------------------------------------------------------------

/*
 * « La recherche me propose en premier des choix peu pertinents, je dois
 * defiler pour voir ce que je cherche. »
 *
 * Constat : personne ne jugeait la pertinence a part Google. `intitle:` rend
 * vingt volumes, l'ecran les affichait DANS L'ORDRE D'ARRIVEE, et le tri dit
 * « Pertinence » ne faisait rien du tout. Google range devant des essais SUR
 * une oeuvre plutot que l'oeuvre — « game of thrones » rend « une
 * metaphysique des meurtres », « le livre des festins », « comprendre le
 * leadership avec la serie ».
 *
 * On classe donc nous-memes. Trois choses, par ordre d'importance :
 *  1. le TITRE colle-t-il a ce qui a ete tape ;
 *  2. la fiche est-elle SERIEUSE — un livre qui porte auteur, ISBN, editeur et
 *     couverture est une vraie edition, pas une notice fantome ;
 *  3. est-elle en francais.
 *
 * Et une penalite : un titre nettement plus long que la recherche est la
 * signature de l'essai et de l'analyse.
 *
 * Le score CLASSE, il ne filtre jamais : aucun resultat ne disparait, ils
 * changent seulement d'ordre. Aucun appel reseau, aucune donnee nouvelle —
 * tout ce qui sert est deja dans le resultat.
 */

/*
 * Normalisation de COMPARAISON, a ne pas confondre avec l'empreinte d'oeuvre
 * de books.js. Celle-la ecrase la ponctuation en tirets et coupe le
 * sous-titre pour fabriquer une CLE ; celle-ci garde les mots separes par des
 * espaces, parce qu'on a besoin de compter les mots et de tester un debut de
 * chaine. Deux besoins differents, deux fonctions — les melanger casserait la
 * deduplication sans bruit.
 */
function comparable(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mots(texte) {
  return texte ? texte.split(' ').filter(Boolean) : [];
}

/*
 * L'ARTICLE DE TETE NE COMPTE PAS. Verifie sur appels reels le 2026-08-27 :
 * une recherche « game of thrones » rendait le roman de Martin — intitule
 * « A Game of Thrones » — EN DERNIER, derriere une dizaine d'essais. Il ne
 * ratait la correspondance exacte que d'un « A ».
 * Personne ne tape l'article de tete, et aucune source ne s'accorde sur sa
 * presence : on le retire des DEUX cotes avant de comparer.
 */
const ARTICLES = new Set(['a', 'an', 'the', 'le', 'la', 'les', 'l', 'un', 'une', 'des']);

function sansArticle(texte) {
  const m = mots(texte);
  return m.length > 1 && ARTICLES.has(m[0]) ? m.slice(1).join(' ') : texte;
}

/*
 * Ce que vaut la correspondance du titre, de 0 a 100. Le titre EXACT domine
 * tout le reste : c'est le cas ou l'utilisateur sait ce qu'il cherche, et
 * c'est celui qui doit arriver en tete.
 */
function correspondance(titreBrut, requeteBrute) {
  if (!requeteBrute) return 0;
  const titre = sansArticle(titreBrut);
  const requete = sansArticle(requeteBrute);

  if (titre === requete) return 100;
  if (titre.startsWith(`${requete} `)) return 70;
  if (titre.includes(requete)) return 40;

  // Pas la phrase entiere, mais peut-etre tous ses mots (« ewilan quete »).
  const cherches = mots(requete);
  if (cherches.length === 0) return 0;
  const presents = mots(titre);
  const trouves = cherches.filter((m) => presents.includes(m)).length;
  return Math.round(25 * (trouves / cherches.length));
}

/*
 * Penalite de longueur. On compte les mots EN TROP par rapport a la recherche,
 * sous-titre compris — c'est la que se cache la plus grosse part du bruit :
 * Google range « une metaphysique des meurtres » en sous-titre, pas en titre,
 * et sans cela l'essai obtenait le score d'une correspondance exacte.
 * Plafonnee a 40 : une correspondance exacte propre (100) reste toujours
 * devant une correspondance exacte noyee sous un sous-titre (60).
 */
function penaliteLongueur(brut, requete) {
  if (!requete) return 0;
  /*
   * LES MOTS SE COMPTENT SUR LE TITRE BRUT, pas sur sa reduction latine.
   * Defaut livre en tranche 1 et corrige ici : `comparable()` remplace tout ce
   * qui n'est ni lettre latine ni chiffre par des espaces. Un titre en
   * cyrillique perd donc TOUS ses mots avant d'etre compte.
   * Mesure du 2026-08-27 sur « germinal », trois pages chargees : l'edition
   * « Germinal / Жерминаль. Книга для чтения с комментариями » se reduisait au
   * seul mot « germinal », decrochait le score d'une correspondance parfaite,
   * n'ecopait d'aucune penalite — et arrivait PREMIERE. Le classement changeait
   * donc sous les yeux de l'utilisateur au fil du defilement.
   * Compter les mots avant reduction remet ce titre a sa place.
   */
  const enTrop = String(brut || '').trim().split(/\s+/).filter(Boolean).length
    - mots(requete).length;
  if (enTrop <= 0) return 0;
  return Math.min(enTrop * 4, 40);
}

/*
 * NOTORIETE — la place de l'auteur chez Open Library (mission V2, M5).
 *
 * CE QUI A CHANGE, ET POURQUOI LE COMPTE NE SUFFISAIT PAS.
 *
 * Ce signal valait jusqu'ici « combien de fiches Google ont ete fusionnees ».
 * C'etait un pis-aller assume : aucune source n'exposait de popularite
 * (arbitrage 16). C'est faux — Open Library en expose une — et le pis-aller
 * mesurait surtout a quel point Google avait duplique une notice.
 *
 * Premiere idee, ECARTEE PAR LA MESURE : utiliser le nombre de lecteurs
 * d'Open Library. Diagnostic du 2026-08-28 sur « les fourmis » :
 *
 *   Les fourmis, Bernard Werber          score 119   36 lecteurs, 1re oeuvre chez OL
 *   Les fourmis, Stephanie Ledu (jeunesse) score 149    0 lecteur, absente d'OL
 *
 * Les trente points d'ecart viennent presque entierement de la COMPLETUDE : la
 * fiche Google du roman de Werber n'a ni ISBN, ni editeur, ni couverture (15
 * points) la ou le documentaire jeunesse a tout (35). Or 36 lecteurs, en
 * valeur absolue, ne rattrapent jamais cela : Open Library est anglophone, et
 * un auteur francais tres lu en France y compte peu de monde. Un bareme fonde
 * sur le compte aurait donc marche sur « game of thrones » (13 397 lecteurs)
 * et echoue sur tout le catalogue francais.
 *
 * CE QU'ON RETIENT : LE RANG, PAS LE COMPTE. La question utile n'est pas
 * « combien de gens ont lu ce livre » mais « cet auteur est-il celui qu'Open
 * Library considere comme la reponse a cette recherche ». Le rang est
 * relatif, donc immunise contre le biais anglophone : Werber est 1er sur
 * « les fourmis » comme Martin est 1er sur « game of thrones ».
 *
 * Et c'est le signal qui repond exactement au defaut constate — les essais SUR
 * une oeuvre passent devant l'oeuvre — parce qu'un essai n'est pas ecrit par
 * l'auteur de l'oeuvre.
 *
 * LE BAREME. 36 points au 1er rang, moins 4 par rang, plancher a 0. Le
 * plafond de 36 n'est pas rond par hasard : il doit pouvoir renverser un ecart
 * de COMPLETUDE (35 au maximum, le cas Werber ci-dessus) sans jamais renverser
 * un ecart de correspondance de titre. La notoriete departage des candidats
 * credibles ; elle ne fait pas remonter un livre hors sujet.
 *
 * REPLI. Sans donnee d'Open Library — source injoignable, ou auteur inconnu
 * d'elle —, on retombe sur l'ancien compte d'editions. L'absence d'information
 * n'est pas une preuve d'obscurite, et cela garde le classement d'hier quand
 * la source est en panne.
 */
const NOTORIETE_MAX = 36;
const NOTORIETE_PAS = 4;

function notoriete(r) {
  if (Number.isInteger(r.rangAuteur)) {
    return Math.max(NOTORIETE_MAX - r.rangAuteur * NOTORIETE_PAS, 0);
  }
  const editions = Array.isArray(r.clesSource) ? r.clesSource.length : 1;
  return Math.min((editions - 1) * 6, 24);
}

/*
 * Completude de la fiche. Les poids sont volontairement petits devant la
 * correspondance de titre : ils DEPARTAGENT deux livres qui collent aussi bien
 * a la recherche, ils ne font jamais remonter un livre hors sujet.
 * L'auteur pese le plus : une notice sans auteur n'est presque jamais le livre
 * qu'on cherche.
 */
function completude(r) {
  let points = 0;
  if (Array.isArray(r.auteurs) ? r.auteurs.length : r.auteurs) points += 12;
  if (r.isbn13 || r.isbn10) points += 8;
  if (r.editeur) points += 6;
  if (r.couvertureUrl) points += 6;
  if (r.nbPages) points += 3;
  return points;
}

/**
 * Note de pertinence d'un resultat pour une recherche donnee.
 * Exportee pour pouvoir etre lue au banc d'essai, pas pour etre affichee :
 * l'utilisateur ne doit jamais voir un chiffre, seulement un bon ordre.
 * @param {object} resultat
 * @param {string} requete texte tape par l'utilisateur (deja normalise ou non)
 * @returns {number}
 */
export function scorePertinence(resultat, requete) {
  const q = comparable(requete);
  const titre = comparable(resultat.titre);

  return correspondance(titre, q)
    - penaliteLongueur(`${resultat.titre || ''} ${resultat.sousTitre || ''}`, q)
    + completude(resultat)
    + notoriete(resultat)
    + (resultat.langue === 'fr' ? 8 : 0);
}

// ---------------------------------------------------------------------------
// FILTRER CE QUI N'EST PAS L'OEUVRE (mission « le bruit d'abord »)
// ---------------------------------------------------------------------------

/*
 * Retour d'usage : « je cherche Game of Thrones et il me sort des choses en
 * lien avec la serie televisee, pas que des livres. »
 *
 * Jusqu'ici, le score CLASSAIT sans jamais FILTRER : les essais, guides et
 * derives (« comprendre le leadership avec la serie », « le livre des
 * festins ») remontaient moins haut, mais restaient a l'ecran. La decision de
 * l'utilisateur : les faire disparaitre.
 *
 * LE SIGNAL, c'est l'AUTEUR — le meme que celui de la notoriete (books.js) :
 * un essai SUR une oeuvre n'est pas ecrit par l'auteur de l'oeuvre. Open
 * Library nous dit deja quel auteur est « la reponse a cette recherche » ;
 * `rangAuteur` marque les resultats de cet auteur. On garde ceux-la, on jette
 * le reste.
 *
 * DEUX GARDE-FOUS, sans lesquels ce filtre ferait plus de mal que de bien :
 *
 *  1. FAIL-OPEN. Si AUCUN resultat ne porte de rang d'auteur — Open Library
 *     muette, ou auteur inconnu d'elle —, on ne filtre RIEN. C'est la meme
 *     regle que partout dans le projet : mieux vaut du bruit qu'un ecran vide.
 *     Le filtre ne mord donc qu'en mode Titre, seul mode ou la notoriete est
 *     calculee (books.js) — les modes Auteur et ISBN passent au travers sans
 *     etre touches.
 *
 *  2. FILET DU TITRE EXACT, MAIS SEULEMENT SANS AUTEUR DOMINANT. Un livre dont
 *     le TITRE colle a la recherche reste — c'est le cas d'une edition mal
 *     renseignee, qu'on ne veut pas effacer — TANT QU'aucun auteur n'a ete
 *     clairement identifie pour cette recherche.
 *
 *     Des qu'Open Library designe un auteur DOMINANT (le sien arrive en tete,
 *     rang 0), on se fie a l'auteur et plus au titre. C'est la lecon de
 *     « game of thrones » verifiee sur appels reels le 2026-09-07 : une foule
 *     de guides et de derives sont titres EXACTEMENT « Game of Thrones »
 *     (« Game of Thrones decode », le guide de Cedric Delaunay, « History of
 *     Thrones »…). Le filet du titre les gardait tous. Or quand Martin est
 *     identifie sans ambiguite, un « Game of Thrones » signe d'un AUTRE que lui
 *     est un derive, pas une edition perdue du roman.
 */
/*
 * PRODUITS DERIVES ET FORMATS DENATURES — mission « base de 10 livres »,
 * 2026-09-27. Mesure sur le banc fixe : un DVD, un recueil « Oeuvres
 * completes », une version « racontee aux enfants » ou un texte abrege
 * portent le MEME auteur que le livre cherche — le signal d'auteur ci-dessous
 * les laissait donc tous passer. Ce n'est pas un probleme d'auteur, c'est un
 * probleme de FORME : ce n'est pas le livre qu'on cherche, meme si l'auteur
 * est le bon. On l'ecarte avant meme de regarder le rang d'auteur.
 * Reste garde par le filet existant : si ecarter ces titres videait tout
 * (cas theorique), `filtrerHorsSujet` rend la liste entiere.
 */
const MOTIFS_HORS_FORMAT = [
  /\bdvd\b/i, /\bblu-?ray\b/i, /\bcoffret\s+dvd\b/i,
  /raconte(?:e)?s?\s+(?:a|aux)\s+(?:la\s+jeunesse|enfants)/i,
  /\boeuvres?\s+complet(?:es)?\b/i, /\boeuvres?\s+completes?\b/i,
  /\btexte\s+abrege(?:e)?\b/i, /\bversion\s+abrege(?:e)?\b/i,
];
function estHorsFormat(titre) {
  const t = comparable(titre);
  return MOTIFS_HORS_FORMAT.some((re) => re.test(t));
}

/* Mots d'un sous-titre qui ne disent rien du CONTENU : une mention d'edition. */
const MOTS_MENTION_EDITION = new Set([
  'edition', 'editions', 'enrichie', 'enrichi', 'illustree', 'illustre', 'annotee', 'annote',
  'integrale', 'integral', 'poche', 'grand', 'format', 'revue', 'corrigee', 'augmentee',
  'definitive', 'nouvelle', 'originale', 'complete', 'collector', 'luxe', 'deluxe',
  'anniversaire', 'bilingue', 'de', 'la', 'le', 'du', 'des', 'en', 'et', 'l',
]);
function sousTitreSansSens(sousTitre) {
  const m = mots(comparable(sousTitre)).filter((x) => !/^\d+$/.test(x));
  return m.every((x) => MOTS_MENTION_EDITION.has(x));   // aucun sous-titre : vrai
}

function estDuSujet(r, q, auteurDominant) {
  // Forme denaturee (DVD, oeuvres completes, jeunesse, abrege) : jamais le
  // livre cherche, quel que soit l'auteur.
  if (estHorsFormat(r.titre)) return false;

  // Par l'auteur : le signal le plus fiable.
  if (Number.isInteger(r.rangAuteur)) return true;

  /*
   * ETAPE 2 — UN LIVRE AU TITRE EXACT RESTE, MEME AVEC UN AUTEUR DOMINANT.
   * Mesure du 2026-10-04 : « la maison vide » ecartait trois vrais livres
   * (Claretie, Bernasconi, Gnoli) parce que Conan Doyle arrivait en tete chez
   * Open Library. La lecon de « game of thrones » demeure pourtant : les guides
   * et derives qui portent EXACTEMENT ce titre ont presque toujours un
   * sous-titre descriptif. Le titre exact ne sauve donc que sans sous-titre, ou
   * avec un sous-titre qui n'est qu'une mention d'edition.
   */
  if (correspondance(comparable(r.titre), q) >= 100 && sousTitreSansSens(r.sousTitre)) return true;

  // Auteur dominant identifie : on ne rattrape plus par le titre.
  if (auteurDominant) return false;

  // Sinon, filet : le titre lui-meme (hors sous-titre) colle a la recherche.
  const c = correspondance(comparable(r.titre), q);
  if (c >= 100) return true;
  if (c >= 70) {
    const titre = sansArticle(comparable(r.titre));
    const req = sansArticle(q);
    return mots(titre).length - mots(req).length <= 1;
  }
  return false;
}

/**
 * Retire les resultats qui ne sont pas l'oeuvre cherchee. Fail-open : rend la
 * liste inchangee des qu'aucun signal d'auteur n'est disponible.
 *
 * @param {object[]} resultats resultats deja fusionnes, avec `rangAuteur` quand
 *   Open Library l'a fourni (books.js)
 * @param {string} requete texte tape par l'utilisateur
 * @returns {object[]}
 */
export function filtrerHorsSujet(resultats, requete) {
  const liste = resultats || [];
  const q = comparable(requete);
  if (!q) return liste;

  // Aucun rang d'auteur nulle part : on ne sait rien, on ne filtre rien.
  const rangs = liste.map((r) => r.rangAuteur).filter(Number.isInteger);
  if (rangs.length === 0) return liste;

  // Auteur DOMINANT : l'auteur de l'oeuvre arrive en tete chez Open Library
  // (rang 0) et figure dans les resultats. On lui fait alors pleine confiance.
  const auteurDominant = rangs.some((n) => n === 0);

  const gardes = liste.filter((r) => estDuSujet(r, q, auteurDominant));
  // Dernier garde-fou : si le filtre effacait TOUT (cas theorique ou le signal
  // se contredit), on prefere rendre la liste entiere qu'un ecran vide.
  return gardes.length ? gardes : liste;
}

// ---------------------------------------------------------------------------
// LE LIVRE CHERCHE (mission « recherche satisfaisante », etape 6, decision 6)
// ---------------------------------------------------------------------------

/*
 * Mesure du 2026-10-04 : le classement par score est deja bon quand le filtre a
 * travaille (les autres livres de l'auteur passent derriere le livre cherche),
 * mais quand Open Library est trop lente pour que le filtre ecarte les essais, un
 * essai dont le titre COMMENCE par la recherche passait devant « La communaute de
 * l'anneau » — le vrai livre, dont le titre ne commence pas par la saisie.
 *
 * Trois NIVEAUX, le niveau avant le score. Le livre de reference est la carte la
 * mieux classee.
 *   0. le livre cherche : le titre est EXACTEMENT la recherche (de n'importe quel
 *      auteur : les homonymes restent), ou il la COMMENCE et a le meme auteur
 *      que la reference (les tomes, les editions) ;
 *   1. le meme auteur, un autre livre (une autre serie, la traduction du titre) ;
 *   2. tout le reste : essais, etudes, derives d'autres auteurs.
 * Rien ne disparait : un niveau descend, il ne s'efface pas.
 */
function memeEcrivain(a, b) {
  const [fa, ia = ''] = cleEcrivain(a).split('|');
  const [fb, ib = ''] = cleEcrivain(b).split('|');
  if (!fa || fa !== fb || !ia || !ib) return false;   // un nom seul ne rapproche personne
  const inclus = (x, y) => [...x].every((c) => y.includes(c));
  return inclus(ia, ib) || inclus(ib, ia);
}

/** Le rang de l'auteur chez Open Library (0 = la reponse a la recherche). */
export function rangDe(r) {
  return Number.isInteger(r.rangAuteur) ? r.rangAuteur : 50;
}

export function niveauxDeRecherche(resultats, requete) {
  const liste = resultats || [];
  const niveaux = new Map();
  const q = comparable(requete);
  if (!q || liste.length === 0) {
    liste.forEach((r) => niveaux.set(r, 0));
    return niveaux;
  }

  /*
   * ETAPE 8 : LE LIVRE DE REFERENCE EST CELUI DE L'AUTEUR QUE OPEN LIBRARY
   * DESIGNE, pas le mieux note. Mesure du 2026-10-04 sur « les fourmis » : un
   * documentaire homonyme de Boris Vian (titre exact, 100 points) battait
   * « Les Fourmis - Intégrale » de Werber (titre plus long, 70 points) et le
   * reste de l'oeuvre de Werber tombait au niveau 2. Parmi les cartes dont le
   * titre colle (exact ou commencant par la saisie), on retient donc la mieux
   * placee chez Open Library, puis la mieux notee. Sans aucun rang (Open Library
   * muette), on retombe sur la meilleure note, comme avant.
   */
  const colle = liste.filter((r) => correspondance(comparable(r.titre), q) >= 70);
  const pool = colle.length > 0 ? colle : liste;
  let reference = pool[0];
  pool.forEach((r) => {
    const mieux = rangDe(r) < rangDe(reference)
      || (rangDe(r) === rangDe(reference) && scorePertinence(r, requete) > scorePertinence(reference, requete));
    if (mieux) reference = r;
  });

  /*
   * « Le meme auteur » se lit sur TOUS les auteurs de la fiche : une BD signee
   * « Vanyda; Christelle Dabos » est aussi de Christelle Dabos. Sinon, quand elle
   * devenait la reference, les vrais tomes de Dabos tombaient au niveau 2.
   */
  const auteursDe = (r) => (r.auteurs || []).slice(0, 4);
  const memeAuteurQue = (r, autre) => auteursDe(r).some((a) => auteursDe(autre).some((b) => memeEcrivain(a, b)));

  liste.forEach((r) => {
    const memeAuteur = memeAuteurQue(r, reference);
    const c = correspondance(comparable(r.titre), q);
    if (c >= 100 || (c >= 70 && memeAuteur)) niveaux.set(r, 0);
    else niveaux.set(r, memeAuteur ? 1 : 2);
  });
  return niveaux;
}

// ---------------------------------------------------------------------------
// LE REPLI « VOIR AUSSI » (mission « recherche satisfaisante », etape 9)
// ---------------------------------------------------------------------------

/*
 * Le critere « au plus 3 parasites dans les 10 premiers » ne se tient pas avec
 * le seul tri : « descendre sans disparaitre » laisse les parasites dans la
 * liste. On les range donc SOUS UN REPLI, deplie d'un clic. Rien n'est supprime.
 *
 * Visible : tous les livres du niveau 0 — sauf les editions dans une AUTRE LANGUE
 * quand au moins une edition francaise du livre cherche existe — puis TROIS
 * « autres » au plus (autres livres de l'auteur, etudes), les mieux classes. Le
 * reste va sous le repli.
 *
 * Garde-fous : aucun livre ne correspond au titre (niveau 0 vide) -> rien n'est
 * replie ; une langue inconnue n'est jamais « etrangere ».
 *
 * Compromis assume, mesure sur « game of thrones » : les tomes francais du
 * « Trone de fer » ont un autre titre, donc comptent comme « autres » et peuvent
 * passer sous le repli. Tant qu'aucune source ne relie une traduction a son
 * original, on ne sait pas faire mieux.
 */
export const MAX_AUTRES_VISIBLES = 3;

export function separerLePrincipal(resultats, requete, maxAutres = MAX_AUTRES_VISIBLES) {
  const liste = resultats || [];
  const tout = { principaux: liste, replies: [] };
  if (!comparable(requete) || liste.length === 0) return tout;

  const niveaux = niveauxDeRecherche(liste, requete);
  if (!liste.some((r) => niveaux.get(r) === 0)) return tout;

  const etrangere = (r) => Boolean(r.langue) && !/^fr/i.test(String(r.langue));
  const frAuNiveau0 = liste.some((r) => niveaux.get(r) === 0 && !etrangere(r) && /^fr/i.test(String(r.langue || '')));

  const principaux = [];
  const replies = [];
  let autres = 0;
  liste.forEach((r) => {
    if (frAuNiveau0 && etrangere(r)) { replies.push(r); return; }
    if (niveaux.get(r) === 0) { principaux.push(r); return; }
    if (autres < maxAutres) { autres += 1; principaux.push(r); return; }
    replies.push(r);
  });
  return { principaux, replies };
}

/**
 * Trie une liste de resultats.
 *
 * « pertinence » ne rend PLUS l'ordre d'origine : il applique le score
 * ci-dessus, en gardant l'ordre d'arrivee de Google comme depart d'egalite —
 * cet ordre reste une information, il n'est simplement plus le seul.
 * Sans `requete`, il n'y a rien a quoi comparer : on rend la liste telle
 * quelle, comme avant (c'est le cas du mode Auteur, ou le regroupement par
 * ecrivain decide de l'ordre).
 *
 * Les livres SANS DATE vont a la fin et non au debut : un livre non date n'est
 * pas un livre ancien, et le placer en tete d'un tri « plus recent » serait
 * trompeur.
 */
export function trierResultats(resultats, tri, requete = '') {
  const liste = [...(resultats || [])];

  if (tri !== 'recent') {
    if (!comparable(requete)) return liste;
    const notes = new Map(liste.map((r) => [r, scorePertinence(r, requete)]));
    const niveaux = niveauxDeRecherche(liste, requete);
    // `sort` est stable : a score egal, l'ordre de Google est conserve. Le
    // niveau passe avant le score (etape 6) : un essai ne double jamais un livre.
    // Etape 8 : a l'interieur d'un niveau, l'auteur le mieux place chez Open Library
    // d'abord (un homonyme sans rang ne double plus l'auteur designe), puis la note.
    return liste.sort((a, b) => (niveaux.get(a) - niveaux.get(b))
      || (rangDe(a) - rangDe(b))
      || (notes.get(b) - notes.get(a)));
  }

  return liste.sort((a, b) => {
    const an = anneeDe(a);
    const bn = anneeDe(b);
    if (an === 0 && bn === 0) return 0;
    if (an === 0) return 1;
    if (bn === 0) return -1;
    return bn - an;
  });
}
