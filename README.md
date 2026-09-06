# Vault Read

Application Android de suivi de lecture, **100 % locale**. Aucun compte, aucune
synchronisation, aucun serveur. Rien ne quitte l'appareil.

Les décisions du projet vivent dans **[PROJET_CONTEXTE_VAULT_READ.md](PROJET_CONTEXTE_VAULT_READ.md)** —
c'est la référence, ce fichier n'en est que le mode d'emploi.

---

## Démarrer

```bash
npm install --prefix client
npm run wasm --prefix client        # copie sql-wasm.wasm dans public/assets/
```

Créer `client/.env` à partir de `client/.env.example` et y coller la clé
Google Books. **Jamais dans `.env.example`**, qui est versionné.

```bash
npm run dev --prefix client         # http://localhost:5173
```

## Construire pour Android

`JAVA_HOME` doit pointer sur un JDK 17 ou plus. Celui d'Android Studio convient :
`C:\Program Files\Android\Android Studio\jbr`.

```bash
npm run build --prefix client
npx --prefix client cap sync android
cd client/android && ./gradlew assembleDebug      # APK de test
```

## Publier

1. Incrémenter **`versionCode`** et **`versionName`** dans
   `client/android/app/build.gradle`. Le Play Store refuse un `versionCode`
   déjà utilisé.
2. Créer le magasin de clés, une seule fois, **hors du dépôt** :
   ```bash
   keytool -genkeypair -v -keystore V:/DEV/keys/suivi-lecture.jks \
           -alias suivi-lecture -keyalg RSA -keysize 2048 -validity 10000
   ```
   Perdre cette clé interdit toute mise à jour de l'application. La sauvegarder
   ailleurs que sur ce poste.
3. Copier `client/android/signature.properties.exemple` en
   `client/android/signature.properties` et le renseigner. Ce fichier est
   git-ignoré.
4. ```bash
   cd client/android && ./gradlew bundleRelease
   ```
   L'AAB sort dans `app/build/outputs/bundle/release/`.

Sans `signature.properties`, seule la version debug se construit — c'est voulu :
on développe sans clé, et aucun secret n'entre dans le dépôt.

## Politique de confidentialité

`docs/index.html`, à publier sur GitHub Pages. Le Play Store en exige une URL
publique, même pour une application qui ne collecte rien.

---

## Repères

| | |
|---|---|
| Identifiant | `com.kinder.vaultread` |
| APK de test | ~18 Mo (quatre architectures) |
| AAB de publication | ~9,4 Mo |
| Dépendances de production | 11 |
| Sources | Google Books (découverte) · Open Library (identité) |
