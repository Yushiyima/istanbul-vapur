/**
 * Ağ işlemleri: iskele, hat ve gemi ekleme/silme. Saf mantık; hata durumunda mesaj döner.
 */
import { ECON, KNOT_M_PER_MIN, LINE, PIER, SHIP_TYPES, TERSANE } from '../config/balance.ts';
import { haversineM, type LngLat } from '../geo/geo.ts';
import { landComponentAt } from '../nav/grid.ts';
import { routeTimeFactor } from './events.ts';
import { catchmentOf, computeCatchment } from './catchment.ts';
import { ensureDefaultYard, fleetCapacity, nearestYard, newShipFields, pickTerminalLeg, returnToLine, shipLocation } from './yards.ts';
import { nextId } from './state.ts';
import type { GameState, Line, Pier, Ship, ShipTypeId } from './types.ts';
import { legCount, legEnds, legRoute, pierById, sideOfComp, type World } from './world.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

export const fmtMoney = (n: number): string => `${Math.round(n).toLocaleString('tr-TR')} ₺`;

// ---------------------------------------------------------------- iskele

export function pierCost(world: World, coast: LngLat, historicId?: string): number {
  const comp = landComponentAt(world.grid, coast);
  const pop = computeCatchment(world, coast, comp).pop;
  const raw = Math.min(ECON.pierCostMax, ECON.pierBaseCost + pop * ECON.pierCostPerResident);
  return Math.round((historicId ? raw * (1 - ECON.historicDiscount) : raw) / 1000) * 1000;
}

export function addPier(
  state: GameState,
  world: World,
  data: { name: string; coast: LngLat; dock: LngLat; historicId?: string },
  opts: { free?: boolean } = {},
): Result<Pier> {
  const cost = opts.free ? 0 : pierCost(world, data.coast, data.historicId);
  if (cost > state.money) return fail(`Yetersiz bütçe: iskele ${fmtMoney(cost)}.`);
  const comp = landComponentAt(world.grid, data.coast);
  const pier: Pier = {
    id: nextId(state, 'pier'),
    name: data.name,
    coast: data.coast,
    dock: data.dock,
    ...(data.historicId ? { historicId: data.historicId } : {}),
    berths: PIER.initialBerths,
    ...(data.historicId && world.data.historic.find((h) => h.id === data.historicId)?.ramp ? { ramp: true } : {}),
    side: sideOfComp(world, comp),
    comp,
    builtAt: state.minute,
  };
  state.piers.push(pier);
  state.waiting[pier.id] = [];
  state.money -= cost;
  state.today.costs += cost;
  catchmentOf(world, pier);
  return { ok: true, value: pier };
}

/** İskeleyi ve onu kullanan hatları siler. Silinen hat adlarını döner. */
export function removePier(state: GameState, world: World, pierId: string): string[] {
  const removedLines = state.lines.filter((l) => l.pierIds.includes(pierId));
  for (const l of removedLines) deleteLine(state, l.id);
  const pier = pierById(state, pierId);
  if (pier) {
    state.money += Math.round(pierCost(world, pier.coast, pier.historicId) * ECON.pierRefundRatio);
  }
  state.piers = state.piers.filter((p) => p.id !== pierId);
  delete state.waiting[pierId];
  for (const groups of Object.values(state.waiting)) {
    for (let i = groups.length - 1; i >= 0; i--) if (groups[i]!.dest === pierId || groups[i]!.alight === pierId) groups.splice(i, 1);
  }
  world.routes.forget(pierId);
  world.catchments.delete(pierId);
  return removedLines.map((l) => l.name);
}

export function buildRamp(state: GameState, pierId: string): Result<true> {
  const p = pierById(state, pierId);
  if (!p) return fail('İskele yok.');
  if (p.ramp) return fail('Bu iskelede zaten araç rampası var.');
  if (state.money < ECON.rampCost) return fail(`Yetersiz bütçe: ${fmtMoney(ECON.rampCost)}.`);
  state.money -= ECON.rampCost;
  state.today.costs += ECON.rampCost;
  p.ramp = true;
  return { ok: true, value: true };
}

export function upgradeBerths(state: GameState, pierId: string): Result<number> {
  const p = pierById(state, pierId);
  if (!p) return fail('İskele yok.');
  if (p.berths >= ECON.maxBerths) return fail(`En fazla ${ECON.maxBerths} yanaşma yeri.`);
  if (state.money < ECON.berthUpgradeCost) return fail(`Yetersiz bütçe: ${fmtMoney(ECON.berthUpgradeCost)}.`);
  state.money -= ECON.berthUpgradeCost;
  state.today.costs += ECON.berthUpgradeCost;
  p.berths += 1;
  return { ok: true, value: p.berths };
}

// ---------------------------------------------------------------- hat

export function createLine(state: GameState, world: World, pierIds: string[], shipType: ShipTypeId = 'vapur'): Result<Line> {
  if (pierIds.length < 2) return fail('Hat için en az iki iskele seç.');
  if (new Set(pierIds).size !== pierIds.length) return fail('Bir hatta aynı iskele iki kez olamaz.');
  const piers = pierIds.map((id) => pierById(state, id));
  if (piers.some((p) => !p)) return fail('Hattaki bir iskele bulunamadı.');
  const line: Line = {
    id: nextId(state, 'line'),
    name: `${piers[0]!.name} – ${piers[piers.length - 1]!.name}`,
    color: LINE.colors[state.lines.length % LINE.colors.length]!,
    pierIds: [...pierIds],
    intervalMin: LINE.defaultIntervalMin,
    shipType,
    night: false,
    createdAt: state.minute,
  };
  for (let leg = 0; leg < legCount(line) / 2; leg++) {
    if (!legRoute(world, state, line, leg)) {
      const { from, to } = legEnds(line, leg);
      return fail(`${piers[from]!.name} → ${piers[to]!.name} arasında su yolu bulunamadı.`);
    }
  }
  state.lines.push(line);
  state.lineStats[line.id] = { boardings: 0, revenue: 0, missed: 0, trips: 0, load: 0 };
  return { ok: true, value: line };
}

/**
 * Hattın iskelelerini değiştirir. Hattaki gemiler bulundukları yerden yeni terminallere gider;
 * seyirdeki gemilerin yolcuları ve hattın bekleyen yolcuları düşer (yeniden üretilir).
 */
export function updateLinePiers(state: GameState, world: World, lineId: string, pierIds: string[]): Result<Line> {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return fail('Hat yok.');
  if (pierIds.length < 2) return fail('Hat için en az iki iskele seç.');
  if (new Set(pierIds).size !== pierIds.length) return fail('Bir hatta aynı iskele iki kez olamaz.');
  const piers = pierIds.map((id) => pierById(state, id));
  if (piers.some((p) => !p)) return fail('Hattaki bir iskele bulunamadı.');
  if (line.shipType === 'arabali' && piers.some((p) => !p!.ramp)) return fail('Arabalı vapur hattında tüm iskelelerde araç rampası olmalı.');
  const trial: Line = { ...line, pierIds: [...pierIds] };
  for (let leg = 0; leg < legCount(trial) / 2; leg++) {
    if (!legRoute(world, state, trial, leg)) {
      const { from, to } = legEnds(trial, leg);
      return fail(`${piers[from]!.name} → ${piers[to]!.name} arasında su yolu bulunamadı.`);
    }
  }
  // Gemilerin konumu eski hatta göre hesaplanmalı: önce konumları al, sonra hattı değiştir.
  const ships = shipsOnLine(state, lineId).filter((s) => s.status !== 'toYard' && s.status !== 'maintenance');
  const locations = ships.map((s) => shipLocation(state, world, s));
  line.pierIds = [...pierIds];
  line.name = `${piers[0]!.name} – ${piers[piers.length - 1]!.name}`;
  for (const groups of Object.values(state.waiting)) {
    for (let i = groups.length - 1; i >= 0; i--) if (groups[i]!.lineId === lineId) groups.splice(i, 1);
  }
  const n = pierIds.length;
  ships.forEach((ship, i) => {
    const lost = ship.onboard.reduce((s, g) => s + g.count, 0);
    state.today.gaveUp += lost;
    ship.onboard = [];
    const leg = pickTerminalLeg(state, line, ship.id);
    const terminal = pierById(state, pierIds[leg === 0 ? 0 : n - 1]!)!;
    const from = locations[i] ?? terminal.dock;
    const route = world.routes.get(`at:${from[0].toFixed(5)},${from[1].toFixed(5)}`, from, terminal.id, terminal.dock);
    ship.status = 'transit';
    ship.transit = route ? route.points : [from, terminal.dock];
    ship.transitLeg = leg;
    ship.dist = ship.prevDist = 0;
    ship.pierId = null;
    // Geçici olarak "transit" sayılsın ki sonraki gemi diğer terminale dağılsın.
  });
  return { ok: true, value: line };
}

export function deleteLine(state: GameState, lineId: string): void {
  const ships = state.ships.filter((s) => s.lineId === lineId);
  for (const s of ships) state.money += Math.round(SHIP_TYPES[s.type].price * TERSANE.resaleRatio);
  state.ships = state.ships.filter((s) => s.lineId !== lineId);
  state.lines = state.lines.filter((l) => l.id !== lineId);
  for (const groups of Object.values(state.waiting)) {
    for (let i = groups.length - 1; i >= 0; i--) if (groups[i]!.lineId === lineId) groups.splice(i, 1);
  }
  delete state.lineStats[lineId];
}

export function setInterval_(state: GameState, lineId: string, minutes: number): void {
  const l = state.lines.find((x) => x.id === lineId);
  if (l) l.intervalMin = Math.max(1, Math.round(minutes));
}

export function setNight(state: GameState, lineId: string, night: boolean): void {
  const l = state.lines.find((x) => x.id === lineId);
  if (l) l.night = night;
}

/** Bir tam tur (gidiş-dönüş) süresi, dakika. Boğaz akıntısı dahil; her bacak tam dakikaya yuvarlanır. */
export function cycleMinutes(world: World, state: GameState, line: Line, shipType: ShipTypeId = line.shipType): number {
  const speed = SHIP_TYPES[shipType].speedKn * KNOT_M_PER_MIN;
  let sail = 0;
  for (let leg = 0; leg < legCount(line); leg++) {
    const r = legRoute(world, state, line, leg);
    if (r) sail += Math.ceil((r.lengthM / speed) * routeTimeFactor(world, r));
  }
  const intermediate = Math.max(0, line.pierIds.length - 2) * 2;
  return sail + intermediate * LINE.dwellMin + 2 * LINE.turnaroundMin;
}

/** Gereken gemi: tur süresi + tarifeye denk gelme payı. */
export function requiredShips(world: World, state: GameState, line: Line): number {
  return Math.max(1, Math.ceil((cycleMinutes(world, state, line) + LINE.scheduleSlackMin) / line.intervalMin));
}

export function shipsOnLine(state: GameState, lineId: string): Ship[] {
  return state.ships.filter((s) => s.lineId === lineId);
}

// ---------------------------------------------------------------- gemi

export function buyShip(state: GameState, world: World, lineId: string, opts: { free?: boolean; atTerminal?: boolean } = {}): Result<Ship> {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return fail('Hat yok.');
  ensureDefaultYard(state, world);
  const cap = fleetCapacity(state);
  if (state.ships.length >= cap) return fail(`Tersane kapasitesi dolu (${cap} gemi). Tersaneyi büyüt ya da yeni tersane kur.`);
  const price = opts.free ? 0 : SHIP_TYPES[line.shipType].price;
  if (price > state.money) return fail(`Yetersiz bütçe: ${SHIP_TYPES[line.shipType].name} ${fmtMoney(price)}.`);

  // Gemiler iki terminale dengeli dağılsın.
  const n = line.pierIds.length;
  const startLeg = pickTerminalLeg(state, line);
  const terminalId = line.pierIds[startLeg === 0 ? 0 : n - 1]!;
  const terminal = pierById(state, terminalId)!;

  const ship: Ship = {
    id: nextId(state, 'ship'),
    type: line.shipType,
    lineId,
    status: 'layover',
    leg: startLeg,
    dist: 0,
    prevDist: 0,
    pierId: terminalId,
    readyAt: state.minute,
    arrivedAt: state.minute,
    onboard: [],
    ...newShipFields(state),
  };
  if (!opts.atTerminal) {
    // Yeni gemi terminale en yakın tersaneden çıkar.
    const yard = nearestYard(state, terminal.dock);
    if (yard) {
      state.ships.push(ship);
      returnToLine(state, world, ship, yard);
      state.ships.pop();
      ship.transitLeg = startLeg;
    }
  }
  state.ships.push(ship);
  state.money -= price;
  state.today.costs += price;
  return { ok: true, value: ship };
}

/** Hattan bir gemi satar (önce boş/terminaldeki gemiyi). */
export function sellShip(state: GameState, lineId: string): Result<Ship> {
  const ships = shipsOnLine(state, lineId);
  if (!ships.length) return fail('Bu hatta gemi yok.');
  const pick = ships.find((s) => s.status === 'layover' && s.onboard.length === 0) ?? ships.find((s) => s.status === 'transit') ?? ships[ships.length - 1]!;
  state.ships = state.ships.filter((s) => s.id !== pick.id);
  state.money += Math.round(SHIP_TYPES[pick.type].price * TERSANE.resaleRatio);
  return { ok: true, value: pick };
}

/** Hattın gemi tipini değiştirir: mevcut gemiler satılıp aynı sayıda yeni tip alınır. */
export function changeShipType(state: GameState, world: World, lineId: string, type: ShipTypeId): Result<number> {
  const line = state.lines.find((l) => l.id === lineId);
  if (!line) return fail('Hat yok.');
  if (line.shipType === type) return { ok: true, value: 0 };
  if (type === 'arabali') {
    const noRamp = line.pierIds.map((id) => pierById(state, id)).filter((p) => p && !p.ramp);
    if (noRamp.length) return fail(`Arabalı vapur için tüm iskelelerde araç rampası gerekli: ${noRamp.map((p) => p!.name).join(', ')}.`);
  }
  const count = shipsOnLine(state, lineId).length;
  const refund = shipsOnLine(state, lineId).reduce((s, sh) => s + SHIP_TYPES[sh.type].price * TERSANE.resaleRatio, 0);
  const cost = SHIP_TYPES[type].price * count;
  if (cost > state.money + refund) return fail(`Yetersiz bütçe: ${count} × ${SHIP_TYPES[type].name} = ${fmtMoney(cost)}.`);
  while (shipsOnLine(state, lineId).length) sellShip(state, lineId);
  line.shipType = type;
  for (let i = 0; i < count; i++) buyShip(state, world, lineId);
  return { ok: true, value: count };
}

/** Kuş uçuşu mesafe, iskele çifti (talep modeli için). */
export function pierDistanceM(a: Pier, b: Pier): number {
  return haversineM(a.coast, b.coast);
}
