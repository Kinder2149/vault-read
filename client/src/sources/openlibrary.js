/*
 * sources/openlibrary.js — Open Library. « Open Library identifie » (§4).
 * Un seul `fetch` (olGet), et un normaliseur par forme rendue.
 * Pièges vérifiés sur appels réels le 2026-08-20 :
 *  - /isbn/{isbn}.json répond 302 vers /books/{olid}.json — fetch suit, curl non ;
 *  - /works/{olid}.json peut rendre un /type/redirect avec un champ `location` ;
 *  - les auteurs d'une édition ne sont que des CLÉS, sans nom lisible ;
 *  - publish_date est du texte libre non ISO : « Aug 26, 2021 » ;
 *  - description est tantôt une chaîne, tantôt {type, value}.
 */

/** @typedef {import('../types.js').ResultatRecherche} ResultatRecherche */
/** @typedef {import('../types.js').Identite} Identite */

const BASE = 'https://openlibrary.org';
const COUVERTURES = 'https://covers.openlibrary.org';
const DELAI_MAX_MS = 12000;
const UA = 'SuiviLecture/1.0 (application locale de suivi de lecture)';

/*
 * L'en-tête User-Agent est demandé par Open Library. Un navigateur INTERDIT de
 * le définir depuis fetch et l'ignore silencieusement ; CapacitorHttp le laisse
 * passer sur Android (vérifié dans logcat en tranche 0). Le code est le même
 * des deux côtés : aucune branche à écrire.
 */
async function olGet(chemin, budgetMs = DELAI_MAX_MS) {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), budgetMs);
  try {
    const reponse = await fetch(`${BASE}${chemin}`, {
      headers: { 'User-Agent': UA },
      signal: arret.signal,
    });
    if (reponse.status === 404) return null;
    if (!reponse.ok) throw new Error(`Open Library a répondu ${reponse.status}.`);
    return await reponse.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Open Library ne répond pas.');
    throw e;
  } finally {
    clearTimeout(minuteur);
  }
}

/*
 * publish_date d'Open Library est du TEXTE LIBRE, pas de l'ISO : « Aug 26, 2021 »,
 * « August 2, 2005 », parfois « 1978 » seul. Or §3.3 compare les dates
 * lexicographiquement — « Aug 26, 2021 » y serait rangé avant « 1978 ».
 * Règle posée ici, à l'entrée : une date Open Library est convertie en ISO
 * partielle, ou réduite à son année, ou abandonnée. Jamais stockée brute.
 */
const MOIS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function normaliserDatePublication(brut) {
  if (!brut) return null;
  const texte = String(brut).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texte) || /^\d{4}-\d{2}$/.test(texte)) return texte;

  const complet = texte.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (complet) {
    const mois = MOIS[complet[1].slice(0, 3).toLowerCase()];
    if (mois) return `${complet[3]}-${mois}-${complet[2].padStart(2, '0')}`;
  }

  const moisAnnee = texte.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);
  if (moisAnnee) {
    const mois = MOIS[moisAnnee[1].slice(0, 3).toLowerCase()];
    if (mois) return `${moisAnnee[2]}-${mois}`;
  }

  const annee = texte.match(/(\d{4})/);
  return annee ? annee[1] : null;
}

/** "/works/OL893414W" -> "OL893414W" */
function olid(cle) {
  return typeof cle === 'string' ? cle.split('/').filter(Boolean).pop() : null;
}

/** description est tantôt une chaîne, tantôt {type, value}. */
function texteDescription(valeur) {
  if (!valeur) return null;
  if (typeof valeur === 'string') return valeur;
  return typeof valeur.value === 'string' ? valeur.value : null;
}

/*
 * Couverture par identifiant de couverture, PAS par ISBN.
 * Piège : covers.openlibrary.org/b/isbn/... rend une image minuscule avec un
 * statut 200 quand la couverture n'existe pas — donc des vignettes fantômes
 * qu'aucune gestion d'erreur ne rattrape. L'identifiant, lui, vient du disque
 * d'Open Library : s'il est présent, l'image existe.
 */
export function couvertureParId(idCouverture, taille = 'L') {
  return idCouverture ? `${COUVERTURES}/b/id/${idCouverture}-${taille}.jpg` : null;
}

/*
 * Le champ `series` d'une édition est très irrégulier. Formes réellement
 * observées : "Dune (1); Dune Chronicles, Book 1" (anglais, point-virgule),
 * et le français "Le Trône de fer, tome 3". On lit ce qui se lit, on n'invente
 * rien : si rien ne correspond, on rend deux null et aucun bandeau ne s'affiche.
 */
export function lireCycle(series) {
  const brut = Array.isArray(series) ? series[0] : series;
  if (typeof brut !== 'string' || !brut.trim()) return { cycleNom: null, cycleTome: null };

  const premier = brut.split(';')[0].trim();

  const motifs = [
    /^(.*?),?\s*tome\s+(\d+)$/i,
    /^(.*?),?\s*(?:book|vol\.?|volume)\s+(\d+)$/i,
    /^(.*?)\s*\((\d+)\)$/,
    /^(.*?)\s*#(\d+)$/,
  ];
  for (const motif of motifs) {
    const m = premier.match(motif);
    if (m && m[1].trim()) {
      return { cycleNom: m[1].trim().replace(/[,\s]+$/, ''), cycleTome: Number(m[2]) };
    }
  }
  return { cycleNom: premier, cycleTome: null };
}

/**
 * Édition par ISBN — LE chemin normal d'identification (§3.2).
 * @returns {Promise<Identite|null>}
 */
export async function identiteParIsbn(isbn, budgetMs) {
  const edition = await olGet(`/isbn/${isbn}.json`, budgetMs);
  if (!edition) return null;

  const cleOeuvre = Array.isArray(edition.works) && edition.works[0]
    ? olid(edition.works[0].key)
    : null;
  const { cycleNom, cycleTome } = lireCycle(edition.series);

  return {
    oeuvreId: cleOeuvre ? `ol:${cleOeuvre}` : null,
    resolue: Boolean(cleOeuvre),
    cycleNom,
    cycleTome,
    // number_of_pages de l'édition précise : c'est la valeur EXACTE de §5.4.
    nbPages: edition.number_of_pages || null,
    editionOlid: olid(edition.key),
    couvertureUrl: couvertureParId((edition.covers || [])[0]),
    editeur: Array.isArray(edition.publishers) ? edition.publishers[0] : null,
    datePublication: normaliserDatePublication(edition.publish_date),
  };
}

/** Retire « Tome 5 », « T01 », « vol. 2 » et les parenthèses d'un titre. */
function sansMentionDeTome(titre) {
  return String(titre || '')
    .replace(/\s*[-–—,]?\s*(tome|t\.?|vol\.?|volume)\s*0*\d+\s*[:\-–—]?\s*/i, ' ')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function chercherDoc(titre, auteur, budgetMs) {
  const params = new URLSearchParams({
    q: [titre, auteur].filter(Boolean).join(' '),
    limit: '1',
    fields: 'key,title,author_name,first_publish_year,cover_i,editions,editions.key,editions.series,editions.number_of_pages',
  });
  const donnees = await olGet(`/search.json?${params.toString()}`, budgetMs);
  return donnees && Array.isArray(donnees.docs) ? donnees.docs[0] : null;
}

/**
 * Recherche d'œuvre quand il n'y a pas d'ISBN (§3.2, chemin 2).
 * Une seule requête rend l'œuvre et ses éditions imbriquées.
 * @returns {Promise<Identite|null>}
 */
export async function identiteParRecherche(titre, auteur, budgetMs) {
  let doc = await chercherDoc(titre, auteur, budgetMs);

  /*
   * Deuxième essai sur un titre nettoyé. Mesuré sur les échecs réels : les
   * titres français portent le tome DANS le titre (« Dune - Tome 5 Les
   * Hérétiques de Dune », « ... T01 - Le cosmos est mon campement »), et
   * Open Library, qui indexe surtout la VO, ne reconnaît alors plus rien.
   * Retirer la mention de tome résout 4 de ces 6 échecs. L'essai n'est payé
   * que lorsque le premier a échoué.
   */
  if (!doc) {
    const propre = sansMentionDeTome(titre);
    if (propre && propre !== titre) doc = await chercherDoc(propre, auteur, budgetMs);
  }
  if (!doc || !doc.key) return null;

  const premiereEdition = ((doc.editions || {}).docs || [])[0] || {};
  const { cycleNom, cycleTome } = lireCycle(premiereEdition.series);

  return {
    oeuvreId: `ol:${olid(doc.key)}`,
    resolue: true,
    cycleNom,
    cycleTome,
    // Vérifié : number_of_pages est presque toujours absent des éditions
    // imbriquées de search.json, même quand la fiche /isbn/ le porte.
    nbPages: premiereEdition.number_of_pages || null,
    editionOlid: olid(premiereEdition.key),
    couvertureUrl: couvertureParId(doc.cover_i),
  };
}

/**
 * Fiche d'œuvre : résumé et sujets. Sert à combler un résumé absent chez
 * Google — « un résumé anglais vaut mieux qu'un vide, et on ne traduit pas ».
 */
export async function oeuvreParCle(cleOeuvre, budgetMs = DELAI_MAX_MS) {
  const brut = cleOeuvre.replace(/^ol:/, '');
  const depart = Date.now();
  let donnees = await olGet(`/works/${brut}.json`, budgetMs);

  // Une œuvre fusionnée rend un /type/redirect au lieu de la fiche. Piège non
  // documenté : sans ce saut, le résumé serait vide sans raison apparente.
  // Le budget est ce qu'il RESTE, pas le budget entier : sinon deux sauts
  // coûtent deux fois le plafond, et le « budget » n'en est plus un.
  if (donnees && donnees.type && donnees.type.key === '/type/redirect' && donnees.location) {
    const reste = budgetMs - (Date.now() - depart);
    if (reste <= 0) return null;
    donnees = await olGet(`/works/${olid(donnees.location)}.json`, reste);
  }
  if (!donnees) return null;

  return {
    titre: donnees.title || null,
    resume: texteDescription(donnees.description),
    categories: Array.isArray(donnees.subjects) ? donnees.subjects.slice(0, 5) : [],
    couvertureUrl: couvertureParId((donnees.covers || [])[0]),
  };
}


/*
 * Repli pour la recherche par ISBN (point 5 des corrections d'usage).
 * Quand Google ne connait pas un ISBN, Open Library le connait parfois. On
 * passe par search.json plutot que /isbn/ : UN seul aller-retour (pas de
 * redirection) et surtout des NOMS d'auteurs, que la fiche d'edition ne donne
 * pas (§4.2).
 * Mesure honnete : sur les ISBN francais que Google ignore, Open Library n'en
 * connait qu'une minorite. Ce repli rattrape quelques livres, pas tous — d'ou
 * la saisie manuelle, qui est l'autre moitie de la reponse.
 * @returns {Promise<import('../types.js').ResultatRecherche|null>}
 */
export async function livreParIsbn(isbn) {
  const params = new URLSearchParams({
    q: isbn,
    limit: '1',
    fields: 'key,title,author_name,first_publish_year,cover_i,number_of_pages_median,publisher,isbn',
  });
  const donnees = await olGet(`/search.json?${params.toString()}`);
  const doc = donnees && Array.isArray(donnees.docs) ? donnees.docs[0] : null;
  if (!doc || !doc.key) return null;

  /*
   * VERIFICATION. La recherche d'Open Library est permissive : interrogee avec
   * une suite de chiffres, elle rend le « meilleur » document meme quand il ne
   * porte pas cet ISBN. On exige donc que l'ISBN demande figure vraiment dans
   * la fiche, sinon on prefere ne rien rendre — un mauvais livre est pire
   * qu'aucun livre.
   */
  const porte = Array.isArray(doc.isbn) && doc.isbn.includes(String(isbn));
  if (!porte) return null;

  return {
    cleSource: `ol:${olid(doc.key)}`,
    source: 'openlibrary',
    titre: doc.title || 'Sans titre',
    sousTitre: null,
    auteurs: Array.isArray(doc.author_name) ? doc.author_name.slice(0, 3) : [],
    annee: doc.first_publish_year ? String(doc.first_publish_year) : null,
    datePublication: doc.first_publish_year ? String(doc.first_publish_year) : null,
    couvertureUrl: couvertureParId(doc.cover_i),
    resume: null,
    categories: [],
    langue: null,
    isbn13: String(isbn).length === 13 ? String(isbn) : null,
    isbn10: String(isbn).length === 10 ? String(isbn) : null,
    // number_of_pages_median est une MEDIANE sur toutes les editions (§4.2) :
    // approximative, elle sert de valeur pre-remplie, jamais de verite.
    nbPages: doc.number_of_pages_median || null,
    editeur: Array.isArray(doc.publisher) ? doc.publisher[0] : null,
  };
}

/*
 * URL de couverture PAR ISBN, avec `default=false` — sans ce parametre,
 * Open Library rend une image d'un pixel avec un statut 200 quand la
 * couverture n'existe pas, donc des vignettes fantomes qu'aucune gestion
 * d'erreur ne rattrape (§4.2). Avec, elle rend un 404, que l'attribut onError
 * de l'image sait traiter.
 */
export function couvertureParIsbn(isbn, taille = 'M') {
  return isbn ? `${COUVERTURES}/b/isbn/${isbn}-${taille}.jpg?default=false` : null;
}

// ---------------------------------------------------------------------------
// NOTORIETE D'OEUVRE — Open Library en source d'ORDRE (mission V2, M3)
// ---------------------------------------------------------------------------

/*
 * POURQUOI CETTE FONCTION EXISTE.
 *
 * Google Books est un catalogue de DOCUMENTS : un carnet de notes « Maison
 * Targaryen » y est un livre aussi legitime que le roman de Martin. Rien dans
 * une fiche Google ne dit qu'une oeuvre est connue — et c'est ce qui manquait
 * au classement. Mesure du 2026-08-28 sur la recherche « game of thrones » :
 * le roman de Martin arrivait 4e, derriere trois essais SUR la serie, parce
 * qu'un essai bien edite ressemble davantage a une bonne fiche que l'oeuvre.
 *
 * Open Library, elle, indexe des OEUVRES et publie combien de lecteurs les ont
 * rangees dans leur bibliotheque. C'est l'equivalent exact du `popularity` que
 * TMDB donne au projet series — et dont ce projet s'etait cru prive
 * (arbitrage 16, infirme par la mesure).
 *
 *   « game of thrones »       -> A Game of Thrones, Martin : 13 397 lecteurs
 *                                le 2e du classement       :    259 lecteurs
 *   « les fourmis »           -> Les fourmis, Werber        : en tete
 *   « le seigneur des anneaux » -> Tolkien, quatre premieres places
 *
 * `fields=` EST OBLIGATOIRE ICI, et le piege merite d'etre ecrit.
 *
 * `readinglog_count` N'EST PAS rendu par defaut : la reponse standard ne porte
 * que `edition_count` comme signal de notoriete. Une premiere version de cette
 * fonction s'en passait — pour la vitesse — et attachait donc scrupuleusement
 * « 0 lecteur » a tous les livres, sans que rien ne le signale. C'est le banc
 * d'essai qui l'a montre, pas le code : d'ou son existence.
 *
 * Mais la projection doit rester COURTE. Mesure du 2026-08-28, sur les sept
 * recherches de reference :
 *   - 6 champs (avec first_publish_year, edition_count) : 348 a 9510 ms, et un
 *     echec complet ;
 *   - les 4 champs ci-dessous : mediane 556 ms, pire 4518 ms, zero echec.
 * On ne demande donc que ce dont on se sert. Ajouter un champ « au cas ou »
 * se paierait en secondes.
 */
const CHAMPS = 'key,title,author_name,readinglog_count';

/*
 * Budget volontairement plus serre que DELAI_MAX_MS. Cet appel n'apporte QUE
 * de l'ordre : au-dela de quelques secondes, mieux vaut afficher les resultats
 * de Google mal classes que faire attendre devant un ecran vide.
 * 5 s et non 4 : le pire temps mesure est de 4518 ms, sur « game of thrones »
 * a froid — c'est-a-dire precisement la recherche qui a le plus besoin d'etre
 * classee. Un budget de 4 s l'aurait coupee. En regime normal l'appel rend en
 * 556 ms et se termine avant Google, donc il ne coute rien.
 * Il est facultatif de bout en bout — voir `books.js`.
 */
const BUDGET_NOTORIETE_MS = 5000;

/**
 * Les oeuvres qu'Open Library associe a une recherche, avec leur notoriete.
 *
 * @param {string} texte ce que l'utilisateur a tape
 * @param {number} budgetMs
 * @returns {Promise<Array<{cleOeuvre: string, titre: string, auteurs: string[],
 *   lecteurs: number}>>}
 *   dans l'ordre rendu par Open Library, qui est deja un ordre de pertinence.
 */
export async function oeuvresNotoires(texte, budgetMs = BUDGET_NOTORIETE_MS) {
  const requete = String(texte || '').trim();
  if (!requete) return [];

  const params = new URLSearchParams({ q: requete, limit: '10', fields: CHAMPS });
  const chemin = `/search.json?${params.toString()}`;

  /*
   * UN SEUL REESSAI, ET SEULEMENT SUR COUPURE. Mesure du 2026-08-28 sur huit
   * recherches jamais faites : cinq repondent en moins de 1,3 s, une met
   * 9,4 s, et DEUX tombent sur une coupure de connexion — immediatement.
   *
   * Ces deux-la se rattrapent pour rien : l'echec est instantane, le reessai
   * ne coute donc que le second appel. Un delai depasse, lui, n'est JAMAIS
   * reessaye : il signifie qu'Open Library est lente maintenant, et insister
   * ne ferait qu'ajouter cinq secondes d'attente devant un ecran vide.
   * C'est la meme logique que les 503 de Google (§4.7), a l'inverse : la-bas
   * l'echec revient vite et le reessai est gratuit ; ici seule la coupure a
   * cette propriete.
   */
  let donnees;
  try {
    donnees = await olGet(chemin, budgetMs);
  } catch (e) {
    if (/ne répond pas/.test(e.message)) throw e;
    donnees = await olGet(chemin, budgetMs);
  }
  if (!donnees || !Array.isArray(donnees.docs)) return [];

  return donnees.docs.map((d) => ({
    cleOeuvre: d.key ? `ol:${olid(d.key)}` : null,
    titre: d.title || '',
    /*
     * `author_name` melange les translitterations dans la MEME liste (pour
     * Dune : « Frank Herbert » ET « Френк Герберт »). On les garde toutes :
     * ici elles servent a RECONNAITRE un auteur, pas a l'afficher, et plus il
     * y a de graphies connues, mieux le rapprochement fonctionne.
     */
    auteurs: Array.isArray(d.author_name) ? d.author_name : [],
    /*
     * `readinglog_count` = combien de personnes ont range cette oeuvre dans
     * leur bibliotheque. C'est la mesure de notoriete la plus large des trois
     * disponibles (devant `ratings_count`, qui demande un geste de plus, et
     * `edition_count`, qui mesure surtout l'age du livre).
     */
    lecteurs: Number(d.readinglog_count) || 0,
    /*
     * Ni annee ni nombre d'editions : ils ne sont pas dans `CHAMPS`, donc pas
     * rendus. Les demander coute des secondes (voir plus haut) et personne ne
     * s'en sert ici — l'annee vient de Google, qui la porte deja.
     */
  })).filter((o) => o.titre);
}
