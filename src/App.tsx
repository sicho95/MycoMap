import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import * as exifr from 'exifr';
import {
  Crosshair,
  Database,
  Layers3,
  LocateFixed,
  MapPin,
  Moon,
  Plus,
  RefreshCw,
  Sun,
  SunMoon,
  Trash2,
  X
} from 'lucide-react';
import type { LatLng, Observation, ObservationOutcome, PotentialPoint, Species, ThemeMode, WeatherSnapshot } from './domain';
import { loadObservations, loadTheme, persistObservations, persistTheme, SPECIES } from './domain';
import { fetchForestZones } from './environment';
import {
  deleteObservationPhoto,
  formatCacheAge,
  getCachedArea,
  isFresh,
  putCachedArea,
  requestPersistentStorage,
  STATIC_CACHE_MAX_AGE_MS,
  storeObservationPhoto,
  WEATHER_CACHE_MAX_AGE_MS
} from './offline';
import { distanceMeters, scoreColor, scoreConditions, scoreLabel, scoreZone } from './scoring';
import { fetchCurrentWeather, fetchWeatherForDate } from './weather';

const FALLBACK: LatLng = { lat: 48.78, lon: 2.26 };
const IGN_PLAN_TILE = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEROW={y}&TILECOL={x}&TILEMATRIX={z}&FORMAT=image/png';
const VIEWPORT_RELOAD_DISTANCE_METERS = 4500;
const AREA_RADIUS_METERS = 25000;

type Sheet = 'observation' | 'spots' | 'data' | null;

type Draft = {
  outcome: ObservationOutcome;
  count: number;
  durationMinutes: number;
  observedAt: Date;
  location: LatLng | null;
  source: Observation['source'];
  photoName?: string;
  photoFile?: File;
};

type ViewportBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const baseStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    ign: {
      type: 'raster',
      tiles: [IGN_PLAN_TILE],
      tileSize: 256,
      attribution: '© IGN · Géoplateforme'
    }
  },
  layers: [{ id: 'ign', type: 'raster', source: 'ign' }]
};

function pointGeojson(points: Array<{ lat: number; lon: number; [key: string]: unknown }>) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] },
      properties: Object.fromEntries(Object.entries(point).filter(([key]) => !['lat', 'lon', 'geometry'].includes(key)))
    }))
  };
}

function polygonGeojson(zones: PotentialPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: zones
      .filter((zone) => zone.geometry)
      .map((zone) => ({
        type: 'Feature' as const,
        geometry: zone.geometry!,
        properties: Object.fromEntries(Object.entries(zone).filter(([key]) => key !== 'geometry'))
      }))
  };
}

function SpeciesIcon({ species, size = 22 }: { species: Species; size?: number }) {
  const common = { width: size, height: size, flex: '0 0 auto', display: 'block' } as const;

  if (species === 'girolles') {
    return (
      <svg viewBox="0 0 24 24" style={common} aria-hidden="true">
        <path d="M3.4 7.2C5.5 4 8.1 5 10.2 3.3c.9-.7 2.6-.7 3.5 0C16 5 18.6 4 20.6 7.2c-1.6 3.2-4.5 4.8-8.6 4.8S5 10.4 3.4 7.2Z" fill="#f3a21a" stroke="#bd6810" strokeWidth="1" strokeLinejoin="round" />
        <path d="M10 11.2c.1 2.4-.5 4.2-2 6.6-.8 1.3.2 2.6 4 2.6s4.8-1.3 4-2.6c-1.5-2.4-2.1-4.2-2-6.6" fill="#f6b63b" stroke="#bd6810" strokeWidth="1" strokeLinejoin="round" />
        <path d="M12 11.1 7.2 7.4M12 11.1l-2.2-5M12 11.1l2.2-5M12 11.1l4.8-3.7" fill="none" stroke="#d77b12" strokeWidth=".8" strokeLinecap="round" />
      </svg>
    );
  }

  if (species === 'morilles') {
    return (
      <svg viewBox="0 0 24 24" style={common} aria-hidden="true">
        <path d="M8.2 12.5C7.1 9 7.8 4.6 10.6 2.4c.8-.6 2-.6 2.8 0 2.8 2.2 3.5 6.6 2.4 10.1-.5 1.5-1.9 2.4-3.8 2.4s-3.3-.9-3.8-2.4Z" fill="#9b6b38" stroke="#5f4026" strokeWidth="1" />
        <path d="M10 14.2c.1 1.8-.5 3.8-1.1 5.2-.4 1 .6 1.8 3.1 1.8s3.5-.8 3.1-1.8c-.6-1.4-1.2-3.4-1.1-5.2" fill="#ead9b8" stroke="#9b7b54" strokeWidth="1" />
        <path d="M9 5.1c1.5 1 4.5 1 6 0M8.5 8.1c1.8 1.1 5.2 1.1 7 0M8.5 11.1c1.8 1 5.2 1 7 0M10.2 3.5c-.6 2.8-.6 6.5 0 9.7M13.8 3.5c.6 2.8.6 6.5 0 9.7M12 2.8c-.5 3.1-.5 7.1 0 11.2" fill="none" stroke="#5f4026" strokeWidth=".65" strokeLinecap="round" opacity=".95" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" style={common} aria-hidden="true">
      <path d="M3.2 9.7C3.8 5.5 7.3 3.1 12 3.1s8.2 2.4 8.8 6.6c-4.7 1.2-12.9 1.2-17.6 0Z" fill="#8f5635" stroke="#613721" strokeWidth="1" />
      <path d="M9.1 9.8c.1 2.3-.8 5.6-1.7 8.5-.4 1.4.8 2.6 4.6 2.6s5-1.2 4.6-2.6c-.9-2.9-1.8-6.2-1.7-8.5" fill="#ead6ac" stroke="#9f825d" strokeWidth="1" />
    </svg>
  );
}

function themeIcon(theme: ThemeMode) {
  if (theme === 'light') return <Sun size={18} />;
  if (theme === 'dark') return <Moon size={18} />;
  return <SunMoon size={18} />;
}

function nextTheme(theme: ThemeMode): ThemeMode {
  if (theme === 'auto') return 'light';
  if (theme === 'light') return 'dark';
  return 'auto';
}

function aspectLabel(aspect: number | null) {
  if (aspect == null) return 'terrain plat / non déterminé';
  const labels = ['Nord', 'Nord-Est', 'Est', 'Sud-Est', 'Sud', 'Sud-Ouest', 'Ouest', 'Nord-Ouest'];
  return labels[Math.round(aspect / 45) % 8];
}

function numberOrDash(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function sameDay(a: Date, b: Date) {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}

function pointInBounds(point: LatLng, bounds: ViewportBounds | null) {
  if (!bounds) return true;
  const lonInside = bounds.west <= bounds.east
    ? point.lon >= bounds.west && point.lon <= bounds.east
    : point.lon >= bounds.west || point.lon <= bounds.east;
  return lonInside && point.lat >= bounds.south && point.lat <= bounds.north;
}

export default function App() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const loadedCenterRef = useRef<LatLng>(FALLBACK);
  const observationsRef = useRef<Observation[]>([]);
  const loadRequestRef = useRef(0);

  const [species, setSpecies] = useState<Species>('cepes');
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [position, setPosition] = useState<LatLng>(FALLBACK);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [zones, setZones] = useState<Awaited<ReturnType<typeof fetchForestZones>>>([]);
  const [observations, setObservations] = useState<Observation[]>(() => loadObservations());
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pickedLocation, setPickedLocation] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>({
    outcome: 'found', count: 1, durationMinutes: 60, observedAt: new Date(), location: null, source: 'gps'
  });

  const potentials = useMemo(() => {
    if (!weather) return [];
    return zones.map((zone) => scoreZone(species, zone, weather, observations));
  }, [zones, weather, species, observations]);

  const visiblePotentials = useMemo(
    () => potentials.filter((item) => pointInBounds(item, viewportBounds)),
    [potentials, viewportBounds]
  );

  const selected = useMemo(() => potentials.find((item) => item.id === selectedId) ?? null, [potentials, selectedId]);

  const dataTarget = useMemo(() => {
    if (selected) return selected;
    const nearby = potentials.filter((candidate) => distanceMeters(candidate, position) <= 12000);
    if (!nearby.length) return null;
    return nearby.reduce((closest, candidate) =>
      distanceMeters(candidate, position) < distanceMeters(closest, position) ? candidate : closest
    );
  }, [selected, potentials, position]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistObservations(observations);
    observationsRef.current = observations;
  }, [observations]);

  useEffect(() => {
    void requestPersistentStorage();
    const onOnline = () => {
      setIsOnline(true);
      void syncPendingObservations();
      void loadArea(currentMapCenter(), false);
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    if (navigator.onLine) void syncPendingObservations();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapNode.current,
      style: baseStyle,
      center: [FALLBACK.lon, FALLBACK.lat],
      zoom: 10.2,
      attributionControl: false,
      cooperativeGestures: false
    });
    map.doubleClickZoom.disable();

    map.on('load', () => {
      map.addSource('potential-polygons', { type: 'geojson', data: polygonGeojson([]) as any });
      map.addLayer({
        id: 'potential-area', type: 'fill', source: 'potential-polygons',
        paint: {
          'fill-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'fill-opacity': ['interpolate', ['linear'], ['get', 'finalScore'], 0, 0.12, 55, 0.24, 90, 0.46]
        }
      });
      map.addLayer({
        id: 'potential-outline', type: 'line', source: 'potential-polygons',
        paint: {
          'line-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1.7],
          'line-opacity': 0.82
        }
      });
      map.addSource('potential-points', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({
        id: 'potential-halo', type: 'circle', source: 'potential-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 18, 12, 36, 15, 58],
          'circle-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'finalScore'], 0, 0.05, 55, 0.13, 90, 0.28],
          'circle-blur': 0.72
        }
      });
      map.addLayer({
        id: 'potential-point', type: 'circle', source: 'potential-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'finalScore'], 0, 2.5, 75, 5.5, 100, 8.5],
          'circle-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'circle-stroke-width': 1.3,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.94
        }
      });
      map.addSource('observations', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({ id: 'observations', type: 'circle', source: 'observations', paint: { 'circle-radius': 6, 'circle-color': '#111814', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      map.addSource('picked', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({ id: 'picked', type: 'circle', source: 'picked', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': '#d61536' } });
      const center = map.getCenter();
      const bounds = map.getBounds();
      setPosition({ lat: center.lat, lon: center.lng });
      setViewportBounds({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
      setMapReady(true);
    });

    const selectPotential = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const id = event.features?.[0]?.properties?.id;
      if (!id) return;
      setSelectedId(String(id));
      setPickedLocation(null);
      setSheet('data');
    };
    map.on('click', 'potential-point', selectPotential);
    map.on('click', 'potential-area', selectPotential);
    map.on('mouseenter', 'potential-area', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'potential-area', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', (event) => {
      const availableLayers = ['potential-point', 'potential-area'].filter((id) => map.getLayer(id));
      const hit = availableLayers.length ? map.queryRenderedFeatures(event.point, { layers: availableLayers }) : [];
      if (hit.length) return;
      setSelectedId(null);
      setPickedLocation({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const polygonSource = mapRef.current?.getSource('potential-polygons') as GeoJSONSource | undefined;
    const pointSource = mapRef.current?.getSource('potential-points') as GeoJSONSource | undefined;
    polygonSource?.setData(polygonGeojson(potentials) as any);
    pointSource?.setData(pointGeojson(potentials));
  }, [potentials, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('observations') as GeoJSONSource | undefined)?.setData(pointGeojson(observations));
  }, [observations, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('picked') as GeoJSONSource | undefined)?.setData(pointGeojson(pickedLocation ? [pickedLocation] : []));
  }, [pickedLocation, mapReady]);

  async function loadArea(target: LatLng, fly = true, force = false) {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setNotice(null);
    setPosition(target);
    loadedCenterRef.current = target;
    setSelectedId(null);
    if (fly) mapRef.current?.flyTo({ center: [target.lon, target.lat], zoom: 11.2, duration: 700 });

    const cached = await getCachedArea(target);
    if (requestId !== loadRequestRef.current) return;
    if (cached) {
      setZones(cached.zones);
      if (cached.weather) setWeather(cached.weather);
      setCacheUpdatedAt(Math.max(cached.staticUpdatedAt, cached.weatherUpdatedAt ?? 0));
    }

    if (!navigator.onLine) {
      setIsOnline(false);
      if (!cached) {
        setZones([]);
        setWeather(null);
        setNotice('Hors ligne : cette zone n’est pas encore en cache. Tu peux quand même enregistrer une sortie ou une photo.');
      }
      if (requestId === loadRequestRef.current) setLoading(false);
      return;
    }

    const staticFresh = !force && !!cached && isFresh(cached.staticUpdatedAt, STATIC_CACHE_MAX_AGE_MS);
    const weatherFresh = !force && !!cached?.weather && isFresh(cached.weatherUpdatedAt, WEATHER_CACHE_MAX_AGE_MS);
    if (staticFresh && weatherFresh) {
      if (requestId === loadRequestRef.current) setLoading(false);
      return;
    }

    const [zoneResult, weatherResult] = await Promise.allSettled([
      staticFresh && cached ? Promise.resolve(cached.zones) : fetchForestZones(target, AREA_RADIUS_METERS),
      weatherFresh && cached?.weather ? Promise.resolve(cached.weather) : fetchCurrentWeather(target.lat, target.lon, force)
    ]);

    if (requestId !== loadRequestRef.current) return;

    const nextZones = zoneResult.status === 'fulfilled' ? zoneResult.value : cached?.zones ?? [];
    const nextWeather = weatherResult.status === 'fulfilled' ? weatherResult.value : cached?.weather ?? null;

    if (nextZones.length) setZones(nextZones);
    if (nextWeather) setWeather(nextWeather);

    if (nextZones.length && nextWeather) {
      const now = Date.now();
      const staticUpdatedAt = staticFresh && cached ? cached.staticUpdatedAt : zoneResult.status === 'fulfilled' ? now : cached?.staticUpdatedAt ?? now;
      const weatherUpdatedAt = weatherFresh && cached ? cached.weatherUpdatedAt : weatherResult.status === 'fulfilled' ? now : cached?.weatherUpdatedAt ?? now;
      await putCachedArea({
        center: target,
        radiusMeters: AREA_RADIUS_METERS,
        zones: nextZones,
        weather: nextWeather,
        staticUpdatedAt,
        weatherUpdatedAt
      });
      if (requestId !== loadRequestRef.current) return;
      setCacheUpdatedAt(Math.max(staticUpdatedAt, weatherUpdatedAt ?? 0));
    }

    if (!nextZones.length || !nextWeather) {
      setNotice(cached ? 'Réseau incomplet : les dernières données en cache restent affichées.' : 'Impossible de charger toutes les données de cette zone.');
    }
    if (requestId === loadRequestRef.current) setLoading(false);
  }

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map) return;
    let timer: number | undefined;
    const onMoveEnd = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      const target = { lat: center.lat, lon: center.lng };
      setPosition(target);
      setViewportBounds({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
      if (distanceMeters(loadedCenterRef.current, target) < VIEWPORT_RELOAD_DISTANCE_METERS) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadArea(target, false), 450);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      if (timer) window.clearTimeout(timer);
      map.off('moveend', onMoveEnd);
    };
  }, [mapReady]);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (result) => void loadArea({ lat: result.coords.latitude, lon: result.coords.longitude }),
      () => void loadArea(FALLBACK),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 }
    );
  }, []);

  function locateMe() {
    navigator.geolocation?.getCurrentPosition(
      (result) => void loadArea({ lat: result.coords.latitude, lon: result.coords.longitude }),
      () => setNotice('Position GPS non disponible'),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 }
    );
  }

  function refreshVisibleArea() {
    const center = currentMapCenter();
    void loadArea(center, false, true);
  }

  function currentMapCenter(): LatLng {
    const center = mapRef.current?.getCenter();
    return center ? { lat: center.lat, lon: center.lng } : position;
  }

  function closeSheet() {
    if (sheet === 'data') setSelectedId(null);
    setSheet(null);
  }

  function openObservation(location = pickedLocation ?? currentMapCenter(), source: Observation['source'] = pickedLocation ? 'map' : 'gps') {
    setDraft({ outcome: 'found', count: 1, durationMinutes: 60, observedAt: new Date(), location, source });
    setSheet('observation');
  }

  async function importPhoto(file: File) {
    try {
      const [gps, metadata] = await Promise.all([exifr.gps(file), exifr.parse(file, ['DateTimeOriginal'])]);
      const location = gps?.latitude != null && gps?.longitude != null
        ? { lat: gps.latitude, lon: gps.longitude }
        : draft.location ?? currentMapCenter();
      const date = metadata?.DateTimeOriginal instanceof Date ? metadata.DateTimeOriginal : new Date();
      setDraft((current) => ({ ...current, location, observedAt: date, source: 'photo', photoName: file.name, photoFile: file }));
      setPickedLocation(location);
      mapRef.current?.flyTo({ center: [location.lon, location.lat], zoom: 13, duration: 650 });
      setNotice(gps ? 'GPS de la photo détecté. La photo sera conservée localement, même hors ligne.' : 'Pas de GPS EXIF : position actuelle conservée.');
    } catch {
      setDraft((current) => ({ ...current, photoName: file.name, photoFile: file, source: 'photo' }));
      setNotice('Métadonnées illisibles : la photo reste conservée localement et tu peux choisir le point sur la carte.');
    }
  }

  async function saveObservation() {
    if (!draft.location) return;
    setSaving(true);
    const id = crypto.randomUUID();
    let snapshot: WeatherSnapshot | undefined;
    let pendingEnrichment = false;

    try {
      snapshot = await fetchWeatherForDate(draft.location.lat, draft.location.lon, draft.observedAt);
    } catch {
      if (weather && sameDay(draft.observedAt, new Date()) && distanceMeters(draft.location, loadedCenterRef.current) < AREA_RADIUS_METERS) {
        snapshot = weather;
      } else {
        pendingEnrichment = true;
      }
    }

    const conditionScore = snapshot ? scoreConditions(species, snapshot, draft.observedAt) : undefined;
    const nearest = zones
      .map((zone) => ({ zone, d: distanceMeters(zone, draft.location!) }))
      .sort((a, b) => a.d - b.d)[0]?.zone;
    const photoStored = draft.photoFile ? await storeObservationPhoto(id, draft.photoFile) : false;

    const item: Observation = {
      id,
      species,
      outcome: draft.outcome,
      count: draft.outcome === 'found' ? Math.max(1, draft.count) : 0,
      durationMinutes: draft.durationMinutes,
      observedAt: draft.observedAt.toISOString(),
      lat: draft.location.lat,
      lon: draft.location.lon,
      source: draft.source,
      photoName: draft.photoName,
      photoStored,
      pendingEnrichment,
      weather: snapshot,
      conditionScore,
      habitatLabel: nearest?.name
    };

    setObservations((current) => [item, ...current]);
    setPickedLocation(null);
    setSheet(null);
    setSaving(false);
    setNotice(pendingEnrichment
      ? 'Sortie enregistrée hors ligne. Le modèle apprend déjà du lieu ; la météo exacte sera ajoutée au retour du réseau.'
      : draft.outcome === 'found'
        ? 'Trouvaille ajoutée : le score local est recalculé immédiatement.'
        : 'Sortie négative enregistrée avec son contexte météo.');
  }

  async function syncPendingObservations() {
    if (!navigator.onLine) return;
    const pending = observationsRef.current.filter((item) => item.pendingEnrichment);
    if (!pending.length) return;

    const updates = new Map<string, Partial<Observation>>();
    for (const item of pending) {
      try {
        const date = new Date(item.observedAt);
        const snapshot = await fetchWeatherForDate(item.lat, item.lon, date, true);
        updates.set(item.id, {
          weather: snapshot,
          conditionScore: scoreConditions(item.species, snapshot, date),
          pendingEnrichment: false
        });
      } catch {
        // On réessaiera au prochain retour réseau.
      }
    }
    if (updates.size) {
      setObservations((current) => current.map((item) => updates.has(item.id) ? { ...item, ...updates.get(item.id)! } : item));
    }
  }

  function deleteObservation(id: string) {
    void deleteObservationPhoto(id);
    setObservations((current) => current.filter((item) => item.id !== id));
  }

  const topScore = visiblePotentials.length ? Math.max(...visiblePotentials.map((item) => item.finalScore)) : null;
  const cacheLabel = cacheUpdatedAt ? formatCacheAge(cacheUpdatedAt) : null;

  return (
    <main className="app-shell">
      <div ref={mapNode} className="map" aria-label="Carte du potentiel mycologique" />
      <div className="map-credit">© IGN</div>

      <header className="top-stack">
        <div className="brand-row glass">
          <div className="brand"><span className="brand-mark">🍄</span><span>MycoMap</span></div>
          <button className="icon-button" onClick={() => setTheme(nextTheme(theme))} aria-label={`Thème ${theme} : changer le thème`}>{themeIcon(theme)}</button>
        </div>
        <div className="species-control glass" role="tablist" aria-label="Champignon recherché">
          {(Object.keys(SPECIES) as Species[]).map((key) => (
            <button key={key} className={species === key ? 'active' : ''} onClick={() => { setSpecies(key); setSelectedId(null); }} role="tab">
              <SpeciesIcon species={key} />{SPECIES[key].label}
            </button>
          ))}
        </div>
        <div className="legend glass" aria-label="Légende du potentiel">
          <span><i className="dot blue" />Faible</span><span><i className="dot green" /></span><span><i className="dot yellow" /></span><span><i className="dot orange" /></span><span><i className="dot red" />Chaud</span>
        </div>
      </header>

      <div className="map-actions">
        <button className="map-button glass" onClick={locateMe} aria-label="Me localiser"><LocateFixed size={20} /></button>
        <button className="map-button glass" onClick={refreshVisibleArea} aria-label="Forcer l’actualisation"><RefreshCw className={loading ? 'spin' : ''} size={20} /></button>
      </div>

      {!selected && (topScore != null || loading) && (
        <div className="status-pill glass">
          <span className="status-dot" style={{ background: topScore != null ? scoreColor(topScore) : '#8b968f' }} />
          {topScore == null
            ? (loading ? 'Analyse de cette zone…' : 'Aucun secteur visible')
            : <>{!isOnline ? 'Hors ligne · écran' : loading ? 'Actualisation · écran' : 'Meilleur secteur visible'} : <b>{topScore}/100</b></>}
        </div>
      )}

      {selected && !sheet && (
        <section className="zone-card glass" onClick={() => setSheet('data')} role="button" aria-label="Ouvrir le détail de cette parcelle">
          <button className="close-mini" onClick={(event) => { event.stopPropagation(); setSelectedId(null); }}><X size={16} /></button>
          <div className="zone-score" style={{ color: scoreColor(selected.finalScore) }}>{selected.finalScore}</div>
          <div className="zone-copy"><b>{scoreLabel(selected.finalScore)}</b><span>{selected.name}</span><small>{selected.reasons.join(' · ')}</small></div>
        </section>
      )}

      {pickedLocation && !sheet && (
        <button className="add-here glass" onClick={() => openObservation(pickedLocation, 'map')}><MapPin size={18} /> Enregistrer une sortie ici</button>
      )}
      {notice && <button className="notice glass" onClick={() => setNotice(null)}>{notice}</button>}

      <nav className="bottom-nav glass" aria-label="Actions principales">
        <button onClick={() => setSheet('spots')}><Database size={21} /><span>Mes coins</span></button>
        <button className="primary-action" onClick={() => openObservation()}><Plus size={27} /><span>Sortie</span></button>
        <button onClick={() => setSheet('data')}><Layers3 size={21} /><span>Données</span></button>
      </nav>

      {sheet && <div className="scrim" onClick={closeSheet} />}

      {sheet === 'observation' && (
        <section className="sheet" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>{SPECIES[species].label}</small><h2>Enregistrer la sortie</h2></div><button className="icon-button" onClick={closeSheet}><X size={20} /></button></div>
          <div className="toggle-row">
            <button className={draft.outcome === 'found' ? 'selected good' : ''} onClick={() => setDraft((d) => ({ ...d, outcome: 'found' }))}><SpeciesIcon species={species} size={21} /> Trouvé</button>
            <button className={draft.outcome === 'none' ? 'selected neutral' : ''} onClick={() => setDraft((d) => ({ ...d, outcome: 'none' }))}>○ Rien trouvé</button>
          </div>
          {draft.outcome === 'found' && <label className="field"><span>Quantité</span><input type="number" inputMode="numeric" min="1" max="999" value={draft.count} onChange={(e) => setDraft((d) => ({ ...d, count: Number(e.target.value) }))} /></label>}
          <div className="field"><span>Temps de recherche</span><div className="chips">{[30, 60, 120, 180].map((minutes) => <button key={minutes} className={draft.durationMinutes === minutes ? 'active' : ''} onClick={() => setDraft((d) => ({ ...d, durationMinutes: minutes }))}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</button>)}</div></div>
          <div className="auto-card"><Crosshair size={18} /><div><b>{draft.source === 'photo' ? 'Position de la photo' : draft.source === 'map' ? 'Position choisie sur la carte' : 'Position GPS'}</b><span>{draft.location ? `${draft.location.lat.toFixed(5)}, ${draft.location.lon.toFixed(5)}` : 'Recherche…'}</span></div></div>
          <div className="auto-card"><RefreshCw size={18} /><div><b>{isOnline ? 'Conditions automatiques' : 'Mode hors ligne'}</b><span>{isOnline ? 'Météo de la date + forêt IGN + relief + sol. Les données déjà en cache s’affichent immédiatement.' : 'La sortie et la photo sont enregistrées sur cet appareil. Le score personnel se recalcule tout de suite ; les données manquantes seront complétées plus tard.'}</span></div></div>
          <input ref={photoInput} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && void importPhoto(e.target.files[0])} />
          <button className="secondary-button" onClick={() => photoInput.current?.click()}>{draft.photoName ? `Photo : ${draft.photoName}` : 'Importer une photo géolocalisée'}</button>
          <button className="save-button" disabled={saving || !draft.location} onClick={() => void saveObservation()}>{saving ? 'Enregistrement…' : isOnline ? 'Enregistrer et faire apprendre le modèle' : 'Enregistrer hors ligne'}</button>
        </section>
      )}

      {sheet === 'spots' && (
        <section className="sheet sheet-list" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>Privé sur cet appareil</small><h2>Mes coins & sorties</h2></div><button className="icon-button" onClick={closeSheet}><X size={20} /></button></div>
          <div className="observations-list">
            {observations.length === 0 && <div className="empty">Aucune sortie enregistrée pour l’instant.</div>}
            {observations.map((obs) => (
              <article className="observation" key={obs.id} onClick={() => { mapRef.current?.flyTo({ center: [obs.lon, obs.lat], zoom: 14 }); setSheet(null); }}>
                <div className={`result-icon ${obs.outcome}`}>{obs.outcome === 'found' ? <SpeciesIcon species={obs.species} size={26} /> : '○'}</div>
                <div><b>{SPECIES[obs.species].label} · {obs.outcome === 'found' ? `${obs.count} trouvé${obs.count > 1 ? 's' : ''}` : 'rien trouvé'}</b><span>{new Date(obs.observedAt).toLocaleDateString('fr-FR')} · {obs.durationMinutes} min · météo {obs.conditionScore ?? '—'}/100{obs.pendingEnrichment ? ' · à compléter' : ''}</span>{obs.photoStored && <small>Photo conservée hors ligne</small>}{obs.habitatLabel && <small>{obs.habitatLabel}</small>}</div>
                <button className="delete" onClick={(e) => { e.stopPropagation(); deleteObservation(obs.id); }}><Trash2 size={17} /></button>
              </article>
            ))}
          </div>
        </section>
      )}

      {sheet === 'data' && (
        <section className="sheet sheet-data" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>{selected ? 'Parcelle sélectionnée' : 'Parcelle la plus proche du centre'}{cacheLabel ? ` · maj ${cacheLabel}` : ''}</small><h2>Données de la zone</h2></div><button className="icon-button" onClick={closeSheet}><X size={20} /></button></div>
          {!dataTarget || !weather ? (
            <div className="empty">{loading ? 'Analyse de la zone en cours…' : !isOnline ? 'Zone non disponible dans le cache hors ligne.' : 'Aucune parcelle analysée disponible ici pour le moment.'}</div>
          ) : (
            <>
              <div className="data-summary"><div className="data-total" style={{ color: scoreColor(dataTarget.finalScore) }}>{dataTarget.finalScore}</div><div><b>{scoreLabel(dataTarget.finalScore)}</b><span>{dataTarget.name}</span><small>{dataTarget.lat.toFixed(5)}, {dataTarget.lon.toFixed(5)}</small></div></div>
              <div className="score-strip">
                <div><b>{dataTarget.forestScore}</b><span>Forêt</span></div><div><b>{dataTarget.soilScore}</b><span>Sol</span></div><div><b>{dataTarget.terrainScore}</b><span>Relief</span></div><div><b>{dataTarget.conditionScore}</b><span>Moment</span></div><div><b>{dataTarget.personalCorrection > 0 ? `+${dataTarget.personalCorrection}` : dataTarget.personalCorrection}</b><span>Terrain réel</span></div>
              </div>
              <div className="data-section"><h3>Forêt</h3><div className="metric-row"><span>Formation</span><b>{dataTarget.forestType || dataTarget.name || '—'}</b></div><div className="metric-row"><span>Essence dominante</span><b>{dataTarget.essence || 'Non précisée'}</b></div><div className="metric-row"><span>Code IGN</span><b>{dataTarget.forestCode || '—'}</b></div></div>
              <div className="data-section"><h3>Relief</h3><div className="metric-row"><span>Altitude</span><b>{numberOrDash(dataTarget.elevation)} m</b></div><div className="metric-row"><span>Pente</span><b>{numberOrDash(dataTarget.slope, 1)}°</b></div><div className="metric-row"><span>Exposition</span><b>{aspectLabel(dataTarget.aspect)}</b></div></div>
              <div className="data-section"><h3>Sol</h3>{dataTarget.soil ? <><div className="metric-row"><span>pH</span><b>{numberOrDash(dataTarget.soil.ph, 1)}</b></div><div className="metric-row"><span>Texture</span><b>{dataTarget.soil.textureClass}</b></div><div className="metric-row"><span>Drainage estimé</span><b>{dataTarget.soil.drainageClass}</b></div><div className="metric-row"><span>Sable</span><b>{numberOrDash(dataTarget.soil.sandPct, 1)} %</b></div><div className="metric-row"><span>Limon</span><b>{numberOrDash(dataTarget.soil.siltPct, 1)} %</b></div><div className="metric-row"><span>Argile</span><b>{numberOrDash(dataTarget.soil.clayPct, 1)} %</b></div><div className="metric-row"><span>Éléments grossiers</span><b>{numberOrDash(dataTarget.soil.coarseFragmentsPct, 1)} %</b></div><div className="metric-row"><span>Réserve en eau estimée</span><b>{numberOrDash(dataTarget.soil.availableWaterPct, 1)} %</b></div></> : <div className="data-unavailable">Données pédologiques structurées indisponibles pour cette parcelle.</div>}</div>
              <div className="data-section"><h3>Météo utilisée</h3><div className="metric-row"><span>Pluie 3 jours</span><b>{numberOrDash(weather.rain3, 1)} mm</b></div><div className="metric-row"><span>Pluie 7 jours</span><b>{numberOrDash(weather.rain7, 1)} mm</b></div><div className="metric-row"><span>Pluie 14 jours</span><b>{numberOrDash(weather.rain14, 1)} mm</b></div><div className="metric-row"><span>Pluie 30 jours</span><b>{numberOrDash(weather.rain30, 1)} mm</b></div><div className="metric-row"><span>Humidité du sol</span><b>{weather.soilMoisture == null ? '—' : `${(weather.soilMoisture * 100).toFixed(1)} %`}</b></div><div className="metric-row"><span>Température du sol</span><b>{numberOrDash(weather.soilTemp, 1)} °C</b></div><div className="metric-row"><span>Température moyenne 7 j</span><b>{numberOrDash(weather.airTemp7, 1)} °C</b></div></div>
              <p className="data-note">{isOnline ? 'Le cache est affiché immédiatement puis actualisé silencieusement selon la fraîcheur des sources.' : 'Mode hors ligne : le score utilise les dernières données locales disponibles. Les nouvelles observations modifient immédiatement la correction terrain.'}</p>
              <p className="data-credits">Sources : IGN BD Forêt v2 et RGE ALTI · SoilGrids 2.0 / ISRIC · Open-Meteo.</p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
