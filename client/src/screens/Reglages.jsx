/*
 * Reglages.jsx — profil, affichage, donnees, quota et diagnostic.
 *
 * Prevu par §2.2 des le depart, mais reste dans `App.jsx` jusqu'au
 * 2026-08-25 : la coquille atteignait 334 lignes pour une cible de 300, et
 * l'ecran de reglages en occupait a lui seul soixante-dix.
 * Ecran de PRESENTATION : il recoit tout ce qu'il affiche et ne va rien
 * chercher lui-meme — c'est `App.jsx` qui detient l'etat partage (§2).
 */

import Icon from '../components/Icon.jsx';
import ProfileSelector from '../components/ProfileSelector.jsx';
import CacheRecherche from '../components/CacheRecherche.jsx';

export default function Reglages({
  theme, basculerTheme, bibliotheque, quota, etat,
  setSauvegardeOuverte, recharger,
}) {
  return (
    <section className="reglages">
        <ProfileSelector onChangement={recharger} />

        <div className="carte">
          <h2 className="carte__titre">Affichage</h2>
          <div className="carte__ligne">
            <span>Thème {theme === 'dark' ? 'sombre' : 'clair'}</span>
            <button type="button" className="btn btn--fantome" onClick={basculerTheme}>
              <Icon name={theme === 'dark' ? 'soleil' : 'lune'} size={18} />
              <span>Basculer</span>
            </button>
          </div>
        </div>

        <div className="carte">
          <h2 className="carte__titre">Mes données</h2>
          <div className="carte__ligne"><span>Livres suivis</span><b>{bibliotheque.length}</b></div>
          <div className="carte__ligne">
            <span>Sauvegarde</span>
            <button type="button" className="btn btn--fantome" onClick={() => setSauvegardeOuverte(true)}>
              <Icon name="sauver" size={18} />
              <span>Ouvrir</span>
            </button>
          </div>
          <p className="carte__detail">
            Tout est enregistré sur cet appareil, et nulle part ailleurs.
            Une sauvegarde est le seul moyen de retrouver ta bibliothèque si
            tu changes de téléphone.
          </p>
        </div>

        {/*
          Le quota Google etait INVISIBLE : on ne decouvrait l'avoir epuise
          qu'en recevant « Trop de recherches pour aujourd'hui », c'est-a-dire
          quand il n'y avait plus rien a faire de la journee. Le rendre
          visible, c'est permettre de le menager.
        */}
        <div className="carte">
          <h2 className="carte__titre">Recherches du jour</h2>
          <div className="carte__ligne">
            <span>Utilisées aujourd’hui</span>
            <b>{quota ? `${quota.utilises} / ${quota.total}` : '…'}</b>
          </div>
          <p className="carte__detail">
            Google Books limite l’application à {quota ? quota.total : 1000} recherches
            par jour. Une recherche au fil de la frappe en consomme une ;
            le bouton « Actualiser » des suggestions en consomme une quinzaine,
            mais une seule fois par jour — ensuite il ressert le même résultat
            tant que ta bibliothèque n’a pas changé.
          </p>
        </div>

        <CacheRecherche />

        <div className="carte">
          <h2 className="carte__titre">Base de données</h2>
          {etat ? (
            <>
              <div className="carte__ligne"><span>Plateforme</span><b>{etat.plateforme}</b></div>
              <div className="carte__ligne"><span>Version du schéma</span><b>v{etat.versionSchema}</b></div>
              <div className="carte__ligne">
                <span>Clés étrangères</span>
                <b>{etat.clesEtrangeres ? 'actives' : 'INACTIVES'}</b>
              </div>
              <div className="carte__ligne"><span>Tables</span><b>{etat.tables.length}</b></div>
            </>
          ) : (
            <p className="hint">Ouverture de la base…</p>
          )}
        </div>
    </section>
  );
}
