/*
 * FAMILLE 19 — LE BUDGET OPEN LIBRARY ET LE LIVRE DE REFERENCE
 *
 * Mission « recherche satisfaisante », etape 8 (volets A et B).
 *
 * Critere de Kinder : « Quand je cherche une serie ou un livre d'un auteur tres
 * publie, l'application n'envoie qu'une dizaine de requetes a Open Library.
 * Quand je cherche Les Fourmis, les livres de Bernard Werber passent avant les
 * documentaires du meme titre. Quand je cherche La Passe-miroir, le roman de
 * Christelle Dabos passe avant la BD. »
 *
 * Mesure du 2026-10-04 : 290 requetes en 4 minutes, 5 a 27 par recherche, et
 * Open Library qui cesse de repondre deux fois. Aucun appel reseau reel ici.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trierResultats, organiserLEcran, niveauxDeRecherche } from '../src/tomes.js';

const faux = new Map();
vi.mock('idb-keyval', () => ({
  get: async (k) => faux.get(k),
  set: async (k, v) => { faux.set(k, v); },
  del: async (k) => { faux.delete(k); },
  keys: async () => [...faux.keys()],
  delMany: async (cles) => { cles.forEach((k) => faux.delete(k)); },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

let n = 0;
const carte = (titre, auteurs, plus = {}) => ({
  cleSource: `gb:${(n += 1)}`, titre, sousTitre: null, auteurs: Array.isArray(auteurs) ? auteurs : [auteurs],
  langue: 'fr', isbn13: '978000000' + String(1000 + n), editeur: 'Un editeur', couvertureUrl: 'http://x/c',
  nbPages: 300, clesSource: ['gb:' + n], ...plus,
});
const titres = (l) => l.map((c) => c.titre);

// ---------------------------------------------------------------------------
describe('Volet B : le livre de reference est celui de l-auteur qu-Open Library designe', () => {
  it('« les fourmis » : Werber passe avant les documentaires homonymes', () => {
    const liste = [
      carte('Les Fourmis', 'Boris Vian', { rangAuteur: 1 }),
      carte('Les fourmis', 'Stéphanie Ledu'),
      carte('Les Fourmis', 'Deborah Hodge; Julian Mulock'),
      carte('Les fourmis', 'Marie-Sophie Germain'),
      carte('Les Fourmis - Intégrale', 'Bernard Werber', { rangAuteur: 0 }),
      carte('La trilogie des fourmis', 'Bernard Werber', { rangAuteur: 0 }),
      carte('La Révolution des fourmis', 'Bernard Werber', { rangAuteur: 0 }),
    ];
    const triees = trierResultats(liste, 'pertinence', 'les fourmis');
    expect(triees[0].titre).toBe('Les Fourmis - Intégrale');
    const niveaux = niveauxDeRecherche(liste, 'les fourmis');
    expect(niveaux.get(liste[4])).toBe(0);            // le livre de Werber est « le livre cherche »
    expect(niveaux.get(liste[5])).toBe(1);            // ses autres livres suivent
    expect(triees).toHaveLength(7);                    // rien ne disparait
  });

  it('« la passe-miroir » : une BD signee « Vanyda; Christelle Dabos » n-ecrase pas les tomes de Dabos', () => {
    const bd = carte('La passe-miroir', ['Vanyda', 'Christelle Dabos (autrice)'], { rangAuteur: 0, annee: '2026' });
    const tomes = [
      carte('La Passe-miroir (Livre 1) - Les Fiancés de l\'hiver', 'Christelle Dabos', { rangAuteur: 0 }),
      carte('La Passe-miroir (Livre 2) - Les Disparus du Clairdelune', 'Christelle Dabos', { rangAuteur: 0 }),
      carte('La passe-miroir', 'Christelle Dabos', { rangAuteur: 0 }),
    ];
    const niveaux = niveauxDeRecherche([bd, ...tomes], 'la passe-miroir');
    [bd, ...tomes].forEach((c) => expect(niveaux.get(c)).toBe(0));
  });

  it('un homonyme sans rang passe apres l-auteur designe, dans le meme niveau', () => {
    const liste = [
      carte('Harry Potter', 'Emma Huddleston'),
      carte('Harry Potter à l\'école des sorciers', 'J.K. Rowling', { rangAuteur: 0 }),
      carte('Harry Potter et la Chambre des Secrets', 'J.K. Rowling', { rangAuteur: 0 }),
    ];
    const triees = trierResultats(liste, 'pertinence', 'harry potter');
    expect(triees[triees.length - 1].auteurs[0]).toBe('Emma Huddleston');
  });

  it('a l-interieur d-un niveau, le rang chez Open Library passe avant la note', () => {
    const complet = carte('Dune', 'Auteur Inconnu', { rangAuteur: 5 });
    const maigre = carte('Dune', 'Frank Herbert', { rangAuteur: 0, editeur: null, couvertureUrl: null, nbPages: null, isbn13: null });
    const triees = trierResultats([complet, maigre], 'pertinence', 'dune');
    expect(triees[0]).toBe(maigre);
  });

  it('sans aucun rang (Open Library muette), on retombe sur la meilleure note, comme avant', () => {
    const liste = [
      carte('Les Fourmis - Intégrale', 'Bernard Werber'),
      carte('Les Fourmis', 'Boris Vian'),
    ];
    expect(trierResultats(liste, 'pertinence', 'les fourmis')[0].titre).toBe('Les Fourmis');
  });

  it('l-ecran (blocs) suit le meme ordre', () => {
    const liste = [
      carte('Les Fourmis', 'Boris Vian', { rangAuteur: 1 }),
      carte('Les Fourmis - Intégrale', 'Bernard Werber', { rangAuteur: 0 }),
    ];
    const blocs = organiserLEcran(trierResultats(liste, 'pertinence', 'les fourmis'), 'les fourmis');
    const ordre = blocs.flatMap((b) => (b.type === 'serie' ? b.tomes : b.livres)).map((c) => c.titre);
    expect(ordre[0]).toBe('Les Fourmis - Intégrale');
  });

  it('les cas du niveau 0 existants ne bougent pas : homonymes exacts, tomes, mode Auteur', () => {
    const homonymes = [carte('La maison vide', 'Claude Gutman'), carte('La maison vide', 'Laurent Mauvignier')];
    const niv = niveauxDeRecherche(homonymes, 'la maison vide');
    homonymes.forEach((c) => expect(niv.get(c)).toBe(0));
    expect(titres(trierResultats(homonymes, 'pertinence', ''))).toEqual(titres(homonymes));   // mode Auteur : inchange
  });
});

// ---------------------------------------------------------------------------

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });
const noXml = '<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>';

let appels;
beforeEach(() => { faux.clear(); appels = []; localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Une saga de `nb` cartes « <titre> <mot> » du meme auteur, sans numero de tome. */
const MOTS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
function sagaGoogle(titre, nb, { avecAutres = 0 } = {}) {
  const items = Array.from({ length: nb }, (_, i) => ({
    id: 's' + i,
    volumeInfo: {
      title: `${titre} ${MOTS[i]}`, authors: ['Auteur Prolifique'], publishedDate: String(2000 + i), language: 'fr',
      imageLinks: { thumbnail: 'http://x/' + i },
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782000000' + String(100 + i) }],
    },
  }));
  Array.from({ length: avecAutres }, (_, i) => items.push({
    id: 'a' + i,
    volumeInfo: {
      title: `Un autre livre ${MOTS[i]}`, authors: ['Auteur Prolifique'], publishedDate: '2010', language: 'fr',
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782999999' + String(100 + i) }],
    },
  }));
  return items;
}

function reseau(items, { olOeuvres } = {}) {
  vi.stubGlobal('fetch', (url) => {
    const u = String(url);
    appels.push(u);
    if (u.includes('openlibrary.org/isbn/')) {
      const isbn = u.match(/isbn\/(\d+)/)[1];
      return Promise.resolve(ok({ key: '/books/OL1M', works: [{ key: `/works/OL${isbn.slice(-3)}W` }], publishers: ['X'] }));
    }
    if (u.includes('openlibrary.org/search.json') && u.includes('key%3A%2Fworks')) {
      return Promise.resolve(ok({ docs: [{ first_publish_year: 1990 + (appels.length % 7) }] }));
    }
    if (u.includes('openlibrary.org/search.json')) {
      return Promise.resolve(ok({ docs: olOeuvres || [] }));
    }
    if (u.includes('bnf.fr')) return Promise.resolve(new Response(noXml, { status: 200 }));
    return Promise.resolve(ok({ items }));
  });
}
// Les requetes de TITRE a Open Library, notoriete exclue (elle n'est pas dans le budget).
const requetesOL = () => appels.filter((u) => u.includes('openlibrary.org') && !u.includes('readinglog_count'));

let numero = 0;
const titreUnique = () => { numero += 1; return `saga${['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'][numero % 8]}${numero}`; };

describe('Volet A : un budget de requetes Open Library par recherche (etape 8)', () => {
  it('une saga de douze cartes ne fait pas plus de dix requetes', async () => {
    const t = titreUnique();
    reseau(sagaGoogle(t, 12));
    const books = await import('../src/books.js');

    await books.rechercher(t, 'titre');

    expect(requetesOL().length).toBeGreaterThan(0);                     // le calcul des tomes a bien eu lieu
    expect(requetesOL().length).toBeLessThanOrEqual(books.BUDGET_REQUETES_OL);
  });

  it('les autres livres de l-auteur (niveau 1) ne font payer aucune requete', async () => {
    const t = titreUnique();
    reseau(sagaGoogle(t, 3, { avecAutres: 8 }));
    const books = await import('../src/books.js');

    await books.rechercher(t, 'titre');

    const isbnsDemandes = requetesOL().map((u) => (u.match(/isbn\/(\d+)/) || [])[1]).filter(Boolean);
    expect(isbnsDemandes.length).toBeGreaterThan(0);
    expect(isbnsDemandes.every((i) => !i.startsWith('9782999999'))).toBe(true);
  });

  it('budget epuise : aucun numero de tome n-est invente', async () => {
    const t = titreUnique();
    reseau(sagaGoogle(t, 12));
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher(t, 'titre');

    // Le groupe est incomplet (douze cartes, dix requetes au plus) : la regle
    // « chaque carte a une date connue » interdit toute deduction.
    expect(resultats.filter((c) => c.cycleTome !== undefined)).toHaveLength(0);
  });

  it('ce qui est deja en memoire est GRATUIT : la 2e recherche ne repose pas les memes questions', async () => {
    const t = titreUnique();
    reseau(sagaGoogle(t, 6));
    let books = await import('../src/books.js');
    await books.rechercher(t, 'titre');
    const premiere = requetesOL().length;
    expect(premiere).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 50));   // les ecritures de memoire ne sont pas attendues

    vi.resetModules();                              // memoire vive vide : seul l'appareil se souvient
    books = await import('../src/books.js');
    appels.length = 0;
    await books.rechercher(t + ' bis', 'titre');

    expect(requetesOL().length).toBeLessThan(premiere);
  });

  it('les editions d-une meme oeuvre ne coutent qu-une requete de date', async () => {
    const t = titreUnique();
    // Six cartes, mais DEUX oeuvres : l'identifiant d'oeuvre est derive des trois
    // derniers chiffres de l'ISBN, on force donc deux valeurs.
    const items = sagaGoogle(t, 6).map((it, i) => ({
      ...it,
      volumeInfo: { ...it.volumeInfo, industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782000000' + (i < 3 ? '777' : '888') }] },
    }));
    // Meme ISBN = une seule fiche : on les distingue par la 4e position.
    items.forEach((it, i) => { it.volumeInfo.industryIdentifiers[0].identifier = '97820000' + String(i).padStart(2, '0') + (i < 3 ? '777' : '888'); });
    reseau(items);
    const books = await import('../src/books.js');

    await books.rechercher(t, 'titre');

    const dates = requetesOL().filter((u) => u.includes('key%3A%2Fworks'));
    expect(dates.length).toBeLessThanOrEqual(2);
  });

  it('une recherche sans saga ne fait aucune requete de tome', async () => {
    const t = titreUnique();
    reseau(sagaGoogle(t, 2));   // deux cartes seulement : sous le seuil de trois
    const books = await import('../src/books.js');

    await books.rechercher(t, 'titre');

    expect(requetesOL()).toHaveLength(0);
  });
});
