// routes/camera.js
const express = require("express");
const router = express.Router();
const { donnees } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const jetonsSignalisation = require("../db/jetonsSignalisation");
const diffuseursActifs = require("../db/diffuseursActifs");

// --- Obtenir un jeton court pour s'identifier ensuite sur la connexion WebSocket ---
router.get("/jeton", exigerConnexion, (req, res) => {
  const poste = donnees.postes.find((p) => p.id === req.session.utilisateur.posteId);
  const jeton = jetonsSignalisation.creerJeton({
    id: req.session.utilisateur.id,
    nomComplet: req.session.utilisateur.nomComplet,
    grade: req.session.utilisateur.grade,
    posteNom: poste ? poste.nom : null
  });
  res.json({ jeton });
});

// --- Liste des agents diffusant actuellement leur camera ---
router.get("/actifs", exigerConnexion, (req, res) => {
  res.json({ actifs: diffuseursActifs.lister() });
});

module.exports = router;
