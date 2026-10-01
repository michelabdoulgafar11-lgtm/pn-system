// db/init.js
// Point d'entree pour "npm run init-db". Le simple fait d'importer store.js
// declenche la creation du fichier de donnees et du compte admin par defaut
// s'ils n'existent pas encore (voir db/store.js).
require("./store");
console.log("Base de donnees prete (db/donnees.json).");
