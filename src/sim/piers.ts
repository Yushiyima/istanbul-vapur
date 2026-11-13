/**
 * İskele yerleştirme kuralları ve adlandırma. Saf mantık: DOM'a ve haritaya dokunmaz.
 */
import { PIER } from '../config/balance.ts';
import {
  haversineM,
  pointInPolygon,
  snapToCoast,
  waterSideOffset,
  type CoastIndex,
  type LngLat,
  type PolygonCoords,
} from '../geo/geo.ts';

export interface Pier {
  id: string;
  name: string;
  /** Kıyıdaki iskele noktası. */
  coast: LngLat;
  /** Gemilerin yanaştığı nokta (kıyıdan su tarafında). */
  dock: LngLat;
  /** Tarihi bir iskelenin yerine kurulduysa onun kimliği. */
  historicId?: string;
}

export interface HistoricPier {
  id: string;
  name: string;
  side: string;
  area: string;
  lat: number;
  lng: number;
  start?: boolean;
}

export interface Place {
  name: string;
  place: string;
  lat: number;
  lng: number;
}

export interface PlacementRules {
  maxSnapDistanceM: number;
  minSpacingM: number;
  dockOffsetM: number;
}

export interface PlacementContext {
  coast: CoastIndex;
  piers: readonly Pier[];
  noBuild: readonly { name: string; polygon: PolygonCoords }[];
  rules?: PlacementRules;
}

export type RejectReason = 'too-far-from-coast' | 'no-build-zone' | 'too-close-to-pier';

export type PlacementResult =
  | { ok: true; coast: LngLat; dock: LngLat; snapDistanceM: number }
  | { ok: false; reason: RejectReason; message: string; coast?: LngLat };

const fmtM = (m: number) => `${Math.round(m)} m`;

/** Tıklanan noktayı kıyıya yapıştırır ve yerleştirme kurallarını uygular. */
export function evaluatePlacement(click: LngLat, ctx: PlacementContext): PlacementResult {
  const rules = ctx.rules ?? PIER;
  const snap = snapToCoast(ctx.coast, click, rules.maxSnapDistanceM);
  if (!snap) {
    return {
      ok: false,
      reason: 'too-far-from-coast',
      message: `Kıyıya çok uzak: iskele kıyıdan en fazla ${fmtM(rules.maxSnapDistanceM)} içeriye konabilir.`,
    };
  }
  const coast = snap.point;
  const dock = waterSideOffset(snap, rules.dockOffsetM);

  const zone = ctx.noBuild.find((z) => pointInPolygon(coast, z.polygon) || pointInPolygon(dock, z.polygon));
  if (zone) {
    return { ok: false, reason: 'no-build-zone', message: `Yasak bölge: ${zone.name}.`, coast };
  }

  let nearest: { pier: Pier; d: number } | null = null;
  for (const pier of ctx.piers) {
    const d = haversineM(coast, pier.coast);
    if (!nearest || d < nearest.d) nearest = { pier, d };
  }
  if (nearest && nearest.d < rules.minSpacingM) {
    return {
      ok: false,
      reason: 'too-close-to-pier',
      message: `${nearest.pier.name} iskelesine çok yakın (${fmtM(nearest.d)}, en az ${fmtM(rules.minSpacingM)}).`,
      coast,
    };
  }

  return { ok: true, coast, dock, snapDistanceM: snap.distanceM };
}

/** Konuma en yakın tarihi iskele, `radiusM` içindeyse. Konumlar önceden kıyıya yapıştırılmış olmalı. */
export function findHistoricMatch<T extends { coast: LngLat }>(
  point: LngLat,
  historic: readonly T[],
  radiusM: number = PIER.historicMatchRadiusM,
): T | null {
  let best: T | null = null;
  let bestD = radiusM;
  for (const h of historic) {
    const d = haversineM(point, h.coast);
    if (d <= bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** En yakın semt/mahalle adı. Ad kullanılıyorsa sonuna sayı eklenir ("Bebek 2"). */
export function pickPierName(point: LngLat, places: readonly Place[], usedNames: ReadonlySet<string>): string {
  let base = 'İskele';
  let bestD = Infinity;
  for (const pl of places) {
    const d = haversineM(point, [pl.lng, pl.lat]);
    if (d < bestD) {
      bestD = d;
      base = pl.name;
    }
  }
  return uniqueName(base, usedNames);
}

export function uniqueName(base: string, usedNames: ReadonlySet<string>): string {
  if (!usedNames.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} ${i}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

/** Oyuncunun kurduğu iskeleler. Basit, sıralı liste. */
export class PierNetwork {
  private piers: Pier[] = [];
  private seq = 0;

  list(): readonly Pier[] {
    return this.piers;
  }

  names(): Set<string> {
    return new Set(this.piers.map((p) => p.name));
  }

  get(id: string): Pier | undefined {
    return this.piers.find((p) => p.id === id);
  }

  add(data: Omit<Pier, 'id'>): Pier {
    const pier: Pier = { id: `pier-${++this.seq}`, ...data };
    this.piers.push(pier);
    return pier;
  }

  remove(id: string): boolean {
    const before = this.piers.length;
    this.piers = this.piers.filter((p) => p.id !== id);
    return this.piers.length !== before;
  }
}
