// gestionnaireRtsp.js
// Convertit un flux RTSP (cameras IP professionnelles) en HLS (.m3u8), un
// format que les navigateurs peuvent lire, via le programme externe ffmpeg.
// ffmpeg n'est PAS installe automatiquement : c'est un logiciel a part que
// l'utilisateur doit installer lui-meme sur la machine qui fait tourner le
// serveur (voir le README). Sans ffmpeg present, les cameras RTSP affichent
// clairement une erreur au lieu de faire planter le serveur.

const { spawn, execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const DOSSIER_SORTIE = path.join(__dirname, "fichiers-rtsp");
const processus = new Map(); // cameraId -> objet processus enfant ffmpeg

let ffmpegDisponible = null; // null = pas encore teste, true/false ensuite

function verifierFfmpegDisponible(callback) {
  if (ffmpegDisponible !== null) return callback(ffmpegDisponible);
  execFile("ffmpeg", ["-version"], (erreur) => {
    ffmpegDisponible = !erreur;
    callback(ffmpegDisponible);
  });
}

function demarrerFlux(cameraId, urlRtsp) {
  return new Promise((resolve) => {
    verifierFfmpegDisponible((disponible) => {
      if (!disponible) {
        return resolve({ succes: false, erreur: "ffmpeg n'est pas installe ou introuvable sur ce serveur. Voir le README pour l'installer." });
      }

      arreterFlux(cameraId); // au cas ou un ancien processus tournerait deja

      const dossierCamera = path.join(DOSSIER_SORTIE, String(cameraId));
      fs.mkdirSync(dossierCamera, { recursive: true });
      const cheminPlaylist = path.join(dossierCamera, "stream.m3u8");

      const enfant = spawn("ffmpeg", [
        "-rtsp_transport", "tcp",
        "-i", urlRtsp,
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-tune", "zerolatency",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "3",
        "-hls_flags", "delete_segments+omit_endlist",
        cheminPlaylist
      ]);

      enfant.on("error", () => { processus.delete(cameraId); });
      enfant.on("exit", () => { processus.delete(cameraId); });

      processus.set(cameraId, enfant);
      resolve({ succes: true, cheminRelatif: `/fichiers/rtsp/${cameraId}/stream.m3u8` });
    });
  });
}

function arreterFlux(cameraId) {
  const enfant = processus.get(cameraId);
  if (enfant) {
    enfant.kill("SIGKILL");
    processus.delete(cameraId);
  }
}

function estActif(cameraId) {
  return processus.has(cameraId);
}

module.exports = { demarrerFlux, arreterFlux, estActif, verifierFfmpegDisponible, DOSSIER_SORTIE };
