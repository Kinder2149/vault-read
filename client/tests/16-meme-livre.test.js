/*
 * FAMILLE 16 — UN SEUL « MEME LIVRE »
 *
 * Mission « recherche satisfaisante », etape 4 (decision 6, 1re partie).
 *
 * Critere de Kinder : « Quand je cherche Le Seigneur des anneaux, chaque tome
 * n'apparait qu'une fois quand ses titres le permettent, et jamais deux tomes
 * differents sur la meme carte. Quand je cherche Germinal, je vois une seule
 * carte. Quand je cherche Le Grand Meaulnes, les editions d'Alain-Fournier,
 * ecrit "Alain Fournier" ou "Henri Alain-Fournier", ne font qu'une carte. »
 *
 * Les fiches sont les VRAIES cartes de la mesure du 2026-10-04 (titre,
 * sous-titre, auteur tels que Google les rend). Principe herite de la
 * tranche 29 : mieux vaut une carte en double qu'une fusion fausse — la moitie
 * de ce fichier dit ce qui ne doit JAMAIS fusionner.
 */

import { describe, it, expect } from 'vitest';
import { fusionnerDoublons, completerDepuisBnf } from '../src/books.js';

let n = 0;
const fiche = (titre, auteur, sousTitre = null, plus = {}) => ({
  cleSource: `gb:${(n += 1)}`, source: 'google', titre, sousTitre, auteurs: [auteur],
  couvertureUrl: null, resume: null, editeur: null, isbn13: null, isbn10: null,
  nbPages: null, categories: [], langue: 'fr', annee: '2020', ...plus,
});
const cartes = (liste, requete = '') => fusionnerDoublons(liste, requete).length;

describe('Ce qui DOIT fusionner (etape 4)', () => {
  const T = 'J.R.R. Tolkien';

  it('le tome 3 du Seigneur des anneaux, ecrit de trois manieres, ne fait qu-une carte', () => {
    const trois = [
      fiche('Le seigneur des anneaux', 'John Ronald Reuel Tolkien', 'Le retour du roi. Tome 3'),
      fiche('Le Seigneur des Anneaux T3 Le retour du roi', T),
      fiche('Le Seigneur des anneaux (Tome 3) - Le Retour du Roi', 'JRR Tolkien', 'Le Retour du Roi'),
    ];
    expect(cartes(trois, 'le seigneur des anneaux')).toBe(1);
  });

  it('le tome 2 ecrit de deux manieres ne fait qu-une carte', () => {
    expect(cartes([
      fiche('Le Seigneur des Anneaux T2 Les deux tours', T),
      fiche('Le Seigneur des anneaux (Tome 2) - Les Deux Tours', 'John Ronald Reuel Tolkien'),
    ], 'le seigneur des anneaux')).toBe(1);
  });

  it('Germinal, « Large Print » et « Annotee » ne font qu-une carte', () => {
    expect(cartes([
      fiche('Germinal', 'Emile Zola'),
      fiche('Germinal: Large Print', 'Emile Zola'),
      fiche('Germinal (Annotée)', 'Emile Emile Zola'),
    ], 'germinal')).toBe(1);
  });

  it('Alain-Fournier ecrit « Alain Fournier » ou « Henri Alain-Fournier » est le meme auteur', () => {
    expect(cartes([
      fiche('Le Grand Meaulnes', 'Alain Fournier'),
      fiche('Le Grand Meaulnes', 'Henri. Alain-Fournier'),
      fiche('Le Grand Meaulnes', 'Henri-Alban Alain-Fournier'),
    ], 'le grand meaulnes')).toBe(1);
  });

  it('le meme ISBN reste une preuve, meme avec des titres sans rapport', () => {
    expect(cartes([
      fiche('Un titre', 'Auteur Un', null, { isbn13: '9782070360000' }),
      fiche('Tout autre chose', 'Auteur Deux', null, { isbn13: '978-2-07-036000-0' }),
    ])).toBe(1);
  });

  it('l-ordre d-arrivee ne change pas le resultat', () => {
    const base = [
      fiche('Le Seigneur des Anneaux T3 Le retour du roi', T),
      fiche('Le seigneur des anneaux', T, 'Le retour du roi. Tome 3'),
      fiche('Le Seigneur des anneaux (Tome 3) - Le Retour du Roi', T),
    ];
    expect(cartes(base)).toBe(1);
    expect(cartes([...base].reverse())).toBe(1);
  });
});

describe('Ce qui ne doit JAMAIS fusionner (etape 4)', () => {
  const T = 'J.R.R. Tolkien';

  it('le tome 2 et le tome 3 restent deux cartes', () => {
    expect(cartes([
      fiche('Le Seigneur des Anneaux T2 Les deux tours', T),
      fiche('Le Seigneur des Anneaux T3 Le retour du roi', T),
    ])).toBe(2);
  });

  it('la saga (sans tome) ne se colle pas sur un de ses tomes', () => {
    expect(cartes([
      fiche('Harry Potter', 'J.K. Rowling'),
      fiche('Harry Potter et la Chambre des Secrets', 'J.K. Rowling'),
    ])).toBe(2);
  });

  it('un tome numerote ne se colle pas sur le meme titre sans numero', () => {
    expect(cartes([
      fiche('La Passe-miroir (Livre 3) - La Mémoire de Babel', 'Christelle Dabos'),
      fiche('La mémoire de Babel', 'Christelle Dabos'),
    ])).toBe(2);   // reserve a l'etape 5 (confirmation Open Library)
  });

  it('un coffret ou une integrale sans numero reste un livre a part', () => {
    expect(cartes([
      fiche('La Passe-miroir', 'Christelle Dabos'),
      fiche('La Passe-miroir Coffret Intégrale', 'Christelle Dabos'),
    ])).toBe(2);
  });

  it('un recueil « suivi de » (hors parentheses) n-est pas le roman seul', () => {
    expect(cartes([
      fiche('Le Grand Meaulnes', 'Alain Fournier'),
      fiche('Le grand Meaulnes suivi de poèmes choisis', 'Alain Fournier'),
    ])).toBe(2);
  });

  it('deux auteurs differents au meme titre restent deux cartes', () => {
    expect(cartes([
      fiche('La maison vide', 'Laurent Mauvignier'),
      fiche('La maison vide', 'Claude Gutman'),
    ])).toBe(2);
  });

  it('un prenom different est un autre auteur : « J. K. Martin » n-est pas « George R. R. Martin »', () => {
    expect(cartes([
      fiche('Le trone', 'George R. R. Martin'),
      fiche('Le trone', 'J. K. Martin'),
    ])).toBe(2);
  });

  it('un nom de famille SEUL ne rapproche personne', () => {
    expect(cartes([
      fiche('Le trone', 'George R. R. Martin'),
      fiche('Le trone', 'Martin'),
    ])).toBe(2);
  });

  it('une fiche sans auteur reste seule', () => {
    expect(cartes([fiche('Germinal', 'Emile Zola'), { ...fiche('Germinal', ''), auteurs: [] }])).toBe(2);
  });

  it('« Ca » et « Ca (tome 2) » restent deux cartes', () => {
    expect(cartes([
      fiche('Ça', 'Stephen King'),
      fiche('Ça (Ça, Tome 2)', 'Stephen King'),
    ])).toBe(2);
  });
});

describe('LIMITE CONNUE — des fiches de meme titre, SANS numero de tome (etape 4)', () => {
  // « Le seigneur des anneaux » + sous-titre « La communaute de l'anneau » ou « Le
  // retour du roi » : aucun numero, donc la regle ne les distingue pas. Les separer
  // sur le sous-titre casserait Germinal (24 fiches du meme roman aux sous-titres
  // varies, voir 12-fusion.test.js). Il faut une source qui connait les series :
  // c'est l'affaire de l'etape 5 (Open Library). Ce test DOCUMENTE le comportement.
  it('ne distingue pas encore deux tomes sans numero (a traiter a l-etape 5)', () => {
    const T = 'John Ronald Reuel Tolkien';
    expect(cartes([
      fiche('Le seigneur des anneaux', T, "La communauté de l'anneau"),
      fiche('Le seigneur des anneaux', T, 'Le Retour du roi'),
    ], 'le seigneur des anneaux')).toBe(1);
  });
});

describe('La completion BnF suit la meme definition (etape 4)', () => {
  it('une notice BnF « Zola, Emile » complete la fiche « Emile Zola » ecrite autrement', () => {
    const google = fiche('Germinal (Annotée)', 'Emile Emile Zola');
    const bnf = { ...fiche('Germinal', 'Zola, Émile (1840-1902)', null, { source: 'bnf', editeur: 'Charpentier', isbn13: '9782070369393' }) };
    const [complete] = completerDepuisBnf([google], [bnf]);
    expect(complete.editeur).toBe('Charpentier');
  });

  it('ne complete pas avec la notice d-un autre tome', () => {
    const google = fiche('Le Seigneur des Anneaux T2 Les deux tours', 'J.R.R. Tolkien');
    const bnf = fiche('Le seigneur des anneaux : le retour du roi. Tome 3', 'Tolkien, J.R.R.', null, { source: 'bnf', editeur: 'Bourgois' });
    const [complete] = completerDepuisBnf([google], [bnf]);
    expect(complete.editeur).toBeNull();
  });
});
