/*
 * FAMILLE 21 — LES DOUBLONS RESTANTS
 *
 * Mission « recherche satisfaisante », etape 10 (regles R1 a R5).
 *
 * Critere de Kinder : « Quand je cherche Le Grand Meaulnes, l'edition "illustree"
 * rejoint les autres editions du roman. Quand je cherche Le Trone de Fer, le tome 5
 * n'apparait qu'une fois. Quand je cherche La Quete d'Ewilan, l'integrale
 * n'apparait qu'une fois. Quand je cherche L'elegance du herisson, le roman
 * n'apparait qu'une fois, avec ou sans ": roman". »
 *
 * Les fiches sont les VRAIES cartes du controle de cloture du 2026-10-04. Mieux
 * vaut une carte en double qu'une fusion fausse (tranche 29) : la moitie de ce
 * fichier dit ce qui ne doit JAMAIS fusionner. Aucun appel reseau.
 */

import { describe, it, expect } from 'vitest';
import { fusionnerDoublons } from '../src/books.js';

let n = 0;
const fiche = (titre, auteur, sousTitre = null) => ({
  cleSource: `gb:${(n += 1)}`, source: 'google', titre, sousTitre, auteurs: [auteur],
  couvertureUrl: null, resume: null, editeur: null, isbn13: null, isbn10: null,
  nbPages: null, categories: [], langue: 'fr', annee: '2020',
});
const cartes = (liste, requete = '') => fusionnerDoublons(liste, requete).length;

describe('Ce qui DOIT fusionner (etape 10)', () => {
  it('R1 — le nom de l-auteur dans le titre : Le Grand Meaulnes « Alain-Fournier illustree »', () => {
    expect(cartes([
      fiche('Le Grand Meaulnes', 'Alain Fournier'),
      fiche('Le Grand Meaulnes Alain-Fournier illustree', 'Alain Fournier'),
    ], 'le grand meaulnes')).toBe(1);
  });

  it('R1 — A Game of Thrones, George R R Martin', () => {
    expect(cartes([
      fiche('A Game of Thrones', 'George R. R. Martin', 'The 20th Anniversary Edition'),
      fiche('A Game of Thrones, George R R Martin', 'George R. R. Martin'),
    ], 'game of thrones')).toBe(1);
  });

  it('un titre COUPE par la source (parenthese jamais refermee) rejoint le livre', () => {
    expect(cartes([
      fiche('Voyage au bout de la nuit', 'Louis-Ferdinand Celine'),
      fiche('Voyage Au Bout De La Nuit (Par> Louis-Ferdinand Celine (Pseud', 'Louis-Ferdinand Céline'),
    ], 'voyage au bout de la nuit')).toBe(1);
  });

  it('R2 — « : roman » est un genre, pas un titre', () => {
    expect(cartes([
      fiche('L\'élégance du hérisson', 'Muriel Barbery'),
      fiche('L\'élégance du hérisson : roman', 'Muriel Barbery'),
    ], 'l\'elegance du herisson')).toBe(1);
  });

  it('R3 — Germinal, « illustrer » (faute de frappe) et « Texte Intégral »', () => {
    expect(cartes([
      fiche('Germinal', 'Emile Zola'),
      fiche('Germinal illustrer', 'Emile Zola'),
      fiche('Germinal - Émile Zola - Texte Intégral', 'Émile Zola', 'Édition Illustrée | 462 Pages Format 15,24 Cm X 22,86 Cm'),
    ], 'germinal')).toBe(1);
  });

  it('R4 — Le Trone de Fer, tome 5 : « Forter » et « forteresse »', () => {
    expect(cartes([
      fiche('Le Trone de Fer T5 - L\'Invincible Forter', 'George Martin'),
      fiche('Le Trône de Fer (Tome 5) - L\'invincible forteresse', 'George R.R. Martin'),
    ], 'le trone de fer')).toBe(1);
  });

  it('R5 — l-integrale d-Ewilan, en sous-titre d-un cote et en titre de l-autre', () => {
    expect(cartes([
      fiche('La quête d\'Ewilan', 'Pierre Bottero', 'l\'intégrale'),
      fiche('L\'intégrale La Quête d\'Ewilan', 'Pierre Bottero'),
    ], 'la quete d\'ewilan')).toBe(1);
  });

  it('l-ordre d-arrivee ne change rien', () => {
    const liste = [
      fiche('L\'élégance du hérisson : roman', 'Muriel Barbery'),
      fiche('L\'élégance du hérisson', 'Muriel Barbery'),
    ];
    expect(cartes(liste)).toBe(1);
    expect(cartes([...liste].reverse())).toBe(1);
  });
});

describe('Ce qui ne doit JAMAIS fusionner (etape 10)', () => {
  it('les integrales d-AUTRES series d-Ewilan restent des livres a part', () => {
    expect(cartes([
      fiche('L\'intégrale La Quête d\'Ewilan', 'Pierre Bottero'),
      fiche('Les Mondes d\'Ewilan - L\'intégrale', 'Pierre Bottero'),
      fiche('Ewilan, Ellana - L\'intégrale', 'Pierre Bottero'),
    ], 'la quete d\'ewilan')).toBe(3);
  });

  it('une integrale ne se colle pas sur le livre seul (tranche 31)', () => {
    expect(cartes([
      fiche('La quête d\'Ewilan', 'Pierre Bottero'),
      fiche('La quête d\'Ewilan', 'Pierre Bottero', 'l\'intégrale'),
    ], 'la quete d\'ewilan')).toBe(2);
  });

  it('un titre qui se reduit au nom de l-auteur n-est pas vide, et ne fusionne pas avec un autre', () => {
    expect(cartes([
      fiche('Stephen King', 'Stephen King'),
      fiche('Misery', 'Stephen King'),
    ])).toBe(2);
    expect(cartes([
      fiche('Stephen King', 'Stephen King'),
      fiche('Stephen King', 'Bev Vincent'),
    ])).toBe(2);
  });

  it('R4 — la tolerance a la faute de frappe ne joue PAS entre deux tomes differents', () => {
    expect(cartes([
      fiche('Le Trône de Fer (Tome 5) - L\'invincible forteresse', 'George R.R. Martin'),
      fiche('Le Trône de Fer (Tome 6) - Les Brigands', 'George R.R. Martin'),
    ])).toBe(2);
  });

  it('R4 — ni sans numero de tome : on ne fusionne pas a l-aveugle', () => {
    expect(cartes([
      fiche('Les remparts de la forter', 'Un Auteur'),
      fiche('Les remparts de la forteresse', 'Un Auteur'),
    ])).toBe(2);
  });

  it('R2 — sans deux-points, « roman » reste un mot du titre', () => {
    expect(cartes([
      fiche('Le Roman de la Rose', 'Guillaume de Lorris'),
      fiche('La Rose', 'Guillaume de Lorris'),
    ])).toBe(2);
  });

  it('R2 — un sous-titre qui n-est pas un genre ne s-efface pas', () => {
    expect(cartes([
      fiche('Le seigneur des anneaux : la communauté de l\'anneau', 'Tolkien'),
      fiche('Le seigneur des anneaux : les deux tours', 'Tolkien'),
    ])).toBe(2);
  });

  it('R1 — une fiche de lecture « <titre> de <auteur> » n-est PAS le roman (garde-fou trouve a la mesure)', () => {
    expect(cartes([
      fiche('Voyage au bout de la nuit', 'Louis-Ferdinand Celine'),
      fiche('Voyage au bout de la nuit de Louis-Ferdinand Céline (fiche de lecture)', 'Louis-Ferdinand Céline'),
    ], 'voyage au bout de la nuit')).toBe(2);
    expect(cartes([
      fiche('Germinal', 'Emile Zola'),
      fiche("Germinal d'Émile Zola (Analyse de l'oeuvre)", 'Émile Zola'),
    ], 'germinal')).toBe(2);
  });

  it('les traductions et les etudes restent separees du roman', () => {
    expect(cartes([
      fiche('Germinal', 'Emile Zola'),
      fiche('Germinal, Translated by Havelock Ellis', 'Émile Zola'),
      fiche('Germinal d\'Émile Zola (Analyse de l\'oeuvre)', 'lePetitLitteraire'),
    ], 'germinal')).toBe(3);
  });

  it('deux auteurs differents au meme titre restent deux cartes', () => {
    expect(cartes([
      fiche('La maison vide', 'Laurent Mauvignier'),
      fiche('La maison vide', 'Claude Gutman'),
    ])).toBe(2);
  });
});
