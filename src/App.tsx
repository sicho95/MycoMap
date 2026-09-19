import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import * as exifr from 'exifr';
import {
  Crosshair,
  Database,
  Download,
  Layers3,
  LocateFixed,
  MapPin,
  Moon,
  Plus,
  RefreshCw,
  Star,
  Bell,
  Sun,
  SunMoon,
  Trash2,
  X
} from 'lucide-react';
import type { FavoriteSpot, LatLng, Observation, ObservationOutcome, PotentialPoint, Species, ThemeMode, WeatherSnapshot } from './domain';
import { loadObservations, loadTheme, persistObservations, persistTheme, SPECIES } from './domain';
import { fetchForestZones } from './environment';
import { favoriteFromPotential, favoriteId, loadFavorites, persistFavorites } from './favorites';
import {
  deleteObservationPhoto,
  formatCacheAge,
  getCachedArea,
  getCachedWeather,
  isFresh,
  putCachedArea,
  requestPersistentStorage,
  STATIC_CACHE_MAX_AGE_MS,
  storeObservationPhoto,
  WEATHER_CACHE_MAX_AGE_MS
} from './offline';
import { distanceMeters, scoreColor, scoreLabel, scoreMoment, scoreZone } from './scoring';
import { fetchCurrentWeather, fetchWeatherForDate } from './weather';

const FALLBACK: LatLng = { lat: 48.78, lon: 2.26 };
const IGN_PLAN_TILE = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEROW={y}&TILECOL={x}&TILEMATRIX={z}&FORMAT=image/png';
const VIEWPORT_RELOAD_DISTANCE_METERS = 4500;
const AREA_RADIUS_METERS = 25000;
const DISPLAY_MIN_SCORE = 50;
const WEATHER_REUSE_DISTANCE_METERS = 3500;
const STATIC_REVALIDATE_DISTANCE_METERS = 7000;

type Sheet = 'observation' | 'spots' | 'data' | null;
type MapMode = 'now' | 'habitat';

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

type GpsFix = LatLng & {
  accuracy: number;
  heading: number | null;
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

function favoritePointsGeojson(items: FavoriteSpot[]) {
  return pointGeojson(items.map((item) => ({
    lat: item.lat,
    lon: item.lon,
    favoriteId: item.id,
    zoneId: item.zone.id,
    species: item.species,
    lastScore: item.lastScore ?? -1
  })));
}

function favoritePolygonsGeojson(items: FavoriteSpot[]) {
  return {
    type: 'FeatureCollection' as const,
    features: items
      .filter((item) => item.zone.geometry)
      .map((item) => ({
        type: 'Feature' as const,
        geometry: item.zone.geometry!,
        properties: {
          favoriteId: item.id,
          zoneId: item.zone.id,
          species: item.species,
          lastScore: item.lastScore ?? -1
        }
      }))
  };
}

function selectedFavoritePolygonGeojson(item: FavoriteSpot | null) {
  return {
    type: 'FeatureCollection' as const,
    features: item?.zone.geometry ? [{
      type: 'Feature' as const,
      geometry: item.zone.geometry,
      properties: { favoriteId: item.id }
    }] : []
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

function bearingBetween(a: LatLng, b: LatLng) {
  const toRad = (value: number) => value * Math.PI / 180;
  const toDeg = (value: number) => value * 180 / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function destinationPoint(origin: LatLng, bearing: number, distanceMetersValue: number): LatLng {
  const radius = 6371000;
  const angular = distanceMetersValue / radius;
  const brng = bearing * Math.PI / 180;
  const lat1 = origin.lat * Math.PI / 180;
  const lon1 = origin.lon * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brng));
  const lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
}

function headingGeojson(position: LatLng | null, heading: number | null) {
  if (!position || heading == null || !Number.isFinite(heading)) {
    return { type: 'FeatureCollection' as const, features: [] };
  }
  const left = destinationPoint(position, heading - 24, 62);
  const front = destinationPoint(position, heading, 92);
  const right = destinationPoint(position, heading + 24, 62);
  return {
    type: 'FeatureCollection' as const,
    features: [{
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [position.lon, position.lat],
          [left.lon, left.lat],
          [front.lon, front.lat],
          [right.lon, right.lat],
          [position.lon, position.lat]
        ]]
      },
      properties: {}
    }]
  };
}

export default function App() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const loadedCenterRef = useRef<LatLng>(FALLBACK);
  const observationsRef = useRef<Observation[]>([]);
  const favoritesRef = useRef<FavoriteSpot[]>([]);
  const loadRequestRef = useRef(0);
  const gpsWatchRef = useRef<number | null>(null);
  const gpsFirstFixRef = useRef(false);
  const lastGpsRef = useRef<LatLng | null>(null);
  const compassHeadingRef = useRef<number | null>(null);
  const compassHandlerRef = useRef<((event: DeviceOrientationEvent) => void) | null>(null);
  const userMovedMapRef = useRef(false);

  const [species, setSpecies] = useState<Species>('cepes');
  const [mapMode, setMapMode] = useState<MapMode>('now');
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [position, setPosition] = useState<LatLng>(FALLBACK);
  const [viewportBounds, setViewportBounds] = useState<ViewportBounds | null>(null);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [zones, setZones] = useState<Awaited<ReturnType<typeof fetchForestZones>>>([]);
  const [observations, setObservations] = useState<Observation[]>(() => loadObservations());
  const [favorites, setFavorites] = useState<FavoriteSpot[]>(() => loadFavorites());
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pickedLocation, setPickedLocation] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFavoriteId, setSelectedFavoriteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [cacheUpdatedAt, setCacheUpdatedAt] = useState<number | null>(null);
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [gpsTracking, setGpsTracking] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    outcome: 'found', count: 1, durationMinutes: 60, observedAt: new Date(), location: null, source: 'gps'
  });

  const potentials = useMemo(() => {
    if (!weather) return [];
    return zones.map((zone) => scoreZone(species, zone, weather, observations));
  }, [zones, weather, species, observations]);

  const displayPotentials = useMemo(
    () => potentials
      .map((item) => ({ ...item, displayScore: mapMode === 'habitat' ? item.habitatScore : item.finalScore }))
      .filter((item) => item.displayScore >= DISPLAY_MIN_SCORE),
    [potentials, mapMode]
  );

  const visiblePotentials = useMemo(
    () => displayPotentials.filter((item) => pointInBounds(item, viewportBounds)),
    [displayPotentials, viewportBounds]
  );

  const selected = useMemo(() => potentials.find((item) => item.id === selectedId) ?? null, [potentials, selectedId]);
  const selectedFavorite = useMemo(() => favorites.find((item) => item.id === selectedFavoriteId) ?? null, [favorites, selectedFavoriteId]);
  const selectedDisplayScore = selected ? (mapMode === 'habitat' ? selected.habitatScore : selected.finalScore) : null;

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
    persistFavorites(favorites);
    favoritesRef.current = favorites;
  }, [favorites]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refreshFavorites();
    };
    const initialTimer = window.setTimeout(refresh, 1200);
    const interval = window.setInterval(refresh, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const id = new URLSearchParams(window.location.search).get('favorite');
    if (!id) return;
    const favorite = favorites.find((item) => item.id === id);
    if (!favorite) return;
    void focusFavorite(favorite).finally(() => {
      window.history.replaceState({}, '', import.meta.env.BASE_URL);
    });
  }, [mapReady, favorites]);

  useEffect(() => () => {
    if (gpsWatchRef.current != null) navigator.geolocation?.clearWatch(gpsWatchRef.current);
    if (compassHandlerRef.current) window.removeEventListener('deviceorientation', compassHandlerRef.current, true);
  }, []);

  useEffect(() => {
    void requestPersistentStorage();
    const onOnline = () => {
      setIsOnline(true);
      void syncPendingObservations();
      void refreshFavorites();
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
          'fill-color': ['interpolate', ['linear'], ['get', 'displayScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
          'fill-opacity': ['interpolate', ['linear'], ['get', 'displayScore'], 50, 0.16, 62.5, 0.20, 75, 0.27, 87.5, 0.36, 100, 0.48]
        }
      });
      map.addLayer({
        id: 'potential-outline', type: 'line', source: 'potential-polygons',
        paint: {
          'line-color': ['interpolate', ['linear'], ['get', 'displayScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 14, 1.7],
          'line-opacity': 0.82
        }
      });
      map.addSource('potential-points', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({
        id: 'potential-halo', type: 'circle', source: 'potential-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 18, 12, 36, 15, 58],
          'circle-color': ['interpolate', ['linear'], ['get', 'displayScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
          'circle-opacity': ['interpolate', ['linear'], ['get', 'displayScore'], 50, 0.07, 62.5, 0.11, 75, 0.16, 87.5, 0.23, 100, 0.30],
          'circle-blur': 0.72
        }
      });
      map.addLayer({
        id: 'potential-point', type: 'circle', source: 'potential-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'displayScore'], 50, 3, 75, 5.5, 100, 8.5],
          'circle-color': ['interpolate', ['linear'], ['get', 'displayScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
          'circle-stroke-width': 1.3,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.94
        }
      });

      map.addSource('favorite-polygons', { type: 'geojson', data: favoritePolygonsGeojson([]) as any });
      map.addLayer({
        id: 'favorite-area',
        type: 'fill',
        source: 'favorite-polygons',
        minzoom: 9,
        paint: {
          'fill-color': ['case',
            ['>=', ['get', 'lastScore'], 50],
            ['interpolate', ['linear'], ['get', 'lastScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
            '#69736d'
          ],
          'fill-opacity': ['case', ['>=', ['get', 'lastScore'], 50], 0.24, 0.12]
        }
      });
      map.addLayer({
        id: 'favorite-outline',
        type: 'line',
        source: 'favorite-polygons',
        minzoom: 9,
        paint: {
          'line-color': ['case',
            ['>=', ['get', 'lastScore'], 50],
            ['interpolate', ['linear'], ['get', 'lastScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
            '#69736d'
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 14, 2.5],
          'line-opacity': 0.95
        }
      });
      map.addSource('favorite-points', { type: 'geojson', data: favoritePointsGeojson([]) });
      map.addLayer({
        id: 'favorite-point-halo',
        type: 'circle',
        source: 'favorite-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 7, 9, 9, 14, 11],
          'circle-color': '#ffffff',
          'circle-opacity': 0.95,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#202823'
        }
      });
      map.addLayer({
        id: 'favorite-point',
        type: 'circle',
        source: 'favorite-points',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4.5, 9, 6, 14, 7.5],
          'circle-color': ['case',
            ['>=', ['get', 'lastScore'], 50],
            ['interpolate', ['linear'], ['get', 'lastScore'], 50, '#3b82c4', 62.5, '#43a867', 75, '#f0c52e', 87.5, '#ff5b2e', 100, '#d61536'],
            '#69736d'
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff'
        }
      });

      map.addSource('selected-favorite-polygon', { type: 'geojson', data: selectedFavoritePolygonGeojson(null) as any });
      map.addLayer({
        id: 'selected-favorite-area',
        type: 'fill',
        source: 'selected-favorite-polygon',
        minzoom: 8,
        paint: { 'fill-color': '#7c3aed', 'fill-opacity': 0.11 }
      });
      map.addLayer({
        id: 'selected-favorite-outline',
        type: 'line',
        source: 'selected-favorite-polygon',
        minzoom: 8,
        paint: {
          'line-color': '#7c3aed',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.4, 14, 4.5],
          'line-opacity': 1
        }
      });
      map.addSource('selected-favorite-point', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({
        id: 'selected-favorite-point',
        type: 'circle',
        source: 'selected-favorite-point',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 9, 12, 14, 15],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#7c3aed'
        }
      });

      map.addSource('observations', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({ id: 'observations', type: 'circle', source: 'observations', paint: { 'circle-radius': 6, 'circle-color': '#111814', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' } });
      map.addSource('picked', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({ id: 'picked', type: 'circle', source: 'picked', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': '#d61536' } });

      map.addSource('user-heading', { type: 'geojson', data: headingGeojson(null, null) as any });
      map.addLayer({
        id: 'user-heading',
        type: 'fill',
        source: 'user-heading',
        paint: { 'fill-color': '#1976e9', 'fill-opacity': 0.20 }
      });
      map.addLayer({
        id: 'user-heading-outline',
        type: 'line',
        source: 'user-heading',
        paint: { 'line-color': '#1976e9', 'line-width': 1.4, 'line-opacity': 0.58 }
      });
      map.addSource('user-location', { type: 'geojson', data: pointGeojson([]) });
      map.addLayer({
        id: 'user-location-halo',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 14,
          'circle-color': '#1976e9',
          'circle-opacity': 0.18
        }
      });
      map.addLayer({
        id: 'user-location',
        type: 'circle',
        source: 'user-location',
        paint: {
          'circle-radius': 7,
          'circle-color': '#1976e9',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 1
        }
      });
      const center = map.getCenter();
      const bounds = map.getBounds();
      setPosition({ lat: center.lat, lon: center.lng });
      setViewportBounds({ west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() });
      setMapReady(true);
    });

    const selectPotential = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const id = event.features?.[0]?.properties?.id;
      if (!id) return;
      const zoneId = String(id);
      setSelectedId(zoneId);
      setSelectedFavoriteId((current) => {
        if (!current) return null;
        const favorite = favoritesRef.current.find((item) => item.id === current);
        return favorite?.zone.id === zoneId ? current : null;
      });
      setPickedLocation(null);
      setSheet(null);
    };
    const selectFavoriteOnMap = (event: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const id = event.features?.[0]?.properties?.favoriteId;
      if (!id) return;
      const favorite = favoritesRef.current.find((item) => item.id === String(id));
      if (!favorite) return;
      setSelectedFavoriteId(favorite.id);
      void focusFavorite(favorite);
    };
    map.on('click', 'favorite-point', selectFavoriteOnMap);
    map.on('click', 'favorite-area', selectFavoriteOnMap);
    map.on('click', 'potential-point', selectPotential);
    map.on('click', 'potential-area', selectPotential);
    map.on('movestart', (event) => {
      if ((event as maplibregl.MapLibreEvent & { originalEvent?: Event }).originalEvent) userMovedMapRef.current = true;
    });
    map.on('mouseenter', 'potential-area', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'potential-area', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'favorite-point', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'favorite-point', () => { map.getCanvas().style.cursor = ''; });
    map.on('mouseenter', 'favorite-area', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'favorite-area', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', (event) => {
      const availableLayers = ['favorite-point', 'favorite-area', 'potential-point', 'potential-area'].filter((id) => map.getLayer(id));
      const hit = availableLayers.length ? map.queryRenderedFeatures(event.point, { layers: availableLayers }) : [];
      if (hit.length) return;
      setSelectedId(null);
      setSelectedFavoriteId(null);
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
    polygonSource?.setData(polygonGeojson(displayPotentials) as any);
    pointSource?.setData(pointGeojson(displayPotentials));
  }, [displayPotentials, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('favorite-polygons') as GeoJSONSource | undefined)?.setData(favoritePolygonsGeojson(favorites) as any);
    (mapRef.current?.getSource('favorite-points') as GeoJSONSource | undefined)?.setData(favoritePointsGeojson(favorites));
  }, [favorites, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('selected-favorite-polygon') as GeoJSONSource | undefined)?.setData(selectedFavoritePolygonGeojson(selectedFavorite) as any);
    (mapRef.current?.getSource('selected-favorite-point') as GeoJSONSource | undefined)?.setData(pointGeojson(selectedFavorite ? [{ lat: selectedFavorite.lat, lon: selectedFavorite.lon }] : []));
  }, [selectedFavorite, mapReady]);

  useEffect(() => {
    if (!zones.length) return;
    setFavorites((current) => {
      let changed = false;
      const next = current.map((favorite) => {
        if (favorite.zone.geometry) return favorite;
        const zone = zones.find((candidate) => candidate.id === favorite.zone.id);
        if (!zone?.geometry) return favorite;
        changed = true;
        return {
          ...favorite,
          lat: zone.lat,
          lon: zone.lon,
          zone: { ...zone }
        };
      });
      return changed ? next : current;
    });
  }, [zones]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('observations') as GeoJSONSource | undefined)?.setData(pointGeojson(observations));
  }, [observations, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('picked') as GeoJSONSource | undefined)?.setData(pointGeojson(pickedLocation ? [pickedLocation] : []));
  }, [pickedLocation, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('user-location') as GeoJSONSource | undefined)?.setData(pointGeojson(gpsFix ? [gpsFix] : []));
    (mapRef.current?.getSource('user-heading') as GeoJSONSource | undefined)?.setData(headingGeojson(gpsFix, gpsFix?.heading ?? null) as any);
  }, [gpsFix, mapReady]);

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

    const cachedDistance = cached ? distanceMeters(cached.center, target) : Number.POSITIVE_INFINITY;
    const areaWeatherIsLocal = cachedDistance <= WEATHER_REUSE_DISTANCE_METERS;
    let localWeatherCache = null as Awaited<ReturnType<typeof getCachedWeather>>;

    if (cached) {
      setZones(cached.zones);
      if (cached.weather && areaWeatherIsLocal) setWeather(cached.weather);
      setCacheUpdatedAt(Math.max(cached.staticUpdatedAt, areaWeatherIsLocal ? cached.weatherUpdatedAt ?? 0 : 0));
    }

    if (!areaWeatherIsLocal) {
      localWeatherCache = await getCachedWeather(target.lat, target.lon, new Date());
      if (requestId !== loadRequestRef.current) return;
      if (localWeatherCache) {
        setWeather(localWeatherCache.snapshot);
        setCacheUpdatedAt((current) => Math.max(current ?? 0, localWeatherCache?.updatedAt ?? 0));
      }
    }

    if (!navigator.onLine) {
      setIsOnline(false);
      if (!cached) {
        setZones([]);
        if (!localWeatherCache) setWeather(null);
        setNotice('Hors ligne : cette zone n’est pas encore en cache. Tu peux quand même enregistrer une sortie ou une photo.');
      }
      if (requestId === loadRequestRef.current) setLoading(false);
      return;
    }

    const staticFresh = !force && !!cached && cachedDistance <= STATIC_REVALIDATE_DISTANCE_METERS && isFresh(cached.staticUpdatedAt, STATIC_CACHE_MAX_AGE_MS);
    const reusableWeather = areaWeatherIsLocal ? cached?.weather ?? null : localWeatherCache?.snapshot ?? null;
    const reusableWeatherUpdatedAt = areaWeatherIsLocal ? cached?.weatherUpdatedAt ?? null : localWeatherCache?.updatedAt ?? null;
    const weatherFresh = !force && !!reusableWeather && isFresh(reusableWeatherUpdatedAt, WEATHER_CACHE_MAX_AGE_MS);
    if (staticFresh && weatherFresh) {
      if (requestId === loadRequestRef.current) setLoading(false);
      return;
    }

    const [zoneResult, weatherResult] = await Promise.allSettled([
      staticFresh && cached ? Promise.resolve(cached.zones) : fetchForestZones(target, AREA_RADIUS_METERS),
      weatherFresh && reusableWeather ? Promise.resolve(reusableWeather) : fetchCurrentWeather(target.lat, target.lon, force)
    ]);

    if (requestId !== loadRequestRef.current) return;

    const nextZones = zoneResult.status === 'fulfilled' ? zoneResult.value : cached?.zones ?? [];
    const nextWeather = weatherResult.status === 'fulfilled' ? weatherResult.value : reusableWeather ?? null;

    if (nextZones.length) setZones(nextZones);
    if (nextWeather) setWeather(nextWeather);

    if (nextZones.length && nextWeather) {
      const now = Date.now();
      const staticUpdatedAt = staticFresh && cached ? cached.staticUpdatedAt : zoneResult.status === 'fulfilled' ? now : cached?.staticUpdatedAt ?? now;
      const weatherUpdatedAt = weatherFresh ? reusableWeatherUpdatedAt : weatherResult.status === 'fulfilled' ? now : reusableWeatherUpdatedAt ?? cached?.weatherUpdatedAt ?? now;
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
      (result) => {
        if (!userMovedMapRef.current) void loadArea({ lat: result.coords.latitude, lon: result.coords.longitude });
      },
      () => {
        if (!userMovedMapRef.current) void loadArea(FALLBACK);
      },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 }
    );
  }, []);

  function attachCompassListener() {
    if (compassHandlerRef.current) return;
    const handler = (event: DeviceOrientationEvent) => {
      const iosHeading = (event as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
      const absoluteHeading = event.absolute && event.alpha != null ? (360 - event.alpha + 360) % 360 : null;
      const heading = Number.isFinite(iosHeading) ? Number(iosHeading) : absoluteHeading;
      if (heading == null || !Number.isFinite(heading)) return;
      compassHeadingRef.current = heading;
      setGpsFix((current) => current ? { ...current, heading } : current);
    };
    compassHandlerRef.current = handler;
    window.addEventListener('deviceorientation', handler, true);
  }

  async function enableCompass() {
    const orientationApi = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (orientationApi.requestPermission) {
      try {
        if (await orientationApi.requestPermission() !== 'granted') return;
      } catch {
        return;
      }
    }
    attachCompassListener();
  }

  function updateGpsFix(result: GeolocationPosition, recenter: boolean) {
    const next = { lat: result.coords.latitude, lon: result.coords.longitude };
    let heading = compassHeadingRef.current;
    if (heading == null && result.coords.heading != null && Number.isFinite(result.coords.heading)) {
      heading = result.coords.heading;
    }
    if (heading == null && lastGpsRef.current && distanceMeters(lastGpsRef.current, next) >= 3) {
      heading = bearingBetween(lastGpsRef.current, next);
    }
    lastGpsRef.current = next;
    setGpsFix({ ...next, accuracy: result.coords.accuracy, heading });
    if (recenter) {
      userMovedMapRef.current = false;
      void loadArea(next, true);
    }
  }

  function locateMe() {
    void enableCompass();
    if (gpsWatchRef.current != null) {
      if (gpsFix) mapRef.current?.flyTo({ center: [gpsFix.lon, gpsFix.lat], zoom: Math.max(mapRef.current?.getZoom() ?? 15, 15), duration: 550 });
      return;
    }
    if (!navigator.geolocation) {
      setNotice('Géolocalisation non disponible sur cet appareil');
      return;
    }
    setGpsTracking(true);
    gpsFirstFixRef.current = true;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      (result) => {
        const first = gpsFirstFixRef.current;
        gpsFirstFixRef.current = false;
        updateGpsFix(result, first);
      },
      () => {
        setGpsTracking(false);
        if (gpsWatchRef.current != null) navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
        setNotice('Position GPS non disponible');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 1500 }
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
    setSheet(null);
  }

  function isFavorite(point: PotentialPoint, targetSpecies = species) {
    return favorites.some((item) => item.id === favoriteId(targetSpecies, point.id));
  }

  async function requestFavoriteNotifications() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return await Notification.requestPermission() === 'granted';
    } catch {
      return false;
    }
  }

  async function showFavoriteNotification(item: FavoriteSpot) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const registration = await navigator.serviceWorker?.ready;
      if (!registration) return;
      const target = `${import.meta.env.BASE_URL}?favorite=${encodeURIComponent(item.id)}`;
      await registration.showNotification(`MycoMap · ${SPECIES[item.species].label} · palier ${item.lastAlertLevel ?? 50}/100`, {
        body: `${item.zone.name} est à ${item.lastScore ?? '—'}/100 · habitat ${item.lastHabitatScore ?? '—'}/100.`,
        tag: `mycomap-favorite-${item.id}`,
        data: { url: target, favoriteId: item.id }
      });
    } catch {
      // La surveillance locale continue même si la notification système n'est pas disponible.
    }
  }

  async function toggleFavorite(point: PotentialPoint) {
    const id = favoriteId(species, point.id);
    const existing = favoritesRef.current.find((item) => item.id === id);
    if (existing) {
      setFavorites((current) => current.filter((item) => item.id !== id));
      setNotice('Coin retiré des favoris surveillés.');
      return;
    }

    const favorite = favoriteFromPotential(species, point);
    setFavorites((current) => [favorite, ...current]);
    const notificationsEnabled = await requestFavoriteNotifications();
    setNotice(notificationsEnabled
      ? 'Coin ajouté aux favoris : MycoMap te préviendra lorsqu’il repassera à 50/100 ou plus.'
      : 'Coin ajouté aux favoris. La surveillance fonctionne à l’ouverture de MycoMap ; autorise les notifications pour recevoir l’alerte système.');
  }

  async function focusFavorite(item: FavoriteSpot) {
    setSpecies(item.species);
    setMapMode('now');
    setSheet(null);
    setPickedLocation(null);
    setSelectedFavoriteId(item.id);
    mapRef.current?.flyTo({ center: [item.lon, item.lat], zoom: 13.2, duration: 700 });
    await loadArea({ lat: item.lat, lon: item.lon }, false);
    setSelectedFavoriteId(item.id);
    setSelectedId(item.zone.id);
  }

  async function refreshFavorites() {
    if (!navigator.onLine || favoritesRef.current.length === 0) return;

    const original = favoritesRef.current;
    const next: FavoriteSpot[] = [];
    const notifications: FavoriteSpot[] = [];

    for (const item of original) {
      try {
        const snapshot = await fetchCurrentWeather(item.lat, item.lon);
        const scored = scoreZone(item.species, item.zone, snapshot, observationsRef.current);
        const currentLevel = scored.finalScore >= DISPLAY_MIN_SCORE
          ? Math.floor(scored.finalScore / 5) * 5
          : null;

        let lastAlertLevel = item.lastAlertLevel;
        let shouldNotify = false;

        if (currentLevel == null) {
          // Un passage sous 50 réarme entièrement le cycle d'alertes.
          lastAlertLevel = null;
        } else if (lastAlertLevel == null) {
          // Premier franchissement de 50 après réarmement.
          lastAlertLevel = currentLevel;
          shouldNotify = true;
        } else if (currentLevel >= lastAlertLevel + 5) {
          // Un saut (ex. 53 -> 70) ne produit qu'une seule alerte, au palier atteint.
          lastAlertLevel = currentLevel;
          shouldNotify = true;
        }

        const updated: FavoriteSpot = {
          ...item,
          lastScore: scored.finalScore,
          lastHabitatScore: scored.habitatScore,
          lastConditionScore: scored.conditionScore,
          lastHydricScore: scored.hydricScore,
          lastCheckedAt: new Date().toISOString(),
          lastAlertLevel
        };
        next.push(updated);
        if (shouldNotify) notifications.push(updated);
      } catch {
        next.push(item);
      }
    }

    favoritesRef.current = next;
    setFavorites(next);
    for (const item of notifications) await showFavoriteNotification(item);
  }

  function openObservation(location = pickedLocation ?? gpsFix ?? currentMapCenter(), source: Observation['source'] = pickedLocation ? 'map' : 'gps') {
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

    const nearest = zones
      .map((zone) => ({ zone, d: distanceMeters(zone, draft.location!) }))
      .sort((a, b) => a.d - b.d)[0]?.zone;
    const scoreAtObservation = snapshot && nearest
      ? scoreZone(species, nearest, snapshot, observationsRef.current)
      : null;
    const conditionScore = scoreAtObservation?.conditionScore ?? (
      snapshot ? scoreMoment(species, snapshot, nearest, draft.observedAt) : undefined
    );
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
      habitatLabel: nearest?.name,
      modelSnapshot: scoreAtObservation ? {
        finalScore: scoreAtObservation.finalScore,
        habitatScore: scoreAtObservation.habitatScore,
        forestScore: scoreAtObservation.forestScore,
        soilScore: scoreAtObservation.soilScore,
        terrainScore: scoreAtObservation.terrainScore,
        seasonScore: scoreAtObservation.seasonScore,
        conditionScore: scoreAtObservation.conditionScore,
        hydricScore: scoreAtObservation.hydricScore,
        hydricRelativeWaterPct: scoreAtObservation.hydricRelativeWaterPct,
        hydricLabel: scoreAtObservation.hydricLabel,
        capturedAt: new Date().toISOString()
      } : undefined
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
        const nearest = zones
          .map((zone) => ({ zone, d: distanceMeters(zone, item) }))
          .sort((a, b) => a.d - b.d)[0]?.zone;
        const scoreAtObservation = nearest
          ? scoreZone(item.species, nearest, snapshot, observationsRef.current.filter((obs) => obs.id !== item.id))
          : null;
        updates.set(item.id, {
          weather: snapshot,
          conditionScore: scoreAtObservation?.conditionScore ?? scoreMoment(item.species, snapshot, nearest, date),
          modelSnapshot: scoreAtObservation ? {
            finalScore: scoreAtObservation.finalScore,
            habitatScore: scoreAtObservation.habitatScore,
            forestScore: scoreAtObservation.forestScore,
            soilScore: scoreAtObservation.soilScore,
            terrainScore: scoreAtObservation.terrainScore,
            seasonScore: scoreAtObservation.seasonScore,
            conditionScore: scoreAtObservation.conditionScore,
            hydricScore: scoreAtObservation.hydricScore,
            hydricRelativeWaterPct: scoreAtObservation.hydricRelativeWaterPct,
            hydricLabel: scoreAtObservation.hydricLabel,
            capturedAt: new Date().toISOString()
          } : item.modelSnapshot,
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

  async function exportPointsJson() {
    const exportedAt = new Date();
    const payload = {
      format: 'MycoMap',
      schemaVersion: 1,
      exportedAt: exportedAt.toISOString(),
      pointCount: observations.length,
      favoriteCount: favorites.length,
      favorites,
      points: observations.map((item) => ({
        ...item,
        photo: item.photoStored ? {
          storedLocally: true,
          fileName: item.photoName ?? null,
          includedInJson: false
        } : null
      }))
    };
    const json = JSON.stringify(payload, null, 2);
    const fileName = `mycomap-points-${exportedAt.toISOString().slice(0, 10)}.json`;
    const blob = new Blob([json], { type: 'application/json' });

    try {
      const shareFile = new File([blob], fileName, { type: 'application/json' });
      const shareNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      const data: ShareData = { title: 'Sauvegarde MycoMap', files: [shareFile] };
      if (shareNavigator.share && (!shareNavigator.canShare || shareNavigator.canShare(data))) {
        await shareNavigator.share(data);
        return;
      }
    } catch {
      // Le téléchargement classique ci-dessous reste disponible.
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const topScore = visiblePotentials.length ? Math.max(...visiblePotentials.map((item) => item.displayScore)) : null;
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
            <button key={key} className={species === key ? 'active' : ''} onClick={() => { setSpecies(key); setSelectedId(null); setSelectedFavoriteId(null); }} role="tab">
              <SpeciesIcon species={key} />{SPECIES[key].label}
            </button>
          ))}
        </div>
        <div className="view-control glass" role="tablist" aria-label="Type de potentiel">
          <button className={mapMode === 'now' ? 'active' : ''} onClick={() => { setMapMode('now'); setSelectedId(null); setSelectedFavoriteId(null); }}>Maintenant</button>
          <button className={mapMode === 'habitat' ? 'active' : ''} onClick={() => { setMapMode('habitat'); setSelectedId(null); setSelectedFavoriteId(null); }}>Qualité du coin</button>
        </div>
        <div className="legend glass" aria-label={`Légende ${mapMode === 'now' ? 'du potentiel actuel' : 'de la qualité du coin'} de 50 à 100`}>
          <span><i className="dot blue" />50</span><span><i className="dot green" /></span><span><i className="dot yellow" /></span><span><i className="dot orange" /></span><span><i className="dot red" />100</span>
        </div>
      </header>

      <div className="map-actions">
        <button className={`map-button glass${gpsTracking ? ' gps-active' : ''}`} onClick={locateMe} aria-label={gpsTracking ? 'Recentrer sur ma position GPS' : 'Activer ma position GPS'}><LocateFixed size={20} /></button>
        <button className="map-button glass" onClick={refreshVisibleArea} aria-label="Forcer l’actualisation"><RefreshCw className={loading ? 'spin' : ''} size={20} /></button>
      </div>

      {!selected && (topScore != null || loading) && (
        <div className="status-pill glass">
          <span className="status-dot" style={{ background: topScore != null ? scoreColor(topScore) : '#8b968f' }} />
          {topScore == null
            ? (loading ? 'Analyse de cette zone…' : mapMode === 'now' ? 'Aucun secteur actuel ≥ 50/100' : 'Aucun habitat ≥ 50/100')
            : <>{!isOnline ? 'Hors ligne · ' : loading ? 'Actualisation · ' : ''}{mapMode === 'now' ? 'Meilleur potentiel actuel' : 'Meilleur habitat visible'} : <b>{topScore}/100</b></>}
        </div>
      )}

      {selected && !sheet && selectedDisplayScore != null && (
        <section className="zone-card glass" onClick={() => setSheet('data')} role="button" aria-label="Ouvrir le détail de cette parcelle">
          <button className="close-mini" onClick={(event) => { event.stopPropagation(); setSelectedId(null); setSelectedFavoriteId(null); }}><X size={16} /></button>
          <button className={`favorite-mini${isFavorite(selected) ? ' active' : ''}`} onClick={(event) => { event.stopPropagation(); void toggleFavorite(selected); }} aria-label={isFavorite(selected) ? 'Retirer des favoris' : 'Surveiller ce coin'}><Star size={16} fill={isFavorite(selected) ? 'currentColor' : 'none'} /></button>
          <div className="zone-score" style={{ color: selectedFavorite && mapMode === 'now' && selected.finalScore < DISPLAY_MIN_SCORE ? '#69736d' : scoreColor(selectedDisplayScore) }}>{selectedDisplayScore}</div>
          <div className="zone-copy"><b>{mapMode === 'habitat' ? 'Qualité du coin' : scoreLabel(selected.finalScore)}</b><span>{selected.name}</span><small>Coin {selected.habitatScore}/100 · Maintenant {selected.finalScore}/100 · Moment {selected.conditionScore}/100</small></div>
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
          <button className="secondary-button export-button" disabled={observations.length === 0 && favorites.length === 0} onClick={() => void exportPointsJson()}><Download size={17} /> Exporter points & favoris en JSON</button>
          <div className="favorites-block">
            <div className="list-heading"><div><b>Favoris surveillés</b><span>Alerte à 50/100 puis par paliers de +5 · retour sous 50 = réarmement</span></div><Bell size={17} /></div>
            {favorites.length === 0 && <div className="empty compact">Aucun coin surveillé. Sélectionne une parcelle puis touche l’étoile.</div>}
            {favorites
              .slice()
              .sort((a, b) => (b.lastScore ?? -1) - (a.lastScore ?? -1))
              .map((favorite) => (
                <article className="favorite-row" key={favorite.id} onClick={() => void focusFavorite(favorite)}>
                  <div className="favorite-score" style={{ color: favorite.lastScore == null || favorite.lastScore < DISPLAY_MIN_SCORE ? 'var(--muted)' : scoreColor(favorite.lastScore) }}>{favorite.lastScore ?? '—'}</div>
                  <div><b><SpeciesIcon species={favorite.species} size={17} /> {favorite.zone.name}</b><span>Coin {favorite.lastHabitatScore ?? '—'}/100 · maintenant {favorite.lastScore ?? '—'}/100 · moment {favorite.lastConditionScore ?? '—'}/100</span><small>Prochaine alerte : {favorite.lastAlertLevel == null ? '50' : favorite.lastAlertLevel + 5}/100 · {favorite.lastCheckedAt ? `vérifié ${new Date(favorite.lastCheckedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : 'pas encore vérifié'}</small></div>
                  <button className="delete favorite-delete" onClick={(event) => { event.stopPropagation(); setFavorites((current) => current.filter((item) => item.id !== favorite.id)); }} aria-label="Retirer des favoris"><Star size={17} fill="currentColor" /></button>
                </article>
              ))}
          </div>
          <div className="list-heading observations-heading"><div><b>Historique des sorties</b><span>Chaque observation reste associée à son espèce.</span></div></div>
          <div className="observations-list">
            {observations.length === 0 && <div className="empty">Aucune sortie enregistrée pour l’instant.</div>}
            {observations.map((obs) => (
              <article className="observation" key={obs.id} onClick={() => { mapRef.current?.flyTo({ center: [obs.lon, obs.lat], zoom: 14 }); setSheet(null); }}>
                <div className={`result-icon ${obs.outcome}`}>{obs.outcome === 'found' ? <SpeciesIcon species={obs.species} size={26} /> : '○'}</div>
                <div><b>{SPECIES[obs.species].label} · {obs.outcome === 'found' ? `${obs.count} trouvé${obs.count > 1 ? 's' : ''}` : 'rien trouvé'}</b><span>{new Date(obs.observedAt).toLocaleDateString('fr-FR')} · {obs.durationMinutes} min · score au moment {obs.modelSnapshot?.finalScore ?? '—'}/100{obs.pendingEnrichment ? ' · à compléter' : ''}</span>{obs.modelSnapshot && <small>Habitat {obs.modelSnapshot.habitatScore}/100 · hydrique {obs.modelSnapshot.hydricScore}/100 · moment {obs.modelSnapshot.conditionScore}/100</small>}{obs.photoStored && <small>Photo conservée hors ligne</small>}{obs.habitatLabel && <small>{obs.habitatLabel}</small>}</div>
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
              <div className="data-summary"><div className="data-total" style={{ color: scoreColor(dataTarget.finalScore) }}>{dataTarget.finalScore}</div><div><b>{scoreLabel(dataTarget.finalScore)}</b><span>{dataTarget.name}</span><small>Qualité du coin {dataTarget.habitatScore}/100 · moment {dataTarget.conditionScore}/100</small><small>{dataTarget.lat.toFixed(5)}, {dataTarget.lon.toFixed(5)}</small></div><button className={`data-favorite${isFavorite(dataTarget) ? ' active' : ''}`} onClick={() => void toggleFavorite(dataTarget)} aria-label={isFavorite(dataTarget) ? 'Retirer des favoris' : 'Surveiller ce coin'}><Star size={19} fill={isFavorite(dataTarget) ? 'currentColor' : 'none'} /></button></div>
              <div className="score-strip">
                <div><b>{dataTarget.forestScore}</b><span>Forêt</span></div><div><b>{dataTarget.soilScore}</b><span>Sol</span></div><div><b>{dataTarget.terrainScore}</b><span>Relief</span></div><div><b>{dataTarget.conditionScore}</b><span>Moment</span></div><div><b>{dataTarget.personalCorrection > 0 ? `+${dataTarget.personalCorrection}` : dataTarget.personalCorrection}</b><span>Terrain réel</span></div>
              </div>
              <div className="data-section"><h3>Forêt</h3><div className="metric-row"><span>Formation</span><b>{dataTarget.forestType || dataTarget.name || '—'}</b></div><div className="metric-row"><span>Essence dominante</span><b>{dataTarget.essence || 'Non précisée'}</b></div><div className="metric-row"><span>Code IGN</span><b>{dataTarget.forestCode || '—'}</b></div></div>
              <div className="data-section"><h3>Relief</h3><div className="metric-row"><span>Altitude</span><b>{numberOrDash(dataTarget.elevation)} m</b></div><div className="metric-row"><span>Pente</span><b>{numberOrDash(dataTarget.slope, 1)}°</b></div><div className="metric-row"><span>Exposition</span><b>{aspectLabel(dataTarget.aspect)}</b></div></div>
              <div className="data-section"><h3>Sol</h3>{dataTarget.soil ? <><div className="metric-row"><span>pH</span><b>{numberOrDash(dataTarget.soil.ph, 1)}</b></div><div className="metric-row"><span>Texture</span><b>{dataTarget.soil.textureClass}</b></div><div className="metric-row"><span>Drainage estimé</span><b>{dataTarget.soil.drainageClass}</b></div><div className="metric-row"><span>Sable</span><b>{numberOrDash(dataTarget.soil.sandPct, 1)} %</b></div><div className="metric-row"><span>Limon</span><b>{numberOrDash(dataTarget.soil.siltPct, 1)} %</b></div><div className="metric-row"><span>Argile</span><b>{numberOrDash(dataTarget.soil.clayPct, 1)} %</b></div><div className="metric-row"><span>Éléments grossiers</span><b>{numberOrDash(dataTarget.soil.coarseFragmentsPct, 1)} %</b></div><div className="metric-row"><span>Capacité au champ</span><b>{numberOrDash(dataTarget.soil.fieldCapacityPct, 1)} %</b></div><div className="metric-row"><span>Point de flétrissement</span><b>{numberOrDash(dataTarget.soil.wiltingPointPct, 1)} %</b></div><div className="metric-row"><span>Réserve utile potentielle</span><b>{numberOrDash(dataTarget.soil.availableWaterPct, 1)} %</b></div></> : <div className="data-unavailable">Données pédologiques structurées indisponibles pour cette parcelle.</div>}</div>
              <div className="data-section"><h3>Météo utilisée</h3><div className="metric-row"><span>État hydrique actuel</span><b>{dataTarget.hydricLabel} · {dataTarget.hydricScore}/100</b></div><div className="metric-row"><span>Eau utile disponible</span><b>{dataTarget.hydricRelativeWaterPct == null ? '—' : `${dataTarget.hydricRelativeWaterPct} %`}</b></div><div className="metric-row"><span>Pluie 3 jours</span><b>{numberOrDash(weather.rain3, 1)} mm</b></div><div className="metric-row"><span>Pluie 7 jours</span><b>{numberOrDash(weather.rain7, 1)} mm</b></div><div className="metric-row"><span>Pluie 14 jours</span><b>{numberOrDash(weather.rain14, 1)} mm</b></div><div className="metric-row"><span>Pluie 30 jours</span><b>{numberOrDash(weather.rain30, 1)} mm</b></div><div className="metric-row"><span>Humidité du sol (modèle)</span><b>{weather.soilMoisture == null ? '—' : `${(weather.soilMoisture * 100).toFixed(1)} %`}</b></div><div className="metric-row"><span>Température du sol</span><b>{numberOrDash(weather.soilTemp, 1)} °C</b></div><div className="metric-row"><span>Température moyenne 7 j</span><b>{numberOrDash(weather.airTemp7, 1)} °C</b></div></div>
              <p className="data-note">{isOnline ? 'Le cache est affiché immédiatement puis actualisé silencieusement. Le score « Moment » intègre maintenant le déficit hydrique relatif du sol : une parcelle structurellement excellente peut donc chuter fortement lorsqu’elle est trop sèche.' : 'Mode hors ligne : le score utilise les dernières données locales disponibles. Les nouvelles observations modifient immédiatement la correction terrain.'}</p>
              <p className="data-credits">Sources : IGN BD Forêt v2 et RGE ALTI · SoilGrids 2.0 / ISRIC · Open-Meteo.</p>
            </>
          )}
        </section>
      )}
    </main>
  );
}
