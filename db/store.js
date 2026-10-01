// db/store.js
// Base de donnees simple basee sur un fichier JSON (db/donnees.json), sans
// aucune dependance native a compiler. Choisie pour sa fiabilite sur des
// systemes anciens ou sans outils de compilation (ex. Windows 8.1).
//
// Toutes les routes importent ce module et manipulent directement les
// tableaux dans `donnees`, puis appellent sauvegarder() pour persister sur disque.

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const CHEMIN_DONNEES = path.join(__dirname, "donnees.json");

function etatInitial() {
  return {
    postes: [],
    utilisateurs: [],
    affaires: [],
    notes_affaires: [],
    avis_recherche: [],
    objets_voles: [],
    cameras_ip: [],
    zones: [],
    journal_audit: [],
    compteurs: {
      postes: 0,
      utilisateurs: 0,
      affaires: 0,
      notes_affaires: 0,
      avis_recherche: 0,
      objets_voles: 0,
      cameras_ip: 0,
      zones: 0,
      pieces_jointes: 0,
      journal_audit: 0
    }
  };
}

let donnees;

function charger() {
  if (fs.existsSync(CHEMIN_DONNEES)) {
    donnees = JSON.parse(fs.readFileSync(CHEMIN_DONNEES, "utf8"));
    migrer();
  } else {
    donnees = etatInitial();
  }
}

// Complete les fichiers donnees.json crees par une version anterieure du
// logiciel avec les nouvelles collections/compteurs, sans toucher aux
// donnees existantes.
function migrer() {
  const base = etatInitial();
  for (const cle of Object.keys(base)) {
    if (!(cle in donnees)) donnees[cle] = base[cle];
  }
  for (const cle of Object.keys(base.compteurs)) {
    if (!(cle in donnees.compteurs)) donnees.compteurs[cle] = 0;
  }
  // Poste par defaut pour les utilisateurs/dossiers deja crees sans poste
  if (donnees.postes.length === 0) {
    const posteParDefaut = {
      id: idSuivant("postes"),
      nom: "Commissariat Central",
      ville: "Niamey",
      actif: 1,
      date_creation: new Date().toISOString()
    };
    donnees.postes.push(posteParDefaut);
    donnees.utilisateurs.forEach((u) => { if (!u.poste_id) u.poste_id = posteParDefaut.id; });
    donnees.affaires.forEach((a) => { if (!a.poste_id) a.poste_id = posteParDefaut.id; });
  }
}

function sauvegarder() {
  // Ecriture "atomique" simple : on ecrit dans un fichier temporaire puis on
  // renomme, pour eviter de corrompre le fichier si le programme s'arrete
  // brutalement pendant l'ecriture.
  const tmp = CHEMIN_DONNEES + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(donnees, null, 2), "utf8");
  fs.renameSync(tmp, CHEMIN_DONNEES);
}

function idSuivant(collection) {
  donnees.compteurs[collection] = (donnees.compteurs[collection] || 0) + 1;
  return donnees.compteurs[collection];
}

charger();

// --- Creation d'un poste par defaut si aucun poste n'existe encore ---
let posteParDefautId = donnees.postes.length > 0 ? donnees.postes[0].id : null;
if (donnees.postes.length === 0) {
  const posteParDefaut = {
    id: idSuivant("postes"),
    nom: "Commissariat Central",
    ville: "Niamey",
    actif: 1,
    date_creation: new Date().toISOString()
  };
  donnees.postes.push(posteParDefaut);
  posteParDefautId = posteParDefaut.id;
  sauvegarder();
}

// --- Creation du compte administrateur par defaut si aucun utilisateur n'existe ---
if (donnees.utilisateurs.length === 0) {
  const motDePasseParDefaut = "ChangezMoi123!";
  const hash = bcrypt.hashSync(motDePasseParDefaut, 12);
  donnees.utilisateurs.push({
    id: idSuivant("utilisateurs"),
    identifiant: "admin",
    mot_de_passe_hash: hash,
    nom_complet: "Administrateur Systeme",
    grade: "N/A",
    role: "admin",
    poste_id: posteParDefautId,
    actif: 1,
    doit_changer_mot_de_passe: true,
    date_creation: new Date().toISOString()
  });
  sauvegarder();
  console.log("========================================================");
  console.log("Compte administrateur cree :");
  console.log("  Identifiant : admin");
  console.log("  Mot de passe : " + motDePasseParDefaut);
  console.log("  >>> CHANGEZ CE MOT DE PASSE IMMEDIATEMENT APRES CONNEXION <<<");
  console.log("========================================================");
}

module.exports = { donnees, sauvegarder, idSuivant, charger };
