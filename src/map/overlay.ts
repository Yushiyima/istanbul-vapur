/**
 * Veri katmanları: H3 hücrelerinde nüfus ve çekim (sıralı renk ölçeği, dilimlere göre).
 */
import { cellToBoundary } from 'h3-js';
import type { FeatureCollection, Polygon } from 'geojson';
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
