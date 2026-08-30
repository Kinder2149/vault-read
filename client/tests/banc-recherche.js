/*
 * BANC D'ESSAI DE LA RECHERCHE — a lancer a la main, pour voir CE QUI SORT
 * quand on cherche un livre, et a quelle place arrive celui qu'on cherchait.
 *
 *   npm run banc
 *
 * Ce n'est PAS une verification automatique : il n'echoue jamais, il MONTRE.
 * Le jugement reste humain. C'est volontaire — un classement ne se declare pas
 * bon ou mauvais par un booleen, il se regarde.
 *
 * A QUOI IL SERT. Toute amelioration du classement (source d'ordre, score,
 * notoriete) se juge sur un avant/apres. Sans cet instrument, on juge a l'oeil
 * sur une recherche, on croit avoir gagne, et on decouvre la regression sur le
 * telephone. Le tableau final donne UN chiffre par recherche — la place du
 * livre attendu — et c'est ce chiffre qu'on compare.
 *
 * CE QU'IL REJOUE VRAIMENT. La chaine complete d'affichage, avec le VRAI code :
 *   books.fusionnerDoublons   -> une carte par oeuvre
 *   tomes.organiserLEcran     -> series nommees + livres isoles, classes
 *   tomes.scorePertinence     -> la note de chaque carte
 * Deux pages sont chargees (40 volumes), comme l'ecran apres un defilement :
 * c'est a partir de la page 2 que les series se confirment (§ serieAConfirmer).
 *
 * Open Library, elle, est appelee par SON VRAI code (`oeuvresNotoires`) : cette
 * source ne lit aucune variable de compilation, elle se charge donc sous node.
 *
 * CE QU'IL DUPLIQUE, ET POURQUOI. L'appel a Google Books est reecrit ici au
 * lieu d'appeler `sources/google.js`. Raison technique, pas de confort : cette
 * source lit sa cle dans `import.meta.env`, que Vite remplace a la
 * compilation et qui n'existe pas sous node — l'importer echouerait.
 * `tests/controle-sources.js` fait deja le meme choix, pour la meme raison.
 * Ce qui est duplique est donc la REQUETE (l'entree du banc), jamais le
 * classement (ce qu'on mesure) : si `google.js` change sa requete, le banc
 * mesure une entree legerement differente, et il faut le remettre en phase.
 *
 * Attention : chaque lancement consomme environ 14 requetes sur le quota
 * quotidien de 1 000 (§4.1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fusionnerDoublons, attribuerNotoriete } from '../src/books.js';
import { oeuvresNotoires } from '../src/sources/openlibrary.js';
import { organiserLEcran, scorePertinence } from '../src/tomes.js';

// ---------------------------------------------------------------------------
// LES RECHERCHES DE REFERENCE — figees.
// ---------------------------------------------------------------------------

/*
 * `cible` est le nom de l'auteur du livre QU'ON CHERCHAIT. Le banc s'en sert
 * pour dire a quelle place il arrive. C'est tout l'interet du tableau final :
 * un chiffre, comparable d'une version a l'autre.
 *
 * « le trone de fer » est le titre FRANCAIS des romans que « game of thrones »
 * cherche en anglais. Les deux sont dans la liste pour surveiller qu'ils
 * mènent au meme livre : au premier lancement du banc, le francais marchait
 * (position 2) et l'anglais non (position 4) — l'inverse de ce qu'on croyait.
 */
const RECHERCHES = [
  { texte: 'game of thrones', cible: 'martin' },
  { texte: 'le seigneur des anneaux', cible: 'tolkien' },
  { texte: 'le trone de fer', cible: 'martin' },
  { texte: 'germinal', cible: 'zola' },
  { texte: 'les fourmis', cible: 'werber' },
  { texte: "la quete d'ewilan", cible: 'bottero' },
  { texte: 'le nom de la rose', cible: 'eco' },
];

const PAGES = 2;
const MAX_RESULTATS = 20;

// ---------------------------------------------------------------------------

const CLE = (() => {
  try {
    const env = readFileSync(fileURLToPath(new URL('../.env', import.meta.url)), 'utf8');
    const m = env.match(/VITE_GOOGLE_BOOKS_API_KEY=(.*)/);
    return m ? m[1].trim().replace(/["']/g, '') : '';
  } catch { return ''; }
})();

const vert = (t) => `\x1b[32m${t}\x1b[0m`;
const rouge = (t) => `\x1b[31m${t}\x1b[0m`;
const jaune = (t) => `\x1b[33m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;
const gras = (t) => `\x1b[1m${t}\x1b[0m`;

/*
 * Reessais PLUS INSISTANTS que ceux de `sources/google.js`, et c'est voulu.
 *
 * L'application s'arrete a cinq essais parce qu'un utilisateur attend devant
 * son ecran : au-dela, mieux vaut un repli qu'une barre de chargement. Ici
 * personne n'attend, et une recherche NON MESUREE est le pire resultat
 * possible — elle laisse un trou dans le tableau de comparaison, ce qui est
 * plus couteux qu'une seconde de plus.
 * Constate au premier lancement : avec les cinq pauses de l'application, deux
 * recherches sur sept sont tombees en 503 et n'ont rien mesure.
 */
const PAUSES_REESSAI_MS = [0, 0, 250, 750, 1500, 3000, 5000, 8000];

async function googleGet(requete, page) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', `intitle:${requete}`);
  url.searchParams.set('printType', 'books');
  url.searchParams.set('langRestrict', 'fr');
  url.searchParams.set('maxResults', String(MAX_RESULTATS));
  if (page > 0) url.searchParams.set('startIndex', String(page * MAX_RESULTATS));
  if (CLE) url.searchParams.set('key', CLE);

  for (let essai = 0; ; essai += 1) {
    let reponse;
    try {
      reponse = await fetch(url);
    } catch (e) {
      // Coupure reseau : meme traitement qu'un 503, elle se rattrape souvent.
      if (essai < PAUSES_REESSAI_MS.length) {
        await new Promise((r) => setTimeout(r, PAUSES_REESSAI_MS[essai] || 300));
        continue;
      }
      throw e;
    }
    if (reponse.status === 503 && essai < PAUSES_REESSAI_MS.length) {
      const pause = PAUSES_REESSAI_MS[essai];
      if (pause) await new Promise((r) => setTimeout(r, pause));
      continue;
    }
    if (reponse.status === 429) throw new Error('QUOTA');
    if (!reponse.ok) throw new Error(`Google a repondu ${reponse.status}`);
    return reponse.json();
  }
}

/*
 * Le meme normaliseur que `sources/google.js`, aux memes pieges : imageLinks
 * arrive en http:// et zoom=1 rend une vignette minuscule ; pageCount vaut 0
 * pour « inconnu » ; industryIdentifiers peut ne porter aucun ISBN.
 * La couverture n'est pas redimensionnee ici : le banc ne l'affiche pas, il
 * compte seulement sa PRESENCE — qui pese dans `completude()`.
 */
function normaliserVolume(item) {
  const vi = item.volumeInfo || {};
  const date = vi.publishedDate || null;
  const images = vi.imageLinks || {};
  const isbn = (type) => (vi.industryIdentifiers || [])
    .find((i) => i.type === type)?.identifier || null;

  return {
    cleSource: `gb:${item.id}`,
    source: 'google',
    titre: vi.title || 'Sans titre',
    sousTitre: vi.subtitle || null,
    auteurs: Array.isArray(vi.authors) ? vi.authors : [],
    annee: date ? date.slice(0, 4) : null,
    datePublication: date,
    couvertureUrl: images.thumbnail || images.smallThumbnail || null,
    resume: vi.description || null,
    categories: Array.isArray(vi.categories) ? vi.categories : [],
    langue: vi.language || null,
    isbn13: isbn('ISBN_13'),
    isbn10: isbn('ISBN_10'),
    nbPages: vi.pageCount ? vi.pageCount : null,
    editeur: vi.publisher || null,
  };
}

function sansAccent(texte) {
  return String(texte || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Ce livre est-il celui qu'on cherchait ? On regarde le nom de l'auteur. */
function estLaCible(resultat, cible) {
  return (resultat.auteurs || []).some((a) => sansAccent(a).includes(cible));
}

function raccourcir(texte, largeur) {
  const t = String(texte || '');
  return t.length <= largeur ? t : `${t.slice(0, largeur - 1)}…`;
}

/*
 * Met l'ecran a plat pour pouvoir compter des positions. Une serie occupe UNE
 * position — c'est ce que voit l'utilisateur : un bloc, pas six cartes.
 */
function aPlat(ecran) {
  const lignes = [];
  ecran.forEach((bloc) => {
    if (bloc.type === 'serie') {
      lignes.push({ serie: true, nom: bloc.nom, livres: bloc.tomes });
    } else {
      bloc.livres.forEach((l) => lignes.push({ serie: false, livres: [l] }));
    }
  });
  return lignes;
}

// ---------------------------------------------------------------------------

console.log(`\n${gras("Banc d'essai de la recherche")} — ${new Date().toLocaleString('fr-FR')}`);
console.log(gris(`${PAGES} pages chargees par recherche, comme l'ecran apres un defilement.`));
if (!CLE) {
  console.log(rouge('\nCle Google Books absente de client/.env — Google rejettera tout.\n'));
  process.exit(0);
}

const bilan = [];

for (const { texte, cible } of RECHERCHES) {
  console.log(`\n${gras(`« ${texte} »`)}  ${gris(`— on cherche le livre de ${cible}`)}`);

  let brut = [];
  let erreur = null;
  const t0 = Date.now();
  try {
    for (let p = 0; p < PAGES; p += 1) {
      const donnees = await googleGet(texte, p);
      brut.push(...(donnees.items || []).map(normaliserVolume));
    }
  } catch (e) {
    erreur = e.message === 'QUOTA'
      ? 'quota Google epuise pour aujourd hui'
      : e.message;
  }
  const ms = Date.now() - t0;

  if (erreur) {
    console.log(`  ${rouge(erreur)}`);
    bilan.push({ texte, cible, position: null, erreur });
    if (erreur.startsWith('quota')) break;
    continue;
  }

  // ---- la vraie chaine d'affichage, avec le vrai code -----------------------
  /*
   * Open Library est facultative ici comme dans l'application : si elle ne
   * repond pas, le banc mesure le classement SANS elle plutot que de renoncer
   * a la recherche. La ligne « notoriete » du compte-rendu le dit.
   */
  let oeuvres = [];
  try { oeuvres = await oeuvresNotoires(texte); } catch { oeuvres = []; }
  const notes = attribuerNotoriete(brut, oeuvres);
  const reconnus = notes.filter((r) => r.lecteurs > 0).length;
  const cartes = fusionnerDoublons(notes, texte);
  const ecran = organiserLEcran(cartes, texte);
  const lignes = aPlat(ecran);

  const position = lignes.findIndex((l) => l.livres.some((x) => estLaCible(x, cible)));

  console.log(gris(
    `  ${brut.length} volumes -> ${cartes.length} cartes -> ${lignes.length} lignes d'ecran`
    + `   (${ms} ms)`,
  ));
  console.log(gris(
    oeuvres.length === 0
      ? '  notoriete : Open Library n a rien rendu — classement sans elle'
      : `  notoriete : ${oeuvres.length} oeuvres connues, ${reconnus}/${brut.length} volumes reconnus`
        + `   (la plus lue : ${oeuvres[0].titre} — ${oeuvres[0].lecteurs.toLocaleString('fr-FR')} lecteurs)`,
  ));

  lignes.slice(0, 8).forEach((ligne, i) => {
    const rang = String(i + 1).padStart(2, ' ');
    const porteLaCible = ligne.livres.some((x) => estLaCible(x, cible));
    const marque = porteLaCible ? vert(' <-- ce qu on cherchait') : '';

    if (ligne.serie) {
      const note = Math.max(...ligne.livres.map((t) => scorePertinence(t, texte)));
      console.log(
        `  ${rang}. ${jaune('[serie]')} ${gras(raccourcir(ligne.nom, 44))}`
        + gris(`  ${ligne.livres.length} tomes, note ${note}`) + marque,
      );
      return;
    }

    const l = ligne.livres[0];
    const note = scorePertinence(l, texte);
    const auteur = (l.auteurs || [])[0] || '?';
    const editions = Array.isArray(l.clesSource) ? l.clesSource.length : 1;
    console.log(
      `  ${rang}. ${gris(String(note).padStart(3, ' '))} ${raccourcir(l.titre, 44).padEnd(45)}`
      + gris(`${raccourcir(auteur, 18).padEnd(19)}${String(l.lecteurs || 0).padStart(6)} lect. ${l.langue || '--'}`) + marque,
    );
  });

  if (position === -1) {
    console.log(`  ${rouge('ABSENT')} ${gris('— le livre cherche n est nulle part dans ces 2 pages')}`);
  } else if (position >= 8) {
    console.log(`  ${gris(`… il arrive en position ${position + 1}, hors des 8 premieres lignes`)}`);
  }

  bilan.push({ texte, cible, position: position === -1 ? null : position + 1, erreur: null });
}

// ---------------------------------------------------------------------------
// LE TABLEAU QUI COMPTE — un chiffre par recherche, comparable avant/apres.
// ---------------------------------------------------------------------------

console.log(`\n${gras('Place du livre cherche')}`);
console.log(gris('  Le critere de la mission : dans les 3 premieres lignes, sans defiler.\n'));

let atteints = 0;
bilan.forEach(({ texte, cible, position, erreur }) => {
  const nom = `« ${texte} »`.padEnd(28);
  if (erreur) { console.log(`  ${nom}${rouge(erreur)}`); return; }
  if (position === null) { console.log(`  ${nom}${rouge('absent')}  ${gris(`(${cible})`)}`); return; }
  if (position <= 3) { atteints += 1; console.log(`  ${nom}${vert(`position ${position}`)}  ${gris(`(${cible})`)}`); return; }
  console.log(`  ${nom}${jaune(`position ${position}`)}  ${gris(`(${cible})`)}`);
});

console.log(
  `\n  ${gras(`${atteints} / ${bilan.length}`)} dans les trois premieres lignes.`,
);
console.log(gris('  Un chiffre qui ne bouge pas apres un changement de classement veut dire\n'
  + '  que le changement n a rien apporte — ou qu il n est pas actif.\n'));

process.exit(0);
