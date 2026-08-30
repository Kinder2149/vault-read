/*
 * Bibliotheque.jsx — la bibliothèque du profil : grille 2×2 des 4 statuts avec
 * compteurs, puis les livres. Applique §6.
 * Les livres non encore parus sont EXCLUS du décompte « À lire » mais restent
 * visibles dans leur propre section (§5.2, estAParaitre).
 * N'importe que api.js, status.js et ses composants (§2, règle 1).
 * Piège évité : le texte d'état vide dit QUOI FAIRE ensuite, il ne constate
 * pas le vide — c'est le point le plus réutilisable du projet séries.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIBELLES, STATUTS, classeStatut, estEnAttenteDeParution } from '../status.js';
import { getListes, getListeItems, deleteListe } from '../api.js';
import { notify } from '../notify.js';
import BookCard from '../components/BookCard.jsx';
import Modal from '../components/Modal.jsx';
import Statistiques from '../components/Statistiques.jsx';

const FORMATS = [
  { cle: 'tout', libelle: 'Tout' },
  { cle: 'papier', libelle: 'Papier' },
  { cle: 'numerique', libelle: 'Numérique' },
  { cle: 'audio', libelle: 'Audio' },
];

export default function Bibliotheque({ bibliotheque, cardProps }) {
  const [statutActif, setStatutActif] = useState(null);
  const [format, setFormat] = useState('tout');
  const [listes, setListes] = useState([]);
  const [listeActive, setListeActive] = useState(null);
  const [contenuListe, setContenuListe] = useState([]);
  const [aSupprimer, setASupprimer] = useState(null);

  const chargerListes = useCallback(async () => {
    try { setListes(await getListes()); } catch (e) { notify(e.message); }
  }, []);

  useEffect(() => { chargerListes(); }, [chargerListes, bibliotheque]);

  useEffect(() => {
    if (!listeActive) { setContenuListe([]); return; }
    getListeItems(listeActive.id).then(setContenuListe).catch((e) => notify(e.message));
  }, [listeActive, bibliotheque]);

  const { compteurs, aParaitre, visibles } = useMemo(() => {
    /*
     * Un livre n'est mis de cote QUE s'il est encore « à lire » ET pas sorti
     * (§status.js). Avant cette regle, un livre marque « Lu » mais date de
     * l'annee en cours disparaissait de la bibliotheque ET de ses compteurs.
     */
    const paraitre = bibliotheque.filter((o) => estEnAttenteDeParution(o));
    const parus = bibliotheque.filter((o) => !estEnAttenteDeParution(o));

    const c = {};
    STATUTS.forEach((s) => { c[s] = parus.filter((o) => o.statut === s).length; });

    // Le filtre porte sur le format de l'ÉDITION ACTIVE (§6) : il répond à
    // « sur quel support je le lis », pas « sous quels supports je le possède ».
    const parFormat = (o) => format === 'tout' || (o.format || 'papier') === format;

    let liste = statutActif ? parus.filter((o) => o.statut === statutActif) : parus;
    liste = liste.filter(parFormat);

    /*
     * La section « Pas encore paru » suivait sa propre route et ignorait les
     * filtres : sur quatre livres papier, toucher « Audio » en affichait
     * quand meme un. Elle obeit desormais au filtre de format comme le reste.
     */
    return { compteurs: c, aParaitre: paraitre.filter(parFormat), visibles: liste };
  }, [bibliotheque, statutActif, format]);

  /*
   * Le filtre de format ne s'affiche que s'il sert a quelque chose. Sur une
   * bibliotheque entierement papier — le cas de presque tout le monde — ses
   * quatre boutons occupaient une ligne entiere pour rien, et faisaient se
   * demander pourquoi l'application parle de livres audio.
   */
  const formatsPresents = useMemo(
    () => new Set(bibliotheque.map((o) => o.format || 'papier')),
    [bibliotheque],
  );
  const filtreFormatUtile = formatsPresents.size > 1;

  if (bibliotheque.length === 0) {
    return (
      <p className="hint">
        Ta bibliothèque est vide. Va dans Recherche, trouve un livre, ouvre-le
        et touche « Suivre » : il apparaîtra ici.
      </p>
    );
  }

  return (
    <section className="biblio">
      <div className="biblio__statuts">
        {STATUTS.map((s) => (
          <button
            key={s}
            type="button"
            className={`pave ${classeStatut(s)}${statutActif === s ? ' is-active' : ''}`}
            onClick={() => setStatutActif(statutActif === s ? null : s)}
            aria-pressed={statutActif === s}
          >
            <span className="pave__pastille" />
            <span className="pave__libelle">{LIBELLES[s]}</span>
            <span className="pave__compte">{compteurs[s]}</span>
          </button>
        ))}
      </div>

      {filtreFormatUtile && (
      <div className="seg" role="group" aria-label="Filtre de format">
        {FORMATS.map((f) => (
          <button
            key={f.cle}
            type="button"
            className={`seg__item${format === f.cle ? ' on' : ''}`}
            onClick={() => setFormat(f.cle)}
            aria-pressed={format === f.cle}
          >
            {f.libelle}
          </button>
        ))}
      </div>
      )}

      {/* Listes personnalisees : des puces, apres les statuts (§6). */}
      {listes.length > 0 && (
        <div className="listes__puces">
          {listes.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`chip${listeActive && listeActive.id === l.id ? ' on' : ''}`}
              onClick={() => setListeActive(listeActive && listeActive.id === l.id ? null : l)}
              onContextMenu={(e) => { e.preventDefault(); setASupprimer(l); }}
            >
              <span>{l.name}</span>
              <span className="chip__compte">{l.compte}</span>
            </button>
          ))}
        </div>
      )}

      {listeActive && (
        <div className="liste-ouverte">
          <div className="editions__tete">
            <h2 className="soustitre soustitre--serre">{listeActive.name}</h2>
            <button type="button" className="btn btn--fantome btn--mini" onClick={() => setASupprimer(listeActive)}>
              Supprimer la liste
            </button>
          </div>
          {contenuListe.length === 0 ? (
            <p className="hint">
              Cette liste est vide. Ouvre un livre et coche cette liste dans sa
              fiche pour l’y mettre.
            </p>
          ) : (
            <div className="grille">
              {contenuListe.map((o) => (
                <BookCard key={o.oeuvreId} resultat={o} suivi={o} {...cardProps} />
              ))}
            </div>
          )}
        </div>
      )}

      {aSupprimer && (
        <Modal
          titre="Supprimer cette liste"
          danger
          onFermer={() => setASupprimer(null)}
          actions={(
            <>
              <button type="button" className="btn btn--fantome" onClick={() => setASupprimer(null)}>
                Annuler
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={async () => {
                  const cible = aSupprimer;
                  setASupprimer(null);
                  if (listeActive && listeActive.id === cible.id) setListeActive(null);
                  try {
                    await deleteListe(cible.id);
                    await chargerListes();
                    notify(`Liste « ${cible.name} » supprimée.`, 'info');
                  } catch (e) { notify(e.message); }
                }}
              >
                Supprimer
              </button>
            </>
          )}
        >
          <p className="hint">
            « {aSupprimer.name} » disparaîtra. <b>Les livres qu’elle contient
            restent dans ta bibliothèque</b> : une liste n’est qu’un
            regroupement, pas un rangement.
          </p>
        </Modal>
      )}

      {!listeActive && (visibles.length === 0 ? (
        <p className="hint">
          Aucun livre pour ce filtre. Touche à nouveau le statut sélectionné
          pour revoir toute la bibliothèque.
        </p>
      ) : (
        <div className="grille">
          {visibles.map((o) => (
            <BookCard key={o.oeuvreId} resultat={o} suivi={o} {...cardProps} />
          ))}
        </div>
      ))}

      {aParaitre.length > 0 && (
        <>
          <h2 className="soustitre">Pas encore paru</h2>
          <p className="hint">
            Ces livres ne comptent pas dans « À lire » tant qu’ils ne sont pas
            sortis.
          </p>
          <div className="grille">
            {aParaitre.map((o) => (
              <BookCard key={o.oeuvreId} resultat={o} suivi={o} {...cardProps} />
            ))}
          </div>
        </>
      )}

      {/*
        LES STATISTIQUES VIVENT ICI, en bas de la bibliotheque, et non dans un
        cinquieme onglet : la barre en porte deja quatre et un de plus la serre
        sur un telephone. C'est aussi l'endroit ou l'on regarde deja sa
        collection. Elles ne s'affichent QUE hors d'une liste personnalisee :
        elles decrivent toute la bibliotheque, pas la liste consultee, et les
        montrer sous « Mes classiques » ferait croire qu'elles s'y rapportent.
      */}
      {!listeActive && <Statistiques bibliotheque={bibliotheque} />}
    </section>
  );
}
