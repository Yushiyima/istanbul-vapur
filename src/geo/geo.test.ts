import { describe, expect, it } from 'vitest';
import {
  buildCoastIndex,
  circlePolygon,
  haversineM,
  offsetM,
  pointInPolygon,
  snapToCoast,
  waterSideOffset,
  type LngLat,
} from './geo.ts';

const O: LngLat = [29.0, 41.0];
/** O'dan doğuya giden 1 km'lik düz kıyı: kara kuzeyde (solda), su güneyde (sağda). */
const straightCoast = buildCoastIndex([[O, offsetM(O, 1000, 0)]]);

describe('haversineM / offsetM', () => {
  it('offsetM ile kaydırılan nokta istenen mesafede', () => {
    expect(haversineM(O, offsetM(O, 400, 0))).toBeCloseTo(400, -1);
    expect(haversineM(O, offsetM(O, 0, 400))).toBeCloseTo(400, -1);
    expect(haversineM(O, offsetM(O, 300, 400))).toBeCloseTo(500, -1);
  });
});

describe('snapToCoast', () => {
  it('kıyıya dik izdüşümü bulur', () => {
    const click = offsetM(O, 500, 120);
    const snap = snapToCoast(straightCoast, click)!;
    expect(snap.distanceM).toBeCloseTo(120, 0);
    expect(haversineM(snap.point, offsetM(O, 500, 0))).toBeLessThan(1);
  });

  it('segment ucunu geçen tıklamayı uç noktaya yapıştırır', () => {
    const snap = snapToCoast(straightCoast, offsetM(O, -300, 400))!;
    expect(haversineM(snap.point, O)).toBeLessThan(1);
    expect(snap.distanceM).toBeCloseTo(500, -1);
  });

  it('arama yarıçapı dışındaysa null döner', () => {
    expect(snapToCoast(straightCoast, offsetM(O, 500, 301), 300)).toBeNull();
    expect(snapToCoast(straightCoast, offsetM(O, 500, 299), 300)).not.toBeNull();
  });

  it('birden fazla çizgiden en yakınını seçer', () => {
    const far = offsetM(O, 0, 2000);
    const index = buildCoastIndex([
      [O, offsetM(O, 1000, 0)],
      [far, offsetM(far, 1000, 0)],
    ]);
    const snap = snapToCoast(index, offsetM(O, 500, 1800))!;
    expect(snap.distanceM).toBeCloseTo(200, 0);
    expect(snap.point[1]).toBeGreaterThan(O[1]);
  });

  it('yanaşma noktası su tarafında (sağda) ve doğru mesafede', () => {
    const snap = snapToCoast(straightCoast, offsetM(O, 500, 50))!;
    const dock = waterSideOffset(snap, 30);
    expect(dock[1]).toBeLessThan(snap.point[1]); // güney = su
    expect(haversineM(dock, snap.point)).toBeCloseTo(30, 0);
  });

  it('ters yönlü kıyıda yanaşma noktası diğer tarafa geçer', () => {
    const reversed = buildCoastIndex([[offsetM(O, 1000, 0), O]]);
    const dock = waterSideOffset(snapToCoast(reversed, offsetM(O, 500, -50))!, 30);
    expect(dock[1]).toBeGreaterThan(O[1]);
  });
});

describe('pointInPolygon', () => {
  const square = circlePolygon(O, 500, 4); // eşkenar dörtgen
  const withHole = [square[0]!, circlePolygon(O, 100, 32)[0]!];

  it('içerideki ve dışarıdaki noktalar', () => {
    expect(pointInPolygon(offsetM(O, 100, 100), square)).toBe(true);
    expect(pointInPolygon(offsetM(O, 400, 400), square)).toBe(false);
  });

  it('delik içindeki nokta dışarıda sayılır', () => {
    expect(pointInPolygon(O, withHole)).toBe(false);
    expect(pointInPolygon(offsetM(O, 250, 0), withHole)).toBe(true);
  });
});

describe('circlePolygon', () => {
  it('her nokta yarıçap mesafesinde ve halka kapalı', () => {
    const [ring] = circlePolygon(O, 800, 64);
    expect(ring!.length).toBe(65);
    expect(ring![0]).toEqual(ring![64]);
    for (const p of ring!) expect(haversineM(O, p)).toBeCloseTo(800, -1);
  });
});
