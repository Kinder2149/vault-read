/*
 * FAMILLE 12 — QUAND DEUX FICHES SONT LE MEME LIVRE
 *
 * Le defaut repare : « je n'ai pas toujours la couverture, parfois elle est
 * completement fausse, la description ne correspond pas au titre ».
 *
 * Cause : la cle de regroupement coupait le titre au « : » — elle jetait donc
 * le morceau qui distingue les livres — et gardait le sous-titre, ou se trouve
 * le bruit d'edition. Elle faisait l'inverse de ce qu'il fallait.
 *
 * Les cas ci-dessous ne sont pas inventes : ce sont les fiches REELLES
 * relevees sur les sagas de test le 2026-08-30.
 *
 * Aucun appel reseau : la fusion est un calcul pur.
 */

import { describe, it, expect } from 'vitest';
import { fusionnerDoublons } from '../src/books.js';

let n = 0;
const fiche = (o) => ({
  cleSource: `gb:${(n += 1)}`,
  titre: '', sousTitre: null, auteurs: ['Un Auteur'],
  couvertureUrl: null, resume: null, editeur: null,
  isbn13: null, isbn10: null, nbPages: null, categories: [], langue: 'fr',
  ...o,
});

/** Combien de cartes, et laquelle contient telle fiche. */
const carteDe = (cartes, cleSource) => cartes.find((c) => c.clesSource.includes(cleSource));

describe('Ce qui ne doit JAMAIS fusionner', () => {
  it('un livre SUR le film ne rejoint pas le roman', () => {
    // Le cas qui a tout declenche : la carte affichait le titre du roman et la
    // couverture du making-of.
    const roman = fiche({ titre: 'Le Seigneur des anneaux', auteurs: ['J.R.R. Tolkien'] });
    const film = fiche({
      titre: "Le Seigneur des Anneaux : La communauté de l'anneau. Les coulisses du film",
      auteurs: ['J.R.R. Tolkien'],
    });
    expect(fusionnerDoublons([roman, film], 'le seigneur des anneaux')).toHaveLength(2);
  });

  it('deux tomes distingues APRES le deux-points restent separes', () => {
    const t1 = fiche({ titre: "Le seigneur des anneaux : la communauté de l'anneau", auteurs: ['Tolkien'] });
    const t2 = fiche({ titre: 'Le seigneur des anneaux : les deux tours', auteurs: ['Tolkien'] });
    expect(fusionnerDoublons([t1, t2], 'le seigneur des anneaux')).toHaveLength(2);
  });

  it('deux TOMES numerotes du meme titre restent separes', () => {
    // Sinon le tome disparait de la carte — « le titre ne precise pas le tome ».
    const a = fiche({ titre: 'Le Trône de Fer', sousTitre: 'Tome 1', auteurs: ['Martin'] });
    const b = fiche({ titre: 'Le Trône de Fer', sousTitre: 'Tome 5', auteurs: ['Martin'] });
    expect(fusionnerDoublons([a, b], 'le trone de fer')).toHaveLength(2);
  });

  it('deux auteurs differents ne fusionnent pas, meme titre identique', () => {
    // « Les fourmis » de Werber et neuf documentaires jeunesse homonymes.
    const werber = fiche({ titre: 'Les fourmis', auteurs: ['Bernard Werber'] });
    const ledu = fiche({ titre: 'Les fourmis', auteurs: ['Stéphanie Ledu'] });
    expect(fusionnerDoublons([werber, ledu], 'les fourmis')).toHaveLength(2);
  });

  it('une fiche SANS auteur reste seule plutot que d-aspirer les autres', () => {
    const sans = fiche({ titre: 'Germinal', auteurs: [] });
    const avec = fiche({ titre: 'Germinal', auteurs: ['Émile Zola'] });
    expect(fusionnerDoublons([sans, avec], 'germinal')).toHaveLength(2);
  });
});

describe('Ce qui DOIT fusionner', () => {
  it('les editions qui ne different que par le SOUS-TITRE', () => {
    // Mesure reelle : 24 fiches de Germinal, toutes le roman de Zola, dont
    // seul le sous-titre change. Les separer donnerait 24 cartes pour un livre.
    const editions = [
      fiche({ titre: 'Germinal', sousTitre: 'roman', auteurs: ['Émile Zola'] }),
      fiche({ titre: 'Germinal', sousTitre: 'Large Print', auteurs: ['Emile Zola'] }),
      fiche({ titre: 'Germinal', sousTitre: 'Les Rougon-Macquart', auteurs: ['Zola, Emile'] }),
      fiche({ titre: 'GERMINAL', sousTitre: null, auteurs: ['emile zola'] }),
    ];
    expect(fusionnerDoublons(editions, 'germinal')).toHaveLength(1);
  });

  it('l-ORDRE DU NOM ne separe pas : « Zola, Emile » et « Emile Zola »', () => {
    const a = fiche({ titre: 'Germinal', auteurs: ['Zola, Émile'] });
    const b = fiche({ titre: 'Germinal', auteurs: ['Emile Zola'] });
    expect(fusionnerDoublons([a, b], 'germinal')).toHaveLength(1);
  });

  it('le MEME ISBN fusionne, meme quand les titres different', () => {
    // L'ISBN est une PREUVE : il passe avant toute comparaison de texte.
    const a = fiche({ titre: 'Germinal', auteurs: ['Zola'], isbn13: '978-2-07-036159-2' });
    const b = fiche({ titre: 'Germinal, édition annotée', auteurs: ['Zola'], isbn13: '9782070361592' });
    expect(fusionnerDoublons([a, b], 'germinal')).toHaveLength(1);
  });

  it('les deux raisons se CHAINENT : A-B par l-ISBN, B-C par le titre', () => {
    const a = fiche({ titre: 'Un titre autrement écrit', auteurs: ['Zola'], isbn13: '9782070361592' });
    const b = fiche({ titre: 'Germinal', auteurs: ['Zola'], isbn13: '9782070361592' });
    const c = fiche({ titre: 'Germinal', sousTitre: 'roman', auteurs: ['Zola'] });
    expect(fusionnerDoublons([a, b, c], 'germinal')).toHaveLength(1);
  });
});

describe('Ce que la carte affiche', () => {
  it('les fiches d-un groupe se COMPLETENT — c-est l-interet de fusionner', () => {
    const pauvre = fiche({ titre: 'Germinal', auteurs: ['Zola'], couvertureUrl: 'image.jpg' });
    const riche = fiche({
      titre: 'Germinal', sousTitre: 'roman', auteurs: ['Zola'],
      editeur: 'Gallimard', isbn13: '9782070361592', nbPages: 592, resume: 'Etienne Lantier…',
    });
    const [carte] = fusionnerDoublons([pauvre, riche], 'germinal');
    expect(carte.couvertureUrl).toBe('image.jpg');
    expect(carte.editeur).toBe('Gallimard');
    expect(carte.resume).toBe('Etienne Lantier…');
    expect(carte.clesSource).toHaveLength(2);
  });

  it('NE PREND JAMAIS la couverture d-un livre au titre different', () => {
    // La verification qui protege le defaut rapporte, dans les deux sens :
    // le roman n'herite pas de l'image du making-of, et reciproquement.
    const roman = fiche({ titre: 'Le Seigneur des anneaux', auteurs: ['Tolkien'], couvertureUrl: null });
    const film = fiche({
      titre: 'Le Seigneur des Anneaux : Les coulisses du film',
      auteurs: ['Tolkien'], couvertureUrl: 'coulisses.jpg',
    });
    const cartes = fusionnerDoublons([roman, film], 'le seigneur des anneaux');
    expect(carteDe(cartes, roman.cleSource).couvertureUrl).toBeNull();
    expect(carteDe(cartes, film.cleSource).couvertureUrl).toBe('coulisses.jpg');
  });
});

describe('Refondre une liste deja fondue ne change rien', () => {
  it('est idempotent — l-ecran refond a chaque page chargee', () => {
    const liste = [
      fiche({ titre: 'Germinal', auteurs: ['Zola'], couvertureUrl: 'a.jpg' }),
      fiche({ titre: 'Germinal', sousTitre: 'roman', auteurs: ['Zola'], editeur: 'Gallimard' }),
      fiche({ titre: 'La Bête humaine', auteurs: ['Zola'] }),
    ];
    const une = fusionnerDoublons(liste, 'germinal');
    const deux = fusionnerDoublons(une, 'germinal');
    expect(deux).toHaveLength(une.length);
    expect(deux.map((c) => c.clesSource.length).sort()).toEqual(une.map((c) => c.clesSource.length).sort());
  });

  it('une carte fondue GARDE toutes ses cles — un livre suivi reste marque', () => {
    const a = fiche({ titre: 'Germinal', auteurs: ['Zola'] });
    const b = fiche({ titre: 'Germinal', sousTitre: 'roman', auteurs: ['Zola'] });
    const [carte] = fusionnerDoublons([a, b], 'germinal');
    expect(carte.clesSource).toEqual(expect.arrayContaining([a.cleSource, b.cleSource]));
  });
});

describe('Les EDITIONS d-un meme livre ne font qu-une carte (mission « regrouper »)', () => {
  /*
   * Retour d'usage : « les editions d'un meme livre ne sont pas regroupees ;
   * on voudrait la plus populaire sur une seule carte, et choisir l'edition
   * dans la fiche ». Les mentions de FORMAT (« Edition de luxe », « poche »,
   * « integrale »…) distinguent deux exemplaires du meme texte, pas deux
   * textes : elles sortent donc de la cle de regroupement.
   */
  it('les mentions de format (luxe, illustree, poche…) ne separent plus le meme tome', () => {
    const editions = [
      fiche({ titre: "Le Trône de fer l'Intégrale (A game of Thrones) Tome 1 . Edition de luxe", auteurs: ['George R. R. Martin'] }),
      fiche({ titre: "Le Trône de fer l'Intégrale (A game of Thrones) Tome 1 . Edition illustrée", auteurs: ['George R. R. Martin'] }),
      fiche({ titre: 'Le Trône de fer (A game of Thrones) Tome 1', auteurs: ['George R. R. Martin'] }),
    ];
    expect(fusionnerDoublons(editions, 'le trone de fer')).toHaveLength(1);
  });

  it('MAIS deux TOMES depouilles de leur mention d-edition restent separes', () => {
    // Le numero de tome reste dans la cle : sans cela, depouiller « Edition de
    // luxe » ferait fusionner le tome 1 et le tome 3.
    const t1 = fiche({ titre: 'Le Trône de fer Tome 1 . Edition de luxe', auteurs: ['Martin'] });
    const t3 = fiche({ titre: 'Le Trône de fer Tome 3 . Edition de luxe', auteurs: ['Martin'] });
    expect(fusionnerDoublons([t1, t3], 'le trone de fer')).toHaveLength(2);
  });

  it('et deux OEUVRES distinctes que seul un mot porteur separe ne fusionnent pas', () => {
    // « annotee » et « texte abrege » ne sont PAS des mentions de format : ce
    // sont des livres differents, ils gardent chacun leur carte.
    const roman = fiche({ titre: 'Germinal', auteurs: ['Émile Zola'] });
    const abrege = fiche({ titre: 'Germinal - Texte abrégé', auteurs: ['Émile Zola'] });
    expect(fusionnerDoublons([roman, abrege], 'germinal')).toHaveLength(2);
  });
});

describe('Tranche 31 — coffrets et integrales ne fusionnent pas avec un livre seul', () => {
  /*
   * Les titres sont ceux relevés par le banc du 2026-09-19. Un test par point
   * du critère de validation écrit par Kinder (PROJET_CONTEXTE.md, tranche 31).
   */

  // Critère 1 — « harry potter » : le coffret a sa propre carte et sa couverture.
  it('un COFFRET garde sa carte, et le livre seul ne prend pas sa couverture', () => {
    const seul = fiche({ titre: 'Harry Potter', auteurs: ['J. K. Rowling'] });
    const coffret = fiche({
      titre: 'Harry Potter Coffret', auteurs: ['J. K. Rowling'],
      couvertureUrl: 'https://exemple/coffret.jpg',
    });
    const cartes = fusionnerDoublons([seul, coffret], 'harry potter');
    expect(cartes).toHaveLength(2);
    expect(carteDe(cartes, seul.cleSource).couvertureUrl).toBeNull();
    expect(carteDe(cartes, coffret.cleSource).couvertureUrl).toBe('https://exemple/coffret.jpg');
  });

  // Critère 2 — « les fourmis » : l'intégrale a sa carte, le roman garde la sienne.
  it('une INTEGRALE sans numero garde sa carte, et le roman ne lui emprunte rien', () => {
    const roman = fiche({ titre: 'Les fourmis', auteurs: ['Bernard Werber'] });
    const integrale = fiche({
      titre: 'Les Fourmis - Intégrale', auteurs: ['Bernard Werber'],
      couvertureUrl: 'https://exemple/integrale.jpg', resume: 'Les trois romans.',
    });
    const cartes = fusionnerDoublons([roman, integrale], 'les fourmis');
    expect(cartes).toHaveLength(2);
    const carteRoman = carteDe(cartes, roman.cleSource);
    expect(carteRoman.couvertureUrl).toBeNull();
    expect(carteRoman.resume).toBeNull();
  });

  // Critère 3 — « le trône de fer » : intégrale 1 et intégrale 3 sont deux cartes.
  it('l-integrale 1 et l-integrale 3 restent deux cartes, tome lu ou non', () => {
    const i1 = fiche({ titre: "Le Trône de Fer (L'intégrale 1 illustrée)", auteurs: ['George R. R. Martin'] });
    const i3 = fiche({ titre: "Le Trone de Fer, L'Integrale - 3", auteurs: ['George R. R. Martin'] });
    expect(fusionnerDoublons([i1, i3], 'le trone de fer')).toHaveLength(2);

    const a = fiche({ titre: "Le Trône de Fer, L'Intégrale - 1", auteurs: ['George R. R. Martin'] });
    const b = fiche({ titre: "Le Trône de Fer, L'Intégrale - 3", auteurs: ['George R. R. Martin'] });
    expect(fusionnerDoublons([a, b], 'le trone de fer')).toHaveLength(2);
  });

  // Critère 4 — « game of thrones » et « germinal » : les éditions d'un même livre restent groupées.
  it('les editions de luxe, illustrees et poche d-un meme livre restent sur une carte', () => {
    const germinal = [
      fiche({ titre: 'Germinal', auteurs: ['Émile Zola'] }),
      fiche({ titre: 'Germinal illustrée', auteurs: ['Émile Zola'] }),
      fiche({ titre: 'Germinal (Édition française) (Illustré)', auteurs: ['Émile Zola'] }),
      fiche({ titre: 'Germinal (French)', auteurs: ['Émile Zola'] }),
      fiche({ titre: 'Germinal 2020', auteurs: ['Émile Zola'] }),
    ];
    expect(fusionnerDoublons(germinal, 'germinal')).toHaveLength(1);

    const got = [
      fiche({ titre: 'A Game of Thrones', auteurs: ['George R. R. Martin'] }),
      fiche({ titre: 'Game of Thrones', auteurs: ['George R. R. Martin'] }),
      fiche({ titre: 'Game of Thrones - Edition de luxe', auteurs: ['George R. R. Martin'] }),
    ];
    expect(fusionnerDoublons(got, 'game of thrones')).toHaveLength(1);
  });

  it('un nombre ecrit « 01 » ou « 1 » reste le meme tome', () => {
    const a = fiche({ titre: "La Quête d'Ewilan - Tome 01", auteurs: ['Pierre Bottero'] });
    const b = fiche({ titre: "La Quête d'Ewilan - Tome 1", auteurs: ['Pierre Bottero'] });
    expect(fusionnerDoublons([a, b], "la quete d'ewilan")).toHaveLength(1);
  });

  it('un titre fait d-un seul nombre reste lisible (« 1984 »)', () => {
    const a = fiche({ titre: '1984', auteurs: ['George Orwell'] });
    const b = fiche({ titre: '1984', auteurs: ['George Orwell'] });
    expect(fusionnerDoublons([a, b], '1984')).toHaveLength(1);
  });
});
