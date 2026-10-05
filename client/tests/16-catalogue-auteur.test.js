/*
 * FAMILLE 16 — LA RECHERCHE PAR AUTEUR ET LES RESUMES PAR LE CATALOGUE VAULT BOOKS (tranche 33, suite)
 *
 * Trois promesses :
 *   1. en mode Auteur, le catalogue rend la bibliographie (sagas depliees, livres isoles), sans « page suivante » (nbSource 0) ;
 *   2. auteur inconnu du service, ou toute defaillance : Google reprend la main, sans erreur de plus ;
 *   3. le resume rendu par /v1/isbn arrive dans la fiche.
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

const tomes = Array.from({ length: 12 }, (_, i) => ({
  position: i + 1, disponible: true, aParaitre: false, titre: `Tome ${i + 1}`, isbn13: null, livre: { id: 5000 + i },
  edition: { isbn13: `97827499100${String(i).padStart(2, '0')}`, titre: `Tome ${i + 1}`, editeur: 'Lafon', date: '2005', couverture: { url: null } },
}));

const reponseAuteur = {
  auteur: { id: 7, nom: 'Anne Robillard', livres: 40 },
  resultats: [
    { type: 'serie', id: 25608, titre: "Les Chevaliers d'Émeraude", auteurs: ['Anne Robillard'], score: 900 },
    { type: 'livre', id: 321, titre: 'Les Héritiers', auteurs: ['Anne Robillard'], score: 500 },
  ],
};
const googleAuteur = { items: [{ id: 'g1', volumeInfo: { title: 'Un livre', authors: ['Quelqu Un'], publishedDate: '2001' } }] };

let appels;
function reseau(fn) {
  vi.stubGlobal('fetch', (url) => {
    appels.push(String(url));
    return Promise.resolve(fn(String(url)));
  });
}
const catalogue = (url) => {
  if (url.includes('/v1/series/')) return ok({ id: 25608, nom: "Les Chevaliers d'Émeraude", total: 12, tomes });
  if (url.includes('mode=auteur')) return ok(reponseAuteur);
  if (url.includes('googleapis.com')) return ok(googleAuteur);
  return new Response('{}', { status: 503 });
};
const deCatalogue = () => appels.filter((u) => u.startsWith('https://catalogue.test'));

beforeEach(() => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('rechercherAuteur', () => {
  it('interroge le service en mode auteur avec la langue du catalogue', async () => {
    reseau(catalogue);
    const { rechercherAuteur } = await import('../src/sources/vaultapi.js');
    await rechercherAuteur('Anne Robillard');
    expect(deCatalogue()[0]).toBe('https://catalogue.test/v1/search?q=Anne%20Robillard&lang=fr&mode=auteur');
  });

  it('deplie les sagas, borne a 8 tomes par saga, et garde les livres isoles', async () => {
    reseau(catalogue);
    const { rechercherAuteur } = await import('../src/sources/vaultapi.js');
    const { resultats, auteur } = await rechercherAuteur('Anne Robillard');
    expect(auteur.nom).toBe('Anne Robillard');
    expect(resultats.filter((r) => r.serie && r.serie.id === 25608)).toHaveLength(8);
    expect(resultats.some((r) => r.cleSource === 'vb:321')).toBe(true);
  });

  it('auteur inconnu : aucun resultat et auteur null', async () => {
    reseau(() => ok({ auteur: null, resultats: [] }));
    const { rechercherAuteur } = await import('../src/sources/vaultapi.js');
    expect(await rechercherAuteur('Zzzz')).toEqual({ resultats: [], auteur: null });
  });
});

describe('books.rechercher en mode Auteur', () => {
  it('le catalogue repond : sa bibliographie, nbSource 0, Google non appele', async () => {
    reseau(catalogue);
    const books = await import('../src/books.js');
    const r = await books.rechercher('Anne Robillard', 'auteur');
    expect(r.nbSource).toBe(0);
    expect(r.resultats.every((x) => x.source === 'vaultapi')).toBe(true);
    expect(appels.some((u) => u.includes('googleapis.com'))).toBe(false);
  });

  it('auteur inconnu : Google reprend la main', async () => {
    reseau((url) => (url.includes('catalogue.test') ? ok({ auteur: null, resultats: [] }) : ok(googleAuteur)));
    const books = await import('../src/books.js');
    const r = await books.rechercher('Quelqu Un', 'auteur');
    expect(r.resultats[0].source).toBe('google');
  });

  it('catalogue coupe (503) : Google reprend la main', async () => {
    reseau((url) => (url.includes('catalogue.test') ? new Response('{}', { status: 503 }) : ok(googleAuteur)));
    const books = await import('../src/books.js');
    const r = await books.rechercher('Quelqu Un', 'auteur');
    expect(r.resultats[0].source).toBe('google');
  });

  it('seule la premiere page passe par le catalogue', async () => {
    reseau((url) => (url.includes('catalogue.test') ? ok(reponseAuteur) : ok(googleAuteur)));
    const books = await import('../src/books.js');
    await books.rechercher('Anne Robillard', 'auteur', 1).catch(() => {});
    expect(deCatalogue().filter((u) => u.includes('mode=auteur'))).toHaveLength(0);
  });
});

describe('Resume par ISBN', () => {
  it('le resume du service arrive dans la fiche, null s-il manque', async () => {
    const base = { trouve: true, isbn13: '9782749910147', titre: 'x', auteurs: [], livre: { id: 1 }, couverture: { url: null } };
    reseau(() => ok({ ...base, resume: 'Un resume.' }));
    let { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    expect((await rechercherIsbn('9782749910147')).resume).toBe('Un resume.');

    vi.resetModules();
    reseau(() => ok(base));
    ({ rechercherIsbn } = await import('../src/sources/vaultapi.js'));
    expect((await rechercherIsbn('9782749910147')).resume).toBeNull();
  });
});
