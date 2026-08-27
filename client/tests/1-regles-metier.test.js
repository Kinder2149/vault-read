/*
 * FAMILLE 1 — LES REGLES METIER
 *
 * Ce que ces verifications protegent, en francais : ce sont les regles qui
 * decident si deux livres sont la meme oeuvre, comment se lit un numero de
 * tome, et ou en est une lecture. Elles ne touchent ni au reseau ni a la base,
 * donc elles sont instantanees et donnent toujours le meme resultat.
 *
 * Chaque cas vient d'une mesure ou d'un bug reel documente dans le
 * PROJET_CONTEXTE, jamais d'un exemple invente pour faire joli.
 */

import { describe, it, expect } from 'vitest';
import { empreinteOeuvre, fusionnerDoublons } from '../src/books.js';
import { normaliserDatePublication, lireCycle } from '../src/sources/openlibrary.js';
import { estIsbn } from '../src/scanner.js';
import { progressionDe, aujourdhui, classeStatut, LIBELLES, STATUTS, ageLisible } from '../src/status.js';
import { cleAuteur, grouperParAuteur } from '../src/auteurs.js';

describe('Reconnaitre qu-il s-agit du meme livre', () => {
  it('ignore la casse, les accents et la ponctuation', () => {
    expect(empreinteOeuvre('Les Fourmis', ['Bernard Werber']))
      .toBe(empreinteOeuvre('LES  FOURMIS', ['bernard werber']));
  });

  it('coupe le sous-titre apres les deux-points', () => {
    // Une meme oeuvre editee avec et sans sous-titre doit se rejoindre.
    expect(empreinteOeuvre('Dune : le cycle', ['Frank Herbert']))
      .toBe(empreinteOeuvre('Dune', ['Frank Herbert']));
  });

  it('n-utilise QUE le premier auteur (§3.2)', () => {
    // Open Library rend les translitterations dans la meme liste : Dune porte
    // « Frank Herbert » ET « Френк Герберт ». Prendre tous les auteurs cassait
    // la deduplication.
    expect(empreinteOeuvre('Dune', ['Frank Herbert', 'Френк Герберт']))
      .toBe(empreinteOeuvre('Dune', ['Frank Herbert']));
  });

  it('distingue deux livres de titre identique mais d-auteurs differents', () => {
    expect(empreinteOeuvre('Le Feu', ['Henri Barbusse']))
      .not.toBe(empreinteOeuvre('Le Feu', ['Maria Pourchet']));
  });

  it('ne tombe pas sur un titre ou un auteur manquant', () => {
    expect(() => empreinteOeuvre('', [])).not.toThrow();
    expect(() => empreinteOeuvre(null, null)).not.toThrow();
  });
});

describe('Lire les dates d-Open Library (texte libre, pas de l-ISO)', () => {
  it('garde une date deja au format ISO', () => {
    expect(normaliserDatePublication('2021-08-26')).toBe('2021-08-26');
    expect(normaliserDatePublication('2021-08')).toBe('2021-08');
  });

  it('convertit Aug 26 2021 en 2021-08-26', () => {
    // Sans conversion, §3.3 compare les dates lexicographiquement et rangerait
    // « Aug 26, 2021 » AVANT « 1978 ».
    expect(normaliserDatePublication('Aug 26, 2021')).toBe('2021-08-26');
    expect(normaliserDatePublication('August 2, 2005')).toBe('2005-08-02');
  });

  it('accepte un mois seul et une annee seule', () => {
    expect(normaliserDatePublication('March 1999')).toBe('1999-03');
    expect(normaliserDatePublication('1978')).toBe('1978');
  });

  it('rend null plutot qu-une date fausse quand rien ne se lit', () => {
    expect(normaliserDatePublication('')).toBeNull();
    expect(normaliserDatePublication(null)).toBeNull();
    expect(normaliserDatePublication('sans date')).toBeNull();
  });
});

describe('Lire le cycle et le numero de tome', () => {
  it('lit la forme francaise tome N', () => {
    expect(lireCycle('Le Trône de fer, tome 3'))
      .toEqual({ cycleNom: 'Le Trône de fer', cycleTome: 3 });
  });

  it('lit les formes anglaises Book N, (N) et #N', () => {
    expect(lireCycle('Dune Chronicles, Book 1').cycleTome).toBe(1);
    expect(lireCycle('Dune (1)').cycleTome).toBe(1);
    expect(lireCycle('Discworld #5').cycleTome).toBe(5);
  });

  it('ne garde que la premiere serie quand il y en a plusieurs', () => {
    expect(lireCycle('Dune (1); Dune Chronicles, Book 1').cycleNom).toBe('Dune');
  });

  it('n-invente pas de tome quand il n-y en a pas', () => {
    expect(lireCycle('Harry Potter')).toEqual({ cycleNom: 'Harry Potter', cycleTome: null });
    expect(lireCycle(null)).toEqual({ cycleNom: null, cycleTome: null });
    expect(lireCycle('')).toEqual({ cycleNom: null, cycleTome: null });
  });
});

describe('Valider un code-barres de livre', () => {
  it('accepte les EAN13 de livres (978 et 979)', () => {
    expect(estIsbn('9782221252055')).toBe(true);
    expect(estIsbn('9791234567896')).toBe(true);
  });

  it('accepte un ISBN-10', () => {
    expect(estIsbn('2070612880')).toBe(true);
  });

  it('refuse un code-barres qui n-est pas un livre', () => {
    // Un paquet de gateaux porte un EAN13 valide, mais pas en 978/979.
    expect(estIsbn('3017620422003')).toBe(false);
    expect(estIsbn('')).toBe(false);
    expect(estIsbn(null)).toBe(false);
  });
});

describe('Ou en est ma lecture', () => {
  const livre = (o) => ({ format: 'papier', position: 0, nbPages: null, dureeMinutes: null, ...o });

  it('compte en pages pour un livre papier', () => {
    const p = progressionDe(livre({ nbPages: 300, position: 150 }));
    expect(p.unite).toBe('page');
    expect(p.pourcent).toBe(50);
  });

  it('compte en minutes pour un livre audio', () => {
    const p = progressionDe(livre({ format: 'audio', dureeMinutes: 600, position: 300 }));
    expect(p.unite).toBe('minute');
    expect(p.pourcent).toBe(50);
  });

  it('bascule en pourcentage quand la mesure est inconnue', () => {
    const p = progressionDe(livre({ nbPages: null, position: 40 }));
    expect(p.metriqueConnue).toBe(false);
    expect(p.unite).toBe('pourcent');
  });

  it('ne depasse jamais 100 pourcent, meme si la position depasse le total', () => {
    // Une pagination corrigee a la baisse peut laisser une position trop grande.
    expect(progressionDe(livre({ nbPages: 300, position: 999 })).pourcent).toBe(100);
  });

  it('ne descend jamais sous 0 pourcent', () => {
    expect(progressionDe(livre({ nbPages: 300, position: -5 })).pourcent).toBe(0);
  });

  it('donne la date du jour au format ISO', () => {
    expect(aujourdhui()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('a un libelle et une classe pour chacun des 4 statuts', () => {
    STATUTS.forEach((s) => {
      expect(LIBELLES[s]).toBeTruthy();
      expect(classeStatut(s)).toBeTruthy();
    });
  });
});

describe('Regrouper les resultats par auteur', () => {
  const livres = (...noms) => noms.map((n, i) => ({ cleSource: 'k' + i, auteurs: [n], titre: 'T' + i }));

  it('reunit les variantes d-un meme auteur (cas Dumas, mesure reelle)', () => {
    const g = grouperParAuteur(
      livres('Alexandre Dumas', 'Alexandre Dumas (père)', 'Alexandre Dumas (1802-1870)'),
      'dumas',
    );
    expect(g).toHaveLength(1);
    expect(g[0].livres).toHaveLength(3);
  });

  it('reunit initiales et prenoms complets (cas Tolkien, mesure reelle)', () => {
    const g = grouperParAuteur(
      livres('John Ronald Reuel Tolkien', 'J.R.R. Tolkien', 'Tolkien J.R.R.'),
      'tolkien',
    );
    expect(g).toHaveLength(1);
  });

  it('reunit le cas Wells, qui a fait echouer la premiere version', () => {
    // « Herbert George Wells » : le prenom est plus long que le nom. La regle
    // « mot le plus long » separait Wells en quatre groupes.
    const g = grouperParAuteur(
      livres('Herbert George Wells', 'H.G Wells', 'H. G. Wells, H. G.'),
      'wells',
    );
    expect(g).toHaveLength(1);
  });

  it('affiche la forme la plus courte du nom', () => {
    const g = grouperParAuteur(livres('Alexandre Dumas (père)', 'Alexandre Dumas'), 'dumas');
    expect(g[0].nom).toBe('Alexandre Dumas');
  });

  it('NE fusionne PAS deux auteurs reellement differents', () => {
    const g = grouperParAuteur(livres('Frank Herbert', 'Herbert Spencer'), 'herbert');
    expect(g).toHaveLength(2);
  });

  it('met l-auteur cherche en tete, les homonymes apres', () => {
    const g = grouperParAuteur(
      livres('Herbert Spencer', 'Herbert Spencer', 'Frank Herbert'),
      'frank herbert',
    );
    expect(g[0].nom).toBe('Frank Herbert');
  });

  it('range les livres sans auteur sans planter', () => {
    const g = grouperParAuteur([{ cleSource: 'x', auteurs: [], titre: 'T' }], 'x');
    expect(g[0].nom).toBe('Auteur inconnu');
  });

  it('cle : deux ecritures du meme nom donnent la meme cle', () => {
    expect(cleAuteur('J.R.R. Tolkien')).toBe(cleAuteur('John Ronald Reuel Tolkien'));
  });
});

describe('Dire l-age d-un resultat garde sur l-appareil', () => {
  const ilYA = (ms) => Date.now() - ms;

  it('de tout a l heure pour moins de 2 minutes', () => {
    expect(ageLisible(ilYA(30 * 1000))).toBe('de tout à l’heure');
  });

  it('en minutes, puis en heures, puis en jours', () => {
    expect(ageLisible(ilYA(20 * 60 * 1000))).toMatch(/20 minutes/);
    expect(ageLisible(ilYA(3 * 60 * 60 * 1000))).toMatch(/3 heures/);
    expect(ageLisible(ilYA(26 * 60 * 60 * 1000))).toBe('d’hier');
    expect(ageLisible(ilYA(3 * 24 * 60 * 60 * 1000))).toMatch(/3 jours/);
  });
});

describe('Fusionner les doublons de recherche (tranche 2)', () => {
  /*
   * Retour d'usage 122 : « un livre plutot connu apparait sans editeur et sans
   * couverture, alors que le tome 1 est complet juste a cote ». Le meme livre
   * revient chez Google sous des fiches de qualite inegale ; aucune ne les
   * rapprochait. Cas construits sur des titres REELS.
   */
  const fiche = (cleSource, extra = {}) => ({
    cleSource,
    source: 'google',
    titre: 'Les Fourmis',
    sousTitre: null,
    auteurs: ['Bernard Werber'],
    annee: '1991',
    datePublication: '1991',
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

  it('ne rend qu-UNE carte pour un livre vu plusieurs fois', () => {
    const liste = [fiche('gb:1'), fiche('gb:2'), fiche('gb:3')];
    expect(fusionnerDoublons(liste, 'les fourmis')).toHaveLength(1);
  });

  it('COMBLE les trous de la fiche retenue avec ce que les autres savent', () => {
    // Le cas exact du retour d'usage : une fiche sans editeur ni couverture,
    // et la reponse quinze lignes plus bas dans la meme liste.
    const liste = [
      fiche('gb:pauvre'),
      fiche('gb:editeur', { editeur: 'Albin Michel' }),
      fiche('gb:image', { couvertureUrl: 'https://exemple/couv.jpg', nbPages: 320 }),
    ];
    const [carte] = fusionnerDoublons(liste, 'les fourmis');
    expect(carte.editeur).toBe('Albin Michel');
    expect(carte.couvertureUrl).toBe('https://exemple/couv.jpg');
    expect(carte.nbPages).toBe(320);
  });

  it('n-ECRASE JAMAIS ce que la fiche retenue sait deja', () => {
    const liste = [
      fiche('gb:1', { editeur: 'Albin Michel', isbn13: '9782226052575' }),
      fiche('gb:2', { editeur: 'France Loisirs', isbn13: '9782744131929' }),
    ];
    const [carte] = fusionnerDoublons(liste, 'les fourmis');
    expect(carte.editeur).toBe('Albin Michel');
    expect(carte.isbn13).toBe('9782226052575');
  });

  it('garde TOUTES les cles fusionnees, pour ne pas perdre le marquage', () => {
    // Un livre suivi sous « gb:2 » doit rester marque meme si c'est « gb:1 »
    // qui a ete retenue pour l-affichage.
    const liste = [fiche('gb:1'), fiche('gb:2')];
    expect(fusionnerDoublons(liste, 'les fourmis')[0].clesSource).toEqual(['gb:1', 'gb:2']);
  });

  it('est IDEMPOTENTE : refondre une liste deja fondue ne perd aucune cle', () => {
    // L-ecran refond la liste entiere a chaque page chargee.
    const une = fusionnerDoublons([fiche('gb:1'), fiche('gb:2')], 'les fourmis');
    const deux = fusionnerDoublons([...une, fiche('gb:3')], 'les fourmis');
    expect(deux).toHaveLength(1);
    expect(deux[0].clesSource).toEqual(['gb:1', 'gb:2', 'gb:3']);
  });

  it('rapproche « Emile Zola » et « Zola, Emile » (correction 3)', () => {
    /*
     * Mesure du 2026-08-27 sur « germinal », trois pages : le meme roman se
     * presentait sous « emile zola » (28 fiches) et « Zola, Emile » (3), et
     * donnait DEUX cartes. La cle de regroupement de la recherche trie les
     * mots du nom ; l-empreinte d-oeuvre, elle, n-a pas bouge (elle est ecrite
     * en base).
     */
    const liste = [
      fiche('gb:1', { titre: 'Germinal', auteurs: ['Emile Zola'] }),
      fiche('gb:2', { titre: 'Germinal', auteurs: ['Zola, Emile'] }),
    ];
    expect(fusionnerDoublons(liste, 'germinal')).toHaveLength(1);
  });

  it('ne rapproche PAS une translitteration, faute de lettre commune', () => {
    // « Эмиль Золя » ne partage rien avec « Emile Zola » : les rapprocher
    // demanderait une regle qu-on ne sait pas ecrire sans risque.
    const liste = [
      fiche('gb:1', { titre: 'Germinal', auteurs: ['Emile Zola'] }),
      fiche('gb:2', { titre: 'Germinal', auteurs: ['Эмиль Золя'] }),
    ];
    expect(fusionnerDoublons(liste, 'germinal')).toHaveLength(2);
  });

  it('NE FUSIONNE PAS deux livres homonymes d-auteurs differents', () => {
    // « Les fourmis » de Werber et le documentaire jeunesse de Stephanie Ledu
    // portent le meme titre : les confondre EFFACERAIT un livre.
    const liste = [fiche('gb:1'), fiche('gb:2', { auteurs: ['Stéphanie Ledu'] })];
    expect(fusionnerDoublons(liste, 'les fourmis')).toHaveLength(2);
  });

  it('laisse seule une fiche sans auteur plutot que d-aspirer les autres', () => {
    const liste = [fiche('gb:1'), fiche('gb:2', { auteurs: [] }), fiche('gb:3', { auteurs: [] })];
    expect(fusionnerDoublons(liste, 'les fourmis')).toHaveLength(3);
  });

  it('retient la fiche la MIEUX CLASSEE, pas la premiere arrivee', () => {
    const liste = [
      fiche('gb:essai', { titre: 'Les Fourmis', sousTitre: 'analyse de l-oeuvre' }),
      fiche('gb:roman'),
    ];
    expect(fusionnerDoublons(liste, 'les fourmis')[0].cleSource).toBe('gb:roman');
  });

  it('garde l-ordre d-arrivee des livres, pas seulement des fiches', () => {
    const liste = [
      fiche('gb:a', { auteurs: ['Stéphanie Ledu'] }),
      fiche('gb:b'),
      fiche('gb:c', { auteurs: ['Stéphanie Ledu'] }),
    ];
    expect(fusionnerDoublons(liste, 'les fourmis').map((r) => r.cleSource))
      .toEqual(['gb:a', 'gb:b']);
  });

  it('supporte une liste vide ou absente', () => {
    expect(fusionnerDoublons([], 'x')).toEqual([]);
    expect(fusionnerDoublons(null, 'x')).toEqual([]);
  });
});
