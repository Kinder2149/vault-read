/*
 * FAMILLE 8 — LE FILET BnF
 *
 * Ajoutee le 2026-08-25 apres mise en cause du choix des sources : « j'ai
 * l'impression qu'il est limite, pas complet ».
 *
 * Google n'est pas incomplet, il est INSTABLE : 4 recherches sur 6 abouties
 * ce soir-la, 1 sur 6 deux heures plus tot. Le catalogue de la Bibliotheque
 * nationale de France a repondu 10 fois sur 10 puis 6 fois sur 6, sans cle ni
 * quota. Il prend donc le relais quand Google tombe.
 *
 * Les extraits XML ci-dessous sont des notices REELLES, raccourcies.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const faux = new Map();
vi.mock('idb-keyval', () => ({
  get: async (k) => faux.get(k),
  set: async (k, v) => { faux.set(k, v); },
  del: async (k) => { faux.delete(k); },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

/** Une reponse SRU credible, calquee sur les notices reelles de la BnF. */
const notice = ({ titre, auteur, date, editeur, isbn, langue = 'fre', collection }) => `
<srw:record><srw:recordData><oai_dc:dc xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${titre}</dc:title>
  ${auteur ? `<dc:creator>${auteur}</dc:creator>` : ''}
  <dc:date>${date}</dc:date>
  ${editeur ? `<dc:publisher>${editeur}</dc:publisher>` : ''}
  <dc:identifier>http://catalogue.bnf.fr/ark:/12148/cb${Math.random().toString().slice(2, 11)}</dc:identifier>
  ${isbn ? `<dc:identifier>ISBN ${isbn}</dc:identifier>` : ''}
  <dc:language>${langue}</dc:language>
  ${collection ? `<dc:description>Collection : ${collection}</dc:description>` : ''}
  <dc:type>text</dc:type>
</oai_dc:dc></srw:recordData></srw:record>`;

const reponseSru = (notices) => `<?xml version="1.0" encoding="UTF-8"?>
<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/">
<srw:numberOfRecords>${notices.length}</srw:numberOfRecords>
<srw:records>${notices.join('')}</srw:records></srw:searchRetrieveResponse>`;

const LES_FOURMIS = notice({
  titre: 'Les fourmis : roman / Bernard Werber',
  auteur: 'Werber, Bernard (1961-....). Auteur du texte',
  date: '1991',
  editeur: 'Albin Michel (Paris)',
  isbn: '2-226-05257-7',
});

/* Le meme livre que celui rendu par Google dans les cas de la tranche 4. */
const NOTICE_GERMINAL = reponseSru([notice({
  titre: 'Germinal / Émile Zola',
  auteur: 'Zola, Émile (1840-1902). Auteur du texte',
  date: '1885',
  editeur: 'Charpentier (Paris)',
  isbn: '2-07-036939-6',
})]);

beforeEach(() => { faux.clear(); vi.resetModules(); });

describe('Convertir un ISBN-13 en ISBN-10', () => {
  it('la conversion est exacte — la BnF ne repond qu-a cette forme', async () => {
    // Verifie sur appels reels : « 9782226052575 » ne rend RIEN a la BnF,
    // « 2226052577 » rend Les Fourmis.
    const { isbn13Vers10 } = await import('../src/sources/bnf.js');
    expect(isbn13Vers10('9782226052575')).toBe('2226052577');
    expect(isbn13Vers10('9782070612888')).toBe('2070612880');
    expect(isbn13Vers10('9782221252055')).toBe('2221252055');
  });

  it('sait produire une cle de controle X', async () => {
    const { isbn13Vers10 } = await import('../src/sources/bnf.js');
    expect(isbn13Vers10('9782744131929')).toBe('274413192X');
  });

  it('refuse ce qui n-est pas un ISBN-13 en 978', async () => {
    const { isbn13Vers10 } = await import('../src/sources/bnf.js');
    expect(isbn13Vers10('9792226052575')).toBeNull();   // prefixe 979
    expect(isbn13Vers10('2226052577')).toBeNull();      // deja en 10
    expect(isbn13Vers10('')).toBeNull();
    expect(isbn13Vers10(null)).toBeNull();
  });
});

describe('Lire une notice de la BnF', () => {
  it('nettoie le titre de ses mentions de responsabilite', async () => {
    vi.stubGlobal('fetch', async () => new Response(reponseSru([LES_FOURMIS]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('fourmis');
    // « Les fourmis : roman / Bernard Werber » -> le titre seul.
    expect(livre.titre).toBe('Les fourmis : roman');
    vi.unstubAllGlobals();
  });

  it('remet l-auteur dans l-ordre et retire ses dates', async () => {
    vi.stubGlobal('fetch', async () => new Response(reponseSru([LES_FOURMIS]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('fourmis');
    // « Werber, Bernard (1961-....). Auteur du texte » -> « Bernard Werber »
    expect(livre.auteurs[0]).toBe('Bernard Werber');
    vi.unstubAllGlobals();
  });

  it('gere une date ouverte, qui avait casse la premiere version', async () => {
    // « (1949-.... » sans parenthese fermante rendait « Gilbert (1949- Millet ».
    const abime = notice({ titre: 'Étude / X', auteur: 'Millet, Gilbert (1949-....', date: '2007' });
    vi.stubGlobal('fetch', async () => new Response(reponseSru([abime]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('etude');
    expect(livre.auteurs[0]).toBe('Gilbert Millet');
    vi.unstubAllGlobals();
  });

  it('lit l-annee, l-editeur, l-ISBN et la langue', async () => {
    vi.stubGlobal('fetch', async () => new Response(reponseSru([LES_FOURMIS]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('fourmis');
    expect(livre.annee).toBe('1991');
    expect(livre.editeur).toBe('Albin Michel');
    expect(livre.isbn10).toBe('2226052577');
    expect(livre.langue).toBe('fr');
    expect(livre.source).toBe('bnf');
    vi.unstubAllGlobals();
  });

  it('n-annonce JAMAIS de couverture — elle n-en fournit pas', async () => {
    vi.stubGlobal('fetch', async () => new Response(reponseSru([LES_FOURMIS]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('fourmis');
    expect(livre.couvertureUrl).toBeNull();
    vi.unstubAllGlobals();
  });

  it('survit a une notice sans auteur ni editeur', async () => {
    const nue = notice({ titre: '600 autocollants Astérix', date: '2012' });
    vi.stubGlobal('fetch', async () => new Response(reponseSru([nue]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    const [livre] = await bnf.rechercherParTitre('asterix');
    expect(livre.titre).toBe('600 autocollants Astérix');
    expect(livre.auteurs).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('rend une liste vide, sans erreur, quand la BnF ne connait rien', async () => {
    vi.stubGlobal('fetch', async () => new Response(reponseSru([]), { status: 200 }));
    const bnf = await import('../src/sources/bnf.js');
    expect(await bnf.rechercherParTitre('zzz')).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('La BnF prend le relais quand Google tombe', () => {
  it('une recherche par titre aboutit malgre une panne totale de Google', async () => {
    vi.stubGlobal('fetch', async (url) => (String(url).includes('googleapis')
      ? new Response('{"error":{"code":503}}', { status: 503 })
      : new Response(reponseSru([LES_FOURMIS]), { status: 200 })));

    const books = await import('../src/books.js');
    const r = await books.rechercher('les fourmis', 'titre');

    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0].source).toBe('bnf');
    expect(r.ancien).toBe(false);        // ce sont de VRAIS resultats, pas l-archive
    vi.unstubAllGlobals();
  });

  it('un ISBN inconnu de Google est rattrape par la BnF', async () => {
    vi.stubGlobal('fetch', async (url) => {
      const u = String(url);
      if (u.includes('googleapis')) return new Response(JSON.stringify({ totalItems: 0 }), { status: 200 });
      if (u.includes('openlibrary')) return new Response('null', { status: 404 });
      return new Response(reponseSru([LES_FOURMIS]), { status: 200 });
    });

    const books = await import('../src/books.js');
    const r = await books.rechercher('9782226052575', 'isbn');

    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0].source).toBe('bnf');
    // L'ISBN rendu est celui du code-barres scanne, pas celui de la notice.
    expect(r.resultats[0].isbn13).toBe('9782226052575');
    vi.unstubAllGlobals();
  });

  it('si les DEUX sources tombent, l-erreur remonte comme avant', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    const books = await import('../src/books.js');
    await expect(books.rechercher('rien du tout', 'titre')).rejects.toThrow();
    vi.unstubAllGlobals();
  });

  it('meme quand Google repond, la BnF ne DECOUVRE jamais — elle complete', async () => {
    /*
     * REGLE CHANGEE EN TRANCHE 4, et c-est la regle de remplacement qu-on
     * protege ici. La BnF etait appelee UNIQUEMENT quand Google tombait ; elle
     * part desormais a chaque recherche, parce qu-elle porte les ISBN et les
     * editeurs qui manquent aux fiches de Google — et l-ISBN est ce qui ouvre
     * la couverture Open Library (retour d-usage 122).
     *
     * Ce qui n-a PAS change, et ne doit pas changer : sa pertinence en
     * decouverte est mauvaise. Ses notices completent les resultats de Google,
     * elles n-entrent jamais dans la liste par elles-memes.
     */
    const appels = [];
    vi.stubGlobal('fetch', async (url) => {
      appels.push(String(url));
      if (String(url).includes('bnf.fr')) return new Response(NOTICE_GERMINAL, { status: 200 });
      return new Response(JSON.stringify({
        items: [{ id: 'v1', volumeInfo: { title: 'Germinal', authors: ['Émile Zola'] } }],
      }), { status: 200 });
    });

    const books = await import('../src/books.js');
    const r = await books.rechercher('germinal', 'titre');

    // Un seul resultat, celui de Google : rien n-est venu s-ajouter.
    expect(r.resultats).toHaveLength(1);
    expect(r.resultats[0].source).toBe('google');
    // Mais la BnF a bien ete consultee, en meme temps.
    expect(appels.some((u) => u.includes('bnf.fr'))).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('La BnF comble ce qui manque a Google (tranche 4)', () => {
  /*
   * Retour d-usage 122 : « les couvertures ne s-affichent que tres peu dans la
   * recherche, alors qu-en cherchant une autre edition on trouve la bonne ».
   * Cause : la couverture de repli Open Library se demande PAR ISBN, et les
   * volumes rendus par `intitle:` chez Google n-en portent souvent aucun.
   * L-ecran des editions, lui, passe par la BnF, qui en donne toujours.
   */
  const volumeGoogle = (extra = {}) => ({
    cleSource: 'gb:1',
    source: 'google',
    titre: 'Germinal',
    sousTitre: null,
    auteurs: ['Émile Zola'],
    annee: null,
    datePublication: null,
    couvertureUrl: null,
    resume: null,
    categories: [],
    langue: 'fr',
    isbn13: null,
    isbn10: null,
    nbPages: null,
    editeur: null,
    ...extra,
  });

  const noticeBnf = (extra = {}) => ({
    cleSource: 'bnf:cb1',
    source: 'bnf',
    titre: 'Germinal',
    auteurs: ['Émile Zola'],
    annee: '1885',
    datePublication: '1885',
    couvertureUrl: null,
    categories: ['Roman'],
    isbn13: '9782070369393',
    isbn10: null,
    nbPages: null,
    editeur: 'Charpentier',
    ...extra,
  });

  it('donne a une fiche nue son ISBN, son editeur et son annee', async () => {
    const { completerDepuisBnf } = await import('../src/books.js');
    const [complete] = completerDepuisBnf([volumeGoogle()], [noticeBnf()]);
    expect(complete.isbn13).toBe('9782070369393');
    expect(complete.editeur).toBe('Charpentier');
    expect(complete.annee).toBe('1885');
  });

  it('l-ISBN ainsi trouve ouvre la couverture, sans requete de plus', async () => {
    // C-est tout l-objet de la tranche : une adresse d-image, pas un appel.
    const { completerDepuisBnf, avecCouvertureDeRepli } = await import('../src/books.js');
    const [complete] = completerDepuisBnf([volumeGoogle()], [noticeBnf()]);
    expect(avecCouvertureDeRepli(complete).couvertureUrl).toContain('9782070369393');
  });

  it('n-ECRASE JAMAIS ce que Google a deja dit', async () => {
    const { completerDepuisBnf } = await import('../src/books.js');
    const [complete] = completerDepuisBnf(
      [volumeGoogle({ editeur: 'Gallimard', isbn13: '9782070612888' })],
      [noticeBnf()],
    );
    expect(complete.editeur).toBe('Gallimard');
    expect(complete.isbn13).toBe('9782070612888');
  });

  it('n-AJOUTE aucune notice sans correspondance', async () => {
    // Sa pertinence en decouverte est mauvaise : elle complete, elle ne
    // propose pas.
    const { completerDepuisBnf } = await import('../src/books.js');
    const sortie = completerDepuisBnf(
      [volumeGoogle()],
      [noticeBnf(), noticeBnf({ cleSource: 'bnf:cb2', titre: 'Revue de Lormont', auteurs: ['Anonyme'] })],
    );
    expect(sortie).toHaveLength(1);
    expect(sortie[0].source).toBe('google');
  });

  it('ne rapproche pas deux livres d-auteurs differents', async () => {
    const { completerDepuisBnf } = await import('../src/books.js');
    const [complete] = completerDepuisBnf(
      [volumeGoogle()],
      [noticeBnf({ auteurs: ['Stéphanie Ledu'] })],
    );
    expect(complete.editeur).toBeNull();
  });

  it('laisse la recherche intacte quand la BnF ne repond pas', async () => {
    const { completerDepuisBnf } = await import('../src/books.js');
    const entree = [volumeGoogle()];
    expect(completerDepuisBnf(entree, [])).toEqual(entree);
    expect(completerDepuisBnf(entree, null)).toEqual(entree);
  });

  it('ne fait qu-UN SEUL appel BnF par recherche', async () => {
    const appels = [];
    vi.stubGlobal('fetch', async (url) => {
      appels.push(String(url));
      if (String(url).includes('bnf.fr')) return new Response(NOTICE_GERMINAL, { status: 200 });
      return new Response(JSON.stringify({
        items: [{ id: 'v1', volumeInfo: { title: 'Germinal', authors: ['Émile Zola'] } }],
      }), { status: 200 });
    });

    const books = await import('../src/books.js');
    await books.rechercher('germinal', 'titre');

    expect(appels.filter((u) => u.includes('bnf.fr'))).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('DE BOUT EN BOUT : une fiche Google nue ressort avec ISBN, editeur et couverture', async () => {
    /*
     * Le parcours complet du retour d-usage 122, sans reseau reel : Google rend
     * un volume sans ISBN, sans editeur et sans image — le cas le plus courant
     * de `intitle:` —, la BnF connait le livre, et la carte finit illustree.
     */
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).includes('bnf.fr')) return new Response(NOTICE_GERMINAL, { status: 200 });
      return new Response(JSON.stringify({
        items: [{ id: 'v1', volumeInfo: { title: 'Germinal', authors: ['Émile Zola'] } }],
      }), { status: 200 });
    });

    const books = await import('../src/books.js');
    const { resultats } = await books.rechercher('germinal', 'titre');

    expect(resultats).toHaveLength(1);
    /*
     * ISBN-10 et non 13 : la BnF indexe en ISBN-10 les livres anterieurs a
     * 2007, et c-est le cas le plus frequent pour les classiques. La couverture
     * de repli accepte les deux formes, c-est ce qui compte.
     */
    expect(resultats[0].isbn10).toBe('2070369396');
    expect(resultats[0].editeur).toBe('Charpentier');
    expect(resultats[0].annee).toBe('1885');
    // La couverture arrive par l-ISBN, sans une requete de donnees de plus.
    expect(resultats[0].couvertureUrl).toContain('2070369396');
    vi.unstubAllGlobals();
  });

  it('ne consulte PAS la BnF pour une recherche par ISBN', async () => {
    // Un ISBN designe une edition precise : il n-y a rien a completer, et le
    // chemin ISBN a deja ses propres replis.
    const appels = [];
    vi.stubGlobal('fetch', async (url) => {
      appels.push(String(url));
      return new Response(JSON.stringify({
        items: [{ id: 'v1', volumeInfo: { title: 'Germinal', authors: ['Émile Zola'] } }],
      }), { status: 200 });
    });

    const books = await import('../src/books.js');
    await books.rechercher('9782070369393', 'isbn');

    expect(appels.some((u) => u.includes('bnf.fr'))).toBe(false);
    vi.unstubAllGlobals();
  });
});
