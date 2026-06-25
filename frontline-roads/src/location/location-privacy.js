const EARTH_RADIUS_METERS = 6371000;
const RAD = Math.PI / 180;

export function latLonToXY(lat, lon, center) {
  return {
    x: (lon - center.lon) * RAD * EARTH_RADIUS_METERS * Math.cos(center.lat * RAD),
    y: -(lat - center.lat) * RAD * EARTH_RADIUS_METERS
  };
}

export function xyToLatLon(x, y, center) {
  return {
    lat: center.lat - y / (RAD * EARTH_RADIUS_METERS),
    lon: center.lon + x / (RAD * EARTH_RADIUS_METERS * Math.cos(center.lat * RAD))
  };
}

export function haversineMeters(a, b) {
  const lat1 = a.lat * RAD;
  const lat2 = b.lat * RAD;
  const deltaLat = (b.lat - a.lat) * RAD;
  const deltaLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function roundPublicLocation(location, decimals = 3) {
  const factor = 10 ** decimals;
  return {
    lat: Math.round(location.lat * factor) / factor,
    lon: Math.round(location.lon * factor) / factor
  };
}
