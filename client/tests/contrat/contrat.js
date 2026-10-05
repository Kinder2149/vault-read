// Le contrat entre Vault Books API et ses clients (Vault Read) : les champs que le client LIT, avec leur type.
// Notation : 'string' | 'number' | 'boolean' ; suffixe '?' = peut valoir null ; clé suffixée '?' = peut manquer (ou valoir null si objet) ; [x] = tableau d'éléments x.
// Les champs en plus sont permis (le service peut s'enrichir) ; un champ lu qui disparaît ou change de type fait échouer les tests des DEUX dépôts.
// Source unique : ce fichier et contrat/exemples/ sont copiés tels quels dans vault-read/client/tests/contrat/ (npm run contrat -- --copier).
const carte = {
  type: 'string', id: 'number', titre: 'string', auteurs: ['string'], couverture: 'string?', score: 'number',
  'annee?': 'number?', 'date?': 'string?', 'isbn13?': 'string?', 'editeur?': 'string?',
  'serie?': { id: 'number', nom: 'string', 'position?': 'number?' },
};
const couverture = { url: 'string?', 'source?': 'string?', 'approximative?': 'boolean', 'basseDefinition?': 'boolean' };

export const contrat = {
  'search-titre': { langueNonDisponible: 'boolean', resultats: [carte] },
  'search-auteur': { auteur: { id: 'number', nom: 'string', livres: 'number?' }, langueNonDisponible: 'boolean', resultats: [carte] },
  serie: {
    id: 'number', nom: 'string', langue: 'string', totalPrincipal: 'number?',
    tomes: [{
      position: 'number', titre: 'string', livreId: 'number', disponible: 'boolean', aParaitre: 'boolean',
      couverture: 'string?', 'couvertureApproximative?': 'boolean',
      'edition?': { 'id?': 'number?', isbn13: 'string?', 'editeur?': 'string?', 'date?': 'string?' },
      parties: [{ titre: 'string', 'couverture?': 'string?', 'couvertureApproximative?': 'boolean', 'edition?': { isbn13: 'string?', 'editeur?': 'string?', 'date?': 'string?' } }],
    }],
  },
  livre: {
    id: 'number', titre: 'string', 'titreLangue?': 'string?', auteurs: ['string'], langue: 'string',
    editions: [{ isbn13: 'string', 'titre?': 'string?', 'editeur?': 'string?', 'date?': 'string?', couverture }],
  },
  isbn: {
    trouve: 'boolean', isbn13: 'string', titre: 'string', auteurs: ['string'], 'editeur?': 'string?', 'date?': 'string?', 'langue?': 'string?',
    'nbPages?': 'number?', 'resume?': 'string?', couverture, 'livre?': { id: 'number', titre: 'string' },
    'serie?': { id: 'number', nom: 'string', 'position?': 'number?', 'total?': 'number?' },
  },
};

const TYPES = new Set(['string', 'number', 'boolean']);

/** Vérifie `valeur` contre `schema` ; rend la liste des écarts (vide = conforme). */
export function verifier(valeur, schema, chemin = '$') {
  if (typeof schema === 'string') {
    const nul = schema.endsWith('?');
    const type = nul ? schema.slice(0, -1) : schema;
    if (!TYPES.has(type)) return [`${chemin}: type de contrat inconnu « ${schema} »`];
    if (valeur === null) return nul ? [] : [`${chemin}: null (attendu ${schema})`];
    if (valeur === undefined) return [`${chemin}: absent`];
    return typeof valeur === type ? [] : [`${chemin}: ${typeof valeur} (attendu ${schema})`];
  }
  const ecarts = [];
  if (Array.isArray(schema)) {
    if (!Array.isArray(valeur)) return [`${chemin}: pas un tableau`];
    valeur.forEach((v, i) => ecarts.push(...verifier(v, schema[0], `${chemin}[${i}]`)));
    return ecarts;
  }
  if (valeur === null || typeof valeur !== 'object' || Array.isArray(valeur)) return [`${chemin}: pas un objet`];
  for (const [cle, sous] of Object.entries(schema)) {
    const facultatif = cle.endsWith('?');
    const nom = facultatif ? cle.slice(0, -1) : cle;
    const v = valeur[nom];
    if (v === undefined || (facultatif && v === null && typeof sous === 'object')) {
      if (!facultatif) ecarts.push(`${chemin}.${nom}: absent`);
      continue;
    }
    ecarts.push(...verifier(v, sous, `${chemin}.${nom}`));
  }
  return ecarts;
}
