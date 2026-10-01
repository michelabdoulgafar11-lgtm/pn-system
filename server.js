// server.js
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { demarrerSignalisation } = require("./signalisation");

const app = express();
const PORT = process.env.PORT || 3000;

// Genere une cle de session au demarrage si aucune n'est fournie dans .env
// (en production, definissez SESSION_SECRET dans le fichier .env pour garder les sessions valides entre redemarrages)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: "pn_session",
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // necessite HTTPS en production
    maxAge: 8 * 60 * 60 * 1000 // 8 heures
  }
}));

// --- Fichiers statiques (interface web) ---
app.use(express.static(path.join(__dirname, "public")));

// --- Fichiers uploades (photos des avis de recherche) ---
app.use("/fichiers/avis", express.static(path.join(__dirname, "uploads", "avis")));

// --- Pieces jointes des affaires ---
app.use("/fichiers/affaires", express.static(path.join(__dirname, "uploads", "affaires")));

// --- Flux video HLS generes par ffmpeg a partir des cameras RTSP ---
app.use("/fichiers/rtsp", express.static(path.join(__dirname, "fichiers-rtsp")));

// --- Routes API ---
app.use("/api/auth", require("./routes/auth"));
app.use("/api/affaires", require("./routes/affaires"));
app.use("/api/avis", require("./routes/avis"));
app.use("/api/objets", require("./routes/objets"));
app.use("/api/statistiques", require("./routes/statistiques"));
app.use("/api/postes", require("./routes/postes"));
app.use("/api/activite", require("./routes/activite"));
app.use("/api/assistant", require("./routes/assistant"));
app.use("/api/carte", require("./routes/carte"));
app.use("/api/localisation", require("./routes/localisation"));
app.use("/api/camera", require("./routes/camera"));
app.use("/api/cameras-ip", require("./routes/camerasIp"));
app.use("/api/zones", require("./routes/zones"));
app.use("/api/telecom", require("./routes/telecom"));

// --- Gestion des erreurs non interceptees ---
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: "Erreur interne du serveur." });
});

const serveurHttp = http.createServer(app);
demarrerSignalisation(serveurHttp);

serveurHttp.listen(PORT, () => {
  console.log(`Systeme de Gestion Policiere demarre sur http://localhost:${PORT}`);
  console.log(`Signalisation camera/audio en direct sur ws://localhost:${PORT}/ws/signalisation`);

  // Relance les flux RTSP qui etaient actifs avant un redemarrage du serveur
  const { donnees } = require("./db/store");
  const gestionnaireRtsp = require("./gestionnaireRtsp");
  donnees.cameras_ip
    .filter((c) => c.type === "rtsp" && c.actif)
    .forEach((c) => gestionnaireRtsp.demarrerFlux(c.id, c.url));
});
