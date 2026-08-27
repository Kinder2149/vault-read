/*
 * FAMILLE 6 — LES ECRANS SE RENDENT SANS PLANTER
 *
 * La verification qui manquait, et qui a coute cher.
 *
 * Le 2026-08-21, une fonction a ete inseree par erreur A L'INTERIEUR d'une
 * autre dans `Detail.jsx`. Resultat : la fiche de detail plantait des son
 * ouverture (« choisirCouverture is not defined »), sur TROIS versions
 * livrees. Ni le build ni les 95 verifications ne l'ont vu — c'est une erreur
 * d'execution, pas de compilation, et rien n'ouvrait alors un ecran.
 *
 * Le principe est volontairement modeste : on DESSINE chaque ecran avec des
 * donnees credibles et on verifie qu'il ne leve pas d'erreur. Cela n'atteste
 * pas que l'ecran est joli — cela atteste qu'il s'affiche, ce qui est le
 * minimum, et c'est exactement ce qui manquait.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/*
 * Les ecrans passent par la facade : on la remplace entierement, aucune base
 * ni reseau ici. Le piege, rencontre a l'ecriture : un Proxy qui repond a TOUT
 * repond aussi a `then`, et le systeme de modules prend alors le module pour
 * une promesse — l'import ne se termine jamais. On rend donc `undefined` pour
 * `then` et pour les symboles internes.
 */
vi.mock('../src/api.js', () => new Proxy({}, {
  get: (_cible, propriete) => {
    if (propriete === 'then' || typeof propriete === 'symbol') return undefined;
    return async () => [];
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }));

const livre = (o = {}) => ({
  oeuvreId: 'ol:OL1W',
  cleSource: 'gb:1',
  titre: 'Les Fourmis',
  auteurs: 'Bernard Werber',
  annee: '1991',
  datePublication: '1991',
  couvertureUrl: null,
  resume: 'Un roman.',
  categories: '',
  langue: 'fr',
  cycleNom: null,
  cycleTome: null,
  statut: 'en_cours',
  note: null,
  position: 150,
  editionActive: 'gb:1',
  format: 'papier',
  nbPages: 300,
  dureeMinutes: null,
  isbn13: '9782226052575',
  editeur: 'Albin Michel',
  ...o,
});

/** Un resultat de recherche a la forme rendue par les sources. */
const resultat = (o = {}) => ({ ...livre(o), auteurs: ['Bernard Werber'], sousTitre: null });

const dessiner = (element) => renderToStaticMarkup(element);

describe('Les cartes et les modales s-affichent', () => {
  it('une carte de livre, avec couverture', async () => {
    const { default: BookCard } = await import('../src/components/BookCard.jsx');
    const html = dessiner(<BookCard resultat={resultat({ couvertureUrl: 'https://x/y.jpg' })} onOuvrir={() => {}} />);
    expect(html).toContain('Les Fourmis');
  });

  it('une carte de livre SANS couverture dessine une couverture de secours', async () => {
    const { default: BookCard } = await import('../src/components/BookCard.jsx');
    const html = dessiner(<BookCard resultat={resultat()} onOuvrir={() => {}} />);
    expect(html).toContain('carte-livre__dessinee');
    expect(html).toContain('Bernard Werber');
  });

  it('la fiche d-un resultat de recherche, identification en cours', async () => {
    const { default: FicheResultat } = await import('../src/components/FicheResultat.jsx');
    const html = dessiner(
      <FicheResultat resultat={resultat()} identite={null} dejaSuivi={false} ajoutEnCours={false} onSuivre={() => {}} onFermer={() => {}} />,
    );
    expect(html).toContain('Identification chez Open Library');
  });

  it('la fiche d-un resultat, identification aboutie', async () => {
    const { default: FicheResultat } = await import('../src/components/FicheResultat.jsx');
    const identite = { oeuvreId: 'ol:OL1W', resolue: true, nbPages: 300, cycleNom: null, cycleTome: null };
    const html = dessiner(
      <FicheResultat resultat={resultat()} identite={identite} dejaSuivi={false} ajoutEnCours={false} onSuivre={() => {}} onFermer={() => {}} />,
    );
    expect(html).toContain('identifiée');
  });

  it('le menu de categorie', async () => {
    const { default: MenuCategorie } = await import('../src/components/MenuCategorie.jsx');
    const html = dessiner(<MenuCategorie titre="Les Fourmis" onChoisir={() => {}} onFermer={() => {}} />);
    expect(html).toContain('catégorie');
  });

  it('la creation manuelle', async () => {
    const { default: CreationManuelle } = await import('../src/components/CreationManuelle.jsx');
    const saisie = { titre: '', auteurs: '', annee: '', isbn13: '', nbPages: '' };
    const html = dessiner(<CreationManuelle saisie={saisie} onChange={() => {}} onValider={() => {}} onFermer={() => {}} />);
    expect(html).toContain('Titre du livre');
  });

  it('la saisie de progression', async () => {
    const { default: Progression } = await import('../src/components/Progression.jsx');
    const html = dessiner(<Progression oeuvre={livre()} onFerme={() => {}} onChange={() => {}} />);
    expect(html).toContain('300');
  });
});

describe('LA FICHE DE DETAIL — celle qui plantait', () => {
  it('s-affiche sans lever d-erreur', async () => {
    const { default: Detail } = await import('../src/components/Detail.jsx');
    const html = dessiner(
      <Detail oeuvre={livre()} bibliotheque={[livre()]} onFerme={() => {}} onChange={() => {}} onProgression={() => {}} />,
    );
    expect(html).toContain('Les Fourmis');
  });

  it('affiche le bouton d-ajout de couverture quand il n-y en a pas', async () => {
    const { default: Detail } = await import('../src/components/Detail.jsx');
    const html = dessiner(
      <Detail oeuvre={livre()} bibliotheque={[livre()]} onFerme={() => {}} onChange={() => {}} onProgression={() => {}} />,
    );
    expect(html).toContain('Ajouter une photo');
  });

  it('s-affiche aussi pour un livre audio', async () => {
    const { default: Detail } = await import('../src/components/Detail.jsx');
    const audio = livre({ format: 'audio', nbPages: null, dureeMinutes: 600 });
    expect(() => dessiner(
      <Detail oeuvre={audio} bibliotheque={[audio]} onFerme={() => {}} onChange={() => {}} onProgression={() => {}} />,
    )).not.toThrow();
  });
});

describe('Les quatre ecrans principaux', () => {
  const cardProps = { onOuvrir: () => {}, onAppuiLong: () => {} };

  it('Recherche, a vide', async () => {
    const { default: Recherche } = await import('../src/screens/Recherche.jsx');
    const html = dessiner(
      <Recherche editionsSuivies={new Set()} onSuivre={() => {}} onChangement={() => {}} />,
    );
    expect(html).toContain('Pour toi');
  });

  it('Recherche se dessine aussi quand elle est MASQUEE', async () => {
    // Tranche 3 : l'ecran reste monte derriere les autres onglets. Il doit
    // donc supporter d'etre rendu inactif, sans surcouche ni defilement.
    const { default: Recherche } = await import('../src/screens/Recherche.jsx');
    const html = dessiner(
      <Recherche actif={false} editionsSuivies={new Set()} onSuivre={() => {}} onChangement={() => {}} />,
    );
    expect(html).toContain('Pour toi');
  });

  it('Bibliotheque, vide', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const html = dessiner(<Bibliotheque bibliotheque={[]} cardProps={cardProps} />);
    expect(html).toContain('vide');
  });

  it('Bibliotheque, avec des livres', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const html = dessiner(<Bibliotheque bibliotheque={[livre(), livre({ oeuvreId: 'x', statut: 'lu' })]} cardProps={cardProps} />);
    expect(html).toContain('Les Fourmis');
  });

  it('Bibliotheque : le filtre de format reste MASQUE si tout est papier', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const html = dessiner(<Bibliotheque bibliotheque={[livre(), livre({ oeuvreId: 'x' })]} cardProps={cardProps} />);
    expect(html).not.toContain('Filtre de format');
  });

  it('Bibliotheque : le filtre de format APPARAIT des qu-il y a deux formats', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const html = dessiner(
      <Bibliotheque bibliotheque={[livre(), livre({ oeuvreId: 'x', format: 'audio' })]} cardProps={cardProps} />,
    );
    expect(html).toContain('Filtre de format');
  });

  it('Ma lecture', async () => {
    const { default: MaLecture } = await import('../src/screens/MaLecture.jsx');
    const html = dessiner(<MaLecture bibliotheque={[livre()]} cardProps={cardProps} onProgression={() => {}} />);
    expect(html).toContain('En cours');
  });

  it('Reglages', async () => {
    const { default: Reglages } = await import('../src/screens/Reglages.jsx');
    const html = dessiner(
      <Reglages
        theme="dark" basculerTheme={() => {}} bibliotheque={[livre()]}
        quota={{ utilises: 12, total: 1000, restants: 988 }}
        etat={{ plateforme: 'web', versionSchema: 2, clesEtrangeres: true, tables: ['a'] }}
        setSauvegardeOuverte={() => {}} recharger={() => {}}
      />,
    );
    expect(html).toContain('12');
  });
});

describe('Un livre publie cette annee reste dans la bibliotheque', () => {
  it('il n-est PAS range sous « Pas encore paru »', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const annee = String(new Date().getFullYear());
    const html = dessiner(
      <Bibliotheque bibliotheque={[livre({ statut: 'a_lire', annee, datePublication: annee })]} cardProps={{ onOuvrir: () => {} }} />,
    );
    expect(html).not.toContain('Pas encore paru');
  });

  it('un livre LU reste dans la bibliotheque meme date future', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const futur = String(new Date().getFullYear() + 1);
    const html = dessiner(
      <Bibliotheque bibliotheque={[livre({ statut: 'lu', annee: futur, datePublication: futur })]} cardProps={{ onOuvrir: () => {} }} />,
    );
    expect(html).not.toContain('Pas encore paru');
  });

  it('mais un livre A LIRE et pas encore sorti y est bien annonce', async () => {
    const { default: Bibliotheque } = await import('../src/screens/Bibliotheque.jsx');
    const futur = String(new Date().getFullYear() + 1);
    const html = dessiner(
      <Bibliotheque bibliotheque={[livre({ statut: 'a_lire', annee: futur, datePublication: futur })]} cardProps={{ onOuvrir: () => {} }} />,
    );
    expect(html).toContain('Pas encore paru');
  });
});
