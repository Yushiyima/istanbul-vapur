/**
 * Su ızgarası: su poligonu ~50 m hücrelere rasterleştirilir.
 * - water: 1 = su, 0 = kara
 * - coast: 1 = karaya komşu su hücresi (rotada pahalı, gemiler kıyıyı sıyırmasın)
 * - landComp: kara hücrelerinin bağlı bileşen kimliği (yakalar/adalar), su hücrelerinde -1
 */
import { mPerDegLng, type LngLat, type PolygonCoords } from '../geo/geo.ts';

const M_PER_DEG_LAT = 110_574;

export interface WaterGrid {
  cols: number;
  rows: number;
  west: number;
  north: number;
  dLng: number;
  dLat: number;
  cellM: number;
  water: Uint8Array;
  coast: Uint8Array;
  landComp: Int32Array;
  /** Bileşen kimliğine göre hücre sayısı. */
  compSize: number[];
}

export function buildWaterGrid(
  water: readonly PolygonCoords[],
  bbox: readonly [number, number, number, number],
  cellM: number,
): WaterGrid {
  const [W, S, E, N] = bbox;
  const dLat = cellM / M_PER_DEG_LAT;
  const dLng = cellM / mPerDegLng((S + N) / 2);
  const cols = Math.ceil((E - W) / dLng);
  const rows = Math.ceil((N - S) / dLat);
  const waterArr = new Uint8Array(cols * rows);

  // Tüm halkaların kenarları; çift-tek kuralıyla tarama satırı doldurma (delikler kendiliğinden çıkar).
  const edges: number[] = [];
  for (const poly of water) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i]!, b = ring[i + 1]!;
        if (a[1] === b[1]) continue;
        edges.push(a[0], a[1], b[0], b[1]);
      }
    }
  }
  const xs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const y = N - (r + 0.5) * dLat;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const y1 = edges[e + 1]!, y2 = edges[e + 3]!;
      if ((y1 > y) !== (y2 > y)) {
        const x1 = edges[e]!, x2 = edges[e + 2]!;
        xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k]! - W) / dLng - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1]! - W) / dLng - 0.5));
      for (let c = c0; c <= c1; c++) waterArr[r * cols + c] = 1;
    }
  }

  const coast = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!waterArr[i]) continue;
      outer: for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          if (!waterArr[rr * cols + cc]) {
            coast[i] = 1;
            break outer;
          }
        }
      }
    }
  }

  const landComp = new Int32Array(cols * rows).fill(-1);
  const compSize: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < cols * rows; start++) {
    if (waterArr[start] || landComp[start] !== -1) continue;
    const id = compSize.length;
    let size = 0;
    landComp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const r = (i / cols) | 0, c = i - r * cols;
      const nb = [r > 0 ? i - cols : -1, r < rows - 1 ? i + cols : -1, c > 0 ? i - 1 : -1, c < cols - 1 ? i + 1 : -1];
      for (const j of nb) {
        if (j >= 0 && !waterArr[j] && landComp[j] === -1) {
          landComp[j] = id;
          stack.push(j);
        }
      }
    }
    compSize.push(size);
  }

  return { cols, rows, west: W, north: N, dLng, dLat, cellM, water: waterArr, coast, landComp, compSize };
}

export function cellIndex(g: WaterGrid, p: LngLat): number {
  const c = Math.floor((p[0] - g.west) / g.dLng);
  const r = Math.floor((g.north - p[1]) / g.dLat);
  if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return -1;
  return r * g.cols + c;
}

export function cellCenter(g: WaterGrid, i: number): LngLat {
  const r = (i / g.cols) | 0, c = i - r * g.cols;
  return [g.west + (c + 0.5) * g.dLng, g.north - (r + 0.5) * g.dLat];
}

export function isWaterAt(g: WaterGrid, p: LngLat): boolean {
  const i = cellIndex(g, p);
  return i >= 0 && g.water[i] === 1;
}

/** Bundan küçük kara bileşenleri (dalgakıran, mendirek) yaka sayılmaz. */
const MIN_LAND_COMPONENT_CELLS = 20;

/**
 * Noktanın ait olduğu kara bileşeni: `maxRing` hücre içindeki kara hücrelerinden en büyük
 * bileşene ait olanı. Dalgakıran gibi minik parçalar böylece yakayı bozmaz. Yoksa -1.
 */
export function landComponentAt(g: WaterGrid, p: LngLat, maxRing = 4): number {
  const i0 = cellIndex(g, p);
  if (i0 < 0) return -1;
  if (!g.water[i0] && g.compSize[g.landComp[i0]!]! >= MIN_LAND_COMPONENT_CELLS) return g.landComp[i0]!;
  const r0 = (i0 / g.cols) | 0, c0 = i0 - r0 * g.cols;
  let best = -1;
  for (let dr = -maxRing; dr <= maxRing; dr++) {
    for (let dc = -maxRing; dc <= maxRing; dc++) {
      const r = r0 + dr, c = c0 + dc;
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
      const j = r * g.cols + c;
      if (g.water[j]) continue;
      const comp = g.landComp[j]!;
      if (best < 0 || g.compSize[comp]! > g.compSize[best]!) best = comp;
    }
  }
  return best;
}

/** `p`'ye en yakın su hücresi (BFS, en fazla `maxRing` halka). */
export function nearestWaterCell(g: WaterGrid, p: LngLat, maxRing = 10): number {
  const i0 = cellIndex(g, p);
  if (i0 < 0) return -1;
  if (g.water[i0]) return i0;
  const r0 = (i0 / g.cols) | 0, c0 = i0 - r0 * g.cols;
  for (let ring = 1; ring <= maxRing; ring++) {
    let best = -1, bestD = Infinity;
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const r = r0 + dr, c = c0 + dc;
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
        const j = r * g.cols + c;
        if (!g.water[j]) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}
