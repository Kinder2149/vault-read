/*
 * types.js — le SEUL contrat de forme du projet (§7, garde-fou 1).
 * Le projet est en JavaScript sans typage : ces @typedef sont importés en
 * commentaire par chaque module qui manipule ces objets. Écrit AVANT books.js,
 * comme l'exige le contexte.
 * Piège évité : le projet séries laisse la forme « item » implicite et la
 * reconstruit à la main dans une dizaine d'endroits — d'où la confusion réelle
 * entre `id` (UI) et `tmdbId` (sauvegarde), non détectable sans typage.
 */

/**
 * Ce que rend une recherche. Produit UNIQUEMENT par un normaliseur de
 * sources/*.js — jamais construit à la main ailleurs (§7, garde-fou 2).
 * @typedef {Object} ResultatRecherche
 * @property {string}   cleSource        "gb:<volumeId>", "ol:<olid>", "bnf:<ark>" ou "vb:<id de livre>" (catalogue Vault Books)
 * @property {'google'|'openlibrary'|'bnf'|'vaultapi'} source
 * @property {string}   titre
 * @property {string|null} sousTitre
 * @property {string[]} auteurs          liste, éventuellement vide
 * @property {string|null} annee         'YYYY', extraite de datePublication
 * @property {string|null} datePublication  ISO partielle : 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD'
 * @property {string|null} couvertureUrl toujours en https
 * @property {string|null} resume
 * @property {string[]} categories
 * @property {string|null} langue        code court : 'fr', 'en'
 * @property {string|null} isbn13
 * @property {string|null} isbn10
 * @property {number|null} nbPages       jamais 0 : Google rend 0 pour « inconnu »
 * @property {string|null} editeur
 * Champs FACULTATIFS, rendus seulement par le catalogue Vault Books (source 'vaultapi') :
 * @property {{id:number, nom:string, position:number, total:number|null}} [serie]
 *           la saga a laquelle appartient ce livre, et sa place : fait foi sur la lecture du numero dans le titre
 * @property {number}   [scoreApi]       classement donne par le service : fait foi sur `scorePertinence`
 * @property {boolean}  [couvertureApproximative]  la couverture vient du livre canonique, pas de cette edition
 * @property {string|null} resume  (pour 'vaultapi') le resume du service, dans la langue qu'il a — souvent l'anglais ; rempli seulement par la recherche par ISBN
 */

/**
 * Une œuvre : le livre en tant que texte. Porte le suivi (§3.1).
 * Les noms de champs sont ceux rendus par les alias SQL, pas les colonnes.
 * @typedef {Object} Oeuvre
 * @property {string}   oeuvreId       "ol:OL893414W" | "fp:<empreinte>" | "fp:<uuid>"
 * @property {string}   titre
 * @property {string|null} auteurs     "A, B" — pas de table auteurs en V1
 * @property {string|null} annee
 * @property {string|null} datePublication
 * @property {string|null} couvertureUrl
 * @property {string|null} resume
 * @property {string|null} categories
 * @property {string|null} langue
 * @property {string|null} cycleNom
 * @property {number|null} cycleTome
 * @property {boolean}  cycleManuel     une valeur corrigée à la main n'est jamais écrasée
 * @property {'a_lire'|'en_cours'|'lu'|'abandonne'} statut
 * @property {number|null} note          1..5
 * @property {number}   position         page courante, ou minute si audio
 * @property {string|null} editionActive
 * @property {string}   ajouteLe
 * @property {string|null} commenceLe
 * @property {string|null} termineLe
 */

/**
 * Une édition : un exemplaire concret. Porte les métadonnées physiques (§3.1).
 * @typedef {Object} Edition
 * @property {string}   editionId      "gb:<volumeId>" | "ol:<olid>" | "manuel:<uuid>"
 * @property {string}   oeuvreId
 * @property {'google'|'openlibrary'|'manuel'} source
 * @property {string}   titre          titre de CETTE édition (VO, retraduction)
 * @property {string|null} auteurs
 * @property {'papier'|'numerique'|'audio'} format
 * @property {string|null} isbn13
 * @property {string|null} isbn10
 * @property {string|null} editeur
 * @property {string|null} datePublication
 * @property {number|null} nbPages
 * @property {number|null} dureeMinutes   audio uniquement
 * @property {string|null} couvertureUrl
 * @property {string|null} langue
 */

/**
 * Ce que rend la résolution d'identité chez Open Library (§3.2).
 * @typedef {Object} Identite
 * @property {string}  oeuvreId    "ol:…" si résolue, "fp:…" sinon
 * @property {boolean} resolue     false = empreinte locale, identification incomplète
 * @property {string|null} cycleNom
 * @property {number|null} cycleTome
 * @property {number|null} nbPages  pagination exacte de l'édition, si connue
 */

export {};
