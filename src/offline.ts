import type { ForestZone, LatLng, WeatherSnapshot } from './domain';

const DB_NAME = 'mycomap-offline';
const DB_VERSION = 1;
const AREA_STORE = 'areas';
const WEATHER_STORE = 'weather';
const PHOTO_STORE = 'photos';
const CELL_DEGREES = 0.05;

export const STATIC_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const WEATHER_CACHE_MAX_AGE_MS = 45 * 60 * 1000;

export interface CachedArea {
  key: string;
  center: LatLng;
  radiusMeters: number;
  zones: ForestZone[];
  weather: WeatherSnapshot | null;
  staticUpdatedAt: number;
  weatherUpdatedAt: number | null;
}

interface CachedWeather {
  key: string;
  snapshot: WeatherSnapshot;
  updatedAt: number;
}

interface StoredPhoto {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  storedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AREA_STORE)) db.createObjectStore(AREA_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(WEATHER_STORE)) db.createObjectStore(WEATHER_STORE, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB indisponible'));
  });
}

async function readStore<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openDb();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeStore(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function deleteStoreValue(storeName: string, key: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function areaCacheKey(point: LatLng) {
  const latCell = Math.floor(point.lat / CELL_DEGREES);
  const lonCell = Math.floor(point.lon / CELL_DEGREES);
  return `area:${latCell}:${lonCell}`;
}

function weatherCacheKey(lat: number, lon: number, date: Date) {
  const latCell = Math.round(lat / 0.02);
  const lonCell = Math.round(lon / 0.02);
  return `weather:${latCell}:${lonCell}:${date.toISOString().slice(0, 10)}`;
}

export async function getCachedArea(point: LatLng): Promise<CachedArea | null> {
  try {
    return await readStore<CachedArea>(AREA_STORE, areaCacheKey(point));
  } catch {
    return null;
  }
}

export async function putCachedArea(area: Omit<CachedArea, 'key'>): Promise<void> {
  try {
    await writeStore(AREA_STORE, { ...area, key: areaCacheKey(area.center) } satisfies CachedArea);
  } catch (error) {
    console.warn('Cache spatial IndexedDB indisponible', error);
  }
}

export async function getCachedWeather(lat: number, lon: number, date: Date): Promise<CachedWeather | null> {
  try {
    return await readStore<CachedWeather>(WEATHER_STORE, weatherCacheKey(lat, lon, date));
  } catch {
    return null;
  }
}

export async function putCachedWeather(lat: number, lon: number, date: Date, snapshot: WeatherSnapshot): Promise<void> {
  try {
    const value: CachedWeather = {
      key: weatherCacheKey(lat, lon, date),
      snapshot,
      updatedAt: Date.now()
    };
    await writeStore(WEATHER_STORE, value);
  } catch (error) {
    console.warn('Cache météo IndexedDB indisponible', error);
  }
}

export async function storeObservationPhoto(id: string, file: File): Promise<boolean> {
  try {
    const value: StoredPhoto = {
      id,
      blob: file,
      name: file.name,
      type: file.type,
      size: file.size,
      storedAt: Date.now()
    };
    await writeStore(PHOTO_STORE, value);
    return true;
  } catch (error) {
    console.warn('Photo non stockée hors ligne', error);
    return false;
  }
}

export async function getObservationPhoto(id: string): Promise<StoredPhoto | null> {
  try {
    return await readStore<StoredPhoto>(PHOTO_STORE, id);
  } catch {
    return null;
  }
}

export async function deleteObservationPhoto(id: string): Promise<void> {
  try {
    await deleteStoreValue(PHOTO_STORE, id);
  } catch {
    // La suppression de l'observation reste prioritaire même si IndexedDB échoue.
  }
}

export async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Certains WebKit ne proposent pas ou refusent silencieusement la persistance.
  }
}

export function isFresh(timestamp: number | null | undefined, maxAgeMs: number) {
  return timestamp != null && Date.now() - timestamp <= maxAgeMs;
}

export function formatCacheAge(timestamp: number | null | undefined) {
  if (!timestamp) return 'jamais';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `il y a ${hours} h`;
  return new Date(timestamp).toLocaleDateString('fr-FR');
}
