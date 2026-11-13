/**
 * MapLibre kurulumu ve oyun katmanları. Durumu okur, değiştirmez.
 */
import { AttributionControl, Map as MapLibreMap, NavigationControl, ScaleControl, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
// MapLibre v6 worker'ı ayrı dosyadır ve yolunu import.meta.url'den bulur; Vite ön paketlemesinde
// bu yol kırılır. Worker'ı Vite'a asset olarak verip adresini açıkça bildiriyoruz.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';
import { SHIP_TYPES } from '../config/balance.ts';
import type { LngLat } from '../geo/geo.ts';
import type { CityPack } from '../cityPack.ts';
import type { Game } from '../game.ts';
import { shipPose } from '../sim/tick.ts';
import { legCount, legRoute } from '../sim/world.ts';

setWorkerUrl(maplibreWorkerUrl);

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
  pierDraft: '#1c7ed6',
  pierStroke: '#ffffff',
  historic: '#7c6a46',
  ghostOk: '#2f9e44',
  ghostBad: '#e03131',
  label: '#243447',
  labelHalo: '#ffffff',
  tersane: '#495057',
};

export const LAYER = {
  historic: 'vapur-historic',
  pier: 'vapur-pier',
  noBuildFill: 'vapur-nobuild-fill',
  line: 'vapur-line',
  ship: 'vapur-ship',
  yard: 'vapur-yard',
} as const;

export interface GhostState {
  click: LngLat;
  coast?: LngLat;
  ok: boolean;
}

const fc = <G extends Geometry>(features: Feature<G>[]): FeatureCollection<G> => ({ type: 'FeatureCollection', features });
const point = (c: LngLat, properties: Record<string, unknown> = {}): Feature<Point> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: c },
});

export function createMap(container: HTMLElement, pack: CityPack): Promise<MapLibreMap> {
  const [w, s, e, n] = pack.data.bbox;
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
      customAttribution: [
        '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap katkıcıları</a>',
        '<a href="https://human-settlement.emergency.copernicus.eu/" target="_blank" rel="noopener">GHS-POP R2023A © Avrupa Komisyonu JRC</a>',
      ],
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

function shipArrowImage(): ImageData {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.translate(size / 2, size / 2);
  g.beginPath();
  g.moveTo(0, -11);
  g.lineTo(7, 8);
  g.lineTo(0, 4);
  g.lineTo(-7, 8);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(20,30,40,0.85)';
  g.lineWidth = 2;
  g.fill();
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

/** Tersane işareti: beyaz çapa. */
function anchorImage(): ImageData {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2.6;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(16, 8, 3, 0, Math.PI * 2);
  g.moveTo(16, 11);
  g.lineTo(16, 26);
  g.moveTo(10, 15);
  g.lineTo(22, 15);
  g.moveTo(7, 20);
  g.quadraticCurveTo(9, 27, 16, 26);
  g.quadraticCurveTo(23, 27, 25, 20);
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

function addGameLayers(map: MapLibreMap, pack: CityPack): void {
  const style = map.getStyle();
  const layers = style.layers ?? [];
  const waterIdx = layers.findIndex((l) => l.id === 'water');
  const belowWater = layers[waterIdx + 1]?.id;
  const firstSymbol = layers.find((l) => l.type === 'symbol')?.id;

  if (waterIdx >= 0) map.setPaintProperty('water', 'fill-color', COLORS.waterOutside);
  map.addImage('ship-arrow', shipArrowImage(), { pixelRatio: 2 });
  map.addImage('yard-anchor', anchorImage(), { pixelRatio: 2 });

  for (const id of ['vapur-coverage', 'vapur-historic', 'vapur-piers', 'vapur-ghost', 'vapur-lines', 'vapur-ships', 'vapur-draft', 'vapur-tersane', 'vapur-overlay']) {
    map.addSource(id, { type: 'geojson', data: fc([]) });
  }
  map.addSource('vapur-water', { type: 'geojson', data: pack.water });
  map.addSource('vapur-coast', { type: 'geojson', data: pack.coastline });
  map.addSource('vapur-nobuild', { type: 'geojson', data: pack.noBuild });
  map.addSource('vapur-breakwater', { type: 'geojson', data: pack.breakwaters });

  map.addLayer({ id: 'vapur-water-fill', type: 'fill', source: 'vapur-water', paint: { 'fill-color': COLORS.water } }, belowWater);
  map.addLayer(
    { id: 'vapur-coast-line', type: 'line', source: 'vapur-coast', paint: { 'line-color': COLORS.coast, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.5] } },
    belowWater,
  );

  map.addLayer(
    {
      id: 'vapur-breakwater-line',
      type: 'line',
      source: 'vapur-breakwater',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': '#5f6b76', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 4] },
    },
    belowWater,
  );

  // Veri katmanları (nüfus/çekim) kara üstünde, etiketlerin altında.
  map.addLayer(
    {
      id: 'vapur-overlay-fill',
      type: 'fill',
      source: 'vapur-overlay',
      layout: { visibility: 'none' },
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.55, 'fill-outline-color': 'rgba(0,0,0,0)' },
    },
    firstSymbol,
  );
  map.addLayer({ id: LAYER.noBuildFill, type: 'fill', source: 'vapur-nobuild', paint: { 'fill-color': COLORS.noBuild, 'fill-opacity': 0.08 } }, firstSymbol);
  map.addLayer(
    { id: 'vapur-nobuild-line', type: 'line', source: 'vapur-nobuild', paint: { 'line-color': COLORS.noBuild, 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 } },
    firstSymbol,
  );
  map.addLayer(
    { id: 'vapur-coverage-fill', type: 'fill', source: 'vapur-coverage', paint: { 'fill-color': COLORS.coverage, 'fill-opacity': 0.08 } },
    firstSymbol,
  );
  map.addLayer(
    { id: 'vapur-coverage-line', type: 'line', source: 'vapur-coverage', paint: { 'line-color': COLORS.coverage, 'line-width': 1, 'line-opacity': 0.45 } },
    firstSymbol,
  );

  // Hatlar
  map.addLayer({
    id: 'vapur-line-casing',
    type: 'line',
    source: 'vapur-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'selected'], 9, 6], 'line-opacity': 0.8 },
  });
  map.addLayer({
    id: LAYER.line,
    type: 'line',
    source: 'vapur-lines',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      // Doluluk katmanı açıkken kalınlık doluluğa göre.
      'line-width': ['case', ['get', 'selected'], 6, ['+', 3, ['*', ['get', 'loadWidth'], 5]]],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'vapur-draft-line',
    type: 'line',
    source: 'vapur-draft',
    paint: { 'line-color': COLORS.pierDraft, 'line-width': 4, 'line-dasharray': [1.5, 1.2], 'line-opacity': 0.85 },
  });

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
    id: LAYER.yard,
    type: 'circle',
    source: 'vapur-tersane',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 12],
      'circle-color': COLORS.tersane,
      'circle-stroke-color': '#ffd43b',
      'circle-stroke-width': 2.5,
    },
  });
  map.addLayer({
    id: 'vapur-tersane-icon',
    type: 'symbol',
    source: 'vapur-tersane',
    layout: { 'icon-image': 'yard-anchor', 'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 0.9], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });
  map.addLayer({
    id: 'vapur-tersane-label',
    type: 'symbol',
    source: 'vapur-tersane',
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-anchor': 'left', 'text-offset': [1.1, 0], 'text-allow-overlap': true },
    paint: { 'text-color': COLORS.tersane, 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
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

  // Gemiler
  map.addLayer({
    id: 'vapur-ship-dot',
    type: 'circle',
    source: 'vapur-ships',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': ['case', ['>', ['get', 'load'], 1], '#e03131', '#ffffff'],
      'circle-stroke-width': ['case', ['>', ['get', 'load'], 1], 2.5, 1.5],
    },
  });
  map.addLayer({
    id: LAYER.ship,
    type: 'symbol',
    source: 'vapur-ships',
    layout: {
      'icon-image': 'ship-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.45, 15, 0.9],
      'icon-rotate': ['get', 'bearing'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  map.addLayer({
    id: LAYER.pier,
    type: 'circle',
    source: 'vapur-piers',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 9],
      'circle-color': ['case', ['get', 'inDraft'], COLORS.pierDraft, COLORS.pier],
      'circle-stroke-color': COLORS.pierStroke,
      'circle-stroke-width': ['case', ['get', 'inDraft'], 3, 2],
    },
  });
  map.addLayer({
    id: 'vapur-pier-label',
    type: 'symbol',
    source: 'vapur-piers',
    layout: {
      'text-field': ['get', 'label'],
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

/** İskele, kapsama, tarihi işaret, hat ve tersane katmanları (ağ değişince). */
export function renderNetwork(map: MapLibreMap, game: Game, opts: { showLoad: boolean }): void {
  const { state, world } = game;
  const draft = new Set(game.draft);
  const waiting = (id: string) => (state.waiting[id] ?? []).reduce((s, g) => s + g.count, 0);
  source(map, 'vapur-piers').setData(
    fc(
      state.piers.map((p) => {
        const w = waiting(p.id);
        const label = w >= 50 ? `${p.name} · ${w}` : p.name;
        return point(p.coast, { id: p.id, name: p.name, label, inDraft: draft.has(p.id) });
      }),
    ),
  );
  source(map, 'vapur-coverage').setData(
    fc(state.piers.map((p) => ({ type: 'Feature' as const, properties: { id: p.id }, geometry: { type: 'MultiPolygon' as const, coordinates: game.coverage(p) } }))),
  );
  const used = new Set(state.piers.flatMap((p) => (p.historicId ? [p.historicId] : [])));
  source(map, 'vapur-historic').setData(fc(world.historic.filter((h) => !used.has(h.id)).map((h) => point(h.coast, { id: h.id, name: h.name }))));

  const lineFeatures: Feature[] = [];
  for (const line of state.lines) {
    const coords: LngLat[] = [];
    for (let leg = 0; leg < legCount(line) / 2; leg++) {
      const r = legRoute(world, state, line, leg);
      if (r) coords.push(...(coords.length ? r.points.slice(1) : r.points));
    }
    if (coords.length < 2) continue;
    const ls = state.lineStats[line.id];
    lineFeatures.push({
      type: 'Feature',
      properties: { id: line.id, color: line.color, selected: line.id === game.selectedLineId, loadWidth: opts.showLoad ? Math.min(1.5, ls?.load ?? 0) : 0 },
      geometry: { type: 'LineString', coordinates: coords },
    });
  }
  source(map, 'vapur-lines').setData(fc(lineFeatures));
  source(map, 'vapur-tersane').setData(fc(state.yards.map((y) => point(y.coast, { id: y.id, label: y.name }))));
}

export function renderShips(map: MapLibreMap, game: Game, frac: number): void {
  const { state, world } = game;
  const colors = new Map(state.lines.map((l) => [l.id, l.color]));
  const features: Feature<Point>[] = [];
  for (const ship of state.ships) {
    const pose = shipPose(state, world, ship, frac);
    if (!pose) continue;
    const onboard = ship.onboard.reduce((s, g) => s + g.count, 0);
    features.push(point(pose.p, { id: ship.id, color: colors.get(ship.lineId) ?? '#333', bearing: pose.bearing, load: onboard / SHIP_TYPES[ship.type].capacity }));
  }
  source(map, 'vapur-ships').setData(fc(features));
}

/** Hat taslağı: seçilen iskeleler arası su rotası + son iskeleden imlece kesikli çizgi. */
export function renderDraft(map: MapLibreMap, game: Game, cursor: LngLat | null): void {
  const { state, world } = game;
  const piers = game.draft.map((id) => state.piers.find((p) => p.id === id)).filter((p) => !!p);
  const features: Feature[] = [];
  for (let i = 0; i + 1 < piers.length; i++) {
    const a = piers[i]!, b = piers[i + 1]!;
    const r = world.routes.get(a.id, a.dock, b.id, b.dock);
    if (r) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.points } });
  }
  const last = piers[piers.length - 1];
  if (last && cursor && game.tool === 'line') {
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [last.coast, cursor] } });
  }
  source(map, 'vapur-draft').setData(fc(features));
}

export function renderGhost(map: MapLibreMap, ghost: GhostState | null): void {
  if (!ghost?.coast) {
    source(map, 'vapur-ghost').setData(fc([]));
    return;
  }
  const features: Feature[] = [
    { type: 'Feature', properties: { ok: ghost.ok }, geometry: { type: 'LineString', coordinates: [ghost.click, ghost.coast] } },
    point(ghost.coast, { ok: ghost.ok }),
  ];
  source(map, 'vapur-ghost').setData(fc(features));
}

export function setOverlay(map: MapLibreMap, data: FeatureCollection | null): void {
  map.setLayoutProperty('vapur-overlay-fill', 'visibility', data ? 'visible' : 'none');
  if (data) source(map, 'vapur-overlay').setData(data);
}

export function setCoverageVisible(map: MapLibreMap, visible: boolean): void {
  for (const id of ['vapur-coverage-fill', 'vapur-coverage-line']) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

export function setNoBuildEmphasis(map: MapLibreMap, strong: boolean): void {
  map.setPaintProperty(LAYER.noBuildFill, 'fill-opacity', strong ? 0.22 : 0.08);
}
