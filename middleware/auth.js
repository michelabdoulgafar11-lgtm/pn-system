// middleware/auth.js
// Verifie que l'utilisateur est connecte, et gere les permissions par role.

// routes/auth.js. Ce mot de passe expire n'est jamais bloquant pour ces routes.
const ROUTES_AUTORISEES_MALGRE_MDP_A_CHANGER = [
  "/api/auth/changer-mot-de-passe",
  "/api/auth/deconnexion",
  "/api/auth/moi"
];

function exigerConnexion(req, res, next) {
  if (!req.session || !req.session.utilisateur) {
    return res.status(401).json({ erreur: "Non authentifie. Veuillez vous connecter." });
  }
  if (req.session.utilisateur.doitChangerMotDePasse && !ROUTES_AUTORISEES_MALGRE_MDP_A_CHANGER.includes(req.originalUrl)) {
    return res.status(403).json({ erreur: "Vous devez changer votre mot de passe avant de continuer.", doitChangerMotDePasse: true });
  }
  next();
}

function exigerRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.session || !req.session.utilisateur) {
      return res.status(401).json({ erreur: "Non authentifie." });
    }
    if (req.session.utilisateur.doitChangerMotDePasse && !ROUTES_AUTORISEES_MALGRE_MDP_A_CHANGER.includes(req.originalUrl)) {
      return res.status(403).json({ erreur: "Vous devez changer votre mot de passe avant de continuer.", doitChangerMotDePasse: true });
    }
    if (!rolesAutorises.includes(req.session.utilisateur.role)) {
      return res.status(403).json({ erreur: "Acces refuse : permissions insuffisantes." });
    }
    next();
  };
}

module.exports = { exigerConnexion, exigerRole };
