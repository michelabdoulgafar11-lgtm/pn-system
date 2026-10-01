// routes/avis.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");

const DOSSIER_UPLOADS = path.join(__dirname, "..", "uploads", "avis");
const TYPES_AUTORISES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

const stockage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOSSIER_UPLOADS),
  filename: (req, file, cb) => {
    const nomAleatoire = crypto.randomBytes(16).toString("hex");
    cb(null, nomAleatoire + EXTENSIONS[file.mimetype]);
  }
});

const televersement = multer({
  storage: stockage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo max
  fileFilter: (req, file, cb) => {
    if (!TYPES_AUTORISES.has(file.mimetype)) {
      return cb(new Error("Type de fichier non autorise. Formats acceptes : JPG, PNG, WEBP."));
    }
    cb(null, true);
  }
});

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
  const avis = donnees.avis_recherche
    .slice()
    .sort((a, b) => {
      if (Boolean(a.priorite) !== Boolean(b.priorite)) return a.priorite ? -1 : 1;
      return new Date(b.date_creation) - new Date(a.date_creation);
    });
  res.json({ avis });
});

// --- Descripteurs faciaux de tous les avis qui en ont un (pour la reconnaissance faciale) ---
router.get("/descripteurs", exigerConnexion, (req, res) => {
  const resultats = donnees.avis_recherche
    .filter((v) => Array.isArray(v.descripteur_facial))
    .map((v) => ({
      avisId: v.id,
      nom: v.nom,
      photoChemin: v.photo_chemin,
      statut: v.statut,
      descripteur: v.descripteur_facial
    }));
  res.json({ descripteurs: resultats });
});

router.post("/", exigerConnexion, (req, res, next) => {
  televersement.single("photo")(req, res, (err) => {
    if (err) return res.status(400).json({ erreur: err.message });
    next();
  });
}, (req, res) => {
  const nom = nettoyerTexte(req.body.nom, 200);
  const descriptionPhysique = nettoyerTexte(req.body.descriptionPhysique, 1000);
  const localisation = nettoyerTexte(req.body.localisation, 300);
  const motif = nettoyerTexte(req.body.motif, 500);
  const latitude = req.body.latitude !== undefined && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude !== undefined && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null;
  const priorite = req.body.priorite === "true" || req.body.priorite === true || req.body.priorite === "1";
  const affaireId = req.body.affaireId ? parseInt(req.body.affaireId, 10) : null;

  // Le descripteur facial est un tableau de 128 nombres calcule COTE NAVIGATEUR
  // a partir de la photo (jamais la photo elle-meme n'est analysee cote serveur).
  // C'est une empreinte mathematique du visage, pas une image.
  let descripteurFacial = null;
  if (req.body.descripteurFacial) {
    try {
      const tableau = JSON.parse(req.body.descripteurFacial);
      if (Array.isArray(tableau) && tableau.length === 128) descripteurFacial = tableau;
    } catch (err) { /* descripteur invalide, on l'ignore simplement */ }
  }

  if (!estChaineNonVide(nom)) {
    return res.status(400).json({ erreur: "Le nom est obligatoire." });
  }

  const cheminPhoto = req.file ? "/fichiers/avis/" + req.file.filename : null;

  const nouvelAvis = {
    id: idSuivant("avis_recherche"),
    nom,
    description_physique: descriptionPhysique,
    localisation_signalement: localisation,
    motif,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    priorite,
    photo_chemin: cheminPhoto,
    descripteur_facial: descripteurFacial,
    statut: "actif",
    affaire_id: Number.isFinite(affaireId) ? affaireId : null,
    cree_par: req.session.utilisateur.id,
    date_creation: new Date().toISOString()
  };
  donnees.avis_recherche.push(nouvelAvis);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "CREATION_AVIS_RECHERCHE", nom);
  res.status(201).json({ succes: true, id: nouvelAvis.id });
});

router.patch("/:id/statut", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const statutsValides = ["actif", "localise", "annule"];
  if (!statutsValides.includes(req.body.statut)) {
    return res.status(400).json({ erreur: "Statut invalide." });
  }
  const avis = donnees.avis_recherche.find((v) => v.id === id);
  if (!avis) return res.status(404).json({ erreur: "Avis introuvable." });

  avis.statut = req.body.statut;
  sauvegarder();
  journaliser(req.session.utilisateur.id, "MODIFICATION_STATUT_AVIS", "ID " + id);
  res.json({ succes: true });
});

router.delete("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = donnees.avis_recherche.findIndex((v) => v.id === id);
  if (index === -1) return res.status(404).json({ erreur: "Avis introuvable." });
  const avis = donnees.avis_recherche[index];

  if (avis.photo_chemin) {
    const cheminFichier = path.join(DOSSIER_UPLOADS, path.basename(avis.photo_chemin));
    fs.unlink(cheminFichier, () => {}); // suppression silencieuse si echec
  }

  donnees.avis_recherche.splice(index, 1);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_AVIS_RECHERCHE", avis.nom);
  res.json({ succes: true });
});

module.exports = router;
