// public/js/appels.js
// Gere le declenchement d'une alerte (detection des agents a proximite),
// la selection des agents a appeler, et l'appel audio de groupe en mesh
// WebRTC (chaque participant se connecte directement a chaque autre).
// Reutilise la meme connexion WebSocket de signalisation que camera.js.

let salleAppelActuelle = null;
let flotAudioAppel = null;
let connexionsAppel = {}; // participantId -> RTCPeerConnection
let participantsConnus = {}; // participantId -> nom

// ---------- Declenchement d'une alerte ---------- //
function configurerAlertes() {
  document.getElementById("btnDeclencherAlerte").addEventListener("click", declencherAlerte);
  document.getElementById("btnAppelerSelection").addEventListener("click", appelerAgentsSelectionnes);
  document.getElementById("btnQuitterAppel").addEventListener("click", quitterAppelGroupe);
  document.getElementById("btnRepondreAppel").addEventListener("click", repondreAppelEntrant);
  document.getElementById("btnIgnorerAppel").addEventListener("click", () => {
    document.getElementById("bandeauAppelEntrant").hidden = true;
  });
}

function declencherAlerte() {
  if (!navigator.geolocation) { alert("La géolocalisation n'est pas prise en charge par ce navigateur."); return; }

  const statut = document.getElementById("statutAlerte");
  statut.textContent = "Localisation en cours...";

  navigator.geolocation.getCurrentPosition(async (position) => {
    const parametres = new URLSearchParams({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      rayonKm: document.getElementById("rayonAlerte").value || 5
    });
    const reponse = await fetch("/api/localisation/proches?" + parametres.toString());
    const donnees = await reponse.json();

    rendreAgentsProches(donnees.proches);
    document.getElementById("panneauAlerte").hidden = false;
    statut.textContent = donnees.proches.length + " agent(s) trouvé(s) à proximité.";
  }, () => {
    statut.textContent = "Impossible d'obtenir votre position.";
  });
}

function rendreAgentsProches(proches) {
  const conteneur = document.getElementById("listeAgentsProches");
  if (proches.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucun agent actif à proximité.</div>';
    return;
  }
  conteneur.innerHTML = proches.map((a) => `
    <label class="ligne-agent-proche">
      <input type="checkbox" class="case-agent-proche" value="${a.utilisateurId}">
      ${echapperHtml(a.nomComplet)} ${a.grade ? "(" + echapperHtml(a.grade) + ")" : ""} — ${a.distanceKm} km
    </label>
  `).join("");
}

// ---------- Appel audio groupe (mesh WebRTC) ---------- //
async function appelerAgentsSelectionnes() {
  const idsSelectionnes = Array.from(document.querySelectorAll(".case-agent-proche:checked")).map((c) => parseInt(c.value, 10));
  if (idsSelectionnes.length === 0) { alert("Sélectionnez au moins un agent à appeler."); return; }

  await assurerConnexionSignalisation();
  flotAudioAppel = await navigator.mediaDevices.getUserMedia({ audio: true });

  envoyerSignal({ type: "creer_salle_et_inviter", membres: idsSelectionnes });
  // La reponse "salle_creee" (geree dans traiterMessageAppel) declenchera la jointure effective.
}

function rejoindreSalleAppel(salleId) {
  salleAppelActuelle = salleId;
  envoyerSignal({ type: "rejoindre_salle", salleId });
  document.getElementById("panneauAppelActif").hidden = false;
  document.getElementById("panneauAlerte").hidden = true;
  document.getElementById("bandeauAppelEntrant").hidden = true;
  rendreParticipantsAppel();
}

async function repondreAppelEntrant() {
  const salleId = document.getElementById("bandeauAppelEntrant").dataset.salleId;
  await assurerConnexionSignalisation();
  flotAudioAppel = await navigator.mediaDevices.getUserMedia({ audio: true });
  rejoindreSalleAppel(salleId);
}

function quitterAppelGroupe() {
  if (salleAppelActuelle) envoyerSignal({ type: "quitter_salle", salleId: salleAppelActuelle });

  Object.values(connexionsAppel).forEach((connexion) => connexion.close());
  connexionsAppel = {};
  participantsConnus = {};

  if (flotAudioAppel) {
    flotAudioAppel.getTracks().forEach((piste) => piste.stop());
    flotAudioAppel = null;
  }

  document.getElementById("grilleAudioAppel").innerHTML = "";
  document.getElementById("panneauAppelActif").hidden = true;
  salleAppelActuelle = null;
}

function rendreParticipantsAppel() {
  const conteneur = document.getElementById("listeParticipantsAppel");
  const noms = Object.values(participantsConnus);
  conteneur.textContent = noms.length === 0 ? "Vous êtes seul(e) pour l'instant..." : "Participants : " + noms.join(", ");
}

// Cree une connexion audio vers un autre participant (celui qui arrive en dernier initie toujours)
async function connecterVersParticipant(participantId, participantNom) {
  participantsConnus[participantId] = participantNom;

  const connexion = new RTCPeerConnection(CONFIG_ICE);
  connexionsAppel[participantId] = connexion;

  if (flotAudioAppel) {
    flotAudioAppel.getTracks().forEach((piste) => connexion.addTrack(piste, flotAudioAppel));
  }

  connexion.ontrack = (evenement) => {
    ajouterAudioParticipant(participantId, participantNom, evenement.streams[0]);
  };

  connexion.onicecandidate = (evenement) => {
    if (evenement.candidate) {
      envoyerSignal({ type: "ice", cibleId: participantId, candidate: evenement.candidate, salleId: salleAppelActuelle });
    }
  };

  const offre = await connexion.createOffer();
  await connexion.setLocalDescription(offre);
  envoyerSignal({ type: "offre", cibleId: participantId, sdp: offre, salleId: salleAppelActuelle });

  rendreParticipantsAppel();
}

async function accepterOffreAppel(participantId, sdp) {
  let connexion = connexionsAppel[participantId];
  if (!connexion) {
    connexion = new RTCPeerConnection(CONFIG_ICE);
    connexionsAppel[participantId] = connexion;
    if (flotAudioAppel) {
      flotAudioAppel.getTracks().forEach((piste) => connexion.addTrack(piste, flotAudioAppel));
    }
    connexion.ontrack = (evenement) => {
      ajouterAudioParticipant(participantId, participantsConnus[participantId] || "Agent", evenement.streams[0]);
    };
    connexion.onicecandidate = (evenement) => {
      if (evenement.candidate) {
        envoyerSignal({ type: "ice", cibleId: participantId, candidate: evenement.candidate, salleId: salleAppelActuelle });
      }
    };
  }

  await connexion.setRemoteDescription(sdp);
  const reponse = await connexion.createAnswer();
  await connexion.setLocalDescription(reponse);
  envoyerSignal({ type: "reponse", cibleId: participantId, sdp: reponse, salleId: salleAppelActuelle });
}

function ajouterAudioParticipant(participantId, nom, flot) {
  let audioEl = document.getElementById("audio-appel-" + participantId);
  if (!audioEl) {
    audioEl = document.createElement("audio");
    audioEl.id = "audio-appel-" + participantId;
    audioEl.autoplay = true;
    document.getElementById("grilleAudioAppel").appendChild(audioEl);
  }
  audioEl.srcObject = flot;
}

function retirerParticipantAppel(participantId) {
  if (connexionsAppel[participantId]) {
    connexionsAppel[participantId].close();
    delete connexionsAppel[participantId];
  }
  delete participantsConnus[participantId];
  const audioEl = document.getElementById("audio-appel-" + participantId);
  if (audioEl) audioEl.remove();
  rendreParticipantsAppel();
}

// ---------- Reception des messages lies aux appels (appele depuis camera.js) ---------- //
function traiterMessageAppel(message) {
  switch (message.type) {
    case "salle_creee":
      rejoindreSalleAppel(message.salleId);
      break;

    case "invitation_appel": {
      const bandeau = document.getElementById("bandeauAppelEntrant");
      bandeau.dataset.salleId = message.salleId;
      document.getElementById("texteAppelEntrant").textContent = `${message.expediteurNom} déclenche une alerte et vous appelle.`;
      bandeau.hidden = false;
      break;
    }

    case "membres_salle":
      (message.membres || []).forEach((m) => connecterVersParticipant(m.id, m.nom));
      break;

    case "nouveau_participant":
      participantsConnus[message.participantId] = message.participantNom;
      rendreParticipantsAppel();
      break; // on attend son offre, pas d'action de connexion ici

    case "participant_parti":
      retirerParticipantAppel(message.participantId);
      break;

    case "offre":
      if (message.salleId) accepterOffreAppel(message.expediteurId, message.sdp);
      break;

    case "reponse":
      if (message.salleId && connexionsAppel[message.expediteurId]) {
        connexionsAppel[message.expediteurId].setRemoteDescription(message.sdp);
      }
      break;

    case "ice":
      if (message.salleId && connexionsAppel[message.expediteurId] && message.candidate) {
        connexionsAppel[message.expediteurId].addIceCandidate(message.candidate).catch(() => {});
      }
      break;
  }
}
