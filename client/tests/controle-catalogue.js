/*
 * CONTROLE DU VRAI CATALOGUE VAULT BOOKS — a lancer a la main (tranche 33).
 *
 *   npm run controle-catalogue
 *
 * Ce n'est PAS une verification automatique : elle appelle le vrai service (https://vault-books-api.vercel.app, reglé par
 * VITE_VAULT_API_URL dans client/.env) et MONTRE ce que l'ecran de recherche recevrait, comme le fait `banc-recherche.js`
 * pour les sources publiques. Elle ne consomme aucun quota Google.
 *
 * Elle passe par la VRAIE chaine : source -> books.rechercher (avec repli) -> organiserLEcran. Si le service est coupe ou
 * non configure, elle l'annonce : le repli par les sources publiques prendrait alors le relais dans l'application.
 */
import './preparation.js';
import { rechercher, etatCatalogueApi, editionsDuCatalogue } from '../src/books.js';
import { organiserLEcran } from '../src/tomes.js';

const vert = (t) => `\x1b[32m${t}\x1b[0m`;
const rouge = (t) => `\x1b[31m${t}\x1b[0m`;
const gris = (t) => `\x1b[90m${t}\x1b[0m`;

const REQUETES = (process.env.REQUETES ? process.env.REQUETES.split('|') : ['les chevaliers d\'emeraude', 'le seigneur des anneaux', 'game of thrones', 'germinal', 'les fourmis', 'dune']);

const etat = etatCatalogueApi();
console.log(`Catalogue : configure=${etat.configuree} actif=${etat.active} langue=${etat.langue}`);
if (!etat.configuree) {
  console.log(rouge('VITE_VAULT_API_URL absente de client/.env : rien a controler.'));
  process.exit(1);
}

let echecs = 0;
for (const texte of REQUETES) {
  const t0 = Date.now();
  const r = await rechercher(texte, 'titre');
  const ms = Date.now() - t0;
  const duCatalogue = r.resultats.length > 0 && r.resultats.every((x) => x.source === 'vaultapi');
  if (!duCatalogue) echecs += 1;
  console.log(`\n${duCatalogue ? vert('CATALOGUE') : rouge('REPLI    ')} « ${texte} » — ${r.resultats.length} resultats en ${ms} ms`);

  organiserLEcran(r.resultats, texte).slice(0, 3).forEach((bloc) => {
    if (bloc.type === 'serie') {
      console.log(`   [saga] ${bloc.nom} — ${bloc.tomes.length} tomes`);
      bloc.tomes.slice(0, 4).forEach((t) => console.log(gris(`        ${String(t.tome).padStart(2)}. ${t.titre} | ${t.editeur || '?'} | ${t.isbn13 || '-'} | couv ${t.couvertureUrl ? 'oui' : 'NON'}${t.couvertureApproximative ? ' (approx.)' : ''}`)));
    } else {
      const l = bloc.livres.slice(0, 3).map((x) => x.titre).join(' ; ');
      console.log(`   [livres] ${l}`);
    }
  });
}
// Les editions proposees pour le premier tome de la premiere saga (le parcours « ajouter une edition »).
const premiere = (await rechercher(REQUETES[0], 'titre')).resultats.find((x) => x.serie);
if (premiere) {
  const t0 = Date.now();
  const editions = await editionsDuCatalogue([premiere.cleSource]);
  console.log(`\nEditions proposees pour « ${premiere.titre} » : ${editions ? editions.length : 'aucune (repli BnF)'} en ${Date.now() - t0} ms`);
  (editions || []).slice(0, 6).forEach((e) => console.log(gris(`   ${String(e.datePublication || '----').slice(0, 4)} | ${String(e.editeur || '?').padEnd(24).slice(0, 24)} | ${e.isbn13} | couv ${e.couvertureUrl ? 'oui' : 'NON'}${e.couvertureApproximative ? ' (approx.)' : ''}`)));
}

// Le scan d'un ISBN : chaque code-barres doit rendre UNE fiche du catalogue (ou, pour un inconnu, retomber sur les sources publiques).
const ISBNS = [['9782749910147', 'FR, Hardcover'], ['9791022400640', 'FR recent (979), repli BnF du service'], ['9780553103540', 'EN, version originale'], ['2226052577', 'ISBN-10 ancien']];
console.log('\nScan d\'ISBN :');
for (const [isbn, nom] of ISBNS) {
  const t0 = Date.now();
  const r = await rechercher(isbn, 'isbn');
  const f = r.resultats[0];
  const viaCatalogue = f && f.source === 'vaultapi';
  if (!viaCatalogue) echecs += 1;
  console.log(`   ${viaCatalogue ? vert('CATALOGUE') : rouge('REPLI    ')} ${isbn} (${nom}) — ${f ? `« ${f.titre} » | ${f.editeur || '?'} | ${f.nbPages ? `${f.nbPages} p.` : 'pages ?'} | ${f.langue || '?'} | couv ${f.couvertureUrl ? 'oui' : 'NON'}${f.serie ? ` | tome ${f.serie.position}` : ''}` : 'aucun resultat'} — ${Date.now() - t0} ms`);
}
console.log(echecs ? rouge(`\n${echecs} recherche(s) sont passees par le repli.`) : vert('\nToutes les recherches viennent du catalogue.'));
process.exit(echecs ? 1 : 0);
