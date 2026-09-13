export type Species = 'cepes' | 'girolles' | 'morilles';
export type ObservationOutcome = 'found' | 'none';
export type ThemeMode = 'auto' | 'light' | 'dark';

export interface LatLng { lat: number; lon: number }

export interface WeatherSnapshot {
  date: string;
  rain3: number;
  rain7: number;
  rain14: number;
  rain30: number;
  airTemp7: number | null;
  soilTemp: number | null;
  soilMoisture: number | null;
}

export interface ForestZone extends LatLng {
  id: string;
  name: string;
  tags: Record<string, string>;
  elevation: number | null;
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
  note?: string;
  weather?: WeatherSnapshot;
  conditionScore?: number;
  habitatLabel?: string;
}

export interface PotentialPoint extends ForestZone {
  habitatScore: number;
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
