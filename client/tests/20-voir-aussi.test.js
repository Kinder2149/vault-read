/*
 * FAMILLE 20 — LE REPLI « VOIR AUSSI »
 *
 * Mission « recherche satisfaisante », etape 9.
 *
 * Critere de Kinder : « Quand je cherche Harry Potter, je vois d'abord les livres
 * en francais ; les editions en anglais et en espagnol sont regroupees sous "Voir
 * aussi", un clic les deploie, rien n'a disparu. Quand je cherche L'elegance du
 * herisson, je vois ses editions puis au plus trois autres livres de Muriel
 * Barbery ; les autres sont sous "Voir aussi". »
 *
 * Fonction pure : le rendu de l'ecran n'est qu'un <details> natif autour de
 * `replies`. Aucun appel reseau.
 */

import { describe, it, expect } from 'vitest';
import { separerLePrincipal, niveauxDeRecherche, trierResultats, MAX_AUTRES_VISIBLES } from '../src/tomes.js';

let n = 0;
const carte = (titre, auteur, langue = 'fr', plus = {}) => ({
  cleSource: `gb:${(n += 1)}`, titre, sousTitre: null, auteurs: [auteur], langue,
  isbn13: '978000000' + String(1000 + n), editeur: 'Un editeur', couvertureUrl: 'http://x/c',
  nbPages: 300, clesSource: ['gb:' + n], rangAuteur: 0, ...plus,
});
const titres = (l) => l.map((c) => c.titre);
const separer = (cartes, requete) => separerLePrincipal(trierResultats(cartes, 'pertinence', requete), requete);

describe('Les editions en d-autres langues vont sous le repli (etape 9)', () => {
  const HP = () => [
    carte('Harry Potter à l\'école des sorciers', 'J. K. Rowling'),
    carte('Harry Potter et la Chambre des Secrets', 'J.K. Rowling'),
    carte('Harry Potter et le Prisonnier d\'Azkaban', 'J.K. Rowling'),
    carte('Harry Potter and the Sorcerer\'s Stone', 'J.K. Rowling', 'en'),
    carte('Harry Potter and the Deathly Hallows', 'J.K. Rowling', 'en'),
    carte('Harry Potter y la piedra filosofal', 'J. K. Rowling', 'es'),
  ];

  it('« harry potter » : le francais d-abord, l-anglais et l-espagnol sous le repli', () => {
    const { principaux, replies } = separer(HP(), 'harry potter');
    expect(titres(principaux).every((t) => t.startsWith('Harry Potter à') || t.startsWith('Harry Potter et'))).toBe(true);
    expect(titres(replies).sort()).toEqual([
      'Harry Potter and the Deathly Hallows', 'Harry Potter and the Sorcerer\'s Stone', 'Harry Potter y la piedra filosofal',
    ]);
  });

  it('rien n-a disparu : principaux + replies = toutes les cartes', () => {
    const cartes = HP();
    const { principaux, replies } = separer(cartes, 'harry potter');
    expect([...principaux, ...replies].map((c) => c.cleSource).sort()).toEqual(cartes.map((c) => c.cleSource).sort());
  });

  it('si AUCUNE edition n-est francaise, l-anglais reste visible', () => {
    const cartes = [
      carte('Dune', 'Frank Herbert', 'en'),
      carte('Dune Messiah', 'Frank Herbert', 'en'),
    ];
    expect(separer(cartes, 'dune').replies).toHaveLength(0);
  });

  it('une langue INCONNUE n-est jamais « etrangere »', () => {
    const cartes = [
      carte('Dune', 'Frank Herbert', 'fr'),
      carte('Dune (sans langue)', 'Frank Herbert', null),
    ];
    expect(separer(cartes, 'dune').replies).toHaveLength(0);
  });
});

describe('Trois « autres » au plus avant le repli (etape 9)', () => {
  const HERISSON = () => [
    carte('L\'élégance du hérisson', 'Muriel Barbery'),
    carte('L\'élégance du hérisson : roman', 'Muriel Barbery'),
    carte('Une heure de ferveur', 'Muriel Barbery'),
    carte('La vie des elfes', 'Muriel Barbery'),
    carte('Thomas Helder', 'Muriel Barbery'),
    carte('Un étrange pays', 'Muriel Barbery'),
    carte('Une gourmandise', 'Muriel Barbery'),
    carte('The Elegance of the Hedgehog', 'Muriel Barbery', 'en'),
  ];

  it('« l-elegance du herisson » : ses editions, trois autres livres, le reste sous le repli', () => {
    const { principaux, replies } = separer(HERISSON(), 'l\'elegance du herisson');
    const niveaux = niveauxDeRecherche(HERISSON(), 'l\'elegance du herisson');
    expect(principaux).toHaveLength(2 + MAX_AUTRES_VISIBLES);
    expect(replies).toHaveLength(8 - principaux.length);
    expect(replies.some((c) => c.langue === 'en')).toBe(true);
    expect(niveaux.size).toBe(8);
  });

  it('CRITERE : jamais plus de trois « autres » dans les dix premiers visibles', () => {
    const cartes = [
      ...Array.from({ length: 4 }, (_, i) => carte(`Le Seigneur des Anneaux T${i + 1}`, 'J.R.R. Tolkien')),
      ...Array.from({ length: 12 }, (_, i) => carte(`Un autre livre numero ${i}`, 'J.R.R. Tolkien')),
    ];
    const { principaux } = separer(cartes, 'le seigneur des anneaux');
    const niveaux = niveauxDeRecherche(cartes, 'le seigneur des anneaux');
    const autresDansLeTop10 = principaux.slice(0, 10).filter((c) => niveaux.get(c) !== 0).length;
    expect(autresDansLeTop10).toBeLessThanOrEqual(MAX_AUTRES_VISIBLES);
  });

  it('un livre cherche n-est JAMAIS replie, meme nombreux', () => {
    const cartes = Array.from({ length: 15 }, (_, i) => carte(`Le Trône de Fer (Tome ${i + 1})`, 'George R.R. Martin'));
    expect(separer(cartes, 'le trone de fer').replies).toHaveLength(0);
  });

  it('les deux ordres sont conserves', () => {
    const { principaux } = separer(HERISSON(), 'l\'elegance du herisson');
    expect(titres(principaux).slice(0, 2).every((t) => t.startsWith('L\'élégance'))).toBe(true);
  });
});

describe('Quand on ne replie rien (etape 9)', () => {
  it('aucun livre ne correspond au titre : tout reste visible', () => {
    const cartes = [carte('Un livre', 'Quelqu un'), carte('Un autre', 'Quelqu un'), carte('Encore un', 'Quelqu un'),
      carte('Et un', 'Quelqu un'), carte('Le dernier', 'Quelqu un')];
    const { principaux, replies } = separerLePrincipal(cartes, 'zzz introuvable');
    expect(replies).toHaveLength(0);
    expect(principaux).toHaveLength(5);
  });

  it('sans recherche (mode Auteur) ou sans resultat : rien ne change', () => {
    const cartes = [carte('Un livre', 'Quelqu un')];
    expect(separerLePrincipal(cartes, '').replies).toHaveLength(0);
    expect(separerLePrincipal([], 'dune')).toEqual({ principaux: [], replies: [] });
    expect(separerLePrincipal(undefined, 'dune')).toEqual({ principaux: [], replies: [] });
  });

  it('peu de cartes « autres » : pas de repli', () => {
    const cartes = [
      carte('Germinal', 'Émile Zola'),
      carte('La Bête humaine', 'Émile Zola'),
      carte('Nana', 'Émile Zola'),
    ];
    expect(separer(cartes, 'germinal').replies).toHaveLength(0);
  });
});
