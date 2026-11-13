import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV } from '../config/balance.ts';
import { buildCoastIndex, haversineM, snapToCoast, waterSideOffset, type LngLat, type PolygonCoords } from '../geo/geo.ts';
import { PIER } from '../config/balance.ts';
import { buildWaterGrid, isWaterAt, landComponentAt } from './grid.ts';
import { findWaterRoute, makeRoute, pointAlong, RouteCache } from './route.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const region = read('region.json');
const waterPolys: PolygonCoords[] = read('water.geojson').features[0].geometry.coordinates;
const coast = buildCoastIndex(read('coastline.geojson').features[0].geometry.coordinates);
const historic: { id: string; lat: number; lng: number }[] = read('historic_piers.json').piers;
const breakwaters: LngLat[][] = read('breakwaters.geojson').features[0].geometry.coordinates;
const grid = buildWaterGrid(waterPolys, region.bbox, NAV.cellM, breakwaters);

/** İki doğru parçası kesişiyor mu (düzlemde yeterli). */
function segmentsCross(p1: LngLat, p2: LngLat, q1: LngLat, q2: LngLat): boolean {
  const o = (a: LngLat, b: LngLat, c: LngLat) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, q1) !== o(p1, p2, q2) && o(q1, q2, p1) !== o(q1, q2, p2);
}

const dock = (id: string): LngLat => {
  const h = historic.find((x) => x.id === id)!;
  return waterSideOffset(snapToCoast(coast, [h.lng, h.lat])!, PIER.dockOffsetM);
};
const coastPt = (id: string): LngLat => {
  const h = historic.find((x) => x.id === id)!;
  return snapToCoast(coast, [h.lng, h.lat])!.point;
};

describe('su ızgarası', () => {
  it('su ve kara doğru', () => {
    expect(isWaterAt(grid, [29.053, 41.07])).toBe(true);
    expect(isWaterAt(grid, [28.98, 41.006])).toBe(false);
  });

  it('Avrupa, Anadolu ve Büyükada ayrı kara bileşenleri', () => {
    const eu = landComponentAt(grid, coastPt('eminonu'));
    const as = landComponentAt(grid, coastPt('kadikoy'));
    const ada = landComponentAt(grid, coastPt('buyukada'));
    expect(eu).toBeGreaterThanOrEqual(0);
    expect(new Set([eu, as, ada]).size).toBe(3);
    expect(landComponentAt(grid, coastPt('sariyer'))).toBe(eu);
    expect(landComponentAt(grid, coastPt('eyup'))).toBe(eu);
    expect(landComponentAt(grid, coastPt('beykoz'))).toBe(as);
  });
});

describe('su üstü rota', () => {
  const cases: [string, string, number, number][] = [
    ['eminonu', 'kadikoy', 3000, 6000],
    ['eminonu', 'eyup', 4000, 8000], // Haliç boyunca
    ['sariyer', 'anadolukavagi', 2500, 5000], // Kavaklar
    ['kadikoy', 'buyukada', 15000, 24000],
    ['besiktas', 'uskudar', 1500, 3500],
  ];
  for (const [a, b, min, max] of cases) {
    it(`${a} → ${b} rota bulunur ve suda kalır`, () => {
      const r = findWaterRoute(grid, dock(a), dock(b));
      expect(r, `${a}-${b}`).not.toBeNull();
      expect(r!.lengthM).toBeGreaterThan(min);
      expect(r!.lengthM).toBeLessThan(max);
      // Ara noktalar suda (uçlar yanaşma noktası, kıyıya 30 m)
      for (let d = 200; d < r!.lengthM - 200; d += 100) {
        expect(isWaterAt(grid, pointAlong(r!, d).p), `${a}-${b} @${d}`).toBe(true);
      }
      // Sadeleştirme işe yaramış
      expect(r!.points.length).toBeLessThan(r!.lengthM / NAV.cellM / 2);
    });
  }

  for (const [a, b] of [['eminonu', 'kadikoy'], ['karakoy', 'haydarpasa'], ['kadikoy', 'bostanci'], ['uskudar', 'kadikoy']] as const) {
    it(`${a} → ${b} rotası dalgakıranları kesmez`, () => {
      const r = findWaterRoute(grid, dock(a), dock(b))!;
      expect(r).not.toBeNull();
      for (let i = 0; i + 1 < r.points.length; i++) {
        for (const bw of breakwaters) {
          for (let j = 0; j + 1 < bw.length; j++) {
            expect(segmentsCross(r.points[i]!, r.points[i + 1]!, bw[j]!, bw[j + 1]!), `${a}-${b} segment ${i} × dalgakıran`).toBe(false);
          }
        }
      }
    });
  }

  it('önbellek ters yönü üretir', () => {
    const cache = new RouteCache(grid);
    const ab = cache.get('a', dock('eminonu'), 'b', dock('kadikoy'))!;
    const ba = cache.get('b', dock('kadikoy'), 'a', dock('eminonu'))!;
    expect(ba.lengthM).toBeCloseTo(ab.lengthM, 3);
    expect(haversineM(ba.points[0]!, ab.points[ab.points.length - 1]!)).toBeLessThan(0.01);
  });

  it('pointAlong uçlarda ve ortada doğru', () => {
    const r = makeRoute([[29, 41], [29.01, 41]]);
    expect(pointAlong(r, 0).p).toEqual([29, 41]);
    expect(pointAlong(r, r.lengthM / 2).p[0]).toBeCloseTo(29.005, 6);
    expect(pointAlong(r, 1e9).p).toEqual([29.01, 41]);
  });
});
