import { describe, expect, it } from 'vitest';
import { LINE } from '../config/balance.ts';
import { isWaterAt } from '../nav/grid.ts';
import { buyShip, createLine, cycleMinutes, removePier, requiredShips, sellShip } from './network.ts';
import { createGame } from './state.ts';
import { berthsInUse, shipPose, tick } from './tick.ts';
import { placeHistoric, testWorld } from './testWorld.ts';

function setup() {
  const world = testWorld();
  const state = createGame(42);
  const a = placeHistoric(state, world, 'eminonu');
  const b = placeHistoric(state, world, 'kadikoy');
  return { world, state, a, b };
}

describe('hat ve sefer', () => {
  it('iskeleler yakalara doğru atanır', () => {
    const { a, b } = setup();
    expect(a.side).toBe('avrupa');
    expect(b.side).toBe('anadolu');
  });

  it('hat kurulur, tur süresi ve gereken gemi makul', () => {
    const { world, state, a, b } = setup();
    const r = createLine(state, world, [a.id, b.id]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cycle = cycleMinutes(world, state, r.value);
    expect(cycle).toBeGreaterThan(25); // ~2 × 10 dk + dönüş
    expect(cycle).toBeLessThan(45);
    r.value.intervalMin = 10;
    expect(requiredShips(world, state, r.value)).toBeGreaterThanOrEqual(3);
  });

  it('tek iskeleli ya da tekrar eden hat reddedilir', () => {
    const { world, state, a } = setup();
    expect(createLine(state, world, [a.id]).ok).toBe(false);
    expect(createLine(state, world, [a.id, a.id]).ok).toBe(false);
  });

  it('yeterli gemiyle seferler kaçmaz, gemiler suda kalır', () => {
    const { world, state, a, b } = setup();
    const line = createLine(state, world, [a.id, b.id]);
    if (!line.ok) throw new Error(line.message);
    const need = requiredShips(world, state, line.value);
    for (let i = 0; i < need; i++) expect(buyShip(state, world, line.value.id, { free: true, atTerminal: true }).ok).toBe(true);
    // İlk turun ısınması: 1 saat sonra saymaya başla.
    for (let i = 0; i < 60; i++) tick(state, world);
    const missedBefore = state.today.tripsMissed;
    const doneBefore = state.today.tripsDone;
    for (let i = 0; i < 180; i++) {
      tick(state, world);
      for (const s of state.ships) {
        if (s.status !== 'sailing' || s.dist < 150) continue;
        const pose = shipPose(state, world, s, 0)!;
        expect(isWaterAt(world.grid, pose.p)).toBe(true);
      }
      for (const p of state.piers) expect(berthsInUse(state, p.id)).toBeLessThanOrEqual(p.berths);
    }
    const trips = state.today.tripsDone - doneBefore;
    const departures = (180 / line.value.intervalMin) * 2;
    expect(trips).toBeGreaterThan(departures * 0.8);
    expect(state.today.tripsMissed - missedBefore).toBeLessThanOrEqual(1);
  });

  it('gemi azsa seferler kaçar', () => {
    const { world, state, a, b } = setup();
    const line = createLine(state, world, [a.id, b.id]);
    if (!line.ok) throw new Error(line.message);
    line.value.intervalMin = 10;
    buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    for (let i = 0; i < 240; i++) tick(state, world);
    expect(state.today.tripsMissed).toBeGreaterThan(10);
  });

  it('3 iskeleli hatta ara iskelede yanaşılır', () => {
    const { world, state, a, b } = setup();
    const c = placeHistoric(state, world, 'uskudar');
    const line = createLine(state, world, [a.id, c.id, b.id]);
    if (!line.ok) throw new Error(line.message);
    buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    let sawDwell = false;
    for (let i = 0; i < 120; i++) {
      tick(state, world);
      if (state.ships.some((s) => s.status === 'dwell' && s.pierId === c.id)) sawDwell = true;
    }
    expect(sawDwell).toBe(true);
    expect(LINE.dwellMin).toBeGreaterThan(0);
  });

  it('tersaneden çıkan gemi hatta ulaşır', () => {
    const { world, state, a, b } = setup();
    const line = createLine(state, world, [a.id, b.id]);
    if (!line.ok) throw new Error(line.message);
    const s = buyShip(state, world, line.value.id, { free: true });
    expect(s.ok && s.value.status).toBe('transit');
    for (let i = 0; i < 60; i++) tick(state, world);
    expect(state.ships[0]!.status).not.toBe('transit');
  });

  it('iskele silinince hatları ve gemileri gider', () => {
    const { world, state, a, b } = setup();
    const line = createLine(state, world, [a.id, b.id]);
    if (!line.ok) throw new Error(line.message);
    buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    expect(removePier(state, world, a.id)).toEqual([line.value.name]);
    expect(state.lines).toHaveLength(0);
    expect(state.ships).toHaveLength(0);
    expect(sellShip(state, line.value.id).ok).toBe(false);
  });
});
