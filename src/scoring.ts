import type { ForestZone, Observation, Species, WeatherSnapshot } from './domain';

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function bell(value: number | null, low: number, goodLow: number, goodHigh: number, high: number) {
  if (value == null) return 55;
  if (value <= low || value >= high) return 8;
  if (value >= goodLow && value <= goodHigh) return 100;
  if (value < goodLow) return 8 + ((value - low) / (goodLow - low)) * 92;
  return 8 + ((high - value) / (high - goodHigh)) * 92;
}

const monthAffinity: Record<Species, number[]> = {
  cepes: [5, 5, 10, 15, 30, 48, 66, 86, 100, 100, 76, 18],
  girolles: [5, 5, 10, 20, 45, 78, 96, 100, 96, 82, 45, 10],
  morilles: [4, 16, 78, 100, 84, 18, 4, 2, 2, 2, 2, 2]
};

export function scoreConditions(species: Species, weather: WeatherSnapshot, at = new Date(weather.date)) {
  const monthScore = monthAffinity[species][at.getMonth()] ?? 40;
  const rainScore = species === 'morilles'
    ? 0.55 * bell(weather.rain14, 2, 12, 42, 90) + 0.45 * bell(weather.rain30, 10, 30, 100, 180)
    : species === 'girolles'
      ? 0.62 * bell(weather.rain14, 3, 18, 62, 125) + 0.38 * bell(weather.rain7, 1, 8, 35, 75)
      : 0.68 * bell(weather.rain14, 3, 14, 55, 110) + 0.32 * bell(weather.rain7, 1, 7, 30, 70);

  const moistureScore = species === 'morilles'
    ? bell(weather.soilMoisture, 0.08, 0.20, 0.38, 0.56)
    : bell(weather.soilMoisture, 0.07, 0.18, 0.40, 0.58);

  const temp = weather.soilTemp ?? weather.airTemp7;
  const tempScore = species === 'morilles'
    ? bell(temp, 2, 7, 14, 21)
    : species === 'girolles'
      ? bell(temp, 6, 11, 20, 27)
      : bell(temp, 5, 10, 19, 27);

  return Math.round(clamp(monthScore * 0.22 + rainScore * 0.34 + moistureScore * 0.22 + tempScore * 0.22));
}

function tagsText(tags: Record<string, string>) {
  return Object.values(tags).join(' ').toLocaleLowerCase('fr');
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function forestAffinity(species: Species, zone: ForestZone) {
  const text = tagsText(zone.tags);
  let score = 57;
  const leaf = zone.tags.leaf_type?.toLowerCase();

  if (leaf === 'broadleaved') score += species === 'morilles' ? 13 : 8;
  if (leaf === 'needleleaved') score += species === 'morilles' ? -10 : 7;
  if (leaf === 'mixed') score += species === 'morilles' ? 4 : 13;

  if (species === 'cepes') {
    if (containsAny(text, ['quercus', 'chêne', 'chene', 'oak'])) score += 20;
    if (containsAny(text, ['fagus', 'hêtre', 'hetre', 'beech'])) score += 19;
    if (containsAny(text, ['castanea', 'châtaign', 'chataign', 'chestnut'])) score += 16;
    if (containsAny(text, ['pinus', 'pine', 'picea', 'épicéa', 'epicea', 'spruce'])) score += 13;
  } else if (species === 'girolles') {
    if (containsAny(text, ['quercus', 'chêne', 'chene', 'oak', 'fagus', 'hêtre', 'hetre', 'beech'])) score += 17;
    if (containsAny(text, ['betula', 'bouleau', 'birch'])) score += 14;
    if (containsAny(text, ['pinus', 'pine', 'picea', 'spruce', 'abies', 'sapin', 'fir'])) score += 14;
  } else {
    if (containsAny(text, ['fraxinus', 'frêne', 'frene', 'ash'])) score += 24;
    if (containsAny(text, ['ulmus', 'orme', 'elm'])) score += 22;
    if (containsAny(text, ['populus', 'peuplier', 'poplar'])) score += 18;
    if (containsAny(text, ['malus', 'pommier', 'apple', 'orchard', 'verger'])) score += 20;
  }
  return clamp(score);
}

function elevationAffinity(species: Species, elevation: number | null) {
  if (elevation == null) return 60;
  if (species === 'morilles') return bell(elevation, -50, 80, 950, 1700);
  if (species === 'girolles') return bell(elevation, -50, 80, 1250, 2100);
  return bell(elevation, -50, 80, 1450, 2300);
}

export function scoreHabitat(species: Species, zone: ForestZone) {
  return Math.round(forestAffinity(species, zone) * 0.82 + elevationAffinity(species, zone.elevation) * 0.18);
}

export function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const r = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

export function personalCorrection(species: Species, zone: ForestZone, observations: Observation[]) {
  let correction = 0;
  let evidence = 0;

  for (const obs of observations) {
    if (obs.species !== species) continue;
    const distance = distanceMeters(zone, obs);
    if (distance > 3200) continue;
    const spatial = Math.exp(-distance / 950);

    if (obs.outcome === 'found') {
      const quantity = Math.min(1.8, 0.65 + Math.log2(Math.max(1, obs.count) + 1) * 0.28);
      const adverseBonus = obs.conditionScore != null && obs.conditionScore < 55 ? 1.18 : 1;
      correction += 6.2 * spatial * quantity * adverseBonus;
      evidence += spatial;
    } else {
      const condition = obs.conditionScore ?? 50;
      const effort = clamp(obs.durationMinutes / 90, 0, 1);
      if (condition >= 72 && effort >= 0.35) {
        correction -= 3.2 * spatial * effort * ((condition - 65) / 35);
        evidence += spatial * 0.5;
      }
    }
  }

  const damping = evidence > 0 ? Math.min(1, 0.55 + Math.log1p(evidence) * 0.34) : 0;
  return Math.round(clamp(correction * damping, -12, 18));
}

export function scoreZone(species: Species, zone: ForestZone, weather: WeatherSnapshot, observations: Observation[]) {
  const habitatScore = scoreHabitat(species, zone);
  const conditionScore = scoreConditions(species, weather);
  const correction = personalCorrection(species, zone, observations);
  const finalScore = Math.round(clamp(habitatScore * 0.6 + conditionScore * 0.4 + correction));
  return {
    ...zone,
    habitatScore,
    conditionScore,
    personalCorrection: correction,
    finalScore,
    reasons: [
      `Habitat ${habitatScore}/100`,
      `Moment ${conditionScore}/100`,
      correction === 0 ? 'Historique neutre' : `Historique ${correction > 0 ? '+' : ''}${correction}`,
      zone.elevation == null ? 'Altitude indisponible' : `${Math.round(zone.elevation)} m`
    ]
  };
}

export function scoreColor(score: number) {
  if (score >= 90) return '#d61536';
  if (score >= 75) return '#ff5b2e';
  if (score >= 55) return '#f0c52e';
  if (score >= 30) return '#43a867';
  return '#3b82c4';
}

export function scoreLabel(score: number) {
  if (score >= 90) return 'Point chaud exceptionnel';
  if (score >= 75) return 'Très fort potentiel';
  if (score >= 55) return 'Potentiel intéressant';
  if (score >= 30) return 'Faible potentiel';
  return 'Peu favorable';
}
