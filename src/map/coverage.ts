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
  const near = water.polys.filter((_, i) => {
    const b = water.boxes[i]!;
    return !(b[2] < w || b[0] > e || b[3] < s || b[1] > n);
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
