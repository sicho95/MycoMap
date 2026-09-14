import type { ForestZone, Observation, SoilProfile, Species, WeatherSnapshot } from './domain';

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

function bell(value: number | null | undefined, low: number, goodLow: number, goodHigh: number, high: number) {
  if (value == null || !Number.isFinite(value)) return 55;
  if (value <= low || value >= high) return 8;
  if (value >= goodLow && value <= goodHigh) return 100;
  if (value < goodLow) return 8 + ((value - low) / (goodLow - low)) * 92;
  return 8 + ((high - value) / (high - goodHigh)) * 92;
}

function rising(value: number | null | undefined, low: number, good: number) {
  if (value == null || !Number.isFinite(value)) return 55;
  if (value <= low) return 8;
  if (value >= good) return 100;
  return 8 + ((value - low) / (good - low)) * 92;
}

function seasonGate(seasonScore: number, floor: number, power: number) {
  return floor + (1 - floor) * Math.pow(clamp(seasonScore) / 100, power);
}

const monthAffinity: Record<Species, number[]> = {
  cepes: [2, 2, 3, 5, 14, 34, 55, 76, 100, 94, 50, 8],
  girolles: [2, 2, 3, 7, 24, 58, 88, 100, 94, 68, 24, 5],
  morilles: [1, 5, 52, 100, 78, 12, 2, 1, 1, 1, 1, 1]
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

function conditionCepes(weather: WeatherSnapshot, at: Date) {
  const season = scoreSeason('cepes', at);
  const rainSeason = rising(weather.rain30, 3, 95);
  const rainLag = rising(weather.rain26 ?? weather.rain30, 3, 85);
  const moisture = bell(weather.soilMoisture, 0.06, 0.17, 0.40, 0.60);
  const temp20 = bell(weather.airTemp20 ?? weather.airTemp7 ?? weather.soilTemp, 3, 9, 17, 23);
  const waterSignal = rainSeason * 0.42 + rainLag * 0.23 + moisture * 0.35;
  const meteo = waterSignal * 0.78 + temp20 * 0.22;
  const gate = seasonGate(season, 0.14, 0.90);
  return Math.round(clamp(meteo * gate));
}

function conditionGirolles(weather: WeatherSnapshot, at: Date) {
  const season = scoreSeason('girolles', at);
  const gdd = bell(weather.gdd84Base5, 180, 430, 700, 1150);
  const rainLong = bell(weather.rain84 ?? weather.rain56 ?? weather.rain30, 15, 50, 135, 300);
  const recentRain = rising(weather.rain7, 0.5, 20);
  const recentTemp = bell(weather.airTemp14 ?? weather.airTemp20 ?? weather.airTemp7, 4, 9, 20, 28);
  const moisture = bell(weather.soilMoisture, 0.06, 0.18, 0.42, 0.62);
  const longSignal = gdd * 0.52 + rainLong * 0.48;
  const nearSignal = recentRain * 0.55 + recentTemp * 0.45;
  const meteo = longSignal * 0.50 + nearSignal * 0.24 + moisture * 0.26;
  const gate = seasonGate(season, 0.10, 0.95);
  return Math.round(clamp(meteo * gate));
}

function conditionMorilles(weather: WeatherSnapshot, at: Date) {
  const season = scoreSeason('morilles', at);
  const rainEvent = rising(weather.maxRainEvent30, 1, 10);
  const rain30 = bell(weather.rain30, 3, 15, 90, 180);
  const soilTemp = bell(weather.soilTemp, 1, 5, 15, 23);
  const airTemp = bell(weather.airTemp20 ?? weather.airTemp14 ?? weather.airTemp7, 0, 5, 16, 24);
  const moisture = bell(weather.soilMoisture, 0.07, 0.18, 0.42, 0.62);
  const meteo = rainEvent * 0.30 + rain30 * 0.17 + soilTemp * 0.28 + airTemp * 0.10 + moisture * 0.15;
  const gate = seasonGate(season, 0.03, 1.45);
  return Math.round(clamp(meteo * gate));
}

export function scoreConditions(species: Species, weather: WeatherSnapshot, at = new Date(weather.date)) {
  if (species === 'cepes') return conditionCepes(weather, at);
  if (species === 'girolles') return conditionGirolles(weather, at);
  return conditionMorilles(weather, at);
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
  let score = 34;

  if (species === 'cepes') {
    if (code.startsWith('FF1G01') || code.startsWith('FF1-09')) score = 72;
    else if (code.startsWith('FF1-10')) score = 68;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 46;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 68;
    else if (code.startsWith('FF2G61')) score = 72;
    else if (code.startsWith('FF2')) score = 58;
    else if (code.startsWith('FO')) score = 50;
    else if (code.startsWith('FP')) score = 28;
    else if (code.startsWith('LA')) score = 10;

    if (containsAny(text, ['hêtre', 'hetre', 'fagus'])) score = Math.max(score, 94);
    if (containsAny(text, ['chêne', 'chene', 'quercus'])) score = Math.max(score, 92);
    if (containsAny(text, ['châtaign', 'chataign', 'castanea'])) score = Math.max(score, 87);
    if (containsAny(text, ['pin ', 'pinus'])) score = Math.max(score, 86);
    if (containsAny(text, ['épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 82);
    if (containsAny(text, ['bouleau', 'betula'])) score = Math.max(score, 70);

    const hostKnown = containsAny(text, [
      'hêtre', 'hetre', 'fagus', 'chêne', 'chene', 'quercus', 'châtaign', 'chataign', 'castanea',
      'pin ', 'pinus', 'épicéa', 'epicea', 'picea', 'sapin', 'abies', 'bouleau', 'betula'
    ]);
    if (!hostKnown && containsAny(text, ['feuillus', 'feuillu', 'îlot', 'ilot'])) score = Math.min(score, 50);
  } else if (species === 'girolles') {
    if (code.startsWith('FF1G01') || code.startsWith('FF1-09')) score = 72;
    else if (code.startsWith('FF1-10')) score = 66;
    else if (code === 'FF1-00-00' || code.startsWith('FF1-00')) score = 48;
    else if (code.startsWith('FF31') || code.startsWith('FF32')) score = 74;
    else if (code.startsWith('FF2G61')) score = 78;
    else if (code.startsWith('FF2')) score = 64;
    else if (code.startsWith('FO')) score = 54;
    else if (code.startsWith('FP')) score = 30;
    else if (code.startsWith('LA')) score = 12;

    if (containsAny(text, ['hêtre', 'hetre', 'fagus', 'chêne', 'chene', 'quercus'])) score = Math.max(score, 90);
    if (containsAny(text, ['pin ', 'pinus', 'épicéa', 'epicea', 'picea', 'sapin', 'abies'])) score = Math.max(score, 90);
    if (containsAny(text, ['bouleau', 'betula'])) score = Math.max(score, 86);
    if (containsAny(text, ['châtaign', 'chataign', 'castanea', 'noisetier', 'corylus'])) score = Math.max(score, 82);
  } else {
    if (code.startsWith('FP')) score = 58;
    else if (code.startsWith('FO1')) score = 50;
    else if (code.startsWith('FF1')) score = 40;
    else if (code.startsWith('FF31') || code.startsWith('FF32') || code.startsWith('FO3')) score = 38;
    else if (code.startsWith('FO2')) score = 32;
    else if (code.startsWith('FF2')) score = 30;
    else if (code.startsWith('LA')) score = 20;

    if (containsAny(text, ['orme', 'ulmus', 'tilleul', 'tilia', 'carya'])) score = Math.max(score, 78);
    if (containsAny(text, ['noyer', 'juglans', 'pin ', 'pinus', 'sapin', 'abies'])) score = Math.max(score, 68);
    if (containsAny(text, ['peuplier', 'populus', 'pommier', 'malus', 'verger'])) score = Math.max(score, 64);
  }
  return clamp(score);
}

function elevationAffinity(species: Species, elevation: number | null) {
  if (elevation == null) return 55;
  if (species === 'morilles') return bell(elevation, -80, 30, 1300, 2600);
  if (species === 'girolles') return bell(elevation, -80, 30, 1500, 2400);
  return bell(elevation, -80, 30, 1600, 2500);
}

function slopeAffinity(species: Species, slope: number | null) {
  if (slope == null) return 55;
  if (species === 'morilles') return bell(slope, -1, 0, 18, 42);
  if (species === 'girolles') return bell(slope, -1, 0, 22, 45);
  return bell(slope, -1, 0, 22, 45);
}

function aspectAffinity(species: Species, aspect: number | null) {
  if (aspect == null) return 58;
  const target = species === 'morilles' ? 330 : 45;
  const delta = Math.abs(((aspect - target + 540) % 360) - 180);
  return clamp(82 - delta * 0.18, 48, 82);
}

function phAffinity(species: Species, ph: number | null) {
  if (species === 'morilles') return bell(ph, 4.4, 5.8, 7.1, 8.4);
  if (species === 'girolles') return bell(ph, 3.0, 4.0, 5.5, 6.8);
  return bell(ph, 3.0, 3.9, 5.8, 7.1);
}

function textureAffinity(species: Species, soil: SoilProfile) {
  const table: Record<Species, Record<string, number>> = {
    cepes: {
      'sableux': 88, 'sablo-limoneux': 98, 'limoneux': 78, 'limono-argileux': 62,
      'argilo-limoneux': 58, 'argileux': 38, 'équilibré': 82, 'inconnu': 50
    },
    girolles: {
      'sableux': 94, 'sablo-limoneux': 100, 'limoneux': 76, 'limono-argileux': 58,
      'argilo-limoneux': 52, 'argileux': 34, 'équilibré': 80, 'inconnu': 50
    },
    morilles: {
      'sableux': 62, 'sablo-limoneux': 94, 'limoneux': 98, 'limono-argileux': 88,
      'argilo-limoneux': 84, 'argileux': 60, 'équilibré': 92, 'inconnu': 50
    }
  };
  return table[species][soil.textureClass] ?? 50;
}

function drainageAffinity(species: Species, soil: SoilProfile) {
  const index = soil.drainageIndex;
  if (index == null) return 50;
  if (species === 'morilles') return bell(index, 8, 28, 68, 94);
  if (species === 'girolles') return bell(index, 18, 48, 80, 98);
  return bell(index, 12, 40, 76, 98);
}

function soilAffinity(species: Species, soil?: SoilProfile) {
  if (!soil) return 48;
  const phScore = phAffinity(species, soil.ph);
  const textureScore = textureAffinity(species, soil);
  const drainageScore = drainageAffinity(species, soil);

  if (species === 'girolles') return Math.round(phScore * 0.45 + textureScore * 0.35 + drainageScore * 0.20);
  if (species === 'morilles') return Math.round(phScore * 0.30 + textureScore * 0.50 + drainageScore * 0.20);
  return Math.round(phScore * 0.34 + textureScore * 0.36 + drainageScore * 0.30);
}

export function scoreHabitat(species: Species, zone: ForestZone) {
  const forestScore = forestAffinity(species, zone);
  const terrainScore = Math.round(
    elevationAffinity(species, zone.elevation) * 0.45 +
    slopeAffinity(species, zone.slope) * 0.35 +
    aspectAffinity(species, zone.aspect) * 0.20
  );
  const soilScore = soilAffinity(species, zone.soil);

  const weighted = species === 'morilles'
    ? forestScore * 0.40 + soilScore * 0.40 + terrainScore * 0.20
    : species === 'girolles'
      ? forestScore * 0.56 + soilScore * 0.34 + terrainScore * 0.10
      : forestScore * 0.60 + soilScore * 0.30 + terrainScore * 0.10;

  const habitatScore = species === 'morilles'
    ? (forestScore < 65 ? Math.min(weighted, 68) : weighted)
    : (forestScore < 55 ? Math.min(weighted, forestScore + 8) : weighted);

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

function phenologyReason(species: Species, weather: WeatherSnapshot) {
  if (species === 'cepes') {
    const rain = weather.rain26 ?? weather.rain30;
    const temp = weather.airTemp20 ?? weather.airTemp7;
    return `Hydrologie + signal 20/26 j · ${temp == null ? 'T° —' : `${temp.toFixed(1)} °C`} · pluie ${rain.toFixed(0)} mm`;
  }
  if (species === 'girolles') {
    const rain = weather.rain84 ?? weather.rain56 ?? weather.rain30;
    const gdd = weather.gdd84Base5;
    return `Signal 6–13 sem. · pluie ${rain.toFixed(0)} mm${gdd == null ? '' : ` · ${gdd.toFixed(0)} DJ >5 °C`} · pluie 7 j ${weather.rain7.toFixed(0)} mm`;
  }
  return `Signal printanier · pluie max 30 j ${(weather.maxRainEvent30 ?? 0).toFixed(0)} mm · sol ${weather.soilTemp == null ? '—' : `${weather.soilTemp.toFixed(1)} °C`}`;
}

export function scoreZone(species: Species, zone: ForestZone, weather: WeatherSnapshot, observations: Observation[]) {
  const habitat = scoreHabitat(species, zone);
  const at = new Date(weather.date);
  const seasonScore = scoreSeason(species, at);
  const conditionScore = scoreConditions(species, weather, at);
  const correction = personalCorrection(species, zone, observations);

  const availabilityFactor = 0.10 + 0.90 * (conditionScore / 100);
  const finalScore = Math.round(clamp(habitat.habitatScore * availabilityFactor + correction));
  const terrain = zone.elevation == null
    ? 'Relief IGN indisponible'
    : `${Math.round(zone.elevation)} m${zone.slope == null ? '' : ` · pente ${zone.slope.toFixed(0)}° · ${aspectLabel(zone.aspect)}`}`;

  return {
    ...zone,
    ...habitat,
    seasonScore,
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
      phenologyReason(species, weather),
      correction === 0 ? 'Historique neutre' : `Historique ${correction > 0 ? '+' : ''}${correction}`,
      terrain
    ]
  };
}

export function scoreColor(score: number) {
  if (score >= 90) return '#d61536';
  if (score >= 80) return '#ff5b2e';
  if (score >= 70) return '#f0c52e';
  if (score >= 60) return '#43a867';
  return '#3b82c4';
}

export function scoreLabel(score: number) {
  if (score >= 90) return 'Indice exceptionnel';
  if (score >= 80) return 'Très bon potentiel';
  if (score >= 70) return 'Bon potentiel';
  if (score >= 60) return 'Potentiel favorable';
  if (score >= 50) return 'Potentiel à surveiller';
  return 'Sous le seuil d’affichage';
}
