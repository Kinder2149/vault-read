/*
 * store.js — métier et SQL. Ne connaît QUE db.js (§2) : il n'importe jamais
 * books.js ni une source, et ignore donc d'où vient une donnée.
 * Applique §2.3 : la conversion snake_case → camelCase se fait dans les alias
 * du SELECT, il n'existe aucune fonction de mapping.
 * Applique §3.3 : clé métier composite en clé primaire + INSERT OR IGNORE =
 * idempotence gratuite, aucun code de déduplication nulle part.
 * Piège évité : une œuvre n'existe JAMAIS sans au moins une édition, et
 * edition_active n'est jamais nul — les deux sont écrits dans la même
 * transaction (§9).
 */

import { query, run, runMany } from './db.js';

/** @typedef {import('./types.js').Oeuvre} Oeuvre */
/** @typedef {import('./types.js').Edition} Edition */

// ---------------------------------------------------------------------------
// Profils
// ---------------------------------------------------------------------------

export function listProfiles() {
  return query('SELECT id, name, created_at AS createdAt FROM profiles ORDER BY created_at;');
}

export async function createProfile(name) {
  const id = crypto.randomUUID();
  await run('INSERT INTO profiles (id, name) VALUES (?, ?);', [id, name]);
  return { id, name };
}

export function renameProfile(id, name) {
  return run('UPDATE profiles SET name = ? WHERE id = ?;', [name, id]);
}

export function deleteProfile(id) {
  // Les cascades emportent œuvres, éditions, listes et items (§6).
  return run('DELETE FROM profiles WHERE id = ?;', [id]);
}

// ---------------------------------------------------------------------------
// Bibliothèque
// ---------------------------------------------------------------------------

/*
 * L'œuvre porte le suivi, l'édition active porte les métriques (§3.1).
 * LEFT JOIN et non JOIN : une édition active manquante ne doit pas faire
 * disparaître l'œuvre de la bibliothèque — elle la rendrait invisible et
 * irrécupérable.
 */
const SELECT_BIBLIOTHEQUE = `
SELECT o.oeuvre_id        AS oeuvreId,
       o.titre            AS titre,
       o.auteurs          AS auteurs,
       o.annee            AS annee,
       o.date_publication AS datePublication,
       /*
        * LA COUVERTURE SUIT L'EDITION ACTIVE (retour d'usage 111 : « j'aimerais
        * que la pochette s'adapte si on l'a »). Changer d'edition changeait
        * bien la pagination, mais l'image restait celle de la premiere.
        *
        * L'ordre compte, et il applique §9 — « une donnee corrigee a la main
        * n'est jamais ecrasee par une lecture automatique » :
        *   1. une photo prise par l'utilisateur (data:) l'emporte TOUJOURS ;
        *   2. sinon la couverture de l'edition active, si elle en a une ;
        *   3. sinon celle de l'oeuvre.
        * Les editions venues de la BnF n'ont pas d'image : on retombe alors
        * sur celle de l'oeuvre, puis sur la couverture dessinee.
        */
       CASE
         WHEN o.couverture_url LIKE 'data:%' THEN o.couverture_url
         ELSE COALESCE(e.couverture_url, o.couverture_url)
       END                AS couvertureUrl,
       o.resume           AS resume,
       o.categories       AS categories,
       o.langue           AS langue,
       o.cycle_nom        AS cycleNom,
       o.cycle_tome       AS cycleTome,
       o.cycle_manuel     AS cycleManuel,
       o.statut           AS statut,
       o.note             AS note,
       o.commentaire      AS commentaire,
       o.position         AS position,
       o.edition_active   AS editionActive,
       o.ajoute_le        AS ajouteLe,
       o.commence_le      AS commenceLe,
       o.termine_le       AS termineLe,
       e.format           AS format,
       e.nb_pages         AS nbPages,
       e.duree_minutes    AS dureeMinutes,
       e.isbn13           AS isbn13,
       e.editeur          AS editeur
FROM oeuvres o
LEFT JOIN editions e
  ON e.profile_id = o.profile_id AND e.edition_id = o.edition_active
WHERE o.profile_id = ?
`;

export function getBibliotheque(profileId) {
  return query(`${SELECT_BIBLIOTHEQUE} ORDER BY o.ajoute_le DESC;`, [profileId]);
}

export async function getOeuvre(profileId, oeuvreId) {
  const lignes = await query(`${SELECT_BIBLIOTHEQUE} AND o.oeuvre_id = ?;`, [profileId, oeuvreId]);
  return lignes[0] || null;
}

/*
 * Crée l'œuvre ET sa première édition en UNE transaction (§9).
 * `resultat` vient d'un normaliseur, `identite` de books.js : store.js ne
 * fabrique aucun des deux, il les écrit.
 * INSERT OR IGNORE : ré-ajouter un livre déjà suivi ne fait rien et ne
 * réinitialise pas son statut.
 */
export async function ajouterOeuvre(profileId, resultat, identite) {
  const oeuvreId = identite.oeuvreId;
  const editionId = resultat.cleSource;
  const auteurs = resultat.auteurs.join(', ') || null;

  await runMany([
    {
      sql: `INSERT OR IGNORE INTO oeuvres
              (profile_id, oeuvre_id, titre, auteurs, annee, date_publication,
               couverture_url, resume, categories, langue, cycle_nom, cycle_tome)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        profileId, oeuvreId, resultat.titre, auteurs, resultat.annee,
        resultat.datePublication, identite.couvertureUrl || resultat.couvertureUrl,
        resultat.resume, resultat.categories.join(', ') || null, resultat.langue,
        identite.cycleNom, identite.cycleTome,
      ],
    },
    {
      sql: `INSERT OR IGNORE INTO editions
              (profile_id, edition_id, oeuvre_id, source, titre, auteurs, format,
               isbn13, isbn10, editeur, date_publication, nb_pages, couverture_url, langue)
            VALUES (?, ?, ?, ?, ?, ?, 'papier', ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        profileId, editionId, oeuvreId, resultat.source, resultat.titre, auteurs,
        resultat.isbn13, resultat.isbn10, resultat.editeur, resultat.datePublication,
        identite.nbPages || resultat.nbPages, resultat.couvertureUrl, resultat.langue,
      ],
    },
    {
      // edition_active n'est jamais nul (§9). IS NULL : on ne déplace pas
      // l'édition active d'une œuvre déjà suivie.
      sql: `UPDATE oeuvres SET edition_active = ?
            WHERE profile_id = ? AND oeuvre_id = ? AND edition_active IS NULL;`,
      params: [editionId, profileId, oeuvreId],
    },
  ]);

  return oeuvreId;
}

export function retirerOeuvre(profileId, oeuvreId) {
  // Éditions et appartenances aux listes partent en cascade (§6).
  return run('DELETE FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;', [profileId, oeuvreId]);
}

/*
 * Statut MANUEL (§5.2, écart majeur avec le projet séries où il est dérivé).
 * C'est ici, et nulle part ailleurs, que commence_le et termine_le sont écrits.
 * Relecture : repasser de `lu` à `en_cours` remet la position à zéro et efface
 * la date de fin — la V1 ne garde aucun historique, c'est assumé.
 */
export async function setStatut(profileId, oeuvreId, statut, jour) {
  const morceaux = ['statut = ?'];
  const params = [statut];

  if (statut === 'en_cours') {
    morceaux.push('commence_le = COALESCE(commence_le, ?)', 'termine_le = NULL');
    params.push(jour);
  } else if (statut === 'lu') {
    morceaux.push('termine_le = ?');
    params.push(jour);
  } else if (statut === 'a_lire') {
    morceaux.push('commence_le = NULL', 'termine_le = NULL', 'position = 0');
  }

  params.push(profileId, oeuvreId);
  return run(
    `UPDATE oeuvres SET ${morceaux.join(', ')} WHERE profile_id = ? AND oeuvre_id = ?;`,
    params,
  );
}

/*
 * Couverture choisie a la main (retour d'usage 84). Elle se range dans la MEME
 * colonne que celle des sources : rien en aval n'a besoin de savoir d'ou vient
 * une image, et §9 garantit deja qu'« une donnee corrigee a la main n'est
 * jamais ecrasee par une lecture automatique ».
 * Passer `null` remet la couverture d'origine a zero.
 */
export function setCouverture(profileId, oeuvreId, url) {
  return run(
    'UPDATE oeuvres SET couverture_url = ? WHERE profile_id = ? AND oeuvre_id = ?;',
    [url || null, profileId, oeuvreId],
  );
}

/*
 * MON AVIS : la note et le commentaire ensemble, en une seule ecriture.
 * Les deux se saisissent au meme endroit et se pensent ensemble — deux
 * ecritures separees feraient clignoter la fiche deux fois pour rien.
 * `null` efface : on a le droit de retirer une note qu'on regrette.
 */
export function setAvis(profileId, oeuvreId, note, commentaire) {
  const texte = String(commentaire || '').trim();
  return run(
    'UPDATE oeuvres SET note = ?, commentaire = ? WHERE profile_id = ? AND oeuvre_id = ?;',
    [note === null || note === undefined ? null : Number(note), texte || null, profileId, oeuvreId],
  );
}

export function setNote(profileId, oeuvreId, note) {
  return run(
    'UPDATE oeuvres SET note = ? WHERE profile_id = ? AND oeuvre_id = ?;',
    [note, profileId, oeuvreId],
  );
}

// ---------------------------------------------------------------------------
// Éditions
// ---------------------------------------------------------------------------

export function getEditions(profileId, oeuvreId) {
  return query(
    `SELECT edition_id       AS editionId,
            oeuvre_id        AS oeuvreId,
            source, titre, auteurs, format,
            isbn13, isbn10, editeur,
            date_publication AS datePublication,
            nb_pages         AS nbPages,
            duree_minutes    AS dureeMinutes,
            couverture_url   AS couvertureUrl,
            langue,
            ajoute_le        AS ajouteLe
     FROM editions
     WHERE profile_id = ? AND oeuvre_id = ?
     ORDER BY ajoute_le;`,
    [profileId, oeuvreId],
  );
}

/*
 * Toutes les clés d'édition du profil.
 * Sert à marquer « déjà suivi » sur une carte de RECHERCHE : à ce moment-là on
 * ne connaît pas encore l'identifiant d'œuvre — le résoudre demanderait un
 * appel Open Library par résultat, ce que §4.3 interdit pendant la frappe.
 * La clé d'édition, elle, est celle du résultat lui-même : la comparaison est
 * exacte et ne coûte rien.
 */
export async function listerClesEditions(profileId) {
  const lignes = await query(
    'SELECT edition_id AS editionId FROM editions WHERE profile_id = ?;',
    [profileId],
  );
  return lignes.map((l) => l.editionId);
}

/*
 * Ajoute une édition à une œuvre DÉJÀ suivie. L'œuvre n'est pas touchée : ses
 * métadonnées sont un cliché figé à l'ajout (§3.5), et une réédition ne change
 * pas le texte.
 */
export async function ajouterEdition(profileId, oeuvreId, resultat) {
  const auteurs = resultat.auteurs.join(', ') || null;
  await run(
    `INSERT OR IGNORE INTO editions
       (profile_id, edition_id, oeuvre_id, source, titre, auteurs, format,
        isbn13, isbn10, editeur, date_publication, nb_pages, couverture_url, langue)
     VALUES (?, ?, ?, ?, ?, ?, 'papier', ?, ?, ?, ?, ?, ?, ?);`,
    [
      profileId, resultat.cleSource, oeuvreId, resultat.source, resultat.titre, auteurs,
      resultat.isbn13, resultat.isbn10, resultat.editeur, resultat.datePublication,
      resultat.nbPages, resultat.couvertureUrl, resultat.langue,
    ],
  );
  return resultat.cleSource;
}

export function setEditionActive(profileId, oeuvreId, editionId) {
  return run(
    'UPDATE oeuvres SET edition_active = ? WHERE profile_id = ? AND oeuvre_id = ?;',
    [editionId, profileId, oeuvreId],
  );
}

/*
 * Supprime une édition. Deux refus, pas des précautions : une œuvre n'existe
 * jamais sans au moins une édition, et edition_active n'est jamais nul (§9).
 * Si l'édition supprimée était l'active, une autre prend sa place.
 */
export async function supprimerEdition(profileId, editionId) {
  const [edition] = await query(
    'SELECT oeuvre_id AS oeuvreId FROM editions WHERE profile_id = ? AND edition_id = ?;',
    [profileId, editionId],
  );
  if (!edition) throw new Error('Cette édition n’existe plus.');

  const restantes = await query(
    'SELECT edition_id AS editionId FROM editions WHERE profile_id = ? AND oeuvre_id = ? AND edition_id <> ?;',
    [profileId, edition.oeuvreId, editionId],
  );
  if (restantes.length === 0) {
    throw new Error('C’est la seule édition de ce livre. Retire le livre plutôt que son édition.');
  }

  await runMany([
    { sql: 'DELETE FROM editions WHERE profile_id = ? AND edition_id = ?;', params: [profileId, editionId] },
    {
      sql: `UPDATE oeuvres SET edition_active = ?
            WHERE profile_id = ? AND oeuvre_id = ? AND edition_active = ?;`,
      params: [restantes[0].editionId, profileId, edition.oeuvreId, editionId],
    },
  ]);
}

/*
 * Édition créée À LA MAIN — §5.5. Ni Google ni Open Library ne cataloguent
 * correctement les versions audio : une édition `audio` n'est jamais issue
 * d'une source, elle est saisie, avec sa durée en minutes. Aucun appel réseau
 * n'est tenté. Sert aussi à un exemplaire non catalogué ou à une VO absente.
 */
export async function ajouterEditionManuelle(profileId, oeuvreId, saisie) {
  const editionId = `manuel:${crypto.randomUUID()}`;
  await run(
    `INSERT INTO editions
       (profile_id, edition_id, oeuvre_id, source, titre, auteurs, format,
        editeur, nb_pages, duree_minutes)
     VALUES (?, ?, ?, 'manuel', ?, ?, ?, ?, ?, ?);`,
    [
      profileId, editionId, oeuvreId, saisie.titre, saisie.auteurs || null,
      saisie.format || 'papier', saisie.editeur || null,
      saisie.format === 'audio' ? null : (saisie.nbPages || null),
      saisie.format === 'audio' ? (saisie.dureeMinutes || null) : null,
    ],
  );
  return editionId;
}

/*
 * Position de lecture. §5.3 : aucun appel réseau, c'est une écriture d'entier.
 * L'unité est déduite du format de l'édition active (§9), jamais stockée.
 */
export function setPosition(profileId, oeuvreId, position) {
  return run(
    'UPDATE oeuvres SET position = ? WHERE profile_id = ? AND oeuvre_id = ?;',
    [Math.max(0, Math.round(Number(position) || 0)), profileId, oeuvreId],
  );
}

/** Métriques de l'édition : pages OU minutes, jamais les deux (§2.1). */
export function setMetrique(profileId, editionId, metriques) {
  const { nbPages = null, dureeMinutes = null } = metriques || {};
  return run(
    'UPDATE editions SET nb_pages = ?, duree_minutes = ? WHERE profile_id = ? AND edition_id = ?;',
    [nbPages, dureeMinutes, profileId, editionId],
  );
}

/*
 * PROMOTION D'IDENTITE — deplace une oeuvre d'une empreinte locale `fp:` vers
 * la cle Open Library `ol:` quand la resolution finit par aboutir.
 * C'est ce qui permet d'ajouter un livre INSTANTANEMENT, sans attendre une
 * source qui met parfois 8 secondes a repondre : on entre en `fp:`, et
 * l'identite se corrige toute seule ensuite.
 * Si la cle cible existe deja (le meme texte a ete ajoute par un autre chemin),
 * on ne cree pas de doublon : on fusionne, exactement comme un regroupement.
 */
export async function promouvoirIdentite(profileId, ancienneCle, nouvelleCle, complements = {}) {
  if (!ancienneCle || !nouvelleCle || ancienneCle === nouvelleCle) return false;

  const [source] = await query(
    'SELECT oeuvre_id AS oeuvreId FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;',
    [profileId, ancienneCle],
  );
  if (!source) return false;   // le livre a ete retire entre-temps

  const [cible] = await query(
    'SELECT oeuvre_id AS oeuvreId FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;',
    [profileId, nouvelleCle],
  );

  if (cible) {
    await regrouperOeuvres(profileId, ancienneCle, nouvelleCle);
    return true;
  }

  /*
   * Pas de UPDATE de la cle primaire : les editions et les items de liste la
   * referencent par cle etrangere composite. On recopie la ligne sous la
   * nouvelle cle, on deplace les enfants, on supprime l'ancienne — en UNE
   * transaction, sinon un echec a mi-chemin laisse des orphelins.
   */
  await runMany([
    {
      sql: `INSERT INTO oeuvres
              (profile_id, oeuvre_id, titre, auteurs, annee, date_publication,
               couverture_url, resume, categories, langue, cycle_nom, cycle_tome,
               cycle_manuel, statut, note, commentaire, position, edition_active,
               ajoute_le, commence_le, termine_le)
            SELECT profile_id, ?, titre, auteurs, annee, date_publication,
                   couverture_url, resume, categories, langue,
                   CASE WHEN cycle_manuel = 1 THEN cycle_nom ELSE COALESCE(?, cycle_nom) END,
                   CASE WHEN cycle_manuel = 1 THEN cycle_tome ELSE COALESCE(?, cycle_tome) END,
                   cycle_manuel, statut, note, commentaire, position, edition_active,
                   ajoute_le, commence_le, termine_le
            FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [nouvelleCle, complements.cycleNom || null, complements.cycleTome || null,
               profileId, ancienneCle],
    },
    {
      sql: 'UPDATE editions SET oeuvre_id = ? WHERE profile_id = ? AND oeuvre_id = ?;',
      params: [nouvelleCle, profileId, ancienneCle],
    },
    {
      sql: `INSERT OR IGNORE INTO liste_items (liste_id, profile_id, oeuvre_id, added_at)
            SELECT liste_id, profile_id, ?, added_at
            FROM liste_items WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [nouvelleCle, profileId, ancienneCle],
    },
    {
      sql: `INSERT OR IGNORE INTO sessions_lecture (profile_id, oeuvre_id, jour, position_fin)
            SELECT profile_id, ?, jour, position_fin
            FROM sessions_lecture WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [nouvelleCle, profileId, ancienneCle],
    },
    { sql: 'DELETE FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;', params: [profileId, ancienneCle] },
  ]);
  return true;
}

/*
 * Cree un livre A LA MAIN, sans aucune source. §3.2 prevoit l'empreinte locale
 * pour « les vieux fonds, l'autoedition et les livres non catalogues » — encore
 * fallait-il pouvoir en creer un. Mesure a l'appui : sur huit ISBN francais,
 * trois n'existent ni chez Google ni chez Open Library.
 */
export async function creerOeuvreManuelle(profileId, saisie, empreinte) {
  const editionId = `manuel:${crypto.randomUUID()}`;
  const auteurs = (saisie.auteurs || '').trim() || null;

  await runMany([
    {
      sql: `INSERT OR IGNORE INTO oeuvres
              (profile_id, oeuvre_id, titre, auteurs, annee, date_publication, edition_active)
            VALUES (?, ?, ?, ?, ?, ?, ?);`,
      params: [profileId, empreinte, saisie.titre, auteurs,
               saisie.annee || null, saisie.annee || null, editionId],
    },
    {
      sql: `INSERT INTO editions
              (profile_id, edition_id, oeuvre_id, source, titre, auteurs, format,
               isbn13, editeur, nb_pages, duree_minutes)
            VALUES (?, ?, ?, 'manuel', ?, ?, ?, ?, ?, ?, ?);`,
      params: [profileId, editionId, empreinte, saisie.titre, auteurs,
               saisie.format || 'papier', saisie.isbn13 || null, saisie.editeur || null,
               saisie.format === 'audio' ? null : (saisie.nbPages || null),
               saisie.format === 'audio' ? (saisie.dureeMinutes || null) : null],
    },
    {
      sql: `UPDATE oeuvres SET edition_active = COALESCE(edition_active, ?)
            WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [editionId, profileId, empreinte],
    },
  ]);
  return empreinte;
}

// ---------------------------------------------------------------------------
// Listes personnalisées (§2.1)
// ---------------------------------------------------------------------------

export function getListes(profileId) {
  return query(
    `SELECT l.id, l.name, l.created_at AS createdAt,
            (SELECT COUNT(*) FROM liste_items i WHERE i.liste_id = l.id) AS compte
     FROM listes l WHERE l.profile_id = ? ORDER BY l.name;`,
    [profileId],
  );
}

/*
 * UNIQUE (profile_id, name) au schéma : deux listes homonymes rendraient
 * l'export par nom non réversible (§3.6). On traduit l'échec SQL en message.
 */
export async function createListe(profileId, name) {
  const propre = String(name || '').trim();
  if (!propre) throw new Error('Donne un nom à cette liste.');
  try {
    await run('INSERT INTO listes (profile_id, name) VALUES (?, ?);', [profileId, propre]);
  } catch (e) {
    throw new Error(`Une liste « ${propre} » existe déjà.`);
  }
  return propre;
}

export function deleteListe(profileId, listeId) {
  // Les items partent en cascade ; les œuvres, elles, ne bougent pas.
  return run('DELETE FROM listes WHERE profile_id = ? AND id = ?;', [profileId, listeId]);
}

export function getListeItems(profileId, listeId) {
  return query(
    `${SELECT_BIBLIOTHEQUE} AND o.oeuvre_id IN
       (SELECT oeuvre_id FROM liste_items WHERE profile_id = ? AND liste_id = ?)
     ORDER BY o.titre;`,
    [profileId, profileId, listeId],
  );
}

export function addToListe(profileId, listeId, oeuvreId) {
  return run(
    'INSERT OR IGNORE INTO liste_items (liste_id, profile_id, oeuvre_id) VALUES (?, ?, ?);',
    [listeId, profileId, oeuvreId],
  );
}

export function removeFromListe(profileId, listeId, oeuvreId) {
  return run(
    'DELETE FROM liste_items WHERE liste_id = ? AND profile_id = ? AND oeuvre_id = ?;',
    [listeId, profileId, oeuvreId],
  );
}

/** Les listes auxquelles une œuvre appartient — pour cocher dans la fiche. */
export async function listesDeLOeuvre(profileId, oeuvreId) {
  const lignes = await query(
    'SELECT liste_id AS listeId FROM liste_items WHERE profile_id = ? AND oeuvre_id = ?;',
    [profileId, oeuvreId],
  );
  return lignes.map((l) => l.listeId);
}

// ---------------------------------------------------------------------------
// Sessions de lecture (migration v2)
// ---------------------------------------------------------------------------

export function enregistrerSession(profileId, oeuvreId, jour, positionFin) {
  return run(
    `INSERT OR REPLACE INTO sessions_lecture (profile_id, oeuvre_id, jour, position_fin)
     VALUES (?, ?, ?, ?);`,
    [profileId, oeuvreId, jour, Math.max(0, Math.round(Number(positionFin) || 0))],
  );
}

/*
 * Pages (ou minutes) gagnées depuis `depuis`. C'est une DIFFÉRENCE, jamais une
 * somme : une position saisie deux fois dans la fenêtre compterait double.
 *
 * LE POINT DE DÉPART EST CELUI D'AVANT LA FENÊTRE (mission V2, M2).
 *
 * La version précédente prenait comme départ la plus ancienne position DE LA
 * FENÊTRE. Deux conséquences, toutes deux fausses, et la première est grave :
 *
 *  1. la TOUTE PREMIÈRE saisie d'un livre ne comptait jamais. Une seule ligne
 *     dans la fenêtre, donc MAX = MIN, donc gain nul. Quelqu'un qui note sa
 *     page pour la première fois lisait « tu as lu 0 page cette semaine » ;
 *  2. un livre posé page 100 le mois dernier et repris page 150 hier comptait
 *     0 sur sept jours au lieu de 50 — les pages lues étaient attribuées à une
 *     période où l'on n'avait rien saisi.
 *
 * On prend donc comme départ la DERNIÈRE position connue AVANT la fenêtre, et
 * à défaut ZÉRO — un livre dont on n'a jamais noté la page était, pour tout ce
 * que l'application en sait, au début.
 *
 * SURCOMPTE CONNU, et préféré au défaut inverse : ajouter un livre qu'on lit
 * déjà et noter d'emblée « page 400 » fait compter 400 pages sur la semaine.
 * C'est faux dans la vie, mais c'est exactement ce que l'application a
 * enregistré comme progression. L'autre choix — ne rien compter tant qu'il n'y
 * a pas deux saisies — rendait la fonction inutilisable : le cas le plus
 * fréquent, celui de la première saisie, affichait toujours zéro.
 *
 * Corrigé ici, dans l'unique domicile de la règle, plutôt que dans les
 * statistiques : « Ma lecture » lit le même calcul, et deux comptes différents
 * pour la même semaine sur deux écrans voisins seraient pires que le défaut.
 */
export async function rythmeDepuis(profileId, depuis) {
  return query(
    `SELECT s.oeuvre_id AS oeuvreId,
            MAX(s.position_fin) - COALESCE(
              (SELECT a.position_fin
                 FROM sessions_lecture a
                WHERE a.profile_id = s.profile_id
                  AND a.oeuvre_id  = s.oeuvre_id
                  AND a.jour < ?
                ORDER BY a.jour DESC
                LIMIT 1),
              0
            ) AS gain
     FROM sessions_lecture s
     WHERE s.profile_id = ? AND s.jour >= ?
     GROUP BY s.oeuvre_id HAVING gain > 0;`,
    [depuis, profileId, depuis],
  );
}

// ---------------------------------------------------------------------------
// Identité : regrouper et détacher (§3.2)
// ---------------------------------------------------------------------------

/*
 * REGROUPER. La CIBLE gagne : son statut, sa note, sa position, ses dates et
 * son cycle sont conservés tels quels. La source lui apporte ses éditions et
 * ses appartenances de liste, puis disparaît.
 * Tout en une transaction : à mi-chemin, des éditions seraient orphelines.
 */
export async function regrouperOeuvres(profileId, sourceId, cibleId) {
  if (sourceId === cibleId) throw new Error('Ce livre est déjà cette œuvre.');

  const [cible] = await query(
    'SELECT edition_active AS editionActive FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;',
    [profileId, cibleId],
  );
  if (!cible) throw new Error('L’œuvre de destination n’existe plus.');

  await runMany([
    {
      sql: 'UPDATE editions SET oeuvre_id = ? WHERE profile_id = ? AND oeuvre_id = ?;',
      params: [cibleId, profileId, sourceId],
    },
    {
      // INSERT OR IGNORE : si le livre était déjà dans la même liste par ses
      // deux identités, on n'en garde qu'une entrée.
      sql: `INSERT OR IGNORE INTO liste_items (liste_id, profile_id, oeuvre_id, added_at)
            SELECT liste_id, profile_id, ?, added_at
            FROM liste_items WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [cibleId, profileId, sourceId],
    },
    /*
     * L'AVIS NE SE PERD PAS DANS UNE FUSION (ajoute avec la migration 3).
     * §6 dit « c'est l'autre qui gagne », et cela reste vrai pour le statut et
     * la progression. Mais un COMMENTAIRE est un texte ecrit a la main : le
     * supprimer en silence parce qu'on range deux doublons serait la pire
     * chose qu'on puisse faire ici.
     * On ne l'impose donc jamais — on ne le recupere que si la cible n'a
     * RIEN : pas de note et pas de commentaire. Sinon, celui de la cible reste.
     */
    {
      sql: `UPDATE oeuvres
            SET note = COALESCE(note, (SELECT note FROM oeuvres
                                       WHERE profile_id = ? AND oeuvre_id = ?)),
                commentaire = COALESCE(commentaire, (SELECT commentaire FROM oeuvres
                                                     WHERE profile_id = ? AND oeuvre_id = ?))
            WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [profileId, sourceId, profileId, sourceId, profileId, cibleId],
    },
    { sql: 'DELETE FROM oeuvres WHERE profile_id = ? AND oeuvre_id = ?;', params: [profileId, sourceId] },
    {
      // La cible garde son édition active si elle en avait une.
      sql: `UPDATE oeuvres SET edition_active = COALESCE(edition_active,
              (SELECT edition_id FROM editions WHERE profile_id = ? AND oeuvre_id = ? LIMIT 1))
            WHERE profile_id = ? AND oeuvre_id = ?;`,
      params: [profileId, cibleId, profileId, cibleId],
    },
  ]);
}

/*
 * DÉTACHER. Crée une œuvre à partir de la seule édition, sous une identité
 * locale À IDENTIFIANT ALÉATOIRE — `fp:<uuid>`, pas l'empreinte calculée.
 * Raison (§3.2) : l'empreinte est déterministe ; recalculée, elle reproduirait
 * exactement la clé de l'œuvre qu'on quitte, INSERT OR IGNORE ne ferait rien,
 * et le détachement serait silencieusement sans effet.
 * La nouvelle œuvre hérite du titre et des auteurs portés par L'ÉDITION : c'est
 * précisément le cas où le titre de l'œuvre d'origine est faux.
 */
export async function detacherEdition(profileId, editionId) {
  const [edition] = await query(
    `SELECT oeuvre_id AS oeuvreId, titre, auteurs, date_publication AS datePublication,
            couverture_url AS couvertureUrl, langue
     FROM editions WHERE profile_id = ? AND edition_id = ?;`,
    [profileId, editionId],
  );
  if (!edition) throw new Error('Cette édition n’existe plus.');

  const restantes = await query(
    'SELECT edition_id AS editionId FROM editions WHERE profile_id = ? AND oeuvre_id = ? AND edition_id <> ?;',
    [profileId, edition.oeuvreId, editionId],
  );
  if (restantes.length === 0) {
    throw new Error('C’est la seule édition de ce livre : il n’y a rien à en détacher.');
  }

  const nouvelleId = `fp:${crypto.randomUUID()}`;

  await runMany([
    {
      sql: `INSERT INTO oeuvres
              (profile_id, oeuvre_id, titre, auteurs, annee, date_publication,
               couverture_url, langue, edition_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        profileId, nouvelleId, edition.titre, edition.auteurs,
        edition.datePublication ? String(edition.datePublication).slice(0, 4) : null,
        edition.datePublication, edition.couvertureUrl, edition.langue, editionId,
      ],
    },
    {
      sql: 'UPDATE editions SET oeuvre_id = ? WHERE profile_id = ? AND edition_id = ?;',
      params: [nouvelleId, profileId, editionId],
    },
    {
      sql: `UPDATE oeuvres SET edition_active = ?
            WHERE profile_id = ? AND oeuvre_id = ? AND edition_active = ?;`,
      params: [restantes[0].editionId, profileId, edition.oeuvreId, editionId],
    },
  ]);

  return nouvelleId;
}

// ---------------------------------------------------------------------------
// Cycles (§4.4)
// ---------------------------------------------------------------------------

/*
 * Toute édition manuelle pose cycle_manuel = 1 : une valeur corrigée à la main
 * n'est plus jamais écrasée par une lecture automatique.
 * SEULE sortie : vider entièrement le champ remet cycle_manuel = 0 et rend
 * l'œuvre à la lecture automatique. Sans cette porte, une faute de frappe
 * gelait l'œuvre définitivement.
 */
export function setCycle(profileId, oeuvreId, nom, tome) {
  const vide = !nom || !String(nom).trim();
  return run(
    `UPDATE oeuvres SET cycle_nom = ?, cycle_tome = ?, cycle_manuel = ?
     WHERE profile_id = ? AND oeuvre_id = ?;`,
    [vide ? null : String(nom).trim(), vide ? null : (tome || null), vide ? 0 : 1, profileId, oeuvreId],
  );
}

/** Pour l'autocomplétion : c'est ce qui empêche un cycle de se dédoubler. */
export async function listCycles(profileId) {
  const lignes = await query(
    `SELECT DISTINCT cycle_nom AS nom FROM oeuvres
     WHERE profile_id = ? AND cycle_nom IS NOT NULL AND cycle_nom <> ''
     ORDER BY cycle_nom;`,
    [profileId],
  );
  return lignes.map((l) => l.nom);
}

// ---------------------------------------------------------------------------
// Sauvegarde et restauration (§3.6)
// ---------------------------------------------------------------------------

/*
 * Lit tout ce qui appartient au profil, sans profile_id : la sauvegarde doit
 * pouvoir être restaurée sur un autre appareil, où l'identifiant de profil est
 * réécrit tel quel (l'UUID est portable, §3.3).
 * Les listes sortent par leur NOM, jamais par leur id auto-incrémenté.
 */
export async function exporterProfil(profileId) {
  const [oeuvres, editions, listes] = await Promise.all([
    query(
      `SELECT oeuvre_id AS oeuvreId, titre, auteurs, annee,
              date_publication AS datePublication, couverture_url AS couvertureUrl,
              resume, categories, langue, cycle_nom AS cycleNom, cycle_tome AS cycleTome,
              cycle_manuel AS cycleManuel, statut, note, position,
              edition_active AS editionActive, ajoute_le AS ajouteLe,
              commence_le AS commenceLe, termine_le AS termineLe
       FROM oeuvres WHERE profile_id = ? ORDER BY ajoute_le;`,
      [profileId],
    ),
    query(
      `SELECT edition_id AS editionId, oeuvre_id AS oeuvreId, source, titre, auteurs,
              format, isbn13, isbn10, editeur, date_publication AS datePublication,
              nb_pages AS nbPages, duree_minutes AS dureeMinutes,
              couverture_url AS couvertureUrl, langue, ajoute_le AS ajouteLe
       FROM editions WHERE profile_id = ? ORDER BY ajoute_le;`,
      [profileId],
    ),
    query(
      'SELECT id, name, created_at AS createdAt FROM listes WHERE profile_id = ? ORDER BY created_at;',
      [profileId],
    ),
  ]);

  const items = await query(
    `SELECT liste_id AS listeId, oeuvre_id AS oeuvreId, added_at AS addedAt
     FROM liste_items WHERE profile_id = ?;`,
    [profileId],
  );

  return {
    oeuvres,
    editions,
    listes: listes.map((l) => ({
      name: l.name,
      createdAt: l.createdAt,
      items: items
        .filter((i) => i.listeId === l.id)
        .map((i) => ({ oeuvreId: i.oeuvreId, addedAt: i.addedAt })),
    })),
  };
}

/*
 * Restauration. TOUT passe dans une seule transaction (§3.6) : sur Android,
 * executeSet(..., true) fait la différence entre 6 secondes et plus d'une
 * minute — mesuré sur le projet séries.
 * Les listes sont recréées avec de NOUVEAUX id auto-incrémentés ; c'est
 * pourquoi le format les exporte par leur nom.
 */
export async function importerProfil(profil, donnees) {
  const lot = [
    { sql: 'INSERT OR IGNORE INTO profiles (id, name) VALUES (?, ?);', params: [profil.id, profil.name] },
    { sql: 'UPDATE profiles SET name = ? WHERE id = ?;', params: [profil.name, profil.id] },
    // Vider AVANT de réinsérer. Les cascades emportent éditions et items.
    { sql: 'DELETE FROM listes WHERE profile_id = ?;', params: [profil.id] },
    { sql: 'DELETE FROM oeuvres WHERE profile_id = ?;', params: [profil.id] },
  ];

  for (const o of donnees.oeuvres) {
    lot.push({
      sql: `INSERT OR REPLACE INTO oeuvres
              (profile_id, oeuvre_id, titre, auteurs, annee, date_publication,
               couverture_url, resume, categories, langue, cycle_nom, cycle_tome,
               cycle_manuel, statut, note, commentaire, position, edition_active,
               ajoute_le, commence_le, termine_le)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        profil.id, o.oeuvreId, o.titre, o.auteurs, o.annee, o.datePublication,
        o.couvertureUrl, o.resume, o.categories, o.langue, o.cycleNom, o.cycleTome,
        o.cycleManuel ? 1 : 0, o.statut, o.note, o.commentaire || null,
        o.position || 0, o.editionActive, o.ajouteLe, o.commenceLe, o.termineLe,
      ],
    });
  }

  for (const e of donnees.editions) {
    lot.push({
      sql: `INSERT OR REPLACE INTO editions
              (profile_id, edition_id, oeuvre_id, source, titre, auteurs, format,
               isbn13, isbn10, editeur, date_publication, nb_pages, duree_minutes,
               couverture_url, langue, ajoute_le)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      params: [
        profil.id, e.editionId, e.oeuvreId, e.source, e.titre, e.auteurs, e.format,
        e.isbn13, e.isbn10, e.editeur, e.datePublication, e.nbPages, e.dureeMinutes,
        e.couvertureUrl, e.langue, e.ajouteLe,
      ],
    });
  }

  await runMany(lot);

  /*
   * Les listes ensuite, hors du lot : chaque insertion a besoin de l'id
   * auto-incrémenté que la précédente vient de produire.
   * Les items dont l'œuvre n'est pas dans le fichier sont FILTRÉS : sans ça
   * la clé étrangère composite explose et la restauration échoue à moitié.
   */
  const oeuvresConnues = new Set(donnees.oeuvres.map((o) => o.oeuvreId));
  let itemsIgnores = 0;

  for (const l of donnees.listes || []) {
    await run(
      'INSERT OR IGNORE INTO listes (profile_id, name, created_at) VALUES (?, ?, ?);',
      [profil.id, l.name, l.createdAt],
    );
    const [{ id } = {}] = await query(
      'SELECT id FROM listes WHERE profile_id = ? AND name = ?;',
      [profil.id, l.name],
    );
    if (!id) continue;

    const valides = (l.items || []).filter((i) => oeuvresConnues.has(i.oeuvreId));
    itemsIgnores += (l.items || []).length - valides.length;
    if (valides.length === 0) continue;

    await runMany(valides.map((i) => ({
      sql: `INSERT OR IGNORE INTO liste_items (liste_id, profile_id, oeuvre_id, added_at)
            VALUES (?, ?, ?, ?);`,
      params: [id, profil.id, i.oeuvreId, i.addedAt],
    })));
  }

  return { itemsIgnores };
}

export async function compterEditions(profileId, oeuvreId) {
  const [{ n } = { n: 0 }] = await query(
    'SELECT COUNT(*) AS n FROM editions WHERE profile_id = ? AND oeuvre_id = ?;',
    [profileId, oeuvreId],
  );
  return Number(n) || 0;
}
