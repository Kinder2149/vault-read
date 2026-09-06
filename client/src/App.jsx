/*
 * App.jsx — coquille : état partagé, navigation, overlays. Cible < 300 lignes (§2.2).
 * App.jsx EST le store (§9, hérité) : il détient la Map du suivi et distribue
 * des callbacks par props ; aucune librairie d'état.
 * Applique §9 : rechargement complet après chaque écriture, jamais de mise à
 * jour optimiste — brutal sur une base locale, mais cela élimine toute une
 * classe de bugs de désynchronisation.
 * N'importe QUE api.js, status.js et notify.js (§2, règle 1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import {
  demarrer, etatBase, getBibliotheque, ajouterOeuvre,
  setStatut, getClesEditions, setActiveProfileId, surChangementDeFond, getProfilActif,
  quotaDuJour,
} from './api.js';
import { LIBELLES, STATUTS, classeStatut } from './status.js';
import { notify } from './notify.js';
import Icon from './components/Icon.jsx';
import Modal from './components/Modal.jsx';
import Toast from './components/Toast.jsx';
import Recherche from './screens/Recherche.jsx';
import Bibliotheque from './screens/Bibliotheque.jsx';
import Reglages from './screens/Reglages.jsx';
import Backup from './components/Backup.jsx';
import Detail from './components/Detail.jsx';
import Progression from './components/Progression.jsx';
import MaLecture from './screens/MaLecture.jsx';

const ONGLETS = [
  { cle: 'recherche', libelle: 'Recherche', icone: 'recherche' },
  { cle: 'lecture', libelle: 'Ma lecture', icone: 'livre' },
  { cle: 'bibliotheque', libelle: 'Bibliothèque', icone: 'bibliotheque' },
  { cle: 'reglages', libelle: 'Réglages', icone: 'reglages' },
];

/*
 * L'ACCUEIL EST « MA LECTURE », plus la recherche (mission V2, M1).
 *
 * L'application ouvrait sur un champ vide et un clavier — elle demandait ce
 * qu'on veut avant de dire ou on en est. Le projet series, lui, ouvre sur
 * « Ce soir » : il rappelle ce qu'on etait en train de regarder. L'ecran
 * equivalent existe ici depuis toujours et il est meilleur (En cours avec
 * progression, Tome suivant a lire, A paraitre) ; il etait seulement en
 * deuxieme position.
 *
 * Deux consequences, verifiees plutot que supposees :
 *  - le bouton retour d'Android suit « surcouche -> onglet -> ACCUEIL ->
 *    sortie » (§6). Depuis la Recherche, il ramene donc desormais a Ma lecture
 *    au lieu de quitter. C'est le comportement voulu : on ne sort plus de
 *    l'application par megarde en fermant une recherche ;
 *  - la Recherche reste MONTEE-MASQUEE au demarrage (tranche 3). Elle ne coute
 *    aucun appel reseau pour autant : au montage elle ne fait que verifier la
 *    presence du scanner et relire l'historique en base locale. Les
 *    suggestions, seules a interroger Google, sont a la demande (§4.6 pt 6).
 */
const ACCUEIL = 'lecture';

export default function App() {
  const [view, setView] = useState(ACCUEIL);
  const [etat, setEtat] = useState(null);
  const [nomProfil, setNomProfil] = useState('');
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark');
  const [bibliotheque, setBibliotheque] = useState([]);
  const [editionsSuivies, setEditionsSuivies] = useState(() => new Set());
  const [statutCible, setStatutCible] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [progressionId, setProgressionId] = useState(null);
  const [sauvegardeOuverte, setSauvegardeOuverte] = useState(false);
  const [quota, setQuota] = useState(null);

  /*
   * §9 prescrit une « Map du suivi en mémoire », héritée du projet séries, où
   * elle donnait l'appartenance en O(1) depuis n'importe quelle grille.
   * Elle ne se transpose PAS telle quelle ici : une carte de recherche ne
   * connaît pas encore son identifiant d'œuvre — le résoudre demanderait un
   * appel Open Library par résultat, ce que §4.3 interdit. L'équivalent utile
   * est donc un Set des clés d'ÉDITION, qui sont celles des résultats.
   * La Map par oeuvre_id reviendra quand un écran en aura l'usage (tranche 5).
   */
  const recharger = useCallback(async () => {
    try {
      /*
       * Le nom affiche vient du profil ACTIF, pas de `etatBase()`. Celui-ci
       * rend le profil cree d'office au premier demarrage : l'en-tete restait
       * donc bloque sur « Moi » meme apres avoir change de profil. C'est ce
       * qui donnait l'impression qu'on ne pouvait pas choisir.
       */
      const [livres, cles, etatBd, profil] = await Promise.all([
        getBibliotheque(), getClesEditions(), etatBase(), getProfilActif(),
      ]);
      setBibliotheque(livres);
      setEditionsSuivies(new Set(cles));
      setEtat(etatBd);
      setNomProfil(profil ? profil.name : '');
    } catch (e) {
      notify(`La bibliothèque n'a pas pu être lue : ${e.message}`);
    }
  }, []);

  useEffect(() => {
    demarrer()
      .then(recharger)
      .catch((e) => notify(`La base n'a pas pu s'ouvrir : ${e.message}`));
  }, [recharger]);

  /*
   * L'identification d'un livre ajoute se termine APRES l'ajout (voir api.js) :
   * quand elle aboutit, la cle de l'oeuvre change et l'ecran doit suivre.
   */
  useEffect(() => { surChangementDeFond(recharger); return () => surChangementDeFond(null); }, [recharger]);

  /* Relu a chaque affichage des Reglages : le compteur bouge a chaque recherche. */
  useEffect(() => {
    if (view !== 'reglages') return;
    quotaDuJour().then(setQuota).catch(() => setQuota(null));
  }, [view]);

  /*
   * Rend l'identifiant de l'oeuvre ajoutee. L'appel restait muet, ce qui
   * interdisait d'enchainer une action dessus — or l'appui long depuis la
   * recherche (retour d'usage 83) doit ajouter le livre PUIS lui poser un
   * statut. `ajouterOeuvre` est idempotent (INSERT OR IGNORE), donc un livre
   * deja suivi rend simplement sa cle existante.
   */
  const suivre = useCallback(async (resultat) => {
    try {
      const oeuvreId = await ajouterOeuvre(resultat);
      await recharger();
      /*
       * AUCUN message a l'ajout (retour d'usage 99 : « quand j'ajoute un livre
       * j'ai une notification qui apparait, j'en veux pas »). Le retour visuel
       * existe deja et se suffit : la carte se marque d'une pastille, et le
       * livre est dans la bibliotheque. Un bandeau qui recouvre l'ecran pour
       * annoncer ce qu'on vient de faire soi-meme n'apprend rien.
       * Les ERREURS, elles, continuent de parler.
       */
      return oeuvreId;
    } catch (e) {
      notify(`Impossible d'ajouter ce livre : ${e.message}`);
      return null;
    }
  }, [recharger]);

  const changerStatut = useCallback(async (oeuvreId, statut) => {
    setStatutCible(null);
    try {
      await setStatut(oeuvreId, statut);
      await recharger();
    } catch (e) {
      notify(`Le statut n'a pas pu être changé : ${e.message}`);
    }
  }, [recharger]);

  /*
   * La fiche est désignée par son identifiant, pas par une copie de l'objet :
   * après un rattachement ou un retrait, l'œuvre disparaît de la bibliothèque
   * et la fiche se ferme d'elle-même, au lieu d'afficher un livre qui n'existe
   * plus.
   */
  const detailCible = useMemo(
    () => bibliotheque.find((o) => o.oeuvreId === detailId) || null,
    [bibliotheque, detailId],
  );

  const progressionCible = useMemo(
    () => bibliotheque.find((o) => o.oeuvreId === progressionId) || null,
    [bibliotheque, progressionId],
  );

  const basculerTheme = useCallback(() => {
    const suivant = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = suivant;
    localStorage.setItem('theme', suivant);
    setTheme(suivant);
  }, [theme]);

  /*
   * Bouton retour Android (§6) : overlay -> onglet -> onglet d'accueil -> sortie.
   * Ré-abonné à chaque changement d'état d'affichage, sinon il travaille sur
   * des valeurs figées et quitte l'application au premier appui.
   */
  useEffect(() => {
    const abonnement = CapApp.addListener('backButton', () => {
      if (document.querySelector('.sheet')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      } else if (view !== ACCUEIL) {
        setView(ACCUEIL);
      } else {
        CapApp.exitApp();
      }
    });
    return () => { abonnement.then((a) => a.remove()); };
  }, [view]);

  // Un seul objet passé à toutes les grilles, hérité du projet séries.
  const cardProps = useMemo(
    () => ({ onOuvrir: (o) => setDetailId(o.oeuvreId), onAppuiLong: setStatutCible }),
    [],
  );

  return (
    <>
      <header className="appbar">
        <span className="appbar__marque">Vault Read</span>
        {nomProfil ? <span className="appbar__profil">{nomProfil}</span> : null}
      </header>

      <main className="content">
        {/*
          L'ECRAN DE RECHERCHE N'EST PLUS DEMONTE (retour d'usage 123, tranche 3).
          « J'ai l'impression que rien n'est mis en cache, tout doit recharger a
          chaque fois. » Le cache fonctionnait pourtant : c'est l'ecran qui
          disparaissait. Monte sous condition d'onglet comme les autres, il
          etait DETRUIT a chaque changement — resultats, pages defilees, tri et
          position perdus —, et l'on repartait de la premiere page.
          On le masque desormais au lieu de le supprimer. Il est le seul dans ce
          cas : les autres ecrans lisent la base, qui ne bouge pas sous eux, et
          les remonter ne coute rien.
        */}
        <div className={view === 'recherche' ? undefined : 'ecran--masque'}>
          <Recherche
            actif={view === 'recherche'}
            editionsSuivies={editionsSuivies}
            onSuivre={suivre}
            onChangement={recharger}
          />
        </div>

        {view === 'lecture' && (
          <MaLecture
            bibliotheque={bibliotheque}
            cardProps={cardProps}
            onProgression={(o) => setProgressionId(o.oeuvreId)}
          />
        )}

        {view === 'bibliotheque' && (
          <Bibliotheque bibliotheque={bibliotheque} cardProps={cardProps} />
        )}

        {view === 'reglages' && (
          <Reglages
            theme={theme}
            basculerTheme={basculerTheme}
            bibliotheque={bibliotheque}
            quota={quota}
            etat={etat}
            setSauvegardeOuverte={setSauvegardeOuverte}
            recharger={recharger}
          />
        )}
      </main>

      <nav className="tabbar">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            type="button"
            className={`tabbar__item${view === o.cle ? ' is-active' : ''}`}
            onClick={() => setView(o.cle)}
            aria-current={view === o.cle ? 'page' : undefined}
          >
            <Icon name={o.icone} size={22} />
            <span>{o.libelle}</span>
          </button>
        ))}
      </nav>

      {/* Appui long sur une carte : changement de statut direct (§6). */}
      {statutCible && (
        <Modal titre={statutCible.titre} onFermer={() => setStatutCible(null)}>
          <p className="hint">Où en es-tu de ce livre ?</p>
          <div className="statuts">
            {STATUTS.map((s) => (
              <button
                key={s}
                type="button"
                className={`statbtn ${classeStatut(s)}${statutCible.statut === s ? ' is-active' : ''}`}
                onClick={() => changerStatut(statutCible.oeuvreId, s)}
              >
                <span className="statbtn__led" />
                <span>{LIBELLES[s]}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {detailCible && !progressionCible && (
        <Detail
          oeuvre={detailCible}
          bibliotheque={bibliotheque}
          onFerme={() => setDetailId(null)}
          onChange={recharger}
          onProgression={() => setProgressionId(detailCible.oeuvreId)}
        />
      )}

      {progressionCible && (
        <Progression
          oeuvre={progressionCible}
          onFerme={() => setProgressionId(null)}
          onChange={recharger}
        />
      )}

      {sauvegardeOuverte && (
        <Backup
          onFerme={() => setSauvegardeOuverte(false)}
          onRestaure={async (profileId) => { await setActiveProfileId(profileId); await recharger(); }}
        />
      )}

      <Toast />
    </>
  );
}
