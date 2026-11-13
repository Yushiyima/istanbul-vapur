/**
 * Su üstü rota: ızgarada A*, görüş hattıyla sadeleştirme, iskele çifti başına önbellek.
 */
import { NAV } from '../config/balance.ts';
import { haversineM, type LngLat } from '../geo/geo.ts';
import { cellCenter, cellIndex, nearestWaterCell, type WaterGrid } from './grid.ts';

export interface Route {
  points: LngLat[];
  /** points[i]'ye kadarki kümülatif mesafe (m). */
  cum: number[];
  lengthM: number;
}

export function makeRoute(points: LngLat[]): Route {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  return { points, cum, lengthM: cum[cum.length - 1]! };
}

export function reverseRoute(r: Route): Route {
  return makeRoute([...r.points].reverse());
}

/** Rota üzerinde `d` metredeki nokta ve yön (doğu, kuzey birim vektör). */
export function pointAlong(r: Route, d: number): { p: LngLat; dir: [number, number] } {
  const pts = r.points;
  if (pts.length === 1 || d <= 0) return { p: pts[0]!, dir: segDir(pts[0]!, pts[1] ?? pts[0]!) };
  if (d >= r.lengthM) {
    const n = pts.length;
    return { p: pts[n - 1]!, dir: segDir(pts[n - 2]!, pts[n - 1]!) };
  }
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (r.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const a = pts[lo]!, b = pts[hi]!;
  const seg = r.cum[hi]! - r.cum[lo]!;
  const t = seg > 0 ? (d - r.cum[lo]!) / seg : 0;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: segDir(a, b) };
}

function segDir(a: LngLat, b: LngLat): [number, number] {
  const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  return len > 0 ? [dx / len, dy / len] : [1, 0];
}

// ------------------------------------------------------------ A*

class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  get size(): number {
    return this.idx.length;
  }
  push(i: number, p: number): void {
    const a = this.idx, q = this.pri;
    a.push(i);
    q.push(p);
    let k = a.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (q[parent]! <= q[k]!) break;
      [a[k], a[parent]] = [a[parent]!, a[k]!];
      [q[k], q[parent]] = [q[parent]!, q[k]!];
      k = parent;
    }
  }
  pop(): number {
    const a = this.idx, q = this.pri;
    const top = a[0]!;
    const lastI = a.pop()!, lastP = q.pop()!;
    if (a.length) {
      a[0] = lastI;
      q[0] = lastP;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < a.length && q[l]! < q[m]!) m = l;
        if (r < a.length && q[r]! < q[m]!) m = r;
        if (m === k) break;
        [a[k], a[m]] = [a[m]!, a[k]!];
        [q[k], q[m]] = [q[m]!, q[k]!];
        k = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

/** İki su hücresi arası A*. Hücre indeksleri listesi ya da null. */
export function astarCells(g: WaterGrid, start: number, goal: number, cellCost?: (i: number) => number): number[] | null {
  if (start < 0 || goal < 0 || !g.water[start] || !g.water[goal]) return null;
  const n = g.cols * g.rows;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gr = (goal / g.cols) | 0, gc = goal - gr * g.cols;
  const h = (i: number) => {
    const r = (i / g.cols) | 0, c = i - r * g.cols;
    const dr = Math.abs(r - gr), dc = Math.abs(c - gc);
    return dr + dc + (SQRT2 - 2) * Math.min(dr, dc);
  };
  const heap = new MinHeap();
  gScore[start] = 0;
  heap.push(start, h(start));
  const coastCost = NAV.coastCellCost;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const r = (cur / g.cols) | 0, c = cur - r * g.cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= g.rows || cc >= g.cols) continue;
        const nb = rr * g.cols + cc;
        if (!g.water[nb] || closed[nb]) continue;
        // Çapraz adımda köşe kesme yok: iki dik komşu da su olmalı.
        if (dr && dc && (!g.water[r * g.cols + cc] || !g.water[rr * g.cols + c])) continue;
        const step = (dr && dc ? SQRT2 : 1) * (g.coast[nb] ? coastCost : 1) * (cellCost ? cellCost(nb) : 1);
        const tentative = gScore[cur]! + step;
        if (tentative < gScore[nb]!) {
          gScore[nb] = tentative;
          came[nb] = cur;
          heap.push(nb, tentative + h(nb));
        }
      }
    }
  }
  if (came[goal] === -1 && start !== goal) return null;
  const path = [goal];
  while (path[path.length - 1] !== start) path.push(came[path[path.length - 1]!]!);
  return path.reverse();
}

/** a→b doğrusu üstündeki hücreler su ve kıyıdan uzak mı (uç hücreler hariç)? */
function clearLine(g: WaterGrid, a: LngLat, b: LngLat): boolean {
  const ia = cellIndex(g, a), ib = cellIndex(g, b);
  const lenM = haversineM(a, b);
  const steps = Math.max(1, Math.ceil(lenM / (g.cellM * 0.4)));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const i = cellIndex(g, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (i === ia || i === ib) continue;
    if (i < 0 || !g.water[i] || g.coast[i]) return false;
  }
  return true;
}

/** Görüş hattı sadeleştirme: her çapadan görülebilen en uzak noktaya atla. */
export function smoothPath(g: WaterGrid, pts: LngLat[]): LngLat[] {
  if (pts.length <= 2) return pts;
  const out = [pts[0]!];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let next = anchor + 1;
    for (let k = anchor + 2; k < pts.length; k++) {
      if (clearLine(g, pts[anchor]!, pts[k]!)) next = k;
      else if (k - next > NAV.smoothLookahead) break;
    }
    out.push(pts[next]!);
    anchor = next;
  }
  return out;
}

/** İki yanaşma noktası arasında su üstü rota. Bulunamazsa null. */
export function findWaterRoute(g: WaterGrid, from: LngLat, to: LngLat): Route | null {
  const s = nearestWaterCell(g, from), e = nearestWaterCell(g, to);
  const cells = astarCells(g, s, e);
  if (!cells) return null;
  const pts: LngLat[] = [from, ...cells.map((i) => cellCenter(g, i)), to];
  return makeRoute(smoothPath(g, pts));
}

/** İskele çifti başına rota önbelleği (a→b bulunduysa b→a ters çevrilerek verilir). */
export class RouteCache {
  private cache = new Map<string, Route | null>();
  private grid: WaterGrid;
  constructor(grid: WaterGrid) {
    this.grid = grid;
  }

  get(aId: string, a: LngLat, bId: string, b: LngLat): Route | null {
    const key = `${aId}>${bId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    const rev = this.cache.get(`${bId}>${aId}`);
    const route = rev !== undefined ? (rev ? reverseRoute(rev) : null) : findWaterRoute(this.grid, a, b);
    this.cache.set(key, route);
    return route;
  }

  /** İskele silinince/taşınınca ilgili rotaları unut. */
  forget(pierId: string): void {
    for (const k of [...this.cache.keys()]) {
      const [x, y] = k.split('>');
      if (x === pierId || y === pierId) this.cache.delete(k);
    }
  }
}
