/*
 * api.js — LA FAÇADE (§2.1). Seul point de contact entre les écrans et le reste.
 * Toutes les fonctions sont `async` dès le premier jour, même quand elles ne
 * font rien d'asynchrone : c'est ce qui a permis au projet séries de supprimer
 * un serveur Express entier sans toucher un seul écran.
 * Applique §2 règle 5 : c'est ici, et nulle part ailleurs, qu'on enchaîne le
 * réseau (books.js) et la base (store.js). On enchaîne, on ne décide pas.
 * Applique §2.1 : chaque fonction injecte elle-même le profil actif — aucun
 * écran ne manipule jamais un identifiant de profil.
 */

import { initDb, query } from './db.js';
import * as store from './store.js';
import * as books from './books.js';
import { aujourdhui, progressionDe } from './status.js';
import { volumeLu } from './statistiques.js';
import * as scanner from './scanner.js';
import { appelsDuJour, QUOTA_QUOTIDIEN } from './sources/google.js';

/** @typedef {import('./types.js').ResultatRecherche} ResultatRecherche */
/** @typedef {import('./types.js').Identite} Identite */
/** @typedef {import('./types.js').Oeuvre} Oeuvre */

const CLE_PROFIL = 'activeProfileId';

/** Ouvre la base, applique les migrations, garantit un profil. Idempotent. */
export async function demarrer() {
  return initDb();
}

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

export async function listProfiles() {
  return store.listProfiles();
}

/*
 * Le profil actif est mémorisé en localStorage. Si l'identifiant mémorisé
 * n'existe plus en base — profil supprimé, restauration —, on retombe sur le
 * premier profil plutôt que d'écrire dans le vide.
 */
export async function getActiveProfileId() {
  const profils = await store.listProfiles();
  if (profils.length === 0) return null;

  const memorise = localStorage.getItem(CLE_PROFIL);
  const existe = profils.some((p) => p.id === memorise);
  if (existe) return memorise;

  localStorage.setItem(CLE_PROFIL, profils[0].id);
  return profils[0].id;
}

/** Le profil actif complet — la sauvegarde a besoin de son nom ET de son id. */
export async function getProfilActif() {
  const id = await getActiveProfileId();
  const profils = await store.listProfiles();
  return profils.find((p) => p.id === id) || null;
}

export async function setActiveProfileId(id) {
  localStorage.setItem(CLE_PROFIL, id);
  return id;
}

export async function createProfile(name) {
  return store.createProfile(name);
}

export async function renameProfile(id, name) {
  return store.renameProfile(id, name);
}

export async function deleteProfile(id) {
  return store.deleteProfile(id);
}

// ---------------------------------------------------------------------------
// Catalogue (lecture seule, réseau)
// ---------------------------------------------------------------------------

/**
 * Signature FIGEE de §2.1 : elle rend un tableau, et continue de le faire.
 * @param {string} texte
 * @param {'titre'|'auteur'|'isbn'} mode
 * @returns {Promise<ResultatRecherche[]>}
 */
export async function rechercher(texte, mode) {
  const { resultats } = await books.rechercher(texte, mode);
  return resultats;
}

/*
 * §2.1 s'enrichit, ne se modifie pas — meme regle qu'en tranche 6 pour
 * `creerOeuvreManuelle`. L'ecran de recherche a besoin de savoir si ce qu'il
 * affiche vient du reseau ou de l'archive, pour le DIRE ; la fiche de detail,
 * qui cherche une edition a rattacher, n'en a que faire et garde la forme
 * simple ci-dessus.
 * @returns {Promise<{resultats: ResultatRecherche[], ancien: boolean, pose: number|null}>}
 */
export async function rechercherAvecEtat(texte, mode, page = 0, auteur = '') {
  return books.rechercher(texte, mode, page, auteur);
}

/*
 * §2.1 s'enrichit : regrouper les doublons d'une liste deja affichee.
 * L'ecran en a besoin quand il AJOUTE une page a ce qu'il montre — la
 * meilleure fiche d'un livre peut arriver en page 2 alors que la pauvre est
 * deja a l'ecran. `async` comme tout le reste de la facade, meme si le calcul
 * est immediat : c'est la regle de ce fichier, et elle a deja evite une
 * reecriture d'ecran une fois.
 */
export async function fusionnerResultats(liste, texte) {
  return books.fusionnerDoublons(liste, texte);
}

/* Les dernieres recherches, pour les reproposer (retour d'usage 100). */
export async function getHistoriqueRecherches() {
  return books.historiqueRecherches();
}

export async function effacerHistoriqueRecherches() {
  return books.oublierHistorique();
}

/*
 * Vide le cache de recherche (M2). Ne touche NI la bibliotheque, NI
 * l'historique : c'est tout l'interet du bouton. Vider les donnees de
 * l'application depuis Android aurait emporte les livres avec.
 * @returns {Promise<number>} combien de recherches archivees ont ete jetees
 */
export async function viderCacheRecherche() {
  return books.viderCacheRecherche();
}

/**
 * Résout l'identité d'œuvre d'un résultat et complète son résumé.
 * @returns {Promise<{identite: Identite, resultat: ResultatRecherche}>}
 */
export async function identifierResultat(resultat) {
  const identite = await books.identifier(resultat);
  const complete = await books.completer(resultat, identite);
  return { identite, resultat: complete };
}

// ---------------------------------------------------------------------------
// Bibliothèque
// ---------------------------------------------------------------------------

/** @returns {Promise<Oeuvre[]>} toutes les œuvres du profil + édition active */
export async function getBibliotheque() {
  return store.getBibliotheque(await getActiveProfileId());
}

export async function getOeuvre(oeuvreId) {
  return store.getOeuvre(await getActiveProfileId(), oeuvreId);
}

/*
 * Le seul enchaînement réseau + base de la tranche 2, et la raison d'être de
 * la règle 5 de §2 : books.js identifie, store.js écrit, en une transaction.
 * §9 : ajouter un livre ne pose JAMAIS de question — pas de pagination
 * demandée ici, elle n'arrivera qu'à la première saisie de progression.
 */
export async function ajouterOeuvre(resultat) {
  const profileId = await getActiveProfileId();

  /*
   * L'AJOUT N'ATTEND PLUS LE RESEAU. Mesure du 2026-08-20 : l'ecriture en base
   * prend 4 ms, mais la resolution d'identite chez Open Library prend de 1,3 a
   * 12 s selon l'humeur de la source — c'etait TOUTE la latence ressentie.
   * On entre donc avec ce qu'on sait deja : l'identite si elle est en cache,
   * l'empreinte locale sinon. Puis on promeut en tache de fond.
   * §4.3 le disait deja : « la resolution ne bloque jamais l'ajout ».
   */
  const identite = books.identiteConnue(resultat.cleSource) || books.identiteImmediate(resultat);
  const oeuvreId = await store.ajouterOeuvre(profileId, resultat, identite);

  if (!identite.resolue) promouvoirEnTacheDeFond(profileId, oeuvreId, resultat);
  return oeuvreId;
}

/*
 * Reprend l'identification apres coup, avec tout le temps qu'il faut, et
 * corrige la cle de l'oeuvre si Open Library finit par repondre. L'utilisateur
 * ne voit rien, sinon le badge « identification incomplete » qui disparait.
 * Volontairement non attendue : c'est un `void`, pas une promesse rendue.
 */
function promouvoirEnTacheDeFond(profileId, ancienneCle, resultat) {
  const BUDGET_LONG_MS = 15000;
  books.identifier(resultat, BUDGET_LONG_MS)
    .then(async (identite) => {
      if (!identite.resolue || identite.oeuvreId === ancienneCle) return;
      const change = await store.promouvoirIdentite(profileId, ancienneCle, identite.oeuvreId, {
        cycleNom: identite.cycleNom,
        cycleTome: identite.cycleTome,
      });
      if (change) previenirChangement();
    })
    .catch(() => { /* la source n'a pas repondu : l'empreinte locale reste, c'est valide */ });
}

/*
 * Canal minimal pour dire a l'ecran « la bibliotheque a change sous tes
 * pieds ». Une fonction, pas un evenement global : l'application n'a qu'un
 * seul abonne, le composant racine.
 */
let abonneChangement = null;
export function surChangementDeFond(fn) { abonneChangement = fn; }
function previenirChangement() { if (abonneChangement) abonneChangement(); }

/*
 * Cree un livre a la main, quand aucune source ne le connait (§3.2). Mesure :
 * sur huit ISBN francais testes, trois sont absents des DEUX catalogues.
 */
export async function creerOeuvreManuelle(saisie) {
  const profileId = await getActiveProfileId();
  const titre = String(saisie.titre || '').trim();
  if (!titre) throw new Error('Donne au moins un titre.');
  const empreinte = books.empreinteOeuvre(titre, [saisie.auteurs || '']);
  return store.creerOeuvreManuelle(profileId, { ...saisie, titre }, empreinte);
}

export async function retirerOeuvre(oeuvreId) {
  return store.retirerOeuvre(await getActiveProfileId(), oeuvreId);
}

export async function setStatut(oeuvreId, statut) {
  return store.setStatut(await getActiveProfileId(), oeuvreId, statut, aujourdhui());
}

/* §2.1 s'enrichit : couverture choisie a la main (retour d'usage 84). */
export async function setCouverture(oeuvreId, dataUrl) {
  return store.setCouverture(await getActiveProfileId(), oeuvreId, dataUrl);
}

/*
 * Mon avis sur ce livre : une note et un commentaire, portes par l'OEUVRE.
 * Ce qu'on pense d'un texte ne change pas parce qu'on l'a lu en poche plutot
 * qu'en grand format (retour d'usage 112).
 */
export async function setAvis(oeuvreId, note, commentaire) {
  return store.setAvis(await getActiveProfileId(), oeuvreId, note, commentaire);
}

export async function setNote(oeuvreId, note) {
  return store.setNote(await getActiveProfileId(), oeuvreId, note);
}

// ---------------------------------------------------------------------------
// Éditions
// ---------------------------------------------------------------------------

export async function getEditions(oeuvreId) {
  return store.getEditions(await getActiveProfileId(), oeuvreId);
}

/*
 * Les editions de ce texte qu'on pourrait posseder, MOINS celles deja suivies
 * (§3.1). A la demande, jamais au chargement de la fiche : une recherche
 * d'editions coute une requete, et toutes les fiches ne s'ouvrent pas pour
 * cela.
 */
export async function getEditionsProposees(oeuvreId) {
  const profileId = await getActiveProfileId();
  const oeuvre = await store.getOeuvre(profileId, oeuvreId);
  if (!oeuvre) return [];

  const premierAuteur = String(oeuvre.auteurs || '').split(',')[0].trim();
  const proposees = await books.editionsDe(oeuvre.titre, premierAuteur);

  // Ce qu'on possede deja ne se propose pas une seconde fois.
  const deja = new Set((await store.getEditions(profileId, oeuvreId)).map((e) => e.editionId));
  const dejaIsbn = new Set(
    (await store.getEditions(profileId, oeuvreId)).map((e) => e.isbn13).filter(Boolean),
  );
  return proposees.filter((p) => !deja.has(p.cleSource) && !(p.isbn13 && dejaIsbn.has(p.isbn13)));
}

export async function ajouterEdition(oeuvreId, resultat) {
  return store.ajouterEdition(await getActiveProfileId(), oeuvreId, resultat);
}

export async function setEditionActive(oeuvreId, editionId) {
  return store.setEditionActive(await getActiveProfileId(), oeuvreId, editionId);
}

export async function supprimerEdition(editionId) {
  return store.supprimerEdition(await getActiveProfileId(), editionId);
}

export async function setMetrique(editionId, metriques) {
  return store.setMetrique(await getActiveProfileId(), editionId, metriques);
}

/* §5.5 — l'edition audio n'est jamais issue d'une source, elle est saisie. */
export async function ajouterEditionManuelle(oeuvreId, saisie) {
  return store.ajouterEditionManuelle(await getActiveProfileId(), oeuvreId, saisie);
}

// ---------------------------------------------------------------------------
// Progression (§5.3) — local, sans reseau
// ---------------------------------------------------------------------------

/*
 * Ecrit la position ET la trace du jour (migration v2). Les deux ensemble :
 * c'est ce qui permet de dire « tu as lu N pages cette semaine » sans tenir
 * d'historique de lectures anterieures (§5.2).
 */
export async function setPosition(oeuvreId, position) {
  const profileId = await getActiveProfileId();
  await store.setPosition(profileId, oeuvreId, position);
  return store.enregistrerSession(profileId, oeuvreId, aujourdhui(), position);
}

/** Pages ou minutes gagnees sur les 7 derniers jours, par oeuvre. */
/* 'YYYY-MM-DD' en heure LOCALE, comme partout dans le projet (§3.3). */
function enDate(d) {
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mois}-${jour}`;
}

async function gainsDepuis(profileId, depuis) {
  const lignes = await store.rythmeDepuis(profileId, depuis);
  return new Map(lignes.map((l) => [l.oeuvreId, Number(l.gain) || 0]));
}

export async function getRythmeSemaine() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return gainsDepuis(await getActiveProfileId(), enDate(d));
}

/*
 * Ce qui a ete lu sur trois fenetres (mission V2, M2). Trois lectures d'une
 * table locale : aucun appel reseau, rien a mettre en cache.
 *
 * Le compte lui-meme vit dans `store.rythmeDepuis` — UN SEUL domicile, deja
 * utilise par « Ma lecture ». On ne recompte rien ici : ecrire un second
 * calcul, meme meilleur, ferait afficher deux chiffres differents pour la
 * meme semaine sur deux ecrans voisins. Le defaut trouve en construisant cet
 * ecran — la toute premiere saisie d'un livre ne comptait jamais — a donc ete
 * corrige la-bas, pas ici.
 */
export async function getVolumeLu() {
  const profileId = await getActiveProfileId();
  const bibliotheque = await store.getBibliotheque(profileId);

  const ilYa = (jours) => { const d = new Date(); d.setDate(d.getDate() - jours); return enDate(d); };
  const premierJanvier = `${new Date().getFullYear()}-01-01`;

  const [semaine, mois, annee] = await Promise.all([
    gainsDepuis(profileId, ilYa(7)),
    gainsDepuis(profileId, ilYa(30)),
    gainsDepuis(profileId, premierJanvier),
  ]);

  return {
    semaine: volumeLu(bibliotheque, semaine),
    mois: volumeLu(bibliotheque, mois),
    annee: volumeLu(bibliotheque, annee),
  };
}

/* Une soustraction, pas un appel. Rend l'unite deduite du format actif. */
export async function getProgression(oeuvreId) {
  const oeuvre = await store.getOeuvre(await getActiveProfileId(), oeuvreId);
  return oeuvre ? progressionDe(oeuvre) : null;
}

// ---------------------------------------------------------------------------
// Listes (§2.1)
// ---------------------------------------------------------------------------

export async function getListes() {
  return store.getListes(await getActiveProfileId());
}

export async function createListe(name) {
  return store.createListe(await getActiveProfileId(), name);
}

export async function deleteListe(id) {
  return store.deleteListe(await getActiveProfileId(), id);
}

export async function getListeItems(id) {
  return store.getListeItems(await getActiveProfileId(), id);
}

/*
 * Regle heritee du projet series : AJOUTER A UNE LISTE IMPLIQUE DE SUIVRE.
 * La cle etrangere composite l'impose de toute facon — un item de liste ne
 * peut pas exister sans son oeuvre (§3.3). Ici l'oeuvre est deja suivie, la
 * regle se lit donc comme une garantie plutot que comme une action.
 */
export async function addToListe(listeId, oeuvreId) {
  const profileId = await getActiveProfileId();
  const oeuvre = await store.getOeuvre(profileId, oeuvreId);
  if (!oeuvre) throw new Error('Ce livre doit d’abord être dans ta bibliothèque.');
  return store.addToListe(profileId, listeId, oeuvreId);
}

export async function removeFromListe(listeId, oeuvreId) {
  return store.removeFromListe(await getActiveProfileId(), listeId, oeuvreId);
}

export async function getListesDeLOeuvre(oeuvreId) {
  return store.listesDeLOeuvre(await getActiveProfileId(), oeuvreId);
}

// ---------------------------------------------------------------------------
// Suggestions (§4.6) — calculees A LA DEMANDE, jamais au demarrage (quota)
// ---------------------------------------------------------------------------

export async function getSuggestions() {
  const profileId = await getActiveProfileId();
  const bibliotheque = await store.getBibliotheque(profileId);

  /*
   * GRAINES — corrige apres le retour d'usage 104 : « j'ai deja ajoute 10
   * livres et rien ne s'affiche ».
   *
   * La version precedente n'acceptait que les livres « lu » ou « en cours ».
   * Or un livre ajoute entre en « a lire » : ajouter dix livres donnait donc
   * ZERO graine, et l'ecran restait desesperement vide sans que rien ne
   * l'explique. Le message « marque des livres comme lus ou en cours »
   * demandait un travail que personne n'a envie de faire pour obtenir des
   * suggestions.
   *
   * Un livre range dans « a lire » exprime un gout aussi clairement qu'un
   * livre termine — c'est meme le signal le plus frais. On les prend donc
   * TOUS, en mettant simplement devant ceux qu'on a lus ou commences.
   */
  const rang = { lu: 0, en_cours: 1, a_lire: 2, abandonne: 3 };
  const graines = [...bibliotheque]
    .sort((a, b) => (rang[a.statut] ?? 9) - (rang[b.statut] ?? 9))
    .slice(0, 12);

  if (graines.length === 0) return [];

  // Cycles entames dont le tome suivant n'est pas deja possede.
  const plusHaut = new Map();
  const possedes = new Set();
  bibliotheque.forEach((o) => {
    if (!o.cycleNom || !o.cycleTome) return;
    possedes.add(`${o.cycleNom}#${o.cycleTome}`);
    if (o.statut !== 'lu' && o.statut !== 'en_cours') return;
    plusHaut.set(o.cycleNom, Math.max(plusHaut.get(o.cycleNom) || 0, o.cycleTome));
  });
  const cycles = [...plusHaut.entries()]
    .map(([nom, tome]) => ({ nom, tomeSuivant: tome + 1 }))
    .filter((c) => !possedes.has(`${c.nom}#${c.tomeSuivant}`));

  const exclusions = {
    empreintes: new Set(bibliotheque.map((o) => books.empreinteOeuvre(o.titre, o.auteurs))),
    isbn: new Set(bibliotheque.map((o) => o.isbn13).filter(Boolean)),
  };

  /*
   * La cle de cache est l'empreinte des GRAINES, pas du profil : c'est ce qui
   * fait qu'un livre marque « lu » invalide les suggestions de lui-meme, sans
   * qu'aucun ecran ait a y penser.
   */
  const cleCache = `${profileId}|${graines.map((g) => g.oeuvreId).join(',')}`;
  return books.suggestions(graines, cycles, exclusions, cleCache);
}

// ---------------------------------------------------------------------------
// Scan de code-barres (tranche 7)
// ---------------------------------------------------------------------------

/* Le bouton de scan ne s'affiche que la ou le scan existe. */
export async function scanDisponible() {
  return scanner.scanDisponible();
}

export async function scannerIsbn() {
  return scanner.scannerIsbn();
}

// ---------------------------------------------------------------------------
// Identité (§3.2)
// ---------------------------------------------------------------------------

export async function regrouperOeuvres(sourceId, cibleId) {
  return store.regrouperOeuvres(await getActiveProfileId(), sourceId, cibleId);
}

export async function detacherEdition(editionId) {
  return store.detacherEdition(await getActiveProfileId(), editionId);
}

// ---------------------------------------------------------------------------
// Cycles (§4.4)
// ---------------------------------------------------------------------------

export async function setCycle(oeuvreId, nom, tome) {
  return store.setCycle(await getActiveProfileId(), oeuvreId, nom, tome);
}

export async function listCycles() {
  return store.listCycles(await getActiveProfileId());
}

/** Sert au Modal de retrait, qui doit dire combien d'éditions partent (§6). */
export async function compterEditions(oeuvreId) {
  return store.compterEditions(await getActiveProfileId(), oeuvreId);
}

/** Clés d'édition déjà suivies, pour marquer les cartes de recherche. */
export async function getClesEditions() {
  return store.listerClesEditions(await getActiveProfileId());
}

// ---------------------------------------------------------------------------
// Diagnostic (écran Réglages)
// ---------------------------------------------------------------------------

/* §2.1 s'enrichit : etat du quota Google du jour, pour l'ecran Reglages. */
export async function quotaDuJour() {
  const utilises = appelsDuJour();
  return { utilises, total: QUOTA_QUOTIDIEN, restants: Math.max(0, QUOTA_QUOTIDIEN - utilises) };
}

export async function etatBase() {
  const { plateforme, migration, profil } = await initDb();
  const tables = await query(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  );
  // PRAGMA n'accepte pas d'alias de colonne : « PRAGMA foreign_keys AS v » est
  // une erreur de syntaxe, et sql.js la remonte sans message.
  const [{ foreign_keys: clesEtrangeres } = {}] = await query('PRAGMA foreign_keys;');
  return {
    plateforme,
    versionSchema: migration.a,
    migrationAppliquee: migration.de !== migration.a,
    clesEtrangeres: Number(clesEtrangeres) === 1,
    tables: tables.map((t) => t.name),
    profil,
  };
}
