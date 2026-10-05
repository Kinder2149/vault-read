/*
 * FAMILLE 15 — LE SCAN D'ISBN PAR LE CATALOGUE VAULT BOOKS (tranche 33, suite)
 *
 * Un code-barres designe UNE edition. Le catalogue rend son editeur, sa date, sa PAGINATION EXACTE (celle qui sert a la progression, §5.4)
 * et la couverture de cette edition. Trois promesses, comme pour la recherche par titre (famille 13) :
 *   1. ce qu'il rend devient un resultat complet, avec une cle qui permet ensuite de proposer les autres editions du livre ;
 *   2. un ISBN qu'il ne connait pas, ou toute defaillance, laisse la main a Google, Open Library et la BnF — sans erreur de plus ;
 *   3. il est interroge avec l'ISBN en chiffres seuls, jamais filtre par la langue du catalogue.
 *
 * Aucun appel reseau reel.
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

// Ce que rend le VRAI service pour /v1/isbn/9782749910147 (reponse reelle du 2026-10-05).
const scanLafon = {
  trouve: true, isbn13: '9782749910147', titre: 'Les dieux déchus', auteurs: ['Anne Robillard'], editeur: 'Michel Lafon', date: '2009-05-14',
  langue: 'fr', nbPages: 435, format: 'Paperback', couverture: { url: 'https://assets.hardcover.app/e.jpeg', source: 'hardcover', approximative: false, basseDefinition: false },
  livre: { id: 1099977, titre: 'Les dieux déchus' }, serie: { id: 25608, nom: "Les Chevaliers d'Émeraude", position: 8, total: 12 }, sources: ['hardcover'],
};
const googleFourmis = { items: [{ id: 'vol1', volumeInfo: { title: 'Les fourmis', authors: ['Bernard Werber'], publishedDate: '1991',
  industryIdentifiers: [{ type: 'ISBN_13', identifier: '9782226052575' }] } }] };

let appels;
function reseau(fn) {
  vi.stubGlobal('fetch', (url) => {
    appels.push(String(url));
    return Promise.resolve(fn(String(url)));
  });
}
const catalogueSeul = (url) => {
  if (url.includes('catalogue.test/v1/isbn/9782749910147')) return ok(scanLafon);
  if (url.includes('catalogue.test')) return new Response('{"erreur":"ISBN inconnu."}', { status: 404 });
  if (url.includes('googleapis.com')) return ok(googleFourmis);
  return new Response('{}', { status: 503 });
};
const deCatalogue = () => appels.filter((u) => u.startsWith('https://catalogue.test'));
const deGoogle = () => appels.filter((u) => u.includes('googleapis.com'));

beforeEach(() => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Ce que le catalogue rend pour un code-barres', () => {
  it('une fiche complete : editeur, date, pagination exacte, couverture de l-edition, saga et cle propre au livre', async () => {
    reseau(catalogueSeul);
    const { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    const r = await rechercherIsbn('9782749910147');
    expect(r).toMatchObject({
      cleSource: 'vb:1099977:9782749910147', source: 'vaultapi', titre: 'Les dieux déchus', auteurs: ['Anne Robillard'],
      editeur: 'Michel Lafon', datePublication: '2009-05-14', annee: '2009', langue: 'fr', isbn13: '9782749910147',
      nbPages: 435, couvertureUrl: 'https://assets.hardcover.app/e.jpeg', couvertureApproximative: false,
      serie: { id: 25608, nom: "Les Chevaliers d'Émeraude", position: 8, total: 12 },
    });
  });

  it('sans livre connu (notice de la BnF), la cle est celle de l-edition seule', async () => {
    const bnf = { ...scanLafon, livre: null, serie: null, nbPages: null, sources: ['bnf'], isbn13: '9791022400640' };
    reseau(() => ok(bnf));
    const { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    const r = await rechercherIsbn('9791022400640');
    expect(r.cleSource).toBe('vbe:9791022400640');
    expect(r.nbPages).toBeNull();
    expect(r.serie).toBeUndefined();
  });

  it('un ISBN inconnu du service rend null', async () => {
    reseau(catalogueSeul);
    const { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    expect(await rechercherIsbn('9780000000002')).toBeNull();
  });

  it('une couverture approximative est signalee', async () => {
    reseau(() => ok({ ...scanLafon, couverture: { url: 'https://img/livre.jpg', source: 'hardcover-livre', approximative: true } }));
    const { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    expect((await rechercherIsbn('9782749910147')).couvertureApproximative).toBe(true);
  });
});

describe('books.rechercher en mode ISBN : le catalogue d-abord, le repli ensuite', () => {
  it('le catalogue connait l-ISBN : un seul resultat, et ni Google, ni Open Library, ni la BnF ne sont appeles', async () => {
    reseau(catalogueSeul);
    const books = await import('../src/books.js');
    const r = await books.rechercher('9782749910147', 'isbn');
    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0].source).toBe('vaultapi');
    expect(r.resultats[0].nbPages).toBe(435);
    expect(appels.every((u) => u.startsWith('https://catalogue.test'))).toBe(true);
  });

  it('l-ISBN part en chiffres seuls (tirets et espaces retires), sans parametre de langue', async () => {
    reseau(catalogueSeul);
    const books = await import('../src/books.js');
    await books.rechercher('978-2-7499-1014-7', 'isbn');
    expect(deCatalogue()).toEqual(['https://catalogue.test/v1/isbn/9782749910147']);
  });

  it('un ISBN-10 est transmis tel quel : la conversion est l-affaire du service', async () => {
    reseau(() => ok(scanLafon));
    const books = await import('../src/books.js');
    await books.rechercher('2226052577', 'isbn');
    expect(deCatalogue()).toEqual(['https://catalogue.test/v1/isbn/2226052577']);
  });

  it('le catalogue ne connait pas l-ISBN (404) : Google prend le relais', async () => {
    reseau(catalogueSeul);
    const books = await import('../src/books.js');
    const r = await books.rechercher('9782226052575', 'isbn');
    expect(r.resultats[0].source).toBe('google');
    expect(r.resultats[0].titre).toBe('Les fourmis');
    expect(deGoogle().length).toBeGreaterThan(0);
  });

  it('le catalogue est coupe (503) : Google prend le relais', async () => {
    reseau((url) => (url.includes('catalogue.test') ? new Response('{}', { status: 503 }) : ok(googleFourmis)));
    const books = await import('../src/books.js');
    const r = await books.rechercher('9782226052575', 'isbn');
    expect(r.resultats[0].source).toBe('google');
  });

  it('le catalogue ne repond pas (reseau coupe) : Google prend le relais', async () => {
    reseau((url) => (url.includes('catalogue.test') ? Promise.reject(new TypeError('Failed to fetch')) : ok(googleFourmis)));
    const books = await import('../src/books.js');
    const r = await books.rechercher('9782226052575', 'isbn');
    expect(r.resultats[0].source).toBe('google');
  });

  it('cle d-application refusee (401) : Google prend le relais', async () => {
    reseau((url) => (url.includes('catalogue.test') ? new Response('{}', { status: 401 }) : ok(googleFourmis)));
    const books = await import('../src/books.js');
    const r = await books.rechercher('9782226052575', 'isbn');
    expect(r.resultats[0].source).toBe('google');
  });

  it('catalogue coupe par l-utilisateur, ou non configure : il n-est jamais appele', async () => {
    reseau(catalogueSeul);
    let books = await import('../src/books.js');
    books.definirCatalogueApiActif(false);
    await books.rechercher('9782749910147', 'isbn').catch(() => {});
    expect(deCatalogue()).toHaveLength(0);

    vi.resetModules();
    vi.stubEnv('VITE_VAULT_API_URL', '');
    appels = [];
    books = await import('../src/books.js');
    await books.rechercher('9782749910147', 'isbn').catch(() => {});
    expect(deCatalogue()).toHaveLength(0);
  });
});

describe('Proposer les autres editions d-un livre scanne', () => {
  it('la cle d-un livre scanne (vb:<livre>:<isbn>) comme celle d-un livre cherche (vb:<livre>) permettent de retrouver le livre', async () => {
    reseau(() => ok({ id: 1099977, titre: 'x', titreLangue: 'x', auteurs: [], langue: 'fr', editions: [{ isbn13: '9782749910147', titre: 'x', editeur: 'Lafon', date: '2009', couverture: { url: null } }] }));
    const { editionsDuCatalogue } = await import('../src/books.js');

    expect((await editionsDuCatalogue(['vb:1099977:9782749910147']))).toHaveLength(1);
    expect(deCatalogue()).toEqual(['https://catalogue.test/v1/books/1099977?lang=fr']);

    appels = [];
    expect((await editionsDuCatalogue(['gb:abc', 'vb:1099977']))).toHaveLength(1);
    expect(deCatalogue()).toEqual(['https://catalogue.test/v1/books/1099977?lang=fr']);
  });

  it('une edition sans livre connu (vbe:…) ou venue d-une autre source ne passe pas par le catalogue', async () => {
    reseau(() => ok({}));
    const { editionsDuCatalogue } = await import('../src/books.js');
    expect(await editionsDuCatalogue(['vbe:9791022400640', 'gb:abc', 'ol:OL1M'])).toBeNull();
    expect(deCatalogue()).toHaveLength(0);
  });
});
