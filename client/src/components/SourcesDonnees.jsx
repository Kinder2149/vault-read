/*
 * SourcesDonnees.jsx — d'ou viennent les informations sur les livres (tranche 33, phase 4).
 *
 * L'attribution « Donnees Hardcover » est une condition d'usage de leur API ; la BnF, Open Library et Google Books sont nommees
 * par honnetete — c'est eux que l'application interroge. La ligne Hardcover n'apparait que si le catalogue est utilisable
 * (configure ET active) : sans lui, l'application n'interroge pas Hardcover. Composant qui porte sa propre logique, comme `CatalogueApi.jsx`.
 */

import { useEffect, useState } from 'react';
import { getCatalogueApi } from '../api.js';

const Lien = ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

export default function SourcesDonnees() {
  const [catalogue, setCatalogue] = useState(null);

  useEffect(() => {
    let vivant = true;
    getCatalogueApi().then((e) => { if (vivant) setCatalogue(e); }).catch(() => {});
    return () => { vivant = false; };
  }, []);

  return <ListeSources hardcover={Boolean(catalogue && catalogue.configuree && catalogue.active)} />;
}

/** L'affichage seul : `hardcover` dit si l'application interroge Hardcover. */
export function ListeSources({ hardcover }) {
  return (
    <div className="carte">
      <h2 className="carte__titre">Sources des données</h2>
      <p className="carte__detail">
        Les informations sur les livres, les sagas et les couvertures viennent de :
      </p>
      <ul className="carte__detail">
        {hardcover && <li>Données <Lien href="https://hardcover.app">Hardcover</Lien> (livres, sagas, éditions, couvertures)</li>}
        <li><Lien href="https://www.bnf.fr">Bibliothèque nationale de France</Lien> (éditions françaises)</li>
        <li><Lien href="https://openlibrary.org">Open Library</Lien> (Internet Archive) (couvertures, résumés)</li>
        <li><Lien href="https://books.google.com">Google Books</Lien> (recherche de secours)</li>
      </ul>
      <p className="carte__detail">
        Vault Read n’est affilié à aucune de ces sources. Une couverture ou une information est fausse, ou doit être retirée ?
        Écris à vcoutry@gmail.com avec le titre ou l’ISBN.
      </p>
    </div>
  );
}
