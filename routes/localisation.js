// routes/localisation.js
// Permet a un utilisateur connecte d'activer/desactiver le partage de sa
// position en temps reel, et permet a tout utilisateur connecte de voir la
// liste des agents actuellement actifs (position partagee dans les 3
// dernieres minutes).
const express = require("express");
const router = express.Router();
const { donnees } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const positionsActives = require("../db/positionsActives");

// --- Envoyer/mettre a jour sa propre position ---
router.post("/", exigerConnexion, (req, res) => {
  const latitude = parseFloat(req.body.latitude);
  const longitude = parseFloat(req.body.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ erreur: "Coordonnees invalides." });
  }

  positionsActives.definir(req.session.utilisateur.id, latitude, longitude);
  res.json({ succes: true });
});

// --- Arreter de partager sa position ---
router.delete("/", exigerConnexion, (req, res) => {
  positionsActives.retirer(req.session.utilisateur.id);
  res.json({ succes: true });
});

// --- Distance en kilometres entre deux points GPS (formule de haversine) ---
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Liste des agents actifs a proximite d'un point donne, tries par distance ---
router.get("/proches", exigerConnexion, (req, res) => {
  const latitude = parseFloat(req.query.latitude);
  const longitude = parseFloat(req.query.longitude);
  const rayonKm = req.query.rayonKm ? parseFloat(req.query.rayonKm) : 5;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ erreur: "Coordonnees invalides." });
  }

  const proches = positionsActives.listerActifs()
    .filter((p) => p.utilisateurId !== req.session.utilisateur.id)
    .map((p) => {
      const utilisateur = donnees.utilisateurs.find((u) => u.id === p.utilisateurId);
      const poste = utilisateur ? donnees.postes.find((posteItem) => posteItem.id === utilisateur.poste_id) : null;
      return {
        utilisateurId: p.utilisateurId,
        nomComplet: utilisateur ? utilisateur.nom_complet : "Agent inconnu",
        grade: utilisateur ? utilisateur.grade : "",
        posteNom: poste ? poste.nom : null,
        distanceKm: Math.round(distanceKm(latitude, longitude, p.latitude, p.longitude) * 10) / 10
      };
    })
    .filter((a) => a.distanceKm <= rayonKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  res.json({ proches });
});

// --- Liste des agents actuellement actifs (position partagee recemment) ---
router.get("/actifs", exigerConnexion, (req, res) => {
  const actifs = positionsActives.listerActifs().map((p) => {
    const utilisateur = donnees.utilisateurs.find((u) => u.id === p.utilisateurId);
    const poste = utilisateur ? donnees.postes.find((posteItem) => posteItem.id === utilisateur.poste_id) : null;
    return {
      utilisateurId: p.utilisateurId,
      nomComplet: utilisateur ? utilisateur.nom_complet : "Agent inconnu",
      grade: utilisateur ? utilisateur.grade : "",
      posteNom: poste ? poste.nom : null,
      latitude: p.latitude,
      longitude: p.longitude,
      dateMaj: p.dateMaj
    };
  });
  res.json({ actifs });
});

module.exports = router;
