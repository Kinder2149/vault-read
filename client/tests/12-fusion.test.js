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
