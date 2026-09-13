import type { ForestZone, LatLng } from './domain';

function zoneCenter(element: any): LatLng | null {
  const lat = element.center?.lat ?? element.lat;
  const lon = element.center?.lon ?? element.lon;
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function fetchElevations(points: LatLng[]) {
  const result: Array<number | null> = [];
  for (let offset = 0; offset < points.length; offset += 100) {
    const chunk = points.slice(offset, offset + 100);
    const params = new URLSearchParams({
      latitude: chunk.map((p) => p.lat.toFixed(5)).join(','),
      longitude: chunk.map((p) => p.lon.toFixed(5)).join(',')
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/elevation?${params}`);
      if (!response.ok) throw new Error();
      const data = await response.json();
      result.push(...(data.elevation as number[]).map((value) => Number.isFinite(value) ? value : null));
    } catch {
      result.push(...chunk.map(() => null));
    }
  }
  return result;
}

async function queryOverpass(query: string) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`
      });
      if (response.ok) return await response.json();
    } catch {
      // Try the next public endpoint.
    }
  }
  return null;
}

export async function fetchForestZones(center: LatLng, radiusMeters = 25000): Promise<ForestZone[]> {
  const query = `[out:json][timeout:20];(way(around:${radiusMeters},${center.lat},${center.lon})["natural"="wood"];relation(around:${radiusMeters},${center.lat},${center.lon})["natural"="wood"];way(around:${radiusMeters},${center.lat},${center.lon})["landuse"="forest"];relation(around:${radiusMeters},${center.lat},${center.lon})["landuse"="forest"];way(around:${radiusMeters},${center.lat},${center.lon})["landuse"="orchard"];);out center tags 180;`;
  const payload = await queryOverpass(query);

  if (!payload?.elements?.length) {
    return [{ id: 'fallback', lat: center.lat, lon: center.lon, name: 'Zone autour de moi', tags: {}, elevation: null }];
  }

  const seen = new Set<string>();
  const raw = payload.elements
    .map((element: any) => ({ element, point: zoneCenter(element) }))
    .filter((item: any) => item.point)
    .filter((item: any) => {
      const key = `${item.point.lat.toFixed(3)}:${item.point.lon.toFixed(3)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 160);

  const elevations = await fetchElevations(raw.map((item: any) => item.point));
  return raw.map((item: any, index: number) => ({
    id: `${item.element.type}-${item.element.id}`,
    lat: item.point.lat,
    lon: item.point.lon,
    name: item.element.tags?.name ?? item.element.tags?.['name:fr'] ?? 'Zone forestière',
    tags: item.element.tags ?? {},
    elevation: elevations[index] ?? null
  }));
}
