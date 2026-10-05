/*
 * FAMILLE 19 — L'ATTRIBUTION DES SOURCES (tranche 33, phase 4)
 *
 * « Donnees Hardcover » est une condition d'usage de leur API : elle doit etre visible dans Reglages des que l'application interroge
 * Hardcover (catalogue configure ET actif), et absente sinon — on ne revendique pas une source qu'on n'utilise pas.
 * La BnF, Open Library et Google Books sont toujours nommes. Les liens s'ouvrent hors de l'application, sans donner acces a la fenetre.
 * (Rendu serveur, comme les autres ecrans : la lecture de l'etat du catalogue, elle, est celle de `CatalogueApi`, deja verifiee en famille 13.)
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { ListeSources } from '../src/components/SourcesDonnees.jsx';

const dessiner = (hardcover) => renderToStaticMarkup(<ListeSources hardcover={hardcover} />);

describe('Sources des donnees', () => {
  it('Hardcover est cite quand l-application l-interroge, avec un lien qui s-ouvre hors de l-application', () => {
    const html = dessiner(true);
    expect(html).toContain('Données');
    expect(html).toMatch(/<a href="https:\/\/hardcover\.app" target="_blank" rel="noopener noreferrer">Hardcover<\/a>/);
  });

  it('les trois autres sources sont toujours nommees', () => {
    [true, false].forEach((h) => {
      const html = dessiner(h);
      ['Bibliothèque nationale de France', 'Open Library', 'Google Books'].forEach((s) => expect(html).toContain(s));
    });
  });

  it('sans catalogue, Hardcover n-est pas revendique', () => {
    expect(dessiner(false)).not.toContain('Hardcover');
  });

  it('tout lien externe porte noopener (il ne donne pas acces a la fenetre de l-application)', () => {
    const liens = dessiner(true).match(/<a [^>]*>/g);
    expect(liens.length).toBeGreaterThanOrEqual(4);
    liens.forEach((l) => { expect(l).toContain('target="_blank"'); expect(l).toContain('noopener'); });
  });
});
