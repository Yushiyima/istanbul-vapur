import { describe, expect, it } from 'vitest';
import { ECON, SHIP_TYPES } from '../config/balance.ts';
import { buildRamp, buyShip, changeShipType, createLine, updateLinePiers } from './network.ts';
import { boardAt, vehicleLoad } from './passengers.ts';
import { createGame } from './state.ts';
import { placeHistoric, testWorld } from './testWorld.ts';
import { tick } from './tick.ts';

const world = testWorld();

describe('reddedilen yolcu', () => {
  it('aynı grup iki kalkışta da sığmazsa bir kez sayılır', () => {
    const state = createGame(3);
    const e = placeHistoric(state, world, 'eminonu'), k = placeHistoric(state, world, 'kadikoy');
    const line = createLine(state, world, [e.id, k.id]);
    if (!line.ok) throw new Error(line.message);
    const ship = buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    if (!ship.ok) throw new Error(ship.message);
    const cap = SHIP_TYPES.vapur.capacity;
    state.waiting[e.id] = [{ lineId: line.value.id, alight: k.id, dest: k.id, count: cap * 3, since: state.minute, startedAt: state.minute }];
    boardAt(state, world, ship.value, line.value, e);
    expect(state.today.denied).toBe(cap * 2);
    ship.value.onboard = [];
    boardAt(state, world, ship.value, line.value, e);
    expect(state.today.denied).toBe(cap * 2); // kalan grup zaten sayılmıştı
  });
});

describe('arabalı vapur', () => {
  it('rampası olmayan iskelede çalışmaz; rampa kurulunca çalışır ve araç geliri getirir', () => {
    const state = createGame(5);
    const k = placeHistoric(state, world, 'kabatas'), u = placeHistoric(state, world, 'uskudar');
    const b = placeHistoric(state, world, 'besiktas');
    expect(k.ramp).toBe(true);
    expect(b.ramp).toBeUndefined();
    const ku = createLine(state, world, [k.id, u.id]);
    const bu = createLine(state, world, [b.id, u.id]);
    if (!ku.ok || !bu.ok) throw new Error('hat');
    expect(changeShipType(state, world, bu.value.id, 'arabali').ok).toBe(false);
    expect(buildRamp(state, b.id).ok).toBe(true);
    expect(changeShipType(state, world, bu.value.id, 'arabali').ok).toBe(true);
    expect(changeShipType(state, world, ku.value.id, 'arabali').ok).toBe(true);
    const ship = buyShip(state, world, ku.value.id, { free: true, atTerminal: true });
    if (!ship.ok) throw new Error(ship.message);
    expect(vehicleLoad(state, ship.value, ku.value)).toBeGreaterThan(0);
    const before = state.today.revenue;
    boardAt(state, world, ship.value, ku.value, k);
    expect(state.today.revenue - before).toBeGreaterThanOrEqual(vehicleLoad(state, ship.value, ku.value) * ECON.vehicleTicket);
    expect(state.today.vehicles).toBeGreaterThan(0);
  });
});

describe('hat düzenleme', () => {
  it('iskele eklenip çıkarılır, gemiler yeni terminallere gider ve sefer sürer', () => {
    const state = createGame(7);
    state.settings.traffic = false;
    const e = placeHistoric(state, world, 'eminonu'), k = placeHistoric(state, world, 'kadikoy'), u = placeHistoric(state, world, 'uskudar');
    const line = createLine(state, world, [e.id, k.id]);
    if (!line.ok) throw new Error(line.message);
    for (let i = 0; i < 3; i++) buyShip(state, world, line.value.id, { free: true, atTerminal: true });
    for (let i = 0; i < 90; i++) tick(state, world);
    const r = updateLinePiers(state, world, line.value.id, [e.id, u.id, k.id]);
    expect(r.ok).toBe(true);
    expect(state.lines[0]!.pierIds).toEqual([e.id, u.id, k.id]);
    expect(state.ships.every((s) => s.status === 'transit' || s.status === 'toYard' || s.status === 'maintenance')).toBe(true);
    const done = state.today.tripsDone;
    for (let i = 0; i < 180; i++) tick(state, world);
    expect(state.today.tripsDone - done).toBeGreaterThan(5);
    expect(state.ships.some((s) => s.status === 'dwell' && s.pierId === u.id) || state.today.tripsDone > done).toBe(true);
    expect(updateLinePiers(state, world, line.value.id, [e.id]).ok).toBe(false);
  });
});
