import { describe, expect, it } from 'vitest';
import { PIER } from '../config/balance.ts';
import { buildCoastIndex, circlePolygon, haversineM, offsetM, type LngLat } from '../geo/geo.ts';
import { evaluatePlacement, findHistoricMatch, pickPierName, PierNetwork, uniqueName, type Pier } from './piers.ts';

const O: LngLat = [29.0, 41.0];
const coast = buildCoastIndex([[O, offsetM(O, 5000, 0)]]);
const pierAt = (eastM: number, name = 'A'): Pier => ({ id: name, name, coast: offsetM(O, eastM, 0), dock: offsetM(O, eastM, -30) });

describe('evaluatePlacement', () => {
  it('geçerli tıklamayı kıyıya yapıştırır', () => {
    const r = evaluatePlacement(offsetM(O, 1000, 120), { coast, piers: [], noBuild: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(haversineM(r.coast, offsetM(O, 1000, 0))).toBeLessThan(1);
    expect(r.snapDistanceM).toBeCloseTo(120, 0);
    expect(haversineM(r.coast, r.dock)).toBeCloseTo(PIER.dockOffsetM, 0);
  });

  it(`kıyıdan ${PIER.maxSnapDistanceM} m'den uzak tıklamayı reddeder`, () => {
    const r = evaluatePlacement(offsetM(O, 1000, PIER.maxSnapDistanceM + 5), { coast, piers: [], noBuild: [] });
    expect(r).toMatchObject({ ok: false, reason: 'too-far-from-coast' });
  });

  it('sınırın hemen içindeki tıklamayı kabul eder (su tarafı da)', () => {
    expect(evaluatePlacement(offsetM(O, 1000, PIER.maxSnapDistanceM - 5), { coast, piers: [], noBuild: [] }).ok).toBe(true);
    expect(evaluatePlacement(offsetM(O, 1000, -(PIER.maxSnapDistanceM - 5)), { coast, piers: [], noBuild: [] }).ok).toBe(true);
  });

  it(`başka iskeleye ${PIER.minSpacingM} m'den yakınsa reddeder`, () => {
    const piers = [pierAt(1000, 'Bebek')];
    const r = evaluatePlacement(offsetM(O, 1000 + PIER.minSpacingM - 20, 50), { coast, piers, noBuild: [] });
    expect(r).toMatchObject({ ok: false, reason: 'too-close-to-pier' });
    if (!r.ok) expect(r.message).toContain('Bebek');
  });

  it('mesafe kıyıya yapışmış noktaya göre ölçülür', () => {
    const piers = [pierAt(1000)];
    // Tıklama iskeleye 400 m'den yakın görünse de (çapraz), yapışınca 410 m uzakta kalır.
    const r = evaluatePlacement(offsetM(O, 1410, -200), { coast, piers, noBuild: [] });
    expect(r.ok).toBe(true);
  });

  it('en az mesafenin tam dışındaki yeri kabul eder', () => {
    const r = evaluatePlacement(offsetM(O, 1000 + PIER.minSpacingM + 10, 0), { coast, piers: [pierAt(1000)], noBuild: [] });
    expect(r.ok).toBe(true);
  });

  it('yasak bölgedeyse reddeder', () => {
    const zone = { name: 'Saray önü', polygon: circlePolygon(offsetM(O, 3000, 0), 200, 32) };
    const r = evaluatePlacement(offsetM(O, 3050, 100), { coast, piers: [], noBuild: [zone] });
    expect(r).toMatchObject({ ok: false, reason: 'no-build-zone' });
    if (!r.ok) expect(r.message).toContain('Saray önü');
    expect(evaluatePlacement(offsetM(O, 3500, 100), { coast, piers: [], noBuild: [zone] }).ok).toBe(true);
  });

  it('kurallar dışarıdan verilebilir', () => {
    const rules = { maxSnapDistanceM: 50, minSpacingM: 100, dockOffsetM: 10 };
    expect(evaluatePlacement(offsetM(O, 1000, 80), { coast, piers: [], noBuild: [], rules }).ok).toBe(false);
    expect(evaluatePlacement(offsetM(O, 1150, 0), { coast, piers: [pierAt(1000)], noBuild: [], rules }).ok).toBe(true);
  });
});

describe('adlandırma', () => {
  const places = [
    { name: 'Bebek', place: 'neighbourhood', lat: 41.0, lng: 29.0 },
    { name: 'Arnavutköy', place: 'neighbourhood', lat: 41.0, lng: 29.02 },
  ];

  it('en yakın yer adını seçer', () => {
    expect(pickPierName(offsetM(O, 100, 0), places, new Set())).toBe('Bebek');
    expect(pickPierName(offsetM(O, 1500, 0), places, new Set())).toBe('Arnavutköy');
  });

  it('kullanılan ada sayı ekler', () => {
    expect(uniqueName('Bebek', new Set(['Bebek']))).toBe('Bebek 2');
    expect(uniqueName('Bebek', new Set(['Bebek', 'Bebek 2']))).toBe('Bebek 3');
  });

  it('yakındaki tarihi iskeleyi eşler, uzaktakini eşlemez', () => {
    const historic = [{ id: 'bebek', coast: offsetM(O, 1000, 0) }];
    expect(findHistoricMatch(offsetM(O, 1100, 0), historic)?.id).toBe('bebek');
    expect(findHistoricMatch(offsetM(O, 1000 + PIER.historicMatchRadiusM + 20, 0), historic)).toBeNull();
  });
});

describe('PierNetwork', () => {
  it('ekler, bulur, siler', () => {
    const net = new PierNetwork();
    const a = net.add({ name: 'A', coast: O, dock: O });
    const b = net.add({ name: 'B', coast: O, dock: O });
    expect(a.id).not.toBe(b.id);
    expect(net.names()).toEqual(new Set(['A', 'B']));
    expect(net.remove(a.id)).toBe(true);
    expect(net.remove(a.id)).toBe(false);
    expect(net.list().map((p) => p.name)).toEqual(['B']);
  });
});
