/**
 * Gerçek şehir paketiyle duman testi: kıyı verisi ve kurallar birlikte doğru davranıyor mu?
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PIER } from '../config/balance.ts';
import { buildCoastIndex, haversineM, offsetM, pointInPolygon, snapToCoast, type LngLat, type PolygonCoords } from '../geo/geo.ts';
import { evaluatePlacement, type Pier } from './piers.ts';

const read = (f: string) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const coastFc = read('coastline.geojson');
const water = read('water.geojson');
const noBuildFc = read('no_build.geojson');
const historic: { id: string; name: string; lat: number; lng: number }[] = read('historic_piers.json').piers;

const coast = buildCoastIndex(coastFc.features.flatMap((f: { geometry: { coordinates: LngLat[][] } }) => f.geometry.coordinates));
const waterPolys: PolygonCoords[] = water.features[0].geometry.coordinates;
const noBuild = noBuildFc.features.map((f: { properties: { name: string }; geometry: { coordinates: PolygonCoords } }) => ({
  name: f.properties.name,
  polygon: f.geometry.coordinates,
}));
const inWater = (p: LngLat) => waterPolys.some((poly) => pointInPolygon(p, poly));

describe('İstanbul şehir paketi', () => {
  it(`tüm tarihi iskeleler kıyıya ${PIER.historicWarnDistanceM} m içinde`, () => {
    for (const h of historic) {
      const snap = snapToCoast(coast, [h.lng, h.lat]);
      expect(snap, h.name).not.toBeNull();
      expect(snap!.distanceM, h.name).toBeLessThanOrEqual(PIER.historicWarnDistanceM);
    }
  });

  it('su poligonu doğru tarafta: Boğaz ortası su, Sultanahmet kara', () => {
    expect(inWater([29.0530, 41.0700])).toBe(true); // Boğaz ortası, Bebek–Kandilli
    expect(inWater([28.9800, 41.0060])).toBe(false); // Sultanahmet
    expect(inWater([29.0700, 40.9600])).toBe(true); // Marmara, Caddebostan açığı
    expect(inWater([29.1200, 40.8700])).toBe(false); // Büyükada içi
  });

  it('tarihi iskelelerin yanaşma noktası suda', () => {
    let wet = 0;
    for (const h of historic) {
      const r = evaluatePlacement([h.lng, h.lat], { coast, piers: [], noBuild: [] });
      if (r.ok && inWater(r.dock)) wet++;
    }
    // Kıvrımlı rıhtımlarda birkaç istisna olabilir; büyük çoğunluk suda olmalı.
    expect(wet / historic.length).toBeGreaterThan(0.85);
  });

  it('Dolmabahçe önü yasak, Kabataş ve Beşiktaş serbest', () => {
    expect(evaluatePlacement([28.9985, 41.0375], { coast, piers: [], noBuild })).toMatchObject({ ok: false, reason: 'no-build-zone' });
    for (const h of historic.filter((x) => x.id === 'kabatas' || x.id === 'besiktas')) {
      expect(evaluatePlacement([h.lng, h.lat], { coast, piers: [], noBuild }).ok, h.name).toBe(true);
    }
  });

  it('Kadıköy varken hemen yanı reddedilir, Haydarpaşa (≈670 m) ve Üsküdar serbest', () => {
    const k = historic.find((h) => h.id === 'kadikoy')!;
    const r = evaluatePlacement([k.lng, k.lat], { coast, piers: [], noBuild });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const kadikoy: Pier = { id: 'k', name: 'Kadıköy', coast: r.coast, dock: r.dock };
    const ctx = { coast, piers: [kadikoy], noBuild };
    const near = evaluatePlacement(offsetM(r.coast, -150, 150), ctx);
    expect(near).toMatchObject({ reason: 'too-close-to-pier' });
    for (const id of ['haydarpasa', 'uskudar']) {
      const h = historic.find((x) => x.id === id)!;
      expect(haversineM([h.lng, h.lat], r.coast), h.name).toBeGreaterThan(PIER.minSpacingM);
      expect(evaluatePlacement([h.lng, h.lat], ctx).ok, h.name).toBe(true);
    }
  });

  it('kara içine tıklama reddedilir', () => {
    expect(evaluatePlacement([28.9600, 41.0150], { coast, piers: [], noBuild })).toMatchObject({ reason: 'too-far-from-coast' }); // Aksaray
  });
});
