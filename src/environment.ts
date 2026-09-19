import type { ForestGeometry, ForestZone, LatLng } from './domain';
import { enrichZonesWithSoil } from './soil';
import { getCachedEnvironmentProfiles, putCachedEnvironmentProfiles } from './offline';

const IGN_WFS = 'https://data.geopf.fr/wfs/ows';
const IGN_ALTI = 'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json';
const FOREST_LAYER = 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale';
const ALTI_RESOURCE = 'ign_rge_alti_wld';
const MAX_WFS_FEATURES = 1800;
const MAX_ANALYSED_ZONES = 280;
const TERRAIN_SAMPLE_METERS = 80;

type WfsVariant = {
  srsName: string;
  bbox: (bbox: ReturnType<typeof bboxAround>) => string;
};

function distanceMeters(a: LatLng, b: LatLng) {
  const r = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

async function fetchJson(url: string, timeoutMs = 14000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timer);
  }
}

function prop(properties: Record<string, unknown>, ...names: string[]) {
  for (const name of names) {
    const value = properties[name] ?? properties[name.toLowerCase()] ?? properties[name.toUpperCase()];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function polygonArea(ring: number[][]) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

function ringCentroid(ring: number[][]): LatLng | null {
  if (ring.length < 3) return null;
  let areaAccumulator = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    areaAccumulator += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(areaAccumulator) < 1e-10) {
    const usable = ring.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
    if (!usable.length) return null;
    return {
      lon: usable.reduce((sum, point) => sum + point[0], 0) / usable.length,
      lat: usable.reduce((sum, point) => sum + point[1], 0) / usable.length
    };
  }
  const factor = 1 / (3 * areaAccumulator);
  return { lon: cx * factor, lat: cy * factor };
}

function toForestGeometry(geometry: any): ForestGeometry | undefined {
  if (geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)) {
    return { type: 'Polygon', coordinates: geometry.coordinates };
  }
  if (geometry?.type === 'MultiPolygon' && Array.isArray(geometry.coordinates)) {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates };
  }
  return undefined;
}

function representativePoint(geometry: ForestGeometry): LatLng | null {
  if (geometry.type === 'Polygon') return ringCentroid(geometry.coordinates[0] ?? []);
  const rings = geometry.coordinates
    .map((polygon) => polygon[0])
    .filter((ring): ring is number[][] => Array.isArray(ring));
  if (!rings.length) return null;
  const largest = rings.reduce((best, ring) => Math.abs(polygonArea(ring)) > Math.abs(polygonArea(best)) ? ring : best, rings[0]);
  return ringCentroid(largest);
}

function swapGeometryAxes(geometry: ForestGeometry): ForestGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => ring.map(([x, y]) => [y, x]))
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: geometry.coordinates.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [y, x])))
  };
}

function normalizeGeometryForCenter(geometry: ForestGeometry, center: LatLng) {
  const point = representativePoint(geometry);
  const swappedGeometry = swapGeometryAxes(geometry);
  const swappedPoint = representativePoint(swappedGeometry);
  if (!point) return swappedPoint ? { geometry: swappedGeometry, point: swappedPoint } : null;
  if (!swappedPoint) return { geometry, point };
  return distanceMeters(center, swappedPoint) < distanceMeters(center, point)
    ? { geometry: swappedGeometry, point: swappedPoint }
    : { geometry, point };
}

function pointInRing(point: LatLng, ring: number[][]) {
  let inside = false;
  const x = point.lon;
  const y = point.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]?.[0];
    const yi = ring[i]?.[1];
    const xj = ring[j]?.[0];
    const yj = ring[j]?.[1];
    if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point: LatLng, geometry: ForestGeometry) {
  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates;
    if (!outer || !pointInRing(point, outer)) return false;
    return !holes.some((ring) => pointInRing(point, ring));
  }
  return geometry.coordinates.some((polygon) => {
    const [outer, ...holes] = polygon;
    if (!outer || !pointInRing(point, outer)) return false;
    return !holes.some((ring) => pointInRing(point, ring));
  });
}

function forestZoneFromFeature(feature: any, center: LatLng): ForestZone | null {
  const rawGeometry = toForestGeometry(feature.geometry);
  if (!rawGeometry) return null;
  const normalized = normalizeGeometryForCenter(rawGeometry, center);
  if (!normalized) return null;
  const { geometry, point } = normalized;
  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const forestCode = prop(properties, 'CODE_TFV');
  const forestType = prop(properties, 'TFV', 'TFV_G11');
  const essence = prop(properties, 'ESSENCE');
  const id = prop(properties, 'ID') || String(feature.id ?? `${forestCode}-${point.lat}-${point.lon}`);
  return {
    id,
    lat: point.lat,
    lon: point.lon,
    name: forestType || essence || 'Formation végétale IGN',
    tags: {
      code_tfv: forestCode,
      tfv: forestType,
      essence,
      tfv_g11: prop(properties, 'TFV_G11')
    },
    geometry,
    elevation: null,
    slope: null,
    aspect: null,
    forestCode,
    forestType,
    essence,
    source: 'IGN BD Forêt v2'
  };
}

function bboxAround(center: LatLng, radiusMeters: number) {
  const latDelta = radiusMeters / 111320;
  const lonDelta = radiusMeters / (111320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  return {
    west: center.lon - lonDelta,
    south: center.lat - latDelta,
    east: center.lon + lonDelta,
    north: center.lat + latDelta
  };
}

async function fetchIgnForestPage(variant: WfsVariant, bbox: ReturnType<typeof bboxAround>, startIndex: number) {
  const params = new URLSearchParams({
    SERVICE: 'WFS',
    VERSION: '2.0.0',
    REQUEST: 'GetFeature',
    TYPENAMES: FOREST_LAYER,
    SRSNAME: variant.srsName,
    BBOX: variant.bbox(bbox),
    OUTPUTFORMAT: 'application/json',
    COUNT: '600',
    STARTINDEX: String(startIndex)
  });
  const payload = await fetchJson(`${IGN_WFS}?${params}`);
  return Array.isArray(payload?.features) ? payload.features as any[] : [];
}

async function fetchIgnForestFeatures(center: LatLng, radiusMeters: number) {
  const bbox = bboxAround(center, radiusMeters);
  const variants: WfsVariant[] = [
    {
      srsName: 'CRS:84',
      bbox: (box) => `${box.west},${box.south},${box.east},${box.north},CRS:84`
    },
    {
      srsName: 'urn:ogc:def:crs:OGC::CRS84',
      bbox: (box) => `${box.west},${box.south},${box.east},${box.north},urn:ogc:def:crs:OGC::CRS84`
    },
    {
      srsName: 'EPSG:4326',
      bbox: (box) => `${box.south},${box.west},${box.north},${box.east},urn:ogc:def:crs:EPSG::4326`
    },
    {
      srsName: 'EPSG:4326',
      bbox: (box) => `${box.west},${box.south},${box.east},${box.north},EPSG:4326`
    }
  ];

  let lastError: unknown = null;
  for (const variant of variants) {
    try {
      const features: any[] = [];
      for (let startIndex = 0; startIndex < MAX_WFS_FEATURES; startIndex += 600) {
        const page = await fetchIgnForestPage(variant, bbox, startIndex);
        features.push(...page);
        if (page.length < 600) break;
      }
      if (features.length) return features;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

function offsetPoint(point: LatLng, northMeters: number, eastMeters: number): LatLng {
  const lat = point.lat + northMeters / 111320;
  const lon = point.lon + eastMeters / (111320 * Math.max(0.2, Math.cos(point.lat * Math.PI / 180)));
  return { lat, lon };
}

async function fetchIgnElevations(points: LatLng[]) {
  const result: Array<number | null> = [];
  for (let offset = 0; offset < points.length; offset += 70) {
    const chunk = points.slice(offset, offset + 70);
    const params = new URLSearchParams({
      lon: chunk.map((point) => point.lon.toFixed(6)).join('|'),
      lat: chunk.map((point) => point.lat.toFixed(6)).join('|'),
      resource: ALTI_RESOURCE,
      delimiter: '|',
      indent: 'false',
      measures: 'false',
      zonly: 'false'
    });
    try {
      const payload = await fetchJson(`${IGN_ALTI}?${params}`);
      const values = Array.isArray(payload?.elevations) ? payload.elevations : [];
      for (let index = 0; index < chunk.length; index += 1) {
        const z = Number(values[index]?.z);
        result.push(Number.isFinite(z) && z > -90000 ? z : null);
      }
    } catch {
      result.push(...chunk.map(() => null));
    }
  }
  return result;
}

function terrainFromSamples(samples: Array<number | null>) {
  const [center, north, south, east, west] = samples;
  if ([north, south, east, west].some((value) => value == null)) {
    return { elevation: center ?? null, slope: null, aspect: null };
  }
  const dzdx = ((east as number) - (west as number)) / (2 * TERRAIN_SAMPLE_METERS);
  const dzdy = ((north as number) - (south as number)) / (2 * TERRAIN_SAMPLE_METERS);
  const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI;
  if (slope < 1.2) return { elevation: center ?? null, slope, aspect: null };
  const aspect = (Math.atan2(-dzdx, -dzdy) * 180 / Math.PI + 360) % 360;
  return { elevation: center ?? null, slope, aspect };
}

export async function fetchForestZones(center: LatLng, radiusMeters = 25000): Promise<ForestZone[]> {
  let features: any[];
  try {
    features = await fetchIgnForestFeatures(center, radiusMeters);
  } catch {
    throw new Error('BD Forêt IGN indisponible pour le moment');
  }

  const parsed = features
    .map((feature) => {
      const zone = forestZoneFromFeature(feature, center);
      if (!zone) return null;
      const distance = distanceMeters(center, zone);
      if (distance > radiusMeters * 1.18) return null;
      return { ...zone, distance };
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_ANALYSED_ZONES);

  if (!parsed.length) {
    throw new Error('BD Forêt IGN : aucune parcelle exploitable retournée pour cette zone');
  }

  const cleanParsed: ForestZone[] = parsed.map((zone) => {
    const { distance: _distance, ...clean } = zone;
    return clean;
  });

  const cachedProfiles = await getCachedEnvironmentProfiles(cleanParsed);
  const missingZones = cleanParsed.filter((zone) => !cachedProfiles.has(zone.id));

  let freshProfiles = new Map<string, ForestZone>();
  if (missingZones.length) {
    const terrainPoints = missingZones.flatMap((zone) => [
      { lat: zone.lat, lon: zone.lon },
      offsetPoint(zone, TERRAIN_SAMPLE_METERS, 0),
      offsetPoint(zone, -TERRAIN_SAMPLE_METERS, 0),
      offsetPoint(zone, 0, TERRAIN_SAMPLE_METERS),
      offsetPoint(zone, 0, -TERRAIN_SAMPLE_METERS)
    ]);
    const elevations = await fetchIgnElevations(terrainPoints);

    const terrainZones: ForestZone[] = missingZones.map((zone, index) => {
      const terrain = terrainFromSamples(elevations.slice(index * 5, index * 5 + 5));
      return { ...zone, ...terrain };
    });

    const enriched = await enrichZonesWithSoil(terrainZones);
    await putCachedEnvironmentProfiles(enriched);
    freshProfiles = new Map(enriched.map((zone) => [zone.id, zone] as const));
  }

  return cleanParsed.map((zone) => {
    const cached = cachedProfiles.get(zone.id);
    if (cached) return { ...zone, ...cached };
    return freshProfiles.get(zone.id) ?? zone;
  });
}

export async function fetchForestZoneAtPoint(point: LatLng): Promise<ForestZone | null> {
  let features: any[];
  try {
    // BBOX très local : on cherche uniquement la ou les géométries IGN qui coupent le sélecteur.
    features = await fetchIgnForestFeatures(point, 220);
  } catch {
    throw new Error('BD Forêt IGN indisponible pour le moment');
  }

  const matching = features
    .map((feature) => forestZoneFromFeature(feature, point))
    .filter((zone): zone is ForestZone => zone != null && !!zone.geometry)
    .find((zone) => zone.geometry ? pointInGeometry(point, zone.geometry) : false);

  if (!matching) return null;

  const cachedProfiles = await getCachedEnvironmentProfiles([matching]);
  const cached = cachedProfiles.get(matching.id);
  if (cached) return { ...matching, ...cached };

  const terrainPoints = [
    { lat: matching.lat, lon: matching.lon },
    offsetPoint(matching, TERRAIN_SAMPLE_METERS, 0),
    offsetPoint(matching, -TERRAIN_SAMPLE_METERS, 0),
    offsetPoint(matching, 0, TERRAIN_SAMPLE_METERS),
    offsetPoint(matching, 0, -TERRAIN_SAMPLE_METERS)
  ];
  const elevations = await fetchIgnElevations(terrainPoints);
  const terrainZone = { ...matching, ...terrainFromSamples(elevations) };
  const [enriched] = await enrichZonesWithSoil([terrainZone]);
  const result = enriched ?? terrainZone;
  await putCachedEnvironmentProfiles([result]);
  return result;
}
