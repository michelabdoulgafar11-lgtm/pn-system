// public/js/camera.js
// Gere la connexion WebSocket de signalisation, le partage de camera/micro
// d'un agent, et la visualisation en direct par un superviseur.
//
// Rappel du principe de securite/consentement : un agent doit activer
// lui-meme l'interrupteur "Partager ma camera" pour que son flux existe. Ce
// fichier ne peut jamais activer la camera de quelqu'un a son insu.

const CONFIG_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let socketSignalisation = null;
let flotLocalCamera = null;
let partageCameraActif = false;
let connexionsEnTantQueDiffuseur = {}; // superviseurId -> RTCPeerConnection
let connexionsEnTantQueSpectateur = {}; // agentId -> RTCPeerConnection

// ---------- Connexion WebSocket (partagee entre diffusion et supervision) ---------- //
async function assurerConnexionSignalisation() {
  if (socketSignalisation && socketSignalisation.readyState === WebSocket.OPEN) return socketSignalisation;

  const reponseJeton = await fetch("/api/camera/jeton");
  const { jeton } = await reponseJeton.json();

  const protocole = location.protocol === "https:" ? "wss:" : "ws:";
  socketSignalisation = new WebSocket(`${protocole}//${location.host}/ws/signalisation`);

  await new Promise((resolve, reject) => {
    socketSignalisation.addEventListener("open", () => {
      socketSignalisation.send(JSON.stringify({ type: "identification", jeton }));
      resolve();
    });
    socketSignalisation.addEventListener("error", reject);
  });

  socketSignalisation.addEventListener("message", (evenement) => {
    const message = JSON.parse(evenement.data);
    traiterMessageSignalisation(message);
  });

  socketSignalisation.addEventListener("close", () => {
    socketSignalisation = null;
  });

  return socketSignalisation;
}

function envoyerSignal(message) {
  if (socketSignalisation && socketSignalisation.readyState === WebSocket.OPEN) {
    socketSignalisation.send(JSON.stringify(message));
  }
}

async function traiterMessageSignalisation(message) {
  // Les messages lies aux appels de groupe (salles) sont traites a part,
  // par appels.js, meme s'ils partagent des types de message avec la camera
  // (offre/reponse/ice) : on les distingue grace au champ salleId.
  const TYPES_APPEL = ["salle_creee", "invitation_appel", "membres_salle", "nouveau_participant", "participant_parti"];
  if (TYPES_APPEL.includes(message.type) || message.salleId) {
    return traiterMessageAppel(message);
  }

  switch (message.type) {
    // Cote agent : un superviseur souhaite regarder mon flux
    case "demande_visionnage":
      await repondreADemandeVisionnage(message.expediteurId);
      break;

    // Cote superviseur : l'agent m'envoie son offre de connexion
    case "offre":
      await traiterOffreRecue(message.expediteurId, message.sdp);
      break;

    // Cote agent : le superviseur a repondu a mon offre
    case "reponse":
      if (connexionsEnTantQueDiffuseur[message.expediteurId]) {
        await connexionsEnTantQueDiffuseur[message.expediteurId].setRemoteDescription(message.sdp);
      }
      break;

    // Candidats reseau (ICE), dans les deux sens
    case "ice": {
      const connexion = connexionsEnTantQueDiffuseur[message.expediteurId] || connexionsEnTantQueSpectateur[message.expediteurId];
      if (connexion && message.candidate) {
        try { await connexion.addIceCandidate(message.candidate); } catch (err) { console.error(err); }
      }
      break;
    }
  }
}

// ---------- Cote agent : partage de sa propre camera ---------- //
function configurerPartageCamera() {
  const toggle = document.getElementById("togglePartageCamera");
  toggle.addEventListener("change", () => {
    if (toggle.checked) demarrerPartageCamera();
    else arreterPartageCamera();
  });

  window.addEventListener("beforeunload", () => {
    if (partageCameraActif) envoyerSignal({ type: "arreter_diffusion" });
  });
}

async function demarrerPartageCamera() {
  const statut = document.getElementById("statutCamera");
  const previsualisation = document.getElementById("apercuCameraLocale");

  try {
    statut.textContent = "Demande d'accès à la caméra...";
    flotLocalCamera = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    statut.textContent = "Accès à la caméra/micro refusé ou indisponible.";
    document.getElementById("togglePartageCamera").checked = false;
    return;
  }

  previsualisation.srcObject = flotLocalCamera;
  previsualisation.hidden = false;

  await assurerConnexionSignalisation();
  envoyerSignal({ type: "demarrer_diffusion" });

  partageCameraActif = true;
  statut.textContent = "Caméra partagée en direct";
  statut.classList.add("actif");
}

function arreterPartageCamera() {
  partageCameraActif = false;

  if (flotLocalCamera) {
    flotLocalCamera.getTracks().forEach((piste) => piste.stop());
    flotLocalCamera = null;
  }
  document.getElementById("apercuCameraLocale").hidden = true;

  Object.values(connexionsEnTantQueDiffuseur).forEach((connexion) => connexion.close());
  connexionsEnTantQueDiffuseur = {};

  envoyerSignal({ type: "arreter_diffusion" });

  const statut = document.getElementById("statutCamera");
  statut.textContent = "Caméra non partagée";
  statut.classList.remove("actif");
}

// Un superviseur demande a voir mon flux : je lui envoie une offre WebRTC
async function repondreADemandeVisionnage(superviseurId) {
  if (!flotLocalCamera) return;

  const connexion = new RTCPeerConnection(CONFIG_ICE);
  connexionsEnTantQueDiffuseur[superviseurId] = connexion;

  flotLocalCamera.getTracks().forEach((piste) => connexion.addTrack(piste, flotLocalCamera));

  connexion.onicecandidate = (evenement) => {
    if (evenement.candidate) {
      envoyerSignal({ type: "ice", cibleId: superviseurId, candidate: evenement.candidate });
    }
  };

  const offre = await connexion.createOffer();
  await connexion.setLocalDescription(offre);
  envoyerSignal({ type: "offre", cibleId: superviseurId, sdp: offre });
}

// ---------- Cote superviseur : regarder le flux d'un agent ---------- //
async function configurerSupervisionCamera() {
  await chargerDiffuseursActifs();
  setInterval(chargerDiffuseursActifs, 10000);
}

async function chargerDiffuseursActifs() {
  try {
    const reponse = await fetch("/api/camera/actifs");
    const donnees = await reponse.json();
    rendreListeDiffuseurs(donnees.actifs);
  } catch (err) {
    console.error("Erreur de chargement des diffuseurs :", err);
  }
}

function rendreListeDiffuseurs(actifs) {
  const conteneur = document.getElementById("listeDiffuseurs");
  if (!conteneur) return;

  if (actifs.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucun agent ne diffuse sa caméra pour le moment.</div>';
    return;
  }

  conteneur.innerHTML = actifs.map((a) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div class="titre-item">${echapperHtml(a.nomComplet)}</div>
        <button class="bouton-action bouton-valider" onclick="regarderFlux(${a.utilisateurId}, '${echapperHtml(a.nomComplet).replace(/'/g, "\\'")}')">▶ Regarder</button>
      </div>
      <div class="detail">${echapperHtml(a.grade || "")} ${a.posteNom ? "— " + echapperHtml(a.posteNom) : ""}</div>
    </div>
  `).join("");
}

async function regarderFlux(agentId, nomAgent) {
  if (connexionsEnTantQueSpectateur[agentId]) return; // deja en train de regarder

  await assurerConnexionSignalisation();

  const grille = document.getElementById("grilleFluxVideo");
  const idCarte = "flux-" + agentId;
  const carte = document.createElement("div");
  carte.className = "carte-video";
  carte.id = idCarte;
  carte.innerHTML = `
    <div class="entete-carte-video">
      <span>${echapperHtml(nomAgent)}</span>
      <span class="statut-connexion">Connexion en cours...</span>
      <button class="bouton-action" onclick="basculerDetectionMouvement('video-${agentId}', null); this.textContent = this.textContent.includes('Activer') ? '🎯 Désactiver détection' : '🎯 Activer détection';">🎯 Activer détection</button>
      <button class="bouton-action" onclick="arreterVisionnage(${agentId})">Fermer</button>
    </div>
    <video id="video-${agentId}" autoplay playsinline></video>
  `;
  grille.appendChild(carte);

  const connexion = new RTCPeerConnection(CONFIG_ICE);
  connexionsEnTantQueSpectateur[agentId] = connexion;

  connexion.ontrack = (evenement) => {
    document.getElementById("video-" + agentId).srcObject = evenement.streams[0];
    const statutEl = carte.querySelector(".statut-connexion");
    if (statutEl) statutEl.textContent = "En direct";
  };

  connexion.onicecandidate = (evenement) => {
    if (evenement.candidate) {
      envoyerSignal({ type: "ice", cibleId: agentId, candidate: evenement.candidate });
    }
  };

  envoyerSignal({ type: "demande_visionnage", cibleId: agentId });
}

async function traiterOffreRecue(agentId, sdp) {
  const connexion = connexionsEnTantQueSpectateur[agentId];
  if (!connexion) return;

  await connexion.setRemoteDescription(sdp);
  const reponse = await connexion.createAnswer();
  await connexion.setLocalDescription(reponse);
  envoyerSignal({ type: "reponse", cibleId: agentId, sdp: reponse });
}

function arreterVisionnage(agentId) {
  if (connexionsEnTantQueSpectateur[agentId]) {
    connexionsEnTantQueSpectateur[agentId].close();
    delete connexionsEnTantQueSpectateur[agentId];
  }
  const carte = document.getElementById("flux-" + agentId);
  if (carte) carte.remove();
}

// ---------- Cameras IP (RTSP / MJPEG) ---------- //
let instancesHls = {}; // cameraId -> instance Hls.js active

async function configurerCamerasIp() {
  const selectMode = document.getElementById("camMode");
  if (selectMode) {
    const basculerMode = () => {
      const modeSimplifie = selectMode.value === "ipwebcam";
      document.getElementById("champIpWebcamAdresse").hidden = !modeSimplifie;
      document.getElementById("champIpWebcamPort").hidden = !modeSimplifie;
      document.getElementById("champTypePersonnalise").hidden = modeSimplifie;
      document.getElementById("champUrlPersonnalisee").hidden = modeSimplifie;
    };
    selectMode.addEventListener("change", basculerMode);
    basculerMode();
  }

  const formulaire = document.getElementById("btnAjouterCameraIp");
  if (formulaire) {
    formulaire.addEventListener("click", async () => {
      const nom = document.getElementById("camNom").value.trim();
      const modeSimplifie = document.getElementById("camMode").value === "ipwebcam";

      let url, type;
      if (modeSimplifie) {
        const adresseIp = document.getElementById("camAdresseIp").value.trim();
        const port = document.getElementById("camPort").value.trim() || "8080";
        if (!adresseIp) { alert("L'adresse IP du téléphone est obligatoire."); return; }
        url = `http://${adresseIp}:${port}/video`;
        type = "mjpeg";
      } else {
        url = document.getElementById("camUrl").value.trim();
        type = document.getElementById("camType").value;
      }

      if (!nom || !url) { alert("Le nom et l'adresse de la caméra sont obligatoires."); return; }

      const reponse = await fetch("/api/cameras-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          url,
          type,
          latitude: document.getElementById("camLatitude").value,
          longitude: document.getElementById("camLongitude").value
        })
      });
      const donnees = await reponse.json();
      if (!reponse.ok) { alert(donnees.erreur); return; }
      if (donnees.avertissement) alert("Caméra ajoutée, mais : " + donnees.avertissement);

      document.getElementById("camNom").value = "";
      document.getElementById("camAdresseIp").value = "";
      document.getElementById("camPort").value = "8080";
      document.getElementById("camUrl").value = "";
      document.getElementById("camLatitude").value = "";
      document.getElementById("camLongitude").value = "";
      chargerCamerasIp();
    });
  }

  await chargerCamerasIp();
  setInterval(chargerCamerasIp, 10000);
}

async function chargerCamerasIp() {
  try {
    const reponse = await fetch("/api/cameras-ip");
    const donnees = await reponse.json();
    rendreListeCamerasIp(donnees.cameras);
    donnees.cameras.forEach((c) => { if (document.getElementById("fluxcam-" + c.id)) rafraichirFluxCameraIp(c); });
  } catch (err) {
    console.error("Erreur de chargement des caméras IP :", err);
  }
}

function rendreListeCamerasIp(cameras) {
  const conteneur = document.getElementById("listeCamerasIp");
  if (!conteneur) return;

  if (cameras.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucune caméra IP configurée.</div>';
    return;
  }

  const estAdmin = utilisateurCourant && utilisateurCourant.role === "admin";

  conteneur.innerHTML = cameras.map((c) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div class="titre-item">${echapperHtml(c.nom)} <span class="etiquette-type-camera">${echapperHtml(c.type)}</span></div>
        <span class="etiquette ${c.actif ? 'etiquette-resolu' : 'etiquette-classe-sans-suite'}">${c.actif ? "active" : "désactivée"}</span>
      </div>
      <div class="actions">
        <button class="bouton-action" onclick="afficherFluxCameraIp(${c.id}, '${echapperHtml(c.nom).replace(/'/g, "\\'")}', '${c.type}', '${c.fluxUrl || ""}')">▶ Afficher le flux</button>
        ${estAdmin ? `<button class="bouton-action" onclick="basculerStatutCameraIp(${c.id}, ${c.actif ? 0 : 1})">${c.actif ? "Désactiver" : "Réactiver"}</button>` : ""}
        ${estAdmin ? `<button class="bouton-action" onclick="supprimerCameraIp(${c.id})">Supprimer</button>` : ""}
      </div>
    </div>
  `).join("");
}

async function basculerStatutCameraIp(id, actif) {
  await fetch(`/api/cameras-ip/${id}/statut`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actif })
  });
  chargerCamerasIp();
}

async function supprimerCameraIp(id) {
  if (!confirm("Supprimer cette caméra IP ?")) return;
  fermerFluxCameraIp(id);
  await fetch(`/api/cameras-ip/${id}`, { method: "DELETE" });
  chargerCamerasIp();
}

function afficherFluxCameraIp(id, nom, type, fluxUrlConnu) {
  if (document.getElementById("fluxcam-" + id)) return; // deja affiche

  const grille = document.getElementById("grilleFluxVideo");
  const carte = document.createElement("div");
  carte.className = "carte-video";
  carte.id = "fluxcam-" + id;
  carte.dataset.type = type;
  carte.innerHTML = `
    <div class="entete-carte-video">
      <span>📷 ${echapperHtml(nom)}</span>
      <span class="statut-connexion" id="statutcam-${id}">Connexion...</span>
      <button class="bouton-action" onclick="basculerDetectionMouvement('videocam-${id}', ${id}); this.textContent = this.textContent.includes('Activer') ? '🎯 Désactiver détection' : '🎯 Activer détection';">🎯 Activer détection</button>
      <button class="bouton-action" onclick="fermerFluxCameraIp(${id})">Fermer</button>
    </div>
    ${type === "mjpeg"
      ? `<img id="videocam-${id}" style="width:100%;min-height:200px;display:block;background:#000;object-fit:contain;"
             onerror="document.getElementById('statutcam-${id}').textContent = 'Erreur : impossible de charger ce flux (vérifiez l\\'adresse IP, le port, et que le téléphone/PC est sur le même réseau Wi-Fi)';"
             onload="document.getElementById('statutcam-${id}').textContent = 'En direct';">`
      : `<video id="videocam-${id}" autoplay playsinline muted style="width:100%;aspect-ratio:16/9;background:#000;"></video>`}
  `;
  grille.appendChild(carte);

  // On assigne l'URL tout de suite si on la connait deja, sans attendre le prochain
  // rafraichissement periodique (evite un ecran noir de quelques secondes).
  if (fluxUrlConnu && type === "mjpeg") {
    document.getElementById("videocam-" + id).src = fluxUrlConnu;
  }

  chargerCamerasIp();
}

async function rafraichirFluxCameraIp(camera) {
  const element = document.getElementById("videocam-" + camera.id);
  const statutEl = document.getElementById("statutcam-" + camera.id);
  if (!element) return;

  if (!camera.fluxUrl) {
    if (statutEl) statutEl.textContent = camera.type === "rtsp" ? "Indisponible (vérifiez ffmpeg / l'URL RTSP)" : "Indisponible";
    return;
  }

  if (camera.type === "mjpeg") {
    if (element.src !== camera.fluxUrl) element.src = camera.fluxUrl;
    if (statutEl) statutEl.textContent = "En direct";
    return;
  }

  // RTSP converti en HLS : on utilise hls.js
  if (!instancesHls[camera.id] && typeof Hls !== "undefined" && Hls.isSupported()) {
    const hls = new Hls();
    hls.loadSource(camera.fluxUrl);
    hls.attachMedia(element);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { if (statutEl) statutEl.textContent = "En direct"; });
    hls.on(Hls.Events.ERROR, (evt, data) => { if (data.fatal && statutEl) statutEl.textContent = "Erreur de flux."; });
    instancesHls[camera.id] = hls;
  } else if (element.canPlayType("application/vnd.apple.mpegurl")) {
    // Safari sait lire le HLS nativement, sans bibliotheque
    element.src = camera.fluxUrl;
    if (statutEl) statutEl.textContent = "En direct";
  }
}

function fermerFluxCameraIp(id) {
  if (instancesHls[id]) {
    instancesHls[id].destroy();
    delete instancesHls[id];
  }
  const carte = document.getElementById("fluxcam-" + id);
  if (carte) carte.remove();
}
