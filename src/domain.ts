export type Species = 'cepes' | 'girolles' | 'morilles';
export type ObservationOutcome = 'found' | 'none';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface LatLng {
  lat: number;
  lon: number;
  [key: string]: unknown;
}

export type ForestGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

export type SoilTextureClass =
  | 'sableux'
  | 'sablo-limoneux'
  | 'limoneux'
  | 'limono-argileux'
  | 'argilo-limoneux'
  | 'argileux'
  | 'équilibré'
  | 'inconnu';

export type DrainageClass = 'très drainant' | 'drainant' | 'équilibré' | 'lent' | 'très lent' | 'inconnu';

export interface SoilProfile {
  ph: number | null;
  clayPct: number | null;
  sandPct: number | null;
  siltPct: number | null;
  coarseFragmentsPct: number | null;
  fieldCapacityPct: number | null;
  wiltingPointPct: number | null;
  availableWaterPct: number | null;
  textureClass: SoilTextureClass;
  drainageClass: DrainageClass;
  drainageIndex: number | null;
  depth: '0-5cm';
  resolutionMeters: 250;
  source: 'SoilGrids 2.0 / ISRIC';
}

export interface WeatherSnapshot {
  date: string;
  rain3: number;
  rain7: number;
  rain14: number;
  rain30: number;
  rain26?: number;
  rain56?: number;
  rain84?: number;
  maxRainEvent30?: number;
  airTemp7: number | null;
  airTemp14?: number | null;
  airTemp20?: number | null;
  /** Somme des degrés-jours de l'air >5 °C sur 84 jours : proxy d'accumulation thermique. */
  gdd84Base5?: number | null;
  soilTemp: number | null;
  soilMoisture: number | null;
}

export interface ForestZone extends LatLng {
  id: string;
  name: string;
  tags: Record<string, string>;
  geometry?: ForestGeometry;
  elevation: number | null;
  slope: number | null;
  aspect: number | null;
  forestCode?: string;
  forestType?: string;
  essence?: string;
  soil?: SoilProfile;
  source: 'IGN BD Forêt v2';
}

export interface Observation extends LatLng {
  id: string;
  species: Species;
  outcome: ObservationOutcome;
  count: number;
  durationMinutes: number;
  observedAt: string;
  source: 'gps' | 'map' | 'photo';
  photoName?: string;
  photoStored?: boolean;
  pendingEnrichment?: boolean;
  note?: string;
  weather?: WeatherSnapshot;
  conditionScore?: number;
  habitatLabel?: string;
}

export interface PotentialPoint extends ForestZone {
  forestScore: number;
  terrainScore: number;
  soilScore: number;
  habitatScore: number;
  seasonScore: number;
  conditionScore: number;
  personalCorrection: number;
  finalScore: number;
  reasons: string[];
}

export const SPECIES: Record<Species, { label: string; emoji: string }> = {
  cepes: { label: 'Cèpes', emoji: '🍄' },
  girolles: { label: 'Girolles', emoji: '🟠' },
  morilles: { label: 'Morilles', emoji: '🍄' }
};

const STORAGE_KEY = 'mycomap:observations:v1';
const THEME_KEY = 'mycomap:theme:v1';

export function loadObservations(): Observation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as Observation[] : [];
  } catch {
    return [];
  }
}

export function persistObservations(items: Observation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function loadTheme(): ThemeMode {
  const value = localStorage.getItem(THEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'auto';
}

export function persistTheme(theme: ThemeMode) {
  localStorage.setItem(THEME_KEY, theme);
}
