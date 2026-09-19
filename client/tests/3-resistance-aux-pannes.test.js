/*
 * FAMILLE 3 — LA RESISTANCE AUX PANNES
 *
 * Ce que ces verifications protegent : tout le travail des tranches 8 a 12.
 * Google Books tombe sur 25 a 40 % des appels (mesure reelle, en rafale ET
 * espace de 4 s). Sans ces verifications, une modification future pourrait
 * reintroduire les pannes visibles sans que personne ne s'en apercoive avant
 * de le constater sur le telephone.
 *
 * AUCUN appel reseau reel : les reponses sont simulees. C'est volontaire —
 * des verifications qui dependraient de l'humeur de Google echoueraient au
 * hasard, consommeraient le quota de 1 000 requetes par jour, et ne
 * permettraient plus de distinguer un vrai defaut d'une panne passagere.
 * Pour verifier que les vraies sources repondent : `npm run controle-sources`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const faux = new Map();
/*
 * `keys` et `delMany` sont la parce que « vider le cache » en a besoin : il
 * enumere les cles pour ne jeter que les siennes. Un double incomplet aurait
 * fait passer le bouton pour casse alors qu'il fonctionne.
 */
vi.mock('idb-keyval', () => ({
  get: async (k) => faux.get(k),
  set: async (k, v) => { faux.set(k, v); },
  del: async (k) => { faux.delete(k); },
  keys: async () => [...faux.keys()],
  delMany: async (cles) => { cles.forEach((k) => faux.delete(k)); },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

/** Fabrique une reponse Google credible, avec `n` livres. */
function reponseGoogle(n = 3, debut = 0) {
  return {
    items: Array.from({ length: n }, (_, i) => ({
      id: 'vol' + (debut + i),
      volumeInfo: {
        title: 'Livre ' + (debut + i),
        authors: ['Auteur ' + (debut + i)],
        publishedDate: '2001-05-04',
        pageCount: 300,
        imageLinks: { thumbnail: 'http://books.google.com/img' + i },
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '978000000000' + i }],
      },
    })),
  };
}

const ok = (corps) => new Response(JSON.stringify(corps), { status: 200 });
const panne = () => new Response('{"error":{"code":503}}', { status: 503 });
const quotaDepasse = () => new Response('{"error":{"code":429}}', { status: 429 });

let appels;

beforeEach(() => {
  faux.clear();
  appels = [];
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => { vi.unstubAllGlobals(); });

/** Installe un faux reseau et compte les appels. */
function reseau(reponses) {
  vi.stubGlobal('fetch', (url) => {
    appels.push(String(url));
    const suite = typeof reponses === 'function' ? reponses(appels.length, String(url)) : reponses;
    /*
     * `clone()` : un meme objet Response passe en constante ne peut etre LU
     * qu-une fois (« Body has already been read »). Tant qu-une recherche
     * n-appelait qu-une source, cela ne se voyait pas ; depuis que la BnF part
     * en meme temps que Google (tranche 4), deux appels se partagent la meme
     * reponse de test.
     */
    return Promise.resolve(suite instanceof Response ? suite.clone() : suite);
  });
}

describe('Reessayer quand Google tombe', () => {
  it('un 503 isole est rattrape sans que l-utilisateur le voie', async () => {
    reseau((n) => (n === 1 ? panne() : ok(reponseGoogle(3))));
    const google = await import('../src/sources/google.js');

    const r = await google.rechercherParTitre('dune');
    expect(r).toHaveLength(3);
    expect(appels).toHaveLength(2);      // 1 panne + 1 rattrapage
  });

  it('resiste a une RAFALE de pannes (le cas qui a invalide les reessais immediats)', async () => {
    reseau((n) => (n <= 4 ? panne() : ok(reponseGoogle(2))));
    const google = await import('../src/sources/google.js');

    const r = await google.rechercherParTitre('dune');
    expect(r).toHaveLength(2);
    expect(appels).toHaveLength(5);
  });

  it('abandonne apres 6 essais et le dit en francais', async () => {
    reseau(() => panne());
    const google = await import('../src/sources/google.js');

    await expect(google.rechercherParTitre('dune'))
      .rejects.toThrow(/indisponible/i);
    expect(appels).toHaveLength(6);      // 1 essai + 5 reessais
  });

  it('ne reessaie JAMAIS sur un depassement de quota (insister l-aggrave)', async () => {
    reseau(() => quotaDepasse());
    const google = await import('../src/sources/google.js');

    await expect(google.rechercherParTitre('dune'))
      .rejects.toThrow(/Trop de recherches/i);
    expect(appels).toHaveLength(1);
  });

  it('traduit les erreurs en francais, jamais de code brut a l-ecran', async () => {
    reseau(() => new Response('{}', { status: 403 }));
    const google = await import('../src/sources/google.js');
    await expect(google.rechercherParTitre('x')).rejects.toThrow(/clé Google Books/i);
  });
});

describe('Compter les recherches du jour (quota)', () => {
  it('compte chaque appel, reessais compris — comme Google', async () => {
    reseau((n) => (n <= 2 ? panne() : ok(reponseGoogle(1))));
    const google = await import('../src/sources/google.js');

    expect(google.appelsDuJour()).toBe(0);
    await google.rechercherParTitre('dune');
    expect(google.appelsDuJour()).toBe(3);
  });
});

describe('Normaliser ce que rend Google', () => {
  it('force les couvertures en https (un WebView bloque le http)', async () => {
    reseau(ok(reponseGoogle(1)));
    const google = await import('../src/sources/google.js');
    const [livre] = await google.rechercherParTitre('x');
    expect(livre.couvertureUrl.startsWith('https://')).toBe(true);
  });

  it('lit l-annee, l-ISBN et la pagination', async () => {
    reseau(ok(reponseGoogle(1)));
    const google = await import('../src/sources/google.js');
    const [livre] = await google.rechercherParTitre('x');
    expect(livre.annee).toBe('2001');
    expect(livre.isbn13).toBe('9780000000000');
    expect(livre.nbPages).toBe(300);
  });

  it('traite pageCount = 0 comme « inconnu », pas comme zero page', async () => {
    const corps = reponseGoogle(1);
    corps.items[0].volumeInfo.pageCount = 0;
    reseau(ok(corps));
    const google = await import('../src/sources/google.js');
    const [livre] = await google.rechercherParTitre('x');
    expect(livre.nbPages).toBeNull();
  });

  it('survit a un volume sans titre, sans auteur et sans ISBN', async () => {
    reseau(ok({ items: [{ id: 'vide', volumeInfo: {} }] }));
    const google = await import('../src/sources/google.js');
    const [livre] = await google.rechercherParTitre('x');
    expect(livre.titre).toBe('Sans titre');
    expect(livre.auteurs).toEqual([]);
    expect(livre.isbn13).toBeNull();
  });

  it('rend une liste vide quand Google ne connait rien, sans erreur', async () => {
    reseau(ok({ totalItems: 0 }));
    const google = await import('../src/sources/google.js');
    expect(await google.rechercherParTitre('zzz')).toEqual([]);
  });
});

describe('Garder les recherches sur l-appareil (archive)', () => {
  it('ressert la derniere recherche connue quand Google est totalement en panne', async () => {
    reseau(() => ok(reponseGoogle(4)));
    let books = await import('../src/books.js');
    const premier = await books.rechercher('dune', 'titre');
    expect(premier.ancien).toBe(false);
    expect(premier.resultats).toHaveLength(4);

    /*
     * On VIEILLIT l'archive de deux jours. Depuis la correction 118, une
     * archive de moins de 24 h sert de cache et se donne pour fraiche ; ce
     * n'est qu'au-dela qu'elle redevient un repli annonce comme « ancien ».
     */
    // L'archive s'ecrit sans etre attendue (pour ne pas retarder l'affichage) :
    // on lui laisse le temps d'exister avant de la vieillir.
    await new Promise((r) => setTimeout(r, 30));
    for (const [k, v] of faux) {
      if (String(k).startsWith('recherche:')) {
        faux.set(k, { ...v, pose: v.pose - 48 * 60 * 60 * 1000 });
      }
    }
    expect([...faux.keys()].some((k) => String(k).startsWith('recherche:'))).toBe(true);

    // Application relancee : la memoire vive repart a zero, l-archive reste.
    vi.resetModules();
    reseau(() => panne());
    books = await import('../src/books.js');

    const secours = await books.rechercher('dune', 'titre');
    expect(secours.ancien).toBe(true);
    expect(secours.resultats).toHaveLength(4);
    expect(secours.pose).toBeTruthy();
  });

  it('laisse l-erreur remonter quand il n-y a AUCUNE archive', async () => {
    reseau(() => panne());
    const books = await import('../src/books.js');
    await expect(books.rechercher('jamais cherche', 'titre')).rejects.toThrow();
  });

  it('n-archive pas un resultat vide (cela figerait un ecran vide)', async () => {
    reseau(ok({ totalItems: 0 }));
    let books = await import('../src/books.js');
    await books.rechercher('rien', 'titre');

    vi.resetModules();
    reseau(() => panne());
    books = await import('../src/books.js');
    await expect(books.rechercher('rien', 'titre')).rejects.toThrow();
  });

  it('le cache en memoire evite de rappeler Google pour la meme recherche', async () => {
    reseau(ok(reponseGoogle(2)));
    const books = await import('../src/books.js');

    await books.rechercher('dune', 'titre');
    const avant = appels.length;
    const second = await books.rechercher('dune', 'titre');

    expect(appels).toHaveLength(avant);        // aucun appel de plus
    expect(second.ancien).toBe(false);         // ils sont frais, pas anciens
  });
});

describe('Ne pas repayer une identification deja tentee', () => {
  const resultat = {
    cleSource: 'gb:x', titre: 'Dune', auteurs: ['Frank Herbert'],
    isbn13: '9782221252055', nbPages: 800, couvertureUrl: null, categories: [], resume: null,
  };

  it('une identification qui echoue n-est pas refaite a budget egal', async () => {
    reseau(() => new Response('null', { status: 404 }));
    const books = await import('../src/books.js');

    const un = await books.identifier(resultat, 4000);
    const apres = appels.length;
    const deux = await books.identifier(resultat, 4000);

    expect(un.resolue).toBe(false);
    expect(deux.resolue).toBe(false);
    expect(appels).toHaveLength(apres);        // aucun appel de plus
  });

  it('mais elle EST refaite avec plus de temps (reprise en tache de fond)', async () => {
    reseau(() => new Response('null', { status: 404 }));
    const books = await import('../src/books.js');

    await books.identifier(resultat, 4000);
    const apres = appels.length;
    await books.identifier(resultat, 15000);

    expect(appels.length).toBeGreaterThan(apres);
  });

  it('une identite trouvee n-est plus jamais redemandee', async () => {
    reseau(ok({ works: [{ key: '/works/OL893414W' }], number_of_pages: 800, key: '/books/OL1M' }));
    const books = await import('../src/books.js');

    const un = await books.identifier(resultat, 4000);
    expect(un.resolue).toBe(true);
    expect(un.oeuvreId).toBe('ol:OL893414W');

    const apres = appels.length;
    await books.identifier(resultat, 4000);
    expect(appels).toHaveLength(apres);
  });

  it('Open Library injoignable ne bloque pas : on retombe sur une identite locale', async () => {
    reseau(() => { throw new Error('reseau coupe'); });
    const books = await import('../src/books.js');

    const id = await books.identifier(resultat, 1000);
    expect(id.resolue).toBe(false);
    expect(id.oeuvreId).toMatch(/^fp:/);       // empreinte locale, jamais une erreur
  });
});

describe('Suggestions : ne pas payer deux fois dans la journee', () => {
  const graines = [{ oeuvreId: 'x1', titre: 'Germinal', auteurs: 'Zola', categories: 'Fiction' }];
  const exclusions = { empreintes: new Set(), isbn: new Set() };

  it('le deuxieme Actualiser du jour ne consomme aucune requete', async () => {
    reseau((n) => ok(reponseGoogle(3, n * 10)));
    const books = await import('../src/books.js');

    const premier = await books.suggestions(graines, [], exclusions, 'profil|x1');
    const apres = appels.length;
    expect(apres).toBeGreaterThan(0);
    expect(premier.length).toBeGreaterThan(0);

    const second = await books.suggestions(graines, [], exclusions, 'profil|x1');
    expect(appels).toHaveLength(apres);
    expect(second).toHaveLength(premier.length);
  });

  it('un livre marque lu change la cle, donc les suggestions se recalculent', async () => {
    reseau((n) => ok(reponseGoogle(3, n * 10)));
    const books = await import('../src/books.js');

    await books.suggestions(graines, [], exclusions, 'profil|x1');
    const apres = appels.length;
    await books.suggestions(graines, [], exclusions, 'profil|x1,x2');
    expect(appels.length).toBeGreaterThan(apres);
  });

  it('une panne de source ne fige pas un ecran vide pour la journee', async () => {
    reseau(() => panne());
    const books = await import('../src/books.js');

    const vide = await books.suggestions(graines, [], exclusions, 'profil|x1');
    expect(vide).toEqual([]);

    // Les sources reviennent : on doit rappeler, pas resservir le vide.
    const apres = appels.length;
    reseau((n) => ok(reponseGoogle(3, n * 10)));
    const plein = await books.suggestions(graines, [], exclusions, 'profil|x1');
    expect(appels.length).toBeGreaterThan(apres);
    expect(plein.length).toBeGreaterThan(0);
  });

  it('n-propose jamais un livre deja dans la bibliotheque', async () => {
    reseau((n) => ok(reponseGoogle(3, 0)));
    const books = await import('../src/books.js');

    const dejaLa = { empreintes: new Set([books.empreinteOeuvre('Livre 0', ['Auteur 0'])]), isbn: new Set() };
    const s = await books.suggestions(graines, [], dejaLa, 'profil|exclu');
    expect(s.some((r) => r.titre === 'Livre 0')).toBe(false);
  });
});

describe('Le cache survit a la fermeture de l-application', () => {
  /*
   * Retour d'usage 118 : « je fais une recherche, je quitte, je reprends la
   * meme recherche, il doit toujours charger ».
   *
   * C'etait exact, et c'etait un defaut de conception : le cache memoire meurt
   * avec l'application, et l'archive — qui contenait pourtant deja les
   * resultats — n'etait lue QUE dans le `catch`, donc uniquement quand Google
   * tombait. On rappelait Google alors qu'on avait la reponse sous la main.
   */
  it('la meme recherche, apres relance, ne rappelle PAS la source', async () => {
    /*
     * Open Library repond ICI comme dans la vraie vie. Sans cela, elle
     * tombait dans le chemin d'echec — dont la memoire ne survit PAS a une
     * relance, par conception — et le test comptait un appel de plus.
     * En la faisant repondre, on verifie du meme coup que le cache de
     * notoriete (sept jours, sur disque) survit lui aussi a la fermeture.
     */
    /*
     * Les six auteurs sont reconnus par Open Library : sans cela, le filtre
     * « hors-sujet » (mission « le bruit d'abord ») ne garderait que le livre
     * de l'auteur notoire, et ce test — qui verifie le CACHE, pas le filtre —
     * compterait une longueur reduite sans rapport avec son objet.
     */
    reseau((n, url) => (url.includes('openlibrary.org/search')
      ? ok({ docs: Array.from({ length: 6 }, (_, i) => ({ key: `/works/OL${i}W`, title: `Livre ${i}`, author_name: [`Auteur ${i}`], readinglog_count: 100 - i })) })
      : ok(reponseGoogle(6))));
    let books = await import('../src/books.js');
    const premier = await books.rechercher('dune', 'titre');
    expect(premier.resultats).toHaveLength(6);
    const apresPremier = appels.length;
    expect(apresPremier).toBeGreaterThan(0);

    // L'application est fermee puis relancee : la memoire vive repart a zero,
    // l'archive sur disque demeure.
    vi.resetModules();
    books = await import('../src/books.js');

    const second = await books.rechercher('dune', 'titre');
    expect(second.resultats).toHaveLength(6);
    expect(appels).toHaveLength(apresPremier);      // AUCUN appel de plus
    expect(second.ancien).toBe(false);              // ce ne sont pas des « vieux » resultats
  });

  it('une recherche DIFFERENTE appelle bien la source', async () => {
    reseau(() => ok(reponseGoogle(4)));
    let books = await import('../src/books.js');
    await books.rechercher('dune', 'titre');
    const apres = appels.length;

    vi.resetModules();
    books = await import('../src/books.js');
    await books.rechercher('germinal', 'titre');
    expect(appels.length).toBeGreaterThan(apres);
  });

  it('le mode compte : le meme mot en Titre et en Auteur sont deux recherches', async () => {
    reseau(() => ok(reponseGoogle(3)));
    const books = await import('../src/books.js');
    await books.rechercher('zola', 'titre');
    const apres = appels.length;
    await books.rechercher('zola', 'auteur');
    expect(appels.length).toBeGreaterThan(apres);
  });
});

describe('Preciser l-auteur avec le titre (correction 1)', () => {
  /*
   * Retour d-usage : « je ne trouve pas un livre plutot connu ». Sur « les
   * fourmis », dix livres portent exactement ce titre — le roman de Werber et
   * neuf documentaires jeunesse. Aucun signal ne permet de deviner lequel est
   * voulu ; l-application ne permettait pas non plus de le DIRE.
   */
  const vide = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
  // Une URL rend les espaces en « + » : on relit la requete telle qu-elle a
  // ete ecrite, pas telle qu-elle voyage.
  const lisible = (url) => decodeURIComponent(String(url)).replace(/\+/g, ' ');

  it('envoie inauthor: a Google quand l-auteur est precise', async () => {
    const appels = [];
    vi.stubGlobal('fetch', async (url) => { appels.push(String(url)); return vide(); });

    const books = await import('../src/books.js');
    await books.rechercher('les fourmis', 'titre', 0, 'werber');

    const google = appels.find((u) => u.includes('googleapis'));
    expect(lisible(google)).toContain('intitle:les fourmis');
    expect(lisible(google)).toContain('inauthor:"werber"');
    vi.unstubAllGlobals();
  });

  it('n-envoie RIEN de plus quand l-auteur est vide', async () => {
    const appels = [];
    vi.stubGlobal('fetch', async (url) => { appels.push(String(url)); return vide(); });

    const books = await import('../src/books.js');
    await books.rechercher('les fourmis', 'titre');

    const google = appels.find((u) => u.includes('googleapis'));
    expect(lisible(google)).not.toContain('inauthor');
    vi.unstubAllGlobals();
  });

  it('ne SERT PAS la reponse sans auteur a une recherche avec auteur', async () => {
    /*
     * Le piege du cache : « les fourmis » et « les fourmis de Werber » sont
     * deux questions differentes. Servir la premiere reponse pour la seconde
     * annulerait tout l-interet du champ.
     */
    let n = 0;
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).includes('googleapis')) n += 1;
      return vide();
    });

    const books = await import('../src/books.js');
    await books.rechercher('les fourmis', 'titre');
    const avant = n;
    await books.rechercher('les fourmis', 'titre', 0, 'werber');

    expect(n).toBeGreaterThan(avant);
    vi.unstubAllGlobals();
  });

  it('la meme question deux fois ne coute qu-un appel', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async (url) => {
      if (String(url).includes('googleapis')) n += 1;
      return new Response(JSON.stringify({
        items: [{ id: 'v1', volumeInfo: { title: 'Les Fourmis', authors: ['Bernard Werber'] } }],
      }), { status: 200 });
    });

    const books = await import('../src/books.js');
    await books.rechercher('les fourmis', 'titre', 0, 'werber');
    const avant = n;
    await books.rechercher('les fourmis', 'titre', 0, 'werber');

    expect(n).toBe(avant);
    vi.unstubAllGlobals();
  });
});

/*
 * LA NOTORIETE SURVIT AUX PANNES D'OPEN LIBRARY (mission V2, M3)
 *
 * Open Library n'a ni cle ni quota, mais aucun engagement de service : mesure
 * du 2026-08-28, sur une fenetre degradee, 2 reponses sur 12 a une requete
 * triviale. Sans cache, le classement d'une recherche dependait donc de
 * l'humeur du service a la seconde ou l'on tapait — constate au banc d'essai,
 * ou « game of thrones » etait la seule des sept recherches a ne rien recevoir,
 * et donc la seule a rester mal classee.
 */
describe('La notoriete des oeuvres, et sa resistance', () => {
  const oeuvresOL = {
    docs: [
      { key: '/works/OL1W', title: 'Livre 0', author_name: ['Auteur 0'], readinglog_count: 5000 },
      { key: '/works/OL2W', title: 'Autre', author_name: ['Quelqu-un'], readinglog_count: 12 },
    ],
  };

  /*
   * CHAQUE VERIFICATION UTILISE SON PROPRE MOT. `books.js` garde un cache
   * memoire de 30 min (§4.7), et il survit d'une verification a l'autre : en
   * cherchant « dune » partout, la quatrieme relisait le resultat DEJA CLASSE
   * de la premiere et passait au vert sans rien exercer. Un mot par cas, et le
   * cache ne peut plus mentir.
   */

  /** Aiguillage par source : Google, la BnF et Open Library repondent chacune. */
  function troisSources({ olEnPanne = false } = {}) {
    const vus = { google: 0, ol: 0 };
    reseau((n, url) => {
      if (url.includes('openlibrary.org/search')) {
        vus.ol += 1;
        return olEnPanne ? Promise.reject(new TypeError('coupure')) : ok(oeuvresOL);
      }
      if (url.includes('bnf.fr')) return ok({});
      vus.google += 1;
      return ok(reponseGoogle(3));
    });
    return vus;
  }

  it('classe les resultats avec le RANG de l-auteur chez Open Library', async () => {
    troisSources();
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('dune', 'titre');
    const premier = resultats.find((r) => r.auteurs.includes('Auteur 0'));
    expect(premier.rangAuteur).toBe(0);
    expect(premier.lecteurs).toBe(5000);
    /*
     * NOUVEAU CONTRAT (mission « le bruit d'abord ») : un livre dont l'auteur
     * n'est pas reconnu par Open Library ET dont le titre ne colle pas a la
     * recherche est desormais RETIRE, plus seulement mal classe.
     */
    expect(resultats.some((r) => r.auteurs.includes('Auteur 1'))).toBe(false);
    // attribuerNotoriete, elle, n'invente jamais de rang pour un auteur inconnu.
    const classes = books.attribuerNotoriete(
      [{ cleSource: 'x', titre: 'Livre 1', auteurs: ['Auteur 1'] }],
      [{ auteurs: ['Auteur 0'], lecteurs: 5000 }],
    );
    expect(classes[0].rangAuteur).toBeUndefined();
  });

  it('N-APPELLE OPEN LIBRARY QU-UNE FOIS pour toutes les pages d-une recherche', async () => {
    // Sans cache, la page 2 repartait non classee et se rangeait au hasard
    // parmi des cartes classees : l-ecran se reorganisait au defilement.
    const vus = troisSources();
    const books = await import('../src/books.js');

    await books.rechercher('fondation', 'titre', 0);
    await books.rechercher('fondation', 'titre', 1);
    expect(vus.google).toBeGreaterThanOrEqual(2);
    expect(vus.ol).toBe(1);
  });

  it('RESSORT UNE NOTORIETE PERIMEE quand Open Library ne repond plus', async () => {
    // Une notoriete de la semaine derniere classe aussi bien que celle
    // d-aujourd-hui : Martin ecrivait deja « Game of Thrones ».
    faux.set('notoriete:hyperion', {
      pose: Date.now() - 30 * 24 * 60 * 60 * 1000,   // largement perimee
      oeuvres: [{ cleOeuvre: 'ol:OL1W', titre: 'Livre 0', auteurs: ['Auteur 0'], lecteurs: 777 }],
    });
    troisSources({ olEnPanne: true });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('hyperion', 'titre');
    const premier = resultats.find((r) => r.auteurs.includes('Auteur 0'));
    expect(premier.rangAuteur).toBe(0);
    expect(premier.lecteurs).toBe(777);
  });

  it('une panne d-Open Library ne fait JAMAIS echouer la recherche', async () => {
    troisSources({ olEnPanne: true });
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('ubik', 'titre');
    expect(resultats).toHaveLength(3);          // la recherche aboutit
    expect(resultats.every((r) => r.rangAuteur === undefined)).toBe(true);  // sans ordre
  });

  it('NE MET PAS EN CACHE une reponse vide', async () => {
    // Sinon un echec deguise en « rien trouve » empecherait de redemander
    // pendant sept jours.
    reseau((n, url) => {
      if (url.includes('openlibrary.org/search')) return ok({ docs: [] });
      if (url.includes('bnf.fr')) return ok({});
      return ok(reponseGoogle(2));
    });
    const books = await import('../src/books.js');

    await books.rechercher('solaris', 'titre');
    expect(faux.has('notoriete:solaris')).toBe(false);
  });

  it('n-interroge pas Open Library en mode ISBN — rien a classer', async () => {
    const vus = troisSources();
    const books = await import('../src/books.js');

    await books.rechercher('9782070368228', 'isbn');
    expect(vus.ol).toBe(0);
  });
});

/*
 * LE CACHE NE STOCKE QUE DU BRUT (M2, 2026-08-30)
 *
 * Le defaut repare : l'archive de 24 h gardait les resultats DEJA classes.
 * Une recherche deja faite ressortait donc avec le classement de la version
 * precedente, et toute correction restait invisible une journee entiere.
 * Mesure sur le telephone : la page 1 sortait de la conserve et les pages
 * suivantes etaient cherchees en direct — d'ou « les vrais resultats
 * n'apparaissent qu'en defilant ».
 */
describe('Le cache de recherche ne fige plus le classement', () => {
  const oeuvresOL = {
    docs: [{ key: '/works/OL9W', title: 'Livre 0', author_name: ['Auteur 0'], readinglog_count: 4242 }],
  };

  function sources() {
    const vus = { google: 0, ol: 0 };
    reseau((n, url) => {
      if (url.includes('openlibrary.org/search')) { vus.ol += 1; return ok(oeuvresOL); }
      if (url.includes('bnf.fr')) return ok({});
      vus.google += 1;
      return ok(reponseGoogle(3));
    });
    return vus;
  }

  it('ARCHIVE DU BRUT : ni notoriete ni fusion ne sont enregistrees', async () => {
    sources();
    const books = await import('../src/books.js');
    await books.rechercher('archive-brute', 'titre');
    // L'archivage est volontairement NON attendu (il ne doit pas retarder
    // l'affichage) : on laisse passer un tour de boucle avant de le lire.
    await new Promise((r) => setTimeout(r, 0));

    const entree = faux.get('recherche:titre:archive-brute');
    expect(entree).toBeTruthy();
    // Le classement ne doit PAS etre dans l'archive : il se recalcule.
    expect(entree.resultats.every((r) => r.rangAuteur === undefined)).toBe(true);
    // Ni la fusion : l'archive garde ce que la source a rendu.
    expect(entree.resultats).toHaveLength(3);
  });

  it('RECLASSE une recherche servie depuis l-archive', async () => {
    // C'est le coeur de la correction : on pose une archive fraiche SANS
    // classement — comme celles ecrites par la version precedente — et la
    // recherche doit en ressortir classee.
    faux.set('recherche:titre:vieille', {
      pose: Date.now(),
      resultats: [
        { cleSource: 'gb:1', titre: 'Livre 0', auteurs: ['Auteur 0'], categories: [] },
        { cleSource: 'gb:2', titre: 'Livre 1', auteurs: ['Auteur 1'], categories: [] },
      ],
    });
    const vus = sources();
    const books = await import('../src/books.js');

    const { resultats } = await books.rechercher('vieille', 'titre');
    expect(vus.google).toBe(0);                 // l'archive a bien servi
    const classe = resultats.find((r) => r.auteurs.includes('Auteur 0'));
    expect(classe.rangAuteur).toBe(0);          // et le classement est neuf
    expect(classe.lecteurs).toBe(4242);
  });

  it('ne rappelle PAS Open Library quand elle vient de ne rien rendre', async () => {
    // Depuis que le classement se recalcule a chaque affichage, une recherche
    // repetee redemandait la notoriete a chaque fois. On memorise donc aussi
    // les echecs — une heure, pas sept jours.
    const vus = { ol: 0 };
    reseau((n, url) => {
      if (url.includes('openlibrary.org/search')) { vus.ol += 1; return ok({ docs: [] }); }
      if (url.includes('bnf.fr')) return ok({});
      return ok(reponseGoogle(2));
    });
    const books = await import('../src/books.js');

    await books.rechercher('muette', 'titre');
    await books.rechercher('muette', 'titre');
    expect(vus.ol).toBe(1);
  });
});

/*
 * VIDER LE CACHE — le bouton qui manquait. Vider les donnees de l'application
 * depuis Android aurait emporte la bibliotheque : ce bouton ne touche QUE le
 * cache.
 */
describe('Vider le cache de recherche', () => {
  it('jette les recherches archivees ET la notoriete', async () => {
    faux.set('recherche:titre:a', { pose: Date.now(), resultats: [] });
    faux.set('recherche:titre:b', { pose: Date.now(), resultats: [] });
    faux.set('notoriete:a', { pose: Date.now(), oeuvres: [] });
    const books = await import('../src/books.js');

    const jetees = await books.viderCacheRecherche();
    expect(jetees).toBe(3);
    expect(faux.has('recherche:titre:a')).toBe(false);
    expect(faux.has('notoriete:a')).toBe(false);
  });

  it('NE TOUCHE NI LA BIBLIOTHEQUE NI L-HISTORIQUE', async () => {
    // La regle qui justifie l'existence du bouton.
    faux.set('db:lecture', 'la base entiere');
    faux.set('historiqueRecherches', ['dune']);
    faux.set('recherche:titre:a', { pose: Date.now(), resultats: [] });
    const books = await import('../src/books.js');

    await books.viderCacheRecherche();
    expect(faux.get('db:lecture')).toBe('la base entiere');
    expect(faux.get('historiqueRecherches')).toEqual(['dune']);
    expect(faux.has('recherche:titre:a')).toBe(false);
  });

  it('ne se plaint pas quand il n-y a rien a vider', async () => {
    const books = await import('../src/books.js');
    await expect(books.viderCacheRecherche()).resolves.toBe(0);
  });
});
