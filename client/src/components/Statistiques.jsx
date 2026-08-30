/*
 * Statistiques.jsx — ce que dit la bibliotheque, en bas de l'ecran Bibliotheque.
 *
 * Pas un onglet : la barre en porte deja quatre, et un cinquieme la serre sur
 * un telephone. Les statistiques vivent la ou l'on regarde deja sa collection.
 *
 * Le calcul n'est PAS ici — il est dans `statistiques.js`, module pur et
 * verifiable. Ce fichier ne fait que rendre. N'importe que api.js, status.js
 * et des modules purs (§2, regle 1).
 *
 * CE QU'IL NE MONTRE PAS, volontairement :
 *  - la repartition par STATUT : les quatre paves en haut de cette meme page
 *    la donnent deja. La repeter en bas serait du bruit, pas de l'information ;
 *  - un temps de lecture ou une vitesse : le projet ne stocke aucune duree de
 *    session (voir l'en-tete de statistiques.js).
 */

import { useEffect, useMemo, useState } from 'react';
import { getVolumeLu } from '../api.js';
import {
  livresParMois, repartition, notation, faitsDArmes,
} from '../statistiques.js';

const LIBELLES_FORMAT = { papier: 'Papier', numerique: 'Numérique', audio: 'Audio' };

/* « 2026-08 » -> « août ». Le mois seul suffit sous une barre. */
function nomDuMois(cle) {
  const [an, mois] = cle.split('-');
  return new Date(Number(an), Number(mois) - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'short' })
    .replace('.', '');
}

function Volume({ libelle, volume }) {
  const { pages, minutes } = volume;
  // Un profil sans livre audio ne doit jamais lire le mot « minute ».
  const rien = pages === 0 && minutes === 0;
  return (
    <div className="stat">
      <span className="stat__valeur">
        {rien ? '—' : (
          <>
            {pages > 0 && <>{pages.toLocaleString('fr-FR')}<small> p.</small></>}
            {pages > 0 && minutes > 0 && ' '}
            {minutes > 0 && <>{minutes.toLocaleString('fr-FR')}<small> min</small></>}
          </>
        )}
      </span>
      <span className="stat__libelle">{libelle}</span>
    </div>
  );
}

export default function Statistiques({ bibliotheque }) {
  const [volume, setVolume] = useState(null);

  /*
   * Recharge quand la bibliotheque change : marquer un livre lu ou saisir une
   * position doit se voir ici sans avoir a quitter l'ecran. C'est une lecture
   * de base locale, elle ne coute rien.
   */
  useEffect(() => {
    let vivant = true;
    getVolumeLu().then((v) => { if (vivant) setVolume(v); }).catch(() => {});
    return () => { vivant = false; };
  }, [bibliotheque]);

  const mois = useMemo(() => livresParMois(bibliotheque), [bibliotheque]);
  const { formats } = useMemo(() => repartition(bibliotheque), [bibliotheque]);
  const { moyenne, notes, avis } = useMemo(() => notation(bibliotheque), [bibliotheque]);
  const { plusGros, plusRapide } = useMemo(() => faitsDArmes(bibliotheque), [bibliotheque]);

  const maxMois = Math.max(1, ...mois.map((m) => m.nombre));
  const totalMois = mois.reduce((a, m) => a + m.nombre, 0);
  // Meme regle que le filtre de format : on ne montre le decoupage que s'il
  // decoupe vraiment quelque chose.
  const formatsUtiles = Object.keys(formats).length > 1;

  return (
    <section className="stats">
      <h2 className="soustitre">Mes statistiques</h2>

      <div className="stats__ligne">
        <Volume libelle="7 jours" volume={volume?.semaine || { pages: 0, minutes: 0 }} />
        <Volume libelle="30 jours" volume={volume?.mois || { pages: 0, minutes: 0 }} />
        <Volume libelle="cette année" volume={volume?.annee || { pages: 0, minutes: 0 }} />
      </div>
      <p className="hint">
        Ce que tu as lu depuis, d’après les positions que tu as saisies.
      </p>

      {totalMois > 0 && (
        <>
          <h3 className="stats__titre">Livres terminés</h3>
          <div className="stats__mois">
            {mois.map((m) => (
              <div className="stats__mois-colonne" key={m.mois}>
                <span className="stats__mois-nombre">{m.nombre > 0 ? m.nombre : ''}</span>
                <span
                  className="stats__barre"
                  /* La hauteur est une donnee, pas un style : elle ne peut pas
                     vivre dans la feuille CSS. */
                  style={{ height: `${Math.round((m.nombre / maxMois) * 100)}%` }}
                  aria-hidden="true"
                />
                <span className="stats__mois-nom">{nomDuMois(m.mois)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stats__ligne">
        <div className="stat">
          <span className="stat__valeur">
            {moyenne === null ? '—' : <>{moyenne}<small> /5</small></>}
          </span>
          <span className="stat__libelle">
            {notes > 0 ? `note moyenne (${notes})` : 'aucune note'}
          </span>
        </div>
        <div className="stat">
          <span className="stat__valeur">{avis > 0 ? avis : '—'}</span>
          <span className="stat__libelle">{avis > 1 ? 'avis écrits' : 'avis écrit'}</span>
        </div>
        {formatsUtiles && (
          <div className="stat">
            <span className="stat__valeur stat__valeur--petite">
              {Object.entries(formats)
                .map(([f, n]) => `${n} ${LIBELLES_FORMAT[f] || f}`)
                .join(' · ')}
            </span>
            <span className="stat__libelle">supports</span>
          </div>
        )}
      </div>

      {(plusGros || plusRapide) && (
        <>
          <h3 className="stats__titre">Faits d’armes</h3>
          <ul className="stats__faits">
            {plusGros && (
              <li>
                Le plus gros livre terminé : <b>{plusGros.titre}</b>,{' '}
                {plusGros.nbPages} pages.
              </li>
            )}
            {plusRapide && (
              <li>
                Le plus vite lu : <b>{plusRapide.oeuvre.titre}</b>, en{' '}
                {plusRapide.jours} {plusRapide.jours > 1 ? 'jours' : 'jour'}
                {' '}({plusRapide.parJour} pages par jour).
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}
