/*
 * FAMILLE 14 — LE FILTRE NE PERD PLUS DE VRAIS LIVRES
 *
 * Mission « recherche satisfaisante », etape 2 (decision 5, 1re partie).
 *
 * Critere de Kinder : « Quand je cherche Le Grand Meaulnes, je retrouve toutes
 * les editions du roman d'Alain-Fournier, meme quand l'auteur est ecrit "Henri
 * Alain-Fournier". Quand je cherche La maison vide, je vois aussi les livres qui
 * portent exactement ce titre. Quand je cherche Game of Thrones, je ne revois
 * pas les guides et essais sur la serie. »
 *
 * Les cartes ci-dessous sont les VRAIES cartes ecartees a tort lors de la mesure
 * du 2026-10-04 (titre, sous-titre et auteurs tels que Google les rend).
 * Aucun appel reseau.
 */

import { describe, it, expect } from 'vitest';
import { attribuerNotoriete } from '../src/books.js';
import { filtrerHorsSujet } from '../src/tomes.js';

const carte = (cle, titre, auteurs, sousTitre = null) => ({ cleSource: cle, titre, sousTitre, auteurs });

/** Ce que l'ecran fait : notoriete d'Open Library, puis filtre du hors-sujet. */
function afficher(cartes, oeuvres, requete) {
  return filtrerHorsSujet(attribuerNotoriete(cartes, oeuvres), requete).map((c) => c.cleSource);
}

describe('Le nom de l-auteur est lu comme un humain le lit (etape 2)', () => {
  const OL_MEAULNES = [{ auteurs: ['Alain-Fournier'], lecteurs: 900 }];

  it('« Henri Alain-Fournier » et « Henri-Alban Alain-Fournier » sont Alain-Fournier', () => {
    const gardes = afficher([
      carte('a', 'Le Grand Meaulnes', ['Alain Fournier']),
      carte('b', 'Le Grand Meaulnes', ['Henri. Alain-Fournier']),
      carte('c', 'Le Grand Meaulnes', ['Henri-Alban Alain-Fournier', 'Henri Alain-Fournier'], 'édition intégrale de 1913 revue par Alain-Fournier'),
      carte('d', 'Le Grand Meaulnes d\'Alain-Fournier (Analyse de l\'oeuvre)', ['lePetitLitteraire,', 'Isabelle Defossa'], 'Analyse complète et résumé détaillé de l\'oeuvre'),
    ], OL_MEAULNES, 'le grand meaulnes');

    expect(gardes).toEqual(['a', 'b', 'c']);   // la fiche de lecture, elle, reste ecartee
  });

  it('le role entre parentheses ne fait pas partie du nom : « Christelle Dabos (autrice) »', () => {
    const gardes = afficher([
      carte('livre', 'La passe-miroir', ['Christelle Dabos']),
      carte('bd', 'La passe-miroir', ['Vanyda', 'Christelle Dabos (autrice)']),
      carte('essai', 'Savoir et pouvoir', ['Alexandra Roux']),
    ], [{ auteurs: ['Christelle Dabos'], lecteurs: 500 }], 'la passe-miroir');

    expect(gardes).toEqual(['livre', 'bd']);
  });

  it('un PRENOM DIFFERENT reste un autre auteur', () => {
    // Meme nom de famille, initiales « jk » contre « grr » : pas le meme homme.
    const classes = attribuerNotoriete(
      [carte('x', 'Un livre', ['J. K. Martin'])],
      [{ auteurs: ['George R. R. Martin'], lecteurs: 5000 }],
    );
    expect(classes[0].rangAuteur).toBeUndefined();
  });

  it('un nom de famille SEUL ne rapproche toujours personne', () => {
    const classes = attribuerNotoriete(
      [carte('x', 'Un livre', ['Martin'])],
      [{ auteurs: ['George R. R. Martin'], lecteurs: 5000 }],
    );
    expect(classes[0].rangAuteur).toBeUndefined();
  });
});

describe('Un livre au titre exact reste (etape 2)', () => {
  // Open Library met Conan Doyle en tete : c'est un auteur DOMINANT, qui
  // ecartait jusqu'ici tout autre livre portant ce titre.
  const OL_MAISON_VIDE = [
    { auteurs: ['Arthur Conan Doyle'], lecteurs: 5000 },
    { auteurs: ['Claude Gutman'], lecteurs: 40 },
  ];

  it('garde les homonymes exacts de « la maison vide », ecarte le reste', () => {
    const gardes = afficher([
      carte('doyle', 'La maison vide', ['Arthur Conan Doyle']),
      carte('gutman', 'La maison vide', ['Claude Gutman']),
      carte('bernasconi', 'La maison vide', ['Yari Bernasconi']),
      carte('gnoli', 'La maison vide', ['GNOLI.']),
      carte('claretie', 'La maison vide', ['Jules Claretie'], 'Édition enrichie.'),
      carte('femme', 'La Femme de la maison vide', ['Imran'], 'Dark romance et thriller psychologique au cœur de la Partition de l\'Inde'),
      carte('revue', 'La revue de Paris', []),
    ], OL_MAISON_VIDE, 'la maison vide');

    expect(gardes).toEqual(['doyle', 'gutman', 'bernasconi', 'gnoli', 'claretie']);
  });

  it('NE RAMENE PAS les guides de « game of thrones » : leur sous-titre les trahit', () => {
    const gardes = afficher([
      carte('roman', 'A Game of Thrones', ['George R. R. Martin']),
      carte('guide', 'Game of Thrones', ['Simon Reynolds'], 'Character Description Guide'),
      carte('strategie', 'Game of Thrones', ['Tim Phillips'], 'Les stratégies des sept royaumes appliquées à la vie professionnelle'),
      carte('decrypte', 'Game of Thrones décrypté', ['Antoine Lucciardi']),
      carte('essai', 'Shakespeare and Game of Thrones', ['Jeffrey R. Wilson']),
    ], [{ auteurs: ['George R. R. Martin'], lecteurs: 9000 }], 'game of thrones');

    expect(gardes).toEqual(['roman']);
  });

  it('LIMITE CONNUE : un derive au titre exact et SANS sous-titre passe (a surveiller au controle de cloture)', () => {
    const gardes = afficher([
      carte('roman', 'A Game of Thrones', ['George R. R. Martin']),
      carte('derive', 'Game of Thrones', ['Quelqu-un']),
    ], [{ auteurs: ['George R. R. Martin'], lecteurs: 9000 }], 'game of thrones');

    expect(gardes).toEqual(['roman', 'derive']);
  });

  it('les formes denaturees restent exclues : un « texte abrege » n-est pas le livre', () => {
    const gardes = afficher([
      carte('livre', 'Le Grand Meaulnes', ['Alain-Fournier']),
      carte('abrege', 'Le grand Meaulnes - Texte abrégé', ['Alain Fournier']),
    ], [{ auteurs: ['Alain-Fournier'], lecteurs: 900 }], 'le grand meaulnes');

    expect(gardes).toEqual(['livre']);
  });
});
