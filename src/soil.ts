import { fromArrayBuffer } from 'geotiff';
import type { ForestZone, LatLng, SoilProfile, SoilTextureClass, DrainageClass } from './domain';

const SOILGRIDS_WCS = 'https://maps.isric.org/mapserv';
const DEPTH = '0-5cm';
const TIMEOUT_MS = 22000;

type SoilKey = 'phh2o' | 'clay' | 'sand' | 'silt' | 'cfvo' | 'wv0033' | 'wv1500';

type SoilRaster = {
  key: SoilKey;
  data: ArrayLike<number>;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  noData: number | null;
};

const PROPERTY_SCALE: Record<SoilKey, number> = {
  phh2o: 10,
  clay: 10,
  sand: 10,
  silt: 10,
  cfvo: 10,
  wv0033: 10,
  wv1500: 10
};

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function bboxAround(center: LatLng, radiusMeters: number) {
  const padding = 1200;
  const radius = radiusMeters + padding;
  const latDelta = radius / 111320;
  const lonDelta = radius / (111320 * Math.max(0.2, Math.cos(center.lat * Math.PI / 180)));
  return {
    west: center.lon - lonDelta,
    south: center.lat - latDelta,
    east: center.lon + lonDelta,
    north: center.lat + latDelta
  };
}

function coverageId(key: SoilKey) {
  return `${key}_${DEPTH}_mean`;
}

async function fetchCoverage(key: SoilKey, bbox: ReturnType<typeof bboxAround>): Promise<SoilRaster> {
  const params = new URLSearchParams({
    map: `/map/${key}.map`,
    SERVICE: 'WCS',
    VERSION: '2.0.1',
    REQUEST: 'GetCoverage',
    COVERAGEID: coverageId(key),
    FORMAT: 'image/tiff',
    SUBSETTINGCRS: 'http://www.opengis.net/def/crs/EPSG/0/4326',
    OUTPUTCRS: 'http://www.opengis.net/def/crs/EPSG/0/4326'
  });
  params.append('SUBSET', `long(${bbox.west.toFixed(6)},${bbox.east.toFixed(6)})`);
  params.append('SUBSET', `lat(${bbox.south.toFixed(6)},${bbox.north.toFixed(6)})`);

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${SOILGRIDS_WCS}?${params}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`SoilGrids ${key}: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('tiff') && !contentType.includes('octet-stream')) {
      throw new Error(`SoilGrids ${key}: réponse WCS inattendue`);
    }
    const buffer = await response.arrayBuffer();
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const values = await image.readRasters({ interleave: true });
    const rawBbox = image.getBoundingBox();
    const noDataRaw = image.getGDALNoData();
    return {
      key,
      data: values as ArrayLike<number>,
      width: image.getWidth(),
      height: image.getHeight(),
      bbox: [rawBbox[0], rawBbox[1], rawBbox[2], rawBbox[3]],
      noData: noDataRaw == null ? null : Number(noDataRaw)
    };
  } finally {
    window.clearTimeout(timer);
  }
}

function validateScaledValue(key: SoilKey, value: number): number | null {
  if (!Number.isFinite(value)) return null;
  if (key === 'phh2o') return value >= 2 && value <= 14 ? value : null;
  if (key === 'clay' || key === 'sand' || key === 'silt' || key === 'cfvo') {
    return value >= 0 && value <= 100 ? value : null;
  }
  if (key === 'wv0033' || key === 'wv1500') return value >= 0 && value <= 100 ? value : null;
  return null;
}

function sampleRaster(raster: SoilRaster, point: LatLng): number | null {
  const [minX, minY, maxX, maxY] = raster.bbox;
  if (point.lon < minX || point.lon > maxX || point.lat < minY || point.lat > maxY) return null;
  const xRatio = (point.lon - minX) / Math.max(1e-12, maxX - minX);
  const yRatio = (maxY - point.lat) / Math.max(1e-12, maxY - minY);
  const x = Math.min(raster.width - 1, Math.max(0, Math.floor(xRatio * raster.width)));
  const y = Math.min(raster.height - 1, Math.max(0, Math.floor(yRatio * raster.height)));
  const raw = Number(raster.data[y * raster.width + x]);
  if (!Number.isFinite(raw)) return null;
  if (raster.noData != null && raw === raster.noData) return null;
  if (raw <= -30000) return null;
  return validateScaledValue(raster.key, raw / PROPERTY_SCALE[raster.key]);
}

function classifyTexture(sand: number | null, silt: number | null, clay: number | null): SoilTextureClass {
  if (sand == null || silt == null || clay == null) return 'inconnu';
  if (clay >= 40) return 'argileux';
  if (clay >= 27 && silt >= 40) return 'argilo-limoneux';
  if (clay >= 27) return 'limono-argileux';
  if (sand >= 70 && clay < 15) return 'sableux';
  if (sand >= 50 && clay < 20) return 'sablo-limoneux';
  if (silt >= 50 && clay < 27) return 'limoneux';
  if (clay >= 20) return 'limono-argileux';
  return 'équilibré';
}

function estimateDrainage(
  sand: number | null,
  clay: number | null,
  coarse: number | null,
  availableWater: number | null
): { index: number | null; label: DrainageClass } {
  if (sand == null || clay == null) return { index: null, label: 'inconnu' };
  const coarseValue = coarse ?? 12;
  const waterValue = availableWater ?? 12;
  const index = clamp(45 + sand * 0.48 + coarseValue * 0.28 - clay * 0.62 - waterValue * 0.35);
  const label: DrainageClass = index >= 78
    ? 'très drainant'
    : index >= 62
      ? 'drainant'
      : index >= 43
        ? 'équilibré'
        : index >= 26
          ? 'lent'
          : 'très lent';
  return { index: Math.round(index), label };
}

function makeProfile(point: LatLng, rasters: Map<SoilKey, SoilRaster>): SoilProfile | undefined {
  const get = (key: SoilKey) => {
    const raster = rasters.get(key);
    return raster ? sampleRaster(raster, point) : null;
  };

  const ph = get('phh2o');
  let clay = get('clay');
  let sand = get('sand');
  let silt = get('silt');
  const coarse = get('cfvo');
  const fieldCapacity = get('wv0033');
  const wilting = get('wv1500');

  // Un triplet 0/0/0 (ou très loin de 100 %) correspond à une cellule invalide/no-data,
  // pas à un vrai sol. On l'écarte au lieu de fabriquer une texture "équilibrée".
  if (clay != null && sand != null && silt != null) {
    const mineralSum = clay + sand + silt;
    if (mineralSum < 70 || mineralSum > 130) {
      clay = null;
      sand = null;
      silt = null;
    }
  }

  const availableWater = fieldCapacity != null && wilting != null && fieldCapacity >= wilting
    ? fieldCapacity - wilting
    : null;

  if (ph == null && clay == null && sand == null && silt == null) return undefined;

  const drainage = estimateDrainage(sand, clay, coarse, availableWater);
  return {
    ph: ph == null ? null : Math.round(ph * 10) / 10,
    clayPct: clay == null ? null : Math.round(clay * 10) / 10,
    sandPct: sand == null ? null : Math.round(sand * 10) / 10,
    siltPct: silt == null ? null : Math.round(silt * 10) / 10,
    coarseFragmentsPct: coarse == null ? null : Math.round(coarse * 10) / 10,
    fieldCapacityPct: fieldCapacity == null ? null : Math.round(fieldCapacity * 10) / 10,
    wiltingPointPct: wilting == null ? null : Math.round(wilting * 10) / 10,
    availableWaterPct: availableWater == null ? null : Math.round(availableWater * 10) / 10,
    textureClass: classifyTexture(sand, silt, clay),
    drainageClass: drainage.label,
    drainageIndex: drainage.index,
    depth: DEPTH,
    resolutionMeters: 250,
    source: 'SoilGrids 2.0 / ISRIC'
  };
}

export async function enrichZonesWithSoil(zones: ForestZone[], center: LatLng, radiusMeters: number): Promise<ForestZone[]> {
  const bbox = bboxAround(center, radiusMeters);
  const keys: SoilKey[] = ['phh2o', 'clay', 'sand', 'silt', 'cfvo', 'wv0033', 'wv1500'];
  try {
    const results = await Promise.all(keys.map((key) => fetchCoverage(key, bbox)));
    const rasters = new Map(results.map((item) => [item.key, item] as const));
    return zones.map((zone) => ({ ...zone, soil: makeProfile(zone, rasters) }));
  } catch (error) {
    console.warn('Structured SoilGrids unavailable; keeping soil neutral for this refresh.', error);
    return zones;
  }
}
