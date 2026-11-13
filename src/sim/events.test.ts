import { describe, expect, it } from 'vitest';
import { EVENTS, GOALS, TIME } from '../config/balance.ts';
import { makeRoute } from '../nav/route.ts';
import { canDepart, crossesBosphorus, currentWeather, speedFactor } from './events.ts';
import { checkGoals, goalProgress } from './goals.ts';
import { buyShip, createLine } from './network.ts';
import { createGame } from './state.ts';
import { placeHistoric, testWorld } from './testWorld.ts';
import { tick } from './tick.ts';

const world = testWorld();

function net() {
  const state = createGame(5);
  const p = (id: string) => placeHistoric(state, world, id);
  const e = p('eminonu'), k = p('kadikoy'), b = p('besiktas'), u = p('uskudar'), ada = p('buyukada');
  const ek = createLine(state, world, [e.id, k.id]);
  const bu = createLine(state, world, [b.id, u.id]);
  const ka = createLine(state, world, [k.id, ada.id]);
  if (!ek.ok || !bu.ok || !ka.ok) throw new Error('hat kurulamadı');
  return { state, ek: ek.value, bu: bu.value, ka: ka.value };
}

describe('hava ve olaylar', () => {
  it('lodosta Adalar hattı kalkamaz, Boğaz geçişi kalkar', () => {
    const { state, bu, ka } = net();
    state.weather = { kind: 'lodos', from: state.minute - 10, until: state.minute + 120 };
    expect(currentWeather(state)).toBe('lodos');
    expect(canDepart(state, world, ka, 0)).toBe(false);
    expect(canDepart(state, world, bu, 0)).toBe(true);
    state.weather.until = state.minute;
    expect(currentWeather(state)).toBe('acik');
    expect(canDepart(state, world, ka, 0)).toBe(true);
  });

  it('Boğaz’ı enine kesen bacak tanınır; eski tanker olayı kalkışı engellemez', () => {
    const { state, bu, ka } = net();
    expect(crossesBosphorus(state, world, bu, 0)).toBe(true);
    expect(crossesBosphorus(state, world, ka, 0)).toBe(false);
    state.tanker = { until: state.minute + 20 };
    expect(canDepart(state, world, bu, 0)).toBe(true);
  });

  it('akıntı: Boğaz’da güneye giden hızlı, kuzeye giden yavaş; sis yavaşlatır', () => {
    const state = createGame(1);
    const south = makeRoute([[29.05, 41.09], [29.04, 41.06]]);
    const north = makeRoute([[29.04, 41.06], [29.05, 41.09]]);
    expect(speedFactor(state, world, south, 100)).toBeGreaterThan(1);
    expect(speedFactor(state, world, north, 100)).toBeLessThan(1);
    const marmara = makeRoute([[29.05, 40.93], [29.06, 40.9]]);
    expect(speedFactor(state, world, marmara, 100)).toBe(1);
    state.weather = { kind: 'sis', from: 0, until: state.minute + 100 };
    expect(speedFactor(state, world, marmara, 100)).toBeCloseTo(EVENTS.fogSpeedFactor);
  });

  it('günlük hava planlanır ve bir ayda en az bir olay olur', () => {
    const state = createGame(3);
    const kinds = new Set<string>();
    for (let d = 0; d < 6; d++) {
      for (let m = 0; m < TIME.minutesPerDay; m++) {
        tick(state, world);
        kinds.add(currentWeather(state));
      }
    }
    expect(state.weather.until).toBeGreaterThan(0);
    expect(kinds.size).toBeGreaterThan(1);
  });
});

describe('hedefler', () => {
  it('iki yaka ve Adalar hedefleri ödül verir, bir kez', () => {
    const { state, ek, ka } = net();
    buyShip(state, world, ek.id, { free: true, atTerminal: true });
    buyShip(state, world, ka.id, { free: true, atTerminal: true });
    const prog = goalProgress(state, world);
    expect(prog.connectSides.done).toBe(true);
    expect(prog.adalar.done).toBe(true);
    const money = state.money;
    const done = checkGoals(state, world);
    expect(done).toContain('connectSides');
    expect(done).toContain('adalar');
    expect(state.money - money).toBe(done.reduce((s, id) => s + GOALS[id].reward, 0));
    expect(checkGoals(state, world)).toHaveLength(0);
    expect(state.notices.length).toBe(done.length);
  });

  it('Boğaz’ı Sarıyer’e bağlama aktarmalı ağı sayar', () => {
    const state = createGame(9);
    const p = (id: string) => placeHistoric(state, world, id);
    const b = p('besiktas'), em = p('emirgan'), s = p('sariyer');
    createLine(state, world, [b.id, em.id]);
    expect(goalProgress(state, world).sariyer.done).toBe(false);
    createLine(state, world, [em.id, s.id]);
    expect(goalProgress(state, world).sariyer.done).toBe(true);
  });
});

describe('kayıt ve determinizm', () => {
  it('JSON’a çevrilip geri yüklenen oyun aynı şekilde devam eder', () => {
    const { state, ek, bu } = net();
    buyShip(state, world, ek.id, { free: true, atTerminal: true });
    buyShip(state, world, bu.id, { free: true, atTerminal: true });
    for (let i = 0; i < 400; i++) tick(state, world);
    const copy = JSON.parse(JSON.stringify(state));
    for (let i = 0; i < 400; i++) {
      tick(state, world);
      tick(copy, world);
    }
    expect(copy.money).toBeCloseTo(state.money, 6);
    expect(copy.today).toEqual(state.today);
    expect(copy.rng).toBe(state.rng);
    expect(copy.ships.map((s: { dist: number }) => s.dist)).toEqual(state.ships.map((s) => s.dist));
  });
});
