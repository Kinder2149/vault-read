/*
 * FAMILLE 17 — LE CONTRAT AVEC LE SERVICE VAULT BOOKS (tranche 33, phase 3)
 *
 * Les reponses REELLES du service, enregistrees une fois (vault-books-api/contrat/exemples, copiees ici par `npm run contrat -- --copier`),
 * font foi pour les deux depots :
 *   - le service verifie qu'il les respecte (test/contrat.test.js, et `npm run contrat -- --live` contre le service deploye) ;
 *   - l'application verifie ici que ses normaliseurs en tirent des resultats complets. Si un champ lu change de nom ou de type cote service,
 *     le contrat est mis a jour, recopie ici, et c'est CE test qui dit ce que l'application doit adapter.
 *
 * Aucun appel reseau reel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { contrat, verifier } from './contrat/contrat.js';

vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => {}, del: async () => {}, keys: async () => [], delMany: async () => {} }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

const exemple = (nom) => JSON.parse(readFileSync(new URL(`./contrat/exemples/${nom}.json`, import.meta.url), 'utf8'));
const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Les exemples reels respectent le contrat', () => {
  Object.keys(contrat).forEach((nom) => {
    it(nom, () => expect(verifier(exemple(nom), contrat[nom])).toEqual([]));
  });
});

describe('Les normaliseurs de l-application tirent des resultats complets des reponses reelles', () => {
  function service() {
    vi.stubGlobal('fetch', (url) => {
      url = String(url);
      if (url.includes('/v1/series/') && !url.includes(`/v1/series/${exemple('serie').id}?`)) return Promise.resolve(new Response('{}', { status: 404 }));
      if (url.includes('/v1/series/')) return Promise.resolve(ok(exemple('serie')));
      if (url.includes('mode=auteur')) return Promise.resolve(ok(exemple('search-auteur')));
      if (url.includes('/v1/search')) return Promise.resolve(ok(exemple('search-titre')));
      if (url.includes('/v1/isbn/')) return Promise.resolve(ok(exemple('isbn')));
      if (url.includes('/v1/books/')) return Promise.resolve(ok(exemple('livre')));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
  }
  const sansTrou = (r) => {
    expect(r.cleSource).toMatch(/^vb[e]?:\d+|^vbe:\d{13}/);
    expect(r.cleSource).not.toContain('undefined');
    expect(r.titre).toBeTruthy();
  };

  it('une saga : un resultat par tome, dans l-ordre, avec cle, ISBN et place dans la saga', async () => {
    service();
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre('chevaliers d emeraude');
    const tomes = resultats.filter((r) => r.serie && r.serie.id === exemple('serie').id);
    expect(tomes.length).toBeGreaterThanOrEqual(exemple('serie').disponibles);
    tomes.forEach(sansTrou);
    expect(tomes.map((t) => t.serie.position)).toEqual([...tomes.map((t) => t.serie.position)].sort((a, b) => a - b));
    expect(new Set(tomes.map((t) => t.cleSource)).size).toBe(tomes.length);
    expect(tomes[0].isbn13).toMatch(/^97\d{11}$/);
    expect(tomes[0].serie.nom).toBe(exemple('serie').nom);
  });

  it('un auteur : sa bibliographie sans trou de cle', async () => {
    service();
    const { rechercherAuteur } = await import('../src/sources/vaultapi.js');
    const { resultats, auteur } = await rechercherAuteur('anne robillard');
    expect(auteur.nom).toBe(exemple('search-auteur').auteur.nom);
    expect(resultats.length).toBeGreaterThan(0);
    resultats.forEach(sansTrou);
  });

  it('un scan : edition, pagination, couverture, saga et resume', async () => {
    service();
    const { rechercherIsbn } = await import('../src/sources/vaultapi.js');
    const r = await rechercherIsbn('9782749910147');
    sansTrou(r);
    expect(r).toMatchObject({ isbn13: '9782749910147', nbPages: 435, editeur: 'Michel Lafon', serie: { position: 8 } });
    expect(r.couvertureUrl).toMatch(/^https:/);
    expect(r.resume).toBe(exemple('isbn').resume);
  });

  it('les editions d-un livre : une par ISBN, avec leur couverture', async () => {
    service();
    const { editionsDuLivre } = await import('../src/sources/vaultapi.js');
    const eds = await editionsDuLivre(exemple('livre').id);
    expect(eds).toHaveLength(exemple('livre').editions.filter((e) => e.isbn13).length);
    eds.forEach(sansTrou);
  });
});
