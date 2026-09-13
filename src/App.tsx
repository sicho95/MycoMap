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
  Trash2,
  X
} from 'lucide-react';
import type { LatLng, Observation, ObservationOutcome, Species, ThemeMode, WeatherSnapshot } from './domain';
import { loadObservations, loadTheme, persistObservations, persistTheme, SPECIES } from './domain';
import { fetchForestZones } from './environment';
import { scoreColor, scoreConditions, scoreLabel, scoreZone } from './scoring';
import { fetchCurrentWeather, fetchWeatherForDate } from './weather';

const FALLBACK: LatLng = { lat: 48.78, lon: 2.26 };

type Sheet = 'observation' | 'spots' | 'data' | null;

type Draft = {
  outcome: ObservationOutcome;
  count: number;
  durationMinutes: number;
  observedAt: Date;
  location: LatLng | null;
  source: Observation['source'];
  photoName?: string;
};

const baseStyle: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
};

function geojson(points: Array<{ lat: number; lon: number; [key: string]: unknown }>) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [point.lon, point.lat] },
      properties: Object.fromEntries(Object.entries(point).filter(([key]) => key !== 'lat' && key !== 'lon'))
    }))
  };
}

function themeIcon(theme: ThemeMode) {
  if (theme === 'light') return <Sun size={18} />;
  if (theme === 'dark') return <Moon size={18} />;
  return <Layers3 size={18} />;
}

function nextTheme(theme: ThemeMode): ThemeMode {
  if (theme === 'auto') return 'light';
  if (theme === 'light') return 'dark';
  return 'auto';
}

export default function App() {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const [species, setSpecies] = useState<Species>('cepes');
  const [theme, setTheme] = useState<ThemeMode>(() => loadTheme());
  const [position, setPosition] = useState<LatLng>(FALLBACK);
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [zones, setZones] = useState<Awaited<ReturnType<typeof fetchForestZones>>>([]);
  const [observations, setObservations] = useState<Observation[]>(() => loadObservations());
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pickedLocation, setPickedLocation] = useState<LatLng | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    outcome: 'found', count: 1, durationMinutes: 60, observedAt: new Date(), location: null, source: 'gps'
  });

  const potentials = useMemo(() => {
    if (!weather) return [];
    return zones.map((zone) => scoreZone(species, zone, weather, observations));
  }, [zones, weather, species, observations]);

  const selected = useMemo(() => potentials.find((item) => item.id === selectedId) ?? null, [potentials, selectedId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    persistObservations(observations);
  }, [observations]);

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
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');

    map.on('load', () => {
      map.addSource('potential', { type: 'geojson', data: geojson([]) });
      map.addLayer({
        id: 'potential-halo',
        type: 'circle',
        source: 'potential',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 22, 12, 46, 15, 72],
          'circle-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'circle-opacity': 0.42,
          'circle-blur': 0.75
        }
      });
      map.addLayer({
        id: 'potential-point',
        type: 'circle',
        source: 'potential',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'finalScore'], 0, 3, 100, 8],
          'circle-color': ['interpolate', ['linear'], ['get', 'finalScore'], 0, '#3b82c4', 30, '#43a867', 55, '#f0c52e', 75, '#ff5b2e', 90, '#d61536'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.92
        }
      });
      map.addSource('observations', { type: 'geojson', data: geojson([]) });
      map.addLayer({
        id: 'observations', type: 'circle', source: 'observations',
        paint: { 'circle-radius': 6, 'circle-color': '#111814', 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff' }
      });
      map.addSource('picked', { type: 'geojson', data: geojson([]) });
      map.addLayer({
        id: 'picked', type: 'circle', source: 'picked',
        paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-width': 3, 'circle-stroke-color': '#d61536' }
      });
    });

    map.on('click', 'potential-point', (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) setSelectedId(String(id));
    });
    map.on('mouseenter', 'potential-point', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'potential-point', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', (event) => {
      const hit = map.queryRenderedFeatures(event.point, { layers: ['potential-point'] });
      if (hit.length) return;
      setSelectedId(null);
      setPickedLocation({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource('potential') as GeoJSONSource | undefined;
    if (source) source.setData(geojson(potentials));
  }, [potentials]);

  useEffect(() => {
    const source = mapRef.current?.getSource('observations') as GeoJSONSource | undefined;
    if (source) source.setData(geojson(observations));
  }, [observations]);

  useEffect(() => {
    const source = mapRef.current?.getSource('picked') as GeoJSONSource | undefined;
    if (source) source.setData(geojson(pickedLocation ? [pickedLocation] : []));
  }, [pickedLocation]);

  async function loadArea(target: LatLng, fly = true) {
    setLoading(true);
    setNotice(null);
    try {
      const [nextWeather, nextZones] = await Promise.all([
        fetchCurrentWeather(target.lat, target.lon),
        fetchForestZones(target, 25000)
      ]);
      setWeather(nextWeather);
      setZones(nextZones);
      setPosition(target);
      if (fly) mapRef.current?.flyTo({ center: [target.lon, target.lat], zoom: 11.2, duration: 700 });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Impossible de charger la zone');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (result) => loadArea({ lat: result.coords.latitude, lon: result.coords.longitude }),
      () => loadArea(FALLBACK),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 120000 }
    );
  }, []);

  function locateMe() {
    navigator.geolocation?.getCurrentPosition(
      (result) => loadArea({ lat: result.coords.latitude, lon: result.coords.longitude }),
      () => setNotice('Position GPS non disponible'),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 }
    );
  }

  function openObservation(location = pickedLocation ?? position, source: Observation['source'] = pickedLocation ? 'map' : 'gps') {
    setDraft({ outcome: 'found', count: 1, durationMinutes: 60, observedAt: new Date(), location, source });
    setSheet('observation');
  }

  async function importPhoto(file: File) {
    try {
      const [gps, metadata] = await Promise.all([
        exifr.gps(file),
        exifr.parse(file, ['DateTimeOriginal'])
      ]);
      const location = gps?.latitude != null && gps?.longitude != null
        ? { lat: gps.latitude, lon: gps.longitude }
        : draft.location ?? position;
      const date = metadata?.DateTimeOriginal instanceof Date ? metadata.DateTimeOriginal : new Date();
      setDraft((current) => ({ ...current, location, observedAt: date, source: 'photo', photoName: file.name }));
      setPickedLocation(location);
      mapRef.current?.flyTo({ center: [location.lon, location.lat], zoom: 13, duration: 650 });
      setNotice(gps ? 'GPS de la photo détecté' : 'Pas de GPS EXIF : position actuelle conservée');
    } catch {
      setNotice('Métadonnées photo illisibles : tu peux garder ou choisir la position sur la carte');
    }
  }

  async function saveObservation() {
    if (!draft.location) return;
    setSaving(true);
    try {
      const snapshot = await fetchWeatherForDate(draft.location.lat, draft.location.lon, draft.observedAt);
      const conditionScore = scoreConditions(species, snapshot, draft.observedAt);
      const nearest = zones
        .map((zone) => ({ zone, d: Math.hypot(zone.lat - draft.location!.lat, zone.lon - draft.location!.lon) }))
        .sort((a, b) => a.d - b.d)[0]?.zone;
      const item: Observation = {
        id: crypto.randomUUID(),
        species,
        outcome: draft.outcome,
        count: draft.outcome === 'found' ? Math.max(1, draft.count) : 0,
        durationMinutes: draft.durationMinutes,
        observedAt: draft.observedAt.toISOString(),
        lat: draft.location.lat,
        lon: draft.location.lon,
        source: draft.source,
        photoName: draft.photoName,
        weather: snapshot,
        conditionScore,
        habitatLabel: nearest?.name
      };
      setObservations((current) => [item, ...current]);
      setPickedLocation(null);
      setSheet(null);
      setNotice(draft.outcome === 'found' ? 'Trouvaille ajoutée : le modèle local apprend.' : 'Sortie négative enregistrée avec son contexte météo.');
    } catch {
      setNotice('Impossible de récupérer la météo de cette date. Réessaie avec du réseau.');
    } finally {
      setSaving(false);
    }
  }

  function deleteObservation(id: string) {
    setObservations((current) => current.filter((item) => item.id !== id));
  }

  const topScore = potentials.length ? Math.max(...potentials.map((item) => item.finalScore)) : null;

  return (
    <main className="app-shell">
      <div ref={mapNode} className="map" aria-label="Carte du potentiel mycologique" />

      <header className="top-stack">
        <div className="brand-row glass">
          <div className="brand"><span className="brand-mark">🍄</span><span>MycoMap</span></div>
          <button className="icon-button" onClick={() => setTheme(nextTheme(theme))} aria-label="Changer le thème">{themeIcon(theme)}</button>
        </div>
        <div className="species-control glass" role="tablist" aria-label="Champignon recherché">
          {(Object.keys(SPECIES) as Species[]).map((key) => (
            <button key={key} className={species === key ? 'active' : ''} onClick={() => { setSpecies(key); setSelectedId(null); }} role="tab">
              <span>{SPECIES[key].emoji}</span>{SPECIES[key].label}
            </button>
          ))}
        </div>
        <div className="legend glass" aria-label="Légende du potentiel">
          <span><i className="dot blue" />Faible</span><span><i className="dot green" /></span><span><i className="dot yellow" /></span><span><i className="dot orange" /></span><span><i className="dot red" />Chaud</span>
        </div>
      </header>

      <div className="map-actions">
        <button className="map-button glass" onClick={locateMe} aria-label="Me localiser"><LocateFixed size={20} /></button>
        <button className="map-button glass" onClick={() => loadArea(position, false)} aria-label="Actualiser les données"><RefreshCw className={loading ? 'spin' : ''} size={20} /></button>
      </div>

      {topScore != null && !selected && (
        <div className="status-pill glass"><span className="status-dot" style={{ background: scoreColor(topScore) }} />Meilleur secteur visible : <b>{topScore}/100</b></div>
      )}

      {selected && (
        <section className="zone-card glass">
          <button className="close-mini" onClick={() => setSelectedId(null)}><X size={16} /></button>
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

      {sheet && <div className="scrim" onClick={() => setSheet(null)} />}

      {sheet === 'observation' && (
        <section className="sheet" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>{SPECIES[species].label}</small><h2>Enregistrer la sortie</h2></div><button className="icon-button" onClick={() => setSheet(null)}><X size={20} /></button></div>
          <div className="toggle-row">
            <button className={draft.outcome === 'found' ? 'selected good' : ''} onClick={() => setDraft((d) => ({ ...d, outcome: 'found' }))}>🍄 Trouvé</button>
            <button className={draft.outcome === 'none' ? 'selected neutral' : ''} onClick={() => setDraft((d) => ({ ...d, outcome: 'none' }))}>○ Rien trouvé</button>
          </div>
          {draft.outcome === 'found' && (
            <label className="field"><span>Quantité</span><input type="number" inputMode="numeric" min="1" max="999" value={draft.count} onChange={(e) => setDraft((d) => ({ ...d, count: Number(e.target.value) }))} /></label>
          )}
          <div className="field"><span>Temps de recherche</span><div className="chips">{[30, 60, 120, 180].map((minutes) => <button key={minutes} className={draft.durationMinutes === minutes ? 'active' : ''} onClick={() => setDraft((d) => ({ ...d, durationMinutes: minutes }))}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</button>)}</div></div>
          <div className="auto-card"><Crosshair size={18} /><div><b>{draft.source === 'photo' ? 'Position de la photo' : draft.source === 'map' ? 'Position choisie sur la carte' : 'Position GPS'}</b><span>{draft.location ? `${draft.location.lat.toFixed(5)}, ${draft.location.lon.toFixed(5)}` : 'Recherche…'}</span></div></div>
          <div className="auto-card"><RefreshCw size={18} /><div><b>Météo préremplie automatiquement</b><span>Pluie, température et humidité du sol à la date de la sortie.</span></div></div>
          <input ref={photoInput} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && importPhoto(e.target.files[0])} />
          <button className="secondary-button" onClick={() => photoInput.current?.click()}>Importer une photo géolocalisée</button>
          <button className="save-button" disabled={saving || !draft.location} onClick={saveObservation}>{saving ? 'Récupération météo…' : 'Enregistrer et faire apprendre le modèle'}</button>
        </section>
      )}

      {sheet === 'spots' && (
        <section className="sheet sheet-list" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>Privé sur cet appareil</small><h2>Mes coins & sorties</h2></div><button className="icon-button" onClick={() => setSheet(null)}><X size={20} /></button></div>
          <div className="observations-list">
            {observations.length === 0 && <div className="empty">Aucune sortie enregistrée pour l’instant.</div>}
            {observations.map((obs) => (
              <article className="observation" key={obs.id} onClick={() => { mapRef.current?.flyTo({ center: [obs.lon, obs.lat], zoom: 14 }); setSheet(null); }}>
                <div className={`result-icon ${obs.outcome}`}>{obs.outcome === 'found' ? '🍄' : '○'}</div>
                <div><b>{SPECIES[obs.species].label} · {obs.outcome === 'found' ? `${obs.count} trouvé${obs.count > 1 ? 's' : ''}` : 'rien trouvé'}</b><span>{new Date(obs.observedAt).toLocaleDateString('fr-FR')} · {obs.durationMinutes} min · météo {obs.conditionScore ?? '—'}/100</span>{obs.habitatLabel && <small>{obs.habitatLabel}</small>}</div>
                <button className="delete" onClick={(e) => { e.stopPropagation(); deleteObservation(obs.id); }}><Trash2 size={17} /></button>
              </article>
            ))}
          </div>
        </section>
      )}

      {sheet === 'data' && (
        <section className="sheet" aria-modal="true">
          <div className="grabber" />
          <div className="sheet-title"><div><small>Transparence du score</small><h2>Données utilisées</h2></div><button className="icon-button" onClick={() => setSheet(null)}><X size={20} /></button></div>
          <div className="data-grid">
            <div className="data-item ok"><b>Forêt</b><span>OpenStreetMap · peuplements et essences quand renseignés</span></div>
            <div className="data-item ok"><b>Altitude</b><span>Modèle numérique de terrain via Open‑Meteo / Copernicus</span></div>
            <div className="data-item ok"><b>Météo</b><span>Pluie 3/7/14/30 j, température et humidité du sol</span></div>
            <div className="data-item pending"><b>Sols</b><span>Source pédologique française à brancher ; la V1 garde ce facteur neutre plutôt que de l’inventer.</span></div>
            <div className="data-item private"><b>Ton historique</b><span>Reste local. Il corrige les zones autour de tes sorties selon le résultat et les conditions du jour.</span></div>
          </div>
        </section>
      )}
    </main>
  );
}
