# Système de Gestion Policière

Application web complète pour la gestion des affaires, des avis de recherche
et des objets volés, avec comptes utilisateurs sécurisés et journal d'audit.

## Ce que contient ce logiciel

- **Backend** : Node.js + Express, avec une base de données en fichier JSON
  (`db/donnees.json`, créé automatiquement — aucun serveur de base de données à
  installer séparément, et aucune dépendance native à compiler, pour une
  installation fiable même sur des systèmes anciens comme Windows 8.1)
- **Authentification sécurisée** : mots de passe hashés (bcrypt, jamais stockés en
  clair), sessions sécurisées côté serveur, limitation anti-force-brute sur la connexion
- **Rôles** : `admin` (gère les comptes) et `officier` (gère les dossiers)
- **Fonctionnalités** :
  - Affaires (dossiers) avec numéro auto-généré (`AFF-2026-0001`), statut, recherche
  - Avis de recherche avec téléversement de photo (validé et stocké en fichier, pas en base64)
  - Objets volés
  - **Gestion de plusieurs postes/commissariats**, avec ventilation des statistiques par poste
  - **Tableau de bord "salle de contrôle"** avec graphiques (évolution mensuelle, répartition par
    statut, par poste) et fil d'activité en direct
  - **Notifications** : une cloche dans le menu affiche les dernières actions effectuées sur le système
  - **Export PDF** des affaires (fiche individuelle ou liste complète), généré directement dans le
    navigateur
  - **Documents** : pièces jointes sur les affaires (PDF, images, Word, Excel), rapport PDF
    automatique (7 derniers jours / 30 derniers jours / tout), et affiche imprimable au format A4
    pour chaque avis de recherche
  - **Comptes agents** : changement de mot de passe obligatoire à la première connexion (aussi
    bloqué côté serveur, pas juste visuel), et création en masse de plusieurs comptes agents à la fois
    avec mots de passe générés automatiquement
  - **Assistant IA avec capacités d'action** : en plus de répondre à des questions, l'assistant peut
    créer une affaire, ajouter une note, ou changer un statut directement depuis une demande en
    langage naturel. Les actions sensibles (suppression) demandent toujours une confirmation explicite
  - **Structure pour API opérateur télécom** (en attente d'accès légal) : emplacement prêt dans le
    logiciel pour brancher une API de localisation par triangulation, à activer uniquement une fois
    l'accès légal obtenu (voir plus bas)
  - **Reconnaissance faciale** (nouvel onglet) : compare une photo (upload ou prise avec la caméra) aux
    avis de recherche déjà photographiés. Fonctionne entièrement dans le navigateur (aucune photo
    envoyée à un service extérieur) ; affiche des correspondances **possibles à vérifier**, jamais des
    certitudes
  - **Détection de mouvement** sur les flux vidéo (bouton "🎯 Activer détection" sur chaque caméra dans
    l'onglet Supervision) : alerte visuelle et entrée dans le journal d'activité quand un mouvement est
    détecté. Fonctionne sur les caméras d'agents ; sur les caméras IP en MJPEG, le navigateur bloque
    cette fonctionnalité pour des raisons de sécurité (voir les limites connues plus bas)
  - **Outils SIG avancés** sur la carte : carte de chaleur des incidents, dessin de zones/secteurs
    (polygone, rectangle, cercle) avec statistiques du nombre d'affaires/avis/objets à l'intérieur,
    recherche spatiale ("tout ce qui est dans un rayon de X km"), calcul d'itinéraire entre deux points,
    export de toutes les données géolocalisées en GeoJSON ou KML, et import de zones depuis un fichier
    GeoJSON
  - **Alertes et appel audio de groupe** : un agent peut déclencher une alerte pour voir les agents
    actifs à proximité (selon leur position partagée), en sélectionner plusieurs, et les appeler tous
    en même temps en audio (connexion directe entre navigateurs, comme un talkie-walkie de groupe)
  - **Caméras IP** (nouvel onglet "Supervision caméra", section admin) : connexion de vraies caméras
    de vidéosurveillance ou d'un téléphone en mode "caméra IP" — flux MJPEG/HTTP lus directement,
    flux RTSP convertis via ffmpeg (à installer séparément, voir plus bas) ; les caméras géolocalisées
    apparaissent aussi sur la carte principale
  - **Caméra en direct (vidéo + audio)** : un agent peut activer volontairement le partage de sa
    caméra/micro depuis son appareil ; un superviseur peut voir la liste des agents en direct et
    regarder leur flux depuis l'onglet "Supervision caméra" (connexion directe entre navigateurs,
    aucune vidéo n'est stockée sur le serveur)
  - **Localisation en temps réel des agents** : chaque agent peut activer (volontairement) le partage
    de sa position depuis son appareil ; les agents actifs apparaissent sur la carte avec un marqueur
    pulsant, et un compteur s'affiche au tableau de bord
  - **Carte interactive de la région** (OpenStreetMap, gratuit, sans clé API) : affaires, avis de
    recherche, objets volés et postes de police localisés sur une carte, avec filtres par type
  - **Assistant IA** (facultatif) pour poser des questions en langage naturel sur les dossiers —
    nécessite une clé API Anthropic (voir plus bas)
  - Journal d'audit (qui a fait quoi, et quand)
- **Sécurité** : protection contre l'injection SQL (requêtes préparées), contre le
  XSS (échappement systématique à l'affichage), cookies de session `httpOnly`

## Installation (pas à pas)

### 1. Prérequis
Installez **Node.js** (version 18 ou plus récente) : https://nodejs.org

Vérifiez l'installation :
```bash
node --version
npm --version
```

### 2. Installer les dépendances
Ouvrez un terminal dans le dossier du projet, puis :
```bash
npm install
```
Cela télécharge Express, la base de données SQLite, bcrypt, etc. (nécessite internet
la première fois).

### 3. Configurer les variables d'environnement
```bash
cp .env.example .env
```
Puis ouvrez `.env` et remplacez `SESSION_SECRET` par une valeur aléatoire. Vous pouvez
en générer une avec :
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Initialiser la base de données
```bash
npm run init-db
```
Cela crée le fichier `db/pn.db` avec toutes les tables, et affiche à l'écran
l'identifiant et le mot de passe du **compte administrateur par défaut** :
```
Identifiant : admin
Mot de passe : ChangezMoi123!
```
**Connectez-vous et changez ce mot de passe immédiatement** (menu de votre profil
une fois connecté, ou via l'API `/api/auth/changer-mot-de-passe`).

### 5. Démarrer le serveur
```bash
npm start
```
Puis ouvrez votre navigateur à l'adresse : **http://localhost:3000**

### 6. (Facultatif) Activer l'assistant IA
Ouvrez `.env` et remplissez `ANTHROPIC_API_KEY` avec une clé obtenue sur
https://console.anthropic.com (créez un compte, ajoutez un peu de crédit,
puis générez une clé API). Redémarrez le serveur (`npm start`) après l'avoir
ajoutée. Sans cette clé, l'onglet "Assistant IA" reste visible mais indique
qu'il n'est pas configuré — le reste du logiciel fonctionne normalement.

### 7. (Facultatif) Installer ffmpeg pour les caméras RTSP
Les caméras IP en MJPEG/HTTP fonctionnent sans rien installer de plus. Pour
les caméras **RTSP** (la majorité des caméras de vidéosurveillance
professionnelles et des NVR), il faut installer **ffmpeg** séparément :

- **Windows** : téléchargez une version "essentials" ou "full" sur
  https://www.gyan.dev/ffmpeg/builds/ (section "release builds"), décompressez
  le dossier, puis ajoutez son sous-dossier `bin` au PATH système (Panneau de
  configuration → Système → Paramètres système avancés → Variables
  d'environnement → modifier `Path`)
- Vérifiez l'installation avec `ffmpeg -version` dans un terminal — si la
  commande est reconnue, c'est prêt

Sans ffmpeg installé, les caméras MJPEG continuent de fonctionner normalement ;
seules les caméras RTSP afficheront un message "indisponible" jusqu'à ce que
ffmpeg soit installé et le serveur redémarré.

### 8. (Facultatif, en attente) Intégration API opérateur télécom
Cette fonctionnalité reste **désactivée** tant que vous n'avez pas reçu, dans
un cadre légal (réquisition judiciaire ou partenariat officiel), la
documentation et les identifiants d'accès d'un opérateur télécom. Une fois
reçus, ouvrez `.env` et remplissez `TELECOM_API_URL` et `TELECOM_API_KEY`,
puis redémarrez le serveur. Le logiciel suppose que l'API de l'opérateur :
- accepte une requête `POST` avec `{ "numero": "..." }` en JSON
- attend l'authentification via l'en-tête `Authorization: Bearer <clé>`
- répond avec `{ "latitude": ..., "longitude": ... }`

Si la vraie API de l'opérateur fonctionne différemment, il suffira d'ajuster
`routes/telecom.js` en conséquence — dites-le-moi quand vous aurez cette
documentation, je l'adapterai.

## Utilisation au quotidien

- Un **administrateur** peut créer des comptes pour les officiers (onglet
  "Comptes utilisateurs", visible seulement pour les admins) — un par un, ou
  **en masse** (plusieurs agents à la fois, avec mots de passe générés
  automatiquement à noter immédiatement, ils ne sont affichés qu'une fois).
- **Chaque nouveau compte doit changer son mot de passe à la première
  connexion** — c'est vérifié et bloqué côté serveur, pas seulement à
  l'affichage.
- Un **officier** peut créer/consulter/modifier les affaires de son propre
  poste, les avis de recherche et objets volés, mais ne peut pas gérer les
  comptes ni voir les affaires des autres postes.
- Toutes les actions importantes (connexion, création, suppression, changement
  de statut) sont enregistrées dans le journal d'audit (`journal_audit` en base).

## Déploiement pour un usage en réseau (plusieurs postes)

Le serveur actuel écoute sur toutes les interfaces réseau. Pour que d'autres
ordinateurs du commissariat y accèdent :

1. Trouvez l'adresse IP locale du poste qui fait tourner le serveur (ex. `192.168.1.50`)
2. Sur les autres postes, ouvrez `http://192.168.1.50:3000` dans le navigateur
3. Assurez-vous que le pare-feu autorise le port 3000 sur le réseau local

**Pour un accès depuis internet (plusieurs commissariats)**, il faut impérativement :
- Mettre le serveur derrière **HTTPS** (certificat SSL, via un reverse proxy comme
  Nginx ou Caddy) — **ceci est aussi nécessaire pour que la géolocalisation et la
  caméra (position GPS, partage de position, partage de caméra/micro) fonctionnent
  en dehors de `localhost`**, les navigateurs l'exigent pour des raisons de sécurité
- Passer `NODE_ENV=production` dans `.env` (active les cookies sécurisés)
- Envisager une base de données plus robuste que SQLite si le volume est important
  (PostgreSQL, par exemple)
- Mettre en place des sauvegardes régulières du fichier `db/pn.db`

Ces points de déploiement réseau/serveur sortent du cadre de ce que je peux tester
directement ici : je recommande de faire appel à un administrateur système ou à moi
à nouveau une fois que vous avez un serveur/hébergement choisi, pour configurer cela
ensemble étape par étape.

## Sauvegardes

Le fichier `db/donnees.json` contient **toutes** les données. Sauvegardez-le
régulièrement (copie sur clé USB, disque externe, ou service de sauvegarde
automatisé). Le dossier `uploads/avis/` contient les photos et doit être
sauvegardé de la même façon.

## Structure du projet

```
pn-system/
  server.js              → point d'entrée du serveur
  db/
    store.js               → base de données JSON + création du compte admin
    init.js                 → point d'entrée de "npm run init-db"
    donnees.json             → fichier de base de données (créé après npm run init-db)
  middleware/
    auth.js                → vérification de connexion et des rôles
    validation.js          → nettoyage des entrées utilisateur
  routes/
    auth.js                → connexion, déconnexion, gestion des comptes
    affaires.js             → API des affaires
    avis.js                 → API des avis de recherche (+ upload photo)
    objets.js               → API des objets volés
    statistiques.js         → API du tableau de bord
  public/
    login.html              → page de connexion
    index.html               → application principale
    css/style.css
    js/app.js
  uploads/avis/             → photos des avis de recherche
```

## Limites connues de cette version

- Pas de recherche avancée par plage de dates ou par officier assigné pour les
  avis de recherche et objets volés (seulement pour les affaires)
- Pas de gestion de pièces jointes autres que la photo des avis de recherche
- La base en fichier JSON convient bien pour un seul commissariat avec un usage
  modéré ; pour plusieurs sites avec beaucoup d'utilisateurs simultanés ou de
  gros volumes de données, une vraie base de données (PostgreSQL, par exemple)
  serait préférable à terme
- La caméra en direct utilise un serveur public gratuit pour aider les deux
  navigateurs à se trouver sur le réseau (STUN). Dans la grande majorité des cas
  ça suffit, mais sur certains réseaux très restrictifs (pare-feu d'entreprise
  strict, double NAT), la connexion peut échouer ; la solution dans ce cas est un
  serveur TURN relais, qui n'est pas inclus dans cette version

- Le calcul d'itinéraire utilise un serveur de démonstration public gratuit
  (OSRM). Il fonctionne bien pour un usage modéré, mais n'est pas garanti en
  disponibilité ni en vitesse ; pour un usage intensif ou en production, il
  faudrait héberger son propre serveur OSRM
- L'import GeoJSON ne crée des zones qu'à partir des polygones du fichier ; les
  points et lignes du fichier importé sont ignorés
- **La reconnaissance faciale n'est jamais fiable à 100 %** : elle peut manquer
  une vraie correspondance ou en proposer une fausse, et sa fiabilité peut
  varier selon les personnes. Elle doit toujours servir de piste à vérifier
  manuellement, jamais de preuve automatique — c'est pour cette raison qu'elle
  n'affiche que des "correspondances possibles" avec un niveau de ressemblance,
  jamais une identification confirmée
- **La détection de mouvement ne fonctionne pas sur les caméras IP en MJPEG**
  (seulement sur les caméras d'agents partagées via l'interrupteur) : le
  navigateur bloque par sécurité la lecture des images provenant d'un autre
  appareil sans autorisation particulière (CORS), ce qui n'est généralement
  pas configuré sur les applications type "caméra IP" pour téléphone

Dites-moi lesquelles de ces limites vous voulez que je traite en priorité.
