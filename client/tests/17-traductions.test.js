/*
 * FAMILLE 17 — LES TRADUCTIONS FUSIONNENT
 *
 * Mission « recherche satisfaisante », etape 5 (decision 2).
 *
 * Critere de Kinder : « Quand je cherche Harry Potter, les livres de la saga
 * qu'Open Library sait relier ne s'affichent plus une fois en francais et une
 * fois en anglais : une seule carte, avec l'edition francaise en premier. »
 *
 * RESULTAT PARTIEL, ASSUME : Open Library relie les livres celebres (Harry
 * Potter : 12 ISBN sur 14) et presque aucun livre recent. Sans sa confirmation,
 * deux cartes restent deux cartes. Aucun appel reseau reel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fusionnerDoublons } from '../src/books.js';

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
const fiche = (titre, langue, plus = {}) => ({
  cleSource: `gb:${(n += 1)}`, source: 'google', titre, sousTitre: null, auteurs: ['J.K. Rowling'],
  couvertureUrl: null, resume: null, editeur: null, isbn13: null, isbn10: null,
  nbPages: null, categories: [], langue, annee: '2015', ...plus,
});

describe('La fusion par l-oeuvre d-Open Library (etape 5)', () => {
  it('une traduction rattachee a la meme oeuvre fusionne, l-edition francaise en vitrine', () => {
    const en = fiche("Harry Potter and the Philosopher's Stone", 'en', { oeuvreOL: 'ol:OL82563W' });
    const fr = fiche("Harry Potter à l'école des sorciers", 'fr', { oeuvreOL: 'ol:OL82563W' });
    const cartes = fusionnerDoublons([en, fr], "harry potter and the philosopher's stone");
    expect(cartes).toHaveLength(1);
    expect(cartes[0].titre).toBe("Harry Potter à l'école des sorciers");   // meme si la requete colle a l'anglais
    expect(cartes[0].clesSource).toHaveLength(2);
  });

  it('l-ordre d-arrivee ne change rien', () => {
    const en = fiche('Harry Potter and the Goblet of Fire', 'en', { oeuvreOL: 'ol:OL82560W' });
    const fr = fiche('Harry Potter et la Coupe de Feu', 'fr', { oeuvreOL: 'ol:OL82560W' });
    expect(fusionnerDoublons([fr, en], 'harry potter')).toHaveLength(1);
    expect(fusionnerDoublons([en, fr], 'harry potter')).toHaveLength(1);
  });

  it('SANS l-oeuvre d-Open Library, deux titres differents restent deux cartes', () => {
    const en = fiche("Harry Potter and the Philosopher's Stone", 'en');
    const fr = fiche("Harry Potter à l'école des sorciers", 'fr');
    expect(fusionnerDoublons([en, fr], 'harry potter')).toHaveLength(2);
  });

  it('deux oeuvres Open Library DIFFERENTES restent deux cartes', () => {
    const a = fiche('Harry Potter et la Coupe de Feu', 'fr', { oeuvreOL: 'ol:OL82560W' });
    const b = fiche('Harry Potter et la Chambre des Secrets', 'fr', { oeuvreOL: 'ol:OL82537W' });
    expect(fusionnerDoublons([a, b], 'harry potter')).toHaveLength(2);
  });

  it('un coffret colle sur le 1er tome par Open Library ne fusionne PAS', () => {
    const livre = fiche("Harry Potter à l'école des sorciers", 'fr', { oeuvreOL: 'ol:OL82563W' });
    const coffret = fiche('Harry Potter - Coffret', 'fr', { oeuvreOL: 'ol:OL82563W' });
    const box = fiche('Harry Potter Box Set', 'en', { oeuvreOL: 'ol:OL82563W' });
    const serie = fiche('Harry Potter', 'en', { oeuvreOL: 'ol:OL82563W', sousTitre: 'The Complete Series' });
    expect(fusionnerDoublons([livre, coffret, box, serie], 'harry potter')).toHaveLength(4);
  });

  it('deux tomes differents ne fusionnent jamais, meme avec la meme oeuvre', () => {
    const t2 = fiche('Le Seigneur des Anneaux T2 Les deux tours', 'fr', { oeuvreOL: 'ol:OL1W', auteurs: ['J.R.R. Tolkien'] });
    const t3 = fiche('Le Seigneur des Anneaux T3 Le retour du roi', 'fr', { oeuvreOL: 'ol:OL1W', auteurs: ['J.R.R. Tolkien'] });
    expect(fusionnerDoublons([t2, t3], 'le seigneur des anneaux')).toHaveLength(2);
  });

  it('deux auteurs differents ne fusionnent pas, meme avec la meme oeuvre', () => {
    const a = fiche('Un titre', 'fr', { oeuvreOL: 'ol:OL9W', auteurs: ['Laurent Mauvignier'] });
    const b = fiche('Un autre titre', 'en', { oeuvreOL: 'ol:OL9W', auteurs: ['Claude Gutman'] });
    expect(fusionnerDoublons([a, b], 'titre')).toHaveLength(2);
  });

  it('refondre une liste deja fondue, avec une 3e edition, la rattache encore', () => {
    const en = fiche("Harry Potter and the Philosopher's Stone", 'en', { oeuvreOL: 'ol:OL82563W' });
    const fr = fiche("Harry Potter à l'école des sorciers", 'fr', { oeuvreOL: 'ol:OL82563W' });
    const premiere = fusionnerDoublons([en, fr], 'harry potter');
    const es = fiche('Harry Potter y la piedra filosofal', 'es', { oeuvreOL: 'ol:OL82563W' });
    expect(fusionnerDoublons([...premiere, es], 'harry potter')).toHaveLength(1);
  });

  it('la vitrine reste le meilleur classement quand aucune edition n-est francaise', () => {
    const en = fiche('Harry Potter and the Goblet of Fire', 'en', { oeuvreOL: 'ol:OL82560W' });
    const es = fiche('Harry Potter y el caliz de fuego', 'es', { oeuvreOL: 'ol:OL82560W' });
    const [carte] = fusionnerDoublons([es, en], 'harry potter and the goblet of fire');
    expect(carte.titre).toBe('Harry Potter and the Goblet of Fire');
  });
});

// ---------------------------------------------------------------------------

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });
const noXml = '<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>';

let appels;
beforeEach(() => { faux.clear(); appels = []; localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

const volume = (id, titre, langue, isbn) => ({
  id,
  volumeInfo: {
    title: titre, authors: ['J.K. Rowling'], publishedDate: '2015', language: langue,
    imageLinks: { thumbnail: 'http://x/' + id },
    industryIdentifiers: isbn ? [{ type: 'ISBN_13', identifier: isbn }] : [],
  },
});

/** `isbnOL(isbn)` repond aux appels /isbn/ d'Open Library. */
function reseau({ volumes, isbnOL }) {
  vi.stubGlobal('fetch', (url) => {
    const u = String(url);
    appels.push(u);
    if (u.includes('openlibrary.org/isbn/')) return Promise.resolve(isbnOL(u.match(/isbn\/(\d+)/)[1]));
    if (u.includes('openlibrary.org')) return Promise.resolve(ok({ docs: [] }));
    if (u.includes('bnf.fr')) return Promise.resolve(new Response(noXml, { status: 200 }));
    return Promise.resolve(ok({ items: volumes }));
  });
}
const appelsIsbn = () => appels.filter((u) => u.includes('openlibrary.org/isbn/'));
const edition = (oeuvre) => ok({ key: '/books/OL1M', works: [{ key: `/works/${oeuvre}` }], publishers: ['X'] });

let numero = 0;
const titre = () => { numero += 1; return `pierre philosophale cas${numero}`; };
const jeu = () => [
  volume('v1', "Harry Potter and the Philosopher's Stone", 'en', '9780747532743'),
  volume('v2', "Harry Potter à l'école des sorciers", 'fr', '9782070541270'),
];

describe('Rattacher les fiches a leur oeuvre, de bout en bout (etape 5)', () => {
  it('fond l-edition anglaise et l-edition francaise quand Open Library les relie', async () => {
    reseau({ volumes: jeu(), isbnOL: () => edition('OL82563W') });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher(titre(), 'titre');

    expect(resultats).toHaveLength(1);
    expect(resultats[0].titre).toBe("Harry Potter à l'école des sorciers");
  });

  it('ne fait AUCUN appel a Open Library quand une seule langue est presente', async () => {
    reseau({
      volumes: [volume('a1', 'Livre un', 'fr', '9782070000011'), volume('a2', 'Livre deux', 'fr', '9782070000028')],
      isbnOL: () => edition('OL1W'),
    });
    const books = await import('../src/books.js');

    await books.rechercher(titre(), 'titre');

    expect(appelsIsbn()).toHaveLength(0);
  });

  it('plafonne les appels a Open Library a 12 par recherche', async () => {
    const beaucoup = Array.from({ length: 20 }, (_, i) =>
      volume('m' + i, 'Livre tome ' + (i + 1), i % 2 ? 'fr' : 'en', '97820700' + String(10000 + i)));
    reseau({ volumes: beaucoup, isbnOL: () => edition('OL1W') });
    const books = await import('../src/books.js');

    await books.rechercher(titre(), 'titre');

    expect(appelsIsbn().length).toBeLessThanOrEqual(12);
  });

  it('une edition inconnue d-Open Library (404) ne fusionne rien, et la reponse est memorisee', async () => {
    const t = titre();
    reseau({ volumes: jeu(), isbnOL: () => new Response('', { status: 404 }) });
    let books = await import('../src/books.js');
    const { resultats } = await books.rechercher(t, 'titre');
    expect(resultats).toHaveLength(2);
    expect(appelsIsbn().length).toBe(2);

    // Une 2e recherche, memoire vide : l'appareil se souvient que c'est inconnu.
    vi.resetModules();
    books = await import('../src/books.js');
    appels.length = 0;
    await books.rechercher(t + ' bis', 'titre');
    expect(appelsIsbn()).toHaveLength(0);
  });

  it('une PANNE d-Open Library n-est jamais memorisee : la fois suivante, on redemande', async () => {
    const t = titre();
    reseau({ volumes: jeu(), isbnOL: () => new Response('', { status: 500 }) });
    let books = await import('../src/books.js');
    const { resultats } = await books.rechercher(t, 'titre');
    expect(resultats).toHaveLength(2);   // la recherche s'affiche quand meme

    vi.resetModules();
    books = await import('../src/books.js');
    appels.length = 0;
    await books.rechercher(t + ' bis', 'titre');
    expect(appelsIsbn().length).toBeGreaterThan(0);
  });

  it('n-attend pas Open Library au-dela de 3,5 s', async () => {
    reseau({
      volumes: jeu(),
      isbnOL: () => new Promise((fin) => setTimeout(() => fin(edition('OL82563W')), 6000)),
    });
    const books = await import('../src/books.js');

    const debut = Date.now();
    const { resultats } = await books.rechercher(titre(), 'titre');
    const duree = Date.now() - debut;

    expect(resultats).toHaveLength(2);        // pas de reponse a temps : rien n'est fusionne
    expect(duree).toBeLessThan(5000);
  }, 12000);

  it('la 2e recherche profite de ce qui est arrive apres le delai', async () => {
    const t = titre();
    reseau({
      volumes: jeu(),
      isbnOL: () => new Promise((fin) => setTimeout(() => fin(edition('OL82563W')), 4000)),
    });
    const books = await import('../src/books.js');
    await books.rechercher(t, 'titre');                       // trop lent : deux cartes
    await new Promise((r) => setTimeout(r, 1500));            // les reponses arrivent en fond

    const { resultats } = await books.rechercher(t + ' bis', 'titre');
    expect(resultats).toHaveLength(1);
  }, 15000);
});
