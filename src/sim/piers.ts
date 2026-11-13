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
  /** Oyun alanı [batı, güney, doğu, kuzey]. Verilmezse kontrol edilmez. */
  bbox?: readonly [number, number, number, number];
  piers: readonly Pier[];
  noBuild: readonly { name: string; polygon: PolygonCoords }[];
  rules?: PlacementRules;
}

export type RejectReason = 'out-of-bounds' | 'too-far-from-coast' | 'no-build-zone' | 'too-close-to-pier';

export type PlacementResult =
  | { ok: true; coast: LngLat; dock: LngLat; snapDistanceM: number }
  | { ok: false; reason: RejectReason; message: string; coast?: LngLat };

const fmtM = (m: number) => `${Math.round(m)} m`;

/** Tıklanan noktayı kıyıya yapıştırır ve yerleştirme kurallarını uygular. */
export function evaluatePlacement(click: LngLat, ctx: PlacementContext): PlacementResult {
  const rules = ctx.rules ?? PIER;
  if (ctx.bbox) {
    const [w, s, e, n] = ctx.bbox;
    if (click[0] < w || click[0] > e || click[1] < s || click[1] > n) {
      return { ok: false, reason: 'out-of-bounds', message: 'Oyun alanı dışında: iskeleler İstanbul bölgesinin içine kurulabilir.' };
    }
  }
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

/** Ad karşılaştırması için: küçük harf (Türkçe), boşluk ve noktalama yok. "Rumeli Kavağı" = "Rumelikavağı". */
export function normalizeName(s: string): string {
  return s.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * İskele adı için yer türü ağırlıkları. Etkin mesafe = mesafe / ağırlık; büyük ağırlık öne geçer.
 * İstanbul OSM'inde semtler çoğunlukla `quarter` (Hasköy, Karaköy, Moda), mahalleler `suburb`,
 * ilçeler `town`. `locality` (site, plaj vb.) hiç kullanılmaz.
 */
export const PLACE_NAME_WEIGHT: Readonly<Record<string, number>> = {
  quarter: 1.6,
  suburb: 1.0,
  village: 1.0,
  island: 1.3,
  islet: 0.8,
  neighbourhood: 0.7,
  town: 0.6,
};

export interface NameOptions {
  /** Kullanımda olan iskele adları. */
  used: ReadonlySet<string>;
  /** Henüz kurulmamış tarihi iskelelerin adları: başka iskeleye verilmez. */
  reserved?: ReadonlySet<string>;
  /** Tüm tarihi iskele adları: OSM adı bunlardan birine denkse tarihi yazım kullanılır. */
  historicNames?: readonly string[];
}

/** En uygun semt/mahalle adı. Ad kullanılıyorsa sonuna sayı eklenir ("Bebek 2"). */
export function pickPierName(point: LngLat, places: readonly Place[], opts: NameOptions): string {
  const reserved = new Set([...(opts.reserved ?? [])].map(normalizeName));
  const historicByNorm = new Map((opts.historicNames ?? []).map((n) => [normalizeName(n), n] as const));
  let base = 'İskele';
  let bestScore = Infinity;
  for (const pl of places) {
    const weight = PLACE_NAME_WEIGHT[pl.place];
    if (!weight) continue;
    if (reserved.has(normalizeName(pl.name))) continue;
    const score = haversineM(point, [pl.lng, pl.lat]) / weight;
    if (score < bestScore) {
      bestScore = score;
      base = pl.name;
    }
  }
  base = historicByNorm.get(normalizeName(base)) ?? base;
  return uniqueName(base, opts.used);
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

  rename(id: string, name: string): void {
    const p = this.get(id);
    if (p) p.name = name;
  }

  remove(id: string): boolean {
    const before = this.piers.length;
    this.piers = this.piers.filter((p) => p.id !== id);
    return this.piers.length !== before;
  }
}
