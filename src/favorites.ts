import type { FavoriteSpot, PotentialPoint, Species } from './domain';

const STORAGE_KEY = 'mycomap:favorites:v1';

export function favoriteId(species: Species, zoneId: string) {
  return `${species}:${zoneId}`;
}

export function loadFavorites(): FavoriteSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as FavoriteSpot[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistFavorites(items: FavoriteSpot[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function favoriteFromPotential(species: Species, point: PotentialPoint): FavoriteSpot {
  const {
    geometry: _geometry,
    forestScore: _forestScore,
    terrainScore: _terrainScore,
    soilScore: _soilScore,
    habitatScore: _habitatScore,
    seasonScore: _seasonScore,
    conditionScore: _conditionScore,
    hydricScore: _hydricScore,
    hydricRelativeWaterPct: _hydricRelativeWaterPct,
    hydricLabel: _hydricLabel,
    personalCorrection: _personalCorrection,
    finalScore: _finalScore,
    reasons: _reasons,
    ...zone
  } = point;

  return {
    id: favoriteId(species, point.id),
    species,
    lat: point.lat,
    lon: point.lon,
    zone,
    createdAt: new Date().toISOString(),
    lastScore: point.finalScore,
    lastHabitatScore: point.habitatScore,
    lastConditionScore: point.conditionScore,
    lastHydricScore: point.hydricScore,
    lastCheckedAt: new Date().toISOString(),
    alertActive: point.finalScore >= 50
  };
}
