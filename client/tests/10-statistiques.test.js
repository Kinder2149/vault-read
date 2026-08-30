/*
 * FAMILLE 10 — CE QUE DIT LA BIBLIOTHEQUE (mission V2, M2)
 *
 * Une page de statistiques ment plus facilement qu'un ecran de liste : un
 * chiffre s'affiche avec autorite et personne ne va le recompter a la main.
 * Ces verifications portent donc surtout sur ce qu'on refuse de compter —
 * les pourcentages pris pour des pages, les minutes ajoutees aux pages, les
 * livres marques lus d'un coup.
 */

import { describe, it, expect } from 'vitest';
import {
  volumeLu, livresParMois, derniersMois, repartition, notation, faitsDArmes,
} from '../src/statistiques.js';

const papier = (o) => ({ format: 'papier', nbPages: 300, statut: 'lu', ...o });

describe('Ce qui a ete lu sur une periode', () => {
  it('additionne les gains des livres papier', () => {
    const biblio = [papier({ oeuvreId: 'a' }), papier({ oeuvreId: 'b' })];
    const gains = new Map([['a', 120], ['b', 30]]);
    expect(volumeLu(biblio, gains)).toEqual({ pages: 150, minutes: 0 });
  });

  it('NE MELANGE PAS les pages et les minutes', () => {
    const biblio = [
      papier({ oeuvreId: 'a' }),
      { oeuvreId: 'b', format: 'audio', dureeMinutes: 600, statut: 'en_cours' },
    ];
    const gains = new Map([['a', 100], ['b', 45]]);
    // 145 serait un nombre qui ne veut rien dire.
    expect(volumeLu(biblio, gains)).toEqual({ pages: 100, minutes: 45 });
  });

  it('ECARTE un livre sans pagination — sa position est un pourcentage', () => {
    // §5.4 : sans metrique connue, `position` porte un %. Compter 30 « pages »
    // pour quelqu-un qui a avance de 30 % dans un pave serait faux.
    const biblio = [{ oeuvreId: 'a', format: 'papier', nbPages: null, statut: 'en_cours' }];
    expect(volumeLu(biblio, new Map([['a', 30]]))).toEqual({ pages: 0, minutes: 0 });
  });

  it('ignore un gain nul ou negatif', () => {
    // Une position corrigee a la baisse ne doit pas retirer des pages.
    const biblio = [papier({ oeuvreId: 'a' })];
    expect(volumeLu(biblio, new Map([['a', -50]]))).toEqual({ pages: 0, minutes: 0 });
  });

  it('supporte une bibliotheque vide ou des gains absents', () => {
    expect(volumeLu([], new Map())).toEqual({ pages: 0, minutes: 0 });
    expect(volumeLu(null, null)).toEqual({ pages: 0, minutes: 0 });
  });
});

describe('Livres termines par mois', () => {
  const aout = new Date(2026, 7, 28); // 28 aout 2026, heure locale

  it('rend douze mois, du plus ancien au plus recent', () => {
    const m = derniersMois(12, aout);
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2025-09');
    expect(m[11]).toBe('2026-08');
  });

  it('compte les livres lus dans leur mois de fin', () => {
    const biblio = [
      papier({ oeuvreId: 'a', termineLe: '2026-08-03' }),
      papier({ oeuvreId: 'b', termineLe: '2026-08-27' }),
      papier({ oeuvreId: 'c', termineLe: '2026-07-11' }),
    ];
    const parMois = livresParMois(biblio, 12, aout);
    expect(parMois.find((m) => m.mois === '2026-08').nombre).toBe(2);
    expect(parMois.find((m) => m.mois === '2026-07').nombre).toBe(1);
  });

  it('GARDE les mois a zero — un histogramme troue mentirait sur le rythme', () => {
    const parMois = livresParMois([], 12, aout);
    expect(parMois).toHaveLength(12);
    expect(parMois.every((m) => m.nombre === 0)).toBe(true);
  });

  it('ne compte que les livres « lu »', () => {
    const biblio = [
      papier({ oeuvreId: 'a', statut: 'en_cours', termineLe: '2026-08-03' }),
      papier({ oeuvreId: 'b', statut: 'abandonne', termineLe: '2026-08-04' }),
    ];
    expect(livresParMois(biblio, 12, aout).every((m) => m.nombre === 0)).toBe(true);
  });

  it('ne bascule pas de mois sur une date de fin de journee', () => {
    // `termine_le` est ecrit en heure locale (§3.3). Un livre fini le 1er au
    // soir doit compter pour aout, pas pour juillet.
    const biblio = [papier({ oeuvreId: 'a', termineLe: '2026-08-01 23:40:00' })];
    expect(livresParMois(biblio, 12, aout).find((m) => m.mois === '2026-08').nombre).toBe(1);
  });

  it('ignore un livre lu hors de la fenetre de douze mois', () => {
    const biblio = [papier({ oeuvreId: 'a', termineLe: '2019-03-02' })];
    expect(livresParMois(biblio, 12, aout).every((m) => m.nombre === 0)).toBe(true);
  });
});

describe('Repartition', () => {
  it('ecarte les livres pas encore parus, comme la bibliotheque', () => {
    // Sans cela, les quatre paves du haut et les statistiques du bas de la
    // MEME page ne diraient pas la meme chose.
    const biblio = [
      papier({ oeuvreId: 'a', statut: 'a_lire' }),
      { oeuvreId: 'b', statut: 'a_lire', format: 'papier', datePublication: '2099-01-01' },
    ];
    const { statuts, total } = repartition(biblio);
    expect(total).toBe(1);
    expect(statuts.a_lire).toBe(1);
  });

  it('range un livre sans format en papier', () => {
    const { formats } = repartition([{ oeuvreId: 'a', statut: 'lu' }]);
    expect(formats.papier).toBe(1);
  });
});

describe('Notation', () => {
  it('ne fait la moyenne que sur les livres NOTES', () => {
    // Compter les non-notes pour zero ferait baisser la moyenne a chaque ajout.
    const biblio = [
      papier({ oeuvreId: 'a', note: 5 }),
      papier({ oeuvreId: 'b', note: 4 }),
      papier({ oeuvreId: 'c', note: null }),
    ];
    expect(notation(biblio)).toMatchObject({ moyenne: 4.5, notes: 2 });
  });

  it('rend null plutot que zero quand rien n-est note', () => {
    expect(notation([papier({ oeuvreId: 'a' })]).moyenne).toBeNull();
  });

  it('ne compte pas un commentaire vide comme un avis', () => {
    const biblio = [
      papier({ oeuvreId: 'a', commentaire: '   ' }),
      papier({ oeuvreId: 'b', commentaire: 'Magnifique.' }),
    ];
    expect(notation(biblio).avis).toBe(1);
  });
});

describe('Faits d-armes', () => {
  it('trouve le plus gros livre termine', () => {
    const biblio = [
      papier({ oeuvreId: 'a', titre: 'Court', nbPages: 120 }),
      papier({ oeuvreId: 'b', titre: 'Pave', nbPages: 1300 }),
      // Un pave PAS ENCORE LU ne compte pas : ce n-est pas un fait d-armes.
      papier({ oeuvreId: 'c', titre: 'Plus gros', nbPages: 2000, statut: 'a_lire' }),
    ];
    expect(faitsDArmes(biblio).plusGros.titre).toBe('Pave');
  });

  it('ECARTE un livre lu en zero jour — c-est un livre marque, pas lu', () => {
    // Ajouter un livre deja lu remplit debut et fin le meme jour : il
    // gagnerait toujours le classement de vitesse.
    const biblio = [papier({
      oeuvreId: 'a', titre: 'Marque', commenceLe: '2026-08-10', termineLe: '2026-08-10',
    })];
    expect(faitsDArmes(biblio).plusRapide).toBeNull();
  });

  it('classe par pages PAR JOUR, pas par duree', () => {
    const biblio = [
      papier({
        oeuvreId: 'a', titre: 'Rapide', nbPages: 400,
        commenceLe: '2026-08-01', termineLe: '2026-08-05', // 100 p./j
      }),
      papier({
        oeuvreId: 'b', titre: 'Lent', nbPages: 200,
        commenceLe: '2026-08-01', termineLe: '2026-08-21', // 10 p./j
      }),
    ];
    const { plusRapide } = faitsDArmes(biblio);
    expect(plusRapide.oeuvre.titre).toBe('Rapide');
    expect(plusRapide.parJour).toBe(100);
  });

  it('ne classe pas un livre sans date de debut', () => {
    const biblio = [papier({ oeuvreId: 'a', termineLe: '2026-08-05' })];
    expect(faitsDArmes(biblio).plusRapide).toBeNull();
  });

  it('rend deux fois null sur une bibliotheque vide', () => {
    expect(faitsDArmes([])).toEqual({ plusGros: null, plusRapide: null });
  });
});
