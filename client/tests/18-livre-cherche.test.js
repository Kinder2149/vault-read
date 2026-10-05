/*
 * FAMILLE 18 — LE LIVRE CHERCHE PASSE AVANT LES PARASITES
 *
 * Mission « recherche satisfaisante », etape 6 (decision 6, 2e partie).
 *
 * Critere de Kinder : « Quand je cherche Le Seigneur des anneaux, les editions et
 * les tomes de Tolkien passent avant les essais et les etudes ecrits par
 * d'autres, meme quand Open Library est lente. Les autres livres d'un auteur
 * viennent apres le livre que je cherche. »
 *
 * Les cartes sont celles du controle du 2026-10-04 : Open Library trop lente, le
 * filtre du hors-sujet ne peut rien ecarter (fail-open), et des essais dont le
 * titre COMMENCE par la recherche se melangeaient aux vraies editions. Rien ne
 * disparait ici : un niveau descend, il ne s'efface pas. Aucun appel reseau.
 */

import { describe, it, expect } from 'vitest';
import { trierResultats, organiserLEcran, niveauxDeRecherche } from '../src/tomes.js';

let n = 0;
const carte = (titre, auteur, plus = {}) => ({
  cleSource: `gb:${(n += 1)}`, titre, sousTitre: null, auteurs: [auteur], langue: 'fr',
  isbn13: '978000000' + String(1000 + n), editeur: 'Un editeur', couvertureUrl: 'http://x/c', nbPages: 300,
  clesSource: ['gb:' + n], ...plus,
});

const Q = 'le seigneur des anneaux';
const TOLKIEN = 'John Ronald Reuel Tolkien';

const jeu = () => [
  carte('Le seigneur des anneaux ou la tentation du mal', 'Isabelle Smadja'),
  carte('Le Seigneur des Anneaux. L\'art de Tolkien', 'Gregory Hildebrandt'),
  carte('La Mythologie selon Le Seigneur des Anneaux', 'Ilan Ferry'),
  carte('Le Seigneur des anneaux', TOLKIEN, { annee: '1972' }),
  carte('La communauté de l\'Anneau', TOLKIEN, { annee: '1972' }),
  carte('Le Seigneur des Anneaux T2 Les deux tours', 'J.R.R. Tolkien'),
  carte('Le Seigneur des Anneaux. Coffret 3 Volumes.', 'John Ronald Reul Tolkien'),
  carte('Tolkien et Le seigneur des anneaux', 'Jean-Louis Migeot', { sousTitre: 'Une mythologie pour notre temps' }),
];
const titres = (liste) => liste.map((c) => c.titre);

describe('Trois niveaux : le livre cherche, le meme auteur, le reste (etape 6)', () => {
  it('les editions de Tolkien passent avant TOUS les essais, meme quand le titre de l-essai colle mieux', () => {
    const triees = trierResultats(jeu(), 'pertinence', Q);
    const rangDeLaCommunaute = titres(triees).indexOf('La communauté de l\'Anneau');
    ['Le seigneur des anneaux ou la tentation du mal', 'La Mythologie selon Le Seigneur des Anneaux',
      'Tolkien et Le seigneur des anneaux', 'Le Seigneur des Anneaux. L\'art de Tolkien'].forEach((essai) => {
      expect(titres(triees).indexOf(essai)).toBeGreaterThan(rangDeLaCommunaute);
    });
  });

  it('rien ne disparait : les huit cartes sont toujours la', () => {
    expect(trierResultats(jeu(), 'pertinence', Q)).toHaveLength(8);
  });

  it('les niveaux : cherche (0), meme auteur autre livre (1), reste (2)', () => {
    const liste = jeu();
    const niveaux = niveauxDeRecherche(liste, Q);
    const de = (titre) => niveaux.get(liste.find((c) => c.titre === titre));
    expect(de('Le Seigneur des anneaux')).toBe(0);
    expect(de('Le Seigneur des Anneaux T2 Les deux tours')).toBe(0);      // commence par la saisie + meme auteur
    expect(de('Le Seigneur des Anneaux. Coffret 3 Volumes.')).toBe(0);
    expect(de('La communauté de l\'Anneau')).toBe(1);                      // meme auteur, titre different
    expect(de('Le seigneur des anneaux ou la tentation du mal')).toBe(2);  // commence par la saisie mais autre auteur
    expect(de('La Mythologie selon Le Seigneur des Anneaux')).toBe(2);
  });

  it('JRR, J.R.R. et John Ronald Reuel sont le meme ecrivain', () => {
    const liste = [
      carte('Le Seigneur des anneaux', 'John Ronald Reuel Tolkien'),
      carte('Le Seigneur des Anneaux T1 La fraternité de l\'anneau', 'J.R.R. Tolkien'),
      carte('Le Seigneur des anneaux (Tome 3) - Le Retour du Roi', 'JRR Tolkien'),
    ];
    const niveaux = niveauxDeRecherche(liste, Q);
    liste.forEach((c) => expect(niveaux.get(c)).toBe(0));
  });

  it('un nom de famille SEUL ne rapproche personne', () => {
    const liste = [carte('Le Seigneur des anneaux', 'John Ronald Reuel Tolkien'), carte('Le Seigneur des anneaux : un guide', 'Tolkien')];
    expect(niveauxDeRecherche(liste, Q).get(liste[1])).toBe(2);
  });
});

describe('Ce que l-etape ne change PAS', () => {
  it('les homonymes au titre exact restent tous au niveau 0', () => {
    const liste = [
      carte('La maison vide', 'Claude Gutman'),
      carte('La maison vide', 'Laurent Mauvignier'),
      carte('La maison vide', 'Yari Bernasconi'),
    ];
    const niveaux = niveauxDeRecherche(liste, 'la maison vide');
    liste.forEach((c) => expect(niveaux.get(c)).toBe(0));
  });

  it('les autres series d-un auteur viennent apres les tomes de la serie cherchee', () => {
    const liste = [
      carte('Les Mondes d\'Ewilan - Tome 03', 'Lylian'),
      carte('L\'autre - Tome 02', 'Pierre Bottero'),
      carte('La Quête d\'Ewilan - Tome 05', 'Pierre Bottero'),
      carte('La Quête d\'Ewilan - Tome 01', 'Pierre Bottero'),
    ];
    const triees = trierResultats(liste, 'pertinence', 'la quete d\'ewilan');
    expect(titres(triees).slice(0, 2).every((t) => t.startsWith('La Quête'))).toBe(true);
  });

  it('le tri « Plus recent » reste strictement par date', () => {
    const liste = [
      carte('Un essai', 'Quelqu un', { annee: '2024' }),
      carte('Le Seigneur des anneaux', TOLKIEN, { annee: '1972' }),
    ];
    expect(titres(trierResultats(liste, 'recent', Q))).toEqual(['Un essai', 'Le Seigneur des anneaux']);
  });

  it('sans recherche (mode Auteur), la liste reste inchangee', () => {
    const liste = jeu();
    expect(trierResultats(liste, 'pertinence', '')).toEqual(liste);
  });

  it('une SERIE d-un autre auteur ne passe pas devant les livres de l-auteur cherche', () => {
    // Les blocs « serie » de l'ecran sont des copies des cartes : leur niveau doit
    // se retrouver par identifiant, pas par identite d'objet.
    const requete = "la quete d'ewilan";
    const liste = [
      carte("Les Mondes d'Ewilan - Tome 01", 'Lylian'),
      carte("Les Mondes d'Ewilan - Tome 02", 'Lylian'),
      carte("Les Mondes d'Ewilan - Tome 03", 'Lylian'),
      carte("L'autre - Tome 02", 'Pierre Bottero'),
      carte("L'intégrale La Quête d'Ewilan", 'Pierre Bottero'),
      carte("La Quête d'Ewilan - Tome 01", 'Pierre Bottero'),
      carte("La Quête d'Ewilan - Tome 02", 'Pierre Bottero'),
      carte("La Quête d'Ewilan - Tome 03", 'Pierre Bottero'),
    ];
    const blocs = organiserLEcran(trierResultats(liste, 'pertinence', requete), requete);
    const ordre = blocs.flatMap((b) => (b.type === 'serie' ? b.tomes : b.livres)).map((c) => c.titre);
    const premierMonde = ordre.findIndex((t) => t.startsWith('Les Mondes'));
    expect(ordre.indexOf("L'autre - Tome 02")).toBeLessThan(premierMonde);
    expect(ordre.indexOf("L'intégrale La Quête d'Ewilan")).toBeLessThan(premierMonde);
  });

  it('l-ecran (blocs) respecte aussi les niveaux : les essais viennent a la fin', () => {
    const blocs = organiserLEcran(trierResultats(jeu(), 'pertinence', Q), Q);
    const ordre = blocs.flatMap((b) => (b.type === 'serie' ? b.tomes : b.livres)).map((c) => c.titre);
    const dernierLivre = Math.max(ordre.indexOf('La communauté de l\'Anneau'), ordre.indexOf('Le Seigneur des anneaux'));
    expect(ordre.indexOf('La Mythologie selon Le Seigneur des Anneaux')).toBeGreaterThan(dernierLivre);
    expect(ordre.indexOf('Le seigneur des anneaux ou la tentation du mal')).toBeGreaterThan(dernierLivre);
  });
});
