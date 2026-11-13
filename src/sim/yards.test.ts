import { describe, expect, it } from 'vitest';
import { MAINT, TERSANE, TIME } from '../config/balance.ts';
import { buyShip, createLine } from './network.ts';
import { createGame } from './state.ts';
import { placeHistoric, testWorld } from './testWorld.ts';
import { tick } from './tick.ts';
import { buildYard, conditionSpeedFactor, ensureDefaultYard, fleetCapacity, previewYard, shipsAtYard, wear } from './yards.ts';

const world = testWorld();

function calm(state: ReturnType<typeof createGame>): void {
  state.weather = { kind: 'acik', from: 0, until: 1e9 };
  state.tanker = null;
  state.settings.traffic = false;
}

function starter() {
  const state = createGame(21);
  const e = placeHistoric(state, world, 'eminonu');
  const k = placeHistoric(state, world, 'kadikoy');
  const line = createLine(state, world, [e.id, k.id]);
  if (!line.ok) throw new Error(line.message);
  return { state, line: line.value };
}

describe('tersaneler', () => {
  it('varsayılan tersane filo kapasitesini verir; yeni tersane ekler', () => {
    const state = createGame(1);
    ensureDefaultYard(state, world);
    expect(fleetCapacity(state)).toBe(TERSANE.capacity);
    // Kuruçeşme kıyısı: iskelelerden uzak, yasak bölge değil.
    const click: [number, number] = [29.0375, 41.0597];
    expect(previewYard(state, world, click).ok).toBe(true);
    const r = buildYard(state, world, click);
    expect(r.ok).toBe(true);
    expect(fleetCapacity(state)).toBe(TERSANE.capacity + TERSANE.buildCapacity);
    expect(state.money).toBe(createGame(1).money - TERSANE.buildCost);
    // Aynı yere ikinci tersane olmaz.
    expect(previewYard(state, world, click).ok).toBe(false);
  });

  it('kapasite doluysa gemi alınamaz', () => {
    const { state, line } = starter();
    for (let i = 0; i < TERSANE.capacity; i++) expect(buyShip(state, world, line.id, { free: true }).ok).toBe(true);
    expect(buyShip(state, world, line.id, { free: true }).ok).toBe(false);
  });
});

describe('bakım', () => {
  it('seyir durumu düşürür, düşük durum yavaşlatır', () => {
    const { state, line } = starter();
    const s = buyShip(state, world, line.id, { free: true, atTerminal: true });
    if (!s.ok) throw new Error(s.message);
    wear(s.value, 400_000);
    expect(s.value.condition).toBeCloseTo(100 - 400 * MAINT.wearPerKm.vapur, 5);
    expect(s.value.total.km).toBeCloseTo(400);
    s.value.condition = 0;
    expect(conditionSpeedFactor(s.value)).toBeCloseTo(MAINT.minSpeedFactor);
  });

  it('eşik altındaki gemi tersaneye gider, bakılır ve hatta döner', () => {
    const { state, line } = starter();
    state.settings.maintThreshold = 50;
    for (let i = 0; i < 3; i++) buyShip(state, world, line.id, { free: true, atTerminal: true });
    const ship = state.ships[0]!;
    ship.condition = 40;
    const money = state.money;
    let sawYard = false, sawMaint = false;
    for (let i = 0; i < MAINT.durationMin + 400; i++) {
      calm(state);
      tick(state, world);
      if (ship.status === 'toYard') sawYard = true;
      if (ship.status === 'maintenance' && ship.readyAt > 0) sawMaint = true;
    }
    expect(sawYard).toBe(true);
    expect(sawMaint).toBe(true);
    expect(ship.condition).toBeGreaterThan(90);
    expect(['transit', 'sailing', 'queue', 'dwell', 'layover']).toContain(ship.status);
    expect(state.money).toBeLessThan(money + state.today.revenue + 1); // bakım ücreti düştü
    expect(shipsAtYard(state, state.yards[0]!.id).active).toHaveLength(0);
  });

  it('durumu sıfır olan gemi er geç arızalanır, yolcular iskelede kalır', () => {
    const { state, line } = starter();
    state.settings.maintThreshold = 0;
    buyShip(state, world, line.id, { free: true, atTerminal: true });
    const ship = state.ships[0]!;
    let broke = false;
    for (let i = 0; i < TIME.minutesPerDay && !broke; i++) {
      ship.condition = 0;
      calm(state);
      tick(state, world);
      if (ship.broken) broke = true;
    }
    expect(broke).toBe(true);
    expect(ship.status).toBe('toYard');
    expect(ship.onboard).toHaveLength(0);
    expect(state.notices.some((n) => n.text.includes('arızalandı'))).toBe(true);
  });

  it('gemi sayaçları biniş ve seferle artar', () => {
    const { state, line } = starter();
    for (let i = 0; i < 3; i++) buyShip(state, world, line.id, { free: true, atTerminal: true });
    for (let i = 0; i < 240; i++) {
      calm(state);
      tick(state, world);
    }
    const s = state.ships[0]!;
    expect(s.total.trips).toBeGreaterThan(3);
    expect(s.total.km).toBeGreaterThan(10);
    if (world.data.cells) expect(s.total.boardings).toBeGreaterThan(0);
    expect(s.today.trips).toBe(s.total.trips);
  });
});
