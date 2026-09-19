import type { LatLng } from './domain';

const REVERSE_URL = 'https://data.geopf.fr/geocodage/reverse';

function municipalityFromPayload(payload: any): string | null {
  const features = Array.isArray(payload?.features) ? payload.features : [];
  for (const feature of features) {
    const props = feature?.properties ?? {};
    const city = props.city ?? props.municipality ?? props.commune ?? props.name;
    if (typeof city === 'string' && city.trim()) return city.trim();
  }
  return null;
}

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

export async function fetchMunicipality(point: LatLng): Promise<string | null> {
  // 1) Une adresse proche fournit généralement directement la commune.
  try {
    const url = new URL(REVERSE_URL);
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('index', 'address');
    url.searchParams.set('limit', '1');
    const municipality = municipalityFromPayload(await fetchJson(url));
    if (municipality) return municipality;
  } catch {
    // Les secteurs forestiers n'ont pas toujours d'adresse proche : fallback administratif ci-dessous.
  }

  // 2) Fallback précis sur le POI "commune", rayon volontairement minuscule pour éviter
  // de retourner la commune voisine lorsque le point est proche d'une limite administrative.
  try {
    const url = new URL(REVERSE_URL);
    const searchgeom = {
      type: 'Circle',
      coordinates: [point.lon, point.lat],
      radius: 1
    };
    url.searchParams.set('lat', point.lat.toFixed(6));
    url.searchParams.set('lon', point.lon.toFixed(6));
    url.searchParams.set('index', 'poi');
    url.searchParams.set('category', 'commune');
    url.searchParams.set('searchgeom', JSON.stringify(searchgeom));
    url.searchParams.set('limit', '1');
    return municipalityFromPayload(await fetchJson(url));
  } catch {
    return null;
  }
}
