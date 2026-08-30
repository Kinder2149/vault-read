/*
 * statistiques.js — ce que dit une bibliotheque quand on la regarde de loin.
 *
 * Fonctions PURES : aucun reseau, aucune base, aucun rendu. Elles recoivent la
 * bibliotheque telle que `api.getBibliotheque()` la rend, plus les gains de
 * lecture tels que `store.rythmeDepuis()` les rend, et n'en demandent pas
 * plus — c'est ce qui les rend verifiables sans monter d'ecran ni de moteur
 * SQL. Meme regle que `tomes.js`, pour la meme raison.
 *
 * REGLE DE FOND, valable partout ici : ON NE COMPTE QUE CE QU'ON MESURE.
 * Le projet ne stocke aucune duree de session — seulement des positions a une
 * date. Il n'y a donc ni « temps de lecture », ni « vitesse », ni estimation
 * de l'un par l'autre : ce seraient des chiffres inventes affiches avec
 * autorite, et c'est exactement ce qu'une page de statistiques ne doit pas
 * faire. On compte des pages, des minutes et des livres, qui existent.
 */

import { estEnAttenteDeParution } from './status.js';

/*
 * PAGES ET MINUTES NE S'ADDITIONNENT PAS. Un livre audio se suit en minutes,
 * un livre papier en pages (§5.3) : les cumuler donnerait un nombre qui ne
 * veut rien dire. On rend donc deux totaux, et l'ecran n'affiche le second
 * que s'il existe.
 */
const UNITE_AUDIO = 'audio';

/*
 * Un livre dont la pagination est inconnue porte un POURCENTAGE dans
 * `position` (§5.4). Son « gain » est donc en points de pourcentage, pas en
 * pages : le compter reviendrait a ajouter 30 pages a quelqu'un qui a avance
 * de 30 % dans un livre de 800. On l'ecarte du total.
 */
function metriqueConnue(oeuvre) {
  const total = (oeuvre.format === UNITE_AUDIO)
    ? Number(oeuvre.dureeMinutes) || 0
    : Number(oeuvre.nbPages) || 0;
  return total > 0;
}

/**
 * Ce qui a ete lu sur une periode, a partir des gains par oeuvre.
 *
 * @param {Array} bibliotheque ce que rend api.getBibliotheque()
 * @param {Map<string, number>} gains oeuvreId -> gain, tel que rythmeDepuis
 * @returns {{pages: number, minutes: number}}
 */
export function volumeLu(bibliotheque, gains) {
  let pages = 0;
  let minutes = 0;
  (bibliotheque || []).forEach((o) => {
    const gain = Number(gains?.get?.(o.oeuvreId)) || 0;
    if (gain <= 0 || !metriqueConnue(o)) return;
    if (o.format === UNITE_AUDIO) minutes += gain;
    else pages += gain;
  });
  return { pages, minutes };
}

/*
 * Le mois d'une date, en 'YYYY-MM'. Decoupe de chaine plutot que `new Date()`
 * : `termine_le` est ecrit par SQLite en heure LOCALE (§3.3), et le relire par
 * un Date puis en extraire le mois le ferait basculer d'un mois les livres
 * termines le 1er au soir. Le meme piege que toISOString(), au mois pres.
 */
function moisDe(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Les `nb` derniers mois, du plus ancien au plus recent, en 'YYYY-MM'. */
export function derniersMois(nb, aujourdhui = new Date()) {
  const mois = [];
  for (let i = nb - 1; i >= 0; i -= 1) {
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth() - i, 1);
    mois.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return mois;
}

/**
 * Livres termines par mois, sur les douze derniers.
 * Un mois sans lecture vaut 0 et RESTE dans la liste : un histogramme troue
 * mentirait sur le rythme.
 *
 * @returns {Array<{mois: string, nombre: number}>} du plus ancien au plus recent
 */
export function livresParMois(bibliotheque, nb = 12, aujourdhui = new Date()) {
  const compte = new Map(derniersMois(nb, aujourdhui).map((m) => [m, 0]));
  (bibliotheque || []).forEach((o) => {
    if (o.statut !== 'lu') return;
    const m = moisDe(o.termineLe);
    if (m !== null && compte.has(m)) compte.set(m, compte.get(m) + 1);
  });
  return [...compte.entries()].map(([mois, nombre]) => ({ mois, nombre }));
}

/**
 * Repartition par statut et par format.
 * Les livres pas encore parus sont ECARTES des statuts, exactement comme dans
 * la bibliotheque (§5.2) : sans cela les compteurs de l'ecran et ceux des
 * statistiques, sur la meme page, ne diraient pas la meme chose.
 */
export function repartition(bibliotheque) {
  const parus = (bibliotheque || []).filter((o) => !estEnAttenteDeParution(o));
  const statuts = {};
  const formats = {};
  parus.forEach((o) => {
    statuts[o.statut] = (statuts[o.statut] || 0) + 1;
    const f = o.format || 'papier';
    formats[f] = (formats[f] || 0) + 1;
  });
  return { statuts, formats, total: parus.length };
}

/**
 * Ce que le profil a note.
 * La moyenne ne porte QUE sur les livres notes : compter les autres pour zero
 * ferait baisser la moyenne a chaque livre ajoute, ce qui n'a aucun sens.
 * @returns {{moyenne: number|null, notes: number, avis: number}}
 */
export function notation(bibliotheque) {
  const notes = (bibliotheque || [])
    .map((o) => Number(o.note))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avis = (bibliotheque || [])
    .filter((o) => String(o.commentaire || '').trim().length > 0).length;

  if (notes.length === 0) return { moyenne: null, notes: 0, avis };
  const somme = notes.reduce((a, b) => a + b, 0);
  return { moyenne: Math.round((somme / notes.length) * 10) / 10, notes: notes.length, avis };
}

/*
 * Le nombre de jours entre deux dates 'YYYY-MM-DD…'. Decoupe de chaine puis
 * Date.UTC : construire deux dates LOCALES et les soustraire fait apparaitre
 * des ecarts d'une heure aux changements d'heure d'ete, donc parfois un jour
 * de plus ou de moins sur un long roman.
 */
function joursEntre(debut, fin) {
  const lire = (d) => {
    const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const a = lire(debut);
  const b = lire(fin);
  if (a === null || b === null || b < a) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Deux faits d'armes : le plus gros livre termine, et le plus vite lu.
 *
 * « Le plus vite lu » ne se calcule que sur les livres qui portent A LA FOIS
 * une date de debut, une date de fin et une pagination. C'est peu de livres,
 * et c'est voulu : mieux vaut ne rien afficher que classer un livre commence
 * avant que l'application n'existe.
 *
 * Un livre lu en zero jour est ECARTE — c'est un livre ajoute deja lu, marque
 * en une fois, pas une performance de lecture. Il gagnerait toujours.
 *
 * @returns {{plusGros: object|null, plusRapide: {oeuvre: object, jours: number, parJour: number}|null}}
 */
export function faitsDArmes(bibliotheque) {
  const lus = (bibliotheque || []).filter((o) => o.statut === 'lu');

  let plusGros = null;
  let plusRapide = null;

  lus.forEach((o) => {
    const pages = Number(o.nbPages) || 0;
    if (pages > 0 && (!plusGros || pages > Number(plusGros.nbPages))) plusGros = o;

    if (pages <= 0) return;
    const jours = joursEntre(o.commenceLe, o.termineLe);
    if (jours === null || jours < 1) return;
    const parJour = pages / jours;
    if (!plusRapide || parJour > plusRapide.parJour) {
      plusRapide = { oeuvre: o, jours, parJour: Math.round(parJour) };
    }
  });

  return { plusGros, plusRapide };
}
