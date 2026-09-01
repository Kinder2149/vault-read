/*
 * FAMILLE 11 — LA NOTORIETE D'UNE OEUVRE (mission V2, M3 et M5)
 *
 * Le defaut repare : « les essais SUR une oeuvre passent devant l'oeuvre ».
 * Google Books est un catalogue de DOCUMENTS ; rien dans une de ses fiches ne
 * dit qu'un livre est connu. Open Library, elle, indexe des OEUVRES et les
 * classe. On rapproche les deux par l'AUTEUR — le seul lien qui traverse les
 * traductions.
 *
 * Les cas ci-dessous ne sont pas inventes : ce sont les fiches REELLES
 * relevees le 2026-08-28, avec leurs scores mesures. C'est ce qui rend ces
 * verifications utiles — elles echoueront si le bareme derive.
 *
 * Aucun appel reseau : on fournit a la main ce qu'Open Library aurait rendu.
 */

import { describe, it, expect } from 'vitest';
import { attribuerNotoriete } from '../src/books.js';
import { scorePertinence } from '../src/tomes.js';

/* Une oeuvre telle que `oeuvresNotoires` la rend. */
const oeuvre = (titre, auteurs, lecteurs) => ({
  cleOeuvre: `ol:${titre}`, titre, auteurs, lecteurs,
});

describe('Rapprocher un livre de son auteur chez Open Library', () => {
  it('reconnait l-auteur et retient son RANG', () => {
    const [r] = attribuerNotoriete(
      [{ cleSource: 'gb:1', titre: 'Les fourmis', auteurs: ['Bernard Werber'] }],
      [oeuvre('Les fourmis', ['Bernard Werber'], 36)],
    );
    expect(r.rangAuteur).toBe(0);
    expect(r.lecteurs).toBe(36);
  });

  it('IGNORE L-ORDRE DU NOM — « Zola, Emile » et « Emile Zola » sont le meme', () => {
    // La BnF ecrit « Zola, Emile », Google « Emile Zola », Open Library encore
    // autrement. Sans cela le rapprochement echouerait sur la moitie du
    // catalogue francais.
    const [r] = attribuerNotoriete(
      [{ cleSource: 'gb:1', titre: 'Germinal', auteurs: ['Zola, Émile'] }],
      [oeuvre('Germinal', ['Emile Zola'], 103)],
    );
    expect(r.rangAuteur).toBe(0);
  });

  it('garde la MIEUX CLASSEE des oeuvres d-un auteur', () => {
    // Martin porte six oeuvres sur dix dans la reponse a « game of thrones ».
    const [r] = attribuerNotoriete(
      [{ cleSource: 'gb:1', titre: 'A Game of Thrones', auteurs: ['George R. R. Martin'] }],
      [
        oeuvre('A Game of Thrones', ['George R. R. Martin'], 13397),
        oeuvre('Book of Thrones', ['Book Of Thrones'], 259),
        oeuvre('Fire & Blood', ['George R. R. Martin'], 2042),
      ],
    );
    expect(r.rangAuteur).toBe(0);
  });

  it('un livre a plusieurs auteurs prend le mieux classe des siens', () => {
    const [r] = attribuerNotoriete(
      [{ cleSource: 'gb:1', titre: 'Germinal annoté', auteurs: ['Untel', 'Émile Zola'] }],
      [oeuvre('Autre chose', ['Quelqu-un'], 900), oeuvre('Germinal', ['Emile Zola'], 103)],
    );
    expect(r.rangAuteur).toBe(1);
  });

  it('reconnait le MEME ecrivain abrege autrement', () => {
    /*
     * Open Library ecrit « J.R.R. Tolkien », Google « John Ronald Reuel
     * Tolkien ». Mesure du 2026-08-30 : la moitie des editions de Tolkien ne
     * recevaient aucune notoriete faute de ce rapprochement.
     */
    const oeuvres = [oeuvre('The Fellowship of the Ring', ['J.R.R. Tolkien'], 2472)];
    const fiches = [
      { cleSource: 'gb:1', titre: 'Le Seigneur des anneaux', auteurs: ['John Ronald Reuel Tolkien'] },
      { cleSource: 'gb:2', titre: 'Les deux tours', auteurs: ['Tolkien, J. R. R.'] },
    ];
    attribuerNotoriete(fiches, oeuvres).forEach((r) => expect(r.rangAuteur).toBe(0));
  });

  it('GARDE LES INITIALES — un homonyme ne herite pas de la notoriete', () => {
    /*
     * Sur le seul nom de famille, « Martin » rapprocherait George R. R.
     * Martin de n'importe quel Martin, et la notoriete de « game of thrones »
     * atterrirait sur un essayiste homonyme.
     */
    const oeuvres = [oeuvre('A Game of Thrones', ['George R. R. Martin'], 13397)];
    const [autre] = attribuerNotoriete(
      [{ cleSource: 'gb:1', titre: 'Un essai', auteurs: ['Claire Martin'] }],
      oeuvres,
    );
    expect(autre.rangAuteur).toBeUndefined();
  });

  it('NE TOUCHE PAS un livre dont l-auteur est inconnu d-Open Library', () => {
    const essai = { cleSource: 'gb:1', titre: 'Game of Thrones', auteurs: ['Cédric Delaunay'] };
    const [r] = attribuerNotoriete([essai], [oeuvre('A Game of Thrones', ['George R. R. Martin'], 13397)]);
    expect(r.rangAuteur).toBeUndefined();
    expect(r).toEqual(essai);
  });

  it('rend la liste INTACTE quand Open Library n-a rien dit', () => {
    // Elle n-a ni cle ni quota, mais aucun engagement de service : son absence
    // ne doit jamais casser une recherche, seulement la laisser non classee.
    const liste = [{ cleSource: 'gb:1', titre: 'X', auteurs: ['Y'] }];
    expect(attribuerNotoriete(liste, [])).toBe(liste);
    expect(attribuerNotoriete(liste, null)).toBe(liste);
  });

  it('ignore une oeuvre sans auteur nomme', () => {
    const liste = [{ cleSource: 'gb:1', titre: 'X', auteurs: ['Y'] }];
    expect(attribuerNotoriete(liste, [oeuvre('Z', [], 500)])).toBe(liste);
  });
});

// ---------------------------------------------------------------------------

/*
 * LES DEUX CAS QUI ONT MOTIVE LA MISSION, avec leurs fiches reelles.
 * Si l'un des deux repasse au rouge, le bareme a derive et le banc d'essai le
 * montrera aussi — mais ici on le sait sans reseau et sans quota.
 */
describe('Le livre cherche passe devant ce qui parle de lui', () => {
  it('« les fourmis » : Werber passe devant le documentaire jeunesse', () => {
    /*
     * Le cas le plus dur, et celui que le nombre de LECTEURS ne reglait pas.
     * La fiche Google de Werber est pauvre — ni ISBN, ni editeur, ni
     * couverture : 15 points de completude contre 35 au documentaire. Trente
     * points d'ecart qui n'ont rien a voir avec le livre, tout avec la notice.
     */
    const werber = {
      cleSource: 'gb:w', titre: 'Les fourmis', sousTitre: 'roman',
      auteurs: ['Bernard Werber'], langue: 'fr', nbPages: 312,
      isbn13: null, editeur: null, couvertureUrl: null,
      clesSource: ['gb:w'], rangAuteur: 0, lecteurs: 36,
    };
    const documentaire = {
      cleSource: 'gb:l', titre: 'Les fourmis', sousTitre: null,
      auteurs: ['Stéphanie Ledu'], langue: 'fr', nbPages: 29,
      isbn13: '9782745900000', editeur: 'Milan', couvertureUrl: 'http://x',
      clesSource: ['gb:l', 'gb:l2'],
    };
    expect(scorePertinence(werber, 'les fourmis'))
      .toBeGreaterThan(scorePertinence(documentaire, 'les fourmis'));
  });

  it('« game of thrones » : le roman de Martin passe devant les essais', () => {
    const martin = {
      cleSource: 'gb:m', titre: 'A Game of Thrones',
      sousTitre: 'A Song of Ice and Fire: Book One',
      auteurs: ['George R. R. Martin'], langue: 'en', nbPages: 720,
      isbn13: '9780553103540', editeur: 'Bantam', couvertureUrl: 'http://x',
      clesSource: ['gb:m', 'gb:m2'], rangAuteur: 0, lecteurs: 13397,
    };
    const essai = {
      cleSource: 'gb:e', titre: 'Game of Thrones',
      sousTitre: "De l'histoire à la série",
      auteurs: ['Cédric Delaunay'], langue: 'fr', nbPages: 200,
      isbn13: '9782000000000', editeur: 'Untel', couvertureUrl: 'http://x',
      clesSource: ['gb:e'],
    };
    expect(scorePertinence(martin, 'game of thrones'))
      .toBeGreaterThan(scorePertinence(essai, 'game of thrones'));
  });

  it('la notoriete DEPARTAGE, elle ne fabrique pas un classement', () => {
    /*
     * La regle de fond, et la garantie qu'on n'est pas alle trop loin : un
     * auteur celebre ne doit pas faire remonter un livre hors sujet devant un
     * livre dont le titre correspond exactement.
     */
    const horsSujet = {
      cleSource: 'gb:h', titre: 'Fire & Blood', auteurs: ['George R. R. Martin'],
      langue: 'fr', clesSource: ['gb:h'], rangAuteur: 0, lecteurs: 13397,
    };
    const exact = {
      cleSource: 'gb:x', titre: 'Game of Thrones', auteurs: ['Untel'],
      langue: 'fr', isbn13: '9782', editeur: 'E', couvertureUrl: 'u', nbPages: 100,
      clesSource: ['gb:x'],
    };
    expect(scorePertinence(exact, 'game of thrones'))
      .toBeGreaterThan(scorePertinence(horsSujet, 'game of thrones'));
  });

  it('sans Open Library, on retombe sur le compte d-editions d-hier', () => {
    // L'absence d'information n'est pas une preuve d'obscurite : le classement
    // doit rester celui d'avant la mission quand la source est en panne.
    const avecEditions = {
      cleSource: 'gb:a', titre: 'Germinal', auteurs: ['Emile Zola'],
      langue: 'fr', clesSource: new Array(24).fill('x'),
    };
    const seule = {
      cleSource: 'gb:b', titre: 'Germinal', auteurs: ['Paule Lejeune'],
      langue: 'fr', clesSource: ['gb:b'],
    };
    expect(scorePertinence(avecEditions, 'germinal'))
      .toBeGreaterThan(scorePertinence(seule, 'germinal'));
  });
});
