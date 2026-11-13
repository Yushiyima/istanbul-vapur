/**
 * Tersaneler ve bakım: filo kapasitesi, yeni gemi çıkışı, bakım kuyruğu, arıza.
 *
 * Gemi döngüsüne eklenen durumlar:
 *   (yanaşmışken bakım gerekirse)  → toYard  → maintenance (kuyruk: readyAt = 0)
 *   maintenance (readyAt geçti)    → transit (tersaneden hattın bir terminaline)
 */
import { MAINT, SHIP_TYPES, TERSANE } from '../config/balance.ts';
import { haversineM, type LngLat } from '../geo/geo.ts';
import { pointAlong } from '../nav/route.ts';
import { pushFeed } from './feed.ts';
import { evaluatePlacement, pickPierName, type PlacementResult } from './piers.ts';
import { nextId, random } from './state.ts';
import type { GameState, Line, Ship, ShipCounters, Yard } from './types.ts';
import { legEnds, legRoute, pierById, type World } from './world.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const money = (n: number) => `${Math.round(n).toLocaleString('tr-TR')} ₺`;

export function emptyCounters(): ShipCounters {
  return { trips: 0, boardings: 0, revenue: 0, km: 0, loadSum: 0, loadN: 0 };
}

/** Kayıtta tersane yoksa (eski kayıt ya da yeni oyun) Haliç Tersanesi'ni kurar. */
export function ensureDefaultYard(state: GameState, world: World, capacity: number = TERSANE.capacity): Yard {
  if (state.yards.length) return state.yards[0]!;
  const yard: Yard = {
    id: 'yard-halic',
    name: TERSANE.name,
    coast: world.tersane.coast,
    dock: world.tersane.dock,
    capacity,
    slots: TERSANE.slots,
    builtAt: state.minute,
  };
  state.yards.push(yard);
  return yard;
}

export function fleetCapacity(state: GameState): number {
  return state.yards.reduce((s, y) => s + y.capacity, 0);
}

export function nearestYard(state: GameState, p: LngLat): Yard | undefined {
  let best: Yard | undefined;
  let bestD = Infinity;
  for (const y of state.yards) {
    const d = haversineM(p, y.dock);
    if (d < bestD) {
      bestD = d;
      best = y;
    }
  }
  return best;
}

export function yardById(state: GameState, id: string | undefined): Yard | undefined {
  return id ? state.yards.find((y) => y.id === id) : undefined;
}

export function shipsAtYard(state: GameState, yardId: string): { active: Ship[]; queued: Ship[]; inbound: Ship[] } {
  const here = state.ships.filter((s) => s.yardId === yardId);
  return {
    active: here.filter((s) => s.status === 'maintenance' && s.readyAt > 0),
    queued: here.filter((s) => s.status === 'maintenance' && s.readyAt === 0),
    inbound: here.filter((s) => s.status === 'toYard'),
  };
}

// ---------------------------------------------------------------- tersane kurma

export function previewYard(state: GameState, world: World, click: LngLat): PlacementResult {
  const obstacles = [
    ...state.piers.map((p) => ({ id: p.id, name: p.name, coast: p.coast, dock: p.dock })),
    ...state.yards.map((y) => ({ id: y.id, name: y.name, coast: y.coast, dock: y.dock })),
  ];
  return evaluatePlacement(click, {
    coast: world.coast,
    bbox: world.data.bbox,
    piers: obstacles,
    noBuild: world.data.noBuildZones,
    rules: { maxSnapDistanceM: 300, minSpacingM: TERSANE.minSpacingM, dockOffsetM: 30 },
  });
}

export function buildYard(state: GameState, world: World, click: LngLat): Result<Yard> {
  const r = previewYard(state, world, click);
  if (!r.ok) return fail(r.message);
  if (state.money < TERSANE.buildCost) return fail(`Yetersiz bütçe: tersane ${money(TERSANE.buildCost)}.`);
  const base = pickPierName(r.coast, world.data.places, { used: new Set() });
  const used = new Set(state.yards.map((y) => y.name));
  let name = `${base} Tersanesi`;
  for (let i = 2; used.has(name); i++) name = `${base} Tersanesi ${i}`;
  const yard: Yard = { id: nextId(state, 'yard'), name, coast: r.coast, dock: r.dock, capacity: TERSANE.buildCapacity, slots: TERSANE.buildSlots, builtAt: state.minute };
  state.yards.push(yard);
  state.money -= TERSANE.buildCost;
  state.today.costs += TERSANE.buildCost;
  return { ok: true, value: yard };
}

export function upgradeYardCapacity(state: GameState, yardId: string): Result<number> {
  const y = yardById(state, yardId);
  if (!y) return fail('Tersane yok.');
  if (state.money < TERSANE.upgradeCost) return fail(`Yetersiz bütçe: ${money(TERSANE.upgradeCost)}.`);
  state.money -= TERSANE.upgradeCost;
  state.today.costs += TERSANE.upgradeCost;
  y.capacity += TERSANE.upgradeStep;
  return { ok: true, value: y.capacity };
}

export function upgradeYardSlots(state: GameState, yardId: string): Result<number> {
  const y = yardById(state, yardId);
  if (!y) return fail('Tersane yok.');
  if (y.slots >= TERSANE.maxSlots) return fail(`En fazla ${TERSANE.maxSlots} bakım yuvası.`);
  if (state.money < TERSANE.slotCost) return fail(`Yetersiz bütçe: ${money(TERSANE.slotCost)}.`);
  state.money -= TERSANE.slotCost;
  state.today.costs += TERSANE.slotCost;
  y.slots += 1;
  return { ok: true, value: y.slots };
}

// ---------------------------------------------------------------- bakım

/** Durumun hız çarpanı: 100 → 1, 0 → minSpeedFactor. */
export function conditionSpeedFactor(ship: Ship): number {
  return MAINT.minSpeedFactor + ((1 - MAINT.minSpeedFactor) * Math.max(0, ship.condition)) / 100;
}

export function maintenanceCost(ship: Ship): number {
  return Math.round(SHIP_TYPES[ship.type].price * MAINT.costRatio * (ship.broken ? MAINT.breakdownCostMul : 1));
}

/** Seyir sonrası yıpranma ve sayaçlar. */
export function wear(ship: Ship, meters: number): void {
  if (meters <= 0) return;
  const km = meters / 1000;
  ship.total.km += km;
  ship.today.km += km;
  ship.condition = Math.max(0, ship.condition - km * MAINT.wearPerKm[ship.type]);
}

/** Kalkışta arıza zarı. */
export function rollBreakdown(state: GameState, ship: Ship): boolean {
  if (ship.condition >= MAINT.breakdownBelow) return false;
  const p = MAINT.breakdownChanceAtZero * ((MAINT.breakdownBelow - ship.condition) / MAINT.breakdownBelow);
  return random(state) < p;
}

/** Gemiyi yanaştığı iskeleden (ya da tersaneye giderken) en yakın tersaneye yollar. */
export function sendToYard(state: GameState, world: World, ship: Ship, from: LngLat, opts: { broken?: boolean } = {}): boolean {
  const yard = nearestYard(state, from);
  if (!yard) return false;
  const route = world.routes.get(`at:${from[0].toFixed(5)},${from[1].toFixed(5)}`, from, yard.id, yard.dock);
  ship.status = 'toYard';
  ship.yardId = yard.id;
  ship.transit = route ? route.points : [from, yard.dock];
  ship.dist = ship.prevDist = 0;
  ship.pierId = null;
  ship.broken = !!opts.broken || undefined;
  if (!ship.broken) delete ship.broken;
  return true;
}

/** Yanaşmış gemi bakıma gitmeli mi (otomatik eşik ya da istek)? */
export function needsMaintenance(state: GameState, ship: Ship): boolean {
  if (ship.maintRequested) return true;
  const t = state.settings.maintThreshold;
  return t > 0 && ship.condition < t;
}

/** Tersane kuyruğu: boş yuvaya gemi al, biteni hatta yolla. Her dakika. */
export function tickYards(state: GameState, world: World): void {
  for (const yard of state.yards) {
    const { active, queued } = shipsAtYard(state, yard.id);
    for (const ship of active) {
      if (state.minute < ship.readyAt) continue;
      ship.condition = 100;
      delete ship.broken;
      delete ship.maintRequested;
      returnToLine(state, world, ship, yard);
    }
    let free = yard.slots - active.filter((s) => s.status === 'maintenance').length;
    for (const ship of queued.sort((a, b) => a.arrivedAt - b.arrivedAt)) {
      if (free <= 0) break;
      const cost = maintenanceCost(ship);
      state.money -= cost;
      state.today.costs += cost;
      ship.readyAt = state.minute + MAINT.durationMin;
      free--;
    }
  }
}

/** Bakımı biten ya da yeni alınan gemiyi tersaneden hattın daha az gemili terminaline yollar. */
export function returnToLine(state: GameState, world: World, ship: Ship, yard: Yard): void {
  const line = state.lines.find((l) => l.id === ship.lineId);
  if (!line) return;
  const leg = pickTerminalLeg(state, line, ship.id);
  const n = line.pierIds.length;
  const terminal = pierById(state, line.pierIds[leg === 0 ? 0 : n - 1]!)!;
  const route = world.routes.get(yard.id, yard.dock, terminal.id, terminal.dock);
  ship.status = 'transit';
  ship.transit = route ? route.points : [yard.dock, terminal.dock];
  ship.transitLeg = leg;
  ship.dist = ship.prevDist = 0;
  ship.pierId = null;
  delete ship.yardId;
}

/** Terminallerden hangisi daha az gemiye sahip (0: baş, n-1: son). */
export function pickTerminalLeg(state: GameState, line: Line, exceptId?: string): number {
  const n = line.pierIds.length;
  let a = 0, b = 0;
  for (const s of state.ships) {
    if (s.lineId !== line.id || s.id === exceptId) continue;
    const towardB = s.status === 'transit' ? s.transitLeg === n - 1 : legEnds(line, s.leg).from === n - 1;
    if (towardB) b++;
    else a++;
  }
  return a <= b ? 0 : n - 1;
}

/** Gemi şu an nerede (yanaşmışsa iskele, seyirdeyse rota üstü). */
export function shipLocation(state: GameState, world: World, ship: Ship): LngLat | null {
  if (ship.pierId) return pierById(state, ship.pierId)?.dock ?? null;
  const line = state.lines.find((l) => l.id === ship.lineId);
  if ((ship.status === 'transit' || ship.status === 'toYard') && ship.transit) {
    return ship.transit[0] ?? null;
  }
  if (line && ship.status === 'sailing') {
    const r = legRoute(world, state, line, ship.leg);
    return r ? pointAlong(r, ship.dist).p : null;
  }
  const y = yardById(state, ship.yardId);
  return y?.dock ?? null;
}

/** Arıza: gemi kalkamaz, yolcular iskelede kalır, tersaneye çekilir. */
export function breakDown(state: GameState, world: World, ship: Ship, line: Line, at: LngLat, pierName: string): void {
  sendToYard(state, world, ship, at, { broken: true });
  state.notices.push({ at: state.minute, kind: 'error', text: `⚠ ${line.name} hattında ${SHIP_TYPES[ship.type].name.toLowerCase()} arızalandı (${pierName}), tersaneye çekiliyor.` });
  pushFeed(state, world, 'breakdown', { pier: pierName });
}

/** Yeni geminin başlangıç alanları. */
export function newShipFields(state: GameState): Pick<Ship, 'builtAt' | 'condition' | 'total' | 'today'> {
  return { builtAt: state.minute, condition: 100, total: emptyCounters(), today: emptyCounters() };
}
