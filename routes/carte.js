// routes/carte.js
// Rassemble en un seul appel tous les elements geolocalises (affaires, avis
// de recherche, objets voles, postes, cameras IP) pour la carte interactive.
// Fournit aussi la recherche spatiale (rayon) et l'export/import GeoJSON/KML.
const express = require("express");
const router = express.Router();
const { donnees, sauvegarder, idSuivant } = require("../db/store");
const { exigerConnexion } = require("../middleware/auth");
const { distanceKm } = require("../middleware/geo");

function obtenirTousLesPoints() {
  const postes = donnees.postes
    .filter((p) => p.latitude !== null && p.latitude !== undefined && p.longitude !== null && p.longitude !== undefined)
    .map((p) => ({
      id: p.id, type: "poste", latitude: p.latitude, longitude: p.longitude,
      titre: p.nom, detail: p.ville || "", statut: p.actif ? "actif" : "desactive"
    }));

  const affaires = donnees.affaires
    .filter((a) => a.latitude !== null && a.latitude !== undefined && a.longitude !== null && a.longitude !== undefined)
    .map((a) => ({
      id: a.id, type: "affaire", latitude: a.latitude, longitude: a.longitude,
      titre: a.titre, detail: a.numero_dossier, statut: a.statut
    }));

  const avis = donnees.avis_recherche
    .filter((v) => v.latitude !== null && v.latitude !== undefined && v.longitude !== null && v.longitude !== undefined)
    .map((v) => ({
      id: v.id, type: "avis", latitude: v.latitude, longitude: v.longitude,
      titre: v.nom, detail: v.localisation_signalement || "", statut: v.statut
    }));

  const objets = donnees.objets_voles
    .filter((o) => o.latitude !== null && o.latitude !== undefined && o.longitude !== null && o.longitude !== undefined)
    .map((o) => ({
      id: o.id, type: "objet", latitude: o.latitude, longitude: o.longitude,
      titre: o.type_objet, detail: o.lieu_vol || "", statut: o.statut
    }));

  const camerasIp = donnees.cameras_ip
    .filter((c) => c.latitude !== null && c.latitude !== undefined && c.longitude !== null && c.longitude !== undefined)
    .map((c) => ({
      id: c.id, type: "camera_ip", latitude: c.latitude, longitude: c.longitude,
      titre: c.nom, detail: c.type.toUpperCase(), statut: c.actif ? "actif" : "desactive"
    }));

  return [...postes, ...affaires, ...avis, ...objets, ...camerasIp];
}

router.get("/", exigerConnexion, (req, res) => {
  res.json({ points: obtenirTousLesPoints() });
});

// --- Recherche spatiale : tous les points dans un rayon (km) autour d'un point donne ---
router.get("/recherche", exigerConnexion, (req, res) => {
  const latitude = parseFloat(req.query.latitude);
  const longitude = parseFloat(req.query.longitude);
  const rayonKm = req.query.rayonKm ? parseFloat(req.query.rayonKm) : 5;
  const typesAutorises = req.query.types ? req.query.types.split(",") : null;

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ erreur: "Coordonnees invalides." });
  }

  const points = obtenirTousLesPoints()
    .filter((p) => !typesAutorises || typesAutorises.includes(p.type))
    .map((p) => ({ ...p, distanceKm: Math.round(distanceKm(latitude, longitude, p.latitude, p.longitude) * 10) / 10 }))
    .filter((p) => p.distanceKm <= rayonKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  res.json({ points });
});

// --- Export de tous les points au format GeoJSON ou KML ---
router.get("/export", exigerConnexion, (req, res) => {
  const format = req.query.format === "kml" ? "kml" : "geojson";
  const points = obtenirTousLesPoints();

  if (format === "geojson") {
    const featureCollection = {
      type: "FeatureCollection",
      features: points.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
        properties: { type: p.type, titre: p.titre, detail: p.detail, statut: p.statut }
      }))
    };
    res.setHeader("Content-Disposition", "attachment; filename=export-carte.geojson");
    return res.json(featureCollection);
  }

  // KML
  const echapperXml = (t) => String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const placemarks = points.map((p) => `
    <Placemark>
      <name>${echapperXml(p.titre)}</name>
      <description>${echapperXml(p.type)} — ${echapperXml(p.detail)} — ${echapperXml(p.statut)}</description>
      <Point><coordinates>${p.longitude},${p.latitude},0</coordinates></Point>
    </Placemark>`).join("");
  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${placemarks}</Document></kml>`;

  res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
  res.setHeader("Content-Disposition", "attachment; filename=export-carte.kml");
  res.send(kml);
});

// --- Import GeoJSON : les polygones deviennent des zones/secteurs ---
router.post("/import", exigerConnexion, (req, res) => {
  const geojson = req.body;
  if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
    return res.status(400).json({ erreur: "Fichier GeoJSON invalide (FeatureCollection attendue)." });
  }

  let zonesCreees = 0;
  geojson.features.forEach((feature) => {
    if (!feature.geometry || feature.geometry.type !== "Polygon") return; // seuls les polygones sont importes comme zones
    const anneau = feature.geometry.coordinates[0]; // premier anneau du polygone
    if (!Array.isArray(anneau) || anneau.length < 3) return;

    donnees.zones.push({
      id: idSuivant("zones"),
      nom: (feature.properties && (feature.properties.nom || feature.properties.name)) || "Zone importée " + (zonesCreees + 1),
      type: "polygone",
      couleur: "#7fb4dd",
      points: anneau.map(([lng, lat]) => ({ lat, lng })),
      poste_id: null,
      cree_par: req.session.utilisateur.id,
      date_creation: new Date().toISOString()
    });
    zonesCreees++;
  });

  sauvegarder();
  res.json({ succes: true, zonesCreees });
});

module.exports = router;
