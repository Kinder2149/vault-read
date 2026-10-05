/*
 * sources/vaultapi.js — notre propre catalogue (projet « vault-books-api »). QUATRIEME source de books.js.
 * Un seul `fetch`, dans `apiGet`, et UN SEUL normaliseur par forme rendue (§7, garde-fou 2).
 *
 * POURQUOI. Les trois sources publiques ne sont pas faites pour la recherche d'un livre : l'ordre d'une saga se deduisait
 * d'une expression reguliere sur le titre, les couvertures se rattachaient a l'oeuvre et non a l'edition, et tout le tri
 * vivait dans l'application. Le service construit a part (https://github.com/Kinder2149/vault-books-api) rend des cartes DEJA
 * triees : une carte par oeuvre ou par saga, les tomes dans l'ordre, l'edition (ISBN, editeur) et la couverture de chaque tome
 * dans la langue choisie.
 *
 * CE QU'ELLE N'EST PAS. Un remplacement : les trois autres sources restent le REPLI. Si le service ne repond pas, est coupe,
 * ou n'est pas configure, `books.js` retombe sur le chemin historique sans que l'utilisateur voie autre chose que des
 * resultats un peu moins bien ranges.
 *
 * LA CLE D'APPLICATION n'est pas un secret : un APK ne garde rien de secret. Elle ne sert qu'a limiter l'abus du service.
 */

/** @typedef {import('../types.js').ResultatRecherche} ResultatRecherche */

const CLE_ACTIF = 'catalogueApiActif';
const CLE_LANGUE = 'catalogueLangue';
const LANGUES = ['fr', 'en'];

/*
 * 9 s : un premier appel a froid (fonction serverless endormie + sources) a mesure ~3 s ; au-dela, mieux vaut le repli.
 * Les variables sont lues A L'APPEL et non a l'import : les verifications automatiques les changent d'un cas a l'autre.
 */
const DELAI_MAX_MS = 9000;

/*
 * Au plus trois sagas sont depliees en tomes par recherche : chacune coute un appel de plus (mis en cache cote service).
 * Les suivantes restent une carte unique, sans tomes : c'est le bon compromis entre une grille complete et la latence.
 */
const MAX_SAGAS_DEPLIEES = 3;

const env = () => import.meta.env || {};
const baseUrl = () => String(env().VITE_VAULT_API_URL || '').trim().replace(/\/$/, '');
const cleApp = () => String(env().VITE_VAULT_API_KEY || '').trim();

// ---------------------------------------------------------------------------
// Reglages — memorises en localStorage, comme le profil actif : ce n'est pas une donnee de la bibliotheque.
// ---------------------------------------------------------------------------

/** L'adresse du service est-elle connue de cette version de l'application ? */
export function configuree() {
  return Boolean(baseUrl());
}

/** Active = configuree ET non coupee par l'utilisateur (reglage). Par defaut : active. */
export function active() {
  if (!configuree()) return false;
  try { return localStorage.getItem(CLE_ACTIF) !== '0'; } catch { return true; }
}

export function definirActive(oui) {
  try { localStorage.setItem(CLE_ACTIF, oui ? '1' : '0'); } catch { /* stockage indisponible : le reglage ne se retient pas */ }
}

/** Langue du catalogue : 'fr' par defaut. C'est celle des titres, des editions et des couvertures rendus. */
export function langue() {
  try {
    const l = localStorage.getItem(CLE_LANGUE);
    return LANGUES.includes(l) ? l : 'fr';
  } catch { return 'fr'; }
}

export function definirLangue(l) {
  if (!LANGUES.includes(l)) throw new Error('Langue du catalogue non prise en charge.');
  try { localStorage.setItem(CLE_LANGUE, l); } catch { /* idem */ }
}

export function etat() {
  return { configuree: configuree(), active: active(), langue: langue(), langues: LANGUES };
}

// ---------------------------------------------------------------------------
// Appel reseau
// ---------------------------------------------------------------------------

async function apiGet(chemin) {
  const arret = new AbortController();
  const minuteur = setTimeout(() => arret.abort(), DELAI_MAX_MS);
  try {
    const reponse = await fetch(`${baseUrl()}${chemin}`, {
      headers: cleApp() ? { 'x-app-key': cleApp() } : {},
      signal: arret.signal,
    });
    if (reponse.status === 401) throw new Error('Le catalogue Vault Books refuse la cle de cette application.');
    if (reponse.status === 404) return null;
    if (!reponse.ok) throw new Error(`Le catalogue Vault Books a répondu ${reponse.status}.`);
    return await reponse.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Le catalogue Vault Books ne répond pas.');
    throw e;
  } finally {
    clearTimeout(minuteur);
  }
}

// ---------------------------------------------------------------------------
// Normaliseurs — les SEULS endroits qui construisent un ResultatRecherche depuis ce service
// ---------------------------------------------------------------------------

const https = (url) => (url ? String(url).replace(/^http:\/\//, 'https://') : null);
const anneeDe = (date) => (date ? String(date).slice(0, 4) : null);

/** Un livre isole : la carte de recherche suffit. @returns {ResultatRecherche} */
function resultatDeCarte(carte, lang) {
  const date = carte.date || (carte.annee ? String(carte.annee) : null);
  return {
    cleSource: `vb:${carte.id}`,
    source: 'vaultapi',
    titre: carte.titre,
    sousTitre: null,
    auteurs: carte.auteurs || [],
    annee: anneeDe(date),
    datePublication: date,
    couvertureUrl: https(carte.couverture),
    resume: null,
    categories: [],
    langue: lang,
    isbn13: carte.isbn13 || null,
    isbn10: null,
    nbPages: null,
    editeur: carte.editeur || null,
    // Le score du service fait l'ordre de l'ecran : tomes.js ne le recalcule pas (voir scorePertinence).
    scoreApi: carte.score,
    // Un livre isole qui appartient a une saga garde le lien, pour que la fiche puisse l'annoncer.
    ...(carte.serie ? { serie: { id: carte.serie.id, nom: carte.serie.nom, position: carte.serie.position, total: null } } : {}),
  };
}

/** Une saga depliee : un resultat par TOME disponible dans la langue, dans l'ordre. @returns {ResultatRecherche[]} */
function resultatsDeSerie(carte, serie, lang) {
  return serie.tomes
    // Un tome sans aucune edition dans la langue n'est pas ajoutable : il ne s'affiche pas (la saga annonce son total).
    .filter((t) => t.disponible && !t.aParaitre)
    .map((t) => {
      /*
       * Tome disponible seulement en volumes coupes (le Trone de fer en poche : « A Storm of Swords » n'existe en francais
       * qu'en « Intrigues a Port-Real », « L'epee de feu »…) : on presente le PREMIER VOLUME, titre, couverture et ISBN compris.
       * C'est lui qu'on pourra posseder ; le titre canonique est en anglais et la couverture, celle d'une autre langue.
       */
      const volume = t.edition ? null : (t.parties.find((p) => p.edition) || null);
      const edition = t.edition || volume?.edition || null;
      return {
        cleSource: `vb:${t.livreId}`,
        source: 'vaultapi',
        titre: volume ? volume.titre : t.titre,
        sousTitre: null,
        auteurs: carte.auteurs || [],
        annee: anneeDe(edition?.date),
        datePublication: edition?.date || null,
        couvertureUrl: https(volume ? volume.couverture : t.couverture),
        resume: null,
        categories: [],
        langue: lang,
        isbn13: edition?.isbn13 || null,
        isbn10: null,
        nbPages: null,
        editeur: edition?.editeur || null,
        scoreApi: carte.score,
        serie: { id: serie.id, nom: serie.nom, position: t.position, total: serie.totalPrincipal },
        couvertureApproximative: Boolean(volume ? volume.couvertureApproximative : t.couvertureApproximative),
      };
    });
}

// ---------------------------------------------------------------------------
// Editions d'un livre
// ---------------------------------------------------------------------------

/**
 * Les editions qu'on pourrait posseder d'un livre du catalogue : Hardcover + BnF reunis cote service, une par ISBN, chacune avec
 * sa couverture (celle de l'EDITION, jamais celle d'un autre tome). La cle `vbe:<isbn13>` est propre a l'edition : `vb:<id>` est celle
 * du livre tel que la recherche l'a rendu.
 * @param {number} livreId identifiant du livre dans le catalogue (la partie apres « vb: »)
 * @returns {Promise<ResultatRecherche[]|null>} null si le service ne connait pas ce livre
 */
export async function editionsDuLivre(livreId) {
  const lang = langue();
  const livre = await apiGet(`/v1/books/${livreId}?lang=${lang}`);
  if (!livre) return null;
  return (livre.editions || []).filter((e) => e.isbn13).map((e) => ({
    cleSource: `vbe:${e.isbn13}`,
    source: 'vaultapi',
    titre: e.titre || livre.titreLangue || livre.titre,
    sousTitre: null,
    auteurs: livre.auteurs || [],
    annee: anneeDe(e.date),
    datePublication: e.date || null,
    couvertureUrl: https(e.couverture && e.couverture.url),
    resume: null,
    categories: [],
    langue: lang,
    isbn13: e.isbn13,
    isbn10: null,
    nbPages: null,
    editeur: e.editeur || null,
    couvertureApproximative: Boolean(e.couverture && e.couverture.approximative),
  }));
}

// ---------------------------------------------------------------------------
// Scan d'un ISBN
// ---------------------------------------------------------------------------

/**
 * L'edition qui porte cet ISBN, pour le scan de code-barres et la recherche par ISBN. Le service interroge Hardcover (editeur, date,
 * PAGES, langue, couverture de l'edition, livre et saga) puis la BnF pour ce qu'il ignore. AUCUN filtre de langue : un ISBN designe une
 * edition precise, souvent en version originale, et la faire disparaitre parce qu'elle n'est pas dans la langue du catalogue serait
 * mentir (meme regle que la source Google, §4.3).
 *
 * La cle d'edition porte l'identifiant du LIVRE quand le service le connait (`vb:<livre>:<isbn13>`) : c'est ce qui permet ensuite de
 * proposer les autres editions de ce livre. Elle ne peut pas etre `vb:<livre>` seul — c'est celle du livre vu par la recherche —, car
 * deux editions du meme livre, scannees l'une apres l'autre, porteraient alors la meme cle.
 *
 * @param {string} isbn chiffres seuls (10 ou 13)
 * @returns {Promise<ResultatRecherche|null>} null si le service ne connait pas cet ISBN : l'appelant essaie alors les sources publiques
 */
export async function rechercherIsbn(isbn) {
  const donnees = await apiGet(`/v1/isbn/${encodeURIComponent(isbn)}`);
  if (!donnees || !donnees.isbn13) return null;
  const date = donnees.date || null;
  return {
    cleSource: donnees.livre ? `vb:${donnees.livre.id}:${donnees.isbn13}` : `vbe:${donnees.isbn13}`,
    source: 'vaultapi',
    titre: donnees.titre,
    sousTitre: null,
    auteurs: donnees.auteurs || [],
    annee: anneeDe(date),
    datePublication: date,
    couvertureUrl: https(donnees.couverture && donnees.couverture.url),
    resume: null,
    categories: [],
    langue: donnees.langue || null,
    isbn13: donnees.isbn13,
    isbn10: null,
    // La pagination exacte de CETTE edition : c'est elle qui sert a la progression (§5.4).
    nbPages: donnees.nbPages || null,
    editeur: donnees.editeur || null,
    couvertureApproximative: Boolean(donnees.couverture && donnees.couverture.approximative),
    ...(donnees.serie ? { serie: { id: donnees.serie.id, nom: donnees.serie.nom, position: donnees.serie.position, total: donnees.serie.total } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

/**
 * Recherche par titre. Rend les resultats DEJA tries et regroupes : l'ordre rendu est l'ordre d'affichage.
 * @param {string} texte
 * @returns {Promise<{resultats: ResultatRecherche[], langueNonDisponible: boolean}>}
 */
export async function rechercherTitre(texte) {
  const lang = langue();
  const donnees = await apiGet(`/v1/search?q=${encodeURIComponent(texte)}&lang=${lang}`);
  const cartes = (donnees && donnees.resultats) || [];

  // Les sagas a deplier, dans l'ordre de la recherche. Une saga qui ne se deplie pas reste une carte unique.
  const adeplier = cartes.filter((c) => c.type === 'serie').slice(0, MAX_SAGAS_DEPLIEES);
  const series = new Map(await Promise.all(adeplier.map(async (c) => {
    try { return [c.id, await apiGet(`/v1/series/${c.id}?lang=${lang}`)]; } catch { return [c.id, null]; }
  })));

  const resultats = cartes.flatMap((carte) => {
    if (carte.type !== 'serie') return [resultatDeCarte(carte, lang)];
    const serie = series.get(carte.id);
    const tomes = serie ? resultatsDeSerie(carte, serie, lang) : [];
    return tomes.length ? tomes : [resultatDeCarte(carte, lang)];
  });

  return { resultats, langueNonDisponible: Boolean(donnees && donnees.langueNonDisponible) };
}
