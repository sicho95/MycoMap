import type { WeatherSnapshot } from './domain';
import { getCachedWeather, putCachedWeather, WEATHER_CACHE_MAX_AGE_MS } from './offline';

const avg = (values: Array<number | null | undefined>) => {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : null;
};

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, v) => total + (typeof v === 'number' ? v : 0), 0);
const max = (values: Array<number | null | undefined>) => {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? Math.max(...usable) : null;
};
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function normalizeWeather(data: any, at: Date): WeatherSnapshot {
  const dailyTimes: string[] = data.daily?.time ?? [];
  const target = dayKey(at);
  let idx = dailyTimes.findIndex((d) => d === target);
  if (idx < 0) idx = dailyTimes.length - 1;
  const precip: number[] = data.daily?.precipitation_sum ?? [];
  const maxTemps: number[] = data.daily?.temperature_2m_max ?? [];
  const minTemps: number[] = data.daily?.temperature_2m_min ?? [];
  const dailyMean = maxTemps.map((v, i) => (v + (minTemps[i] ?? v)) / 2);
  const trailingRain = (days: number) => precip.slice(Math.max(0, idx - days + 1), idx + 1);
  const trailingTemp = (days: number) => dailyMean.slice(Math.max(0, idx - days + 1), idx + 1);
  const gdd84 = trailingTemp(84).reduce<number>((total, value) => total + Math.max(0, value - 5), 0);

  const hourlyTimes: string[] = data.hourly?.time ?? [];
  const targetMs = at.getTime();
  let hourIdx = 0;
  let smallest = Number.POSITIVE_INFINITY;
  hourlyTimes.forEach((value, i) => {
    const diff = Math.abs(new Date(value).getTime() - targetMs);
    if (diff < smallest) {
      smallest = diff;
      hourIdx = i;
    }
  });

  return {
    date: at.toISOString(),
    rain3: sum(trailingRain(3)),
    rain7: sum(trailingRain(7)),
    rain14: sum(trailingRain(14)),
    rain26: sum(trailingRain(26)),
    rain30: sum(trailingRain(30)),
    rain56: sum(trailingRain(56)),
    rain84: sum(trailingRain(84)),
    maxRainEvent30: max(trailingRain(30)) ?? 0,
    airTemp7: avg(trailingTemp(7)),
    airTemp14: avg(trailingTemp(14)),
    airTemp20: avg(trailingTemp(20)),
    gdd84Base5: Number.isFinite(gdd84) ? gdd84 : null,
    soilTemp: data.hourly?.soil_temperature_6cm?.[hourIdx] ?? data.hourly?.soil_temperature_7_to_28cm?.[hourIdx] ?? null,
    soilMoisture: data.hourly?.soil_moisture_3_to_9cm?.[hourIdx] ?? data.hourly?.soil_moisture_0_to_7cm?.[hourIdx] ?? null,
    elevation: typeof data.elevation === 'number' && Number.isFinite(data.elevation) ? data.elevation : null
  };
}

async function fetchRecentWeatherNetwork(lat: number, lon: number, at: Date): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    timezone: 'auto',
    past_days: '90',
    forecast_days: '2',
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
    hourly: 'soil_temperature_6cm,soil_moisture_3_to_9cm'
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error('Météo indisponible');
  return normalizeWeather(await response.json(), at);
}

async function fetchArchiveWeatherNetwork(lat: number, lon: number, date: Date): Promise<WeatherSnapshot> {
  const start = new Date(date);
  start.setDate(start.getDate() - 90);
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    timezone: 'auto',
    start_date: dayKey(start),
    end_date: dayKey(date),
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
    hourly: 'soil_temperature_7_to_28cm,soil_moisture_0_to_7cm'
  });
  const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
  if (!response.ok) throw new Error('Historique météo indisponible');
  return normalizeWeather(await response.json(), date);
}

async function cachedFirst(
  lat: number,
  lon: number,
  date: Date,
  network: () => Promise<WeatherSnapshot>,
  force = false
) {
  const cached = await getCachedWeather(lat, lon, date);
  const historical = Date.now() - date.getTime() > 48 * 60 * 60 * 1000;
  const hasLongSignals = !!cached && cached.snapshot.rain84 != null && cached.snapshot.gdd84Base5 != null;
  const recentCacheFresh = cached && hasLongSignals && Date.now() - cached.updatedAt < WEATHER_CACHE_MAX_AGE_MS;

  if (!navigator.onLine) {
    if (cached) return cached.snapshot;
    throw new Error('Météo non disponible hors ligne pour cette date');
  }

  if (!force && cached && ((historical && hasLongSignals) || recentCacheFresh)) return cached.snapshot;

  try {
    const snapshot = await network();
    await putCachedWeather(lat, lon, date, snapshot);
    return snapshot;
  } catch (error) {
    if (cached) return cached.snapshot;
    throw error;
  }
}

export function fetchCurrentWeather(lat: number, lon: number, force = false) {
  const now = new Date();
  return cachedFirst(lat, lon, now, () => fetchRecentWeatherNetwork(lat, lon, now), force);
}

export async function fetchWeatherForDate(lat: number, lon: number, date: Date, force = false): Promise<WeatherSnapshot> {
  const ageDays = Math.abs(Date.now() - date.getTime()) / 86400000;
  return cachedFirst(
    lat,
    lon,
    date,
    () => ageDays <= 28 ? fetchRecentWeatherNetwork(lat, lon, date) : fetchArchiveWeatherNetwork(lat, lon, date),
    force
  );
}
