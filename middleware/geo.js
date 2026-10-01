// middleware/geo.js
// Petites fonctions geographiques partagees : distance entre deux points,
// et test "un point est-il a l'interieur d'une zone dessinee".

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Algorithme du "ray casting" : suffisant pour de petites zones locales
// (pas geodesiquement parfait sur de tres grandes distances, ce qui convient
// bien a des secteurs de patrouille ou de commissariat).
function pointDansPolygone(lat, lng, points) {
  let dedans = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng, yi = points[i].lat;
    const xj = points[j].lng, yj = points[j].lat;
    const intersecte = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi + 0.0000001) + xi);
    if (intersecte) dedans = !dedans;
  }
  return dedans;
}

function pointDansZone(lat, lng, zone) {
  if (zone.type === "cercle" && zone.centre) {
    return distanceKm(lat, lng, zone.centre.lat, zone.centre.lng) * 1000 <= zone.rayonMetres;
  }
  if (Array.isArray(zone.points) && zone.points.length >= 3) {
    return pointDansPolygone(lat, lng, zone.points);
  }
  return false;
}

module.exports = { distanceKm, pointDansPolygone, pointDansZone };
