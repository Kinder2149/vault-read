/*
 * FAMILLE 18 — HORS LIGNE : LES RECHERCHES DU CATALOGUE SONT ARCHIVEES (tranche 33, phase 3)
 *
 * Une recherche deja faite doit ressortir sans reseau, annoncee « ancienne ». Regles :
 *   1. l'archive n'est LUE que lorsque le catalogue ET le chemin historique sont tombes (le classement ne se fige jamais) ;
 *   2. elle est propre a la langue du catalogue ;
 *   3. sans archive, l'erreur d'avant reste l'erreur d'avant.
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
const reponse = { langueNonDisponible: false, resultats: [{ type: 'livre', id: 1, titre: 'Dune', auteurs: ['Frank Herbert'], couverture: null, score: 90 }] };
const reponseAuteur = { auteur: { id: 3, nom: 'Frank Herbert', livres: 20 }, langueNonDisponible: false, resultats: reponse.resultats };

let enLigne;
beforeEach(() => {
  faux.clear();
  enLigne = true;
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
  vi.stubGlobal('fetch', (url) => {
    url = String(url);
    if (!enLigne) return Promise.reject(new TypeError('Failed to fetch'));
    if (url.includes('mode=auteur')) return Promise.resolve(ok(reponseAuteur));
    if (url.includes('catalogue.test')) return Promise.resolve(ok(reponse));
    return Promise.resolve(new Response('{}', { status: 503 }));
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const attendreArchive = () => vi.waitFor(() => expect([...faux.keys()].some((k) => k.includes('vb:fr:'))).toBe(true));

describe('Recherche deja faite, puis plus de reseau', () => {
  it('par titre : les resultats reviennent, annonces anciens', async () => {
    const books = await import('../src/books.js');
    const premiere = await books.rechercher('Dune', 'titre');
    expect(premiere.ancien).toBe(false);
    await attendreArchive();

    enLigne = false;
    const hors = await books.rechercher('dune', 'titre');
    expect(hors.ancien).toBe(true);
    expect(hors.nbSource).toBe(0);
    expect(hors.resultats.map((r) => r.titre)).toEqual(['Dune']);
    expect(hors.pose).toBe(premiere.pose);
  }, 30000);

  it('par auteur aussi', async () => {
    const books = await import('../src/books.js');
    await books.rechercher('Frank Herbert', 'auteur');
    await attendreArchive();

    enLigne = false;
    const hors = await books.rechercher('frank herbert', 'auteur');
    expect(hors.ancien).toBe(true);
    expect(hors.resultats).toHaveLength(1);
  }, 30000);

  it('jamais d-archive tant que le catalogue repond : la recherche est refaite', async () => {
    const books = await import('../src/books.js');
    await books.rechercher('Dune', 'titre');
    await attendreArchive();
    const appels = [];
    vi.stubGlobal('fetch', (url) => { appels.push(String(url)); return Promise.resolve(ok(reponse)); });
    const r = await books.rechercher('Dune', 'titre');
    expect(r.ancien).toBe(false);
    expect(appels.some((u) => u.includes('catalogue.test/v1/search'))).toBe(true);
  });

  it('sans archive, l-erreur de la recherche historique remonte comme avant', async () => {
    enLigne = false;
    const books = await import('../src/books.js');
    await expect(books.rechercher('jamais cherche', 'titre')).rejects.toThrow();
  }, 30000);

  it('l-archive est celle de la langue du catalogue', async () => {
    const books = await import('../src/books.js');
    await books.rechercher('Dune', 'titre');
    await attendreArchive();

    books.definirLangueCatalogue('en');
    enLigne = false;
    await expect(books.rechercher('dune', 'titre')).rejects.toThrow();
  }, 30000);
});
