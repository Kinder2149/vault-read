/*
 * BANC FIXE — a lancer a la main.
 *
 *   npm run banc:fixe
 *
 * DIFFERENCE avec banc-recherche.js : celui-la mesure des defauts de CARTE sur
 * des recherches libres. Celui-ci verifie une BASE DE 10 LIVRES FIGEE, chacun
 * avec un RESULTAT ATTENDU ecrit a l'avance (Kinder, 2026-09-27) :
 *
 *   - 9 livres seuls  -> 1 seule carte attendue, avec image ;
 *   - Harry Potter    -> 7 cartes attendues, une par tome, numero visible,
 *                        aucune dupliquee.
 *
 * Ce n'est PAS encore une correction : c'est l'instrument qui doit d'abord
 * montrer, cas par cas, ou le pipeline reel (Google -> notoriete Open Library
 * -> fusion -> filtre du hors-sujet) s'ecarte de l'attendu, avant qu'on touche
 * a une seule ligne de books.js ou tomes.js.
 *
 * Reprend le meme pipeline et les memes pieges que banc-recherche.js : la cle
 * Google est lue dans client/.env (absente sous node de import.meta.env),
 * Open Library est appelee par son vrai code.
 *
 * Consomme environ 10 requetes Google (1 recherche par cas, PAGES=1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fusionnerDoublonsAffichage, attribuerNotoriete, enrichirTomesConnus } from '../src/books.js';
import { oeuvresNotoires } from '../src/sources/openlibrary.js';
import { numeroDeTome } from '../src/tomes.js';

/*
 * LA BASE DE TEST — figee, validee par Kinder le 2026-09-27.
 * `attendu.cartes` : nombre de cartes attendu.
 * `attendu.tomeVisible` : true si chaque carte doit porter un numero de tome
 * lisible (seul le cas Harry Potter l'exige).
 */
const CAS = [
  { texte: 'germinal', auteur: 'zola', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'notre-dame de paris', auteur: 'hugo', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'crime et chatiment', auteur: 'dostoievski', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'don quichotte', auteur: 'cervantes', attendu: { cartes: 1, tomeVisible: false } },
  { texte: "l'etranger", auteur: 'camus', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'orgueil et prejuges', auteur: 'austen', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'le comte de monte-cristo', auteur: 'dumas', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'vingt mille lieues sous les mers', auteur: 'verne', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'le petit prince', auteur: 'saint-exupery', attendu: { cartes: 1, tomeVisible: false } },
  { texte: 'harry potter', auteur: 'rowling', attendu: { cartes: 7, tomeVisible: true } },
];

const PAGES = 1;
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
const court = (t, n) => { const s = String(t || ''); return s.length <= n ? s : `${s.slice(0, n - 1)}…`; };

const PAUSES_REESSAI_MS = [0, 0, 250, 750, 1500, 3000, 5000, 8000, 12000, 15000];
const RESPIRATION_MS = 1500;

async function googleGet(requete) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', `intitle:${requete}`);
  url.searchParams.set('printType', 'books');
  url.searchParams.set('langRestrict', 'fr');
  url.searchParams.set('maxResults', String(MAX_RESULTATS));
  if (CLE) url.searchParams.set('key', CLE);

  for (let essai = 0; ; essai += 1) {
    let reponse;
    try {
      reponse = await fetch(url);
    } catch (e) {
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

/* Le meme normaliseur que sources/google.js. */
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

const sansAccent = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const estDeLAuteur = (carte, auteur) => (carte.auteurs || []).some((a) => sansAccent(a).includes(auteur));

// ---------------------------------------------------------------------------

console.log(`\n${gras('Banc fixe — 10 livres, resultat attendu')} — ${new Date().toLocaleString('fr-FR')}`);
console.log(gris('Base validee le 2026-09-27. Chaque cas dit ce qui est attendu ; ce banc ne fait que comparer.\n'));

if (!CLE) {
  console.log(rouge('Cle Google Books absente de client/.env — Google rejettera tout.\n'));
  process.exit(0);
}

const bilan = [];

for (const { texte, auteur, attendu } of CAS) {
  console.log(`${gras(`« ${texte} »`)} ${gris(`— attendu : ${attendu.cartes} carte(s)${attendu.tomeVisible ? ', numero de tome visible sur chacune' : ''}`)}`);

  let brut = [];
  let erreur = null;
  try {
    for (let p = 0; p < PAGES; p += 1) {
      const donnees = await googleGet(texte);
      brut.push(...(donnees.items || []).map(normaliserVolume));
    }
  } catch (e) {
    erreur = e.message === 'QUOTA' ? 'quota Google epuise' : e.message;
  }

  if (erreur) {
    console.log(`  ${rouge(erreur)}\n`);
    bilan.push({ texte, erreur });
    if (erreur.startsWith('quota')) break;
    await new Promise((r) => setTimeout(r, RESPIRATION_MS));
    continue;
  }

  let oeuvresConnues = [];
  try { oeuvresConnues = await oeuvresNotoires(texte); } catch { oeuvresConnues = []; }

  const notes = attribuerNotoriete(brut, oeuvresConnues);
  let cartes = fusionnerDoublonsAffichage(notes, texte);
  // Meme rattrapage du tome (tranche 33) que l'ecran : Open Library, quand le
  // titre n'ecrit rien (Harry Potter). Seulement paye quand la carte compte.
  if (attendu.tomeVisible) cartes = await enrichirTomesConnus(cartes);

  // Ne garder que les cartes de l'auteur attendu : c'est ce que verrait
  // Kinder apres avoir cherche precisement ce livre-la.
  const cartesDeLAuteur = cartes.filter((c) => estDeLAuteur(c, auteur));

  const tomeLisible = (c) => numeroDeTome(`${c.titre} ${c.sousTitre || ''}`) ?? (Number.isInteger(c.cycleTome) ? c.cycleTome : null);

  const defauts = [];

  if (cartesDeLAuteur.length !== attendu.cartes) {
    defauts.push(`${cartesDeLAuteur.length} carte(s) au lieu de ${attendu.cartes} attendue(s)`);
  }

  const sansImage = cartesDeLAuteur.filter((c) => !c.couvertureUrl);
  if (sansImage.length) defauts.push(`${sansImage.length} sans couverture`);

  if (attendu.tomeVisible) {
    const sansTome = cartesDeLAuteur.filter((c) => tomeLisible(c) === null);
    if (sansTome.length) defauts.push(`${sansTome.length} sans numero de tome lisible`);

    const tomesVus = cartesDeLAuteur.map(tomeLisible).filter((n) => n !== null);
    const doublons = tomesVus.length - new Set(tomesVus).size;
    if (doublons > 0) defauts.push(`${doublons} tome(s) en double`);
  }

  const etat = defauts.length === 0 ? vert('OK') : rouge('FAIL');
  console.log(`  ${etat}  ${brut.length} volumes -> ${cartes.length} cartes -> ${cartesDeLAuteur.length} de ${auteur}`);
  if (defauts.length) {
    defauts.forEach((d) => console.log(`     ${jaune('- ' + d)}`));
    cartesDeLAuteur.forEach((c) => console.log(gris(
      `        · ${court(c.titre, 60)}  ${tomeLisible(c) !== null ? `(tome ${tomeLisible(c)})` : ''}  ${c.couvertureUrl ? '' : '[sans image]'}`,
    )));
  }
  console.log('');

  bilan.push({ texte, ok: defauts.length === 0, defauts });
  await new Promise((r) => setTimeout(r, RESPIRATION_MS));
}

// ---------------------------------------------------------------------------

console.log(`${gras('BILAN')}`);
let echecs = 0;
bilan.forEach((b) => {
  if (b.erreur) { console.log(`  ${`« ${b.texte} »`.padEnd(38)}${rouge(b.erreur)}`); return; }
  if (!b.ok) echecs += 1;
  console.log(`  ${`« ${b.texte} »`.padEnd(38)}${b.ok ? vert('OK') : rouge(`FAIL — ${b.defauts.join(' ; ')}`)}`);
});

console.log(`\n  ${echecs === 0 ? vert('Les 10 cas passent.') : rouge(`${echecs} cas sur ${CAS.length} en echec.`)}\n`);

process.exit(0);
