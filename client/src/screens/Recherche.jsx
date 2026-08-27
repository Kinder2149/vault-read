/*
 * Recherche.jsx — l'écran de recherche. Écran à part dès le premier jour :
 * le projet séries l'avait écrit dans App.jsx, qui a fini à 656 lignes (§2.2).
 * N'importe que api.js et ses composants (§2, règle 1).
 * Applique §4.7 : compteur de séquence anti-course sur la frappe — trois
 * lignes qui remplacent une librairie de requêtes, hérité tel quel.
 * Ouvrir un résultat déclenche l'identification Open Library ; jamais pendant
 * la frappe (§4.3, quota). Suivre un livre ne pose AUCUNE question (§9).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  rechercherAvecEtat, identifierResultat, getSuggestions, scanDisponible, scannerIsbn,
  fusionnerResultats,
  getHistoriqueRecherches, effacerHistoriqueRecherches,
  creerOeuvreManuelle, setStatut,
} from '../api.js';
import { LIBELLES, STATUTS, classeStatut, ageLisible } from '../status.js';
import { grouperParAuteur } from '../auteurs.js';
import { organiserLEcran, serieAConfirmer, trierResultats, TRIS } from '../tomes.js';
import { notify } from '../notify.js';
import SearchBar from '../components/SearchBar.jsx';
import BookCard from '../components/BookCard.jsx';
import Modal from '../components/Modal.jsx';
import FicheResultat from '../components/FicheResultat.jsx';
import MenuCategorie from '../components/MenuCategorie.jsx';
import CreationManuelle from '../components/CreationManuelle.jsx';
import Icon from '../components/Icon.jsx';

/*
 * Pages chargees automatiquement au defilement avant de rendre la main a
 * l'utilisateur. Cinq pages = cent livres : au-dela, on ne parcourt plus une
 * liste, on epuise un quota.
 */
const MAX_PAGES_AUTO = 5;

export default function Recherche({ actif = true, editionsSuivies, onSuivre, onChangement }) {
  const [mode, setMode] = useState('titre');
  const [resultats, setResultats] = useState([]);
  const [etat, setEtat] = useState('vide'); // vide|charge|fait|erreur
  const [ouvert, setOuvert] = useState(null);
  const [identite, setIdentite] = useState(null);
  const [ajoutEnCours, setAjoutEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState(null);
  // Age des resultats affiches : non nul = ils viennent de l'archive (§4.7).
  const [poseArchive, setPoseArchive] = useState(null);
  // Le texte reellement interroge — sert a mettre l'auteur cherche en tete.
  const [derniereRequete, setDerniereRequete] = useState('');
  // Livre sur lequel on vient de faire un appui long, pour choisir sa categorie.
  const [categorieCible, setCategorieCible] = useState(null);
  const [tri, setTri] = useState('pertinence');
  const [page, setPage] = useState(0);            // page de resultats deja chargee
  const [encoreDesResultats, setEncoreDesResultats] = useState(false);
  const [chargeSuite, setChargeSuite] = useState(false);
  const [historique, setHistorique] = useState([]);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestionsEnCours, setSuggestionsEnCours] = useState(false);
  const [scanPossible, setScanPossible] = useState(false);
  const [ajoutRapide, setAjoutRapide] = useState(null);   // cleSource en cours d'ajout
  const [saisie, setSaisie] = useState(null);             // formulaire de creation manuelle

  // Une seule interrogation de l'appareil, au montage : la camera ne change
  // pas d'avis en cours de route.
  useEffect(() => { scanDisponible().then(setScanPossible).catch(() => setScanPossible(false)); }, []);

  /* Les dernieres recherches, reproposees sur l'ecran d'accueil (§retour 100). */
  const relireHistorique = useCallback(() => {
    getHistoriqueRecherches().then(setHistorique).catch(() => setHistorique([]));
  }, []);
  useEffect(() => { relireHistorique(); }, [relireHistorique]);

  /*
   * Les groupes ne se calculent qu'en mode Auteur : c'est le seul mode ou la
   * question « de qui ? » se pose. En Titre ou ISBN, regrouper n'aurait aucun
   * sens — on cherche une oeuvre precise, pas une bibliographie.
   */
  /*
   * Une SERIE detectee dans les resultats (retour d'usage 101). Les tomes
   * arrivent de Google dans un desordre complet — mesure sur « La Quete
   * d'Ewilan » : 1, 2, 7, 5, 3 melanges a des resultats sans numero. Les
   * remettre dans l'ordre est ce qui rend une saga visible.
   * Jamais en mode Auteur, ou le regroupement par ecrivain prime.
   */
  /*
   * Le tri s'applique AVANT le regroupement : les « autres resultats » suivent
   * donc l'ordre choisi, tandis que les TOMES gardent le leur — un tome 3 doit
   * rester entre le 2 et le 4, c'est toute la raison d'etre de ce bloc.
   */
  /*
   * Le mode Auteur ne passe PAS de requete : la comparer aux titres n'aurait
   * aucun sens — on cherche une bibliographie, pas un titre — et c'est le
   * regroupement par ecrivain qui decide de l'ordre. `trierResultats` rend
   * alors la liste inchangee, exactement comme avant la tranche 1.
   */
  const triees = useMemo(
    () => trierResultats(resultats, tri, mode === 'auteur' ? '' : derniereRequete),
    [resultats, tri, mode, derniereRequete],
  );

  /*
   * L'ECRAN EST UNE SUITE DE BLOCS, plus un bloc « serie » suivi du reste
   * (correction 2). Chaque serie porte son nom et se place selon sa
   * pertinence : elle ne passe plus devant tout par principe.
   */
  const blocs = useMemo(
    () => (mode !== 'auteur' && triees.length > 0
      ? organiserLEcran(triees, derniereRequete)
      : [{ type: 'livres', livres: triees }]),
    [mode, triees, derniereRequete],
  );

  const groupes = useMemo(
    () => (mode === 'auteur' && resultats.length > 0
      ? grouperParAuteur(resultats, derniereRequete)
      : null),
    [mode, resultats, derniereRequete],
  );

  /*
   * Google plafonne a 20 resultats par requete — mesure du 2026-08-25 :
   * demander 40 en rend 20 quand meme. La seule facon d'en voir davantage est
   * d'enchainer les pages, et le retour d'usage 105 est clair : « je dois
   * appuyer sur un bouton pour afficher les 20 suivants et ainsi de suite ».
   * On charge donc la suite TOUT SEUL quand le bas de la liste approche.
   */
  const sequence = useRef(0);
  /*
   * Miroir des resultats affiches. `confirmerLaSerie` est construite une fois
   * pour toutes (elle ne depend de rien) et ne peut donc pas lire l'etat
   * courant : sans ce miroir, elle refondrait la liste telle qu'elle etait au
   * montage de l'ecran, c'est-a-dire vide.
   */
  const resultatsRef = useRef([]);
  useEffect(() => { resultatsRef.current = resultats; }, [resultats]);
  // Ce qu'il faut rejouer quand l'utilisateur touche « Reessayer ».
  const derniere = useRef(null);
  const ouvrirRef = useRef(null);

  /*
   * Changer de mode vide les résultats. Sans cela, passer de Auteur à ISBN
   * laisse à l'écran vingt livres qui ne répondent plus à ce qui est affiché
   * dans le champ — constaté au navigateur, et trompeur.
   */
  const changerMode = useCallback((suivant) => {
    sequence.current += 1;
    setMode(suivant);
    setResultats([]);
    setEtat('vide');
    setPoseArchive(null);
  }, []);

  const revenirAuVide = useCallback(() => {
    sequence.current += 1;
    setResultats([]);
    setEtat('vide');
    setMessageErreur(null);
    setPoseArchive(null);
    setTri('pertinence');
  }, []);

  const lancer = useCallback(async (texte, modeCourant, auteur = '') => {
    const seq = ++sequence.current;
    derniere.current = { texte, mode: modeCourant, auteur };
    setDerniereRequete(texte);
    setEtat('charge');
    try {
      const { resultats: trouves, ancien, pose, nbSource } = await rechercherAvecEtat(texte, modeCourant, 0, auteur);
      if (seq !== sequence.current) return;   // une frappe plus récente a gagné
      setResultats(trouves);
      setPage(0);
      /*
       * Une page pleine signifie qu'il y en a probablement d'autres : Google
       * annonce jusqu'a 300 resultats. On ne propose « Voir plus » que dans ce
       * cas, et jamais en mode ISBN — un ISBN designe UN livre.
       */
      /*
       * On compte ce que la SOURCE a rendu, pas ce qui s'affiche : depuis la
       * tranche 2, une page pleine de 20 volumes peut ne donner que 6 cartes.
       */
      setEncoreDesResultats(nbSource >= 20 && modeCourant !== 'isbn');
      setPoseArchive(ancien ? pose : null);
      setEtat('fait');
      relireHistorique();

      /*
       * SERIE PRESSENTIE : on confirme sans attendre le defilement.
       * Deux tomes dans la premiere page et pas trois — c'est exactement le
       * cas de « game of thrones », noye sous les essais qui PARLENT de la
       * serie. Sans cela, le bloc « La serie, dans l'ordre » ne surgissait
       * qu'apres deux defilements, en reorganisant l'ecran sous les yeux.
       */
      if (nbSource >= 20 && modeCourant !== 'isbn' && serieAConfirmer(trouves)) {
        void confirmerLaSerie(texte, modeCourant, seq, auteur);
      }
    } catch (e) {
      if (seq !== sequence.current) return;
      setEtat('erreur');
      // Le message vient DEJA traduit de la source (§4.7). L'ecraser par une
      // phrase generique perdait l'information utile : « Google Books est
      // momentanement indisponible » n'appelle pas la meme reaction que
      // « Trop de recherches pour aujourd'hui ».
      setMessageErreur(e.message);
      notify(e.message);
    }
  }, [relireHistorique]);

  /*
   * §4.6 point 6 : les suggestions sont calculees A LA DEMANDE, jamais au
   * demarrage. Quinze appels Google par actualisation sur un quota de 1 000
   * par jour partage : les declencher a chaque ouverture de l'application
   * viderait la journee en quelques lancements.
   */
  const actualiserSuggestions = useCallback(async () => {
    setSuggestionsEnCours(true);
    try {
      setSuggestions(await getSuggestions());
    } catch (e) {
      notify(e.message);
    } finally {
      setSuggestionsEnCours(false);
    }
  }, []);

  /*
   * Scan : l'objectif du §8 est « scanner un livre de l'etagere l'ajoute en
   * 3 secondes ». On enchaine donc sans etape inutile — lecture du code,
   * recherche, et si UN seul livre correspond, sa fiche s'ouvre directement.
   * Plusieurs resultats : on montre la grille plutot que de choisir a sa place.
   */
  const scanner = useCallback(async () => {
    const { isbn, raison } = await scannerIsbn();
    if (!isbn) { if (raison) notify(raison); return; }

    setMode('isbn');
    derniere.current = { texte: isbn, mode: 'isbn', auteur: '' };
    // Sans cela, le tri comparerait les resultats du scan au TEXTE PRECEDENT.
    setDerniereRequete(isbn);
    const seq = ++sequence.current;
    setEtat('charge');
    try {
      const { resultats: trouves, ancien, pose } = await rechercherAvecEtat(isbn, 'isbn');
      if (seq !== sequence.current) return;
      setResultats(trouves);
      setPoseArchive(ancien ? pose : null);
      setEtat('fait');
      if (trouves.length === 0) {
        notify(`Aucun livre trouve pour l'ISBN ${isbn}. Il n'est peut-etre pas catalogue.`);
      } else if (trouves.length === 1) {
        ouvrirRef.current(trouves[0]);
      }
    } catch (e) {
      if (seq !== sequence.current) return;
      setEtat('erreur');
      setMessageErreur(e.message);
      notify(e.message);
    }
  }, []);

  /*
   * « Voir plus » — retour d'usage 101 : « j'ai une saga de 5 tomes a la
   * maison, il n'en voit qu'un ». Google annonce jusqu'a 300 resultats et
   * l'application n'en montrait que 20 : les tomes suivants etaient hors de
   * portee, sans que rien ne l'indique. Les pages s'ajoutent a la suite, on ne
   * remplace jamais ce qui est deja affiche.
   */
  const chargerLaSuite = useCallback(async () => {
    const d = derniere.current;
    if (!d || chargeSuite) return;
    setChargeSuite(true);
    try {
      const suivante = page + 1;
      const { resultats: encore, nbSource } = await rechercherAvecEtat(d.texte, d.mode, suivante, d.auteur);
      /*
       * On REFOND la liste entiere, on ne se contente plus d'ecarter les cles
       * deja vues (tranche 2). La meilleure fiche d'un livre arrive souvent en
       * page 2 alors que la pauvre est deja affichee : l'ecarter comme doublon
       * perdrait justement l'editeur et la couverture qu'on attendait.
       */
      setResultats(await fusionnerResultats([...resultats, ...encore], d.texte));
      setPage(suivante);
      setEncoreDesResultats(nbSource >= 20);
    } catch (e) {
      notify(e.message);
    } finally {
      setChargeSuite(false);
    }
  }, [page, resultats, chargeSuite]);

  /*
   * CHARGEMENT AUTOMATIQUE AU DEFILEMENT.
   *
   * Ecrit d'abord avec `IntersectionObserver`, qui est l'outil prevu pour
   * cela — puis ABANDONNE apres mesure : il ne se declenchait jamais, meme
   * pose a la main sur la meme sentinelle, alors que celle-ci etait bien dans
   * la fenetre (a 632 px pour une hauteur de 720). Quelque chose dans la mise
   * en page l'en empechait ; chercher quoi aurait coute plus cher que la
   * solution simple.
   *
   * Un ecouteur de defilement, lui, ne depend d'aucune subtilite de rendu et
   * se comporte pareil dans un WebView Android. La marge de 500 px declenche
   * le chargement AVANT le bas, pour que le defilement ne s'interrompe pas.
   *
   * Deux garde-fous : on s'arrete apres MAX_PAGES_AUTO pages pour ne pas vider
   * le quota Google sur un simple defilement, et la suite repasse alors par un
   * bouton — au-dela, continuer devient un choix.
   */
  useEffect(() => {
    // Masque, l'ecran ne doit RIEN charger : le defilement qu'il verrait est
    // celui d'un autre onglet.
    if (!actif || !encoreDesResultats || page + 1 >= MAX_PAGES_AUTO) return undefined;

    const regarder = () => {
      const bas = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      if (bas < 500) chargerLaSuite();
    };
    window.addEventListener('scroll', regarder, { passive: true });
    // Une liste plus courte que l'ecran n'emet aucun evenement de defilement :
    // on regarde donc AUSSI tout de suite.
    regarder();
    return () => window.removeEventListener('scroll', regarder);
  }, [actif, encoreDesResultats, page, chargerLaSuite]);

  /*
   * RETROUVER SA PLACE. Masquer l'ecran le fait sortir du flux : la page perd
   * sa hauteur, et le navigateur ramene le defilement a zero. On note donc la
   * position en continu tant que l'ecran est visible — plutot qu'au moment de
   * le masquer, ou il est deja trop tard — et on la repose au retour.
   */
  const defilement = useRef(0);
  useEffect(() => {
    if (!actif) return undefined;
    const noter = () => { defilement.current = window.scrollY; };
    window.addEventListener('scroll', noter, { passive: true });
    return () => window.removeEventListener('scroll', noter);
  }, [actif]);

  useEffect(() => {
    if (actif && defilement.current) window.scrollTo(0, defilement.current);
  }, [actif]);

  /*
   * Charge la page suivante en silence pour confirmer une serie. Volontairement
   * distincte de `chargerLaSuite` : elle ne montre aucun indicateur de
   * chargement — l'utilisateur n'a rien demande, il ne doit rien voir d'autre
   * que des livres qui s'ajoutent. Et elle abandonne sans bruit si une frappe
   * plus recente a gagne.
   */
  const confirmerLaSerie = useCallback(async (texte, modeCourant, seq, auteur = '') => {
    try {
      const { resultats: encore, nbSource } = await rechercherAvecEtat(texte, modeCourant, 1, auteur);
      if (seq !== sequence.current) return;
      const fondus = await fusionnerResultats([...resultatsRef.current, ...encore], texte);
      if (seq !== sequence.current) return;
      setResultats(fondus);
      setPage(1);
      setEncoreDesResultats(nbSource >= 20);
    } catch { /* la confirmation a echoue : le defilement fera le travail */ }
  }, []);

  const ouvrir = useCallback(async (resultat) => {
    setOuvert(resultat);
    setIdentite(null);
    try {
      const { identite: trouvee, resultat: complete } = await identifierResultat(resultat);
      setOuvert(complete);
      setIdentite(trouvee);
    } catch (e) {
      notify(e.message);
    }
  }, []);

  ouvrirRef.current = ouvrir;

  const fermer = useCallback(() => { setOuvert(null); setIdentite(null); }, []);

  const suivre = useCallback(async () => {
    setAjoutEnCours(true);
    try {
      await onSuivre(ouvert);
      fermer();
    } finally {
      setAjoutEnCours(false);
    }
  }, [ouvert, onSuivre, fermer]);

  /*
   * Ajout rapide depuis la grille : plus besoin d'ouvrir la fiche pour suivre
   * un livre. L'ajout est instantane (voir api.js) — l'identification se fait
   * apres coup, en tache de fond.
   */
  const ajouterVite = useCallback(async (resultat) => {
    setAjoutRapide(resultat.cleSource);
    try {
      await onSuivre(resultat);
    } finally {
      setAjoutRapide(null);
    }
  }, [onSuivre]);

  /*
   * Une carte fusionnee porte PLUSIEURS cles de source (tranche 2). Un livre
   * suivi sous l'une d'elles doit rester marque meme si c'est une autre fiche
   * du groupe qui a ete retenue pour l'affichage — sinon la coche disparait
   * et on propose de suivre un livre deja dans la bibliotheque.
   */
  const estSuivi = useCallback(
    (r) => (r.clesSource || [r.cleSource]).some((c) => editionsSuivies.has(c)),
    [editionsSuivies],
  );

  /* Une seule definition de la carte de resultat : la grille simple et les
     grilles par auteur doivent rester identiques a la virgule pres. */
  const carteResultat = (r, mention) => (
    <BookCard
      key={r.cleSource}
      resultat={r}
      raison={mention}
      marque={estSuivi(r)}
      onOuvrir={ouvrir}
      onAppuiLong={() => setCategorieCible(r)}
      onAjoutRapide={ajouterVite}
      ajoutEnCours={ajoutRapide === r.cleSource}
    />
  );

  /*
   * Ranger un resultat dans une categorie : on l'ajoute EN SILENCE (le message
   * final dit deja tout), puis on lui pose son statut. `ajouterOeuvre` est
   * idempotent, donc un livre deja suivi voit simplement son statut changer.
   */
  const rangerDansCategorie = useCallback(async (livre, statut) => {
    setCategorieCible(null);
    const oeuvreId = await onSuivre(livre);
    if (!oeuvreId) return;
    try {
      await setStatut(oeuvreId, statut);
      await onChangement();
    } catch (e) {
      notify(e.message);
    }
  }, [onSuivre, onChangement]);

  const creerALaMain = useCallback(async () => {
    try {
      await creerOeuvreManuelle({
        ...saisie,
        nbPages: saisie.nbPages ? Number(saisie.nbPages) : null,
      });
      setSaisie(null);
      await onChangement();
    } catch (e) {
      notify(e.message);
    }
  }, [saisie, onChangement]);

  const dejaSuivi = ouvert ? estSuivi(ouvert) : false;

  return (
    <section className="recherche">
      <SearchBar
        mode={mode}
        onChangerMode={changerMode}
        onRechercher={lancer}
        onVider={revenirAuVide}
        onScanner={scanner}
        scanPossible={scanPossible}
      />

      {etat === 'charge' && <p className="hint">Recherche en cours…</p>}

      {/*
        Une erreur n'est plus un cul-de-sac (§4.7, tranche 10). Six essais
        laissent environ 4 % des recherches en echec, et il n'y a rien a faire
        de plus cote reseau : la seule reponse utile est de rendre le nouvel
        essai IMMEDIAT, sans retaper.
      */}
      {etat === 'erreur' && (
        <div className="suggestions">
          <p className="error">{messageErreur || 'La recherche a échoué.'}</p>
          <button
            type="button"
            className="btn btn--large"
            onClick={() => {
              const d = derniere.current;
              if (d) lancer(d.texte, d.mode, d.auteur);
            }}
          >
            <Icon name="actualiser" size={16} />
            <span>Réessayer</span>
          </button>
        </div>
      )}

      {etat === 'fait' && resultats.length === 0 && (
        <div className="suggestions">
          <p className="hint">
            Aucun livre trouvé. Essaie avec moins de mots, ou change de mode :
            un nom d’auteur donne souvent plus qu’un titre approximatif.
          </p>
          {/*
            Certains livres n'existent dans AUCUN catalogue public : mesuré sur
            huit ISBN français, trois sont absents de Google ET d'Open Library.
            §3.2 prévoit l'empreinte locale pour « les vieux fonds,
            l'autoédition et les livres non catalogués » — voici de quoi en
            créer un.
          */}
          <button
            type="button"
            className="btn btn--large"
            onClick={() => setSaisie({ titre: '', auteurs: '', annee: '', isbn13: '', format: 'papier', nbPages: '' })}
          >
            <Icon name="plus" size={16} />
            <span>Ajouter ce livre à la main</span>
          </button>
          <p className="carte__detail">
            Certains livres ne figurent dans aucun catalogue public. Tu peux
            l’enregistrer toi-même : il se comportera comme les autres.
          </p>
        </div>
      )}

      {etat === 'vide' && (
        <div className="suggestions">
          <p className="hint">
            Tape un titre, un nom d’auteur, ou les chiffres de l’ISBN au dos du
            livre.
          </p>

          {/*
            Retour d'usage 100 : « je ne vois pas mon historique de recherche ».
            Les douze dernieres, les plus recentes en tete. Toucher l'une
            d'elles la relance — c'est ce qui evite de retaper un titre long
            sur un clavier de telephone.
          */}
          {historique.length > 0 && (
            <>
              <div className="suggestions__tete">
                <h2 className="soustitre soustitre--serre">Tes dernières recherches</h2>
                <button
                  type="button"
                  className="btn btn--fantome"
                  onClick={async () => { await effacerHistoriqueRecherches(); relireHistorique(); }}
                >
                  <span>Effacer</span>
                </button>
              </div>
              <div className="historique">
                {historique.map((h) => (
                  <button
                    key={`${h.mode}:${h.texte}`}
                    type="button"
                    className="historique__item"
                    onClick={() => { changerMode(h.mode); lancer(h.texte, h.mode); }}
                  >
                    <Icon name="recherche" size={14} />
                    <span>{h.texte}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="suggestions__tete">
            <h2 className="soustitre soustitre--serre">Pour toi</h2>
            <button
              type="button"
              className="btn btn--fantome"
              onClick={actualiserSuggestions}
              disabled={suggestionsEnCours}
            >
              <Icon name="actualiser" size={16} />
              <span>{suggestionsEnCours ? 'Recherche…' : 'Actualiser'}</span>
            </button>
          </div>

          {suggestions === null && !suggestionsEnCours && (
            <p className="hint">
              Touche « Actualiser » pour voir des livres proposés à partir de ce
              que tu as lu. Ce n’est pas automatique : chaque actualisation
              consomme des recherches, autant que tu décides quand.
            </p>
          )}

          {suggestions !== null && suggestions.length === 0 && !suggestionsEnCours && (
            <p className="hint">
              Rien à proposer pour l’instant. Ajoute quelques livres à ta
              bibliothèque : les propositions se construisent à partir de leurs
              auteurs et de leurs genres.
            </p>
          )}

          {suggestions !== null && suggestions.length > 0 && (
            <div className="grille">
              {suggestions.map((r) => (
                <BookCard
                  key={r.cleSource}
                  resultat={r}
                  marque={estSuivi(r)}
                  raison={r.raison}
                  onOuvrir={ouvrir}
                  onAppuiLong={() => setCategorieCible(r)}
                  onAjoutRapide={ajouterVite}
                  ajoutEnCours={ajoutRapide === r.cleSource}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        Le tri (retour d'usage 120). Il ne s'affiche que s'il y a de quoi
        trier — sur trois resultats, un selecteur occupe plus de place qu'il
        n'en fait gagner.
        Il vit dans l'application et non chez Google : mesure du 2026-08-26,
        `orderBy=newest` rend exactement le meme ordre que par defaut.
      */}
      {resultats.length > 3 && etat === 'fait' && (
        <div className="seg seg--tri" role="group" aria-label="Trier les résultats">
          {TRIS.map((t) => (
            <button
              key={t.cle}
              type="button"
              className={`seg__item${tri === t.cle ? ' on' : ''}`}
              onClick={() => setTri(t.cle)}
              aria-pressed={tri === t.cle}
            >
              {t.libelle}
            </button>
          ))}
        </div>
      )}

      {poseArchive ? (
        <p className="hint hint--archive">
          <Icon name="alerte" size={16} />
          <span>
            Google Books ne répond pas. Voici ta recherche {ageLisible(poseArchive)},
            gardée sur l’appareil.
          </span>
        </p>
      ) : null}

      {/*
        En mode Auteur, les livres sont presentes PAR AUTEUR : l'auteur cherche
        d'abord, les homonymes en dessous, sous un intertitre qui le dit. Dans
        les autres modes, la grille reste telle quelle — regrouper n'y aurait
        aucun sens.
      */}
      {groupes ? (
        groupes.map((g, rang) => (
          <div key={g.nom} className="groupe-auteur">
            {rang === 1 && g.proximite === 0 ? (
              <p className="hint groupe-auteur__separateur">
                Autres auteurs portant un nom proche
              </p>
            ) : null}
            <h2 className="soustitre soustitre--serre groupe-auteur__nom">
              <span>{g.nom}</span>
              <span className="groupe-auteur__compte">
                {g.livres.length} livre{g.livres.length > 1 ? 's' : ''}
              </span>
            </h2>
            <div className="grille">
              {g.livres.map((r) => carteResultat(r))}
            </div>
          </div>
        ))
      ) : resultats.length > 0 ? (
        /*
          Chaque serie s'annonce par SON nom (« La Quete d'Ewilan »), et non
          plus par un « La serie, dans l'ordre » qui melangeait des cycles sans
          rapport. Les livres isoles qui se suivent forment une seule grille.
        */
        blocs.map((b, i) => (b.type === 'serie' ? (
          <div className="groupe-auteur" key={b.cle}>
            <h2 className="soustitre soustitre--serre">
              {b.nom}
              <span className="groupe-auteur__compte">{b.tomes.length} tomes</span>
            </h2>
            <div className="grille">
              {b.tomes.map((r) => carteResultat(r, `tome ${r.tome}`))}
            </div>
          </div>
        ) : (
          <div className="grille" key={`livres-${i}`}>
            {b.livres.map((r) => carteResultat(r))}
          </div>
        )))
      ) : null}

      {chargeSuite && <p className="hint">Encore quelques livres…</p>}

      {/*
        Le bouton ne reste que si le chargement automatique s'est arrete de
        lui-meme, apres MAX_PAGES_AUTO pages. Au-dela, continuer devient un
        choix, pas un automatisme — c'est le quota qui l'impose.
      */}
      {encoreDesResultats && !chargeSuite && page + 1 >= MAX_PAGES_AUTO && (
        <button type="button" className="btn btn--large" onClick={chargerLaSuite}>
          <Icon name="actualiser" size={16} />
          <span>Charger encore des livres ({resultats.length} affichés)</span>
        </button>
      )}

      {/*
        LES SURCOUCHES NE SURVIVENT PAS AU MASQUAGE (tranche 3). L'ecran reste
        monte, donc une fiche ouverte resterait dans le document — invisible,
        mais bien la. Le bouton retour d'Android cherche `.sheet` pour savoir
        s'il y a quelque chose a fermer : il aurait ferme une fenetre que
        personne ne voit, au lieu de revenir a l'accueil.
        L'etat, lui, est conserve : revenir sur l'onglet rouvre la fiche.
      */}
      {actif && saisie && (
        <CreationManuelle
          saisie={saisie}
          onChange={(champ, valeur) => setSaisie((v) => ({ ...v, [champ]: valeur }))}
          onValider={creerALaMain}
          onFermer={() => setSaisie(null)}
        />
      )}

      {/*
        Appui long sur un resultat (retour d'usage 83) : choisir la categorie
        AJOUTE le livre et lui pose le statut d'un seul geste. Le detour par la
        fiche n'etait pas une etape utile, c'etait un passage oblige.
      */}
      {actif && categorieCible && (
        <MenuCategorie
          titre={categorieCible.titre}
          onFermer={() => setCategorieCible(null)}
          onChoisir={(st) => rangerDansCategorie(categorieCible, st)}
        />
      )}

      {actif && ouvert && (
        <FicheResultat
          resultat={ouvert}
          identite={identite}
          dejaSuivi={dejaSuivi}
          ajoutEnCours={ajoutEnCours}
          onSuivre={suivre}
          onFermer={fermer}
        />
      )}
    </section>
  );
}
