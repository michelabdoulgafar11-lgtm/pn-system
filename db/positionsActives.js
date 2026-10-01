// db/positionsActives.js
// Garde en memoire (pas sur disque : ce sont des donnees ephemeres) la
// derniere position connue de chaque utilisateur ayant active le partage de
// position en temps reel. Une position est consideree perimee au bout de
// quelques minutes sans mise a jour (agent hors ligne, appli fermee, etc.).

const DELAI_EXPIRATION_MS = 3 * 60 * 1000; // 3 minutes sans mise a jour = considere hors ligne

const positions = new Map(); // utilisateurId -> { latitude, longitude, dateMaj }

function definir(utilisateurId, latitude, longitude) {
  positions.set(utilisateurId, { latitude, longitude, dateMaj: Date.now() });
}

function retirer(utilisateurId) {
  positions.delete(utilisateurId);
}

function listerActifs() {
  const maintenant = Date.now();
  const actifs = [];
  for (const [utilisateurId, info] of positions.entries()) {
    if (maintenant - info.dateMaj <= DELAI_EXPIRATION_MS) {
      actifs.push({ utilisateurId, ...info });
    } else {
      positions.delete(utilisateurId); // nettoyage des positions perimees
    }
  }
  return actifs;
}

module.exports = { definir, retirer, listerActifs };
