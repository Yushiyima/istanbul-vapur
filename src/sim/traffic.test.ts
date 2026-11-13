import { describe, expect, it } from 'vitest';
import { TRAFFIC } from '../config/balance.ts';
import { haversineM, type LngLat } from '../geo/geo.ts';
import { isWaterAt } from '../nav/grid.ts';
import { pointAlong } from '../nav/route.ts';
import { buyShip, createLine } from './network.ts';
import { createGame } from './state.ts';
import { placeHistoric, testWorld } from './testWorld.ts';
import { tick } from './tick.ts';
import { avoidance, channelOf, spawnTraffic, tickTraffic, trafficPose } from './traffic.ts';

const world = testWorld();

describe('Boğaz kanalı', () => {
  it('Karadeniz’den Marmara’ya suda kalan iki şerit', () => {
    const ch = channelOf(world)!;
    expect(ch).not.toBeNull();
    for (const r of [ch.south, ch.north]) {
      expect(r.lengthM).toBeGreaterThan(28_000);
      expect(r.lengthM).toBeLessThan(45_000);
      let dry = 0, n = 0;
      for (let d = 0; d < r.lengthM; d += 200) {
        n++;
        if (!isWaterAt(world.grid, pointAlong(r, d).p)) dry++;
      }
      expect(dry / n).toBeLessThan(0.02);
    }
    // Bebek–Kandilli arasında orta hatta yakın geçer (iki kıyıdan uzak).
    const mid = ch.south.points.reduce((best, p) => (Math.abs(p[1] - 41.075) < Math.abs(best[1] - 41.075) ? p : best));
    expect(mid[0]).toBeGreaterThan(29.045);
    expect(mid[0]).toBeLessThan(29.065);
  });

  it('şeritler sağdan seyir: iki yön birbirinden ayrık', () => {
    const ch = channelOf(world)!;
    const a = pointAlong(ch.south, ch.south.lengthM / 2).p;
    let best = Infinity;
    for (let d = 0; d < ch.north.lengthM; d += 100) best = Math.min(best, haversineM(a, pointAlong(ch.north, d).p));
    expect(best).toBeGreaterThan(80);
  });
});

describe('trafik akışı', () => {
  it('gemiler doğar, ilerler, kanaldan çıkınca silinir', () => {
    const state = createGame(4);
    const t = spawnTraffic(state, world, 'konteyner', 1)!;
    const before = trafficPose(world, t)!.p;
    for (let i = 0; i < 10; i++) tickTraffic(state, world);
    const after = trafficPose(world, state.traffic.find((x) => x.id === t.id)!)!.p;
    expect(haversineM(before, after)).toBeGreaterThan(2500);
    for (let i = 0; i < 400; i++) tickTraffic(state, world);
    expect(state.traffic.find((x) => x.id === t.id)).toBeUndefined();
  });

  it('gün boyunca saatte ~4–5 gemi', () => {
    const state = createGame(8);
    let spawned = 0, last = 0;
    for (let i = 0; i < 24 * 60; i++) {
      tickTraffic(state, world);
      const ids = state.traffic.map((t) => Number(t.id.split('-')[1]));
      const max = Math.max(0, ...ids);
      if (max > last) {
        spawned++;
        last = max;
      }
    }
    expect(spawned).toBeGreaterThan(60);
    expect(spawned).toBeLessThan(160);
  });
});

describe('vapur yol verir', () => {
  it('güvenlik mesafesindeki gemi için durur ve uzak tarafa kayar', () => {
    const state = createGame(2);
    const t = spawnTraffic(state, world, 'tanker', 1)!;
    const ch = channelOf(world)!;
    t.dist = t.prevDist = ch.south.lengthM * 0.6;
    const pose = trafficPose(world, t)!;
    // Vapur tankerin hemen yanında, ona doğru gidiyor.
    const p: LngLat = [pose.p[0] - 0.003, pose.p[1]];
    const a = avoidance(state, world, p, [1, 0], 300);
    expect(a.factor).toBe(0);
    expect(a.near?.id).toBe(t.id);
    expect(Math.abs(a.sidestep)).toBeGreaterThan(0);
    // Uzaktaki vapur etkilenmez.
    expect(avoidance(state, world, [pose.p[0] - 0.05, pose.p[1]], [1, 0], 300).factor).toBe(1);
    expect(TRAFFIC.kinds.tanker.safetyM).toBeGreaterThan(TRAFFIC.kinds.koster.safetyM);
  });

  it('Boğaz’ı kesen hatta vapurlar trafik yüzünden bekler ama sefer tamamlanır', () => {
    const state = createGame(6);
    expect(state.settings.traffic).toBe(true);
    const b = placeHistoric(state, world, 'besiktas');
    const u = placeHistoric(state, world, 'uskudar');
    const line = createLine(state, world, [b.id, u.id]);
    if (!line.ok) throw new Error(line.message);
    for (let i = 0; i < 2; i++) buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    for (let i = 0; i < 6 * 60; i++) {
      state.weather = { kind: 'acik', from: 0, until: 1e9 };
      if (i % 20 === 0) spawnTraffic(state, world, 'tanker');
      tick(state, world);
    }
    expect(state.today.yieldMinutes ?? 0).toBeGreaterThan(0);
    expect(state.today.tripsDone).toBeGreaterThan(10);
  });
});
