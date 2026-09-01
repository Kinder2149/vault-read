/*
 * BANC D'ESSAI DE LA RECHERCHE — a lancer a la main.
 *
 *   npm run banc
 *
 * Ce n'est PAS une verification automatique : il n'echoue jamais, il MONTRE.
 * Le jugement reste humain — un classement ne se declare pas bon ou mauvais
 * par un booleen, il se regarde.
 *
 * POURQUOI IL A ETE REECRIT (2026-08-30).
 *
 * Sa version precedente annoncait « 7 / 7 » pendant que l'application etait
 * jugee inutilisable sur le telephone. Elle ne mesurait qu'UNE chose : la
 * place du livre cherche. Ni la couverture, ni le resume, ni le tome. Trois
 * des quatre reproches lui etaient structurellement invisibles, et elle
 * donnait donc le droit de se declarer satisfait.
 *
 * Un instrument qui ne mesure pas ce dont on se plaint est PIRE que pas
 * d'instrument. Celui-ci verifie desormais LA CARTE :
 *
 *   - d'ou vient la COUVERTURE affichee, et d'ou vient le RESUME ;
 *   - si un champ a ete emprunte a une fiche qui porte un AUTRE titre —
 *     c'est-a-dire le defaut exact rapporte : « la couverture est parfois
 *     completement fausse, la description ne correspond pas au titre » ;
 *   - le TOME lu dans le titre ;
 *   - les cartes sans image.
 *
 * ET IL DOIT TROUVER DES DEFAUTS. Tant que les corrections ne sont pas faites,
 * un banc qui ne signale rien est un banc casse.
 *
 * CE QU'IL DUPLIQUE. L'appel a Google Books est reecrit ici : cette source lit
 * sa cle dans `import.meta.env`, que Vite remplace a la compilation et qui
 * n'existe pas sous node. `tests/controle-sources.js` fait le meme choix pour
 * la meme raison. Open Library, elle, est appelee par son VRAI code.
 *
 * Attention : chaque lancement consomme environ 18 requetes sur le quota
 * quotidien de 1 000 (§4.1).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fusionnerDoublons, attribuerNotoriete } from '../src/books.js';
import { oeuvresNotoires } from '../src/sources/openlibrary.js';
import { numeroDeTome, scorePertinence } from '../src/tomes.js';

/*
 * LES RECHERCHES DE REFERENCE — figees.
 * `cible` est le nom de l'auteur du livre qu'on cherchait : il sert a dire a
 * quelle place il arrive. Les sagas sont la parce que c'est sur elles que la
 * fusion et les tomes se cassent.
 */
const RECHERCHES = [
  { texte: 'harry potter', cible: 'rowling' },
  { texte: 'le seigneur des anneaux', cible: 'tolkien' },
  { texte: 'le trone de fer', cible: 'martin' },
  { texte: "la quete d'ewilan", cible: 'bottero' },
  { texte: 'la passe-miroir', cible: 'dabos' },
  { texte: 'game of thrones', cible: 'martin' },
  { texte: 'germinal', cible: 'zola' },
  { texte: 'les fourmis', cible: 'werber' },
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
 * Reessais BEAUCOUP plus insistants que ceux de l'application : personne
 * n'attend devant le banc, et une recherche NON MESUREE laisse un trou dans la
 * comparaison — ce qui coute plus cher que dix secondes.
 * Constate le 2026-08-30 : avec huit pauses, Google a rendu 503 sur CINQ
 * recherches sur huit, et le bilan etait a moitie vide. Un instrument qui ne
 * mesure qu'une fois sur deux ne permet pas de conclure.
 */
const PAUSES_REESSAI_MS = [0, 0, 250, 750, 1500, 3000, 5000, 8000, 12000, 15000, 15000, 15000];

/* Google se braque quand on l'enchaine. Une respiration entre deux recherches
 * coute quelques secondes et evite la moitie des 503. */
const RESPIRATION_MS = 1500;

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

/* Le meme normaliseur que `sources/google.js`, aux memes pieges. */
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
const estLaCible = (r, cible) => (r.auteurs || []).some((a) => sansAccent(a).includes(cible));
const court = (t, n) => { const s = String(t || ''); return s.length <= n ? s : `${s.slice(0, n - 1)}…`; };

/*
 * LE TITRE, REDUIT POUR COMPARAISON. Casse, accents et ponctuation seulement :
 * on ne coupe RIEN. C'est ce qui permet de dire si deux fiches portent
 * vraiment le meme titre — et donc si un champ emprunte est legitime.
 */
const titreReduit = (t) => sansAccent(t).replace(/[^a-z0-9]+/g, ' ').trim();

/*
 * L'EXAMEN D'UNE CARTE. Rend la liste de ses defauts, en clair.
 * `membres` = les fiches brutes que la fusion a reunies sous cette carte.
 */
function examiner(carte, membres) {
  const defauts = [];
  const titreCarte = titreReduit(carte.titre);

  // 1. La fusion a-t-elle reuni des fiches de titres DIFFERENTS ?
  const titres = [...new Set(membres.map((m) => titreReduit(m.titre)))];
  if (titres.length > 1) {
    defauts.push({
      type: 'FUSION',
      detail: `${titres.length} titres differents reunis`,
      lignes: [...new Set(membres.map((m) => m.titre))],
    });
  }

  // 2. La fusion a-t-elle reuni des TOMES differents ?
  const tomes = [...new Set(membres.map((m) => numeroDeTome(`${m.titre} ${m.sousTitre || ''}`)).filter((n) => n !== null))];
  if (tomes.length > 1) {
    defauts.push({ type: 'TOMES', detail: `tomes ${tomes.join(', ')} sur une seule carte`, lignes: [] });
  }

  // 3. La couverture et le resume viennent-ils d'une fiche d'un AUTRE titre ?
  //    C'est le defaut rapporte : « la couverture est parfois completement
  //    fausse, la description ne correspond pas au titre ».
  for (const [champ, valeur] of [['couverture', carte.couvertureUrl], ['resume', carte.resume]]) {
    if (!valeur) continue;
    const donneur = membres.find((m) => m[champ === 'couverture' ? 'couvertureUrl' : 'resume'] === valeur);
    if (donneur && titreReduit(donneur.titre) !== titreCarte) {
      defauts.push({
        type: 'EMPRUNT',
        detail: `${champ} prise sur « ${court(donneur.titre, 60)} »`,
        lignes: [],
      });
    }
  }

  // 4. Aucune image du tout.
  if (!carte.couvertureUrl) defauts.push({ type: 'SANS IMAGE', detail: '', lignes: [] });

  return defauts;
}

// ---------------------------------------------------------------------------

console.log(`\n${gras("Banc d'essai de la recherche")} — ${new Date().toLocaleString('fr-FR')}`);
console.log(gris(`${PAGES} pages par recherche. On verifie LA CARTE, pas seulement le rang.`));
if (!CLE) {
  console.log(rouge('\nCle Google Books absente de client/.env — Google rejettera tout.\n'));
  process.exit(0);
}

const bilan = [];

for (const { texte, cible } of RECHERCHES) {
  console.log(`\n${gras(`« ${texte} »`)} ${gris(`— on cherche le livre de ${cible}`)}`);

  let brut = [];
  let erreur = null;
  try {
    for (let p = 0; p < PAGES; p += 1) {
      const donnees = await googleGet(texte, p);
      brut.push(...(donnees.items || []).map(normaliserVolume));
    }
  } catch (e) {
    erreur = e.message === 'QUOTA' ? 'quota Google epuise' : e.message;
  }

  if (erreur) {
    console.log(`  ${rouge(erreur)}`);
    bilan.push({ texte, erreur });
    if (erreur.startsWith('quota')) break;
    continue;
  }

  let oeuvres = [];
  try { oeuvres = await oeuvresNotoires(texte); } catch { oeuvres = []; }

  const notes = attribuerNotoriete(brut, oeuvres);
  const cartes = fusionnerDoublons(notes, texte);

  // Retrouver, pour chaque carte, les fiches brutes qu'elle a absorbees.
  const parCle = new Map(brut.map((r) => [r.cleSource, r]));
  const examens = cartes.map((c) => {
    const membres = (c.clesSource || [c.cleSource]).map((k) => parCle.get(k)).filter(Boolean);
    return { carte: c, membres, defauts: examiner(c, membres) };
  });

  const fusions = examens.filter((e) => e.defauts.some((d) => d.type === 'FUSION')).length;
  const emprunts = examens.filter((e) => e.defauts.some((d) => d.type === 'EMPRUNT')).length;
  const melTomes = examens.filter((e) => e.defauts.some((d) => d.type === 'TOMES')).length;
  const sansImage = examens.filter((e) => e.defauts.some((d) => d.type === 'SANS IMAGE')).length;

  const aPlat = [];
  examens.forEach((e) => aPlat.push(e));
  const position = aPlat
    .sort((a, b) => scorePertinence(b.carte, texte) - scorePertinence(a.carte, texte))
    .findIndex((e) => estLaCible(e.carte, cible));

  console.log(gris(
    `  ${brut.length} volumes -> ${cartes.length} cartes`
    + `   | notoriete : ${oeuvres.length ? `${oeuvres.length} oeuvres` : rouge('Open Library muette')}`,
  ));

  const etat = (n, libelle) => (n === 0 ? vert(`0 ${libelle}`) : rouge(`${n} ${libelle}`));
  console.log(
    `  ${etat(fusions, 'fusion(s) de titres differents')}   `
    + `${etat(emprunts, 'champ(s) emprunte(s) a un autre livre')}   `
    + `${etat(melTomes, 'melange(s) de tomes')}   `
    + `${sansImage ? jaune(`${sansImage} sans image`) : vert('0 sans image')}`,
  );

  // Le detail des cartes fautives — c'est ce qu'on vient chercher.
  examens.filter((e) => e.defauts.some((d) => d.type !== 'SANS IMAGE')).slice(0, 3).forEach((e) => {
    console.log(`\n  ${rouge('CARTE FAUTIVE')} : « ${court(e.carte.titre, 56)} »  ${gris(`tome ${numeroDeTome(e.carte.titre) ?? '—'}`)}`);
    e.defauts.filter((d) => d.type !== 'SANS IMAGE').forEach((d) => {
      console.log(`      ${jaune(d.type)} — ${d.detail}`);
      d.lignes.forEach((l) => console.log(gris(`         · ${court(l, 72)}`)));
    });
  });

  bilan.push({
    texte, cible, cartes: cartes.length, fusions, emprunts, melTomes, sansImage,
    position: position === -1 ? null : position + 1,
  });
}

// ---------------------------------------------------------------------------

console.log(`\n\n${gras('BILAN')}`);
console.log(gris('  defauts = fusions fausses + champs empruntes + melanges de tomes\n'));
console.log(gris('  recherche                    cartes  defauts  sans image  place du livre'));

let totalDefauts = 0;
bilan.forEach((b) => {
  if (b.erreur) { console.log(`  ${`« ${b.texte} »`.padEnd(30)}${rouge(b.erreur)}`); return; }
  const d = b.fusions + b.emprunts + b.melTomes;
  totalDefauts += d;
  const place = b.position === null ? rouge('absent') : (b.position <= 3 ? vert(`${b.position}`) : jaune(`${b.position}`));
  console.log(
    `  ${`« ${b.texte} »`.padEnd(30)}${String(b.cartes).padStart(5)}`
    + `${(d === 0 ? vert(String(d)) : rouge(String(d))).padStart(18)}`
    + `${String(b.sansImage).padStart(13)}`
    + `${place.padStart(19)}`,
  );
});

console.log(
  `\n  ${totalDefauts === 0 ? vert('Aucun defaut de carte.') : rouge(`${totalDefauts} carte(s) fautive(s).`)}`,
);
console.log(gris('  Tant que les corrections ne sont pas faites, un banc qui ne signale\n'
  + '  rien est un banc casse — pas une application saine.\n'));

process.exit(0);
