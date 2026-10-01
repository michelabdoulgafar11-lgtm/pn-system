// routes/telecom.js
// Emplacement pret a recevoir l'integration avec une API d'un operateur
// telecom (localisation par triangulation antennes-relais), UNIQUEMENT dans
// le cadre d'un acces legal transmis par l'operateur (requisition judiciaire,
// partenariat officiel). Tant que TELECOM_API_URL n'est pas configure dans
// .env, cette fonctionnalite reste clairement indiquee comme indisponible.
//
// Contrat suppose de l'API operateur (a ajuster des reception de la vraie
// documentation) : POST {TELECOM_API_URL} avec { numero } et l'en-tete
// Authorization: Bearer {TELECOM_API_KEY}, reponse JSON attendue :
// { latitude, longitude, precisionMetres, dateLocalisation }
const express = require("express");
const http = require("http");
const https = require("https");
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

function appellerApiOperateur(numero) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.TELECOM_API_URL);
    const module_ = url.protocol === "https:" ? https : http;
    const corps = JSON.stringify({ numero });

    const requete = module_.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (process.env.TELECOM_API_KEY || ""),
          "Content-Length": Buffer.byteLength(corps)
        },
        timeout: 10000
      },
      (reponse) => {
        let donneesRecues = "";
        reponse.on("data", (m) => { donneesRecues += m; });
        reponse.on("end", () => {
          try { resolve(JSON.parse(donneesRecues)); } catch (err) { reject(new Error("Reponse invalide de l'API operateur.")); }
        });
      }
    );
    requete.on("timeout", () => requete.destroy(new Error("Delai depasse.")));
    requete.on("error", reject);
    requete.write(corps);
    requete.end();
  });
}

// --- Indique si l'integration est configuree ---
router.get("/statut", exigerConnexion, (req, res) => {
  res.json({ disponible: Boolean(process.env.TELECOM_API_URL) });
});

// --- Localiser un numero via l'API de l'operateur (si configuree) ---
router.post("/localiser", exigerConnexion, async (req, res) => {
  if (!process.env.TELECOM_API_URL) {
    return res.status(503).json({
      erreur: "Cette fonctionnalité nécessite un accès légal transmis par un opérateur télécom (réquisition judiciaire ou partenariat officiel). Configurez TELECOM_API_URL et TELECOM_API_KEY dans le fichier .env une fois cet accès obtenu."
    });
  }

  const numero = nettoyerTexte(req.body.numero, 30);
  if (!estChaineNonVide(numero)) {
    return res.status(400).json({ erreur: "Numéro de téléphone requis." });
  }

  try {
    const resultat = await appellerApiOperateur(numero);
    journaliser(req.session.utilisateur.id, "LOCALISATION_NUMERO_OPERATEUR", numero);
    res.json({ succes: true, resultat });
  } catch (err) {
    console.error(err);
    res.status(502).json({ erreur: "Impossible de contacter l'API de l'opérateur : " + err.message });
  }
});

module.exports = router;
