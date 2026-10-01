// routes/zones.js
// Zones/secteurs dessines sur la carte (polygones ou cercles), avec
// statistiques du nombre d'affaires/avis/objets a l'interieur de chacune.
const express = require("express");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion, exigerRole } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");
const { pointDansZone } = require("../middleware/geo");

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
  res.json({ zones: donnees.zones });
});

router.post("/", exigerConnexion, (req, res) => {
  const nom = nettoyerTexte(req.body.nom, 200);
  const type = req.body.type === "cercle" ? "cercle" : "polygone";
  const posteId = req.body.posteId ? parseInt(req.body.posteId, 10) : null;
  const couleur = nettoyerTexte(req.body.couleur, 20) || "#3f7fb0";

  if (!estChaineNonVide(nom)) {
    return res.status(400).json({ erreur: "Le nom de la zone est obligatoire." });
  }

  const nouvelleZone = {
    id: idSuivant("zones"),
    nom,
    type,
    couleur,
    poste_id: posteId,
    cree_par: req.session.utilisateur.id,
    date_creation: new Date().toISOString()
  };

  if (type === "cercle") {
    if (!req.body.centre || !Number.isFinite(req.body.rayonMetres)) {
      return res.status(400).json({ erreur: "Un cercle nécessite un centre et un rayon." });
    }
    nouvelleZone.centre = { lat: req.body.centre.lat, lng: req.body.centre.lng };
    nouvelleZone.rayonMetres = req.body.rayonMetres;
  } else {
    if (!Array.isArray(req.body.points) || req.body.points.length < 3) {
      return res.status(400).json({ erreur: "Un polygone nécessite au moins 3 points." });
    }
    nouvelleZone.points = req.body.points.map((p) => ({ lat: p.lat, lng: p.lng }));
  }

  donnees.zones.push(nouvelleZone);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "CREATION_ZONE", nom);
  res.status(201).json({ succes: true, id: nouvelleZone.id });
});

router.delete("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const zone = donnees.zones.find((z) => z.id === id);
  if (!zone) return res.status(404).json({ erreur: "Zone introuvable." });

  if (req.session.utilisateur.role !== "admin" && zone.cree_par !== req.session.utilisateur.id) {
    return res.status(403).json({ erreur: "Seul un administrateur ou le créateur peut supprimer cette zone." });
  }

  donnees.zones = donnees.zones.filter((z) => z.id !== id);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_ZONE", zone.nom);
  res.json({ succes: true });
});

// --- Statistiques : combien d'affaires/avis/objets tombent dans chaque zone ---
router.get("/statistiques", exigerConnexion, (req, res) => {
  const resultat = donnees.zones.map((zone) => {
    const affairesDedans = donnees.affaires.filter((a) =>
      a.latitude !== null && a.latitude !== undefined && pointDansZone(a.latitude, a.longitude, zone)
    );
    const avisDedans = donnees.avis_recherche.filter((v) =>
      v.latitude !== null && v.latitude !== undefined && pointDansZone(v.latitude, v.longitude, zone)
    );
    const objetsDedans = donnees.objets_voles.filter((o) =>
      o.latitude !== null && o.latitude !== undefined && pointDansZone(o.latitude, o.longitude, zone)
    );
    return {
      zoneId: zone.id,
      nom: zone.nom,
      totalAffaires: affairesDedans.length,
      totalAvis: avisDedans.length,
      totalObjets: objetsDedans.length,
      total: affairesDedans.length + avisDedans.length + objetsDedans.length
    };
  });
  res.json({ statistiques: resultat });
});

module.exports = router;
