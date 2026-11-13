/**
 * Veri katmanları: H3 hücrelerinde nüfus ve çekim (sıralı renk ölçeği, dilimlere göre).
 */
import { cellToBoundary } from 'h3-js';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { DEMAND } from '../config/balance.ts';
import { circlePolygon } from '../geo/geo.ts';
import { DAILY_FACTOR, gravityBase, hasRail, odTable } from '../sim/passengers.ts';
import type { GameState } from '../sim/types.ts';
import type { Station, World } from '../sim/world.ts';
import type { CellData } from '../sim/world.ts';

/** Açıktan koyuya 7 sınıf. Nüfus mavi-mor, çekim turuncu-kırmızı. */
const RAMPS = {
  pop: ['#eef3fb', '#cfdcf2', '#a9c1e6', '#7f9fd6', '#5b7cc4', '#4258a8', '#2f3a84'],
  att: ['#fff4e6', '#ffe0bd', '#ffc58f', '#ffa55e', '#f7823a', '#e05d23', '#b8401a'],
} as const;

const cache = new Map<string, FeatureCollection<Polygon>>();

export function overlayData(cells: CellData, kind: 'pop' | 'att'): FeatureCollection<Polygon> {
  const hit = cache.get(kind);
  if (hit) return hit;
  const values = cells[kind];
  const positive = values.filter((v) => v > 0).sort((a, b) => a - b);
  const ramp = RAMPS[kind];
  const breaks = ramp.map((_, i) => positive[Math.floor(((i + 1) / ramp.length) * (positive.length - 1))] ?? 0);
  const fc: FeatureCollection<Polygon> = { type: 'FeatureCollection', features: [] };
  for (let i = 0; i < cells.h.length; i++) {
    const v = values[i]!;
    if (v <= 0) continue;
    let cls = breaks.findIndex((b) => v <= b);
    if (cls < 0) cls = ramp.length - 1;
    const ring = cellToBoundary(cells.h[i]!, true);
    fc.features.push({ type: 'Feature', properties: { color: ramp[cls], v }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  cache.set(kind, fc);
  return fc;
}

// ---------------------------------------------------------------- raylı sistem

export const STATION_COLORS: Record<string, string> = {
  metro: '#e03131',
  marmaray: '#1971c2',
  'hafif-rayli': '#f08c00',
  banliyo: '#5f3dc4',
};

/** İstasyon noktaları ve 400 m aktarma halkaları. */
export function stationData(stations: readonly Station[]): FeatureCollection<Geometry> {
  const features: Feature<Geometry>[] = [];
  for (const s of stations) {
    const color = STATION_COLORS[s.kind] ?? '#495057';
    features.push({ type: 'Feature', properties: { kind: 'ring', color }, geometry: { type: 'Polygon', coordinates: circlePolygon([s.lng, s.lat], DEMAND.railTransferRadiusM, 32) } });
    features.push({ type: 'Feature', properties: { kind: 'station', color, name: s.name, type: s.kind }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } });
  }
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------- talep akışları

export interface FlowLine {
  o: string;
  d: string;
  daily: number;
  served: boolean;
}

/**
 * İskele çiftleri arası günlük potansiyel yolcu (iki yön toplamı, mod seçimi öncesi).
 * Hatla bağlı çiftler "karşılanan", diğerleri "karşılanmayan" talep.
 */
export function flowLines(state: GameState, world: World, limit = 80): FlowLine[] {
  const od = odTable(state, world);
  const rail = new Map(state.piers.map((p) => [p.id, hasRail(world, p)]));
  const out: FlowLine[] = [];
  for (let i = 0; i < state.piers.length; i++) {
    for (let j = i + 1; j < state.piers.length; j++) {
      const a = state.piers[i]!, b = state.piers[j]!;
      const daily = (gravityBase(world, a, b, rail.get(a.id), rail.get(b.id)) + gravityBase(world, b, a, rail.get(b.id), rail.get(a.id))) * DAILY_FACTOR;
      if (daily < 1) continue;
      out.push({ o: a.id, d: b.id, daily, served: od.byKey.has(`${a.id}>${b.id}`) });
    }
  }
  return out.sort((x, y) => y.daily - x.daily).slice(0, limit);
}

export function flowData(state: GameState, world: World): FeatureCollection<Geometry> {
  const flows = flowLines(state, world);
  const max = flows[0]?.daily ?? 1;
  const byId = new Map(state.piers.map((p) => [p.id, p]));
  return {
    type: 'FeatureCollection',
    features: flows.map((f) => {
      const a = byId.get(f.o)!.coast, b = byId.get(f.d)!.coast;
      // Hafif kavisli çizgi: üst üste binen akışlar ayrışsın.
      const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.12, my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.12;
      const coords: [number, number][] = [];
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const u = 1 - t;
        coords.push([u * u * a[0] + 2 * u * t * mx + t * t * b[0], u * u * a[1] + 2 * u * t * my + t * t * b[1]]);
      }
      return {
        type: 'Feature',
        properties: {
          served: f.served,
          width: 1 + 9 * Math.sqrt(f.daily / max),
          label: `${Math.round(f.daily).toLocaleString('tr-TR')}/gün`,
        },
        geometry: { type: 'LineString', coordinates: coords },
      };
    }),
  };
}
