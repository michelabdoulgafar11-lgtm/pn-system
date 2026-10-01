// public/js/reconnaissance.js
// Reconnaissance faciale et detection de mouvement, entierement executees
// dans le navigateur (via face-api.js, base sur TensorFlow.js). Aucune photo
// n'est jamais envoyee a un service tiers : seul un "descripteur" (128
// nombres decrivant mathematiquement un visage, impossible a reconvertir en
// image) est stocke sur notre serveur.
//
// IMPORTANT : la reconnaissance faciale ne donne JAMAIS de certitude absolue.
// Elle propose des correspondances possibles, classees par ressemblance, a
// verifier obligatoirement par un agent avant toute action. Ce principe est
// applique partout dans ce fichier et ne doit pas etre contourne.

const CDN_MODELES_VISAGE = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights";
let modelesVisageCharges = false;
let descripteurPhotoAvisActuel = null; // utilise lors de la creation d'un avis de recherche

async function chargerModelesVisage() {
  if (modelesVisageCharges) return true;
  if (typeof faceapi === "undefined") return false;
  try {
    await faceapi.nets.tinyFaceDetector.loadFromUri(CDN_MODELES_VISAGE);
    await faceapi.nets.faceLandmark68Net.loadFromUri(CDN_MODELES_VISAGE);
    await faceapi.nets.faceRecognitionNet.loadFromUri(CDN_MODELES_VISAGE);
    modelesVisageCharges = true;
  } catch (err) {
    console.error("Impossible de charger les modèles de reconnaissance faciale :", err);
  }
  return modelesVisageCharges;
}

async function calculerDescripteurVisage(elementImage) {
  const pret = await chargerModelesVisage();
  if (!pret) return null;
  try {
    const resultat = await faceapi
      .detectSingleFace(elementImage, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
    return resultat ? Array.from(resultat.descriptor) : null;
  } catch (err) {
    console.error("Erreur d'analyse du visage :", err);
    return null;
  }
}

function distanceDescripteurs(a, b) {
  let somme = 0;
  for (let i = 0; i < a.length; i++) somme += (a[i] - b[i]) ** 2;
  return Math.sqrt(somme);
}

function libelleConfiance(distance) {
  // Seuils usuels avec ce modele (a titre indicatif seulement, jamais une certitude)
  if (distance < 0.45) return { texte: "Ressemblance forte — à vérifier", classe: "etiquette-resolu" };
  if (distance < 0.6) return { texte: "Ressemblance moyenne — à vérifier", classe: "etiquette-encours" };
  return { texte: "Ressemblance faible", classe: "etiquette-classe-sans-suite" };
}

// ---------- Calcul du descripteur lors de l'ajout d'un avis de recherche ---------- //
function configurerDescripteurFormulaireAvis() {
  const inputPhoto = document.getElementById("avisPhoto");
  if (!inputPhoto) return;

  inputPhoto.addEventListener("change", async () => {
    descripteurPhotoAvisActuel = null;
    const fichier = inputPhoto.files[0];
    if (!fichier) return;

    const statutEl = document.getElementById("statutAnalyseVisageAvis");
    if (statutEl) statutEl.textContent = "Analyse du visage en cours...";

    const image = await chargerImageDepuisFichier(fichier);
    const descripteur = await calculerDescripteurVisage(image);
    descripteurPhotoAvisActuel = descripteur;

    if (statutEl) {
      statutEl.textContent = descripteur
        ? "✅ Visage détecté — pourra être utilisé pour la reconnaissance faciale."
        : "⚠️ Aucun visage détecté sur cette photo (l'avis sera quand même créé).";
    }
  });
}

function chargerImageDepuisFichier(fichier) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = URL.createObjectURL(fichier);
  });
}

// ---------- Outil de reconnaissance faciale (onglet dedie) ---------- //
function configurerReconnaissanceFaciale() {
  document.getElementById("inputPhotoRecherche").addEventListener("change", async (e) => {
    const fichier = e.target.files[0];
    if (!fichier) return;
    const image = await chargerImageDepuisFichier(fichier);
    document.getElementById("apercuPhotoRecherche").src = image.src;
    document.getElementById("apercuPhotoRecherche").hidden = false;
    await lancerRechercheFaciale(image);
  });

  document.getElementById("btnCapturerPhotoRecherche").addEventListener("click", async () => {
    try {
      const flot = await navigator.mediaDevices.getUserMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = flot;
      await video.play();
      await new Promise((r) => setTimeout(r, 400)); // laisser la camera s'ajuster

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0);
      flot.getTracks().forEach((t) => t.stop());

      const image = new Image();
      image.onload = () => {
        document.getElementById("apercuPhotoRecherche").src = image.src;
        document.getElementById("apercuPhotoRecherche").hidden = false;
        lancerRechercheFaciale(image);
      };
      image.src = canvas.toDataURL("image/jpeg");
    } catch (err) {
      alert("Impossible d'accéder à la caméra.");
    }
  });
}

async function lancerRechercheFaciale(image) {
  const statut = document.getElementById("statutRechercheFaciale");
  const resultats = document.getElementById("resultatsRechercheFaciale");
  statut.textContent = "Analyse en cours...";
  resultats.innerHTML = "";

  const descripteur = await calculerDescripteurVisage(image);
  if (!descripteur) {
    statut.textContent = "Aucun visage détecté sur cette photo.";
    return;
  }

  const reponse = await fetch("/api/avis/descripteurs");
  const donnees = await reponse.json();

  if (donnees.descripteurs.length === 0) {
    statut.textContent = "Aucun avis de recherche avec photo analysée n'est enregistré pour l'instant.";
    return;
  }

  const classement = donnees.descripteurs
    .map((d) => ({ ...d, distance: distanceDescripteurs(descripteur, d.descripteur) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8);

  statut.textContent = `${classement.length} correspondance(s) possible(s) trouvée(s) — à vérifier manuellement.`;

  resultats.innerHTML = classement.map((r) => {
    const confiance = libelleConfiance(r.distance);
    return `
      <div class="carte-item">
        <div class="ligne-entete">
          <div class="titre-item">${echapperHtml(r.nom)}</div>
          <span class="etiquette ${confiance.classe}">${confiance.texte}</span>
        </div>
        ${r.photoChemin ? `<img src="${echapperHtml(r.photoChemin)}" alt="${echapperHtml(r.nom)}">` : ""}
        <div class="detail">Statut de l'avis : ${echapperHtml(r.statut)}</div>
      </div>
    `;
  }).join("");
}

// ---------- Detection de mouvement (sur un flux video ou une image MJPEG) ---------- //
const detecteursMouvementActifs = {}; // idElement -> { intervalId, dernierCanvas }

function basculerDetectionMouvement(idElementSource, idCamera, estMjpeg) {
  if (detecteursMouvementActifs[idElementSource]) {
    clearInterval(detecteursMouvementActifs[idElementSource].intervalId);
    delete detecteursMouvementActifs[idElementSource];
    return false;
  }

  const source = document.getElementById(idElementSource);
  if (!source) return false;

  const canvas = document.createElement("canvas");
  canvas.width = 64; canvas.height = 48; // tres petite taille : suffisant pour detecter un mouvement, rapide a calculer
  const ctx = canvas.getContext("2d");
  let dernierePixelData = null;
  let dernierDeclenchement = 0;

  const intervalId = setInterval(() => {
    try {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const donneesImage = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

      if (dernierePixelData) {
        let differenceTotale = 0;
        for (let i = 0; i < donneesImage.length; i += 4) {
          differenceTotale += Math.abs(donneesImage[i] - dernierePixelData[i]);
        }
        const seuil = canvas.width * canvas.height * 12; // ajuste empiriquement
        if (differenceTotale > seuil && Date.now() - dernierDeclenchement > 5000) {
          dernierDeclenchement = Date.now();
          signalerMouvementDetecte(idElementSource, idCamera);
        }
      }
      dernierePixelData = donneesImage;
    } catch (err) {
      // Erreur de securite du navigateur : le flux vient d'un autre appareil
      // (caméra IP) sans autorisation CORS, donc impossible de lire ses
      // pixels pour comparer les images. C'est une limite du navigateur, pas
      // un bug : on previent clairement l'utilisateur une seule fois puis on arrete.
      if (err.name === "SecurityError") {
        alert("La détection de mouvement n'est pas possible sur ce flux : le navigateur bloque la lecture des images d'un autre appareil pour des raisons de sécurité (restriction technique, pas un bug). Cela concerne les caméras IP en MJPEG ; les caméras d'agents (via l'interrupteur de partage) fonctionnent normalement.");
        clearInterval(intervalId);
        delete detecteursMouvementActifs[idElementSource];
      }
    }
  }, 700);

  detecteursMouvementActifs[idElementSource] = { intervalId };
  return true;
}

function signalerMouvementDetecte(idElementSource, idCamera) {
  const carte = document.getElementById(idElementSource).closest(".carte-video");
  if (carte) {
    const badge = document.createElement("div");
    badge.textContent = "⚠️ Mouvement détecté à " + new Date().toLocaleTimeString("fr-FR");
    badge.className = "badge-mouvement";
    carte.appendChild(badge);
    setTimeout(() => badge.remove(), 4000);
  }

  if (idCamera) {
    fetch(`/api/cameras-ip/${idCamera}/mouvement`, { method: "POST" }).catch(() => {});
  }
}
