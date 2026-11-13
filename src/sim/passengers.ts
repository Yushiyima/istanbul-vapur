/**
 * Talep, biniş/iniş, ekonomi ve memnuniyet (Aşama 3). DOM'a dokunmaz.
 *
 * Talep iskele havzası bazında: her iskele için havza nüfusu (pop) ve çekimi (att) önceden
 * toplanır. İskele çifti (i, j) için dakikalık potansiyel yolcu:
 *     k · pop_i · att_j / d_ij^γ · saat profili · yön çarpanı · memnuniyet çarpanı
 * Bunun P_vapur kadarı vapuru seçer:  P = 1 / (1 + exp(β (T_vapur − T_kara))).
 */
import { DEMAND, ECON, KNOT_M_PER_MIN, LINE, SATISFACTION, SHIP_TYPES, TIME } from '../config/balance.ts';
import { haversineM, type LngLat } from '../geo/geo.ts';
import { catchmentOf } from './catchment.ts';
import { routeTimeFactor } from './events.ts';
import { onDayEnd, onHourEnd } from './hooks.ts';
import { emptyDay, emptyHour, minuteOfDay } from './state.ts';
import type { GameState, Line, Pier, Ship, WaitGroup } from './types.ts';
import { legEnds, legRoute, type World } from './world.ts';

export type Period = 'peak' | 'offpeak' | 'night';

export interface OdLeg {
  lineId: string;
  from: string;
  to: string;
}

export interface OdPair {
  o: string;
  d: string;
  key: string;
  /** Saat ve memnuniyet çarpanı öncesi dakikalık potansiyel. */
  base: number;
  legs: OdLeg[];
  /** Dönemlere göre vapur payı (hat o dönemde çalışmıyorsa 0). */
  share: Record<Period, number>;
  tVapur: number;
  tLand: Record<Period, number>;
  /** Sabah zirvesinde ağır yön mü (Anadolu → Avrupa). */
  dir: 'toEurope' | 'toAsia' | 'none';
}

interface OdCache {
  sig: string;
  pairs: OdPair[];
  byKey: Map<string, OdPair>;
}

// ---------------------------------------------------------------- dönem ve saat

export function periodAt(minute: number): Period {
  const h = Math.floor(minuteOfDay(minute) / 60);
  if (h < 6 || h >= 23) return 'night';
  const [m0, m1] = DEMAND.morningPeak, [e0, e1] = DEMAND.eveningPeak;
  return (h >= m0 && h < m1) || (h >= e0 && h < e1) ? 'peak' : 'offpeak';
}

function directionFactor(pair: OdPair, minute: number): number {
  if (pair.dir === 'none') return 1;
  const h = Math.floor(minuteOfDay(minute) / 60);
  const morning = h >= DEMAND.morningPeak[0] && h < DEMAND.morningPeak[1];
  const evening = h >= DEMAND.eveningPeak[0] && h < DEMAND.eveningPeak[1];
  if (!morning && !evening) return 1;
  const heavy = morning ? 'toEurope' : 'toAsia';
  return pair.dir === heavy ? DEMAND.peakDirBoost : DEMAND.peakDirDamp;
}

export function satisfactionMultiplier(sat: number): number {
  return SATISFACTION.demandMulMin + ((SATISFACTION.demandMulMax - SATISFACTION.demandMulMin) * Math.max(0, Math.min(100, sat))) / 100;
}

// ---------------------------------------------------------------- kara alternatifi

function landMinutes(a: Pier, b: Pier, period: Period): number {
  if (a.side === 'ada' || b.side === 'ada') {
    // Aynı adanın iki iskelesi arası yürünür/faytonla gidilir; adalar arası kara yolu yok.
    return a.comp === b.comp ? (haversineM(a.coast, b.coast) * DEMAND.landDetour) / DEMAND.walkSpeedMPerMin : Infinity;
  }
  const speedMPerMin = (DEMAND.landSpeedKmh[period] * 1000) / 60;
  if (a.side === b.side) return (haversineM(a.coast, b.coast) * DEMAND.landDetour) / speedMPerMin;
  let road = Infinity;
  for (const c of DEMAND.crossings) {
    const p: LngLat = [c.lng, c.lat];
    const d = (haversineM(a.coast, p) + haversineM(p, b.coast)) * DEMAND.landDetour;
    road = Math.min(road, d / speedMPerMin + DEMAND.bridgePenaltyMin[period]);
  }
  return Math.min(road, marmarayMinutes(a, b, period));
}

function marmarayMinutes(a: Pier, b: Pier, period: Period): number {
  if (period === 'night') return Infinity;
  const st = DEMAND.marmaray.stations;
  const nearest = (p: Pier) => {
    let best: { s: (typeof st)[number]; d: number } | null = null;
    for (const s of st) {
      if (s.side !== p.side) continue;
      const d = haversineM(p.coast, [s.lng, s.lat]) * DEMAND.landDetour;
      if (!best || d < best.d) best = { s, d };
    }
    return best;
  };
  const sa = nearest(a), sb = nearest(b);
  if (!sa || !sb) return Infinity;
  const rail = (haversineM([sa.s.lng, sa.s.lat], [sb.s.lng, sb.s.lat]) / 1000 / DEMAND.marmaray.speedKmh) * 60;
  return (sa.d + sb.d) / DEMAND.walkSpeedMPerMin + DEMAND.marmaray.waitMin + rail;
}

// ---------------------------------------------------------------- rota tablosu

function signature(state: GameState): string {
  return (
    state.piers.map((p) => p.id).join(',') +
    '|' +
    state.lines.map((l) => `${l.id}:${l.pierIds.join('-')}:${l.intervalMin}:${l.shipType}:${l.night ? 1 : 0}`).join(';')
  );
}

/** Hattın i'den j'ye (indeks) deniz süresi, dk; ara iskelelerde yanaşma dahil. */
function rideMinutes(world: World, state: GameState, line: Line, i: number, j: number): number {
  const speed = SHIP_TYPES[line.shipType].speedKn * KNOT_M_PER_MIN;
  const n = line.pierIds.length;
  let m = 0;
  const legMin = (leg: number) => {
    const r = legRoute(world, state, line, leg);
    return r ? (r.lengthM / speed) * routeTimeFactor(world, r) : Infinity;
  };
  if (j > i) {
    for (let leg = i; leg < j; leg++) m += legMin(leg);
  } else {
    for (let k = i; k > j; k--) m += legMin(2 * (n - 1) - k);
  }
  return m + Math.max(0, Math.abs(j - i) - 1) * LINE.dwellMin;
}

function lineServes(line: Line, period: Period): boolean {
  return period !== 'night' || line.night;
}

function legWait(line: Line): number {
  return Math.min(line.intervalMin / 2, DEMAND.maxPerceivedWaitMin);
}

interface Plan {
  legs: OdLeg[];
  minutes: number;
  lines: Line[];
}

function bestPlan(world: World, state: GameState, o: string, d: string): Plan | null {
  let best: Plan | null = null;
  const consider = (p: Plan) => {
    if (!best || p.minutes < best.minutes) best = p;
  };
  const withO = state.lines.filter((l) => l.pierIds.includes(o));
  for (const l of withO) {
    const i = l.pierIds.indexOf(o), j = l.pierIds.indexOf(d);
    if (j >= 0) consider({ legs: [{ lineId: l.id, from: o, to: d }], minutes: rideMinutes(world, state, l, i, j) + legWait(l), lines: [l] });
  }
  if (best) return best;
  // Tek aktarma.
  const withD = state.lines.filter((l) => l.pierIds.includes(d));
  for (const l1 of withO) {
    for (const l2 of withD) {
      if (l1.id === l2.id) continue;
      for (const k of l1.pierIds) {
        if (k === o || k === d || !l2.pierIds.includes(k)) continue;
        const m =
          rideMinutes(world, state, l1, l1.pierIds.indexOf(o), l1.pierIds.indexOf(k)) +
          rideMinutes(world, state, l2, l2.pierIds.indexOf(k), l2.pierIds.indexOf(d)) +
          legWait(l1) +
          legWait(l2) +
          DEMAND.transferPenaltyMin;
        consider({ legs: [{ lineId: l1.id, from: o, to: k }, { lineId: l2.id, from: k, to: d }], minutes: m, lines: [l1, l2] });
      }
    }
  }
  return best;
}

function hasRail(world: World, p: Pier): boolean {
  return world.data.stations.some((s) => haversineM(p.coast, [s.lng, s.lat]) <= DEMAND.railTransferRadiusM);
}

export function odTable(state: GameState, world: World): OdCache {
  const sig = signature(state);
  const cached = world.od as OdCache | null;
  if (cached && cached.sig === sig) return cached;
  const pairs: OdPair[] = [];
  const walk = (2 * DEMAND.avgWalkM) / DEMAND.walkSpeedMPerMin;
  const rail = new Map(state.piers.map((p) => [p.id, hasRail(world, p)]));
  for (const a of state.piers) {
    for (const b of state.piers) {
      if (a.id === b.id) continue;
      const plan = bestPlan(world, state, a.id, b.id);
      if (!plan || !Number.isFinite(plan.minutes)) continue;
      const ca = catchmentOf(world, a), cb = catchmentOf(world, b);
      const distKm = Math.max(DEMAND.minDistKm, haversineM(a.coast, b.coast) / 1000);
      let base = (DEMAND.k * ca.pop * cb.att) / distKm ** DEMAND.gamma;
      if (a.side === b.side && a.side !== 'ada') base *= DEMAND.sameSideFactor;
      if (rail.get(b.id)) base *= DEMAND.railAttBoost;
      if (rail.get(a.id)) base *= DEMAND.railAttBoost;
      const tVapur = walk + plan.minutes;
      const tLand = { peak: landMinutes(a, b, 'peak'), offpeak: landMinutes(a, b, 'offpeak'), night: landMinutes(a, b, 'night') };
      const share = {} as Record<Period, number>;
      for (const per of ['peak', 'offpeak', 'night'] as const) {
        if (!plan.lines.every((l) => lineServes(l, per))) {
          share[per] = 0;
          continue;
        }
        const tl = tLand[per];
        share[per] = Number.isFinite(tl) ? 1 / (1 + Math.exp(DEMAND.betaPerMin * (tVapur - tl))) : 1;
      }
      const dir = a.side === 'anadolu' && b.side === 'avrupa' ? 'toEurope' : a.side === 'avrupa' && b.side === 'anadolu' ? 'toAsia' : 'none';
      pairs.push({ o: a.id, d: b.id, key: `${a.id}>${b.id}`, base, legs: plan.legs, share, tVapur, tLand, dir });
    }
  }
  const out: OdCache = { sig, pairs, byKey: new Map(pairs.map((p) => [p.key, p])) };
  world.od = out as World['od'];
  return out;
}

// ---------------------------------------------------------------- talep üretimi

function addWaiting(state: GameState, pierId: string, g: Omit<WaitGroup, 'since'> & { since: number }): void {
  const list = (state.waiting[pierId] ??= []);
  const same = list.find((x) => x.lineId === g.lineId && x.alight === g.alight && x.dest === g.dest && !!x.xfer === !!g.xfer);
  if (same) {
    const total = same.count + g.count;
    same.since = (same.since * same.count + g.since * g.count) / total;
    same.startedAt = (same.startedAt * same.count + g.startedAt * g.count) / total;
    same.count = total;
  } else list.push({ ...g });
}

/** Saat profili × yön × memnuniyet ile dakikalık yolcu üretir. */
export function generateDemand(state: GameState, world: World): void {
  if (!state.lines.length || !world.data.cells) return;
  const od = odTable(state, world);
  const hour = Math.floor(minuteOfDay(state.minute) / 60);
  const period = periodAt(state.minute);
  const mul = DEMAND.hourly[hour]! * satisfactionMultiplier(state.satisfaction);
  for (const pair of od.pairs) {
    const share = pair.share[period];
    if (!share) continue;
    const rate = pair.base * mul * share * directionFactor(pair, state.minute);
    const carry = (state.demandCarry[pair.key] ?? 0) + rate;
    const n = Math.floor(carry);
    state.demandCarry[pair.key] = carry - n;
    if (n <= 0) continue;
    const leg = pair.legs[0]!;
    addWaiting(state, pair.o, { lineId: leg.lineId, alight: leg.to, dest: pair.d, count: n, since: state.minute, startedAt: state.minute });
  }
  if (state.minute % 5 === 0) giveUp(state);
}

function giveUp(state: GameState): void {
  for (const list of Object.values(state.waiting)) {
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i]!;
      if (state.minute - g.since > DEMAND.giveUpMin) {
        state.today.gaveUp += g.count;
        state.hourAcc.gaveUp += g.count;
        list.splice(i, 1);
      }
    }
  }
}

// ---------------------------------------------------------------- biniş ve iniş

/** Bu bacakta ileride kalan iskeleler. */
function aheadOf(line: Line, leg: number): Set<string> {
  const { from, dir } = legEnds(line, leg);
  const out = new Set<string>();
  for (let i = from + dir; i >= 0 && i < line.pierIds.length; i += dir) out.add(line.pierIds[i]!);
  return out;
}

export function boardAt(state: GameState, _world: World, ship: Ship, line: Line, pier: Pier): void {
  state.hourAcc.departures += 1;
  const cap = SHIP_TYPES[ship.type].capacity;
  let onboard = ship.onboard.reduce((s, g) => s + g.count, 0);
  const ahead = aheadOf(line, ship.leg);
  const list = state.waiting[pier.id] ?? [];
  const eligible = list.filter((g) => g.lineId === line.id && ahead.has(g.alight)).sort((a, b) => a.since - b.since);
  const ls = state.lineStats[line.id];
  let denied = 0;
  for (const g of eligible) {
    const free = cap - onboard;
    if (free <= 0) {
      denied += g.count;
      continue;
    }
    const n = Math.min(free, g.count);
    onboard += n;
    const fare = g.xfer ? ECON.transferTicket : ECON.ticket;
    state.money += n * fare;
    state.today.revenue += n * fare;
    state.today.boardings += n;
    state.hourAcc.boardings += n;
    const wait = (state.minute - g.since) * n;
    state.today.waitSum += wait;
    state.today.waitCount += n;
    state.hourAcc.waitSum += wait;
    state.hourAcc.waitCount += n;
    if (ls) {
      ls.boardings += n;
      ls.revenue += n * fare;
    }
    const on = ship.onboard.find((x) => x.alight === g.alight && x.dest === g.dest);
    if (on) on.count += n;
    else ship.onboard.push({ alight: g.alight, dest: g.dest, count: n, startedAt: g.startedAt });
    g.count -= n;
    if (g.count > 0) denied += g.count;
  }
  state.waiting[pier.id] = list.filter((g) => g.count > 0);
  state.today.denied += denied;
  state.hourAcc.denied += denied;
  if (ls) ls.load = ls.load * 0.8 + (onboard / cap) * 0.2;
}

export function alightAt(state: GameState, world: World, ship: Ship, pier: Pier): void {
  const stay: typeof ship.onboard = [];
  for (const g of ship.onboard) {
    if (g.alight !== pier.id) {
      stay.push(g);
      continue;
    }
    if (g.dest === pier.id) {
      state.today.journeys += g.count;
      continue;
    }
    // Aktarma: bu iskeleden varışa planın ilk bacağı.
    const plan = odTable(state, world).byKey.get(`${pier.id}>${g.dest}`);
    const leg = plan?.legs[0];
    if (!leg) {
      state.today.gaveUp += g.count;
      continue;
    }
    addWaiting(state, pier.id, { lineId: leg.lineId, alight: leg.to, dest: g.dest, count: g.count, since: state.minute, startedAt: g.startedAt, xfer: true });
  }
  ship.onboard = stay;
}

export function noteMissed(state: GameState): void {
  state.hourAcc.missed += 1;
}

// ---------------------------------------------------------------- ekonomi ve memnuniyet

export function historicBonus(state: GameState): number {
  const n = state.piers.filter((p) => p.historicId).length;
  return Math.min(SATISFACTION.historicBonusMax, n * SATISFACTION.historicBonusPerPier);
}

/** Son saatin ölçümlerinden 0–100 memnuniyet puanı; ölçüm yoksa null. */
export function hourScore(state: GameState): number | null {
  const h = state.hourAcc;
  if (h.departures + h.missed === 0 && h.waitCount === 0) return null;
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const avgWait = h.waitCount ? h.waitSum / h.waitCount : SATISFACTION.waitGoodMin;
  const wait = clamp((SATISFACTION.waitWorstMin - avgWait) / (SATISFACTION.waitWorstMin - SATISFACTION.waitGoodMin));
  const unhappy = h.denied + h.gaveUp * 2;
  const crowd = 1 - clamp((unhappy / Math.max(1, h.boardings + unhappy)) * 3);
  const cancel = 1 - clamp((h.missed / Math.max(1, h.departures + h.missed)) * 2);
  const w = SATISFACTION.weights;
  return Math.min(100, 100 * (w.wait * wait + w.crowd * crowd + w.cancel * cancel) + historicBonus(state));
}

export function dailyRunningCost(state: GameState): number {
  const crew = state.ships.reduce((s, sh) => s + SHIP_TYPES[sh.type].crewPerDay, 0);
  return crew + state.piers.length * ECON.pierMaintPerDay;
}

export function updateEconomyAndSatisfaction(state: GameState, world: World): void {
  if (state.minute % 60 === 0) {
    const score = hourScore(state);
    if (score !== null) state.satisfaction = SATISFACTION.smoothing * state.satisfaction + (1 - SATISFACTION.smoothing) * score;
    const acc = state.hourAcc;
    state.hourAcc = emptyHour();
    onHourEnd(state, world, acc);
  }
  if (state.minute % TIME.minutesPerDay === 0) {
    const cost = dailyRunningCost(state);
    state.money -= cost;
    state.today.costs += cost;
    state.year.revenue += state.today.revenue;
    state.year.costs += state.today.costs;
    state.year.boardings += state.today.boardings;
    state.year.satisfactionSum += state.satisfaction;
    state.year.satisfactionDays += 1;
    state.yesterday = state.today;
    state.today = emptyDay();
    for (const ls of Object.values(state.lineStats)) {
      ls.boardings = 0;
      ls.revenue = 0;
      ls.missed = 0;
      ls.trips = 0;
    }
    onDayEnd(state, world);
  }
}

/** Bekleyen yolcu sayısı (iskele ya da tümü). */
export function waitingCount(state: GameState, pierId?: string): number {
  const lists = pierId ? [state.waiting[pierId] ?? []] : Object.values(state.waiting);
  return lists.reduce((s, l) => s + l.reduce((t, g) => t + g.count, 0), 0);
}
