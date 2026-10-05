/*
 * FAMILLE 13 — LE CATALOGUE VAULT BOOKS (tranche 33)
 *
 * Ce que ces verifications protegent : notre propre service est interroge AVANT les trois sources publiques, mais il ne doit
 * JAMAIS rendre l'application moins fiable qu'elle ne l'etait. D'ou trois promesses :
 *   1. ce qu'il rend est range comme il le dit (saga en bloc, tomes dans l'ordre, son classement fait foi) ;
 *   2. en cas de defaillance — coupe, lent, cle refusee, vide, non configure — l'ancien chemin prend le relais ;
 *   3. il ne s'applique qu'a ce qu'il sait faire (recherche par titre, premiere page, sans auteur precise).
 *
 * AUCUN appel reseau reel : le service est simule, comme le sont Google, Open Library et la BnF dans les autres familles.
 * Pour verifier le VRAI service : `node scripts/...` n'existe pas ici — voir `npm run smoke` dans le projet vault-books-api.
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

// Ce que rend le VRAI service pour « les chevaliers d'emeraude » (reponses reelles du 2026-10-05, raccourcies).
const carteSaga = { type: 'serie', id: 25608, titre: "Les Chevaliers d'Émeraude", auteurs: ['Anne Robillard'], couverture: 'https://img/1.jpg', tomes: 12, score: 102.1 };
const tome = (position, titre, livreId, isbn13, extra = {}) => ({
  position, titre, livreId, disponible: true, aParaitre: false, couverture: `https://img/t${position}.jpg`, couvertureSource: 'edition',
  couvertureApproximative: false, edition: { id: livreId, isbn13, editeur: 'Michel Lafon', date: '2003-01-01', format: 'Paperback' }, parties: [], viaParties: false, ...extra,
});
const saga = {
  id: 25608, nom: "Les Chevaliers d'Émeraude", langue: 'fr', totalPrincipal: 12, disponibles: 3,
  tomes: [
    tome(1, 'Le Feu dans le ciel', 11, '9782890746626'),
    tome(2, "Les dragons de l'Empereur Noir", 21, '9782890746725'),
    tome(3, 'Piège au royaume des ombres', 31, '9782749907475'),
  ],
  horsSerie: [],
};

let appels;
function service(reponses) {
  vi.stubGlobal('fetch', (url, opts) => {
    appels.push({ url: String(url), cle: opts && opts.headers && opts.headers['x-app-key'] });
    const r = typeof reponses === 'function' ? reponses(String(url)) : reponses;
    return r instanceof Promise ? r : Promise.resolve(r instanceof Response ? r.clone() : r);
  });
}
const routes = (url) => {
  if (url.includes('/v1/search')) return ok({ requete: 'x', langue: 'fr', resultats: [carteSaga] });
  if (url.includes('/v1/series/25608')) return ok(saga);
  return new Response('{}', { status: 404 });
};

beforeEach(() => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
  vi.stubEnv('VITE_VAULT_API_URL', 'https://catalogue.test');
  vi.stubEnv('VITE_VAULT_API_KEY', 'cle-de-test');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Ce que le catalogue rend, tel que l-ecran le recoit', () => {
  it('une saga devient UN resultat par tome, dans l-ordre, avec son edition et sa couverture', async () => {
    service(routes);
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre("les chevaliers d'emeraude");

    expect(resultats.map((r) => r.titre)).toEqual(['Le Feu dans le ciel', "Les dragons de l'Empereur Noir", 'Piège au royaume des ombres']);
    expect(resultats.map((r) => r.serie.position)).toEqual([1, 2, 3]);
    expect(resultats[0]).toMatchObject({
      cleSource: 'vb:11', source: 'vaultapi', isbn13: '9782890746626', editeur: 'Michel Lafon', langue: 'fr',
      couvertureUrl: 'https://img/t1.jpg', serie: { id: 25608, nom: "Les Chevaliers d'Émeraude", total: 12 },
    });
  });

  it('la cle d-application est envoyee, jamais dans l-adresse', async () => {
    service(routes);
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    await rechercherTitre('dune');
    expect(appels.every((a) => a.cle === 'cle-de-test')).toBe(true);
    expect(appels.every((a) => !a.url.includes('cle-de-test'))).toBe(true);
  });

  it('un tome sans edition dans la langue ou pas encore paru ne s-affiche pas', async () => {
    const incomplete = { ...saga, tomes: [
      tome(1, 'Un', 11, '9782890746626'),
      tome(2, 'Deux', 21, null, { disponible: false, edition: null }),
      tome(3, 'Trois', 31, '9782749907475', { aParaitre: true }),
    ] };
    service((url) => (url.includes('/v1/series/') ? ok(incomplete) : routes(url)));
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre('x');
    expect(resultats.map((r) => r.titre)).toEqual(['Un']);
  });

  it('un tome disponible seulement en volumes coupes presente son premier volume', async () => {
    const coupe = { ...saga, tomes: [tome(3, 'A Storm of Swords', 3, null, {
      edition: null, viaParties: true,
      couverture: 'https://img/anglais.jpg', couvertureApproximative: true,
      parties: [{ position: 3.1, titre: 'Intrigues à Port-Réal', couverture: 'https://img/fr31.jpg', couvertureApproximative: false,
        edition: { isbn13: '9782290325704', editeur: "J'ai lu", date: '2013-01-01' } }],
    })] };
    service((url) => (url.includes('/v1/series/') ? ok(coupe) : routes(url)));
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre('x');
    // Titre, couverture et ISBN du volume francais : pas le titre anglais ni la couverture du livre canonique.
    expect(resultats[0]).toMatchObject({
      titre: 'Intrigues à Port-Réal', isbn13: '9782290325704', editeur: "J'ai lu",
      couvertureUrl: 'https://img/fr31.jpg', couvertureApproximative: false,
    });
  });

  it('si les tomes d-une saga ne se chargent pas, la saga reste une carte unique', async () => {
    service((url) => (url.includes('/v1/series/') ? new Response('{}', { status: 502 }) : routes(url)));
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre('x');
    expect(resultats).toHaveLength(1);
    expect(resultats[0].titre).toBe("Les Chevaliers d'Émeraude");
    expect(resultats[0].serie).toBeUndefined();
  });

  it('au plus trois sagas sont depliees : les autres coutent zero appel de plus', async () => {
    const cartes = [1, 2, 3, 4, 5].map((i) => ({ ...carteSaga, id: 100 + i, score: 100 - i }));
    service((url) => (url.includes('/v1/search') ? ok({ resultats: cartes }) : ok({ ...saga, id: 1 })));
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { resultats } = await rechercherTitre('x');
    expect(appels.filter((a) => a.url.includes('/v1/series/'))).toHaveLength(3);
    expect(resultats.length).toBeGreaterThanOrEqual(5);
  });
});

describe('Le classement et le regroupement de l-ecran suivent le catalogue', () => {
  it('une saga annoncee par le catalogue forme un bloc de tomes ranges, sans « Tome N » dans les titres', async () => {
    service(routes);
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { organiserLEcran } = await import('../src/tomes.js');
    const { resultats } = await rechercherTitre("les chevaliers d'emeraude");

    // Ordre d'arrivee melange : le bloc doit remettre les tomes dans l'ordre.
    const blocs = organiserLEcran([resultats[2], resultats[0], resultats[1]], "les chevaliers d'emeraude");
    expect(blocs).toHaveLength(1);
    expect(blocs[0].type).toBe('serie');
    expect(blocs[0].nom).toBe("Les Chevaliers d'Émeraude");
    expect(blocs[0].tomes.map((t) => t.tome)).toEqual([1, 2, 3]);
  });

  it('un seul tome d-une saga ne fait pas de bloc', async () => {
    const { separerLesTomes } = await import('../src/tomes.js');
    const seul = { cleSource: 'vb:1', titre: 'Un', auteurs: [], serie: { id: 1, nom: 'S', position: 1, total: 5 } };
    const { series, autres } = separerLesTomes([seul]);
    expect(series).toHaveLength(0);
    expect(autres).toHaveLength(1);
  });

  it('le score du catalogue fait l-ordre : il n-est pas recalcule par l-application', async () => {
    const { scorePertinence, trierResultats } = await import('../src/tomes.js');
    const a = { cleSource: 'vb:1', titre: 'Sans rapport avec la requete', auteurs: [], scoreApi: 150 };
    const b = { cleSource: 'vb:2', titre: 'game of thrones', auteurs: [], scoreApi: 40 };
    expect(scorePertinence(a, 'game of thrones')).toBe(150);
    expect(trierResultats([b, a], 'pertinence', 'game of thrones').map((r) => r.cleSource)).toEqual(['vb:1', 'vb:2']);
  });

  it('les resultats du catalogue traversent la fusion sans etre fondus ni perdre leur cle', async () => {
    service(routes);
    const { rechercherTitre } = await import('../src/sources/vaultapi.js');
    const { fusionnerDoublons } = await import('../src/books.js');
    const { resultats } = await rechercherTitre('x');
    const fondus = fusionnerDoublons(resultats, 'x');
    expect(fondus).toHaveLength(resultats.length);
    expect(fondus.every((f) => Array.isArray(f.clesSource) && f.clesSource.length === 1)).toBe(true);
  });
});

describe('books.rechercher : le catalogue d-abord, le repli ensuite', () => {
  /** Un reseau qui sert le catalogue ET une panne franche pour tout le reste (Google, Open Library, BnF). */
  const reseauMixte = (reponseCatalogue) => service((url) => (url.startsWith('https://catalogue.test')
    ? reponseCatalogue(url)
    : new Response('{}', { status: 503 })));

  it('recherche par titre : le catalogue repond, aucune source publique n-est appelee', async () => {
    reseauMixte(routes);
    const books = await import('../src/books.js');
    const r = await books.rechercher("les chevaliers d'emeraude", 'titre');
    expect(r.resultats).toHaveLength(3);
    expect(r.nbSource).toBe(0);                 // pas de page suivante a aller chercher
    expect(r.ancien).toBe(false);
    expect(appels.every((a) => a.url.startsWith('https://catalogue.test'))).toBe(true);
  });

  it('le catalogue est coupe (503) : l-ancien chemin prend le relais', async () => {
    reseauMixte(() => new Response('{}', { status: 503 }));
    const books = await import('../src/books.js');
    // Tout est en panne : on retombe sur l-erreur habituelle de l-ancien chemin, pas sur une erreur du catalogue.
    await expect(books.rechercher('dune', 'titre')).rejects.toThrow(/Google Books/);
    expect(appels.some((a) => a.url.includes('googleapis.com'))).toBe(true);
  });

  it('le catalogue ne repond pas : l-ancien chemin prend le relais', async () => {
    reseauMixte(() => Promise.reject(new TypeError('Failed to fetch')));
    const books = await import('../src/books.js');
    await expect(books.rechercher('dune', 'titre')).rejects.toThrow(/Google Books/);
  });

  it('le catalogue ne connait pas le livre : l-ancien chemin prend le relais', async () => {
    reseauMixte((url) => (url.includes('/v1/search') ? ok({ resultats: [] }) : new Response('{}', { status: 404 })));
    const books = await import('../src/books.js');
    await expect(books.rechercher('un livre inconnu', 'titre')).rejects.toThrow(/Google Books/);
  });

  it('cle refusee (401) : on ne le cache pas, on replie', async () => {
    reseauMixte(() => new Response('{"erreur":"cle"}', { status: 401 }));
    const books = await import('../src/books.js');
    await expect(books.rechercher('dune', 'titre')).rejects.toThrow(/Google Books/);
  });

  // Une verification par cas : chacune passe par l'ancien chemin, dont les reessais prennent ~2,5 s.
  const casIgnores = [
    ['recherche par auteur', (b) => b.rechercher('tolkien', 'auteur')],
    ['recherche par ISBN', (b) => b.rechercher('9782070612758', 'isbn')],
    ['page suivante', (b) => b.rechercher('dune', 'titre', 1)],
    ['auteur precise', (b) => b.rechercher('dune', 'titre', 0, 'herbert')],
  ];
  casIgnores.forEach(([nom, appeler]) => {
    it(`${nom} : jamais envoye au catalogue`, async () => {
      reseauMixte(routes);
      const books = await import('../src/books.js');
      await appeler(books).catch(() => {});
      expect(appels.filter((a) => a.url.startsWith('https://catalogue.test'))).toHaveLength(0);
    });
  });

  it('coupe par l-utilisateur (reglage) : le catalogue n-est pas appele', async () => {
    reseauMixte(routes);
    const books = await import('../src/books.js');
    books.definirCatalogueApiActif(false);
    await books.rechercher('dune', 'titre').catch(() => {});
    expect(appels.filter((a) => a.url.startsWith('https://catalogue.test'))).toHaveLength(0);
  });

  it('non configure (aucune adresse) : comportement d-hier, le catalogue n-est jamais appele', async () => {
    vi.stubEnv('VITE_VAULT_API_URL', '');
    reseauMixte(routes);
    const books = await import('../src/books.js');
    expect(books.etatCatalogueApi()).toMatchObject({ configuree: false, active: false });
    await books.rechercher('dune', 'titre').catch(() => {});
    expect(appels.filter((a) => a.url.startsWith('https://catalogue.test'))).toHaveLength(0);
  });
});

describe('Les reglages du catalogue', () => {
  it('actif par defaut, langue francaise par defaut, et ce qui est choisi est retenu', async () => {
    service(routes);
    const books = await import('../src/books.js');
    expect(books.etatCatalogueApi()).toMatchObject({ configuree: true, active: true, langue: 'fr' });
    books.definirLangueCatalogue('en');
    books.definirCatalogueApiActif(false);
    expect(books.etatCatalogueApi()).toMatchObject({ active: false, langue: 'en' });
  });

  it('la langue choisie part dans la requete', async () => {
    service(routes);
    const books = await import('../src/books.js');
    books.definirLangueCatalogue('en');
    await books.rechercher('game of thrones', 'titre');
    expect(appels[0].url).toContain('lang=en');
  });

  it('une langue inconnue est refusee, sans effacer le choix precedent', async () => {
    const books = await import('../src/books.js');
    books.definirLangueCatalogue('en');
    expect(() => books.definirLangueCatalogue('de')).toThrow();
    expect(books.etatCatalogueApi().langue).toBe('en');
  });
});
