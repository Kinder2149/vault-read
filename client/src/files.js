/*
 * files.js — sortir un fichier de l'application, et en lire un.
 * Ne connaît que « écrire un texte », « lire un fichier », « nommer un fichier
 * daté » : aucun rapport avec les livres. C'est le fichier le plus réutilisable
 * du projet séries, repris tel quel à un préfixe près.
 * Piège évité : un WebView Android NE SAIT PAS télécharger. Un <a download> y
 * est inerte. Il faut écrire dans Directory.Cache puis passer par la feuille
 * de partage du système — c'est la seule solution correcte.
 */

import { Capacitor } from '@capacitor/core';

const estWeb = () => Capacitor.getPlatform() === 'web';

/** « vault-read-2026-08-20.json » — daté, donc jamais écrasé par erreur. */
export function nomFichierSauvegarde(extension = 'json') {
  const d = new Date();
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const jour = String(d.getDate()).padStart(2, '0');
  return `vault-read-${d.getFullYear()}-${mois}-${jour}.${extension}`;
}

/**
 * Remet un texte à l'utilisateur, par le chemin qui marche sur sa plateforme.
 * @returns {Promise<'telechargement'|'partage'>} par où c'est sorti
 */
export async function sortirTexte(nom, contenu, typeMime = 'application/json') {
  if (estWeb()) {
    const blob = new Blob([contenu], { type: `${typeMime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    document.body.removeChild(lien);
    // Révocation différée : révoquer tout de suite annule le téléchargement
    // sur certains navigateurs.
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return 'telechargement';
  }

  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  await Filesystem.writeFile({
    path: nom,
    data: contenu,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({ path: nom, directory: Directory.Cache });

  await Share.share({
    title: nom,
    text: 'Sauvegarde Vault Read',
    url: uri,
    dialogTitle: 'Enregistrer la sauvegarde',
  });
  return 'partage';
}

/*
 * Lecture d'un fichier choisi par l'utilisateur. Un <input type="file"> natif
 * fonctionne des deux côtés, y compris dans le WebView Android : c'est le
 * sélecteur du système qui s'ouvre. Pas besoin de plugin.
 */
export function lireFichierTexte(accept = '.json,application/json') {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const fichier = input.files && input.files[0];
      document.body.removeChild(input);
      if (!fichier) { resolve(null); return; }

      const lecteur = new FileReader();
      lecteur.onload = () => resolve({ nom: fichier.name, contenu: String(lecteur.result) });
      lecteur.onerror = () => reject(new Error('Le fichier n’a pas pu être lu.'));
      lecteur.readAsText(fichier, 'utf-8');
    });

    document.body.appendChild(input);
    input.click();
  });
}

/*
 * Lit une image choisie par l'utilisateur et la rend en `data:` URL REDUITE
 * (retour d'usage 84 : « si j'ai pas de couverture je veux pouvoir en ajouter
 * une moi-meme »).
 *
 * Le redimensionnement n'est pas un confort, c'est la condition pour que cette
 * fonction soit acceptable : une photo de telephone fait 3 a 8 Mo, et elle
 * finirait telle quelle dans la colonne `couverture_url`, donc dans SQLite,
 * donc dans le fichier de SAUVEGARDE — quelques couvertures suffiraient a le
 * rendre intransportable. Ramenee a 400 px de large en JPEG, une couverture
 * pese 30 a 60 Ko, soit l'ordre de grandeur d'une vignette Google.
 * 400 px : la grille affiche des cartes de 150 px environ, l'ecran de fiche
 * un peu plus ; au-dela on stocke des pixels que personne ne verra.
 */
const LARGEUR_COUVERTURE = 400;

export function lireImageReduite(largeurMax = LARGEUR_COUVERTURE) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';

    input.addEventListener('change', () => {
      const fichier = input.files && input.files[0];
      document.body.removeChild(input);
      if (!fichier) { resolve(null); return; }

      const lecteur = new FileReader();
      lecteur.onerror = () => reject(new Error('L’image n’a pas pu être lue.'));
      lecteur.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Ce fichier n’est pas une image lisible.'));
        image.onload = () => {
          // On ne grandit JAMAIS une petite image : agrandir n'ajoute aucun
          // detail, cela ne fait qu'alourdir le stockage.
          const ratio = Math.min(1, largeurMax / image.width);
          const largeur = Math.round(image.width * ratio);
          const hauteur = Math.round(image.height * ratio);

          const toile = document.createElement('canvas');
          toile.width = largeur;
          toile.height = hauteur;
          toile.getContext('2d').drawImage(image, 0, 0, largeur, hauteur);

          // JPEG et non PNG : une couverture est une photographie, le PNG y
          // serait trois a cinq fois plus lourd sans rien apporter.
          resolve(toile.toDataURL('image/jpeg', 0.75));
        };
        image.src = String(lecteur.result);
      };
      lecteur.readAsDataURL(fichier);
    });

    document.body.appendChild(input);
    input.click();
  });
}
