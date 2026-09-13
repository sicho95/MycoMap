import type { WeatherSnapshot } from './domain';

const avg = (values: Array<number | null | undefined>) => {
  const usable = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return usable.length ? usable.reduce((sum, v) => sum + v, 0) / usable.length : null;
};

const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, v) => total + (typeof v === 'number' ? v : 0), 0);
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
  const trailing = (days: number) => precip.slice(Math.max(0, idx - days + 1), idx + 1);

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
    rain3: sum(trailing(3)),
    rain7: sum(trailing(7)),
    rain14: sum(trailing(14)),
    rain30: sum(trailing(30)),
    airTemp7: avg(dailyMean.slice(Math.max(0, idx - 6), idx + 1)),
    soilTemp: data.hourly?.soil_temperature_6cm?.[hourIdx] ?? data.hourly?.soil_temperature_7_to_28cm?.[hourIdx] ?? null,
    soilMoisture: data.hourly?.soil_moisture_3_to_9cm?.[hourIdx] ?? data.hourly?.soil_moisture_0_to_7cm?.[hourIdx] ?? null
  };
}

async function fetchRecentWeather(lat: number, lon: number, at: Date): Promise<WeatherSnapshot> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(5),
    longitude: lon.toFixed(5),
    timezone: 'auto',
    past_days: '30',
    forecast_days: '2',
    daily: 'precipitation_sum,temperature_2m_max,temperature_2m_min',
    hourly: 'soil_temperature_6cm,soil_moisture_3_to_9cm'
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error('Météo indisponible');
  return normalizeWeather(await response.json(), at);
}

export function fetchCurrentWeather(lat: number, lon: number) {
  return fetchRecentWeather(lat, lon, new Date());
}

export async function fetchWeatherForDate(lat: number, lon: number, date: Date): Promise<WeatherSnapshot> {
  const ageDays = Math.abs(Date.now() - date.getTime()) / 86400000;
  if (ageDays <= 28) return fetchRecentWeather(lat, lon, date);

  const start = new Date(date);
  start.setDate(start.getDate() - 30);
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
