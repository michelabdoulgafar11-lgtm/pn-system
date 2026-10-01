// db/jetonsSignalisation.js
// Un WebSocket ne peut pas facilement reutiliser le cookie de session HTTP
// de façon fiable/simple. On genere donc un jeton court, aleatoire et a
// usage unique via une route HTTP normale (protegee par exigerConnexion),
// que le navigateur transmet ensuite lors de la connexion WebSocket pour
// prouver son identite sans dupliquer toute la logique de session.

const crypto = require("crypto");

const DUREE_VALIDITE_MS = 60 * 1000; // 60 secondes pour se connecter avec ce jeton

const jetons = new Map(); // jeton -> { utilisateur, expiration }

function creerJeton(utilisateur) {
  const jeton = crypto.randomBytes(24).toString("hex");
  jetons.set(jeton, { utilisateur, expiration: Date.now() + DUREE_VALIDITE_MS });
  return jeton;
}

function verifierEtConsommerJeton(jeton) {
  const entree = jetons.get(jeton);
  jetons.delete(jeton); // usage unique, valide ou non
  if (!entree || Date.now() > entree.expiration) return null;
  return entree.utilisateur;
}

module.exports = { creerJeton, verifierEtConsommerJeton };
