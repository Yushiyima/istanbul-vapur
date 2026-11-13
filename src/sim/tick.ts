/**
 * Sabit adımlı simülasyon: her çağrı bir oyun dakikası. DOM'a dokunmaz.
 *
 * Gemi döngüsü (sarkaç): terminal → … → diğer terminal → geri.
 *   sailing → (varış) queue → (yanaşma yeri boşsa) dwell | layover → (kalkış) sailing
 * Terminalde (layover) gemi tarifeli kalkış anını bekler: hat oluşturulduğundan beri her
 * `intervalMin` dakikada bir. O anda hazır gemi yoksa sefer kaçar (iptal sayılır).
 */
import { KNOT_M_PER_MIN, LINE, SHIP_TYPES } from '../config/balance.ts';

/** Yanaşmış gemi iskele işaretinin altında kalmasın diye rotada bu kadar ileride çizilir. */
const DOCK_VIEW_OFFSET_M = 70;
/** Seyirde rotanın sağına kayma (çizim). */
const PASSING_OFFSET_M = 35;
import { makeRoute, pointAlong } from '../nav/route.ts';
import { offsetM, type LngLat } from '../geo/geo.ts';
import { canDepart, speedFactor, updateEvents } from './events.ts';
import { alightAt, boardAt, generateDemand, updateEconomyAndSatisfaction } from './passengers.ts';
import { inService } from './state.ts';
import type { GameState, Line, Ship } from './types.ts';
import { legCount, legEnds, legRoute, pierById, type World } from './world.ts';

export function tick(state: GameState, world: World): void {
  state.minute += 1;
  updateEvents(state, world);
  generateDemand(state, world);

  for (const ship of state.ships) ship.prevDist = ship.dist;
  const lines = new Map(state.lines.map((l) => [l.id, l]));
  for (const ship of state.ships) {
    const line = lines.get(ship.lineId);
    if (line) moveShip(state, world, line, ship);
  }
  dockQueuedShips(state, world, lines);
  for (const ship of state.ships) {
    const line = lines.get(ship.lineId);
    if (line && ship.status === 'dwell' && state.minute >= ship.readyAt && canDepart(state, world, line, ship.leg)) {
      depart(state, world, line, ship);
    }
  }
  for (const line of state.lines) runTimetable(state, world, line);

  updateEconomyAndSatisfaction(state, world);
}

function shipSpeed(ship: Ship): number {
  return SHIP_TYPES[ship.type].speedKn * KNOT_M_PER_MIN;
}

function moveShip(state: GameState, world: World, line: Line, ship: Ship): void {
  if (ship.status === 'transit' && ship.transit) {
    const route = makeRoute(ship.transit);
    ship.dist += shipSpeed(ship) * speedFactor(state, world, route, ship.dist);
    if (ship.dist >= route.lengthM) {
      const n = line.pierIds.length;
      const leg = ship.transitLeg ?? 0;
      ship.leg = leg;
      ship.pierId = line.pierIds[leg === 0 ? 0 : n - 1]!;
      ship.status = 'queue';
      ship.arrivedAt = state.minute;
      ship.dist = ship.prevDist = 0;
      delete ship.transit;
      delete ship.transitLeg;
    }
    return;
  }
  if (ship.status !== 'sailing') return;
  const route = legRoute(world, state, line, ship.leg);
  if (!route) return;
  ship.dist += shipSpeed(ship) * speedFactor(state, world, route, ship.dist);
  if (ship.dist >= route.lengthM) {
    ship.dist = route.lengthM;
    const { to } = legEnds(line, ship.leg);
    ship.pierId = line.pierIds[to]!;
    ship.leg = (ship.leg + 1) % legCount(line);
    ship.status = 'queue';
    ship.arrivedAt = state.minute;
    const ls = state.lineStats[line.id];
    if (ls) ls.trips += 1;
    state.today.tripsDone += 1;
  }
}

export function berthsInUse(state: GameState, pierId: string): number {
  let n = 0;
  for (const s of state.ships) if (s.pierId === pierId && (s.status === 'dwell' || s.status === 'layover')) n++;
  return n;
}

function dockQueuedShips(state: GameState, world: World, lines: Map<string, Line>): void {
  const queued = state.ships.filter((s) => s.status === 'queue').sort((a, b) => a.arrivedAt - b.arrivedAt);
  for (const ship of queued) {
    const pier = ship.pierId ? pierById(state, ship.pierId) : undefined;
    const line = lines.get(ship.lineId);
    if (!pier || !line) continue;
    if (berthsInUse(state, pier.id) >= pier.berths) continue;
    const { from } = legEnds(line, ship.leg);
    const terminal = from === 0 || from === line.pierIds.length - 1;
    ship.status = terminal ? 'layover' : 'dwell';
    ship.readyAt = state.minute + (terminal ? LINE.turnaroundMin : LINE.dwellMin);
    ship.dist = ship.prevDist = 0;
    alightAt(state, world, ship, pier);
  }
}

function depart(state: GameState, world: World, line: Line, ship: Ship): void {
  const pier = ship.pierId ? pierById(state, ship.pierId) : undefined;
  if (pier) boardAt(state, world, ship, line, pier);
  const route = legRoute(world, state, line, ship.leg);
  const t = SHIP_TYPES[ship.type];
  if (route) {
    const fuel = (route.lengthM / 1000) * t.fuelPerKm;
    state.money -= fuel;
    state.today.costs += fuel;
  }
  ship.status = 'sailing';
  ship.pierId = null;
  ship.dist = ship.prevDist = 0;
}

function runTimetable(state: GameState, world: World, line: Line): void {
  if (!inService(state.minute, line.night)) return;
  if ((state.minute - line.createdAt) % line.intervalMin !== 0) return;
  const n = line.pierIds.length;
  const ships = state.ships.filter((s) => s.lineId === line.id);
  if (!ships.length) return;
  for (const [idx, leg] of [[0, 0], [n - 1, n - 1]] as const) {
    const pierId = line.pierIds[idx]!;
    const ready = ships
      .filter((s) => s.status === 'layover' && s.pierId === pierId && s.leg === leg && s.readyAt <= state.minute)
      .sort((a, b) => a.arrivedAt - b.arrivedAt)[0];
    if (ready && canDepart(state, world, line, leg)) {
      depart(state, world, line, ready);
    } else {
      state.today.tripsMissed += 1;
      const ls = state.lineStats[line.id];
      if (ls) ls.missed += 1;
    }
  }
}

// ---------------------------------------------------------------- çizim yardımcıları

export interface ShipPose {
  p: LngLat;
  /** Kuzeyden saat yönünde derece. */
  bearing: number;
  moving: boolean;
}

/** Geminin konumu; `frac` (0..1) son tick ile bir sonraki arasında ara değer. */
export function shipPose(state: GameState, world: World, ship: Ship, frac: number): ShipPose | null {
  const line = state.lines.find((l) => l.id === ship.lineId);
  if (!line) return null;
  const toBearing = (dir: [number, number]) => (Math.atan2(dir[0], dir[1]) * 180) / Math.PI;
  if (ship.status === 'transit' && ship.transit) {
    const route = makeRoute(ship.transit);
    const d = ship.prevDist + (ship.dist - ship.prevDist) * frac;
    const { p, dir } = pointAlong(route, d);
    return { p, bearing: toBearing(dir), moving: true };
  }
  if (ship.status === 'sailing') {
    const route = legRoute(world, state, line, ship.leg);
    if (!route) return null;
    const d = ship.prevDist + (ship.dist - ship.prevDist) * frac;
    const { p, dir } = pointAlong(route, d);
    // Sağdan seyir: karşılıklı geçen gemiler üst üste binmesin (uçlarda sıfıra iner).
    const k = Math.min(1, d / 200, (route.lengthM - d) / 200);
    return { p: offsetM(p, dir[1] * PASSING_OFFSET_M * k, -dir[0] * PASSING_OFFSET_M * k), bearing: toBearing(dir), moving: true };
  }
  // Yanaşmış ya da sırada: bir sonraki bacağın başında, iskele işaretinin biraz açığında.
  const route = legRoute(world, state, line, ship.leg);
  if (!route) return null;
  const { p, dir } = pointAlong(route, ship.status === 'queue' ? DOCK_VIEW_OFFSET_M * 3 : DOCK_VIEW_OFFSET_M);
  return { p, bearing: toBearing(dir), moving: false };
}
