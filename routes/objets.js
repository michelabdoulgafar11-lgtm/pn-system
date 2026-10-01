// routes/objets.js
const express = require("express");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
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

router.get("/", exigerConnexion, (req, res) => {
  const objets = donnees.objets_voles
    .slice()
    .sort((a, b) => new Date(b.date_creation) - new Date(a.date_creation));
  res.json({ objets });
});

router.post("/", exigerConnexion, (req, res) => {
  const typeObjet = nettoyerTexte(req.body.typeObjet, 200);
  const description = nettoyerTexte(req.body.description, 1000);
  const dateVol = nettoyerTexte(req.body.dateVol, 20);
  const lieuVol = nettoyerTexte(req.body.lieuVol, 300);
  const latitude = req.body.latitude !== undefined && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude !== undefined && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null;
  const affaireId = req.body.affaireId ? parseInt(req.body.affaireId, 10) : null;

  if (!estChaineNonVide(typeObjet)) {
    return res.status(400).json({ erreur: "Le type d'objet est obligatoire." });
  }

  const nouvelObjet = {
    id: idSuivant("objets_voles"),
    type_objet: typeObjet,
    description,
    date_vol: dateVol,
    lieu_vol: lieuVol,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    statut: "recherche",
    affaire_id: Number.isFinite(affaireId) ? affaireId : null,
    cree_par: req.session.utilisateur.id,
    date_creation: new Date().toISOString()
  };
  donnees.objets_voles.push(nouvelObjet);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "CREATION_OBJET_VOLE", typeObjet);
  res.status(201).json({ succes: true, id: nouvelObjet.id });
});

router.patch("/:id/statut", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const statutsValides = ["recherche", "retrouve"];
  if (!statutsValides.includes(req.body.statut)) {
    return res.status(400).json({ erreur: "Statut invalide." });
  }
  const objet = donnees.objets_voles.find((o) => o.id === id);
  if (!objet) return res.status(404).json({ erreur: "Objet introuvable." });

  objet.statut = req.body.statut;
  sauvegarder();
  journaliser(req.session.utilisateur.id, "MODIFICATION_STATUT_OBJET", "ID " + id);
  res.json({ succes: true });
});

router.delete("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = donnees.objets_voles.findIndex((o) => o.id === id);
  if (index === -1) return res.status(404).json({ erreur: "Objet introuvable." });
  const objet = donnees.objets_voles[index];

  donnees.objets_voles.splice(index, 1);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_OBJET_VOLE", objet.type_objet);
  res.json({ succes: true });
});

module.exports = router;
