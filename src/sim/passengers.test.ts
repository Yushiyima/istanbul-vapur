import { describe, expect, it } from 'vitest';
import { ECON, SHIP_TYPES, TIME } from '../config/balance.ts';
import { buyShip, createLine } from './network.ts';
import { alightAt, boardAt, hourScore, odTable, periodAt, satisfactionMultiplier } from './passengers.ts';
import { createGame, emptyHour } from './state.ts';
import { placeHistoric, testWorld } from './testWorld.ts';
import { tick } from './tick.ts';

const world = testWorld();
const hasCells = !!world.data.cells;

function starter() {
  const state = createGame(11);
  const e = placeHistoric(state, world, 'eminonu');
  const k = placeHistoric(state, world, 'kadikoy');
  const line = createLine(state, world, [e.id, k.id]);
  if (!line.ok) throw new Error(line.message);
  return { state, e, k, line: line.value };
}

describe('dönemler ve çarpanlar', () => {
  it('zirve, ara ve gece saatleri', () => {
    expect(periodAt(8 * 60)).toBe('peak');
    expect(periodAt(13 * 60)).toBe('offpeak');
    expect(periodAt(18 * 60)).toBe('peak');
    expect(periodAt(2 * 60)).toBe('night');
    expect(periodAt(TIME.minutesPerDay + 8 * 60)).toBe('peak');
  });

  it('memnuniyet talebi artırır', () => {
    expect(satisfactionMultiplier(100)).toBeGreaterThan(satisfactionMultiplier(50));
    expect(satisfactionMultiplier(50)).toBeGreaterThan(satisfactionMultiplier(0));
  });
});

describe.skipIf(!hasCells)('talep tablosu', () => {
  it('Eminönü–Kadıköy: iki yön, zirvede vapur payı yüksek', () => {
    const { state, e, k } = starter();
    const od = odTable(state, world);
    expect(od.pairs).toHaveLength(2);
    const ek = od.byKey.get(`${e.id}>${k.id}`)!;
    expect(ek.base).toBeGreaterThan(0);
    expect(ek.share.peak).toBeGreaterThan(0.5);
    expect(ek.share.peak).toBeGreaterThanOrEqual(ek.share.offpeak);
    expect(ek.share.night).toBe(0); // gece seferi yok
    expect(ek.dir).toBe('toAsia');
  });

  it('gece seferi açılınca gece payı oluşur', () => {
    const { state, e, k, line } = starter();
    line.night = true;
    expect(odTable(state, world).byKey.get(`${k.id}>${e.id}`)!.share.night).toBeGreaterThan(0);
  });

  it('aktarmalı rota: Eminönü → Üsküdar, Kadıköy aktarmalı', () => {
    const { state, e, k } = starter();
    const u = placeHistoric(state, world, 'uskudar');
    const l2 = createLine(state, world, [k.id, u.id]);
    if (!l2.ok) throw new Error(l2.message);
    const pair = odTable(state, world).byKey.get(`${e.id}>${u.id}`)!;
    expect(pair.legs.map((l) => l.to)).toEqual([k.id, u.id]);
  });
});

describe('biniş ve iniş', () => {
  it('kapasite aşılmaz, kalanlar reddedilir, bilet kasaya girer', () => {
    const { state, e, k, line } = starter();
    const ship = buyShip(state, world, line.id, { free: true, atTerminal: true });
    if (!ship.ok) throw new Error(ship.message);
    const cap = SHIP_TYPES.vapur.capacity;
    state.waiting[e.id] = [{ lineId: line.id, alight: k.id, dest: k.id, count: cap + 300, since: state.minute - 10, startedAt: state.minute - 10 }];
    const money = state.money;
    boardAt(state, world, ship.value, line, e);
    const onboard = ship.value.onboard.reduce((s, g) => s + g.count, 0);
    expect(onboard).toBe(cap);
    expect(state.today.denied).toBe(300);
    expect(state.waiting[e.id]![0]!.count).toBe(300);
    expect(state.money - money).toBe(cap * ECON.ticket);
  });

  it('ters yöne giden yolcu binmez', () => {
    const { state, k, line } = starter();
    const ship = buyShip(state, world, line.id, { free: true, atTerminal: true });
    if (!ship.ok) throw new Error(ship.message);
    // Gemi Kadıköy'den Eminönü'ne gidecek (leg 1): Kadıköy'de inecek yolcu bu gemiye binemez.
    ship.value.leg = 1;
    ship.value.pierId = k.id;
    state.waiting[k.id] = [{ lineId: line.id, alight: k.id, dest: k.id, count: 50, since: state.minute, startedAt: state.minute }];
    boardAt(state, world, ship.value, line, k);
    expect(ship.value.onboard).toHaveLength(0);
  });

  it('aktarma noktasında yolcu yeni hatta bekler (indirimli)', () => {
    const { state, k } = starter();
    const u = placeHistoric(state, world, 'uskudar');
    const l2 = createLine(state, world, [k.id, u.id]);
    if (!l2.ok) throw new Error(l2.message);
    const ship = buyShip(state, world, state.lines[0]!.id, { free: true, atTerminal: true });
    if (!ship.ok) throw new Error(ship.message);
    ship.value.onboard = [{ alight: k.id, dest: u.id, count: 40, startedAt: state.minute - 20 }];
    alightAt(state, world, ship.value, k);
    const g = state.waiting[k.id]!.find((x) => x.dest === u.id)!;
    expect(g.lineId).toBe(l2.value.id);
    expect(g.xfer).toBe(true);
    expect(g.count).toBe(40);
  });
});

describe('memnuniyet', () => {
  it('bekleme yok, sefer kaçmıyorsa yüksek; kaçıyorsa düşük', () => {
    const state = createGame(1);
    state.hourAcc = { ...emptyHour(), waitSum: 5 * 1000, waitCount: 1000, boardings: 1000, departures: 6 };
    const good = hourScore(state)!;
    state.hourAcc = { ...emptyHour(), waitSum: 35 * 1000, waitCount: 1000, boardings: 1000, denied: 800, departures: 2, missed: 4 };
    const bad = hourScore(state)!;
    expect(good).toBeGreaterThan(90);
    expect(bad).toBeLessThan(30);
    state.hourAcc = emptyHour();
    expect(hourScore(state)).toBeNull();
  });
});

describe.skipIf(!hasCells)('bir günlük oyun', () => {
  it('başlangıç hattı yolcu taşır, kasa işler, gün devrilir', () => {
    const { state, line } = starter();
    buyShip(state, world, line.id, { free: true, atTerminal: true });
    buyShip(state, world, line.id, { free: true, atTerminal: true });
    for (let i = 0; i < TIME.minutesPerDay; i++) tick(state, world);
    const y = state.yesterday!;
    expect(y).not.toBeNull();
    expect(y.boardings).toBeGreaterThan(5_000);
    expect(y.revenue).toBeGreaterThan(y.costs);
    expect(state.satisfaction).toBeGreaterThan(50);
  });
});
