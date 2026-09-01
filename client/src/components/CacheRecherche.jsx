/*
 * CacheRecherche.jsx — le bouton « vider le cache de recherche ».
 *
 * POURQUOI IL EXISTE. Une recherche deja faite est resservie pendant 24 h
 * depuis l'archive. Tant qu'elle l'est, une correction du classement reste
 * invisible — et c'est exactement ce qui a fait tester une version ancienne
 * en croyant tester la nouvelle : la page 1 sortait de la conserve, les pages
 * suivantes etaient cherchees en direct.
 *
 * CE QU'IL NE FAIT PAS. Il ne touche ni la bibliotheque, ni l'historique des
 * recherches. C'est toute sa raison d'etre : vider les donnees de
 * l'application depuis Android aurait emporte les livres avec le cache.
 *
 * Composant qui porte sa propre logique, comme `Backup.jsx` : l'ecran
 * Reglages reste un ecran de presentation qui ne va rien chercher lui-meme.
 */

import { useState } from 'react';
import { viderCacheRecherche } from '../api.js';
import { notify } from '../notify.js';

export default function CacheRecherche() {
  const [enCours, setEnCours] = useState(false);
  const [vide, setVide] = useState(false);

  async function vider() {
    setEnCours(true);
    try {
      const jetees = await viderCacheRecherche();
      setVide(true);
      notify(jetees > 0
        ? `Cache vidé — ${jetees} recherche${jetees > 1 ? 's' : ''} oubliée${jetees > 1 ? 's' : ''}.`
        : 'Le cache était déjà vide.');
    } catch (e) {
      notify(e.message);
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="carte">
      <h2 className="carte__titre">Cache de recherche</h2>
      <div className="carte__ligne">
        <span>{vide ? 'Vidé' : 'Résultats gardés 24 h'}</span>
        <button type="button" className="btn btn--fantome" onClick={vider} disabled={enCours}>
          <span>{enCours ? 'Vidage…' : 'Vider'}</span>
        </button>
      </div>
      <p className="carte__detail">
        Les recherches sont gardées un jour pour ne pas consommer le quota deux
        fois. Vide-le si les résultats te semblent figés.
        {' '}<b>Tes livres ne sont pas concernés.</b>
      </p>
    </div>
  );
}
