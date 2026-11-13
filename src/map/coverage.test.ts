import { describe, expect, it } from 'vitest';
import { circlePolygon, pointInPolygon, type LngLat } from '../geo/geo.ts';
import { landComponentAt, isWaterAt } from '../nav/grid.ts';
import { PIER, UI } from '../config/balance.ts';
import { testWorld } from '../sim/testWorld.ts';
import { buildWaterIndex, landCoverage } from './coverage.ts';

const world = testWorld();
const water = buildWaterIndex(world.data.waterPolygons);
const site = (id: string) => world.historic.find((h) => h.id === id)!;

/** Kapsama içinde düzenli örnek noktalar. */
function samples(polys: ReturnType<typeof landCoverage>, center: LngLat): LngLat[] {
  const out: LngLat[] = [];
  for (let dx = -0.011; dx <= 0.011; dx += 0.0008) {
    for (let dy = -0.008; dy <= 0.008; dy += 0.0006) {
      const p: LngLat = [center[0] + dx, center[1] + dy];
      if (polys.some((poly) => pointInPolygon(p, poly))) out.push(p);
    }
  }
  return out;
}

describe('karada kalan kapsama', () => {
  for (const id of ['bebek', 'kanlica', 'kadikoy', 'buyukada', 'eminonu']) {
    it(`${id}: deniz ve karşı kıyı kapsama dışında`, () => {
      const h = site(id);
      const comp = landComponentAt(world.grid, h.coast);
      const polys = landCoverage(h.coast, comp, water, world.grid);
      expect(polys.length).toBeGreaterThan(0);
      const pts = samples(polys, h.coast);
      expect(pts.length).toBeGreaterThan(20);
      let wet = 0, otherSide = 0;
      for (const p of pts) {
        if (isWaterAt(world.grid, p)) wet++;
        else if (landComponentAt(world.grid, p, 1) !== comp) otherSide++;
      }
      // Izgara 50 m: kıyı şeridinde birkaç örnek su sayılabilir.
      expect(wet / pts.length).toBeLessThan(0.08);
      expect(otherSide).toBe(0);
      // Tam daireden küçük (deniz çıkarıldı).
      const full = samples([circlePolygon(h.coast, PIER.coverageRadiusM, UI.coverageCircleSteps)], h.coast).length;
      expect(pts.length).toBeLessThan(full * 0.85);
    });
  }
});
