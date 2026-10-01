// db/diffuseursActifs.js
// Registre en memoire (donnees ephemeres, pas sauvegardees sur disque) des
// agents qui diffusent actuellement leur camera/micro en direct.

const diffuseurs = new Map(); // utilisateurId -> { nomComplet, grade, posteNom, dateDebut }

function ajouter(utilisateurId, info) {
  diffuseurs.set(utilisateurId, { ...info, dateDebut: Date.now() });
}

function retirer(utilisateurId) {
  diffuseurs.delete(utilisateurId);
}

function lister() {
  return Array.from(diffuseurs.entries()).map(([utilisateurId, info]) => ({ utilisateurId, ...info }));
}

function estActif(utilisateurId) {
  return diffuseurs.has(utilisateurId);
}

module.exports = { ajouter, retirer, lister, estActif };
