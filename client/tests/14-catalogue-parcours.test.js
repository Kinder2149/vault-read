/*
 * FAMILLE 14 — LE CATALOGUE VAULT BOOKS, DE BOUT EN BOUT (tranche 33, suite)
 *
 * La famille 13 verifie les pieces : la source, la recherche, le repli. Celle-ci verifie des PARCOURS, avec la vraie base
 * (sql.js en memoire) et la vraie facade, comme la famille 4 :
 *   - les editions proposees pour un livre qui vient du catalogue viennent du catalogue, moins celles qu'on possede deja ;
 *   - elles retombent sur la BnF pour un livre ajoute par une autre source, ou quand le catalogue ne repond pas ;
 *   - un livre deja suivi — meme ajoute par Google — est reconnu sur le meme livre rendu par le catalogue (par l'ISBN).
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
vi.mock('sql.js', async () => {
  const vrai = await vi.importActual('sql.js');
  const { fileURLToPath } = await import('node:url');
  const chemin = fileURLToPath(new URL('../node_modules/sql.js/dist/sql-wasm.wasm', import.meta.url));
  return { default: (config = {}) => vrai.default({ ...config, locateFile: () => chemin }) };
});
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });

const resultat = (o = {}) => ({
  cleSource: 'vb:11', source: 'vaultapi', titre: 'Le Feu dans le ciel', sousTitre: null, auteurs: ['Anne Robillard'],
  annee: '2002', datePublication: '2002-01-01', couvertureUrl: null, resume: null, categories: [], langue: 'fr',
  isbn13: '9782890746626', isbn10: null, nbPages: null, editeur: 'Éditions de Mortagne', ...o,
});

// Ce que rend le VRAI service pour /v1/books/11 (reponse reelle du 2026-10-05, raccourcie).
const livreCatalogue = {
  id: 11, titre: 'Le Feu dans le ciel', titreLangue: 'Le Feu dans le ciel', auteurs: ['Anne Robillard'], langue: 'fr', sourceBnf: 'ok',
  editions: [
    { isbn13: '9782749962771', titre: 'Le feu dans le ciel (Édition collector)', editeur: 'Michel Lafon', date: '2025', sources: ['bnf'],
      couverture: { url: 'https://img/collector.jpg', source: 'openlibrary', approximative: false } },
    { isbn13: '9782749906256', titre: 'Le Feu dans le ciel', editeur: 'Michel Lafon', date: '2010-01-01', sources: ['hardcover', 'bnf'],
      couverture: { url: 'https://img/lafon.jpg', source: 'hardcover', approximative: false } },
    { isbn13: '9782890746626', titre: 'Le Feu dans le ciel', editeur: 'Éditions de Mortagne', date: '2002-01-01', sources: ['hardcover', 'bnf'],
      couverture: { url: 'https://img/mortagne.jpg', source: 'hardcover', approximative: false } },
    { isbn13: '9782298016727', titre: 'Le feu dans le ciel', editeur: 'France loisirs', date: '2008', sources: ['bnf'],
      couverture: { url: null, source: null, approximative: false } },
  ],
};

let appels;
function reseau(fn) {
  vi.stubGlobal('fetch', (url) => {
    appels.push(String(url));
    return Promise.resolve(fn(String(url)));
  });
}
const catalogue = (url) => (url.includes('/v1/books/11') ? ok(livreCatalogue) : new Response('{}', { status: 503 }));

let api;
let store;
let profil;

beforeEach(async () => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
  api = await import('../src/api.js');
  store = await import('../src/store.js');
  await api.demarrer();
  profil = await api.getActiveProfileId();
  for (const o of await store.getBibliotheque(profil)) await store.retirerOeuvre(profil, o.oeuvreId);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Les editions proposees pour un livre du catalogue', () => {
  it('viennent du catalogue, une par ISBN, avec leur couverture, MOINS celle qu-on possede deja', async () => {
    reseau(catalogue);
    const id = await api.ajouterOeuvre(resultat());
    const proposees = await api.getEditionsProposees(id);

    expect(proposees.map((p) => p.isbn13)).toEqual(['9782749962771', '9782749906256', '9782298016727']);   // pas la Mortagne : deja possedee
    expect(proposees[0]).toMatchObject({
      cleSource: 'vbe:9782749962771', source: 'vaultapi', editeur: 'Michel Lafon', couvertureUrl: 'https://img/collector.jpg', langue: 'fr',
    });
    expect(proposees[2].couvertureUrl).toBeNull();                       // aucune couverture trouvee : l'ecran dessine la sienne
    expect(appels.some((u) => u.includes('catalogue.test/v1/books/11'))).toBe(true);
    expect(appels.some((u) => u.includes('catalogue.bnf.fr'))).toBe(false);   // la BnF directe n'est pas interrogee
  });

  it('une edition proposee peut etre ajoutee a l-oeuvre, et n-est alors plus proposee', async () => {
    reseau(catalogue);
    const id = await api.ajouterOeuvre(resultat());
    const [collector] = await api.getEditionsProposees(id);
    await api.ajouterEdition(id, collector);

    expect((await api.getEditions(id)).map((e) => e.editionId)).toContain('vbe:9782749962771');
    expect((await api.getEditionsProposees(id)).map((p) => p.isbn13)).not.toContain('9782749962771');
  });

  it('le catalogue est coupe : la BnF directe prend le relais, comme avant', async () => {
    reseau((url) => (url.includes('catalogue.test') ? new Response('{}', { status: 503 }) : new Response('<srw:numberOfRecords>0</srw:numberOfRecords>', { status: 200 })));
    const id = await api.ajouterOeuvre(resultat());
    const proposees = await api.getEditionsProposees(id);
    expect(proposees).toEqual([]);
    expect(appels.some((u) => u.includes('catalogue.bnf.fr'))).toBe(true);
  });

  it('un livre ajoute par une autre source ne passe pas par le catalogue', async () => {
    reseau((url) => new Response('<srw:numberOfRecords>0</srw:numberOfRecords>', { status: 200 }));
    const id = await api.ajouterOeuvre(resultat({ cleSource: 'gb:abc', source: 'google' }));
    await api.getEditionsProposees(id);
    expect(appels.some((u) => u.includes('catalogue.test'))).toBe(false);
    expect(appels.some((u) => u.includes('catalogue.bnf.fr'))).toBe(true);
  });

  it('catalogue coupe par l-utilisateur : on ne l-appelle pas', async () => {
    reseau(catalogue);
    const id = await api.ajouterOeuvre(resultat());
    const books = await import('../src/books.js');
    books.definirCatalogueApiActif(false);
    await api.getEditionsProposees(id);
    expect(appels.some((u) => u.includes('catalogue.test'))).toBe(false);
  });
});

describe('Un livre deja suivi est reconnu, quelle que soit la source qui l-a fait entrer', () => {
  it('les cles de marquage portent l-ISBN de chaque edition suivie', async () => {
    reseau(catalogue);
    await api.ajouterOeuvre(resultat({ cleSource: 'gb:abc', source: 'google' }));
    const cles = await api.getClesEditions();
    expect(cles).toContain('gb:abc');
    expect(cles).toContain('isbn:9782890746626');
  });

  it('un livre ajoute via Google est marque suivi sur le MEME livre rendu par le catalogue', async () => {
    reseau(catalogue);
    await api.ajouterOeuvre(resultat({ cleSource: 'gb:abc', source: 'google' }));
    const suivies = new Set(await api.getClesEditions());

    const books = await import('../src/books.js');
    const [carte] = books.fusionnerDoublons([resultat()], 'le feu dans le ciel');   // le meme livre, vu par le catalogue
    const estSuivi = (carte.clesSource || [carte.cleSource]).some((c) => suivies.has(c));
    expect(estSuivi).toBe(true);
  });

  it('un autre livre n-est pas marque suivi par erreur', async () => {
    reseau(catalogue);
    await api.ajouterOeuvre(resultat({ cleSource: 'gb:abc', source: 'google' }));
    const suivies = new Set(await api.getClesEditions());

    const books = await import('../src/books.js');
    const [autre] = books.fusionnerDoublons([resultat({ cleSource: 'vb:21', titre: "Les dragons de l'Empereur Noir", isbn13: '9782890746725' })], 'dragons');
    expect((autre.clesSource || [autre.cleSource]).some((c) => suivies.has(c))).toBe(false);
  });

  it('un livre sans ISBN ne fabrique pas de cle de marquage', async () => {
    reseau(catalogue);
    await api.ajouterOeuvre(resultat({ cleSource: 'gb:sans', source: 'google', isbn13: null }));
    expect((await api.getClesEditions()).some((c) => c.startsWith('isbn:'))).toBe(false);
  });
});

describe('Un livre scanne, puis ses autres editions', () => {
  it('ajoute par le scan (cle vb:<livre>:<isbn>), il se voit proposer les autres editions du CATALOGUE', async () => {
    reseau(catalogue);
    const id = await api.ajouterOeuvre(resultat({ cleSource: 'vb:11:9782890746626' }));
    const proposees = await api.getEditionsProposees(id);
    expect(proposees.map((p) => p.isbn13)).toEqual(['9782749962771', '9782749906256', '9782298016727']);   // pas la Mortagne, deja possedee
    expect(appels.some((u) => u.includes('catalogue.test/v1/books/11'))).toBe(true);
    expect(appels.some((u) => u.includes('catalogue.bnf.fr'))).toBe(false);
  });
});
