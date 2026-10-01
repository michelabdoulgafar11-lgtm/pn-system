// routes/affaires.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");

const CATEGORIES_VALIDES = ["vol", "agression", "fraude", "cambriolage", "disparition", "trafic", "autre"];

const DOSSIER_PIECES_JOINTES = path.join(__dirname, "..", "uploads", "affaires");
const EXTENSIONS_AUTORISEES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx"
};

const stockagePieceJointe = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOSSIER_PIECES_JOINTES),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + (EXTENSIONS_AUTORISEES[file.mimetype] || ""))
});

const televersementPieceJointe = multer({
  storage: stockagePieceJointe,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max
  fileFilter: (req, file, cb) => {
    if (!EXTENSIONS_AUTORISEES[file.mimetype]) {
      return cb(new Error("Type de fichier non autorisé. Formats acceptés : PDF, JPG, PNG, WEBP, DOC(X), XLS(X)."));
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

function nomUtilisateur(id) {
  const u = donnees.utilisateurs.find((x) => x.id === id);
  return u ? u.nom_complet : null;
}

function enrichir(affaire) {
  const poste = donnees.postes.find((p) => p.id === affaire.poste_id);
  return {
    ...affaire,
    officier_nom: affaire.officier_id ? nomUtilisateur(affaire.officier_id) : null,
    cree_par_nom: nomUtilisateur(affaire.cree_par),
    poste_nom: poste ? poste.nom : null
  };
}

function genererNumeroDossier() {
  const annee = new Date().getFullYear();
  const prefixe = `AFF-${annee}-`;
  const compteur = donnees.affaires.filter((a) => a.numero_dossier.startsWith(prefixe)).length;
  const numero = String(compteur + 1).padStart(4, "0");
  return prefixe + numero;
}

// Un officier ne voit que les affaires de son propre poste ; un admin voit tout.
function affairesVisibles(req) {
  if (req.session.utilisateur.role === "admin") return donnees.affaires;
  const posteId = req.session.utilisateur.posteId;
  return donnees.affaires.filter((a) => !posteId || a.poste_id === posteId);
}

// Applique les filtres avances communs a la liste et a la recherche.
function appliquerFiltres(liste, req) {
  let resultat = liste;
  const { statut, posteId, officierId, categorie, dateDebut, dateFin, mesAffaires } = req.query;

  if (statut) resultat = resultat.filter((a) => a.statut === statut);
  if (posteId) resultat = resultat.filter((a) => a.poste_id === parseInt(posteId, 10));
  if (officierId) resultat = resultat.filter((a) => a.officier_id === parseInt(officierId, 10));
  if (categorie) resultat = resultat.filter((a) => a.categorie === categorie);
  if (dateDebut) resultat = resultat.filter((a) => a.date_ouverture >= dateDebut);
  if (dateFin) resultat = resultat.filter((a) => a.date_ouverture <= dateFin);
  if (mesAffaires === "1") resultat = resultat.filter((a) => a.officier_id === req.session.utilisateur.id);

  return resultat;
}

// --- Liste de toutes les affaires visibles par l'utilisateur, avec filtres facultatifs ---
router.get("/", exigerConnexion, (req, res) => {
  let affaires = appliquerFiltres(affairesVisibles(req), req);
  affaires = affaires.slice().sort((a, b) => new Date(b.date_creation) - new Date(a.date_creation)).map(enrichir);
  res.json({ affaires, categories: CATEGORIES_VALIDES });
});

// --- Recherche texte + filtres avances ---
router.get("/recherche", exigerConnexion, (req, res) => {
  const terme = nettoyerTexte(req.query.q, 200).toLowerCase();
  let affaires = affairesVisibles(req).filter((a) =>
    a.titre.toLowerCase().includes(terme) ||
    (a.description || "").toLowerCase().includes(terme) ||
    a.numero_dossier.toLowerCase().includes(terme)
  );
  affaires = appliquerFiltres(affaires, req);
  affaires = affaires.slice().sort((a, b) => new Date(b.date_creation) - new Date(a.date_creation)).map(enrichir);
  res.json({ affaires });
});

// --- Detail d'une affaire : infos + notes d'enquete + avis/objets lies ---
router.get("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const affaire = donnees.affaires.find((a) => a.id === id);
  if (!affaire) return res.status(404).json({ erreur: "Affaire introuvable." });

  const avisLies = donnees.avis_recherche.filter((v) => v.affaire_id === id);
  const objetsLies = donnees.objets_voles.filter((o) => o.affaire_id === id);
  const notes = donnees.notes_affaires
    .filter((n) => n.affaire_id === id)
    .sort((a, b) => new Date(b.date_creation) - new Date(a.date_creation))
    .map((n) => ({ ...n, auteur_nom: nomUtilisateur(n.auteur_id) }));

  res.json({ affaire: enrichir(affaire), avisLies, objetsLies, notes });
});

// --- Creation ---
router.post("/", exigerConnexion, (req, res) => {
  const titre = nettoyerTexte(req.body.titre, 300);
  const description = nettoyerTexte(req.body.description, 3000);
  const dateOuverture = nettoyerTexte(req.body.dateOuverture, 20) || new Date().toISOString().slice(0, 10);
  const latitude = req.body.latitude !== undefined && req.body.latitude !== "" ? parseFloat(req.body.latitude) : null;
  const longitude = req.body.longitude !== undefined && req.body.longitude !== "" ? parseFloat(req.body.longitude) : null;
  const lieu = nettoyerTexte(req.body.lieu, 300);
  const categorie = CATEGORIES_VALIDES.includes(req.body.categorie) ? req.body.categorie : "autre";

  if (!estChaineNonVide(titre)) {
    return res.status(400).json({ erreur: "Le titre est obligatoire." });
  }

  const numeroDossier = genererNumeroDossier();
  const maintenant = new Date().toISOString();
  const createur = donnees.utilisateurs.find((u) => u.id === req.session.utilisateur.id);

  const nouvelleAffaire = {
    id: idSuivant("affaires"),
    numero_dossier: numeroDossier,
    titre,
    description,
    statut: "en cours",
    categorie,
    date_ouverture: dateOuverture,
    lieu,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    officier_id: null,
    poste_id: createur ? createur.poste_id || null : null,
    cree_par: req.session.utilisateur.id,
    date_creation: maintenant,
    date_maj: maintenant
  };
  donnees.affaires.push(nouvelleAffaire);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "CREATION_AFFAIRE", numeroDossier);
  res.status(201).json({ succes: true, id: nouvelleAffaire.id, numeroDossier });
});

// --- Mise a jour (titre, description, statut, categorie, officier assigne) ---
router.put("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const affaire = donnees.affaires.find((a) => a.id === id);
  if (!affaire) return res.status(404).json({ erreur: "Affaire introuvable." });

  if (req.body.titre !== undefined) affaire.titre = nettoyerTexte(req.body.titre, 300) || affaire.titre;
  if (req.body.description !== undefined) affaire.description = nettoyerTexte(req.body.description, 3000);
  const statutsValides = ["en cours", "resolu", "classe sans suite"];
  if (statutsValides.includes(req.body.statut)) affaire.statut = req.body.statut;
  if (CATEGORIES_VALIDES.includes(req.body.categorie)) affaire.categorie = req.body.categorie;
  if (req.body.officierId !== undefined) {
    affaire.officier_id = req.body.officierId === null || req.body.officierId === "" ? null : parseInt(req.body.officierId, 10);
  }
  affaire.date_maj = new Date().toISOString();

  sauvegarder();
  journaliser(req.session.utilisateur.id, "MODIFICATION_AFFAIRE", affaire.numero_dossier);
  res.json({ succes: true });
});

// --- Ajouter une note d'enquete datee (jamais modifiee ni supprimee, pour garder un historique fiable) ---
router.post("/:id/notes", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const affaire = donnees.affaires.find((a) => a.id === id);
  if (!affaire) return res.status(404).json({ erreur: "Affaire introuvable." });

  const texte = nettoyerTexte(req.body.texte, 3000);
  if (!estChaineNonVide(texte)) {
    return res.status(400).json({ erreur: "Le texte de la note est obligatoire." });
  }

  const nouvelleNote = {
    id: idSuivant("notes_affaires"),
    affaire_id: id,
    auteur_id: req.session.utilisateur.id,
    texte,
    date_creation: new Date().toISOString()
  };
  donnees.notes_affaires.push(nouvelleNote);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "AJOUT_NOTE_AFFAIRE", affaire.numero_dossier);
  res.status(201).json({ succes: true, id: nouvelleNote.id });
});

// --- Suppression (admin ou createur uniquement) ---
router.delete("/:id", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const index = donnees.affaires.findIndex((a) => a.id === id);
  if (index === -1) return res.status(404).json({ erreur: "Affaire introuvable." });
  const affaire = donnees.affaires[index];

  if (req.session.utilisateur.role !== "admin" && affaire.cree_par !== req.session.utilisateur.id) {
    return res.status(403).json({ erreur: "Seul un administrateur ou le createur peut supprimer cette affaire." });
  }

  donnees.affaires.splice(index, 1);
  donnees.notes_affaires = donnees.notes_affaires.filter((n) => n.affaire_id !== id);
  sauvegarder();
  journaliser(req.session.utilisateur.id, "SUPPRESSION_AFFAIRE", affaire.numero_dossier);
  res.json({ succes: true });
});

// --- Ajouter une piece jointe a une affaire ---
router.post("/:id/pieces-jointes", exigerConnexion, (req, res, next) => {
  televersementPieceJointe.single("fichier")(req, res, (err) => {
    if (err) return res.status(400).json({ erreur: err.message });
    next();
  });
}, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const affaire = donnees.affaires.find((a) => a.id === id);
  if (!affaire) return res.status(404).json({ erreur: "Affaire introuvable." });
  if (!req.file) return res.status(400).json({ erreur: "Aucun fichier reçu." });

  if (!Array.isArray(affaire.pieces_jointes)) affaire.pieces_jointes = [];

  const piece = {
    id: idSuivant("pieces_jointes"),
    nomOriginal: req.file.originalname,
    chemin: "/fichiers/affaires/" + req.file.filename,
    taille: req.file.size,
    ajoutePar: req.session.utilisateur.id,
    dateAjout: new Date().toISOString()
  };
  affaire.pieces_jointes.push(piece);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "AJOUT_PIECE_JOINTE", affaire.numero_dossier + " : " + piece.nomOriginal);
  res.status(201).json({ succes: true, piece });
});

// --- Supprimer une piece jointe ---
router.delete("/:id/pieces-jointes/:pieceId", exigerConnexion, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const pieceId = parseInt(req.params.pieceId, 10);
  const affaire = donnees.affaires.find((a) => a.id === id);
  if (!affaire || !Array.isArray(affaire.pieces_jointes)) return res.status(404).json({ erreur: "Introuvable." });

  const piece = affaire.pieces_jointes.find((p) => p.id === pieceId);
  if (!piece) return res.status(404).json({ erreur: "Pièce jointe introuvable." });

  const cheminFichier = path.join(DOSSIER_PIECES_JOINTES, path.basename(piece.chemin));
  fs.unlink(cheminFichier, () => {});

  affaire.pieces_jointes = affaire.pieces_jointes.filter((p) => p.id !== pieceId);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "SUPPRESSION_PIECE_JOINTE", affaire.numero_dossier + " : " + piece.nomOriginal);
  res.json({ succes: true });
});

module.exports = router;
