/*
 * FAMILLE 7 — REMETTRE UNE SAGA DANS L'ORDRE
 *
 * Retour d'usage 101 : « j'ai une saga de 5 tomes a la maison, il n'en voit
 * qu'un ». Les tomes etaient bien la, mais melanges et noyes. Les cas
 * ci-dessous viennent tous de titres REELS rendus par Google.
 */

import { describe, it, expect } from 'vitest';
import {
  numeroDeTome, separerLesTomes, organiserLEcran, nomDeSerie, nombreDeTomes,
  serieAConfirmer, trierResultats,
  scorePertinence, filtrerHorsSujet, legendeCarte,
} from '../src/tomes.js';

describe('Lire un numero de tome dans un titre', () => {
  it('reconnait les formes francaises', () => {
    expect(numeroDeTome('Le Trône de Fer (Tome 5) - L’invincible forteresse')).toBe(5);
    expect(numeroDeTome('La Quête d’Ewilan, tome 2')).toBe(2);
    expect(numeroDeTome('Autre-Monde - Livre 3')).toBe(3);
    expect(numeroDeTome('Dune - T5 Les Hérétiques')).toBe(5);
    expect(numeroDeTome('La Passe-miroir T. 4')).toBe(4);
  });

  it('reconnait les parentheses en fin de titre et le dièse', () => {
    expect(numeroDeTome('Le Trône de Fer (3)')).toBe(3);
    expect(numeroDeTome('Discworld #5')).toBe(5);
  });

  it('lit un numero ecrit avec un zero devant', () => {
    expect(numeroDeTome('Les Fourmis T01')).toBe(1);
    expect(numeroDeTome('Saga tome 007')).toBe(7);
  });

  it('n-INVENTE PAS de tome — c-est la regle la plus importante', () => {
    // Sans mot annonceur, un nombre dans un titre n'est pas un tome.
    expect(numeroDeTome('1984')).toBeNull();
    expect(numeroDeTome('Harry Potter et la Coupe de Feu')).toBeNull();
    expect(numeroDeTome('Les 3 mousquetaires')).toBeNull();
    expect(numeroDeTome('Vingt mille lieues sous les mers')).toBeNull();
    expect(numeroDeTome('')).toBeNull();
    expect(numeroDeTome(null)).toBeNull();
  });

  it('refuse un numero absurde', () => {
    expect(numeroDeTome('Tome 0')).toBeNull();
    expect(numeroDeTome('Volume 9999')).toBeNull();
  });
});

describe('Separer une serie du reste', () => {
  const r = (titre) => ({ cleSource: titre, titre });

  it('remet les tomes dans l-ordre (cas reel de La Quete d-Ewilan)', () => {
    // Ordre d'arrivee reellement mesure chez Google.
    const bruts = ['Sans numéro', 'Ewilan tome 1', 'Autre chose', 'Ewilan tome 2',
      'Ewilan tome 7', 'Ewilan tome 5', 'Ewilan tome 3'].map(r);

    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(1);
    expect(series[0].nom).toBe('Ewilan');
    expect(series[0].tomes.map((x) => x.tome)).toEqual([1, 2, 3, 5, 7]);
    expect(autres).toHaveLength(2);
  });

  it('NE MELANGE PLUS deux series differentes (defaut du 2026-08-27)', () => {
    /*
     * Cas reel : « la quete d'Ewilan » assemblait en une seule « serie » les
     * tomes 1 de trois cycles sans rapport, parce que le regroupement se
     * faisait sur le NUMERO et jamais sur le nom.
     */
    const bruts = [
      r('La Quete d Ewilan - Tome 01'), r('La Quete d Ewilan - Tome 02'),
      r('La Quete d Ewilan - Tome 03'),
      r('Les Mondes d Ewilan - Tome 01'), r('L Autre - Tome 01'),
    ];
    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(1);
    expect(series[0].nom).toBe('La Quete d Ewilan');
    expect(series[0].tomes).toHaveLength(3);
    // Les tomes 1 des deux autres cycles ne sont pas perdus : ils rejoignent
    // le reste, plutot que de faire nombre dans une serie qui n-est pas la leur.
    expect(autres).toHaveLength(2);
  });

  it('separe la bande dessinee des romans (cas Game of Thrones)', () => {
    const bruts = [
      r('A Game of Thrones - La Bataille des rois - Tome 1'),
      r('A Game of Thrones - La Bataille des rois - Tome 3'),
      r('A Game of Thrones - La Bataille des rois - Tome 4'),
      r('Le trone de fer (A game of Thrones) Tome 3'),
      r('Le trone de fer (A game of Thrones) Tome 4'),
      r('Le trone de fer (A game of Thrones) Tome 5'),
    ];
    const { series } = separerLesTomes(bruts);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.nom).sort()).toEqual([
      'A Game of Thrones - La Bataille des rois',
      'Le trone de fer (A game of Thrones)',
    ]);
  });

  it('garde ensemble deux editions du meme tome', () => {
    const bruts = ['S tome 1', 'S tome 1 poche', 'S tome 2', 'S tome 3'].map(r);
    const { series } = separerLesTomes(bruts);
    expect(series[0].tomes.map((x) => x.tome)).toEqual([1, 1, 2, 3]);
  });

  it('ne reorganise RIEN en dessous de trois tomes distincts', () => {
    // Deux livres numerotes peuvent n-avoir aucun rapport entre eux.
    const bruts = ['Un livre tome 1', 'Autre livre tome 2', 'Sans numéro'].map(r);
    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(0);
    expect(autres).toHaveLength(3);
  });

  it('ne touche a rien quand aucun titre n-est numerote', () => {
    const bruts = ['Germinal', 'La Bête humaine', 'Nana'].map(r);
    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(0);
    expect(autres).toHaveLength(3);
  });

  it('un titre qui n-est QUE « Tome 3 » ne fonde aucune serie', () => {
    const bruts = ['Tome 1', 'Tome 2', 'Tome 3'].map(r);
    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(0);
    expect(autres).toHaveLength(3);
  });

  it('supporte une liste vide', () => {
    expect(separerLesTomes([])).toEqual({ series: [], autres: [] });
    expect(separerLesTomes(null)).toEqual({ series: [], autres: [] });
  });
});

describe('Rattacher une integrale ou un coffret a sa serie (etape 3, regroupement par saga)', () => {
  const tome = (n, auteurs = ['Bernard Werber']) => (
    { cleSource: `t${n}`, titre: `Les Fourmis - Tome ${n}`, auteurs }
  );

  it('une INTEGRALE du meme auteur rejoint la suite des tomes de sa serie', () => {
    const bruts = [
      tome(1), tome(2), tome(3),
      { cleSource: 'i', titre: 'Les Fourmis - Intégrale', auteurs: ['Bernard Werber'] },
    ];
    const { series, autres } = separerLesTomes(bruts);
    expect(series).toHaveLength(1);
    expect(series[0].associees.map((r) => r.cleSource)).toEqual(['i']);
    expect(autres).toHaveLength(0);
  });

  it('un COFFRET reste dans le tas commun si l-auteur differe', () => {
    const bruts = [
      tome(1), tome(2), tome(3),
      { cleSource: 'c', titre: 'Les Fourmis - Coffret', auteurs: ['Un Autre Auteur'] },
    ];
    const { series, autres } = separerLesTomes(bruts);
    expect(series[0].associees).toHaveLength(0);
    expect(autres.map((r) => r.cleSource)).toEqual(['c']);
  });

  it('un livre du meme auteur mais d-une AUTRE saga reste dans le tas commun', () => {
    const bruts = [
      tome(1), tome(2), tome(3),
      { cleSource: 'x', titre: 'La Bête humaine', auteurs: ['Bernard Werber'] },
    ];
    const { series, autres } = separerLesTomes(bruts);
    expect(series[0].associees).toHaveLength(0);
    expect(autres.map((r) => r.cleSource)).toEqual(['x']);
  });

  it('organiserLEcran porte les associees jusqu-au bloc serie', () => {
    const bruts = [
      tome(1), tome(2), tome(3),
      { cleSource: 'i', titre: 'Les Fourmis - Intégrale', auteurs: ['Bernard Werber'] },
    ];
    const [bloc] = organiserLEcran(bruts, 'les fourmis');
    expect(bloc.type).toBe('serie');
    expect(bloc.associees.map((r) => r.cleSource)).toEqual(['i']);
  });
});

describe('Lire le nom d-une serie dans un titre de tome', () => {
  it('coupe au marqueur de tome, et jette le sous-titre de l-episode', () => {
    expect(nomDeSerie('La Quete d Ewilan - Tome 01')).toBe('La Quete d Ewilan');
    expect(nomDeSerie('Le Nom de la Rose - Tome 02')).toBe('Le Nom de la Rose');
    expect(nomDeSerie('Dune - T5 Les Hérétiques')).toBe('Dune');
    expect(nomDeSerie('Le Trone de Fer (3)')).toBe('Le Trone de Fer');
  });

  it('ne laisse pas de parenthese orpheline', () => {
    // « Le Trone de Fer (Tome 3) - La bataille des rois » laissait « Le Trone de Fer ( ».
    expect(nomDeSerie('Le Trone de Fer (Tome 3) - La bataille des rois')).toBe('Le Trone de Fer');
  });

  it('rend le titre inchange quand il ne porte aucun numero', () => {
    expect(nomDeSerie('Germinal')).toBe('Germinal');
  });
});

describe('L-ordre de l-ecran : une serie ne passe plus devant par principe', () => {
  const livre = (titre, extra = {}) => ({
    cleSource: titre,
    titre,
    sousTitre: null,
    auteurs: ['Un Auteur'],
    annee: '2020',
    datePublication: '2020',
    couvertureUrl: 'https://exemple/x.jpg',
    isbn13: '9782000000000',
    editeur: 'Un Editeur',
    nbPages: 300,
    langue: 'fr',
    ...extra,
  });

  it('met le livre cherche AVANT une serie qui ne fait que le mentionner', () => {
    /*
     * Cas reel du 2026-08-27 : « game of thrones » installait la bande
     * dessinee « La Bataille des rois » tout en haut, et repoussait le roman
     * de Martin sous la ligne de flottaison.
     */
    const liste = [
      livre('A Game of Thrones - La Bataille des rois - Tome 1'),
      livre('A Game of Thrones - La Bataille des rois - Tome 2'),
      livre('A Game of Thrones - La Bataille des rois - Tome 3'),
      livre('A Game of Thrones'),
    ];
    const suite = organiserLEcran(liste, 'game of thrones');
    expect(suite[0].type).toBe('livres');
    expect(suite[0].livres[0].titre).toBe('A Game of Thrones');
  });

  it('laisse la serie en tete quand c-est bien elle qu-on cherche', () => {
    const liste = [
      livre('La Quete d Ewilan - Tome 01'),
      livre('La Quete d Ewilan - Tome 02'),
      livre('La Quete d Ewilan - Tome 03'),
      livre('Un essai sans rapport'),
    ];
    const suite = organiserLEcran(liste, 'la quete d ewilan');
    expect(suite[0].type).toBe('serie');
    expect(suite[0].nom).toBe('La Quete d Ewilan');
  });

  it('rassemble les livres isoles qui se suivent en une seule grille', () => {
    const suite = organiserLEcran([livre('A'), livre('B'), livre('C')], 'a');
    expect(suite).toHaveLength(1);
    expect(suite[0].livres).toHaveLength(3);
  });

  it('sans requete, garde l-ordre d-arrivee (mode Auteur)', () => {
    const suite = organiserLEcran([livre('Z'), livre('A')], '');
    expect(suite[0].livres.map((x) => x.titre)).toEqual(['Z', 'A']);
  });
});

describe('Etape 4 (regroupement par saga) : le tri change l-ordre des blocs, jamais celui des tomes', () => {
  const livre = (titre, annee, extra = {}) => ({
    cleSource: titre, titre, sousTitre: null, auteurs: ['Un Auteur'],
    annee, datePublication: annee, couvertureUrl: null, isbn13: null,
    editeur: null, nbPages: null, langue: 'fr', ...extra,
  });

  it('« Plus recent » passe la saga la plus recente devant, sans desordonner ses tomes', () => {
    // La saga « Ancienne » (2001) est plus pertinente pour la requete (le titre
    // colle mieux), mais « Recente » (2020) doit passer devant en tri « recent ».
    const liste = [
      livre('Ancienne - Tome 1', '2001'), livre('Ancienne - Tome 2', '2001'),
      livre('Ancienne - Tome 3', '2001'),
      livre('Une Saga Recente - Tome 1', '2020'), livre('Une Saga Recente - Tome 2', '2005'),
      livre('Une Saga Recente - Tome 3', '2020'),
    ];
    const pertinence = organiserLEcran(liste, 'ancienne', 'pertinence');
    expect(pertinence[0].nom).toBe('Ancienne');

    const recent = organiserLEcran(liste, 'ancienne', 'recent');
    expect(recent[0].nom).toBe('Une Saga Recente');
    // Les tomes de la saga qui passe devant restent dans l-ordre du numero.
    expect(recent[0].tomes.map((t) => t.tome)).toEqual([1, 2, 3]);
  });

  it('« Plus recent » passe aussi un livre isole recent devant une saga plus ancienne', () => {
    const liste = [
      livre('Ancienne - Tome 1', '2001'), livre('Ancienne - Tome 2', '2001'),
      livre('Ancienne - Tome 3', '2001'),
      livre('Un livre isole tres recent', '2024'),
    ];
    const recent = organiserLEcran(liste, 'ancienne', 'recent');
    expect(recent[0].type).toBe('livres');
    expect(recent[0].livres[0].titre).toBe('Un livre isole tres recent');
  });
});

describe('Reperer une serie PRESSENTIE, pour la confirmer tout de suite', () => {
  /*
   * Retour d'usage 116 : le bloc « La serie, dans l'ordre » surgissait apres
   * deux defilements sur « game of thrones ». Mesure : sa premiere page ne
   * contient que DEUX tomes, noyes sous les essais qui PARLENT de la serie.
   */
  const r = (titre) => ({ cleSource: titre, titre });

  it('compte les tomes distincts, pas les livres', () => {
    expect(nombreDeTomes([r('S tome 1'), r('S tome 1 poche'), r('S tome 2')])).toBe(2);
    expect(nombreDeTomes([r('Germinal'), r('Nana')])).toBe(0);
    expect(nombreDeTomes([])).toBe(0);
  });

  it('DEUX tomes : on va confirmer — c-est le cas de Game of Thrones', () => {
    const page1 = [
      r('Game of Thrones : une métaphysique des meurtres'),
      r('Le livre des festins'),
      r('A Game of Thrones - La Bataille des rois - Tome 1'),
      r('Game of Thrones Tome 2'),
    ];
    expect(serieAConfirmer(page1)).toBe(true);
    // et le bloc ne s-affiche PAS encore : deux tomes ne font pas une serie.
    expect(separerLesTomes(page1).series).toHaveLength(0);
  });

  it('TROIS tomes : inutile de confirmer, le bloc s-affiche deja', () => {
    const page1 = [r('S tome 1'), r('S tome 2'), r('S tome 3')];
    expect(serieAConfirmer(page1)).toBe(false);
    expect(separerLesTomes(page1).series[0].tomes).toHaveLength(3);
  });

  it('ZERO ou UN tome : rien a confirmer, ce n-est pas une serie', () => {
    expect(serieAConfirmer([r('Germinal'), r('Nana')])).toBe(false);
    expect(serieAConfirmer([r('S tome 1'), r('Germinal')])).toBe(false);
  });
});

describe('Trier les resultats', () => {
  /*
   * Retour d'usage 120. Le tri se fait dans l'application : mesure du
   * 2026-08-26, `orderBy=newest` chez Google rend EXACTEMENT le meme ordre
   * que par defaut — memes titres, memes annees. Il ignore la consigne.
   */
  const l = (titre, date) => ({ cleSource: titre, titre, datePublication: date, annee: date });

  it('« pertinence » SANS requete rend l-ordre de la source', () => {
    // C'est le cas du mode Auteur : le regroupement par ecrivain decide.
    const liste = [l('A', '1990'), l('B', '2020'), l('C', '2005')];
    expect(trierResultats(liste, 'pertinence').map((x) => x.titre)).toEqual(['A', 'B', 'C']);
    expect(trierResultats(liste, 'pertinence', '  ').map((x) => x.titre)).toEqual(['A', 'B', 'C']);
  });

  it('« plus recent » met les editions actuelles en tete', () => {
    const liste = [l('A', '1990'), l('B', '2020'), l('C', '2005')];
    expect(trierResultats(liste, 'recent').map((x) => x.titre)).toEqual(['B', 'C', 'A']);
  });

  it('les livres SANS DATE vont a la fin, jamais en tete', () => {
    // Un livre non date n'est pas un livre recent : le mettre en premier
    // d'un tri « plus recent » serait trompeur.
    const liste = [l('sans date', null), l('recent', '2024'), l('vieux', '1950')];
    expect(trierResultats(liste, 'recent').map((x) => x.titre))
      .toEqual(['recent', 'vieux', 'sans date']);
  });

  it('lit l-annee dans une date complete', () => {
    const liste = [l('A', '1990-03-14'), l('B', '2020-01-02')];
    expect(trierResultats(liste, 'recent')[0].titre).toBe('B');
  });

  it('NE MODIFIE PAS la liste d-origine', () => {
    const liste = [l('A', '1990'), l('B', '2020')];
    trierResultats(liste, 'recent');
    expect(liste.map((x) => x.titre)).toEqual(['A', 'B']);
  });

  it('supporte une liste vide', () => {
    expect(trierResultats([], 'recent')).toEqual([]);
    expect(trierResultats(null, 'recent')).toEqual([]);
  });
});

describe('Classer par pertinence (tranche 1)', () => {
  /*
   * Retour d'usage 121 : « il me propose en premier des choix peu pertinents,
   * je dois defiler pour voir ce que je cherche ». Tous les titres ci-dessous
   * sont des titres REELS rendus par Google sur ces recherches.
   */
  const livre = (titre, extra = {}) => ({
    cleSource: titre,
    titre,
    sousTitre: null,
    auteurs: ['Un Auteur'],
    annee: '2020',
    datePublication: '2020',
    couvertureUrl: 'https://exemple/x.jpg',
    isbn13: '9782000000000',
    editeur: 'Un Editeur',
    nbPages: 300,
    langue: 'fr',
    ...extra,
  });

  const ordre = (liste, requete) => trierResultats(liste, 'pertinence', requete).map((x) => x.titre);

  it('met le titre EXACT en tete, meme arrive en dernier', () => {
    const liste = [
      livre('Le livre des festins'),
      livre('Comprendre le leadership avec Game of Thrones'),
      livre('Game of Thrones'),
    ];
    expect(ordre(liste, 'game of thrones')[0]).toBe('Game of Thrones');
  });

  it('fait passer l-oeuvre devant l-essai qui PARLE d-elle', () => {
    // Le piege reel : Google range le propos en SOUS-TITRE, pas en titre. Sans
    // la penalite de longueur, l'essai obtenait le score du titre exact.
    const liste = [
      livre('Game of Thrones', { sousTitre: 'une metaphysique des meurtres' }),
      livre('Game of Thrones'),
    ];
    expect(ordre(liste, 'game of thrones')[0]).toBe('Game of Thrones');
  });

  it('prefere la fiche complete a la notice fantome', () => {
    const liste = [
      livre('Germinal', {
        cleSource: 'pauvre', auteurs: [], couvertureUrl: null, isbn13: null, isbn10: null,
        editeur: null, nbPages: null,
      }),
      livre('Germinal', { cleSource: 'complet' }),
    ];
    const classe = trierResultats(liste, 'pertinence', 'germinal');
    expect(classe[0].cleSource).toBe('complet');
  });

  it('accepte les accents et la casse de part et d-autre', () => {
    const liste = [livre('Un autre livre'), livre('La Quête d’Ewilan')];
    expect(ordre(liste, 'la quete d ewilan')[0]).toBe('La Quête d’Ewilan');
  });

  it('retrouve un livre dont on ne tape que les mots-cles', () => {
    const liste = [livre('Roman sans rapport'), livre('La Quête d’Ewilan')];
    expect(ordre(liste, 'ewilan quete')[0]).toBe('La Quête d’Ewilan');
  });

  it('la completude DEPARTAGE, elle ne remonte pas un hors-sujet', () => {
    // Une fiche parfaite qui ne correspond pas doit rester derriere une fiche
    // pauvre qui correspond : le titre prime toujours sur la completude.
    const liste = [
      livre('Un tout autre roman'),
      livre('Germinal', {
        auteurs: [], couvertureUrl: null, isbn13: null, isbn10: null,
        editeur: null, nbPages: null, langue: 'en',
      }),
    ];
    expect(ordre(liste, 'germinal')[0]).toBe('Germinal');
  });

  it('ignore l-article de tete : « A Game of Thrones » vaut une correspondance exacte', () => {
    // Cas reel du 2026-08-27 : le roman de Martin arrivait DERNIER, derriere
    // une dizaine d-essais, pour un « A » que personne ne tape.
    const liste = [
      livre('La mythologie selon Game of Thrones'),
      livre('A Game of Thrones'),
    ];
    expect(ordre(liste, 'game of thrones')[0]).toBe('A Game of Thrones');
  });

  it('ne retire l-article que s-il reste un titre derriere', () => {
    // « Le Horla » ne doit pas devenir « Horla » face a une recherche « le ».
    expect(scorePertinence(livre('Un'), 'un')).toBeGreaterThan(scorePertinence(livre('Un'), 'deux'));
  });

  it('un titre en alphabet non latin ne passe plus pour un titre exact', () => {
    /*
     * Defaut livre en tranche 1, mesure le 2026-08-27 : « Germinal /
     * Жерминаль. Книга для чтения с комментариями » arrivait PREMIER sur
     * « germinal ». La comparaison reduit les titres a l-alphabet latin, donc
     * le cyrillique disparaissait AVANT d-etre compte, et l-edition russe
     * decrochait le score d-une correspondance parfaite sans aucune penalite.
     */
    const liste = [
      livre('Germinal / Жерминаль. Книга для чтения с комментариями', { cleSource: 'ru', langue: 'ru' }),
      livre('Germinal', { cleSource: 'fr' }),
    ];
    expect(ordre(liste, 'germinal')[0]).toBe('Germinal');
  });

  it('le NOMBRE D-EDITIONS departage, sans jamais primer sur le titre', () => {
    // 28 fiches pour le Germinal de Zola, au plus 3 pour tout le reste.
    const beaucoup = livre('Germinal', { cleSource: 'a', clesSource: Array.from({ length: 28 }, (_, i) => `gb:${i}`) });
    const seule = livre('Germinal', { cleSource: 'b' });
    expect(trierResultats([seule, beaucoup], 'pertinence', 'germinal')[0].cleSource).toBe('a');

    // Mais un livre tres edite qui ne correspond PAS reste derriere.
    const horsSujet = livre('Un tout autre roman', { cleSource: 'c', clesSource: Array.from({ length: 30 }, (_, i) => `gb:x${i}`) });
    expect(trierResultats([horsSujet, seule], 'pertinence', 'germinal')[0].cleSource).toBe('b');
  });

  it('a score egal, garde l-ordre d-arrivee de Google', () => {
    const liste = [livre('Germinal', { cleSource: 'a' }), livre('Germinal', { cleSource: 'b' })];
    expect(trierResultats(liste, 'pertinence', 'germinal').map((x) => x.cleSource))
      .toEqual(['a', 'b']);
  });

  it('NE FILTRE RIEN : tous les resultats restent affiches', () => {
    const liste = [livre('A'), livre('B'), livre('Germinal')];
    expect(trierResultats(liste, 'pertinence', 'germinal')).toHaveLength(3);
  });

  it('ne touche pas au tri « plus recent »', () => {
    const liste = [livre('Germinal', { datePublication: '1885' }), livre('Autre', { datePublication: '2024' })];
    expect(trierResultats(liste, 'recent', 'germinal')[0].titre).toBe('Autre');
  });

  it('supporte un resultat sans titre ni champs', () => {
    expect(() => scorePertinence({}, 'germinal')).not.toThrow();
  });
});

/*
 * LES FORMES DE LA BnF (mission recherche V3, M5)
 *
 * La BnF n'ecrit JAMAIS « tome » : elle pose le numero apres un point ou une
 * virgule. Le lecteur en ratait CENT POUR CENT — mesure du 2026-08-30 : zero
 * tome reconnu sur les 20 notices de chaque saga, alors que 17 y etaient
 * ecrits. Consequence a l'ecran : « le titre ne precise pas le tome ».
 *
 * Tous les titres ci-dessous sont des notices REELLES.
 */
describe('Lire un tome ecrit a la maniere de la BnF', () => {
  it('reconnait le numero pose apres un point', () => {
    expect(numeroDeTome('Le trône de fer. 1 : roman')).toBe(1);
    expect(numeroDeTome('Le Seigneur des anneaux. 4, Appendices et index')).toBe(4);
    expect(numeroDeTome('Le trône de fer : l’intégrale. 3')).toBe(3);
    expect(numeroDeTome('La Passe-miroir : la tempête des échos. 4')).toBe(4);
    expect(numeroDeTome("La quête d'Ewilan : sur la route. 3")).toBe(3);
  });

  it('reconnait le numero pose apres une virgule', () => {
    expect(numeroDeTome('La Passe-miroir, 1')).toBe(1);
    expect(numeroDeTome('Le Trône de fer, 3 : Le trône de fer')).toBe(3);
  });

  it('reconnait un chiffre ROMAIN', () => {
    expect(numeroDeTome('La Passe-miroir, II : Les disparus du Clairdelune')).toBe(2);
    expect(numeroDeTome('Le Seigneur des anneaux, III')).toBe(3);
  });

  it('n-INVENTE toujours pas de tome — la regle la plus importante', () => {
    // La ponctuation est exigee AVANT le chiffre, et le chiffre doit finir le
    // titre ou introduire un sous-titre. Sans quoi toute annee deviendrait un
    // tome.
    expect(numeroDeTome('1984')).toBeNull();
    expect(numeroDeTome('Germinal, 1885 edition originale')).toBeNull();
    expect(numeroDeTome('Vingt mille lieues sous les mers')).toBeNull();
    expect(numeroDeTome('Dune, 1965')).toBeNull();            // 4 chiffres
    expect(numeroDeTome('Les Rougon-Macquart (13/20)')).toBeNull();
    expect(numeroDeTome('Un titre sans rien de special')).toBeNull();
  });

  it('ne prend pas une initiale d-auteur pour un chiffre romain', () => {
    // « Zola, E. » ne doit pas devenir un tome. Seuls i, v et x comptent, et
    // il faut une fin de titre ou un deux-points derriere.
    expect(numeroDeTome('Germinal, E. Zola')).toBeNull();
    expect(numeroDeTome('Le seigneur des anneaux, J. R. R. Tolkien')).toBeNull();
  });
});

describe('Faire disparaitre ce qui n-est pas l-oeuvre (mission « le bruit d-abord »)', () => {
  /*
   * Retour d'usage : « je cherche Game of Thrones et il me sort des choses en
   * lien avec la serie televisee, pas que des livres ». Le signal, c'est
   * l'auteur : un essai SUR l'oeuvre n'est pas ecrit par l'auteur de l'oeuvre.
   * `rangAuteur` (pose par books.js depuis Open Library) marque l'ecrivain.
   */
  const roman = { titre: 'Le Trône de fer', auteurs: ['George R. R. Martin'], rangAuteur: 0 };
  const vo = { titre: 'A Game of Thrones', auteurs: ['George R. R. Martin'], rangAuteur: 0 };
  const essai = { titre: 'Game of Thrones et la philosophie', auteurs: ['Un Universitaire'] };
  const derive = { titre: 'Game of Thrones : le livre officiel des festins', auteurs: ['Un Cuisinier'] };

  it('retire les essais et derives, garde les livres de l-auteur', () => {
    const gardes = filtrerHorsSujet([roman, essai, vo, derive], 'game of thrones');
    expect(gardes).toContain(roman);
    expect(gardes).toContain(vo);
    expect(gardes).not.toContain(essai);
    expect(gardes).not.toContain(derive);
  });

  it('FAIL-OPEN : sans aucun signal d-auteur, ne filtre rien', () => {
    // Open Library muette (aucun rangAuteur nulle part) : mieux vaut du bruit
    // qu'un ecran vide. On rend la liste entiere, inchangee.
    const liste = [
      { titre: 'Game of Thrones et la philosophie', auteurs: ['X'] },
      { titre: 'Comprendre le leadership avec la serie', auteurs: ['Y'] },
    ];
    expect(filtrerHorsSujet(liste, 'game of thrones')).toHaveLength(2);
  });

  it('AUTEUR DOMINANT : un derive titre EXACTEMENT comme la recherche tombe quand même', () => {
    // Le cas reel de « game of thrones » : « Game of Thrones decode », le guide
    // de Cedric Delaunay, « History of Thrones »… sont titres exactement
    // « Game of Thrones » mais signes d'un autre que Martin. Quand Martin est
    // identifie (rang 0), ce sont des derives, pas des editions perdues.
    const guide = { titre: 'Game of Thrones', auteurs: ['Cédric Delaunay'] };
    const decode = { titre: 'Game of Thrones décodé', auteurs: ['Ava Cahen'] };
    const gardes = filtrerHorsSujet([roman, guide, decode], 'game of thrones');
    expect(gardes).toContain(roman);
    expect(gardes).not.toContain(guide);
    expect(gardes).not.toContain(decode);
  });

  it('FILET DU TITRE : garde une edition au titre exact TANT QU-il n-y a pas d-auteur dominant', () => {
    // Notoriete presente mais faible (aucun rang 0 parmi les resultats) : on ne
    // fait pas pleine confiance a l'auteur, et une edition mal renseignee dont
    // le titre colle est rattrapee.
    const secondaire = { titre: 'Un titre secondaire', auteurs: ['Auteur classe'], rangAuteur: 3 };
    const editionMalRenseignee = { titre: 'Le Trône de fer', auteurs: ['Editeur inconnu d-OL'] };
    const gardes = filtrerHorsSujet([secondaire, editionMalRenseignee], 'le trône de fer');
    expect(gardes).toContain(editionMalRenseignee);
  });

  it('un titre qui COMMENCE par la recherche mais ajoute plusieurs mots tombe', () => {
    // « Game of Thrones et la philosophie » commence par la recherche, mais y
    // ajoute trois mots : c'est la signature de l'essai, pas de l'oeuvre.
    const gardes = filtrerHorsSujet([roman, essai], 'game of thrones');
    expect(gardes).not.toContain(essai);
  });

  it('une recherche vide ne filtre rien', () => {
    expect(filtrerHorsSujet([roman, essai], '')).toHaveLength(2);
  });
});

describe('La legende d-une carte de resultat (etape 2, regroupement par saga)', () => {
  it('affiche le tome LU dans le titre pour un livre isole, sans mention deja fournie', () => {
    // C-est le defaut rapporte : un livre isole avec un tome CONNU restait
    // sans legende, il fallait ouvrir la fiche pour voir « Tome 1 ».
    expect(legendeCarte({ titre: 'Le Seigneur des Anneaux, Tome 1' })).toBe('tome 1');
  });

  it('ne rend rien pour un livre sans tome detecte', () => {
    expect(legendeCarte({ titre: 'Les Fourmis' })).toBeUndefined();
  });

  it('la mention deja decidee (bloc saga) garde la priorite sur le titre', () => {
    expect(legendeCarte({ titre: 'Le Trône de Fer (Tome 5)' }, 'tome 5')).toBe('tome 5');
    // Meme un titre AUTREMENT numerote ne doit pas ecraser une mention fournie
    // — ex. la raison d-une suggestion, calculee ailleurs.
    expect(legendeCarte({ titre: 'Le Trône de Fer (Tome 5)' }, 'Parce que vous avez lu Dune')
      .startsWith('Parce que')).toBe(true);
  });
});
