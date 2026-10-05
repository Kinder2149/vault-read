/*
 * CatalogueApi.jsx — le catalogue Vault Books : le couper, choisir sa langue.
 *
 * POURQUOI IL EXISTE (tranche 33). La recherche interroge desormais notre propre service AVANT Google Books, Open Library
 * et la BnF. Deux reglages n'ont de sens que pour lui :
 *  - l'interrupteur, pour comparer a volonte avec l'ancien comportement (et couper en cas de doute) ;
 *  - la langue du catalogue : les titres, les editions et les couvertures rendus sont ceux de cette langue.
 *
 * Il ne s'affiche PAS quand l'application n'a pas d'adresse de service (`configuree: false`) : un reglage qui ne peut rien
 * faire est du bruit. Composant qui porte sa propre logique, comme `CacheRecherche.jsx`.
 */

import { useEffect, useState } from 'react';
import { getCatalogueApi, setCatalogueApiActif, setLangueCatalogue } from '../api.js';
import { notify } from '../notify.js';

const LIBELLES = { fr: 'Français', en: 'Anglais' };

export default function CatalogueApi() {
  const [etat, setEtat] = useState(null);

  useEffect(() => {
    let vivant = true;
    getCatalogueApi().then((e) => { if (vivant) setEtat(e); }).catch(() => {});
    return () => { vivant = false; };
  }, []);

  if (!etat || !etat.configuree) return null;

  async function basculer() {
    try { setEtat(await setCatalogueApiActif(!etat.active)); } catch (e) { notify(e.message); }
  }

  async function choisirLangue(langue) {
    try {
      setEtat(await setLangueCatalogue(langue));
      notify('Langue du catalogue changée. Relance ta recherche pour la voir.');
    } catch (e) { notify(e.message); }
  }

  return (
    <div className="carte">
      <h2 className="carte__titre">Catalogue Vault Books</h2>
      <div className="carte__ligne">
        <span>{etat.active ? 'Activé' : 'Désactivé'}</span>
        <button type="button" className="btn btn--fantome" onClick={basculer}>
          <span>{etat.active ? 'Désactiver' : 'Activer'}</span>
        </button>
      </div>
      <div className="carte__ligne">
        <span>Langue du catalogue</span>
        <span>
          {etat.langues.map((l) => (
            <button
              key={l}
              type="button"
              className={`btn ${etat.langue === l ? '' : 'btn--fantome'}`}
              onClick={() => choisirLangue(l)}
              aria-pressed={etat.langue === l}
            >
              <span>{LIBELLES[l] || l}</span>
            </button>
          ))}
        </span>
      </div>
      <p className="carte__detail">
        Notre propre catalogue range les sagas dans l’ordre et associe chaque couverture à la bonne édition.
        Désactivé, ou s’il ne répond pas, la recherche utilise Google Books, Open Library et la BnF comme avant.
        Il sert la recherche par titre, par auteur et le scan d’ISBN.
      </p>
    </div>
  );
}
