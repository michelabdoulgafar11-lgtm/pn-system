// middleware/validation.js
// Nettoyage basique des chaines pour eviter les injections HTML (XSS) affichees cote client.

function nettoyerTexte(valeur, longueurMax = 2000) {
  if (valeur === undefined || valeur === null) return "";
  let texte = String(valeur).trim().slice(0, longueurMax);
  return texte;
}

function estChaineNonVide(valeur) {
  return typeof valeur === "string" && valeur.trim().length > 0;
}

module.exports = { nettoyerTexte, estChaineNonVide };
