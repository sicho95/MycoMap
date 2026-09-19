import type { LatLng } from './domain';

const ADMIN_COMMUNE_URL = 'https://geo.api.gouv.fr/communes';
const GEOPF_REVERSE_URL = 'https://data.geopf.fr/geocodage/reverse';

async function fetchJson(url: URL, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function municipalityFromGeoApi(payload: any): string | null {
  const rows = Array.isArray(payload) ? payload : [];
  const name = rows[0]?.nom;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

function municipalityFromGeopf(payload: any): string | null {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const city = props.city ?? props.municipality ?? props.commune ?? props.name;
    if (typeof city === 'string' && city.trim()) return city.trim();
  }
  return null;
}

export async function fetchMunicipality(point: LatLng): Promise<string | null> {
  // Source primaire : API Découpage administratif.
  // La recherche lat/lon retourne la commune administrative contenant réellement le point.
  try {
    const url = new URL(ADMIN_COMMUNE_URL);
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('fields', 'nom,code');
    url.searchParams.set('format', 'json');
    const municipality = municipalityFromGeoApi(await fetchJson(url));
    if (municipality) return municipality;
  } catch {
    // Fallback Géoplateforme ci-dessous.
  }

  // Fallback 1 : commune portée par l'adresse la plus proche.
  try {
    const url = new URL(GEOPF_REVERSE_URL);
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('index', 'address');
    url.searchParams.set('limit', '1');
    const municipality = municipalityFromGeopf(await fetchJson(url));
    if (municipality) return municipality;
  } catch {
    // Fallback POI administratif ci-dessous.
  }

  // Fallback 2 : POI administratif dans un cercle très local.
  try {
    const url = new URL(GEOPF_REVERSE_URL);
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('index', 'poi');
    url.searchParams.set('category', 'commune');
    url.searchParams.set('searchgeom', JSON.stringify({
      type: 'Circle',
      coordinates: [point.lon, point.lat],
      radius: 100
    }));
    url.searchParams.set('limit', '1');
    return municipalityFromGeopf(await fetchJson(url));
  } catch {
    return null;
  }
}
