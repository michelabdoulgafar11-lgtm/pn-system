// routes/assistant.js
// Assistant IA (facultatif). N'est actif que si la variable d'environnement
// ANTHROPIC_API_KEY est definie dans le fichier .env. Utilise le module
// natif "https" de Node (aucune dependance supplementaire a installer).
//
// L'assistant peut maintenant AGIR sur le systeme (creer une affaire, ajouter
// une note, changer un statut) en plus de repondre a des questions. Les
// actions sensibles (suppression) ne sont JAMAIS executees directement :
// l'assistant propose l'action, et le frontend doit demander confirmation a
// l'utilisateur avant d'appeler /confirmer-action.
const express = require("express");
const https = require("https");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const { nettoyerTexte, estChaineNonVide } = require("../middleware/validation");

const CATEGORIES_VALIDES = ["vol", "agression", "fraude", "cambriolage", "disparition", "trafic", "autre"];
const OUTILS_SENSIBLES = ["supprimer_affaire"];

const OUTILS = [
  {
    name: "creer_affaire",
    description: "Cree une nouvelle affaire (dossier) dans le systeme de gestion policiere.",
    input_schema: {
      type: "object",
      properties: {
        titre: { type: "string", description: "Titre court de l'affaire" },
        description: { type: "string", description: "Description detaillee, facultative" },
        categorie: { type: "string", enum: CATEGORIES_VALIDES },
        dateOuverture: { type: "string", description: "Date au format AAAA-MM-JJ, facultatif (aujourd'hui par defaut)" }
      },
      required: ["titre"]
    }
  },
  {
    name: "ajouter_note_affaire",
    description: "Ajoute une note d'enquete datee a une affaire existante, identifiee par son numero de dossier (ex. AFF-2026-0001).",
    input_schema: {
      type: "object",
      properties: {
        numeroDossier: { type: "string" },
        texte: { type: "string" }
      },
      required: ["numeroDossier", "texte"]
    }
  },
  {
    name: "changer_statut_affaire",
    description: "Change le statut d'une affaire existante, identifiee par son numero de dossier.",
    input_schema: {
      type: "object",
      properties: {
        numeroDossier: { type: "string" },
        statut: { type: "string", enum: ["en cours", "resolu", "classe sans suite"] }
      },
      required: ["numeroDossier", "statut"]
    }
  },
  {
    name: "supprimer_affaire",
    description: "Supprime definitivement une affaire. ACTION SENSIBLE ET IRREVERSIBLE : ne jamais executer sans confirmation explicite de l'utilisateur humain.",
    input_schema: {
      type: "object",
      properties: { numeroDossier: { type: "string" } },
      required: ["numeroDossier"]
    }
  }
];

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

function trouverAffaireParNumero(numeroDossier) {
  return donnees.affaires.find((a) => a.numero_dossier.toLowerCase() === String(numeroDossier || "").toLowerCase());
}

// --- Execution reelle des outils NON sensibles (appelee automatiquement) ---
function executerOutil(nomOutil, entree, utilisateurId) {
  switch (nomOutil) {
    case "creer_affaire": {
      const annee = new Date().getFullYear();
      const prefixe = `AFF-${annee}-`;
      const compteur = donnees.affaires.filter((a) => a.numero_dossier.startsWith(prefixe)).length;
      const numeroDossier = prefixe + String(compteur + 1).padStart(4, "0");
      const maintenant = new Date().toISOString();
      const createur = donnees.utilisateurs.find((u) => u.id === utilisateurId);

      const nouvelleAffaire = {
        id: idSuivant("affaires"),
        numero_dossier: numeroDossier,
        titre: nettoyerTexte(entree.titre, 300),
        description: nettoyerTexte(entree.description, 3000),
        statut: "en cours",
        categorie: CATEGORIES_VALIDES.includes(entree.categorie) ? entree.categorie : "autre",
        date_ouverture: entree.dateOuverture || maintenant.slice(0, 10),
        officier_id: null,
        poste_id: createur ? createur.poste_id || null : null,
        cree_par: utilisateurId,
        date_creation: maintenant,
        date_maj: maintenant
      };
      donnees.affaires.push(nouvelleAffaire);
      sauvegarder();
      journaliser(utilisateurId, "CREATION_AFFAIRE", numeroDossier + " (via assistant IA)");
      return { succes: true, numeroDossier };
    }

    case "ajouter_note_affaire": {
      const affaire = trouverAffaireParNumero(entree.numeroDossier);
      if (!affaire) return { succes: false, erreur: "Affaire " + entree.numeroDossier + " introuvable." };
      donnees.notes_affaires.push({
        id: idSuivant("notes_affaires"),
        affaire_id: affaire.id,
        auteur_id: utilisateurId,
        texte: nettoyerTexte(entree.texte, 3000),
        date_creation: new Date().toISOString()
      });
      sauvegarder();
      journaliser(utilisateurId, "AJOUT_NOTE_AFFAIRE", affaire.numero_dossier + " (via assistant IA)");
      return { succes: true };
    }

    case "changer_statut_affaire": {
      const affaire = trouverAffaireParNumero(entree.numeroDossier);
      if (!affaire) return { succes: false, erreur: "Affaire " + entree.numeroDossier + " introuvable." };
      affaire.statut = entree.statut;
      affaire.date_maj = new Date().toISOString();
      sauvegarder();
      journaliser(utilisateurId, "MODIFICATION_AFFAIRE", affaire.numero_dossier + " (via assistant IA)");
      return { succes: true };
    }

    default:
      return { succes: false, erreur: "Outil inconnu." };
  }
}

// --- Appel a l'API Claude, avec ou sans outils ---
function appellerClaude(messages, systeme, outils) {
  return new Promise((resolve, reject) => {
    const corps = JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: systeme,
      messages,
      ...(outils ? { tools: outils } : {})
    });

    const requete = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(corps)
        }
      },
      (reponse) => {
        let donneesRecues = "";
        reponse.on("data", (morceau) => { donneesRecues += morceau; });
        reponse.on("end", () => {
          try {
            const json = JSON.parse(donneesRecues);
            if (json.error) return reject(new Error(json.error.message || "Erreur de l'API Claude."));
            resolve(json);
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    requete.on("error", reject);
    requete.write(corps);
    requete.end();
  });
}

function resumeDonnees() {
  return {
    affaires: donnees.affaires.map((a) => ({ numero: a.numero_dossier, titre: a.titre, statut: a.statut, categorie: a.categorie, date_ouverture: a.date_ouverture })),
    avis: donnees.avis_recherche.map((v) => ({ nom: v.nom, statut: v.statut, localisation: v.localisation_signalement })),
    objets: donnees.objets_voles.map((o) => ({ type: o.type_objet, statut: o.statut, date_vol: o.date_vol }))
  };
}

// --- Indique au frontend si l'assistant est disponible ---
router.get("/statut", exigerConnexion, (req, res) => {
  res.json({ disponible: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// --- Poser une question ou demander une action a l'assistant ---
router.post("/demander", exigerConnexion, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      erreur: "L'assistant IA n'est pas configure. Ajoutez ANTHROPIC_API_KEY dans le fichier .env pour l'activer."
    });
  }

  const question = nettoyerTexte(req.body.question, 2000);
  if (!estChaineNonVide(question)) {
    return res.status(400).json({ erreur: "Veuillez poser une question." });
  }

  const messageSysteme =
    "Tu es un assistant qui aide des officiers de police a analyser leurs dossiers et a " +
    "effectuer des actions dans leur systeme de gestion (creer une affaire, ajouter une note, " +
    "changer un statut, supprimer une affaire). Reponds en francais, de facon concise et factuelle. " +
    "Utilise les outils fournis quand l'utilisateur demande explicitement une action. " +
    "Pour les questions d'information, reponds directement a partir des donnees fournies ci-dessous, " +
    "sans utiliser d'outil. Voici les donnees actuelles : " + JSON.stringify(resumeDonnees());

  try {
    let reponseClaude = await appellerClaude(
      [{ role: "user", content: question }],
      messageSysteme,
      OUTILS
    );

    const blocsOutils = (reponseClaude.content || []).filter((b) => b.type === "tool_use");
    const texteInitial = (reponseClaude.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");

    if (blocsOutils.length === 0) {
      return res.json({ reponse: texteInitial || "(Pas de réponse)" });
    }

    // Si un outil sensible est demande, on s'arrete ici et on demande confirmation
    const outilSensible = blocsOutils.find((b) => OUTILS_SENSIBLES.includes(b.name));
    if (outilSensible) {
      return res.json({
        confirmationRequise: true,
        outil: outilSensible.name,
        parametres: outilSensible.input,
        reponse: texteInitial || `L'assistant propose d'exécuter : ${outilSensible.name} avec ${JSON.stringify(outilSensible.input)}. Confirmez-vous ?`
      });
    }

    // Sinon on execute directement les outils non sensibles, puis on redemande
    // a Claude un resume final en langage naturel.
    const resultatsOutils = blocsOutils.map((bloc) => ({
      type: "tool_result",
      tool_use_id: bloc.id,
      content: JSON.stringify(executerOutil(bloc.name, bloc.input, req.session.utilisateur.id))
    }));

    const suite = await appellerClaude(
      [
        { role: "user", content: question },
        { role: "assistant", content: reponseClaude.content },
        { role: "user", content: resultatsOutils }
      ],
      messageSysteme,
      OUTILS
    );

    const texteFinal = (suite.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    res.json({ reponse: texteFinal || "Action effectuée." });
  } catch (err) {
    console.error(err);
    res.status(502).json({ erreur: "Impossible de contacter l'assistant IA pour le moment." });
  }
});

// --- Confirmer et executer une action sensible proposee par l'assistant ---
router.post("/confirmer-action", exigerConnexion, (req, res) => {
  const { outil, parametres } = req.body;
  if (!OUTILS_SENSIBLES.includes(outil)) {
    return res.status(400).json({ erreur: "Action non reconnue ou non sensible (ne nécessite pas cette confirmation)." });
  }

  if (outil === "supprimer_affaire") {
    const affaire = trouverAffaireParNumero(parametres.numeroDossier);
    if (!affaire) return res.status(404).json({ erreur: "Affaire introuvable." });

    if (req.session.utilisateur.role !== "admin" && affaire.cree_par !== req.session.utilisateur.id) {
      return res.status(403).json({ erreur: "Seul un administrateur ou le créateur peut supprimer cette affaire." });
    }

    donnees.affaires = donnees.affaires.filter((a) => a.id !== affaire.id);
    donnees.notes_affaires = donnees.notes_affaires.filter((n) => n.affaire_id !== affaire.id);
    sauvegarder();
    journaliser(req.session.utilisateur.id, "SUPPRESSION_AFFAIRE", affaire.numero_dossier + " (via assistant IA, confirmée)");
    return res.json({ succes: true, reponse: "Affaire " + affaire.numero_dossier + " supprimée." });
  }

  res.status(400).json({ erreur: "Action non implémentée." });
});

module.exports = router;
