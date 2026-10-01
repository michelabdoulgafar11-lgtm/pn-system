// routes/activite.js
// Expose le journal d'audit sous forme de fil d'activite lisible, utilise
// par le frontend pour afficher des notifications (interrogeation reguliere
// depuis le navigateur, sans necessiter de connexion permanente/WebSocket).
const express = require("express");
const router = express.Router();
const { donnees } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");

const LIBELLES = {
  CONNEXION: "s'est connecte(e)",
  DECONNEXION: "s'est deconnecte(e)",
  CREATION_AFFAIRE: "a ouvert l'affaire",
  MODIFICATION_AFFAIRE: "a modifie l'affaire",
  SUPPRESSION_AFFAIRE: "a supprime l'affaire",
  CREATION_AVIS_RECHERCHE: "a publie un avis de recherche pour",
  MODIFICATION_STATUT_AVIS: "a modifie le statut d'un avis",
  SUPPRESSION_AVIS_RECHERCHE: "a supprime l'avis de recherche pour",
  CREATION_OBJET_VOLE: "a declare le vol de",
  MODIFICATION_STATUT_OBJET: "a modifie le statut d'un objet",
  SUPPRESSION_OBJET_VOLE: "a supprime l'objet",
  CREATION_UTILISATEUR: "a cree le compte",
  MODIFICATION_STATUT_UTILISATEUR: "a modifie un compte utilisateur",
  CHANGEMENT_MOT_DE_PASSE: "a change son mot de passe",
  CREATION_POSTE: "a cree le poste",
  MODIFICATION_POSTE: "a modifie le poste",
  SUPPRESSION_POSTE: "a supprime le poste",
  MOUVEMENT_DETECTE: "a detecte un mouvement —"
};

router.get("/", exigerConnexion, (req, res) => {
  const depuisId = req.query.depuisId ? parseInt(req.query.depuisId, 10) : 0;

  const evenements = donnees.journal_audit
    .filter((e) => e.id > depuisId)
    .slice(-50)
    .sort((a, b) => b.id - a.id)
    .map((e) => {
      const utilisateur = donnees.utilisateurs.find((u) => u.id === e.utilisateur_id);
      return {
        id: e.id,
        message: (utilisateur ? utilisateur.nom_complet : "Quelqu'un") + " " +
                 (LIBELLES[e.action] || e.action.toLowerCase()) +
                 (e.details ? " : " + e.details : ""),
        date: e.date_action
      };
    });

  const dernierId = donnees.journal_audit.length > 0
    ? donnees.journal_audit[donnees.journal_audit.length - 1].id
    : 0;

  res.json({ evenements, dernierId });
});

module.exports = router;
