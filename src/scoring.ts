import type { ForestZone, Observation, SoilProfile, Species, WeatherSnapshot } from './domain';

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

function tagsText(zone: ForestZone) {
  return [zone.forestCode, zone.forestType, zone.essence, ...Object.values(zone.tags)]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('fr');
}

function containsAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

function forestAffinity(species: Species, zone: ForestZone) {
  const code = (zone.forestCode ?? '').toUpperCase();
  const text = tagsText(zone);
  let score = 48;

  if (species === 'cepes') {
    if (code.startsWith('FF1G01')) score = 97;
    else if (code.startsWith('FF1-09')) score = 97;
    else if (code.startsWith('FF1-10')) score = 93;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 88;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 92;
    else if (code.startsWith('FF2G61')) score = 91;
    else if (code.startsWith('FF2-52') || code.startsWith('FF2-53') || code.startsWith('FF2-80')) score = 85;
    else if (code.startsWith('FF2')) score = 80;
    else if (code.startsWith('FO3')) score = 80;
    else if (code.startsWith('FO1')) score = 78;
    else if (code.startsWith('FO2')) score = 73;
    else if (code.startsWith('FP')) score = 42;
    else if (code.startsWith('LA')) score = 18;

    if (containsAny(text, ['chêne', 'chene', 'quercus'])) score = Math.max(score, 96);
    if (containsAny(text, ['hêtre', 'hetre', 'fagus'])) score = Math.max(score, 97);
    if (containsAny(text, ['châtaign', 'chataign', 'castanea'])) score = Math.max(score, 92);
    if (containsAny(text, ['épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 89);
  } else if (species === 'girolles') {
    if (code.startsWith('FF1G01')) score = 94;
    else if (code.startsWith('FF1-09')) score = 96;
    else if (code.startsWith('FF1-10')) score = 89;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 88;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 93;
    else if (code.startsWith('FF2G61')) score = 95;
    else if (code.startsWith('FF2-52') || code.startsWith('FF2-53') || code.startsWith('FF2-80')) score = 92;
    else if (code.startsWith('FF2')) score = 87;
    else if (code.startsWith('FO3')) score = 82;
    else if (code.startsWith('FO1') || code.startsWith('FO2')) score = 78;
    else if (code.startsWith('FP')) score = 45;
    else if (code.startsWith('LA')) score = 20;

    if (containsAny(text, ['hêtre', 'hetre', 'fagus', 'chêne', 'chene', 'quercus'])) score = Math.max(score, 93);
    if (containsAny(text, ['pin ', 'pinus', 'épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 91);
    if (containsAny(text, ['bouleau', 'betula'])) score = Math.max(score, 90);
  } else {
    if (code.startsWith('FP')) score = 96;
    else if (code.startsWith('FO1')) score = 76;
    else if (code.startsWith('FF1')) score = 66;
    else if (code.startsWith('FF31') || code.startsWith('FF32') || code.startsWith('FO3')) score = 57;
    else if (code.startsWith('FO2')) score = 42;
    else if (code.startsWith('FF2')) score = 30;
    else if (code.startsWith('LA')) score = 28;

    if (containsAny(text, ['frêne', 'frene', 'fraxinus'])) score = Math.max(score, 100);
    if (containsAny(text, ['orme', 'ulmus'])) score = Math.max(score, 98);
    if (containsAny(text, ['peuplier', 'populus'])) score = Math.max(score, 96);
    if (containsAny(text, ['pommier', 'malus', 'verger'])) score = Math.max(score, 93);
  }
  return clamp(score);
}

function elevationAffinity(species: Species, elevation: number | null) {
  if (elevation == null) return 58;
  if (species === 'morilles') return bell(elevation, -50, 60, 900, 1700);
  if (species === 'girolles') return bell(elevation, -50, 70, 1250, 2100);
  return bell(elevation, -50, 70, 1450, 2300);
}

function slopeAffinity(species: Species, slope: number | null) {
  if (slope == null) return 58;
  if (species === 'morilles') return bell(slope, -1, 0, 12, 34);
  if (species === 'girolles') return bell(slope, -1, 2, 20, 42);
  return bell(slope, -1, 2, 18, 40);
}

function aspectAffinity(species: Species, aspect: number | null) {
  if (aspect == null) return 66;
  const target = species === 'morilles' ? 135 : 45;
  const delta = Math.abs(((aspect - target + 540) % 360) - 180);
  return clamp(100 - delta * 0.34, 42, 100);
}

function phAffinity(species: Species, ph: number | null) {
  if (species === 'morilles') return bell(ph, 4.4, 6.2, 7.9, 8.8);
  if (species === 'girolles') return bell(ph, 3.1, 4.0, 5.8, 7.1);
  return bell(ph, 3.2, 4.2, 6.2, 7.4);
}

function textureAffinity(species: Species, soil: SoilProfile) {
  const table: Record<Species, Record<string, number>> = {
    cepes: {
      'sableux': 68, 'sablo-limoneux': 94, 'limoneux': 92, 'limono-argileux': 82,
      'argilo-limoneux': 76, 'argileux': 54, 'équilibré': 96, 'inconnu': 55
    },
    girolles: {
      'sableux': 82, 'sablo-limoneux': 97, 'limoneux': 92, 'limono-argileux': 78,
      'argilo-limoneux': 70, 'argileux': 48, 'équilibré': 95, 'inconnu': 55
    },
    morilles: {
      'sableux': 58, 'sablo-limoneux': 81, 'limoneux': 96, 'limono-argileux': 94,
      'argilo-limoneux': 92, 'argileux': 72, 'équilibré': 93, 'inconnu': 55
    }
  };
  return table[species][soil.textureClass] ?? 55;
}

function drainageAffinity(species: Species, soil: SoilProfile) {
  const index = soil.drainageIndex;
  if (index == null) return 55;
  if (species === 'morilles') return bell(index, 5, 28, 58, 88);
  if (species === 'girolles') return bell(index, 10, 42, 72, 96);
  return bell(index, 8, 38, 70, 95);
}

function soilAffinity(species: Species, soil?: SoilProfile) {
  if (!soil) return 55;
  const phScore = phAffinity(species, soil.ph);
  const textureScore = textureAffinity(species, soil);
  const drainageScore = drainageAffinity(species, soil);
  return Math.round(phScore * 0.48 + textureScore * 0.30 + drainageScore * 0.22);
}

export function scoreHabitat(species: Species, zone: ForestZone) {
  const forestScore = forestAffinity(species, zone);
  const terrainScore = Math.round(
    elevationAffinity(species, zone.elevation) * 0.45 +
    slopeAffinity(species, zone.slope) * 0.40 +
    aspectAffinity(species, zone.aspect) * 0.15
  );
  const soilScore = soilAffinity(species, zone.soil);
  return {
    forestScore: Math.round(forestScore),
    terrainScore,
    soilScore,
    habitatScore: Math.round(forestScore * 0.58 + terrainScore * 0.17 + soilScore * 0.25)
  };
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

function aspectLabel(aspect: number | null) {
  if (aspect == null) return 'plat';
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return labels[Math.round(aspect / 45) % 8];
}

function soilReason(zone: ForestZone) {
  if (!zone.soil) return 'Sol structuré indisponible';
  const ph = zone.soil.ph == null ? 'pH —' : `pH ${zone.soil.ph.toFixed(1)}`;
  return `${ph} · ${zone.soil.textureClass} · drainage ${zone.soil.drainageClass}`;
}

export function scoreZone(species: Species, zone: ForestZone, weather: WeatherSnapshot, observations: Observation[]) {
  const habitat = scoreHabitat(species, zone);
  const conditionScore = scoreConditions(species, weather);
  const correction = personalCorrection(species, zone, observations);
  const finalScore = Math.round(clamp(habitat.habitatScore * 0.62 + conditionScore * 0.38 + correction));
  const terrain = zone.elevation == null
    ? 'Relief IGN indisponible'
    : `${Math.round(zone.elevation)} m${zone.slope == null ? '' : ` · pente ${zone.slope.toFixed(0)}° · ${aspectLabel(zone.aspect)}`}`;
  return {
    ...zone,
    ...habitat,
    conditionScore,
    personalCorrection: correction,
    finalScore,
    reasons: [
      zone.essence || zone.forestType || 'Formation forestière IGN',
      `Forêt ${habitat.forestScore}/100`,
      `Sol ${habitat.soilScore}/100`,
      soilReason(zone),
      `Terrain ${habitat.terrainScore}/100`,
      `Moment ${conditionScore}/100`,
      correction === 0 ? 'Historique neutre' : `Historique ${correction > 0 ? '+' : ''}${correction}`,
      terrain
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
