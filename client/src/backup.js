/*
 * backup.js — format de sauvegarde, validation, restauration, export CSV.
 * Applique §3.6. Dans une application 100 % locale, c'est une fonction de
 * SÉCURITÉ, pas un confort : le retour d'expérience du projet séries dit de
 * l'écrire tôt, pas en avant-dernière tranche. C'est pourquoi elle est ici.
 * Trois garde-fous, dans cet ordre : valider le format, DÉCRIRE le contenu en
 * clair à l'utilisateur, exiger une confirmation explicite. Une restauration
 * écrase un profil entier ; elle ne doit jamais partir d'un seul geste.
 */

import * as store from './store.js';
import { LIBELLES } from './status.js';

export const FORMAT = 'vault-read';
export const VERSION = 1;

/*
 * Formats acceptés À LA RESTAURATION. « suivi-lecture » est l'ancien nom du
 * format, écrit par les versions publiées sous le nom « Suivi Lecture » : on
 * continue de l'accepter pour ne jamais rendre une sauvegarde existante
 * illisible après le renommage. Les nouvelles sauvegardes s'écrivent en FORMAT.
 */
const FORMATS_ACCEPTES = [FORMAT, 'suivi-lecture'];

/** Construit l'objet de sauvegarde complet d'un profil. */
export async function construireSauvegarde(profil) {
  const donnees = await store.exporterProfil(profil.id);
  return {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    profile: { id: profil.id, name: profil.name },
    oeuvres: donnees.oeuvres,
    editions: donnees.editions,
    listes: donnees.listes,
  };
}

/*
 * Valide avant tout le reste. Refuse une version SUPÉRIEURE à la sienne : un
 * fichier écrit par une version future contient des champs qu'on ne saurait
 * pas replacer, et l'importer silencieusement perdrait des données.
 */
export function validerSauvegarde(brut) {
  let donnees;
  try {
    donnees = JSON.parse(brut);
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde lisible.');
  }

  if (!donnees || !FORMATS_ACCEPTES.includes(donnees.format)) {
    throw new Error('Ce fichier n’est pas une sauvegarde de Vault Read.');
  }
  if (typeof donnees.version !== 'number' || donnees.version > VERSION) {
    throw new Error(
      `Cette sauvegarde vient d’une version plus récente de l’application (v${donnees.version}). Mets l’application à jour avant de la restaurer.`,
    );
  }
  if (!donnees.profile || !donnees.profile.id || !Array.isArray(donnees.oeuvres)) {
    throw new Error('Cette sauvegarde est incomplète : elle ne contient pas de profil lisible.');
  }

  return donnees;
}

/*
 * Décrit le contenu EN CLAIR avant d'écraser quoi que ce soit.
 * L'utilisateur doit pouvoir reconnaître sa propre sauvegarde — ou s'apercevoir
 * qu'il s'apprête à restaurer la mauvaise.
 */
export function decrireSauvegarde(donnees) {
  const parStatut = {};
  donnees.oeuvres.forEach((o) => {
    parStatut[o.statut] = (parStatut[o.statut] || 0) + 1;
  });

  const date = donnees.exportedAt
    ? new Date(donnees.exportedAt).toLocaleString('fr-FR')
    : 'date inconnue';

  return {
    profil: donnees.profile.name,
    date,
    oeuvres: donnees.oeuvres.length,
    editions: (donnees.editions || []).length,
    listes: (donnees.listes || []).length,
    repartition: Object.entries(parStatut)
      .map(([s, n]) => `${n} ${LIBELLES[s] ? LIBELLES[s].toLowerCase() : s}`)
      .join(' · '),
  };
}

/** Restaure. À n'appeler qu'APRÈS confirmation explicite de l'utilisateur. */
export async function restaurer(donnees) {
  const resultat = await store.importerProfil(donnees.profile, {
    oeuvres: donnees.oeuvres,
    editions: donnees.editions || [],
    listes: donnees.listes || [],
  });
  return { profileId: donnees.profile.id, ...resultat };
}

// ---------------------------------------------------------------------------
// Export CSV Goodreads (§3.6)
// ---------------------------------------------------------------------------

const ETAGERES = {
  a_lire: 'to-read',
  en_cours: 'currently-reading',
  lu: 'read',
  // Goodreads n'a pas d'équivalent d'« abandonné » : on écrit une étagère
  // personnalisée plutôt que de faire passer le livre pour lu.
  abandonne: 'abandoned',
};

const echapper = (valeur) => {
  const t = valeur === null || valeur === undefined ? '' : String(valeur);
  return `"${t.replace(/"/g, '""')}"`;
};

/**
 * Colonnes imposées par Goodreads (§3.6).
 * @returns {{csv: string, ecartes: string[]}} ce qui sort, et ce qui ne sort pas
 */
export function versCsvGoodreads(sauvegarde) {
  // L'ISBN vient de l'ÉDITION ACTIVE : c'est l'exemplaire que l'utilisateur
  // lit, et le seul que Goodreads saura retrouver.
  const parCle = new Map((sauvegarde.editions || []).map((e) => [e.editionId, e]));

  const entetes = ['Title', 'Author', 'ISBN', 'My Rating', 'Date Read', 'Bookshelves'];
  const lignes = [entetes.join(',')];

  sauvegarde.oeuvres.forEach((o) => {
    const edition = parCle.get(o.editionActive) || {};
    lignes.push([
      echapper(o.titre),
      echapper((o.auteurs || '').split(',')[0].trim()),
      /*
       * Goodreads écrit lui-même l'ISBN sous la forme ="978…" dans ses
       * exports, pour qu'un tableur ne le transforme pas en nombre et n'en
       * perde pas le zéro initial. On donne la valeur BRUTE `="978…"` à
       * `echapper`, qui pose les guillemets CSV — les écrire à la main ici les
       * doublait une seconde fois et produisait `=""""978…""""`.
       */
      echapper(edition.isbn13 || edition.isbn10 ? `="${edition.isbn13 || edition.isbn10}"` : ''),
      echapper(o.note || ''),
      echapper(o.termineLe ? String(o.termineLe).slice(0, 10) : ''),
      echapper(ETAGERES[o.statut] || ''),
    ].join(','));
  });

  return {
    csv: lignes.join('\r\n'),
    ecartes: [
      'les résumés',
      'les couvertures',
      'les éditions autres que l’édition active',
      'les cycles et numéros de tome',
      'la progression de lecture',
      'les listes personnalisées',
    ],
  };
}
