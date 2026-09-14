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
  // Cèpes au sens large : fenêtre estivale possible, optimum automnal, hiver très défavorable.
  cepes: [3, 3, 5, 8, 20, 42, 62, 80, 100, 96, 58, 10],
  girolles: [3, 3, 5, 12, 38, 72, 94, 100, 92, 72, 28, 6],
  morilles: [2, 8, 62, 100, 82, 20, 4, 2, 2, 2, 2, 2]
};

export function scoreSeason(species: Species, at: Date) {
  const month = at.getMonth();
  const current = monthAffinity[species][month] ?? 40;
  const next = monthAffinity[species][(month + 1) % 12] ?? current;
  const start = new Date(at.getFullYear(), month, 1).getTime();
  const end = new Date(at.getFullYear(), month + 1, 1).getTime();
  const progress = clamp(((at.getTime() - start) / Math.max(1, end - start)) * 100) / 100;
  return Math.round(current * (1 - progress) + next * progress);
}

export function scoreConditions(species: Species, weather: WeatherSnapshot, at = new Date(weather.date)) {
  const seasonScore = scoreSeason(species, at);
  const rainLong = weather.rain26 ?? weather.rain30;
  const tempLong = weather.airTemp20 ?? weather.airTemp7 ?? weather.soilTemp;

  const rainScore = species === 'morilles'
    ? 0.72 * bell(rainLong, 4, 24, 90, 190) + 0.28 * bell(weather.rain7, 0.5, 5, 32, 75)
    : species === 'girolles'
      ? 0.72 * bell(rainLong, 5, 28, 105, 210) + 0.28 * bell(weather.rain7, 0.5, 6, 36, 85)
      : 0.74 * bell(rainLong, 5, 30, 110, 220) + 0.26 * bell(weather.rain7, 0.5, 5, 34, 85);

  const moistureScore = species === 'morilles'
    ? bell(weather.soilMoisture, 0.08, 0.20, 0.38, 0.56)
    : bell(weather.soilMoisture, 0.07, 0.18, 0.40, 0.58);

  // Pour B. edulis, les longues fenêtres météo sont plus pertinentes qu'une simple pluie récente.
  // Les plages restent volontairement larges car MycoMap couvre plusieurs espèces de cèpes et régions.
  const tempScore = species === 'morilles'
    ? bell(tempLong, 1, 7, 14, 21)
    : species === 'girolles'
      ? bell(tempLong, 5, 11, 20, 27)
      : bell(tempLong, 3, 10, 16, 24);

  const climateScore = clamp(rainScore * 0.42 + moistureScore * 0.23 + tempScore * 0.35);

  // La saison devient un facteur limitant et non un petit bonus additif.
  // Une anomalie climatique peut prolonger un peu la fenêtre, mais ne crée pas un automne en plein hiver.
  const seasonalGate = 0.14 + 0.86 * (seasonScore / 100);
  return Math.round(clamp(climateScore * seasonalGate));
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
  let score = 38;

  if (species === 'cepes') {
    if (code.startsWith('FF1G01')) score = 88;
    else if (code.startsWith('FF1-09')) score = 90;
    else if (code.startsWith('FF1-10')) score = 84;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 50;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 76;
    else if (code.startsWith('FF2G61')) score = 80;
    else if (code.startsWith('FF2-52') || code.startsWith('FF2-53') || code.startsWith('FF2-80')) score = 72;
    else if (code.startsWith('FF2')) score = 60;
    else if (code.startsWith('FO3')) score = 62;
    else if (code.startsWith('FO1')) score = 58;
    else if (code.startsWith('FO2')) score = 54;
    else if (code.startsWith('FP')) score = 34;
    else if (code.startsWith('LA')) score = 12;

    if (containsAny(text, ['chêne', 'chene', 'quercus'])) score = Math.max(score, 92);
    if (containsAny(text, ['hêtre', 'hetre', 'fagus'])) score = Math.max(score, 94);
    if (containsAny(text, ['châtaign', 'chataign', 'castanea'])) score = Math.max(score, 88);
    if (containsAny(text, ['pin ', 'pinus'])) score = Math.max(score, 84);
    if (containsAny(text, ['épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 82);
    if (containsAny(text, ['bouleau', 'betula'])) score = Math.max(score, 72);

    const hostKnown = containsAny(text, [
      'chêne', 'chene', 'quercus', 'hêtre', 'hetre', 'fagus', 'châtaign', 'chataign', 'castanea',
      'pin ', 'pinus', 'épicéa', 'epicea', 'picea', 'sapin', 'abies', 'bouleau', 'betula'
    ]);
    if (!hostKnown && containsAny(text, ['feuillus', 'feuillu', 'îlot', 'ilot'])) score = Math.min(score, 56);
  } else if (species === 'girolles') {
    if (code.startsWith('FF1G01')) score = 86;
    else if (code.startsWith('FF1-09')) score = 90;
    else if (code.startsWith('FF1-10')) score = 82;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 52;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 80;
    else if (code.startsWith('FF2G61')) score = 86;
    else if (code.startsWith('FF2-52') || code.startsWith('FF2-53') || code.startsWith('FF2-80')) score = 82;
    else if (code.startsWith('FF2')) score = 68;
    else if (code.startsWith('FO3')) score = 64;
    else if (code.startsWith('FO1') || code.startsWith('FO2')) score = 58;
    else if (code.startsWith('FP')) score = 36;
    else if (code.startsWith('LA')) score = 14;

    if (containsAny(text, ['hêtre', 'hetre', 'fagus', 'chêne', 'chene', 'quercus'])) score = Math.max(score, 90);
    if (containsAny(text, ['pin ', 'pinus', 'épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 88);
    if (containsAny(text, ['bouleau', 'betula'])) score = Math.max(score, 86);

    const hostKnown = containsAny(text, [
      'hêtre', 'hetre', 'fagus', 'chêne', 'chene', 'quercus', 'pin ', 'pinus',
      'épicéa', 'epicea', 'picea', 'sapin', 'abies', 'bouleau', 'betula'
    ]);
    if (!hostKnown && containsAny(text, ['feuillus', 'feuillu', 'îlot', 'ilot'])) score = Math.min(score, 58);
  } else {
    if (code.startsWith('FP')) score = 88;
    else if (code.startsWith('FO1')) score = 65;
    else if (code.startsWith('FF1')) score = 50;
    else if (code.startsWith('FF31') || code.startsWith('FF32') || code.startsWith('FO3')) score = 48;
    else if (code.startsWith('FO2')) score = 38;
    else if (code.startsWith('FF2')) score = 28;
    else if (code.startsWith('LA')) score = 24;

    if (containsAny(text, ['frêne', 'frene', 'fraxinus'])) score = Math.max(score, 96);
    if (containsAny(text, ['orme', 'ulmus'])) score = Math.max(score, 94);
    if (containsAny(text, ['peuplier', 'populus'])) score = Math.max(score, 91);
    if (containsAny(text, ['pommier', 'malus', 'verger'])) score = Math.max(score, 88);
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
  if (!soil) return 52;
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
  const weighted = forestScore * 0.64 + soilScore * 0.26 + terrainScore * 0.10;
  // Sans hôte forestier convaincant, relief et sol ne suffisent pas à fabriquer un hotspot.
  const habitatScore = forestScore < 60 ? Math.min(weighted, forestScore + 8) : weighted;
  return {
    forestScore: Math.round(forestScore),
    terrainScore,
    soilScore,
    habitatScore: Math.round(clamp(habitatScore))
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
  const at = new Date(weather.date);
  const seasonScore = scoreSeason(species, at);
  const conditionScore = scoreConditions(species, weather, at);
  const correction = personalCorrection(species, zone, observations);

  // L'habitat fixe le plafond. Les conditions déterminent la part de ce potentiel
  // réellement accessible maintenant. On évite ainsi qu'une météo idéale transforme
  // une forêt seulement plausible en hotspot.
  const availabilityFactor = 0.18 + 0.82 * (conditionScore / 100);
  const finalScore = Math.round(clamp(habitat.habitatScore * availabilityFactor + correction));
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
      `Saison ${seasonScore}/100`,
      `Moment ${conditionScore}/100`,
      weather.rain26 != null ? `Pluie 26 j ${weather.rain26.toFixed(0)} mm` : `Pluie 30 j ${weather.rain30.toFixed(0)} mm`,
      (weather.airTemp20 ?? weather.airTemp7) == null ? 'Température longue —' : `Temp. 20 j ${(weather.airTemp20 ?? weather.airTemp7)!.toFixed(1)} °C`,
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
