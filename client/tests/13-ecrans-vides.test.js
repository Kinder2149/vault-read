/*
 * FAMILLE 13 — FINI LES ECRANS VIDES
 *
 * Mission « recherche satisfaisante », etape 1 (decision 1, 2026-10-04).
 *
 * Critere de Kinder : « Quand Google ne trouve rien pour ma recherche, je vois
 * quand meme des livres, ou le message "Aucun livre trouve" — jamais un ecran
 * vide sans explication. »
 *
 * Le defaut mesure le 2026-10-04 : Google repond 200 avec ZERO volume, sans
 * erreur, pour `inauthor:`, `isbn:` et certains `intitle:`. Le filet BnF ne
 * partait que sur une erreur, donc l'ecran restait vide.
 *
 * AUCUN appel reseau reel : un Google muet est simule. Voir la famille 3 pour
 * la raison.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const faux = new Map();
vi.mock('idb-keyval', () => ({
  get: async (k) => faux.get(k),
  set: async (k, v) => { faux.set(k, v); },
  del: async (k) => { faux.delete(k); },
  keys: async () => [...faux.keys()],
  delMany: async (cles) => { cles.forEach((k) => faux.delete(k)); },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });
const okXml = (xml) => new Response(xml, { status: 200 });
const muet = () => ok({ kind: 'books#volumes', totalItems: 0 });   // 200, zero volume, pas d'items

function reponseGoogle(titres) {
  return {
    items: titres.map((t, i) => ({
      id: 'v' + i + t.length,
      volumeInfo: {
        title: t,
        authors: ['Emile Zola'],
        publishedDate: '1885',
        imageLinks: { thumbnail: 'http://books.google.com/img' + i },
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '978000000000' + i }],
      },
    })),
  };
}

const NOTICE_BNF = `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
<srw:numberOfRecords>1</srw:numberOfRecords>
<srw:records><srw:record><srw:recordData><oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Germinal / Émile Zola</dc:title>
  <dc:creator>Zola, Émile (1840-1902). Auteur du texte</dc:creator>
  <dc:date>1885</dc:date>
  <dc:publisher>Charpentier (Paris)</dc:publisher>
  <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb123456789</dc:identifier>
  <dc:identifier>ISBN 2-07-036939-6</dc:identifier>
  <dc:language>fre</dc:language>
  <dc:type>text</dc:type>
</oai_dc:dc></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>`;
const BNF_VIDE = `<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>`;

let appels;

beforeEach(() => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * Faux reseau aiguille par source.
 * `google(url)` repond aux appels Google ; la BnF et Open Library ont leur reponse.
 */
function reseau({ google, bnf = BNF_VIDE }) {
  vi.stubGlobal('fetch', (url) => {
    const u = String(url);
    appels.push(u);
    if (u.includes('openlibrary.org')) return Promise.resolve(ok({ docs: [] }));
    if (u.includes('bnf.fr')) return Promise.resolve(okXml(bnf));
    return Promise.resolve(google(u));
  });
}
const appelsGoogle = () => appels.filter((u) => u.includes('googleapis.com/books'));
const requeteDe = (u) => new URL(u).searchParams.get('q');

describe('Un « 0 resultat » de Google vaut une panne (etape 1)', () => {
  it('pose la question librement quand intitle: revient vide, et affiche des livres', async () => {
    reseau({ google: (u) => (requeteDe(u).startsWith('intitle:') ? muet() : ok(reponseGoogle(['Germinal', 'Germinal : roman']))) });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('ecran vide un', 'titre');

    expect(resultats.length).toBeGreaterThan(0);
    const questions = appelsGoogle().map(requeteDe);
    expect(questions[0]).toBe('intitle:ecran vide un');
    expect(questions[1]).toBe('ecran vide un');   // le texte tape, sans operateur
  });

  it('pose la question librement aussi pour une recherche PAR AUTEUR', async () => {
    reseau({ google: (u) => (requeteDe(u).startsWith('inauthor:') ? muet() : ok(reponseGoogle(['Germinal']))) });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('emile zola auteur', 'auteur');

    expect(resultats.length).toBeGreaterThan(0);
    expect(appelsGoogle().map(requeteDe)[1]).toBe('emile zola auteur');
  });

  it('se rabat sur la BnF quand Google est muet MEME en question libre', async () => {
    reseau({ google: () => muet(), bnf: NOTICE_BNF });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('germinal bnf', 'titre');

    expect(resultats.length).toBe(1);
    expect(resultats[0].source).toBe('bnf');
  });

  it('rend une liste vide, sans erreur, quand TOUT est vide (le message « Aucun livre trouve » prend la suite)', async () => {
    reseau({ google: () => muet(), bnf: BNF_VIDE });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('zzzqqq introuvable', 'titre');

    expect(resultats).toEqual([]);
  });

  it('traite une panne de la question libre comme un vide : la BnF prend la suite', async () => {
    reseau({
      google: (u) => (requeteDe(u).startsWith('intitle:') ? muet() : new Response('{}', { status: 500 })),
      bnf: NOTICE_BNF,
    });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('germinal panne', 'titre');

    expect(resultats.length).toBe(1);
  });

  it('NE REPLIE PAS sur une page suivante vide : c-est la fin des resultats', async () => {
    reseau({ google: () => muet() });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('fin des resultats', 'titre', 1);

    expect(resultats).toEqual([]);
    expect(appelsGoogle().length).toBe(1);   // aucune question libre
  });

  it('ne change RIEN quand Google repond normalement : une seule question', async () => {
    reseau({ google: () => ok(reponseGoogle(['Germinal'])) });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('germinal normal', 'titre');

    expect(resultats.length).toBeGreaterThan(0);
    expect(appelsGoogle().length).toBe(1);
  });

  it('NE MEMORISE PAS un resultat de repli : la recherche suivante redemande a Google', async () => {
    let google = (u) => (requeteDe(u).startsWith('intitle:') ? muet() : ok(reponseGoogle(['Germinal'])));
    reseau({ google: (u) => google(u) });
    const books = await import('../src/books.js');

    await books.rechercher('pas de cache repli', 'titre');
    expect([...faux.keys()].filter((k) => k.includes('pas de cache repli'))).toEqual([]);   // rien d'archive

    // Google redevient normal : la meme recherche doit en profiter tout de suite.
    google = () => ok(reponseGoogle(['Germinal', 'Germinal (illustre)', 'Autre edition']));
    appels.length = 0;
    const { resultats } = await books.rechercher('pas de cache repli', 'titre');

    expect(appelsGoogle().map(requeteDe)[0]).toBe('intitle:pas de cache repli');
    expect(resultats.length).toBeGreaterThan(0);
  });
});
