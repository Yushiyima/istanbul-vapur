/**
 * MapLibre kurulumu ve oyun katmanları. Durumu okur, değiştirmez.
 */
import { AttributionControl, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre v6 worker'ı ayrı dosyadır ve yolunu import.meta.url'den bulur; Vite ön paketlemesinde
// bu yol kırılır. Worker'ı Vite'a asset olarak verip adresini açıkça bildiriyoruz.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { PIER, UI } from '../config/balance.ts';
import { circlePolygon, type LngLat } from '../geo/geo.ts';
import type { CityPack } from '../cityPack.ts';
import type { Pier } from '../sim/piers.ts';

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
/**
 * Harita bbox'tan bu kadar (derece) dışarı kaydırılabilir. Bbox dikey, ekranlar yatay olduğu için
 * boylam payı geniş: dar olursa MapLibre bbox'un tamamını gösteremeyip zoom'u içeri zorlar.
 */
const MAX_BOUNDS_PAD = { lng: 0.45, lat: 0.12 };

const COLORS = {
  water: '#9ccbea',
  waterOutside: '#d3e6f3',
  coast: '#4a86b4',
  noBuild: '#c92a2a',
  coverage: '#1c7ed6',
  pier: '#e8590c',
  pierStroke: '#ffffff',
  historic: '#7c6a46',
  ghostOk: '#2f9e44',
  ghostBad: '#e03131',
  label: '#243447',
  labelHalo: '#ffffff',
};

export const LAYER = {
  historic: 'vapur-historic',
  pier: 'vapur-pier',
  noBuildFill: 'vapur-nobuild-fill',
} as const;

export interface HistoricMarker {
  id: string;
  name: string;
  coast: LngLat;
  snapDistanceM: number;
}

export interface GhostState {
  click: LngLat;
  coast?: LngLat;
  ok: boolean;
}

const fc = <G extends Feature['geometry']>(features: Feature<G>[]): FeatureCollection<G> => ({
  type: 'FeatureCollection',
  features,
});
const point = (c: LngLat, properties: Record<string, unknown> = {}): Feature<Point> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: c },
});

setWorkerUrl(maplibreWorkerUrl);

export function createMap(container: HTMLElement, pack: CityPack): Promise<MapLibreMap> {
  const [w, s, e, n] = pack.bbox;
  const p = MAX_BOUNDS_PAD;
  const map = new MapLibreMap({
    container,
    style: STYLE_URL,
    bounds: [w, s, e, n],
    fitBoundsOptions: { padding: 20 },
    maxBounds: [w - p.lng, s - p.lat, e + p.lng, n + p.lat],
    minZoom: 9,
    maxZoom: 18,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(
    new AttributionControl({
      compact: false,
      // Karo kaynağı "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" atfını kendisi ekler.
      // Kıyı/su/yer adı verimiz doğrudan OSM'den geldiği için Türkçe OSM atfı ayrıca yazılır.
      customAttribution:
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap katkıcıları</a>',
    }),
    'bottom-right',
  );

  return new Promise((resolve, reject) => {
    map.once('load', () => {
      try {
        addGameLayers(map, pack);
        resolve(map);
      } catch (err) {
        reject(err);
      }
    });
    map.once('error', (ev) => {
      if (!map.loaded()) console.error('Harita hatası:', ev.error);
    });
  });
}

function addGameLayers(map: MapLibreMap, pack: CityPack): void {
  // Su ve kıyı, altlığın su katmanının hemen üstüne: köprüler ve yollar üstte kalır.
  const style = map.getStyle();
  const layers = style.layers ?? [];
  const waterIdx = layers.findIndex((l) => l.id === 'water');
  const belowWater = layers[waterIdx + 1]?.id;
  const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;

  // Altlığın suyu (oyun alanı dışı) açık mavi: oyun alanının sınırı yumuşak görünsün.
  if (waterIdx >= 0) map.setPaintProperty('water', 'fill-color', COLORS.waterOutside);

  map.addSource('vapur-water', { type: 'geojson', data: pack.water });
  map.addSource('vapur-coast', { type: 'geojson', data: pack.coastline });
  map.addSource('vapur-nobuild', { type: 'geojson', data: pack.noBuild });
  map.addSource('vapur-coverage', { type: 'geojson', data: fc([]) });
  map.addSource('vapur-historic', { type: 'geojson', data: fc([]) });
  map.addSource('vapur-piers', { type: 'geojson', data: fc([]) });
  map.addSource('vapur-ghost', { type: 'geojson', data: fc([]) });

  map.addLayer({ id: 'vapur-water-fill', type: 'fill', source: 'vapur-water', paint: { 'fill-color': COLORS.water } }, belowWater);
  map.addLayer(
    { id: 'vapur-coast-line', type: 'line', source: 'vapur-coast', paint: { 'line-color': COLORS.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.5] } },
    belowWater,
  );

  map.addLayer(
    { id: LAYER.noBuildFill, type: 'fill', source: 'vapur-nobuild', paint: { 'fill-color': COLORS.noBuild, 'fill-opacity': 0.12 } },
    firstSymbol,
  );
  map.addLayer(
    { id: 'vapur-nobuild-line', type: 'line', source: 'vapur-nobuild', paint: { 'line-color': COLORS.noBuild, 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } },
    firstSymbol,
  );
  map.addLayer(
    { id: 'vapur-coverage-fill', type: 'fill', source: 'vapur-coverage', paint: { 'fill-color': COLORS.coverage, 'fill-opacity': 0.08 } },
    firstSymbol,
  );
  map.addLayer(
    { id: 'vapur-coverage-line', type: 'line', source: 'vapur-coverage', paint: { 'line-color': COLORS.coverage, 'line-width': 1.2, 'line-opacity': 0.5 } },
    firstSymbol,
  );

  // Oyun işaretleri en üstte.
  map.addLayer({
    id: LAYER.historic,
    type: 'circle',
    source: 'vapur-historic',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6],
      'circle-color': '#ffffff',
      'circle-opacity': 0.55,
      'circle-stroke-color': COLORS.historic,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': 0.55,
    },
  });
  map.addLayer({
    id: 'vapur-ghost-line',
    type: 'line',
    source: 'vapur-ghost',
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': ['case', ['get', 'ok'], COLORS.ghostOk, COLORS.ghostBad], 'line-width': 1.5, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'vapur-ghost-point',
    type: 'circle',
    source: 'vapur-ghost',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 7,
      'circle-color': ['case', ['get', 'ok'], COLORS.ghostOk, COLORS.ghostBad],
      'circle-opacity': 0.6,
      'circle-stroke-color': COLORS.pierStroke,
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: LAYER.pier,
    type: 'circle',
    source: 'vapur-piers',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9],
      'circle-color': COLORS.pier,
      'circle-stroke-color': COLORS.pierStroke,
      'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'vapur-pier-label',
    type: 'symbol',
    source: 'vapur-piers',
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 13,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-allow-overlap': true,
    },
    paint: { 'text-color': COLORS.label, 'text-halo-color': COLORS.labelHalo, 'text-halo-width': 1.6 },
  });
}

function source(map: MapLibreMap, id: string): GeoJSONSource {
  const src = map.getSource<GeoJSONSource>(id);
  if (!src) throw new Error(`Kaynak yok: ${id}`);
  return src;
}

export function renderPiers(map: MapLibreMap, piers: readonly Pier[]): void {
  source(map, 'vapur-piers').setData(fc(piers.map((p) => point(p.coast, { id: p.id, name: p.name }))));
  source(map, 'vapur-coverage').setData(
    fc(
      piers.map((p) => ({
        type: 'Feature' as const,
        properties: { id: p.id },
        geometry: { type: 'Polygon' as const, coordinates: circlePolygon(p.coast, PIER.coverageRadiusM, UI.coverageCircleSteps) },
      })),
    ),
  );
}

/** Üstüne iskele kurulmuş tarihi işaretler gizlenir. */
export function renderHistoric(map: MapLibreMap, markers: readonly HistoricMarker[], hiddenIds: ReadonlySet<string>): void {
  source(map, 'vapur-historic').setData(
    fc(markers.filter((m) => !hiddenIds.has(m.id)).map((m) => point(m.coast, { id: m.id, name: m.name }))),
  );
}

export function renderGhost(map: MapLibreMap, ghost: GhostState | null): void {
  if (!ghost?.coast) {
    source(map, 'vapur-ghost').setData(fc([]));
    return;
  }
  source(map, 'vapur-ghost').setData({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { ok: ghost.ok }, geometry: { type: 'LineString', coordinates: [ghost.click, ghost.coast] } },
      point(ghost.coast, { ok: ghost.ok }),
    ],
  });
}

export function setNoBuildEmphasis(map: MapLibreMap, strong: boolean): void {
  map.setPaintProperty(LAYER.noBuildFill, 'fill-opacity', strong ? 0.22 : 0.08);
}
