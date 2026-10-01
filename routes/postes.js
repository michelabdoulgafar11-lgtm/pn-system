// routes/postes.js
// Gestion des postes de police (commissariats). Un utilisateur ou une
// affaire est rattache a un poste ; les statistiques peuvent etre ventilees
// par poste. La creation/modification de postes est reservee aux admins.
const express = require("express");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion, exigerRole } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");

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

// --- Liste des postes (visible par tout utilisateur connecte, pour les menus deroulants) ---
router.get("/", exigerConnexion, (req, res) => {
  const postes = donnees.postes.slice().sort((a, b) => a.nom.localeCompare(b.nom));
  res.json({ postes });
});

// --- Creation d'un poste (admin) ---
router.post("/", exigerRole("admin"), (req, res) => {
  const nom = nettoyerTexte(req.body.nom, 200);
  const ville = nettoyerTexte(req.body.ville, 200);
  const latitude = req.body.latitude !== undefined && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude !== undefined && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null;

  if (!estChaineNonVide(nom)) {
    return res.status(400).json({ erreur: "Le nom du poste est obligatoire." });
  }

  const nouveauPoste = {
    id: idSuivant("postes"),
    nom,
    ville,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    actif: 1,
    date_creation: new Date().toISOString()
  };
  donnees.postes.push(nouveauPoste);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "CREATION_POSTE", nom);
  res.status(201).json({ succes: true, id: nouveauPoste.id });
});

// --- Modification d'un poste (admin) ---
router.put("/:id", exigerRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const poste = donnees.postes.find((p) => p.id === id);
  if (!poste) return res.status(404).json({ erreur: "Poste introuvable." });

  if (req.body.nom !== undefined) poste.nom = nettoyerTexte(req.body.nom, 200) || poste.nom;
  if (req.body.ville !== undefined) poste.ville = nettoyerTexte(req.body.ville, 200);
  if (req.body.actif !== undefined) poste.actif = req.body.actif ? 1 : 0;
  if (req.body.latitude !== undefined) {
    const lat = parseFloat(req.body.latitude);
    poste.latitude = Number.isFinite(lat) ? lat : null;
  }
  if (req.body.longitude !== undefined) {
    const lng = parseFloat(req.body.longitude);
    poste.longitude = Number.isFinite(lng) ? lng : null;
  }

  sauvegarder();
  journaliser(req.session.utilisateur.id, "MODIFICATION_POSTE", poste.nom);
  res.json({ succes: true });
});

// --- Suppression d'un poste (admin), refusee si des utilisateurs ou affaires y sont rattaches ---
router.delete("/:id", exigerRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const poste = donnees.postes.find((p) => p.id === id);
  if (!poste) return res.status(404).json({ erreur: "Poste introuvable." });

  const utilise = donnees.utilisateurs.some((u) => u.poste_id === id) ||
                   donnees.affaires.some((a) => a.poste_id === id);
  if (utilise) {
    return res.status(409).json({ erreur: "Ce poste est encore utilise par des comptes ou des affaires ; desactivez-le plutot que de le supprimer." });
  }

  donnees.postes = donnees.postes.filter((p) => p.id !== id);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_POSTE", poste.nom);
  res.json({ succes: true });
});

module.exports = router;
