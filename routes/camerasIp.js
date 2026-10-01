// routes/camerasIp.js
// Gestion des cameras IP (RTSP, MJPEG/HTTP, ou telephone en mode "camera IP").
const express = require("express");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion, exigerRole } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");
const gestionnaireRtsp = require("../gestionnaireRtsp");

const TYPES_VALIDES = ["mjpeg", "rtsp"];

function journaliser(utilisateurId, action, details) {
  donnees.journal_audit.push({
    id: idSuivant("journal_audit"),
    utilisateur_id: utilisateurId,
    action,
    details: details || null,
    date_action: new Date().toISOString()
  });
  sauvegarder();
}

// --- Liste des cameras IP, avec leur statut de flux actuel ---
router.get("/", exigerConnexion, (req, res) => {
  const cameras = donnees.cameras_ip.map((c) => ({
    ...c,
    // Pour le MJPEG/HTTP, l'URL d'origine sert directement de flux.
    // Pour le RTSP, on donne le chemin du flux HLS converti (s'il tourne).
    fluxUrl: c.type === "mjpeg" ? c.url : (gestionnaireRtsp.estActif(c.id) ? `/fichiers/rtsp/${c.id}/stream.m3u8` : null)
  }));
  res.json({ cameras });
});

// --- Ajouter une camera (admin) ---
router.post("/", exigerRole("admin"), async (req, res) => {
  const nom = nettoyerTexte(req.body.nom, 200);
  const url = nettoyerTexte(req.body.url, 500);
  const type = TYPES_VALIDES.includes(req.body.type) ? req.body.type : "mjpeg";
  const latitude = req.body.latitude !== undefined && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude !== undefined && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null;

  if (!estChaineNonVide(nom) || !estChaineNonVide(url)) {
    return res.status(400).json({ erreur: "Le nom et l'URL/adresse de la caméra sont obligatoires." });
  }

  const nouvelleCamera = {
    id: idSuivant("cameras_ip"),
    nom,
    url,
    type,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    actif: 1,
    cree_par: req.session.utilisateur.id,
    date_creation: new Date().toISOString()
  };
  donnees.cameras_ip.push(nouvelleCamera);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "AJOUT_CAMERA_IP", nom);

  let resultatDemarrage = { succes: true };
  if (type === "rtsp") {
    resultatDemarrage = await gestionnaireRtsp.demarrerFlux(nouvelleCamera.id, url);
  }

  res.status(201).json({ succes: true, id: nouvelleCamera.id, avertissement: resultatDemarrage.erreur || null });
});

// --- Activer/desactiver une camera (admin) ---
router.patch("/:id/statut", exigerRole("admin"), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const camera = donnees.cameras_ip.find((c) => c.id === id);
  if (!camera) return res.status(404).json({ erreur: "Caméra introuvable." });

  camera.actif = req.body.actif ? 1 : 0;
  sauvegarder();

  if (camera.type === "rtsp") {
    if (camera.actif) await gestionnaireRtsp.demarrerFlux(camera.id, camera.url);
    else gestionnaireRtsp.arreterFlux(camera.id);
  }

  journaliser(req.session.utilisateur.id, "MODIFICATION_STATUT_CAMERA_IP", camera.nom);
  res.json({ succes: true });
});

// --- Supprimer une camera (admin) ---
router.delete("/:id", exigerRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const camera = donnees.cameras_ip.find((c) => c.id === id);
  if (!camera) return res.status(404).json({ erreur: "Caméra introuvable." });

  if (camera.type === "rtsp") gestionnaireRtsp.arreterFlux(id);

  donnees.cameras_ip = donnees.cameras_ip.filter((c) => c.id !== id);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_CAMERA_IP", camera.nom);
  res.json({ succes: true });
});

// --- Journaliser une detection de mouvement (declenchee cote navigateur) ---
router.post("/:id/mouvement", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const camera = donnees.cameras_ip.find((c) => c.id === id);
  if (!camera) return res.status(404).json({ erreur: "Caméra introuvable." });

  journaliser(req.session.utilisateur.id, "MOUVEMENT_DETECTE", "Caméra : " + camera.nom);
  res.json({ succes: true });
});

module.exports = router;
