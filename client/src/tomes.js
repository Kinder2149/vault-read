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
    const n = numeroDeTome(r.titre);
    const cle = n === null ? '' : cleDeSerie(r.titre);
    // Un titre qui n'est QUE « Tome 3 » ne nomme aucune serie : il rejoint le
    // reste plutot que de fonder une serie anonyme.
    if (n === null || !cle) { sansNumero.push(r); return; }
    if (!parSerie.has(cle)) parSerie.set(cle, []);
    parSerie.get(cle).push({ ...r, tome: n });
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
    series.push({ cle, nom: nomDeSerie(tomes[0].titre), tomes: [...tomes].sort((a, b) => a.tome - b.tome) });
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

  const blocs = [
    ...series.map((s) => ({
      bloc: { type: 'serie', cle: s.cle, nom: s.nom, tomes: s.tomes },
      note: Math.max(...s.tomes.map((t) => scorePertinence(t, requete))),
    })),
    ...autres.map((r) => ({ bloc: { type: 'livre', livre: r }, note: scorePertinence(r, requete) })),
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
    const n = numeroDeTome(r.titre);
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
    // `sort` est stable : a score egal, l'ordre de Google est conserve.
    return liste.sort((a, b) => notes.get(b) - notes.get(a));
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
