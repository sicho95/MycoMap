import type { FavoriteSpot, PotentialPoint, Species } from './domain';

const STORAGE_KEY = 'mycomap:favorites:v1';

export function favoriteId(species: Species, zoneId: string) {
  return `${species}:${zoneId}`;
}

export function loadFavorites(): FavoriteSpot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Array<FavoriteSpot & { alertActive?: boolean }> : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      const score = item.lastScore;
      const migratedLevel = typeof item.lastAlertLevel === 'number'
        ? item.lastAlertLevel
        : item.alertActive && score != null && score >= 50
          ? Math.floor(score / 5) * 5
          : null;
      const { alertActive: _legacyAlertActive, ...rest } = item;
      return { ...rest, lastAlertLevel: migratedLevel };
    });
  } catch {
    return [];
  }
}

export function persistFavorites(items: FavoriteSpot[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function favoriteFromPotential(species: Species, point: PotentialPoint): FavoriteSpot {
  const zone = {
    id: point.id,
    name: point.name,
    tags: point.tags,
    lat: point.lat,
    lon: point.lon,
    elevation: point.elevation,
    slope: point.slope,
    aspect: point.aspect,
    forestCode: point.forestCode,
    forestType: point.forestType,
    essence: point.essence,
    soil: point.soil,
    source: point.source
  };

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
    lastAlertLevel: point.finalScore >= 50 ? Math.floor(point.finalScore / 5) * 5 : null
  };
}
