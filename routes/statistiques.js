// routes/statistiques.js
const express = require("express");
const router = express.Router();
const { donnees } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");

router.get("/", exigerConnexion, (req, res) => {
  const totalAffaires = donnees.affaires.length;

  const compteurParStatut = {};
  donnees.affaires.forEach((a) => {
    compteurParStatut[a.statut] = (compteurParStatut[a.statut] || 0) + 1;
  });
  const affairesParStatut = Object.entries(compteurParStatut).map(([statut, total]) => ({ statut, total }));

  const totalAvisActifs = donnees.avis_recherche.filter((v) => v.statut === "actif").length;
  const totalObjetsRecherches = donnees.objets_voles.filter((o) => o.statut === "recherche").length;

  // --- Repartition par poste ---
  const compteurParPoste = {};
  donnees.affaires.forEach((a) => {
    const poste = donnees.postes.find((p) => p.id === a.poste_id);
    const nom = poste ? poste.nom : "Non assigne";
    compteurParPoste[nom] = (compteurParPoste[nom] || 0) + 1;
  });
  const affairesParPoste = Object.entries(compteurParPoste).map(([poste, total]) => ({ poste, total }));

  // --- Evolution mensuelle (12 derniers mois) sur la date de creation des affaires ---
  const maintenant = new Date();
  const mois = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(maintenant.getFullYear(), maintenant.getMonth() - i, 1);
    mois.push({ cle: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), libelle: d.toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) });
  }
  const compteurParMois = {};
  donnees.affaires.forEach((a) => {
    const d = new Date(a.date_creation);
    const cle = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    compteurParMois[cle] = (compteurParMois[cle] || 0) + 1;
  });
  const evolutionMensuelle = mois.map((m) => ({ mois: m.libelle, total: compteurParMois[m.cle] || 0 }));

  // --- Repartition des avis et objets par statut (pour les graphiques) ---
  const avisParStatut = {};
  donnees.avis_recherche.forEach((v) => { avisParStatut[v.statut] = (avisParStatut[v.statut] || 0) + 1; });

  const objetsParStatut = {};
  donnees.objets_voles.forEach((o) => { objetsParStatut[o.statut] = (objetsParStatut[o.statut] || 0) + 1; });

  res.json({
    totalAffaires,
    affairesParStatut,
    totalAvisActifs,
    totalObjetsRecherches,
    affairesParPoste,
    evolutionMensuelle,
    avisParStatut: Object.entries(avisParStatut).map(([statut, total]) => ({ statut, total })),
    objetsParStatut: Object.entries(objetsParStatut).map(([statut, total]) => ({ statut, total })),
    totalPostes: donnees.postes.filter((p) => p.actif === 1).length,
    totalUtilisateurs: donnees.utilisateurs.filter((u) => u.actif === 1).length
  });
});

module.exports = router;
