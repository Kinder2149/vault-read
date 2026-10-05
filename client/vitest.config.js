/*
 * Configuration des verifications automatiques.
 * Volontairement minimale : Vitest est le compagnon de Vite, deja present, et
 * lit la meme configuration de compilation que l'application. Rien a doubler.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Necessaire pour lire les fichiers .jsx des ecrans.
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.js', 'tests/**/*.test.jsx'],
    setupFiles: ['./tests/preparation.js'],
    // Les verifications de base de donnees partagent un moteur SQL en memoire :
    // elles doivent se suivre, pas se chevaucher.
    fileParallelism: false,
    // Une verification qui depasse 15 s est un signal, pas une lenteur normale.
    testTimeout: 15000,
    /*
     * LE CATALOGUE VAULT BOOKS EST ETEINT PAR DEFAUT DANS LES VERIFICATIONS (tranche 33). Vite lit `client/.env` : sans cette
     * ligne, le fichier d'un developpeur qui a configure le service ferait passer TOUTES les recherches simulees par le
     * catalogue, et les verifications des sources publiques ne verifieraient plus rien (constate : 3 echecs le jour ou le
     * fichier a ete cree). La famille 13 le rallume elle-meme, cas par cas (`vi.stubEnv`).
     */
    env: { VITE_VAULT_API_URL: '', VITE_VAULT_API_KEY: '' },
  },
});
