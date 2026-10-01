// signalisation.js
// Relais WebSocket pour etablir des connexions video/audio directes
// (WebRTC) entre le navigateur d'un agent qui diffuse sa camera et le(s)
// navigateur(s) des superviseurs qui la regardent. Ce serveur ne voit et ne
// stocke jamais la video/l'audio elle-meme : il se contente de transmettre
// de courts messages techniques (offres/reponses/candidats reseau) pour que
// les deux navigateurs puissent se connecter l'un a l'autre directement.
const WebSocket = require("ws");
const crypto = require("crypto");
const jetonsSignalisation = require("./db/jetonsSignalisation");
const diffuseursActifs = require("./db/diffuseursActifs");

// utilisateurId -> { socket, utilisateur }
const clientsConnectes = new Map();

// salleId -> Set(utilisateurId) : participants actuels d'un appel groupe
const salles = new Map();

function genererSalleId() {
  return crypto.randomBytes(8).toString("hex");
}

function demarrerSignalisation(serveurHttp) {
  const wss = new WebSocket.Server({ server: serveurHttp, path: "/ws/signalisation" });

  wss.on("connection", (socket) => {
    let utilisateurCourant = null;

    socket.on("message", (donneesBrutes) => {
      let message;
      try {
        message = JSON.parse(donneesBrutes.toString());
      } catch (err) {
        return; // message mal forme, on ignore silencieusement
      }

      // --- Premiere etape obligatoire : s'identifier avec un jeton valide ---
      if (!utilisateurCourant) {
        if (message.type !== "identification") return socket.close();
        const utilisateur = jetonsSignalisation.verifierEtConsommerJeton(message.jeton);
        if (!utilisateur) return socket.close();

        utilisateurCourant = utilisateur;
        clientsConnectes.set(utilisateur.id, { socket, utilisateur });
        return;
      }

      // --- Messages apres identification ---
      switch (message.type) {
        case "demarrer_diffusion":
          diffuseursActifs.ajouter(utilisateurCourant.id, {
            nomComplet: utilisateurCourant.nomComplet,
            grade: utilisateurCourant.grade,
            posteNom: utilisateurCourant.posteNom
          });
          break;

        case "arreter_diffusion":
          diffuseursActifs.retirer(utilisateurCourant.id);
          break;

        // --- Alerte : je cree une salle d'appel et j'invite des agents ---
        case "creer_salle_et_inviter": {
          const salleId = genererSalleId();
          salles.set(salleId, new Set([utilisateurCourant.id]));

          (message.membres || []).forEach((idInvite) => {
            const invite = clientsConnectes.get(idInvite);
            if (invite) {
              invite.socket.send(JSON.stringify({
                type: "invitation_appel",
                salleId,
                expediteurId: utilisateurCourant.id,
                expediteurNom: utilisateurCourant.nomComplet
              }));
            }
          });

          socket.send(JSON.stringify({ type: "salle_creee", salleId }));
          break;
        }

        // --- Un agent invite (ou l'initiateur) rejoint effectivement la salle ---
        case "rejoindre_salle": {
          const salleId = message.salleId;
          if (!salles.has(salleId)) salles.set(salleId, new Set());
          const membresActuels = Array.from(salles.get(salleId));

          // On informe le nouvel arrivant de qui est deja present (lui-meme
          // devra initier une connexion vers chacun d'eux)
          socket.send(JSON.stringify({
            type: "membres_salle",
            salleId,
            membres: membresActuels.map((id) => {
              const c = clientsConnectes.get(id);
              return { id, nom: c ? c.utilisateur.nomComplet : "Agent" };
            })
          }));

          // On informe les membres deja presents qu'un nouvel arrivant va se connecter
          membresActuels.forEach((idMembre) => {
            const membre = clientsConnectes.get(idMembre);
            if (membre) {
              membre.socket.send(JSON.stringify({
                type: "nouveau_participant",
                salleId,
                participantId: utilisateurCourant.id,
                participantNom: utilisateurCourant.nomComplet
              }));
            }
          });

          salles.get(salleId).add(utilisateurCourant.id);
          break;
        }

        // --- Un agent quitte une salle d'appel ---
        case "quitter_salle": {
          const salleId = message.salleId;
          if (salles.has(salleId)) {
            salles.get(salleId).delete(utilisateurCourant.id);
            salles.get(salleId).forEach((idMembre) => {
              const membre = clientsConnectes.get(idMembre);
              if (membre) {
                membre.socket.send(JSON.stringify({ type: "participant_parti", salleId, participantId: utilisateurCourant.id }));
              }
            });
            if (salles.get(salleId).size === 0) salles.delete(salleId);
          }
          break;
        }

        // Les types suivants sont de simples relais vers un autre utilisateur
        // identifie par cibleId : on ajoute qui est l'expediteur et on transmet tel quel.
        case "demande_visionnage":
        case "offre":
        case "reponse":
        case "ice": {
          const destinataire = clientsConnectes.get(message.cibleId);
          if (!destinataire) return;
          destinataire.socket.send(JSON.stringify({
            ...message,
            expediteurId: utilisateurCourant.id,
            expediteurNom: utilisateurCourant.nomComplet
          }));
          break;
        }
      }
    });

    socket.on("close", () => {
      if (utilisateurCourant) {
        clientsConnectes.delete(utilisateurCourant.id);
        diffuseursActifs.retirer(utilisateurCourant.id);

        // Retire l'utilisateur de toutes les salles d'appel ou il se trouvait
        salles.forEach((membres, salleId) => {
          if (membres.has(utilisateurCourant.id)) {
            membres.delete(utilisateurCourant.id);
            membres.forEach((idMembre) => {
              const membre = clientsConnectes.get(idMembre);
              if (membre) {
                membre.socket.send(JSON.stringify({ type: "participant_parti", salleId, participantId: utilisateurCourant.id }));
              }
            });
            if (membres.size === 0) salles.delete(salleId);
          }
        });
      }
    });
  });
}

module.exports = { demarrerSignalisation };
