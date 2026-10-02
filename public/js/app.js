// public/js/app.js
// Toute l'interaction avec le serveur passe par fetch() vers /api/...
// Aucune donnee n'est stockee en localStorage : tout vit dans la base de donnees du serveur.

const echapperHtml = (valeur) => {
  const div = document.createElement("div");
  div.textContent = valeur === undefined || valeur === null ? "" : String(valeur);
  return div.innerHTML;
};

const classeEtiquette = (statut) => "etiquette-" + statut.replace(/\s+/g, "-").toLowerCase();
const formaterDate = (isoString) => {
  try { return new Date(isoString).toLocaleString("fr-FR"); } catch (e) { return isoString; }
};

let utilisateurCourant = null;
let postesDisponibles = [];
let dernierIdActivite = 0;
let graphiques = {};
let partageActif = false;
let intervalPartagePosition = null;
let supervisionInitialisee = false;
let reconnaissanceInitialisee = false;

// Palette utilisee pour tous les graphiques (coherente avec le theme sombre)
const COULEURS = ["#3f7fb0", "#c9a227", "#4c9a63", "#b1463f", "#7fb4dd", "#e3c15c"];

// ---------- Initialisation ----------
async function initialiser() {
  try {
    const reponse = await fetch("/api/auth/moi");
    if (!reponse.ok) {
      window.location.href = "/login.html";
      return;
    }
    const donnees = await reponse.json();
    utilisateurCourant = donnees.utilisateur;

    document.getElementById("mep").hidden = false;
    document.getElementById("nomUtilisateurAffiche").textContent = utilisateurCourant.nomComplet;
    document.getElementById("roleAffiche").textContent =
      utilisateurCourant.role === "admin" ? "Administrateur" : (utilisateurCourant.grade || "Officier");

    configurerChangementMotDePasseObligatoire();
    if (utilisateurCourant.doitChangerMotDePasse) {
      document.getElementById("modaleMotDePasseObligatoire").hidden = false;
      return; // on attend le changement de mot de passe avant de charger le reste
    }

    if (utilisateurCourant.role === "admin") {
      document.getElementById("ongletUtilisateurs").hidden = false;
      document.getElementById("ongletPostes").hidden = false;
      document.getElementById("ongletCamerasIp").hidden = false;
    }

    configurerNavigation();
    configurerFormulaires();
    configurerNotifications();
    configurerAssistant();
    configurerCarte();
    configurerPartagePosition();
    configurerPartageCamera();
    configurerAlertes();
    configurerDescripteurFormulaireAvis();
    configurerModaleAffaire();

    await chargerPostes();
    await chargerOfficiers();
    configurerFiltresAffaires();
    await Promise.all([
      chargerStatistiques(),
      chargerAffaires(),
      chargerAvis(),
      chargerObjets(),
      chargerActivite(true),
      chargerAgentsActifs()
    ]);
    if (utilisateurCourant.role === "admin") {
      chargerUtilisateurs();
    }

    // Rafraichissement periodique du fil d'activite / notifications / agents actifs
    setInterval(() => { chargerActivite(false); chargerAgentsActifs(); }, 15000);
  } catch (err) {
    console.error(err);
    window.location.href = "/login.html";
  }
}

// ---------- Navigation ----------
function configurerNavigation() {
  document.querySelectorAll(".menu button[data-vue]").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      document.querySelectorAll(".menu button").forEach((b) => b.classList.remove("actif"));
      document.querySelectorAll(".section-vue").forEach((s) => s.classList.remove("actif"));
      bouton.classList.add("actif");
      document.getElementById(bouton.dataset.vue).classList.add("actif");
      if (bouton.dataset.vue === "vueCarte") {
        initialiserCarteSiNecessaire();
        chargerPointsCarte();
        setTimeout(() => { if (carteLeaflet) carteLeaflet.invalidateSize(); }, 100);
      }
      if (bouton.dataset.vue === "vueSupervision" && !supervisionInitialisee) {
        supervisionInitialisee = true;
        configurerSupervisionCamera();
        configurerCamerasIp();
      }
      if (bouton.dataset.vue === "vueReconnaissance" && !reconnaissanceInitialisee) {
        reconnaissanceInitialisee = true;
        configurerReconnaissanceFaciale();
      }
    });
  });

  document.getElementById("btnDeconnexion").addEventListener("click", async () => {
    await fetch("/api/auth/deconnexion", { method: "POST" });
    window.location.href = "/login.html";
  });
}

// ---------- Postes / Commissariats ----------
async function chargerPostes() {
  const reponse = await fetch("/api/postes");
  const donnees = await reponse.json();
  postesDisponibles = donnees.postes;

  const selectPoste = document.getElementById("uxPoste");
  if (selectPoste) {
    selectPoste.innerHTML = postesDisponibles.map((p) => `<option value="${p.id}">${echapperHtml(p.nom)}</option>`).join("");
  }
  const selectLotPoste = document.getElementById("uxLotPoste");
  if (selectLotPoste) {
    selectLotPoste.innerHTML = postesDisponibles.map((p) => `<option value="${p.id}">${echapperHtml(p.nom)}</option>`).join("");
  }

  if (utilisateurCourant.role === "admin") {
    rendrePostes(postesDisponibles);
  }
}

function rendrePostes(postes) {
  const conteneur = document.getElementById("listePostes");
  if (!conteneur) return;
  if (postes.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucun poste enregistré.</div>';
    return;
  }
  conteneur.innerHTML = postes.map((p) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div class="titre-item">${echapperHtml(p.nom)}</div>
        <span class="etiquette ${p.actif ? 'etiquette-resolu' : 'etiquette-classe-sans-suite'}">${p.actif ? "actif" : "désactivé"}</span>
      </div>
      <div class="detail">Ville : ${echapperHtml(p.ville || "Non précisée")}</div>
      <div class="actions">
        <button class="bouton-action" onclick="basculerStatutPoste(${p.id}, ${p.actif ? 0 : 1})">
          ${p.actif ? "Désactiver" : "Réactiver"}
        </button>
      </div>
    </div>
  `).join("");
}

async function basculerStatutPoste(id, actif) {
  await fetch(`/api/postes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actif })
  });
  chargerPostes();
}

// ---------- Tableau de bord + graphiques ----------
function detruireGraphique(cle) {
  if (graphiques[cle]) { graphiques[cle].destroy(); delete graphiques[cle]; }
}

function creerGraphiqueDoughnut(idCanvas, cle, labels, valeurs) {
  detruireGraphique(cle);
  const ctx = document.getElementById(idCanvas);
  if (!ctx || typeof Chart === "undefined") return;
  graphiques[cle] = new Chart(ctx, {
    type: "doughnut",
    data: { labels, datasets: [{ data: valeurs, backgroundColor: COULEURS, borderWidth: 0 }] },
    options: { plugins: { legend: { position: "bottom", labels: { color: "#90a0b5", font: { size: 11 } } } } }
  });
}

function creerGraphiqueLigne(idCanvas, cle, labels, valeurs) {
  detruireGraphique(cle);
  const ctx = document.getElementById(idCanvas);
  if (!ctx || typeof Chart === "undefined") return;
  graphiques[cle] = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Affaires ouvertes",
        data: valeurs,
        borderColor: "#7fb4dd",
        backgroundColor: "rgba(127,180,221,0.15)",
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#90a0b5" }, grid: { color: "#1c2a3a" } },
        y: { ticks: { color: "#90a0b5", precision: 0 }, grid: { color: "#1c2a3a" }, beginAtZero: true }
      }
    }
  });
}

function creerGraphiqueBarres(idCanvas, cle, labels, valeurs) {
  detruireGraphique(cle);
  const ctx = document.getElementById(idCanvas);
  if (!ctx || typeof Chart === "undefined") return;
  graphiques[cle] = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [{ data: valeurs, backgroundColor: COULEURS }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#90a0b5" }, grid: { display: false } },
        y: { ticks: { color: "#90a0b5", precision: 0 }, grid: { color: "#1c2a3a" }, beginAtZero: true }
      }
    }
  });
}

async function chargerStatistiques() {
  const reponse = await fetch("/api/statistiques");
  const donnees = await reponse.json();
  const grille = document.getElementById("grilleStats");

  const parStatut = {};
  donnees.affairesParStatut.forEach((ligne) => { parStatut[ligne.statut] = ligne.total; });

  grille.innerHTML = `
    <div class="carte-stat"><div class="valeur">${donnees.totalAffaires}</div><div class="etiquette">Affaires au total</div></div>
    <div class="carte-stat"><div class="valeur">${parStatut["en cours"] || 0}</div><div class="etiquette">Affaires en cours</div></div>
    <div class="carte-stat"><div class="valeur">${parStatut["resolu"] || 0}</div><div class="etiquette">Affaires résolues</div></div>
    <div class="carte-stat"><div class="valeur">${donnees.totalAvisActifs}</div><div class="etiquette">Avis de recherche actifs</div></div>
    <div class="carte-stat"><div class="valeur">${donnees.totalObjetsRecherches}</div><div class="etiquette">Objets recherchés</div></div>
    <div class="carte-stat"><div class="valeur">${donnees.totalPostes}</div><div class="etiquette">Postes actifs</div></div>
  `;

  creerGraphiqueLigne(
    "graphiqueEvolution", "evolution",
    donnees.evolutionMensuelle.map((m) => m.mois),
    donnees.evolutionMensuelle.map((m) => m.total)
  );
  creerGraphiqueDoughnut(
    "graphiqueStatutAffaires", "statutAffaires",
    donnees.affairesParStatut.map((s) => s.statut),
    donnees.affairesParStatut.map((s) => s.total)
  );
  creerGraphiqueBarres(
    "graphiquePostes", "postes",
    donnees.affairesParPoste.map((p) => p.poste),
    donnees.affairesParPoste.map((p) => p.total)
  );
  creerGraphiqueDoughnut(
    "graphiqueAvis", "avis",
    donnees.avisParStatut.map((s) => s.statut),
    donnees.avisParStatut.map((s) => s.total)
  );
}

// ---------- Notifications / fil d'activite ----------
function configurerNotifications() {
  const bouton = document.getElementById("btnNotifications");
  const panneau = document.getElementById("panneauNotifications");
  bouton.addEventListener("click", () => {
    panneau.hidden = !panneau.hidden;
    document.getElementById("pastilleNotif").hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!bouton.contains(e.target) && !panneau.contains(e.target)) panneau.hidden = true;
  });
}

async function chargerActivite(premierChargement) {
  try {
    const reponse = await fetch("/api/activite?depuisId=0");
    const donnees = await reponse.json();

    const panneau = document.getElementById("panneauNotifications");
    panneau.innerHTML = donnees.evenements.length === 0
      ? '<div class="item-notification">Aucune activité récente.</div>'
      : donnees.evenements.map((e) => `
          <div class="item-notification">
            ${echapperHtml(e.message)}
            <div class="date-notif">${formaterDate(e.date)}</div>
          </div>
        `).join("");

    const flot = document.getElementById("flotActivite");
    if (flot) {
      flot.innerHTML = donnees.evenements.length === 0
        ? '<div class="etat-vide">Aucune activité récente.</div>'
        : donnees.evenements.slice(0, 15).map((e) => `
            <div class="ligne-flux">
              ${echapperHtml(e.message)}
              <div class="date-flux">${formaterDate(e.date)}</div>
            </div>
          `).join("");
    }

    if (!premierChargement && donnees.dernierId > dernierIdActivite) {
      const pastille = document.getElementById("pastilleNotif");
      pastille.textContent = String(donnees.dernierId - dernierIdActivite);
      pastille.hidden = false;
    }
    dernierIdActivite = donnees.dernierId;
  } catch (err) {
    console.error("Erreur de chargement de l'activité :", err);
  }
}

// ---------- Assistant IA ----------
function configurerAssistant() {
  document.getElementById("btnPoserQuestion").addEventListener("click", async () => {
    const question = document.getElementById("assistantQuestion").value.trim();
    if (!question) return;

    const zoneReponse = document.getElementById("reponseAssistant");
    zoneReponse.hidden = false;
    zoneReponse.textContent = "Réflexion en cours...";

    try {
      const reponse = await fetch("/api/assistant/demander", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question })
      });
      const donnees = await reponse.json();
      if (!reponse.ok) {
        zoneReponse.textContent = donnees.erreur || "Erreur de l'assistant.";
        return;
      }

      zoneReponse.textContent = donnees.reponse;

      if (donnees.confirmationRequise) {
        const boutonConfirmer = document.createElement("button");
        boutonConfirmer.className = "bouton-action bouton-valider";
        boutonConfirmer.style.marginTop = "10px";
        boutonConfirmer.textContent = "⚠️ Confirmer cette action";
        boutonConfirmer.onclick = async () => {
          const reponseConfirmation = await fetch("/api/assistant/confirmer-action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outil: donnees.outil, parametres: donnees.parametres })
          });
          const donneesConfirmation = await reponseConfirmation.json();
          zoneReponse.textContent = donneesConfirmation.reponse || donneesConfirmation.erreur;
          boutonConfirmer.remove();
          chargerAffaires();
          chargerStatistiques();
        };
        zoneReponse.appendChild(document.createElement("br"));
        zoneReponse.appendChild(boutonConfirmer);
      }
    } catch (err) {
      zoneReponse.textContent = "Impossible de contacter l'assistant.";
    }
  });

  fetch("/api/assistant/statut")
    .then((r) => r.json())
    .then((donnees) => {
      document.getElementById("avertissementAssistant").hidden = donnees.disponible;
      document.getElementById("btnPoserQuestion").disabled = !donnees.disponible;
    })
    .catch(() => {});
}

// ---------- Partage de position en temps reel ---------- //
function configurerPartagePosition() {
  const toggle = document.getElementById("togglePartagePosition");
  toggle.addEventListener("change", () => {
    if (toggle.checked) demarrerPartagePosition();
    else arreterPartagePosition();
  });

  // Si l'utilisateur ferme/quitte la page pendant qu'il partage, on essaie
  // de le retirer proprement du serveur (best-effort, pas garanti a 100%).
  window.addEventListener("beforeunload", () => {
    if (partageActif) {
      fetch("/api/localisation", { method: "DELETE", keepalive: true });
    }
  });
}

function demarrerPartagePosition() {
  if (!navigator.geolocation) {
    alert("La géolocalisation n'est pas prise en charge par ce navigateur.");
    document.getElementById("togglePartagePosition").checked = false;
    return;
  }

  partageActif = true;
  const statut = document.getElementById("statutPartage");
  statut.textContent = "Localisation en cours...";
  statut.classList.remove("actif");

  const envoyer = () => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        await fetch("/api/localisation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          })
        });
        statut.textContent = "Position partagée (mise à jour " + new Date().toLocaleTimeString("fr-FR") + ")";
        statut.classList.add("actif");
        chargerAgentsActifs();
        if (carteLeaflet) chargerPointsCarte();
      },
      (erreur) => {
        statut.textContent = "Erreur de localisation : autorisation refusée ou indisponible.";
        statut.classList.remove("actif");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  envoyer();
  intervalPartagePosition = setInterval(envoyer, 20000);
}

function arreterPartagePosition() {
  partageActif = false;
  if (intervalPartagePosition) clearInterval(intervalPartagePosition);
  intervalPartagePosition = null;

  fetch("/api/localisation", { method: "DELETE" });

  const statut = document.getElementById("statutPartage");
  statut.textContent = "Position non partagée";
  statut.classList.remove("actif");

  chargerAgentsActifs();
  if (carteLeaflet) chargerPointsCarte();
}

async function chargerAgentsActifs() {
  try {
    const reponse = await fetch("/api/localisation/actifs");
    const donnees = await reponse.json();

    const grille = document.getElementById("grilleStatsAgents");
    if (grille) {
      grille.innerHTML = `
        <div class="carte-stat">
          <div class="valeur">${donnees.actifs.length}</div>
          <div class="etiquette">Agent(s) actif(s) en direct</div>
        </div>
      `;
    }
    return donnees.actifs;
  } catch (err) {
    console.error("Erreur de chargement des agents actifs :", err);
    return [];
  }
}

// ---------- Geolocalisation de l'appareil ---------- //
function localiserAppareil(idLatitude, idLongitude, idBouton) {
  const bouton = document.getElementById(idBouton);
  const texteOriginal = bouton.textContent;

  if (!navigator.geolocation) {
    alert("La géolocalisation n'est pas prise en charge par ce navigateur.");
    return;
  }

  bouton.disabled = true;
  bouton.textContent = "Localisation en cours...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById(idLatitude).value = position.coords.latitude.toFixed(6);
      document.getElementById(idLongitude).value = position.coords.longitude.toFixed(6);
      bouton.disabled = false;
      bouton.textContent = texteOriginal;
    },
    (erreur) => {
      let message = "Impossible d'obtenir votre position.";
      if (erreur.code === erreur.PERMISSION_DENIED) {
        message = "Autorisation refusée. Activez la localisation pour ce site dans les paramètres du navigateur.";
      } else if (erreur.code === erreur.TIMEOUT) {
        message = "La demande de localisation a expiré. Réessayez.";
      } else if (location.protocol !== "https:" && location.hostname !== "localhost") {
        message = "La géolocalisation nécessite une connexion sécurisée (HTTPS) en dehors de localhost.";
      }
      alert(message);
      bouton.disabled = false;
      bouton.textContent = texteOriginal;
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// ---------- Carte interactive ---------- //
let carteLeaflet = null;
let couchesMarqueurs = { poste: null, affaire: null, avis: null, objet: null, agent: null, camera_ip: null };
let carteInitialisee = false;
let coucheChaleur = null;
let coucheZonesDessinees = null;
let modeCarteActif = null; // null | "recherche" | "itineraire"
let pointsItineraire = [];
let coucheItineraire = null;
let coucheRecherche = null;

const COULEUR_PAR_TYPE_STATUT = {
  poste: "#3f7fb0",
  "affaire-en cours": "#c9a227",
  "affaire-resolu": "#4c9a63",
  "affaire-classe sans suite": "#b1463f",
  "avis-actif": "#b1463f",
  "avis-localise": "#4c9a63",
  "avis-annule": "#5f7188",
  "objet-recherche": "#7fb4dd",
  "objet-retrouve": "#4c9a63",
  "camera_ip-actif": "#e3c15c",
  "camera_ip-desactive": "#5f7188"
};

function couleurPoint(point) {
  return COULEUR_PAR_TYPE_STATUT[point.type + "-" + point.statut] || COULEUR_PAR_TYPE_STATUT[point.type] || "#7fb4dd";
}

function creerIconePoint(couleur) {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${couleur};border:2px solid #0b1017;box-shadow:0 0 8px ${couleur};"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function creerIconeAgent() {
  return L.divIcon({
    className: "",
    html: `<div class="pastille-agent" style="width:14px;height:14px;border-radius:50%;background:#4ade80;border:2px solid #0b1017;box-shadow:0 0 8px #4ade80;"></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function configurerCarte() {
  const cases = {
    poste: document.getElementById("filtrePostes"),
    affaire: document.getElementById("filtreAffaires"),
    avis: document.getElementById("filtreAvis"),
    objet: document.getElementById("filtreObjets"),
    agent: document.getElementById("filtreAgents"),
    camera_ip: document.getElementById("filtreCamerasIpCarte")
  };
  Object.entries(cases).forEach(([type, element]) => {
    element.addEventListener("change", () => {
      if (!carteLeaflet || !couchesMarqueurs[type]) return;
      if (element.checked) carteLeaflet.addLayer(couchesMarqueurs[type]);
      else carteLeaflet.removeLayer(couchesMarqueurs[type]);
    });
  });

  document.getElementById("btnCentrerPosition").addEventListener("click", () => {
    if (!navigator.geolocation) { alert("La géolocalisation n'est pas prise en charge par ce navigateur."); return; }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        initialiserCarteSiNecessaire();
        carteLeaflet.setView([position.coords.latitude, position.coords.longitude], 14);
      },
      () => alert("Impossible d'obtenir votre position.")
    );
  });

  document.getElementById("filtreChaleur").addEventListener("change", (e) => {
    initialiserCarteSiNecessaire();
    if (e.target.checked) activerCarteDeChaleur(); else desactiverCarteDeChaleur();
  });

  document.getElementById("btnActiverRecherche").addEventListener("click", () => {
    initialiserCarteSiNecessaire();
    modeCarteActif = "recherche";
    document.getElementById("statutOutilSig").textContent = "Cliquez sur la carte pour choisir le centre de la recherche...";
  });

  document.getElementById("btnActiverItineraire").addEventListener("click", () => {
    initialiserCarteSiNecessaire();
    modeCarteActif = "itineraire";
    pointsItineraire = [];
    document.getElementById("statutOutilSig").textContent = "Cliquez le point de départ, puis le point d'arrivée...";
  });

  document.getElementById("btnExporterGeojson").addEventListener("click", () => {
    window.location.href = "/api/carte/export?format=geojson";
  });
  document.getElementById("btnExporterKml").addEventListener("click", () => {
    window.location.href = "/api/carte/export?format=kml";
  });

  document.getElementById("inputImporterGeojson").addEventListener("change", async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    try {
      const texte = await fichier.text();
      const geojson = JSON.parse(texte);
      const reponse = await fetch("/api/carte/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geojson)
      });
      const donnees = await reponse.json();
      if (!reponse.ok) { alert(donnees.erreur); return; }
      alert(donnees.zonesCreees + " zone(s) importée(s) avec succès.");
      chargerZones();
    } catch (err) {
      alert("Fichier GeoJSON invalide.");
    }
    e.target.value = "";
  });

  document.getElementById("btnLocaliserNumero").addEventListener("click", async () => {
    const numero = document.getElementById("numeroTelecom").value.trim();
    if (!numero) { alert("Entrez un numéro de téléphone."); return; }

    const reponse = await fetch("/api/telecom/localiser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero })
    });
    const donnees = await reponse.json();

    if (!reponse.ok) {
      document.getElementById("statutOutilSig").textContent = donnees.erreur;
      return;
    }

    initialiserCarteSiNecessaire();
    const { latitude, longitude } = donnees.resultat;
    L.marker([latitude, longitude], { icon: creerIconePoint("#e05206") })
      .addTo(carteLeaflet)
      .bindPopup("Numéro localisé : " + numero)
      .openPopup();
    carteLeaflet.setView([latitude, longitude], 15);
    document.getElementById("statutOutilSig").textContent = "Numéro localisé avec succès.";
  });
}

function initialiserCarteSiNecessaire() {
  if (carteInitialisee || typeof L === "undefined") return;
  carteInitialisee = true;

  // Centre par defaut : Niamey, Niger
  carteLeaflet = L.map("carteInteractive").setView([13.5137, 2.1098], 6);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© contributeurs OpenStreetMap",
    maxZoom: 19
  }).addTo(carteLeaflet);

  // --- Outils de dessin de zones/secteurs (polygone, rectangle, cercle) ---
  coucheZonesDessinees = new L.FeatureGroup();
  carteLeaflet.addLayer(coucheZonesDessinees);

  if (typeof L.Control.Draw !== "undefined") {
    const controleDessin = new L.Control.Draw({
      draw: {
        polygon: true,
        rectangle: true,
        circle: true,
        marker: false,
        polyline: false,
        circlemarker: false
      },
      edit: { featureGroup: coucheZonesDessinees, remove: false }
    });
    carteLeaflet.addControl(controleDessin);

    carteLeaflet.on(L.Draw.Event.CREATED, async (evenement) => {
      const nom = prompt("Nom de cette zone/secteur :");
      if (!nom) return;

      const couche = evenement.layer;
      let corps = { nom, couleur: "#3f7fb0" };

      if (evenement.layerType === "circle") {
        const centre = couche.getLatLng();
        corps.type = "cercle";
        corps.centre = { lat: centre.lat, lng: centre.lng };
        corps.rayonMetres = couche.getRadius();
      } else {
        corps.type = "polygone";
        corps.points = couche.getLatLngs()[0].map((p) => ({ lat: p.lat, lng: p.lng }));
      }

      const reponse = await fetch("/api/zones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corps)
      });
      if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
      chargerZones();
    });
  }

  // --- Clics sur la carte : utilises par les modes recherche/itineraire ---
  carteLeaflet.on("click", (evenement) => traiterClicCarte(evenement.latlng));

  chargerZones();

  // Rafraichissement periodique (utile pour voir les agents actifs bouger)
  setInterval(() => { if (carteLeaflet) chargerPointsCarte(); }, 20000);
}

const LIBELLES_TYPE = { poste: "Poste de police", affaire: "Affaire", avis: "Avis de recherche", objet: "Objet volé", agent: "Agent actif", camera_ip: "Caméra IP" };

async function chargerPointsCarte() {
  if (!carteLeaflet) return;
  try {
    const [reponseCarte, agentsActifs] = await Promise.all([
      fetch("/api/carte").then((r) => r.json()),
      chargerAgentsActifs()
    ]);

    // Retire les anciennes couches de la carte avant de les remplacer
    Object.values(couchesMarqueurs).forEach((couche) => { if (couche) carteLeaflet.removeLayer(couche); });

    couchesMarqueurs = { poste: L.layerGroup(), affaire: L.layerGroup(), avis: L.layerGroup(), objet: L.layerGroup(), agent: L.layerGroup(), camera_ip: L.layerGroup() };

    reponseCarte.points.forEach((point) => {
      const marqueur = L.marker([point.latitude, point.longitude], { icon: creerIconePoint(couleurPoint(point)) });
      marqueur.bindPopup(
        `<b>${echapperHtml(LIBELLES_TYPE[point.type] || point.type)}</b><br>` +
        `${echapperHtml(point.titre)}<br>` +
        `${echapperHtml(point.detail || "")}<br>` +
        `<span style="text-transform:capitalize">${echapperHtml(point.statut)}</span>`
      );
      if (couchesMarqueurs[point.type]) marqueur.addTo(couchesMarqueurs[point.type]);
    });

    (agentsActifs || []).forEach((agent) => {
      const marqueur = L.marker([agent.latitude, agent.longitude], { icon: creerIconeAgent() });
      const heure = new Date(agent.dateMaj).toLocaleTimeString("fr-FR");
      marqueur.bindPopup(
        `<b>${echapperHtml(LIBELLES_TYPE.agent)}</b><br>` +
        `${echapperHtml(agent.nomComplet)}${agent.grade ? " — " + echapperHtml(agent.grade) : ""}<br>` +
        `${agent.posteNom ? echapperHtml(agent.posteNom) + "<br>" : ""}` +
        `Mis à jour à ${heure}`
      );
      marqueur.addTo(couchesMarqueurs.agent);
    });

    Object.entries(couchesMarqueurs).forEach(([type, couche]) => {
      const idFiltre = { poste: "filtrePostes", affaire: "filtreAffaires", avis: "filtreAvis", objet: "filtreObjets", agent: "filtreAgents", camera_ip: "filtreCamerasIpCarte" }[type];
      const caseFiltre = document.getElementById(idFiltre);
      if (caseFiltre && caseFiltre.checked) couche.addTo(carteLeaflet);
    });

    if (document.getElementById("filtreChaleur").checked) activerCarteDeChaleur();
  } catch (err) {
    console.error("Erreur de chargement de la carte :", err);
  }
}

// ---------- Carte de chaleur ---------- //
async function activerCarteDeChaleur() {
  if (typeof L.heatLayer === "undefined") return;
  const reponse = await fetch("/api/carte");
  const donnees = await reponse.json();

  const pointsChaleur = donnees.points
    .filter((p) => ["affaire", "avis", "objet"].includes(p.type))
    .map((p) => [p.latitude, p.longitude, 0.6]);

  if (coucheChaleur) carteLeaflet.removeLayer(coucheChaleur);
  coucheChaleur = L.heatLayer(pointsChaleur, { radius: 30, blur: 20, maxZoom: 14 });
  coucheChaleur.addTo(carteLeaflet);
}

function desactiverCarteDeChaleur() {
  if (coucheChaleur) { carteLeaflet.removeLayer(coucheChaleur); coucheChaleur = null; }
}

// ---------- Zones / secteurs ---------- //
async function chargerZones() {
  if (!carteLeaflet) return;
  const [reponseZones, reponseStats] = await Promise.all([
    fetch("/api/zones").then((r) => r.json()),
    fetch("/api/zones/statistiques").then((r) => r.json())
  ]);

  coucheZonesDessinees.clearLayers();
  const statsParId = {};
  reponseStats.statistiques.forEach((s) => { statsParId[s.zoneId] = s; });

  reponseZones.zones.forEach((zone) => {
    let forme;
    if (zone.type === "cercle") {
      forme = L.circle([zone.centre.lat, zone.centre.lng], { radius: zone.rayonMetres, color: zone.couleur, weight: 2, fillOpacity: 0.1 });
    } else {
      forme = L.polygon(zone.points.map((p) => [p.lat, p.lng]), { color: zone.couleur, weight: 2, fillOpacity: 0.1 });
    }
    const stats = statsParId[zone.id];
    forme.bindPopup(`<b>${echapperHtml(zone.nom)}</b><br>${stats ? stats.total + " élément(s) à l'intérieur" : ""}`);
    forme.addTo(coucheZonesDessinees);
  });

  rendreListeZones(reponseZones.zones, statsParId);
}

function rendreListeZones(zones, statsParId) {
  const conteneur = document.getElementById("listeZones");
  if (zones.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucune zone dessinée pour le moment.</div>';
    return;
  }
  conteneur.innerHTML = zones.map((z) => {
    const s = statsParId[z.id] || { totalAffaires: 0, totalAvis: 0, totalObjets: 0 };
    return `
      <div class="carte-item">
        <div class="ligne-entete">
          <div class="titre-item">${echapperHtml(z.nom)}</div>
          <button class="bouton-action" onclick="supprimerZone(${z.id})">Supprimer</button>
        </div>
        <div class="detail">${s.totalAffaires} affaire(s) · ${s.totalAvis} avis · ${s.totalObjets} objet(s) volé(s) dans cette zone</div>
      </div>
    `;
  }).join("");
}

async function supprimerZone(id) {
  if (!confirm("Supprimer cette zone ?")) return;
  const reponse = await fetch(`/api/zones/${id}`, { method: "DELETE" });
  if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
  chargerZones();
}

// ---------- Clics sur la carte (recherche spatiale / itineraire) ---------- //
async function traiterClicCarte(latlng) {
  if (modeCarteActif === "recherche") {
    modeCarteActif = null;
    const rayonKm = parseFloat(prompt("Rayon de recherche (en km) :", "5")) || 5;

    if (coucheRecherche) carteLeaflet.removeLayer(coucheRecherche);
    coucheRecherche = L.layerGroup().addTo(carteLeaflet);
    L.circle(latlng, { radius: rayonKm * 1000, color: "#c9a227", fillOpacity: 0.05 }).addTo(coucheRecherche);

    const reponse = await fetch(`/api/carte/recherche?latitude=${latlng.lat}&longitude=${latlng.lng}&rayonKm=${rayonKm}`);
    const donnees = await reponse.json();

    document.getElementById("statutOutilSig").textContent = donnees.points.length + " élément(s) trouvé(s) dans un rayon de " + rayonKm + " km.";
    document.getElementById("resultatsRechercheSpatiale").innerHTML = donnees.points.map((p) => `
      <div class="carte-item">
        <div class="ligne-entete">
          <div class="titre-item">${echapperHtml(p.titre)}</div>
          <span class="etiquette ${classeEtiquette(p.statut)}">${echapperHtml(p.statut)}</span>
        </div>
        <div class="detail">${echapperHtml(LIBELLES_TYPE[p.type] || p.type)} — ${p.distanceKm} km — ${echapperHtml(p.detail || "")}</div>
      </div>
    `).join("") || '<div class="etat-vide">Aucun résultat.</div>';
    return;
  }

  if (modeCarteActif === "itineraire") {
    pointsItineraire.push(latlng);
    if (pointsItineraire.length === 1) {
      document.getElementById("statutOutilSig").textContent = "Point de départ choisi. Cliquez le point d'arrivée...";
      return;
    }
    modeCarteActif = null;
    await calculerEtAfficherItineraire(pointsItineraire[0], pointsItineraire[1]);
    pointsItineraire = [];
  }
}

async function calculerEtAfficherItineraire(depart, arrivee) {
  document.getElementById("statutOutilSig").textContent = "Calcul de l'itinéraire...";
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${depart.lng},${depart.lat};${arrivee.lng},${arrivee.lat}?overview=full&geometries=geojson`;
    const reponse = await fetch(url);
    const donnees = await reponse.json();
    if (!donnees.routes || donnees.routes.length === 0) {
      document.getElementById("statutOutilSig").textContent = "Aucun itinéraire trouvé.";
      return;
    }

    const route = donnees.routes[0];
    const coordonnees = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    if (coucheItineraire) carteLeaflet.removeLayer(coucheItineraire);
    coucheItineraire = L.polyline(coordonnees, { color: "#7fb4dd", weight: 5 }).addTo(carteLeaflet);
    carteLeaflet.fitBounds(coucheItineraire.getBounds());

    const distanceKm = Math.round(route.distance / 100) / 10;
    const dureeMin = Math.round(route.duration / 60);
    document.getElementById("statutOutilSig").textContent = `Itinéraire : ${distanceKm} km, environ ${dureeMin} min (estimation en voiture).`;
  } catch (err) {
    document.getElementById("statutOutilSig").textContent = "Impossible de calculer l'itinéraire (service de routage indisponible).";
  }
}

// ---------- Affaires ----------
let affairesActuelles = [];
let officiersDisponibles = [];

function rendreAffaires(affaires) {
  affairesActuelles = affaires;
  const conteneur = document.getElementById("listeAffaires");
  if (affaires.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucune affaire à afficher.</div>';
    return;
  }
  conteneur.innerHTML = affaires.map((a) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div>
          <div class="titre-item">
            <a href="#" onclick="ouvrirDetailAffaire(${a.id}); return false;" style="color:inherit;text-decoration:underline;text-decoration-color:var(--bordure);">${echapperHtml(a.titre)}</a>
            <span class="etiquette-categorie">${echapperHtml(a.categorie || "autre")}</span>
          </div>
          <div class="numero-dossier">${echapperHtml(a.numero_dossier)} ${a.poste_nom ? "— " + echapperHtml(a.poste_nom) : ""}</div>
        </div>
        <span class="etiquette ${classeEtiquette(a.statut)}">${echapperHtml(a.statut)}</span>
      </div>
      <div class="detail">${echapperHtml(a.description || "Pas de description.")}</div>
      <div class="detail">Ouverte le ${echapperHtml(a.date_ouverture)} — Officier : ${echapperHtml(a.officier_nom || "Non assigné")}</div>
      <div class="actions">
        <button class="bouton-action" onclick="ouvrirDetailAffaire(${a.id})">Détails / Notes</button>
        ${a.statut !== "resolu" ? `<button class="bouton-action" onclick="changerStatutAffaire(${a.id}, 'resolu')">Marquer résolue</button>` : ""}
        ${a.statut !== "en cours" ? `<button class="bouton-action" onclick="changerStatutAffaire(${a.id}, 'en cours')">Rouvrir</button>` : ""}
        ${a.statut !== "classe sans suite" ? `<button class="bouton-action" onclick="changerStatutAffaire(${a.id}, 'classe sans suite')">Classer sans suite</button>` : ""}
        <button class="bouton-action" onclick="exporterAffairePdf(${a.id})">Exporter PDF</button>
        <button class="bouton-action" onclick="supprimerAffaire(${a.id})">Supprimer</button>
      </div>
    </div>
  `).join("");
}

function construireParametresFiltres() {
  const parametres = new URLSearchParams();
  const statut = document.getElementById("filtreStatut").value;
  const categorie = document.getElementById("filtreCategorie").value;
  const posteId = document.getElementById("filtrePosteAffaires").value;
  const officierId = document.getElementById("filtreOfficier").value;
  const dateDebut = document.getElementById("filtreDateDebut").value;
  const dateFin = document.getElementById("filtreDateFin").value;
  const mesAffaires = document.getElementById("filtreMesAffaires").checked;

  if (statut) parametres.set("statut", statut);
  if (categorie) parametres.set("categorie", categorie);
  if (posteId) parametres.set("posteId", posteId);
  if (officierId) parametres.set("officierId", officierId);
  if (dateDebut) parametres.set("dateDebut", dateDebut);
  if (dateFin) parametres.set("dateFin", dateFin);
  if (mesAffaires) parametres.set("mesAffaires", "1");

  return parametres;
}

async function chargerAffaires() {
  const parametres = construireParametresFiltres();
  const reponse = await fetch("/api/affaires?" + parametres.toString());
  const donnees = await reponse.json();
  rendreAffaires(donnees.affaires);
  remplirSelectAffairesLiees(donnees.affaires);
}

function remplirSelectAffairesLiees(affaires) {
  const options = '<option value="">Aucune</option>' +
    affaires.map((a) => `<option value="${a.id}">${echapperHtml(a.numero_dossier)} — ${echapperHtml(a.titre)}</option>`).join("");
  const selectAvis = document.getElementById("avisAffaireId");
  const selectObjet = document.getElementById("objAffaireId");
  if (selectAvis) selectAvis.innerHTML = options;
  if (selectObjet) selectObjet.innerHTML = options;
}

async function chargerOfficiers() {
  const reponse = await fetch("/api/auth/officiers");
  const donnees = await reponse.json();
  officiersDisponibles = donnees.officiers;

  const selectFiltre = document.getElementById("filtreOfficier");
  if (selectFiltre) {
    selectFiltre.innerHTML = '<option value="">Tous</option>' +
      officiersDisponibles.map((o) => `<option value="${o.id}">${echapperHtml(o.nomComplet)}</option>`).join("");
  }
}

function configurerFiltresAffaires() {
  document.getElementById("btnToggleFiltres").addEventListener("click", () => {
    const panneau = document.getElementById("panneauFiltresAvances");
    panneau.hidden = !panneau.hidden;
  });
  document.getElementById("btnAppliquerFiltres").addEventListener("click", chargerAffaires);

  const selectPoste = document.getElementById("filtrePosteAffaires");
  if (selectPoste) {
    selectPoste.innerHTML = '<option value="">Tous</option>' +
      postesDisponibles.map((p) => `<option value="${p.id}">${echapperHtml(p.nom)}</option>`).join("");
  }
}

// ---------- Modale de detail d'affaire (infos, notes, elements lies) ---------- //
let affaireOuverteId = null;

function configurerChangementMotDePasseObligatoire() {
  document.getElementById("btnValiderMdpObligatoire").addEventListener("click", async () => {
    const ancien = document.getElementById("mdpObligatoireAncien").value;
    const nouveau = document.getElementById("mdpObligatoireNouveau").value;
    const confirmation = document.getElementById("mdpObligatoireConfirmation").value;
    const erreurEl = document.getElementById("erreurMdpObligatoire");
    erreurEl.hidden = true;

    if (nouveau.length < 8) {
      erreurEl.textContent = "Le nouveau mot de passe doit contenir au moins 8 caractères.";
      erreurEl.hidden = false;
      return;
    }
    if (nouveau !== confirmation) {
      erreurEl.textContent = "Les deux mots de passe ne correspondent pas.";
      erreurEl.hidden = false;
      return;
    }

    const reponse = await fetch("/api/auth/changer-mot-de-passe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ancienMotDePasse: ancien, nouveauMotDePasse: nouveau })
    });
    const donnees = await reponse.json();
    if (!reponse.ok) {
      erreurEl.textContent = donnees.erreur || "Erreur.";
      erreurEl.hidden = false;
      return;
    }

        // Mot de passe change : on recharge la page pour charger tout le tableau de bord
    window.location.reload();
  });
}

function configurerModaleAffaire() {
  document.getElementById("btnFermerModale").addEventListener("click", fermerModaleAffaire);
  document.getElementById("modaleAffaire").addEventListener("click", (e) => {
    if (e.target.id === "modaleAffaire") fermerModaleAffaire();
  });
}

async function ouvrirDetailAffaire(id) {
  affaireOuverteId = id;
  const reponse = await fetch(`/api/affaires/${id}`);
  if (!reponse.ok) { alert("Impossible de charger cette affaire."); return; }
  const donnees = await reponse.json();
  rendreModaleAffaire(donnees);
  document.getElementById("modaleAffaire").hidden = false;
}

function fermerModaleAffaire() {
  document.getElementById("modaleAffaire").hidden = true;
  affaireOuverteId = null;
}

function rendreModaleAffaire(donnees) {
  const a = donnees.affaire;
  const corps = document.getElementById("corpsModaleAffaire");

  const optionsOfficiers = '<option value="">Non assigné</option>' +
    officiersDisponibles.map((o) => `<option value="${o.id}" ${a.officier_id === o.id ? "selected" : ""}>${echapperHtml(o.nomComplet)}${o.posteNom ? " (" + echapperHtml(o.posteNom) + ")" : ""}</option>`).join("");

  corps.innerHTML = `
    <h2 style="margin-top:0;">${echapperHtml(a.titre)} <span class="etiquette-categorie">${echapperHtml(a.categorie || "autre")}</span></h2>
    <div class="numero-dossier" style="margin-bottom:14px;">${echapperHtml(a.numero_dossier)} — ${echapperHtml(a.poste_nom || "Poste non assigné")}</div>
    <div class="detail">${echapperHtml(a.description || "Pas de description.")}</div>
    <div class="detail" style="margin-bottom:16px;">Statut : <span class="etiquette ${classeEtiquette(a.statut)}">${echapperHtml(a.statut)}</span></div>

    <div class="champ" style="margin-bottom:20px;">
      <label>Officier assigné</label>
      <select id="selectAssignerOfficier">${optionsOfficiers}</select>
      <button class="bouton-action" style="margin-top:6px;" onclick="assignerOfficier(${a.id})">Assigner</button>
    </div>

    <h3>Avis de recherche liés (${donnees.avisLies.length})</h3>
    ${donnees.avisLies.length === 0 ? '<div class="etat-vide">Aucun.</div>' :
      donnees.avisLies.map((v) => `<div class="detail">• ${echapperHtml(v.nom)} (${echapperHtml(v.statut)})</div>`).join("")}

    <h3>Objets volés liés (${donnees.objetsLies.length})</h3>
    ${donnees.objetsLies.length === 0 ? '<div class="etat-vide">Aucun.</div>' :
      donnees.objetsLies.map((o) => `<div class="detail">• ${echapperHtml(o.type_objet)} (${echapperHtml(o.statut)})</div>`).join("")}

    <h3>Pièces jointes</h3>
    <div class="champ pleine-largeur">
      <input type="file" id="inputPieceJointe" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx">
      <button class="bouton-action bouton-valider" style="margin-top:6px;" onclick="ajouterPieceJointe(${a.id})">Téléverser</button>
    </div>
    <div id="listePiecesJointes" style="margin-top:10px;">
      ${(!a.pieces_jointes || a.pieces_jointes.length === 0) ? '<div class="etat-vide">Aucune pièce jointe.</div>' :
        a.pieces_jointes.map((p) => `
          <div class="note-enquete" style="display:flex;justify-content:space-between;align-items:center;">
            <a href="${echapperHtml(p.chemin)}" target="_blank" style="color:var(--bleu-clair);">${echapperHtml(p.nomOriginal)}</a>
            <button class="bouton-action" onclick="supprimerPieceJointe(${a.id}, ${p.id})">Supprimer</button>
          </div>
        `).join("")}
    </div>

    <h3>Notes d'enquête</h3>
    <div class="champ pleine-largeur">
      <textarea id="texteNouvelleNote" rows="2" placeholder="Ajouter une note datée..."></textarea>
      <button class="bouton-action bouton-valider" style="margin-top:6px;" onclick="ajouterNoteAffaire(${a.id})">Ajouter la note</button>
    </div>
    <div id="listeNotesAffaire" style="margin-top:12px;">
      ${donnees.notes.length === 0 ? '<div class="etat-vide">Aucune note pour le moment.</div>' :
        donnees.notes.map((n) => `
          <div class="note-enquete">
            ${echapperHtml(n.texte)}
            <div class="meta-note">${echapperHtml(n.auteur_nom || "Inconnu")} — ${formaterDate(n.date_creation)}</div>
          </div>
        `).join("")}
    </div>
  `;
}

async function ajouterPieceJointe(idAffaire) {
  const fichier = document.getElementById("inputPieceJointe").files[0];
  if (!fichier) { alert("Choisissez un fichier."); return; }

  const formData = new FormData();
  formData.append("fichier", fichier);

  const reponse = await fetch(`/api/affaires/${idAffaire}/pieces-jointes`, { method: "POST", body: formData });
  const donnees = await reponse.json();
  if (!reponse.ok) { alert(donnees.erreur); return; }

  ouvrirDetailAffaire(idAffaire);
}

async function supprimerPieceJointe(idAffaire, idPiece) {
  if (!confirm("Supprimer cette pièce jointe ?")) return;
  await fetch(`/api/affaires/${idAffaire}/pieces-jointes/${idPiece}`, { method: "DELETE" });
  ouvrirDetailAffaire(idAffaire);
}

async function assignerOfficier(idAffaire) {
  const officierId = document.getElementById("selectAssignerOfficier").value;
  await fetch(`/api/affaires/${idAffaire}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officierId: officierId || null })
  });
  chargerAffaires();
  ouvrirDetailAffaire(idAffaire);
}

async function ajouterNoteAffaire(idAffaire) {
  const texte = document.getElementById("texteNouvelleNote").value.trim();
  if (!texte) return;
  const reponse = await fetch(`/api/affaires/${idAffaire}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texte })
  });
  if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
  ouvrirDetailAffaire(idAffaire);
}

async function changerStatutAffaire(id, statut) {
  await fetch(`/api/affaires/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statut })
  });
  chargerAffaires();
  chargerStatistiques();
}

async function supprimerAffaire(id) {
  if (!confirm("Confirmer la suppression de cette affaire ?")) return;
  const reponse = await fetch(`/api/affaires/${id}`, { method: "DELETE" });
  if (!reponse.ok) {
    const donnees = await reponse.json();
    alert(donnees.erreur || "Suppression impossible.");
    return;
  }
  chargerAffaires();
  chargerStatistiques();
}

// ---------- Export PDF ----------
function exporterAffairePdf(id) {
  const affaire = affairesActuelles.find((a) => a.id === id);
  if (!affaire || typeof window.jspdf === "undefined") return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Police Nationale — Fiche d'affaire", 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text("Numéro de dossier : " + affaire.numero_dossier, 14, 30);

  doc.setTextColor(0);
  let y = 44;
  const champs = [
    ["Titre", affaire.titre],
    ["Statut", affaire.statut],
    ["Date d'ouverture", affaire.date_ouverture],
    ["Poste", affaire.poste_nom || "Non assigné"],
    ["Officier assigné", affaire.officier_nom || "Non assigné"],
    ["Créé par", affaire.cree_par_nom || "—"]
  ];
  champs.forEach(([label, valeur]) => {
    doc.setFont(undefined, "bold");
    doc.text(label + " :", 14, y);
    doc.setFont(undefined, "normal");
    doc.text(String(valeur || "—"), 70, y);
    y += 8;
  });

  y += 4;
  doc.setFont(undefined, "bold");
  doc.text("Description :", 14, y);
  y += 8;
  doc.setFont(undefined, "normal");
  const lignesDescription = doc.splitTextToSize(affaire.description || "Aucune description fournie.", 180);
  doc.text(lignesDescription, 14, y);

  doc.save(affaire.numero_dossier + ".pdf");
}

function exporterListeAffairesPdf() {
  if (typeof window.jspdf === "undefined") return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Police Nationale — Liste des affaires", 14, 18);

  let y = 32;
  doc.setFontSize(10);
  affairesActuelles.forEach((a) => {
    if (y > 280) { doc.addPage(); y = 20; }
    doc.setFont(undefined, "bold");
    doc.text(a.numero_dossier + " — " + a.titre, 14, y);
    y += 6;
    doc.setFont(undefined, "normal");
    doc.text("Statut : " + a.statut + "   |   Ouverte le " + a.date_ouverture, 14, y);
    y += 10;
  });

  doc.save("liste-affaires.pdf");
}

// ---------- Affiche imprimable pour un avis de recherche ---------- //
function chargerImageEnDataUrl(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext("2d").drawImage(image, 0, 0);
      try { resolve(canvas.toDataURL("image/jpeg")); } catch (err) { resolve(null); }
    };
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

async function exporterAffichePdf(id) {
  const avis = avisActuels.find((v) => v.id === id);
  if (!avis || typeof window.jspdf === "undefined") return;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ format: "a4", unit: "mm" });
  const largeurPage = doc.internal.pageSize.getWidth();

  doc.setFillColor(11, 16, 23);
  doc.rect(0, 0, largeurPage, 40, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.text("AVIS DE RECHERCHE", largeurPage / 2, 18, { align: "center" });
  doc.setFontSize(11);
  doc.text("Police Nationale — République du Niger", largeurPage / 2, 28, { align: "center" });

  doc.setTextColor(0, 0, 0);

  if (avis.photo_chemin) {
    const dataUrl = await chargerImageEnDataUrl(avis.photo_chemin);
    if (dataUrl) {
      try { doc.addImage(dataUrl, "JPEG", largeurPage / 2 - 40, 48, 80, 80); } catch (err) { /* image illisible, on continue sans */ }
    }
  }

  let y = avis.photo_chemin ? 138 : 55;
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text(avis.nom, largeurPage / 2, y, { align: "center" });

  y += 12;
  doc.setFontSize(11);
  doc.setFont(undefined, "normal");
  const lignes = [
    ["Description physique", avis.description_physique || "Non renseignée"],
    ["Localisation du signalement", avis.localisation_signalement || "Inconnue"],
    ["Motif de recherche", avis.motif || "Non renseigné"],
    ["Statut", avis.statut]
  ];
  lignes.forEach(([label, valeur]) => {
    doc.setFont(undefined, "bold");
    doc.text(label + " :", 20, y);
    doc.setFont(undefined, "normal");
    const texteDecoupe = doc.splitTextToSize(valeur, largeurPage - 40);
    doc.text(texteDecoupe, 20, y + 6);
    y += 6 + texteDecoupe.length * 6;
  });

  y += 10;
  doc.setFontSize(10);
  doc.setTextColor(120, 120, 120);
  doc.text("Toute information : contactez le commissariat le plus proche.", largeurPage / 2, 280, { align: "center" });

  doc.save("avis-recherche-" + avis.nom.replace(/\s+/g, "-").toLowerCase() + ".pdf");
}

// ---------- Rapport PDF automatique (periode) ---------- //
function filtrerParPeriode(liste, champDate, periode) {
  if (periode === "tout") return liste;
  const maintenant = Date.now();
  const limiteMs = periode === "semaine" ? 7 * 24 * 3600 * 1000 : 30 * 24 * 3600 * 1000;
  return liste.filter((item) => maintenant - new Date(item[champDate]).getTime() <= limiteMs);
}

async function genererRapportPdf() {
  if (typeof window.jspdf === "undefined") return;
  const periode = document.getElementById("periodeRapport").value;
  const libellePeriode = { semaine: "7 derniers jours", mois: "30 derniers jours", tout: "toutes les données" }[periode];

  const [reponseAffaires, reponseAvis, reponseObjets, reponseStats] = await Promise.all([
    fetch("/api/affaires").then((r) => r.json()),
    fetch("/api/avis").then((r) => r.json()),
    fetch("/api/objets").then((r) => r.json()),
    fetch("/api/statistiques").then((r) => r.json())
  ]);

  const affairesPeriode = filtrerParPeriode(reponseAffaires.affaires, "date_creation", periode);
  const avisActifsPeriode = reponseAvis.avis.filter((v) => v.statut === "actif");
  const objetsRecherchePeriode = reponseObjets.objets.filter((o) => o.statut === "recherche");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const largeurPage = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(18);
  doc.text("Rapport d'activité — Police Nationale", 14, y);
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text("Période : " + libellePeriode + " — Généré le " + new Date().toLocaleString("fr-FR"), 14, y);
  doc.setTextColor(0);
  y += 14;

  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text("Résumé", 14, y);
  y += 8;
  doc.setFont(undefined, "normal");
  doc.setFontSize(11);
  [
    "Affaires sur la période : " + affairesPeriode.length,
    "Avis de recherche actifs : " + avisActifsPeriode.length,
    "Objets volés recherchés : " + objetsRecherchePeriode.length,
    "Total d'affaires (toutes périodes) : " + reponseStats.totalAffaires
  ].forEach((ligne) => { doc.text("• " + ligne, 18, y); y += 7; });

  y += 6;
  doc.setFontSize(13);
  doc.setFont(undefined, "bold");
  doc.text("Affaires (" + affairesPeriode.length + ")", 14, y);
  y += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  if (affairesPeriode.length === 0) { doc.text("Aucune affaire sur cette période.", 18, y); y += 7; }
  affairesPeriode.forEach((a) => {
    if (y > 280) { doc.addPage(); y = 20; }
    doc.setFont(undefined, "bold");
    doc.text(a.numero_dossier + " — " + a.titre, 18, y);
    y += 5;
    doc.setFont(undefined, "normal");
    doc.text("Statut : " + a.statut + "  |  Catégorie : " + (a.categorie || "autre") + "  |  Ouverte le " + a.date_ouverture, 18, y);
    y += 8;
  });

  doc.save("rapport-" + periode + "-" + new Date().toISOString().slice(0, 10) + ".pdf");
}

// ---------- Avis de recherche ----------
let avisActuels = [];

function rendreAvis(avis) {
  avisActuels = avis;
  const conteneur = document.getElementById("listeAvis");
  if (avis.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucun avis de recherche actif.</div>';
    return;
  }
  conteneur.innerHTML = avis.map((v) => `
    <div class="carte-item ${v.priorite ? 'item-prioritaire' : ''}">
      <div class="ligne-entete">
        <div class="titre-item">${echapperHtml(v.nom)} ${v.priorite ? '<span class="etiquette-priorite">⚠️ Prioritaire</span>' : ''}</div>
        <span class="etiquette ${classeEtiquette(v.statut)}">${echapperHtml(v.statut)}</span>
      </div>
      <div class="detail">${echapperHtml(v.description_physique || "")}</div>
      <div class="detail">Localisation : ${echapperHtml(v.localisation_signalement || "Inconnue")}</div>
      ${v.motif ? `<div class="detail">Motif : ${echapperHtml(v.motif)}</div>` : ""}
      ${v.photo_chemin ? `<img src="${echapperHtml(v.photo_chemin)}" alt="Photo de ${echapperHtml(v.nom)}">` : ""}
      <div class="actions">
        ${v.statut !== "localise" ? `<button class="bouton-action" onclick="changerStatutAvis(${v.id}, 'localise')">Marquer localisé</button>` : ""}
        ${v.statut !== "annule" ? `<button class="bouton-action" onclick="changerStatutAvis(${v.id}, 'annule')">Annuler l'avis</button>` : ""}
        <button class="bouton-action" onclick="exporterAffichePdf(${v.id})">🖨 Affiche à imprimer</button>
        <button class="bouton-action" onclick="supprimerAvis(${v.id})">Supprimer</button>
      </div>
    </div>
  `).join("");
}

async function chargerAvis() {
  const reponse = await fetch("/api/avis");
  const donnees = await reponse.json();
  rendreAvis(donnees.avis);
}

async function changerStatutAvis(id, statut) {
  await fetch(`/api/avis/${id}/statut`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statut })
  });
  chargerAvis();
  chargerStatistiques();
}

async function supprimerAvis(id) {
  if (!confirm("Confirmer la suppression de cet avis ?")) return;
  await fetch(`/api/avis/${id}`, { method: "DELETE" });
  chargerAvis();
  chargerStatistiques();
}

// ---------- Objets voles ----------
function rendreObjets(objets) {
  const conteneur = document.getElementById("listeObjets");
  if (objets.length === 0) {
    conteneur.innerHTML = '<div class="etat-vide">Aucun objet déclaré volé.</div>';
    return;
  }
  conteneur.innerHTML = objets.map((o) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div class="titre-item">${echapperHtml(o.type_objet)}</div>
        <span class="etiquette ${classeEtiquette(o.statut)}">${echapperHtml(o.statut)}</span>
      </div>
      <div class="detail">${echapperHtml(o.description || "")}</div>
      <div class="detail">Vol le ${echapperHtml(o.date_vol || "date inconnue")} — Lieu : ${echapperHtml(o.lieu_vol || "inconnu")}</div>
      <div class="actions">
        ${o.statut !== "retrouve" ? `<button class="bouton-action" onclick="changerStatutObjet(${o.id}, 'retrouve')">Marquer retrouvé</button>` : ""}
        <button class="bouton-action" onclick="supprimerObjet(${o.id})">Supprimer</button>
      </div>
    </div>
  `).join("");
}

async function chargerObjets() {
  const reponse = await fetch("/api/objets");
  const donnees = await reponse.json();
  rendreObjets(donnees.objets);
}

async function changerStatutObjet(id, statut) {
  await fetch(`/api/objets/${id}/statut`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statut })
  });
  chargerObjets();
  chargerStatistiques();
}

async function supprimerObjet(id) {
  if (!confirm("Confirmer la suppression de cet objet ?")) return;
  await fetch(`/api/objets/${id}`, { method: "DELETE" });
  chargerObjets();
  chargerStatistiques();
}

// ---------- Utilisateurs (admin) ----------
function rendreUtilisateurs(utilisateurs) {
  const conteneur = document.getElementById("listeUtilisateurs");
  conteneur.innerHTML = utilisateurs.map((u) => `
    <div class="carte-item">
      <div class="ligne-entete">
        <div>
          <div class="titre-item">${echapperHtml(u.nom_complet)} (${echapperHtml(u.identifiant)})</div>
          <div class="numero-dossier">${echapperHtml(u.grade || "")} ${u.poste_nom ? "— " + echapperHtml(u.poste_nom) : ""}</div>
        </div>
        <span class="etiquette ${u.role === 'admin' ? 'etiquette-encours' : 'etiquette-resolu'}">${echapperHtml(u.role)}</span>
      </div>
      <div class="detail">Statut : ${u.actif ? "Actif" : "Désactivé"}</div>
      <div class="actions">
        <button class="bouton-action" onclick="basculerStatutUtilisateur(${u.id}, ${u.actif ? 0 : 1})">
          ${u.actif ? "Désactiver" : "Réactiver"}
        </button>
      </div>
    </div>
  `).join("");
}

async function chargerUtilisateurs() {
  const reponse = await fetch("/api/auth/utilisateurs");
  if (!reponse.ok) return;
  const donnees = await reponse.json();
  rendreUtilisateurs(donnees.utilisateurs);
}

async function basculerStatutUtilisateur(id, actif) {
  await fetch(`/api/auth/utilisateurs/${id}/statut`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actif })
  });
  chargerUtilisateurs();
}

// ---------- Formulaires ----------
function configurerFormulaires() {
  // Affaires
  document.getElementById("btnAjouterAffaire").addEventListener("click", async () => {
    const titre = document.getElementById("affTitre").value.trim();
    if (!titre) { alert("Le titre est obligatoire."); return; }
    const reponse = await fetch("/api/affaires", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titre,
        dateOuverture: document.getElementById("affDate").value,
        description: document.getElementById("affDescription").value,
        categorie: document.getElementById("affCategorie").value,
        lieu: document.getElementById("affLieu").value,
        latitude: document.getElementById("affLatitude").value,
        longitude: document.getElementById("affLongitude").value
      })
    });
    if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
    document.getElementById("affTitre").value = "";
    document.getElementById("affDate").value = "";
    document.getElementById("affDescription").value = "";
    document.getElementById("affLieu").value = "";
    document.getElementById("affLatitude").value = "";
    document.getElementById("affLongitude").value = "";
    chargerAffaires();
    chargerStatistiques();
    if (carteInitialisee) chargerPointsCarte();
  });

  document.getElementById("btnRechercherAffaires").addEventListener("click", async () => {
    const q = document.getElementById("rechercheAffaires").value.trim();
    const parametres = construireParametresFiltres();
    parametres.set("q", q);
    const reponse = await fetch("/api/affaires/recherche?" + parametres.toString());
    const donnees = await reponse.json();
    rendreAffaires(donnees.affaires);
  });

  document.getElementById("btnReinitAffaires").addEventListener("click", () => {
    document.getElementById("rechercheAffaires").value = "";
    chargerAffaires();
  });

  document.getElementById("btnExporterAffairesPdf").addEventListener("click", exporterListeAffairesPdf);
  document.getElementById("btnGenererRapport").addEventListener("click", genererRapportPdf);

  // Avis de recherche
  document.getElementById("formAvis").addEventListener("submit", async (e) => {
    e.preventDefault();
    const nom = document.getElementById("avisNom").value.trim();
    if (!nom) { alert("Le nom est obligatoire."); return; }

    const formData = new FormData();
    formData.append("nom", nom);
    formData.append("localisation", document.getElementById("avisLocalisation").value);
    formData.append("descriptionPhysique", document.getElementById("avisDescPhysique").value);
    formData.append("motif", document.getElementById("avisMotif").value);
    formData.append("latitude", document.getElementById("avisLatitude").value);
    formData.append("longitude", document.getElementById("avisLongitude").value);
    formData.append("priorite", document.getElementById("avisPriorite").checked);
    formData.append("affaireId", document.getElementById("avisAffaireId").value);
    if (descripteurPhotoAvisActuel) {
      formData.append("descripteurFacial", JSON.stringify(descripteurPhotoAvisActuel));
    }
    const fichier = document.getElementById("avisPhoto").files[0];
    if (fichier) formData.append("photo", fichier);

    const reponse = await fetch("/api/avis", { method: "POST", body: formData });
    if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
    document.getElementById("formAvis").reset();
    descripteurPhotoAvisActuel = null;
    document.getElementById("statutAnalyseVisageAvis").textContent = "";
    chargerAvis();
    chargerStatistiques();
    if (carteInitialisee) chargerPointsCarte();
  });

  // Objets voles
  document.getElementById("btnAjouterObjet").addEventListener("click", async () => {
    const typeObjet = document.getElementById("objType").value.trim();
    if (!typeObjet) { alert("Le type d'objet est obligatoire."); return; }
    const reponse = await fetch("/api/objets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        typeObjet,
        dateVol: document.getElementById("objDate").value,
        lieuVol: document.getElementById("objLieu").value,
        description: document.getElementById("objDescription").value,
        latitude: document.getElementById("objLatitude").value,
        longitude: document.getElementById("objLongitude").value,
        affaireId: document.getElementById("objAffaireId").value
      })
    });
    if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
    document.getElementById("objType").value = "";
    document.getElementById("objDate").value = "";
    document.getElementById("objLieu").value = "";
    document.getElementById("objDescription").value = "";
    document.getElementById("objLatitude").value = "";
    document.getElementById("objLongitude").value = "";
    chargerObjets();
    chargerStatistiques();
    if (carteInitialisee) chargerPointsCarte();
  });

  // Postes (admin)
  const btnAjouterPoste = document.getElementById("btnAjouterPoste");
  if (btnAjouterPoste) {
    btnAjouterPoste.addEventListener("click", async () => {
      const nom = document.getElementById("posteNom").value.trim();
      if (!nom) { alert("Le nom du poste est obligatoire."); return; }
      const reponse = await fetch("/api/postes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nom,
          ville: document.getElementById("posteVille").value,
          latitude: document.getElementById("posteLatitude").value,
          longitude: document.getElementById("posteLongitude").value
        })
      });
      if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
      document.getElementById("posteNom").value = "";
      document.getElementById("posteVille").value = "";
      document.getElementById("posteLatitude").value = "";
      document.getElementById("posteLongitude").value = "";
      chargerPostes();
      if (carteInitialisee) chargerPointsCarte();
    });
  }

  // Utilisateurs (admin)
  const btnCreerUtilisateur = document.getElementById("btnCreerUtilisateur");
  if (btnCreerUtilisateur) {
    btnCreerUtilisateur.addEventListener("click", async () => {
      const identifiant = document.getElementById("uxIdentifiant").value.trim();
      const motDePasse = document.getElementById("uxMotDePasse").value;
      const nomComplet = document.getElementById("uxNomComplet").value.trim();
      const grade = document.getElementById("uxGrade").value.trim();
      const role = document.getElementById("uxRole").value;
      const posteId = document.getElementById("uxPoste").value;

      const reponse = await fetch("/api/auth/utilisateurs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiant, motDePasse, nomComplet, grade, role, posteId })
      });
      if (!reponse.ok) { const d = await reponse.json(); alert(d.erreur); return; }
      document.getElementById("uxIdentifiant").value = "";
      document.getElementById("uxMotDePasse").value = "";
      document.getElementById("uxNomComplet").value = "";
      document.getElementById("uxGrade").value = "";
      chargerUtilisateurs();
    });
  }

  const btnCreerLot = document.getElementById("btnCreerLotUtilisateurs");
  if (btnCreerLot) {
    btnCreerLot.addEventListener("click", async () => {
      const lignes = document.getElementById("uxLotTexte").value.split("\n").map((l) => l.trim()).filter(Boolean);
      const agents = lignes.map((ligne) => {
        const [identifiant, nomComplet, grade] = ligne.split(",").map((v) => (v || "").trim());
        return { identifiant, nomComplet, grade };
      });

      if (agents.length === 0) { alert("Ajoutez au moins un agent."); return; }

      const reponse = await fetch("/api/auth/utilisateurs/lot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agents, posteId: document.getElementById("uxLotPoste").value })
      });
      const donnees = await reponse.json();

      const conteneur = document.getElementById("resultatsLotUtilisateurs");
      conteneur.innerHTML = `
        <p class="aide-carte">⚠️ Notez ces mots de passe maintenant : ils ne seront plus jamais affichés. Chaque agent devra le changer à sa première connexion.</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr style="text-align:left;color:var(--texte-att);"><th>Identifiant</th><th>Nom</th><th>Mot de passe</th><th>Statut</th></tr>
          ${donnees.resultats.map((r) => `
            <tr style="border-top:1px solid var(--bordure);">
              <td style="padding:6px 0;">${echapperHtml(r.identifiant)}</td>
              <td>${echapperHtml(r.nomComplet || "—")}</td>
              <td style="font-family:monospace;">${echapperHtml(r.motDePasse || "—")}</td>
              <td>${r.succes ? "✅ Créé" : "❌ " + echapperHtml(r.erreur)}</td>
            </tr>
          `).join("")}
        </table>
      `;

      document.getElementById("uxLotTexte").value = "";
      chargerUtilisateurs();
    });
  }
}

initialiser();
