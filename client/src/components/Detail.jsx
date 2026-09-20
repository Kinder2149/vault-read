/*
 * Detail.jsx — la fiche d'un livre suivi, en overlay. Applique §6.
 * Ordre imposé par le contexte : couverture et titre → statut → éditions et
 * édition active → résumé → zone « Identification » en bas.
 * Ordre reel : statut -> editions -> PROGRESSION -> resume ->
 * identification. Les listes arrivent en tranche 6.
 * Applique §3.2 : les deux rattrapages d'identité vivent ici, parce que
 * l'identité est faillible dans les deux sens — l'empreinte peut créer deux
 * œuvres pour un même livre, et un ISBN réutilisé peut en fusionner deux.
 * Piège évité : « Rattacher » et « Retirer » sont irréversibles hors
 * sauvegarde ; chacun passe par un Modal qui dit ce qui est perdu (§6).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getEditions, setStatut, setEditionActive, ajouterEdition,
  supprimerEdition, detacherEdition, regrouperOeuvres, retirerOeuvre, rechercher, setCouverture,
  getEditionsProposees, setAvis,
  ajouterEditionManuelle, getListes, getListesDeLOeuvre, addToListe,
  removeFromListe, createListe,
} from '../api.js';
import { LIBELLES, STATUTS, classeStatut, progressionDe } from '../status.js';
import { lireImageReduite } from '../files.js';
import { notify } from '../notify.js';
import Modal from './Modal.jsx';
import Icon from './Icon.jsx';
import CouvertureDessinee from './CouvertureDessinee.jsx';
import EditionPicker from './EditionPicker.jsx';
import Avis from './Avis.jsx';
import ProgressBar from './ProgressBar.jsx';

export default function Detail({ oeuvre, bibliotheque, onFerme, onChange, onProgression }) {
  const [editions, setEditions] = useState([]);
  const [sousModale, setSousModale] = useState(null); // {type, cible}
  const [recherche, setRecherche] = useState({ texte: '', resultats: [], etat: 'vide' });
  const [filtreCible, setFiltreCible] = useState('');
  const [listes, setListes] = useState([]);
  const [mesListes, setMesListes] = useState([]);
  const [nouvelleListe, setNouvelleListe] = useState('');
  const [saisieManuelle, setSaisieManuelle] = useState({ titre: '', format: 'audio', nbPages: '', dureeMinutes: '' });

  const locale = String(oeuvre.oeuvreId).startsWith('fp:');

  const charger = useCallback(async () => {
    try {
      const [e, l, m] = await Promise.all([
        getEditions(oeuvre.oeuvreId), getListes(), getListesDeLOeuvre(oeuvre.oeuvreId),
      ]);
      setEditions(e);
      setListes(l);
      setMesListes(m);
    } catch (err) {
      notify(err.message);
    }
  }, [oeuvre.oeuvreId]);

  useEffect(() => { charger(); }, [charger]);

  // Toute écriture recharge la bibliothèque entière (§9) : brutal, mais aucune
  // désynchronisation possible entre la fiche et la grille derrière.
  const agir = useCallback(async (action, message) => {
    try {
      await action();
      await charger();
      await onChange();
      if (message) notify(message, 'info');
    } catch (err) {
      notify(err.message);
    }
  }, [charger, onChange]);


  const chercherEdition = async (texte) => {
    setRecherche((r) => ({ ...r, texte, etat: 'charge' }));
    try {
      const chiffres = texte.replace(/[^0-9Xx]/g, '');
      const mode = chiffres.length >= 10 ? 'isbn' : 'titre';
      const resultats = await rechercher(mode === 'isbn' ? chiffres : texte, mode);
      setRecherche({ texte, resultats, etat: 'fait' });
    } catch (err) {
      setRecherche((r) => ({ ...r, etat: 'vide' }));
      notify(err.message);
    }
  };

  const ciblesPossibles = useMemo(
    () => bibliotheque
      .filter((o) => o.oeuvreId !== oeuvre.oeuvreId)
      .filter((o) => o.titre.toLowerCase().includes(filtreCible.toLowerCase())),
    [bibliotheque, oeuvre.oeuvreId, filtreCible],
  );

  /*
   * Les editions proposees par les catalogues. Chargees a l'OUVERTURE de la
   * modale et non de la fiche : une recherche d'editions coute une requete, et
   * toutes les fiches ne s'ouvrent pas pour cela.
   *
   * DECLARE ICI, avant le `if (sousModale)` qui suit : ce dernier fait un
   * retour anticipe, et un hook place apres n'aurait jamais ete initialise —
   * « Cannot access 'propositions' before initialization », constate a
   * l'ouverture de la modale. Les hooks React s'appellent tous, toujours,
   * avant le moindre `return`.
   */
  const [propositions, setPropositions] = useState({ etat: 'vide', liste: [] });
  const [ajoutees, setAjoutees] = useState(new Set());
  const [imagesCassees, setImagesCassees] = useState(new Set());

  useEffect(() => {
    if (!sousModale || sousModale.type !== 'ajout') return;
    setPropositions({ etat: 'charge', liste: [] });
    getEditionsProposees(oeuvre.oeuvreId)
      .then((liste) => setPropositions({ etat: 'fait', liste }))
      .catch(() => setPropositions({ etat: 'fait', liste: [] }));
  }, [sousModale, oeuvre.oeuvreId]);

  /*
   * Prendre une edition SANS refermer : on en possede souvent plusieurs.
   * La coche reste, pour qu'on voie ce qu'on vient de choisir.
   */
  const prendreEdition = async (r) => {
    setAjoutees((avant) => new Set(avant).add(r.cleSource));
    try {
      await ajouterEdition(oeuvre.oeuvreId, r);
      /*
       * DEUX rechargements, et non un seul. `onChange()` rafraichit la
       * bibliotheque d'App, mais la liste d'editions de CETTE fiche a son
       * propre chargement : sans `charger()`, l'edition ajoutee n'apparaissait
       * qu'apres avoir touche autre chose. Retour d'usage 110 : « j'ajoute une
       * edition mais c'est pas pris en compte, j'ai du appuyer sur l'edition
       * actuelle pour que ca charge ».
       */
      await charger();
      await onChange();
    } catch (e) {
      setAjoutees((avant) => {
        const apres = new Set(avant);
        apres.delete(r.cleSource);
        return apres;
      });
      notify(e.message);
    }
  };

  const fermerSous = () => { setSousModale(null); setRecherche({ texte: '', resultats: [], etat: 'vide' }); };

  // --- sous-modales -------------------------------------------------------
  if (sousModale) {
    const { type, cible } = sousModale;

    if (type === 'ajout') {
      return (
        <Modal titre="Quelle édition as-tu ?" onFermer={fermerSous}>
          {/*
            Retour d'usage 109 : « j'aimerais que les editions associees
            s'affichent et qu'on puisse choisir celle qu'on a (une ou
            plusieurs) ». Il fallait auparavant les CHERCHER une par une, en
            tapant leur titre — alors que le catalogue sait les lister.
            La modale reste ouverte apres chaque choix : on en possede souvent
            plusieurs, et refermer apres la premiere obligerait a tout
            recommencer.
          */}
          <p className="hint">
            Coche les exemplaires que tu possèdes. Tu peux en choisir plusieurs
            — un poche et un grand format, par exemple.
          </p>

          {propositions.etat === 'charge' && <p className="hint">Recherche des éditions…</p>}

          {propositions.etat === 'fait' && propositions.liste.length === 0 && (
            <p className="hint">
              Aucune autre édition trouvée dans les catalogues. Tu peux la
              saisir à la main ci-dessous.
            </p>
          )}

          {propositions.liste.map((r) => {
            const prise = ajoutees.has(r.cleSource);
            return (
              <button
                key={r.cleSource}
                type="button"
                className={`ligne-resultat${prise ? ' ligne-resultat--prise' : ''}`}
                disabled={prise}
                onClick={() => prendreEdition(r)}
              >
                {/* La vignette d'abord : c'est elle qui fait reconnaitre
                    l'exemplaire qu'on a en main (retour d'usage 117). */}
                <span className="edition__vignette">
                  {/*
                    `onError` comme partout ailleurs dans le projet : une
                    adresse d'image peut ne plus repondre, et sans ce repli la
                    ligne restait VIDE — constate sur une edition sur onze.
                  */}
                  {r.couvertureUrl && !imagesCassees.has(r.cleSource) ? (
                    <img
                      src={r.couvertureUrl}
                      alt=""
                      loading="lazy"
                      onError={() => setImagesCassees((avant) => new Set(avant).add(r.cleSource))}
                    />
                  ) : (
                    <CouvertureDessinee titre={r.titre} auteur={r.editeur} />
                  )}
                </span>
                <b>{r.editeur || r.titre}</b>
                <span>
                  {[r.annee, r.isbn13 || r.isbn10, r.nbPages ? `${r.nbPages} p.` : null]
                    .filter(Boolean).join(' · ')}
                </span>
                {prise ? <Icon name="valider" size={18} /> : <Icon name="plus" size={18} />}
              </button>
            );
          })}

          <h3 className="soustitre soustitre--serre">Ou cherche toi-même</h3>
          <p className="hint">
            Par son ISBN au dos, ou par son titre. Il rejoindra ce livre sans
            créer de doublon.
          </p>
          <div className="champ">
            <Icon name="recherche" size={20} className="champ__icone" />
            <input
              className="champ__saisie"
              value={recherche.texte}
              onChange={(e) => chercherEdition(e.target.value)}
              placeholder="ISBN ou titre"
              aria-label="Chercher une édition"
              autoFocus
            />
          </div>
          {recherche.etat === 'charge' && <p className="hint">Recherche…</p>}
          {/* §5.5 : ni Google ni Open Library ne cataloguent l'audio.
              Une edition audio est TOUJOURS saisie a la main. */}
          <button
            type="button"
            className="ligne-resultat"
            onClick={() => setSousModale({ type: 'manuelle' })}
          >
            <b>Saisir un exemplaire à la main</b>
            <span>Livre audio, VO, exemplaire non catalogué — aucune recherche</span>
          </button>
          {recherche.resultats.map((r) => (
            <button
              key={r.cleSource}
              type="button"
              className="ligne-resultat"
              onClick={() => prendreEdition(r)}
            >
              <b>{r.titre}</b>
              <span>{[r.editeur, r.annee, r.nbPages ? `${r.nbPages} p.` : null].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </Modal>
      );
    }

    if (type === 'manuelle') {
      const audio = saisieManuelle.format === 'audio';
      return (
        <Modal
          titre="Saisir un exemplaire"
          onFermer={fermerSous}
          actions={(
            <>
              <button type="button" className="btn btn--fantome" onClick={fermerSous}>Annuler</button>
              <button
                type="button"
                className="btn btn--primaire"
                onClick={() => {
                  if (!saisieManuelle.titre.trim()) { notify('Donne au moins un titre.'); return; }
                  fermerSous();
                  agir(() => ajouterEditionManuelle(oeuvre.oeuvreId, {
                    titre: saisieManuelle.titre.trim(),
                    auteurs: oeuvre.auteurs,
                    format: saisieManuelle.format,
                    nbPages: saisieManuelle.nbPages ? Number(saisieManuelle.nbPages) : null,
                    dureeMinutes: saisieManuelle.dureeMinutes ? Number(saisieManuelle.dureeMinutes) : null,
                  }), 'Exemplaire ajouté.');
                }}
              >
                Ajouter
              </button>
            </>
          )}
        >
          <p className="hint">
            Les livres audio ne sont catalogués correctement nulle part : ils se
            saisissent ici. La progression s’exprimera alors en minutes.
          </p>
          <input
            className="champ__saisie champ__saisie--encadre"
            value={saisieManuelle.titre}
            onChange={(e) => setSaisieManuelle((v) => ({ ...v, titre: e.target.value }))}
            placeholder="Titre de cet exemplaire"
            aria-label="Titre"
            autoFocus
          />
          <div className="seg" role="group" aria-label="Format">
            {['papier', 'numerique', 'audio'].map((f) => (
              <button
                key={f}
                type="button"
                className={`seg__item${saisieManuelle.format === f ? ' on' : ''}`}
                onClick={() => setSaisieManuelle((v) => ({ ...v, format: f }))}
              >
                {f === 'papier' ? 'Papier' : (f === 'numerique' ? 'Numérique' : 'Audio')}
              </button>
            ))}
          </div>
          <input
            className="champ__saisie champ__saisie--encadre"
            type="number"
            min="1"
            inputMode="numeric"
            value={audio ? saisieManuelle.dureeMinutes : saisieManuelle.nbPages}
            onChange={(e) => setSaisieManuelle((v) => (
              audio ? { ...v, dureeMinutes: e.target.value } : { ...v, nbPages: e.target.value }
            ))}
            placeholder={audio ? 'Durée en minutes (facultatif)' : 'Nombre de pages (facultatif)'}
            aria-label={audio ? 'Durée en minutes' : 'Nombre de pages'}
          />
        </Modal>
      );
    }

    if (type === 'rattacher') {
      return (
        <Modal titre="Réunir deux livres de ma bibliothèque" onFermer={fermerSous}>
          {/*
            Le libelle disait « Rattacher a une oeuvre existante ». Retour
            d'usage 108 : « on rattache a notre base de donnee, notre
            bibliotheque » — « oeuvre existante » evoquait un catalogue
            exterieur, alors qu'il s'agit de reunir DEUX livres qu'on possede
            deja et qui sont en double.
          */}
          <p className="hint">
            Ces deux livres sont en double dans <b>ta bibliothèque</b> ? Choisis
            celui à garder. <b>C’est lui qui gagne</b> : son statut, sa note et
            sa progression sont conservés, et celui-ci lui apporte ses éditions
            avant de disparaître.
          </p>
          <div className="champ">
            <Icon name="recherche" size={20} className="champ__icone" />
            <input
              className="champ__saisie"
              value={filtreCible}
              onChange={(e) => setFiltreCible(e.target.value)}
              placeholder="Filtrer ma bibliothèque"
              aria-label="Filtrer"
            />
          </div>
          {ciblesPossibles.length === 0 ? (
            <p className="hint">Aucun autre livre ne correspond.</p>
          ) : ciblesPossibles.slice(0, 30).map((o) => (
            <button
              key={o.oeuvreId}
              type="button"
              className="ligne-resultat"
              onClick={() => { fermerSous(); onFerme(); agir(() => regrouperOeuvres(oeuvre.oeuvreId, o.oeuvreId), 'Les deux livres n’en font plus qu’un.'); }}
            >
              <b>{o.titre}</b>
              <span>{[(o.auteurs || '').split(',')[0], o.annee].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </Modal>
      );
    }

    if (type === 'detacher' || type === 'supprimerEdition') {
      const detache = type === 'detacher';
      return (
        <Modal
          titre={detache ? 'Détacher cette édition' : 'Supprimer cette édition'}
          danger
          onFermer={fermerSous}
          actions={(
            <>
              <button type="button" className="btn btn--fantome" onClick={fermerSous}>Annuler</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  fermerSous();
                  agir(
                    () => (detache ? detacherEdition(cible.editionId) : supprimerEdition(cible.editionId)),
                    detache ? 'Édition détachée : elle forme un livre à part.' : 'Édition supprimée.',
                  );
                }}
              >
                {detache ? 'Détacher' : 'Supprimer'}
              </button>
            </>
          )}
        >
          <p className="hint">
            {detache
              ? `« ${cible.titre} » deviendra un livre séparé, avec son propre suivi. À faire quand cette édition n’a en réalité rien à voir avec ce texte — un même ISBN est parfois réutilisé pour deux ouvrages sans rapport.`
              : `« ${cible.titre} » sera retirée de ce livre. Le livre lui-même et ses autres éditions restent.`}
          </p>
        </Modal>
      );
    }

    if (type === 'retrait') {
      return (
        <Modal
          titre="Retirer ce livre"
          danger
          onFermer={fermerSous}
          actions={(
            <>
              <button type="button" className="btn btn--fantome" onClick={fermerSous}>Annuler</button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => { fermerSous(); onFerme(); agir(() => retirerOeuvre(oeuvre.oeuvreId), 'Livre retiré.'); }}
              >
                Retirer
              </button>
            </>
          )}
        >
          <p className="hint">
            « {oeuvre.titre} » sortira de ta bibliothèque avec{' '}
            {editions.length === 1 ? 'son édition' : `ses ${editions.length} éditions`},
            son statut et sa progression. C’est irréversible tant qu’il n’y a pas
            de sauvegarde.
          </p>
        </Modal>
      );
    }
  }

  // --- fiche --------------------------------------------------------------
  /*
   * L'image est reduite a 400 px AVANT d'entrer en base (voir files.js) : une
   * photo de telephone brute rendrait le fichier de sauvegarde intransportable.
   *
   * ATTENTION : cette fonction a ete inseree PAR ERREUR a l'interieur d'une
   * autre le 2026-08-21 (tranche 11), ce qui la rendait invisible depuis le
   * rendu principal. La fiche de detail plantait donc a l'ouverture — sur
   * trois versions livrees, sans que le build ni les verifications ne le
   * voient : c'est une erreur d'EXECUTION, pas de compilation, et aucune
   * verification n'ouvrait alors la fiche de detail.
   */
  const choisirCouverture = async () => {
    try {
      const image = await lireImageReduite();
      if (!image) return;                 // l'utilisateur a referme le selecteur
      await setCouverture(oeuvre.oeuvreId, image);
      await onChange();
      notify('Couverture enregistrée.', 'info');
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <Modal
      titre={oeuvre.titre}
      onFermer={onFerme}
      actions={(
        <>
          <button type="button" className="btn btn--fantome" onClick={() => setSousModale({ type: 'retrait' })}>
            Retirer
          </button>
          <button type="button" className="btn btn--primaire" onClick={onFerme}>Fermer</button>
        </>
      )}
    >
      <div className="fiche__entete">
        {/*
          Retour d'usage 84 : « si j'ai pas de couverture je veux pouvoir en
          ajouter une moi-meme ». Google n'illustre que 65 % des resultats et
          le repli Open Library ne monte qu'a 75 % : pour le dernier quart,
          aucune source ne viendra jamais. La photo du livre pose sur la table
          est alors la meilleure couverture possible.
          Le bouton est sur la couverture elle-meme, la ou le manque se voit.
        */}
        <div className="fiche__couverture">
          {oeuvre.couvertureUrl
            ? <img src={oeuvre.couvertureUrl} alt="" loading="lazy" />
            : <CouvertureDessinee titre={oeuvre.titre} auteur={oeuvre.auteurs} />}
          <button
            type="button"
            className="fiche__couverture-action"
            onClick={choisirCouverture}
          >
            <Icon name="image" size={14} />
            <span>{oeuvre.couvertureUrl ? 'Remplacer' : 'Ajouter une photo'}</span>
          </button>
        </div>
        <div className="fiche__resume-tete">
          <p className="fiche__auteurs">{oeuvre.auteurs || 'Auteur inconnu'}</p>
          {oeuvre.annee ? <p className="fiche__annee">{oeuvre.annee}</p> : null}
          {oeuvre.cycleNom ? (
            <p className="fiche__cycle">
              {oeuvre.cycleNom}{oeuvre.cycleTome ? `, tome ${oeuvre.cycleTome}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      <div className="statuts statuts--ligne">
        {STATUTS.map((s) => (
          <button
            key={s}
            type="button"
            className={`statbtn ${classeStatut(s)}${oeuvre.statut === s ? ' is-active' : ''}`}
            onClick={() => agir(() => setStatut(oeuvre.oeuvreId, s))}
          >
            <span className="statbtn__led" />
            <span>{LIBELLES[s]}</span>
          </button>
        ))}
      </div>

      <EditionPicker
        editions={editions}
        editionActive={oeuvre.editionActive}
        onChoisir={(id) => agir(() => setEditionActive(oeuvre.oeuvreId, id))}
        onAjouter={() => setSousModale({ type: 'ajout' })}
        onDetacher={(e) => setSousModale({ type: 'detacher', cible: e })}
        onSupprimer={(e) => setSousModale({ type: 'supprimerEdition', cible: e })}
      />

      {/* §6 : la progression vient APRES l'edition active, parce que c'est
          elle qui donne la metrique. */}
      <div className="progression-bloc">
        <ProgressBar progression={progressionDe(oeuvre)} />
        <button type="button" className="btn btn--large" onClick={onProgression}>
          <Icon name="livre" size={16} />
          <span>J’en suis à…</span>
        </button>
      </div>

      {/*
        Mon avis, juste apres la progression : on note un livre quand on vient
        d'avancer dedans ou de le terminer, pas au moment de le ranger.
      */}
      <Avis
        note={oeuvre.note}
        commentaire={oeuvre.commentaire}
        onEnregistrer={(note, texte) => agir(
          () => setAvis(oeuvre.oeuvreId, note, texte),
          null,
        )}
      />


      {/* Listes personnalisees (tranche 6) : cocher / decocher, creation a la
          volee. Une liste ne change jamais le statut du livre. */}
      <div className="listes">
        <h3 className="soustitre soustitre--serre">Mes listes</h3>
        <div className="listes__puces">
          {listes.map((l) => {
            const dedans = mesListes.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                className={`chip${dedans ? ' on' : ''}`}
                onClick={() => agir(() => (dedans
                  ? removeFromListe(l.id, oeuvre.oeuvreId)
                  : addToListe(l.id, oeuvre.oeuvreId)))}
                aria-pressed={dedans}
              >
                {dedans ? <Icon name="valider" size={14} /> : null}
                <span>{l.name}</span>
              </button>
            );
          })}
        </div>
        <div className="cycle__saisie">
          <input
            className="champ__saisie champ__saisie--encadre"
            value={nouvelleListe}
            onChange={(e) => setNouvelleListe(e.target.value)}
            placeholder="Nouvelle liste"
            aria-label="Nom de la nouvelle liste"
          />
          <button
            type="button"
            className="btn btn--fantome"
            onClick={() => {
              if (!nouvelleListe.trim()) return;
              const nom = nouvelleListe.trim();
              setNouvelleListe('');
              agir(async () => { await createListe(nom); }, `Liste « ${nom} » créée.`);
            }}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>

      {oeuvre.resume ? (
        <>
          <h3 className="soustitre soustitre--serre">Résumé</h3>
          <p className="fiche__resume">{oeuvre.resume}</p>
        </>
      ) : null}

      <div className={`identite${locale ? '' : ' identite--ok'}`}>
        <div className="identite__tete">
          <Icon name={locale ? 'alerte' : 'valider'} size={18} />
          <b>{locale ? 'Identification incomplète' : 'Œuvre identifiée'}</b>
        </div>
        <p className="identite__cle">{oeuvre.oeuvreId}</p>
        <p className="identite__detail">
          {locale
            ? 'Ce livre n’a pas été reconnu par Open Library. S’il apparaît deux fois dans ta bibliothèque, tu peux réunir les deux ci-dessous.'
            : 'Open Library a reconnu ce texte : ses autres éditions peuvent le rejoindre.'}
        </p>
        <button type="button" className="btn btn--large" onClick={() => setSousModale({ type: 'rattacher' })}>
          C’est le même livre qu’un autre de ma bibliothèque
        </button>
      </div>
    </Modal>
  );
}
