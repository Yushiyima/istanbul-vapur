/**
 * Kapsama alanı çizimi: 800 m daire − su, sadece iskelenin kendi yakasındaki kara parçaları.
 */
import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import { PIER, UI } from '../config/balance.ts';
import { circlePolygon, haversineM, type LngLat, type PolygonCoords } from '../geo/geo.ts';
import { landComponentAt, type WaterGrid } from '../nav/grid.ts';

/** Su poligonlarının kutuları: daireyle kesişmeyenler farka sokulmaz (hız). */
export interface WaterIndex {
  polys: PolygonCoords[];
  boxes: [number, number, number, number][];
}

export function buildWaterIndex(polys: readonly PolygonCoords[]): WaterIndex {
  return {
    polys: [...polys],
    boxes: polys.map((p) => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [x, y] of p[0]!) {
        if (x < w) w = x;
        if (x > e) e = x;
        if (y < s) s = y;
        if (y > n) n = y;
      }
      return [w, s, e, n];
    }),
  };
}

/**
 * Sutherland–Hodgman: halkayı dikdörtgene kırpar. Büyük deniz poligonunu dairenin kutusuna
 * indirmek için (fark işlemini ~20 kat hızlandırır). Çıktı kenar boyunca kendine değebilir;
 * polygon-clipping bunu sorunsuz işler.
 */
export function clipRingToRect(ring: readonly LngLat[], [w, s, e, n]: [number, number, number, number]): LngLat[] {
  type Edge = { inside: (p: LngLat) => boolean; cut: (a: LngLat, b: LngLat) => LngLat };
  const lerpX = (a: LngLat, b: LngLat, x: number): LngLat => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
  const lerpY = (a: LngLat, b: LngLat, y: number): LngLat => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
  const edges: Edge[] = [
    { inside: (p) => p[0] >= w, cut: (a, b) => lerpX(a, b, w) },
    { inside: (p) => p[0] <= e, cut: (a, b) => lerpX(a, b, e) },
    { inside: (p) => p[1] >= s, cut: (a, b) => lerpY(a, b, s) },
    { inside: (p) => p[1] <= n, cut: (a, b) => lerpY(a, b, n) },
  ];
  let out: LngLat[] = ring.slice(0, -1);
  for (const edge of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!, prev = input[(i + input.length - 1) % input.length]!;
      const ci = edge.inside(cur), pi = edge.inside(prev);
      if (ci) {
        if (!pi) out.push(edge.cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(edge.cut(prev, cur));
    }
    if (!out.length) return [];
  }
  out.push(out[0]!);
  return out;
}

export function landCoverage(center: LngLat, comp: number, water: WaterIndex, grid: WaterGrid): PolygonCoords[] {
  const R = PIER.coverageRadiusM;
  const circle = circlePolygon(center, R, UI.coverageCircleSteps);
  const ring = circle[0]!;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  // Dairenin biraz genişletilmiş kutusuna kırpılmış deniz parçaları.
  const pad = 0.002;
  const rect: [number, number, number, number] = [w - pad, s - pad, e + pad, n + pad];
  const near: PolygonCoords[] = [];
  water.polys.forEach((poly, i) => {
    const b = water.boxes[i]!;
    if (b[2] < rect[0] || b[0] > rect[2] || b[3] < rect[1] || b[1] > rect[3]) return;
    const outer = clipRingToRect(poly[0]!, rect);
    if (outer.length < 4) return;
    const holes = poly.slice(1).map((h) => clipRingToRect(h, rect)).filter((h) => h.length >= 4);
    near.push([outer, ...holes]);
  });
  let land: MultiPolygon;
  try {
    land = near.length ? polygonClipping.difference(circle as Polygon, ...(near as Polygon[])) : [circle as Polygon];
  } catch {
    return [circle];
  }
  // Karşı kıyıdaki parçaları at: dış halkada daire üzerindeki bir köşenin yakası.
  return (land as PolygonCoords[]).filter((poly) => {
    const outer = poly[0]!;
    const onArc = outer.find((v) => Math.abs(haversineM(center, v) - R) < 3) ?? outer[0]!;
    // Daire üstündeki nokta karadadır; içeri doğru biraz kaydırıp yakasına bak.
    const inward: LngLat = [onArc[0] + (center[0] - onArc[0]) * 0.03, onArc[1] + (center[1] - onArc[1]) * 0.03];
    return landComponentAt(grid, inward, 2) === comp;
  });
}
