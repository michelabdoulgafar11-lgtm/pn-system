// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion, exigerRole } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");
const positionsActives = require("../db/positionsActives");

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

// --- Connexion ---
// Limite simple anti-brute-force en memoire (par IP + identifiant)
const tentativesEchouees = new Map();
const LIMITE_TENTATIVES = 5;
const FENETRE_MS = 15 * 60 * 1000; // 15 minutes

router.post("/connexion", (req, res) => {
  const identifiant = nettoyerTexte(req.body.identifiant, 100);
  const motDePasse = req.body.motDePasse || "";
  const ip = req.ip;

  const cleTentative = ip + ":" + identifiant;
  const maintenant = Date.now();
  const enregistrement = tentativesEchouees.get(cleTentative);
  if (enregistrement && enregistrement.count >= LIMITE_TENTATIVES && (maintenant - enregistrement.dernier) < FENETRE_MS) {
    return res.status(429).json({ erreur: "Trop de tentatives. Reessayez plus tard." });
  }

  if (!estChaineNonVide(identifiant) || !estChaineNonVide(motDePasse)) {
    return res.status(400).json({ erreur: "Identifiant et mot de passe requis." });
  }

  const utilisateur = donnees.utilisateurs.find(
    (u) => u.identifiant === identifiant && u.actif === 1
  );

  const motDePasseValide = utilisateur
    ? bcrypt.compareSync(motDePasse, utilisateur.mot_de_passe_hash)
    : false;

  if (!utilisateur || !motDePasseValide) {
    const prev = tentativesEchouees.get(cleTentative) || { count: 0, dernier: 0 };
    tentativesEchouees.set(cleTentative, { count: prev.count + 1, dernier: maintenant });
    return res.status(401).json({ erreur: "Identifiant ou mot de passe incorrect." });
  }

  tentativesEchouees.delete(cleTentative);

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ erreur: "Erreur serveur." });
    req.session.utilisateur = {
      id: utilisateur.id,
      identifiant: utilisateur.identifiant,
      nomComplet: utilisateur.nom_complet,
      grade: utilisateur.grade,
      role: utilisateur.role,
      posteId: utilisateur.poste_id || null,
      doitChangerMotDePasse: Boolean(utilisateur.doit_changer_mot_de_passe)
    };
    journaliser(utilisateur.id, "CONNEXION", "Connexion reussie");
    res.json({ succes: true, utilisateur: req.session.utilisateur });
  });
});

// --- Deconnexion ---
router.post("/deconnexion", exigerConnexion, (req, res) => {
  const idUtilisateur = req.session.utilisateur.id;
  positionsActives.retirer(idUtilisateur);
  journaliser(idUtilisateur, "DECONNEXION", null);
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ succes: true });
  });
});

// --- Qui suis-je ---
router.get("/moi", (req, res) => {
  if (!req.session || !req.session.utilisateur) {
    return res.status(401).json({ erreur: "Non authentifie." });
  }
  res.json({ utilisateur: req.session.utilisateur });
});

// --- Changer son propre mot de passe ---
router.post("/changer-mot-de-passe", exigerConnexion, (req, res) => {
  const ancien = req.body.ancienMotDePasse || "";
  const nouveau = req.body.nouveauMotDePasse || "";

  if (nouveau.length < 8) {
    return res.status(400).json({ erreur: "Le nouveau mot de passe doit contenir au moins 8 caracteres." });
  }

  const utilisateur = donnees.utilisateurs.find((u) => u.id === req.session.utilisateur.id);
  if (!utilisateur || !bcrypt.compareSync(ancien, utilisateur.mot_de_passe_hash)) {
    return res.status(401).json({ erreur: "Ancien mot de passe incorrect." });
  }

  utilisateur.mot_de_passe_hash = bcrypt.hashSync(nouveau, 12);
  utilisateur.doit_changer_mot_de_passe = false;
  sauvegarder();
  req.session.utilisateur.doitChangerMotDePasse = false;
  journaliser(utilisateur.id, "CHANGEMENT_MOT_DE_PASSE", null);
  res.json({ succes: true });
});

// --- Liste simplifiee des officiers, accessible a tout utilisateur connecte
//     (utilisee pour les listes deroulantes d'assignation) ---
router.get("/officiers", exigerConnexion, (req, res) => {
  const officiers = donnees.utilisateurs
    .filter((u) => u.actif === 1)
    .map((u) => {
      const poste = donnees.postes.find((p) => p.id === u.poste_id);
      return {
        id: u.id,
        nomComplet: u.nom_complet,
        grade: u.grade,
        posteId: u.poste_id || null,
        posteNom: poste ? poste.nom : null
      };
    })
    .sort((a, b) => a.nomComplet.localeCompare(b.nomComplet));
  res.json({ officiers });
});

// --- Gestion des comptes (admin uniquement) ---
router.get("/utilisateurs", exigerRole("admin"), (req, res) => {
  const utilisateurs = donnees.utilisateurs
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((u) => {
      const poste = donnees.postes.find((p) => p.id === u.poste_id);
      return {
        id: u.id,
        identifiant: u.identifiant,
        nom_complet: u.nom_complet,
        grade: u.grade,
        role: u.role,
        actif: u.actif,
        poste_id: u.poste_id || null,
        poste_nom: poste ? poste.nom : null,
        date_creation: u.date_creation
      };
    });
  res.json({ utilisateurs });
});

router.post("/utilisateurs", exigerRole("admin"), (req, res) => {
  const identifiant = nettoyerTexte(req.body.identifiant, 100);
  const nomComplet = nettoyerTexte(req.body.nomComplet, 200);
  const grade = nettoyerTexte(req.body.grade, 100);
  const role = req.body.role === "admin" ? "admin" : "officier";
  const motDePasse = req.body.motDePasse || "";
  const posteId = req.body.posteId ? parseInt(req.body.posteId, 10) : null;

  if (!estChaineNonVide(identifiant) || !estChaineNonVide(nomComplet) || motDePasse.length < 8) {
    return res.status(400).json({ erreur: "Champs invalides ou mot de passe trop court (min 8 caracteres)." });
  }

  const existe = donnees.utilisateurs.some((u) => u.identifiant === identifiant);
  if (existe) {
    return res.status(409).json({ erreur: "Cet identifiant existe deja." });
  }

  const hash = bcrypt.hashSync(motDePasse, 12);
  const nouvelUtilisateur = {
    id: idSuivant("utilisateurs"),
    identifiant,
    mot_de_passe_hash: hash,
    nom_complet: nomComplet,
    grade,
    role,
    poste_id: posteId,
    actif: 1,
    doit_changer_mot_de_passe: true,
    date_creation: new Date().toISOString()
  };
  donnees.utilisateurs.push(nouvelUtilisateur);
  sauvegarder();

  journaliser(req.session.utilisateur.id, "CREATION_UTILISATEUR", "Nouvel utilisateur : " + identifiant);
  res.status(201).json({ succes: true, id: nouvelUtilisateur.id });
});

// --- Creation en masse de comptes agents, avec mots de passe generes automatiquement ---
router.post("/utilisateurs/lot", exigerRole("admin"), (req, res) => {
  const agents = Array.isArray(req.body.agents) ? req.body.agents : [];
  const posteId = req.body.posteId ? parseInt(req.body.posteId, 10) : null;
  const resultats = [];

  agents.forEach((agent) => {
    const identifiant = nettoyerTexte(agent.identifiant, 100);
    const nomComplet = nettoyerTexte(agent.nomComplet, 200);
    const grade = nettoyerTexte(agent.grade, 100);

    if (!estChaineNonVide(identifiant) || !estChaineNonVide(nomComplet)) {
      resultats.push({ identifiant: identifiant || "(vide)", succes: false, erreur: "Identifiant ou nom manquant." });
      return;
    }
    if (donnees.utilisateurs.some((u) => u.identifiant === identifiant)) {
      resultats.push({ identifiant, succes: false, erreur: "Identifiant déjà utilisé." });
      return;
    }

    const motDePasseGenere = crypto.randomBytes(6).toString("hex"); // 12 caracteres, facile a transmettre
    const hash = bcrypt.hashSync(motDePasseGenere, 12);

    donnees.utilisateurs.push({
      id: idSuivant("utilisateurs"),
      identifiant,
      mot_de_passe_hash: hash,
      nom_complet: nomComplet,
      grade,
      role: "officier",
      poste_id: posteId,
      actif: 1,
      doit_changer_mot_de_passe: true,
      date_creation: new Date().toISOString()
    });

    resultats.push({ identifiant, nomComplet, motDePasse: motDePasseGenere, succes: true });
  });

  sauvegarder();
  journaliser(req.session.utilisateur.id, "CREATION_UTILISATEURS_EN_MASSE", resultats.filter((r) => r.succes).length + " compte(s) créé(s)");
  res.status(201).json({ resultats });
});

router.patch("/utilisateurs/:id/statut", exigerRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const utilisateur = donnees.utilisateurs.find((u) => u.id === id);
  if (!utilisateur) return res.status(404).json({ erreur: "Utilisateur introuvable." });

  utilisateur.actif = req.body.actif ? 1 : 0;
  sauvegarder();
  journaliser(req.session.utilisateur.id, "MODIFICATION_STATUT_UTILISATEUR", "ID " + id + " -> actif=" + utilisateur.actif);
  res.json({ succes: true });
});

module.exports = router;
