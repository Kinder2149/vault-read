/*
 * FAMILLE 15 — COMPLETER PAR L'AUTEUR
 *
 * Mission « recherche satisfaisante », etape 3 (decision 5, 2e partie).
 *
 * Critere de Kinder : « Quand je cherche La maison vide, je vois le roman de
 * Laurent Mauvignier. Quand je cherche Le trone de fer, je vois les premiers
 * tomes de la saga. Quand je cherche 1984, je vois les editions francaises du
 * roman d'Orwell. »
 *
 * Les oeuvres d'Open Library ci-dessous sont les VRAIES reponses relevees le
 * 2026-10-04. Aucun appel reseau reel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { auteursACompleter, MAX_AUTEURS_COMPLEMENT } from '../src/books.js';

const faux = new Map();
vi.mock('idb-keyval', () => ({
  get: async (k) => faux.get(k),
  set: async (k, v) => { faux.set(k, v); },
  del: async (k) => { faux.delete(k); },
  keys: async () => [...faux.keys()],
  delMany: async (cles) => { cles.forEach((k) => faux.delete(k)); },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

const o = (titre, auteur, lecteurs = 0) => ({ titre, auteurs: [auteur], lecteurs });

const OL_MAISON_VIDE = [
  o('Adventure of the Empty House', 'Arthur Conan Doyle', 3000),
  o('La maison vide', 'Bernard, Harry.', 2),
  o('La maison vide', 'Claude Gutman', 40),
  o('La Maison vide', 'Laurent Mauvignier', 900),
  o('La Maison vide', 'Laurent Mauvignier', 100),
];
const OL_1984 = [
  o('Nineteen Eighty-Four', 'George Orwell', 9000),
  o('Animal Farm / Nineteen Eighty-Four', 'George Orwell', 500),
  o('1984 (adaptation)', 'Michael Dean', 3),
];
const OL_TRONE = [
  o('A Game of Thrones', 'George R. R. Martin', 9000),
  o('Le Trône de Fer - 1', 'George R. R. Martin', 100),
  o('A Feast for Crows', 'George R. R. Martin', 400),
];

describe('Le choix des auteurs a interroger en plus (etape 3)', () => {
  it('prend d-abord les auteurs au titre EXACT, les plus lus en tete', () => {
    const noms = auteursACompleter('la maison vide', OL_MAISON_VIDE);
    expect(noms).toEqual(['Laurent Mauvignier', 'Claude Gutman', 'Bernard, Harry.']);
  });

  it('a defaut de titre exact, prend l-auteur arrive en tete (1984, le trone de fer)', () => {
    expect(auteursACompleter('1984', OL_1984)).toEqual(['George Orwell']);
    expect(auteursACompleter('le trone de fer', OL_TRONE)).toEqual(['George R. R. Martin']);
  });

  it('ne rend jamais plus que le plafond, ni deux fois le meme auteur', () => {
    const beaucoup = [
      ...Array.from({ length: 6 }, (_, i) => o('Dune', `Auteur Numero${i}`, i)),
      o('Dune', 'Auteur Numero1', 50),
    ];
    const noms = auteursACompleter('dune', beaucoup);
    expect(noms.length).toBe(MAX_AUTEURS_COMPLEMENT);
    expect(new Set(noms).size).toBe(noms.length);
  });

  it('l-article de tete ne compte pas : « la maison vide » rejoint « La Maison vide »', () => {
    expect(auteursACompleter('maison vide', OL_MAISON_VIDE)).toContain('Laurent Mauvignier');
  });

  it('sans Open Library, ne choisit personne', () => {
    expect(auteursACompleter('la maison vide', [])).toEqual([]);
    expect(auteursACompleter('la maison vide', undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });
const noXml = '<?xml version="1.0"?><srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/"><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>';

function volume(id, titre, auteur) {
  return {
    id,
    volumeInfo: {
      title: titre, authors: [auteur], publishedDate: '2020',
      imageLinks: { thumbnail: 'http://x/' + id },
    },
  };
}
const docsOL = (oeuvres) => ({
  docs: oeuvres.map((x, i) => ({
    key: `/works/OL${i}W`, title: x.titre, author_name: x.auteurs, readinglog_count: x.lecteurs,
  })),
});

let appels;
beforeEach(() => { faux.clear(); appels = []; localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** `google(q)` repond a chaque question Google ; Open Library rend `oeuvres`. */
function reseau({ google, oeuvres, olEnPanne = false }) {
  vi.stubGlobal('fetch', (url) => {
    const u = String(url);
    appels.push(u);
    if (u.includes('openlibrary.org')) {
      return olEnPanne ? Promise.reject(new TypeError('coupure')) : Promise.resolve(ok(docsOL(oeuvres)));
    }
    if (u.includes('bnf.fr')) return Promise.resolve(new Response(noXml, { status: 200 }));
    return Promise.resolve(google(new URL(u).searchParams.get('q')));
  });
}
const questionsGoogle = () => appels
  .filter((u) => u.includes('googleapis.com/books'))
  .map((u) => new URL(u).searchParams.get('q'));

/*
 * CHAQUE CAS A SON PROPRE TITRE : la notoriete et l'archive survivent d'un cas
 * a l'autre (ecrites sans etre attendues), et un titre partage ferait lire au
 * cas suivant le resultat du precedent. Meme regle que la famille 3.
 */
let numero = 0;
const nouveauTitre = () => { numero += 1; return 'la maison vide ' + ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'][numero % 7] + numero; };
const oeuvresPour = (titre) => [
  o('Adventure of the Empty House', 'Arthur Conan Doyle', 3000),
  o(titre, 'Bernard, Harry.', 2),
  o(titre, 'Claude Gutman', 40),
  o(titre, 'Laurent Mauvignier', 900),
];
const googleMaisonVide = (q) => {
  if (q.startsWith('intitle:') || q.startsWith('inauthor:')) return ok({ items: [volume('d1', 'La maison vide', 'Arthur Conan Doyle')] });
  if (/mauvignier/i.test(q)) return ok({ items: [volume('m1', 'La Maison vide', 'Laurent Mauvignier'), volume('d1', 'La maison vide', 'Arthur Conan Doyle')] });
  return ok({ items: [] });
};

describe('Completer la recherche par l-auteur, de bout en bout (etape 3)', () => {
  it('ajoute le livre de Mauvignier que « intitle: » ne ramenait pas, sans doublon', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher(titre, 'titre');

    expect(resultats.some((r) => r.auteurs.includes('Laurent Mauvignier'))).toBe(true);
    // La fiche de Conan Doyle revenue plusieurs fois n'est comptee qu'une fois.
    expect(resultats.filter((r) => r.auteurs.includes('Arthur Conan Doyle')).length).toBe(1);
    expect(questionsGoogle().some((q) => /mauvignier/i.test(q) && !q.startsWith('intitle:'))).toBe(true);
  });

  it('pose au plus 1 + 3 questions a Google', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    const books = await import('../src/books.js');

    await books.rechercher(titre, 'titre');

    expect(questionsGoogle().length).toBeLessThanOrEqual(1 + MAX_AUTEURS_COMPLEMENT);
    expect(questionsGoogle().length).toBeGreaterThan(1);
  });

  it('ne pose AUCUNE question de plus quand l-utilisateur a saisi un auteur', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    const books = await import('../src/books.js');

    await books.rechercher(titre, 'titre', 0, 'mauvignier');

    expect(questionsGoogle().length).toBe(1);
  });

  it('ne change RIEN quand Open Library est muette', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: [], olEnPanne: true });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher(titre, 'titre');

    expect(questionsGoogle().length).toBe(1);
    expect(resultats.some((r) => r.auteurs.includes('Laurent Mauvignier'))).toBe(false);
  });

  it('ignore une question qui echoue : la recherche normale s-affiche quand meme', async () => {
    const titre = nouveauTitre();
    reseau({
      google: (q) => (q.startsWith('intitle:') ? googleMaisonVide(q) : new Response('{}', { status: 500 })),
      oeuvres: oeuvresPour(titre),
    });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher(titre, 'titre');

    expect(resultats.length).toBeGreaterThan(0);
  });

  it('ne complete PAS les pages suivantes', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    const books = await import('../src/books.js');

    await books.rechercher(titre, 'titre', 1);

    expect(questionsGoogle().length).toBe(1);
  });

  it('ne complete PAS le mode Auteur', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    const books = await import('../src/books.js');

    await books.rechercher(titre + ' auteur', 'auteur');

    expect(questionsGoogle().length).toBe(1);
  });

  it('la 2e fois, tout vient de l-archive : aucune question de plus a Google', async () => {
    const titre = nouveauTitre();
    reseau({ google: googleMaisonVide, oeuvres: oeuvresPour(titre) });
    let books = await import('../src/books.js');
    await books.rechercher(titre, 'titre');
    await new Promise((r) => setTimeout(r, 50));   // l'archivage n'est pas attendu

    vi.resetModules();   // memoire vide : seule l'archive reste
    books = await import('../src/books.js');
    appels.length = 0;
    const { resultats } = await books.rechercher(titre, 'titre');

    expect(questionsGoogle().length).toBe(0);
    expect(resultats.some((r) => r.auteurs.includes('Laurent Mauvignier'))).toBe(true);
  });
});
