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
import { rechercher, etatCatalogueApi } from '../src/books.js';
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
console.log(echecs ? rouge(`\n${echecs} recherche(s) sont passees par le repli.`) : vert('\nToutes les recherches viennent du catalogue.'));
process.exit(echecs ? 1 : 0);
