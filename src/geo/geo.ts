/**
 * Saf geometri yardımcıları (DOM ve harita bağımsız). Koordinatlar [lng, lat].
 * Kısa mesafelerde (birkaç km) yerel eşdikdörtgen izdüşüm yeterince doğrudur.
 */

export type LngLat = [number, number];
/** Halkalar: ilki dış sınır, kalanlar delik. */
export type PolygonCoords = LngLat[][];

const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LNG_EQUATOR = 111_320;
const DEG = Math.PI / 180;

export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** `lat` enleminde 1 derece boylamın metre karşılığı. */
export function mPerDegLng(lat: number): number {
  return M_PER_DEG_LNG_EQUATOR * Math.cos(lat * DEG);
}

/** Bir noktayı metre cinsinden (doğu, kuzey) kaydırır. */
export function offsetM(p: LngLat, eastM: number, northM: number): LngLat {
  return [p[0] + eastM / mPerDegLng(p[1]), p[1] + northM / M_PER_DEG_LAT];
}

export function circlePolygon(center: LngLat, radiusM: number, steps: number): PolygonCoords {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * (i % steps)) / steps;
    ring.push(offsetM(center, radiusM * Math.cos(a), radiusM * Math.sin(a)));
  }
  return [ring];
}

// ------------------------------------------------------------ poligon içi

function pointInRing(p: LngLat, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: LngLat, polygon: PolygonCoords): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !pointInRing(p, outer)) return false;
  return !holes.some((h) => pointInRing(p, h));
}

// ------------------------------------------------------------ kıyıya yapışma

export interface CoastIndex {
  lines: LngLat[][];
  /** Her çizginin [batı, güney, doğu, kuzey] kutusu. */
  boxes: [number, number, number, number][];
}

export function buildCoastIndex(lines: LngLat[][]): CoastIndex {
  const usable = lines.filter((l) => l.length >= 2);
  const boxes = usable.map((l) => {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const [x, y] of l) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
    return [w, s, e, n] as [number, number, number, number];
  });
  return { lines: usable, boxes };
}

export interface CoastSnap {
  /** Kıyı üzerindeki en yakın nokta. */
  point: LngLat;
  /** Tıklanan noktadan kıyıya mesafe. */
  distanceM: number;
  /** Kıyı çizgisinin o noktadaki yönü (doğu, kuzey; birim vektör). Su sağ tarafta. */
  direction: [number, number];
}

/**
 * En yakın kıyı noktasını bulur. `searchRadiusM` içinde kıyı yoksa null döner.
 * Kıyı çizgileri OSM kuralına uyar: kara solda, su sağda.
 */
export function snapToCoast(index: CoastIndex, p: LngLat, searchRadiusM = Infinity): CoastSnap | null {
  const kx = mPerDegLng(p[1]);
  const ky = M_PER_DEG_LAT;
  const padLng = searchRadiusM / kx;
  const padLat = searchRadiusM / ky;

  let bestD2 = searchRadiusM === Infinity ? Infinity : searchRadiusM * searchRadiusM;
  let best: { x: number; y: number; line: number; seg: number; t: number } | null = null;

  for (let li = 0; li < index.lines.length; li++) {
    const box = index.boxes[li]!;
    if (p[0] < box[0] - padLng || p[0] > box[2] + padLng || p[1] < box[1] - padLat || p[1] > box[3] + padLat) continue;
    const line = index.lines[li]!;
    let ax = (line[0]![0] - p[0]) * kx;
    let ay = (line[0]![1] - p[1]) * ky;
    for (let si = 0; si < line.length - 1; si++) {
      const bx = (line[si + 1]![0] - p[0]) * kx;
      const by = (line[si + 1]![1] - p[1]) * ky;
      const dx = bx - ax, dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const x = ax + t * dx, y = ay + t * dy;
      const d2 = x * x + y * y;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { x, y, line: li, seg: si, t };
      }
      ax = bx;
      ay = by;
    }
  }
  if (!best) return null;

  const line = index.lines[best.line]!;
  const point: LngLat = [p[0] + best.x / kx, p[1] + best.y / ky];
  return { point, distanceM: Math.sqrt(bestD2), direction: directionAt(line, best.seg, best.t, kx, ky) };
}

/** Segment yönü; köşeye denk gelinirse komşu segmentlerin ortalaması. */
function directionAt(line: LngLat[], seg: number, t: number, kx: number, ky: number): [number, number] {
  const segDir = (i: number): [number, number] | null => {
    const a = line[i], b = line[i + 1];
    if (!a || !b) return null;
    const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky;
    const len = Math.hypot(dx, dy);
    return len > 0 ? [dx / len, dy / len] : null;
  };
  const here = segDir(seg) ?? [1, 0];
  const neighbour = t <= 0 ? segDir(seg - 1) : t >= 1 ? segDir(seg + 1) : null;
  if (!neighbour) return here;
  const sx = here[0] + neighbour[0], sy = here[1] + neighbour[1];
  const len = Math.hypot(sx, sy);
  return len > 1e-9 ? [sx / len, sy / len] : here;
}

/** Kıyı noktasından su tarafına (yönün sağına) `distanceM` kadar içerideki nokta. */
export function waterSideOffset(snap: CoastSnap, distanceM: number): LngLat {
  const [dx, dy] = snap.direction;
  return offsetM(snap.point, dy * distanceM, -dx * distanceM);
}
