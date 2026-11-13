/**
 * Boğaz transit trafiği: Karadeniz ile Marmara arasında akan büyük gemiler (tanker, konteyner,
 * dökme yük, kruvaziyer, koster). Vapurlar bu gemilere güvenlik mesafesinden fazla yaklaşamaz:
 * yavaşlar, gerekirse durur ve gemiden uzak tarafa kayarak (rota sapması) geçişi bekler.
 */
import { KNOT_M_PER_MIN, TRAFFIC } from '../config/balance.ts';
import { haversineM, offsetM, type LngLat } from '../geo/geo.ts';
import { astarCells, makeRoute, pointAlong, type Route } from '../nav/route.ts';
import { cellCenter, isWaterAt, nearestWaterCell, type WaterGrid } from '../nav/grid.ts';
import { pushFeed } from './feed.ts';
import { nextId, random } from './state.ts';
import type { GameState, Ship, TrafficKind, TrafficShip } from './types.ts';
import type { World } from './world.ts';

export interface Channel {
  /** Kuzeyden güneye şerit (Karadeniz → Marmara). */
  south: Route;
  /** Güneyden kuzeye şerit. */
  north: Route;
}

// ---------------------------------------------------------------- kanal

/** Her su hücresinin karaya uzaklığı (hücre), çok kaynaklı BFS. */
function distanceToLand(g: WaterGrid): Uint16Array {
  const n = g.cols * g.rows;
  const d = new Uint16Array(n).fill(65535);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) {
    if (!g.water[i]) {
      d[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++]!;
    const r = (i / g.cols) | 0, c = i - r * g.cols;
    const nb = [r > 0 ? i - g.cols : -1, r < g.rows - 1 ? i + g.cols : -1, c > 0 ? i - 1 : -1, c < g.cols - 1 ? i + 1 : -1];
    for (const j of nb) {
      if (j >= 0 && d[j]! > d[i]! + 1) {
        d[j] = d[i]! + 1;
        queue[tail++] = j;
      }
    }
  }
  return d;
}

/** Şerit: orta hattı yön sağına kaydır (kara çıkarsa kaydırma azaltılır). */
function lane(g: WaterGrid, center: LngLat[], offsetMeters: number): Route {
  const out: LngLat[] = [];
  for (let i = 0; i < center.length; i++) {
    const a = center[Math.max(0, i - 1)]!, b = center[Math.min(center.length - 1, i + 1)]!;
    const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const p = center[i]!;
    let q = p;
    for (const k of [1, 0.6, 0.3, 0]) {
      const cand = offsetM(p, (dy / len) * offsetMeters * k, (-dx / len) * offsetMeters * k);
      if (isWaterAt(g, cand)) {
        q = cand;
        break;
      }
    }
    out.push(q);
  }
  return makeRoute(out);
}

/** Karadeniz girişinden Marmara'ya, kıyıdan uzak duran orta hat ve iki şerit. */
export function buildChannel(g: WaterGrid): Channel | null {
  const dist = distanceToLand(g);
  const n0 = nearestWaterCell(g, TRAFFIC.northEnd as unknown as LngLat);
  const s0 = nearestWaterCell(g, TRAFFIC.southEnd as unknown as LngLat);
  const cells = astarCells(g, n0, s0, (i) => 1 + TRAFFIC.centerPull / (1 + dist[i]!));
  if (!cells) return null;
  // Her N hücreden birini al: kıvrımları korur, nokta sayısını azaltır.
  const center: LngLat[] = [];
  for (let i = 0; i < cells.length; i += TRAFFIC.sampleEvery) center.push(cellCenter(g, cells[i]!));
  center.push(cellCenter(g, cells[cells.length - 1]!));
  const south = lane(g, center, TRAFFIC.laneOffsetM);
  const north = lane(g, [...center].reverse(), TRAFFIC.laneOffsetM);
  return { south, north };
}

export function channelOf(world: World): Channel | null {
  if (world.channel === undefined) world.channel = buildChannel(world.grid);
  return world.channel;
}

export function trafficRoute(world: World, t: TrafficShip): Route | null {
  const ch = channelOf(world);
  if (!ch) return null;
  return t.dir === 1 ? ch.south : ch.north;
}

export function trafficPose(world: World, t: TrafficShip, frac = 1): { p: LngLat; dir: [number, number] } | null {
  const r = trafficRoute(world, t);
  if (!r) return null;
  return pointAlong(r, t.prevDist + (t.dist - t.prevDist) * frac);
}

// ---------------------------------------------------------------- akış

function pickKind(state: GameState): TrafficKind {
  const kinds = Object.keys(TRAFFIC.kinds) as TrafficKind[];
  const total = kinds.reduce((s, k) => s + TRAFFIC.kinds[k].weight, 0);
  let r = random(state) * total;
  for (const k of kinds) {
    r -= TRAFFIC.kinds[k].weight;
    if (r <= 0) return k;
  }
  return kinds[0]!;
}

export function spawnTraffic(state: GameState, world: World, kind?: TrafficKind, dir?: 1 | -1): TrafficShip | null {
  if (!channelOf(world)) return null;
  const k = kind ?? pickKind(state);
  const spec = TRAFFIC.kinds[k];
  const names = spec.names;
  const t: TrafficShip = {
    id: nextId(state, 'traffic'),
    kind: k,
    name: names[Math.floor(random(state) * names.length)]!,
    dir: dir ?? (random(state) < 0.5 ? 1 : -1),
    dist: 0,
    prevDist: 0,
    speedMul: 0.9 + random(state) * 0.2,
  };
  state.traffic.push(t);
  if (k === 'tanker' && random(state) < TRAFFIC.tankerFeedChance) pushFeed(state, world, 'tanker');
  return t;
}

/** Boş kanalı doldur: açılışta Boğaz'da gemiler rastgele konumlarda seyrediyor olsun. */
export function warmTraffic(state: GameState, world: World): void {
  if (!state.settings.traffic || state.traffic.length || !channelOf(world)) return;
  for (let i = 0; i < TRAFFIC.warmCount; i++) {
    const t = spawnTraffic(state, world);
    if (!t) return;
    const len = trafficRoute(world, t)?.lengthM ?? 0;
    t.dist = t.prevDist = random(state) * len * 0.95;
  }
}

/** Trafik gemilerini ilerlet, yenilerini üret, çıkanları sil. Her dakika. */
export function tickTraffic(state: GameState, world: World): void {
  if (!state.settings.traffic) {
    if (state.traffic.length) state.traffic = [];
    return;
  }
  if (!channelOf(world)) return;
  if (random(state) < TRAFFIC.perHour / 60) spawnTraffic(state, world);
  for (const t of state.traffic) {
    t.prevDist = t.dist;
    t.dist += TRAFFIC.kinds[t.kind].speedKn * KNOT_M_PER_MIN * t.speedMul;
  }
  state.traffic = state.traffic.filter((t) => t.dist < (trafficRoute(world, t)?.lengthM ?? 0));
}

// ---------------------------------------------------------------- vapurla etkileşim

export interface Avoidance {
  /** Hız çarpanı (0 = dur). */
  factor: number;
  /** Rota sapması (m): + yönün sağı, − solu. */
  sidestep: number;
  /** Yol verilen gemi. */
  near: TrafficShip | null;
}

/**
 * Vapur bu dakika nereye gidecek, hangi trafik gemisi güvenlik mesafesine giriyor?
 * Vapurun önündeki noktaya en yakın gemiye göre yavaşla/dur, gemiden uzak tarafa kay.
 */
export function avoidance(state: GameState, world: World, p: LngLat, dir: [number, number], stepM: number): Avoidance {
  const out: Avoidance = { factor: 1, sidestep: 0, near: null };
  if (!state.traffic.length) return out;
  const ahead = offsetM(p, dir[0] * Math.max(stepM, 60), dir[1] * Math.max(stepM, 60));
  for (const t of state.traffic) {
    const pose = trafficPose(world, t);
    if (!pose) continue;
    const spec = TRAFFIC.kinds[t.kind];
    // Gemi de ilerliyor: bir dakika sonraki konumunu da hesaba kat.
    const tNext = offsetM(pose.p, pose.dir[0] * spec.speedKn * KNOT_M_PER_MIN, pose.dir[1] * spec.speedKn * KNOT_M_PER_MIN);
    const d = Math.min(haversineM(ahead, pose.p), haversineM(ahead, tNext), haversineM(p, pose.p));
    if (d >= spec.safetyM * TRAFFIC.slowBand) continue;
    const f = d < spec.safetyM ? 0 : TRAFFIC.slowFactor;
    if (f < out.factor) {
      out.factor = f;
      out.near = t;
      // Gemi vapurun solunda mı sağında mı? Ters tarafa kay.
      const ex = (pose.p[0] - p[0]) * Math.cos((p[1] * Math.PI) / 180), ey = pose.p[1] - p[1];
      const cross = dir[0] * ey - dir[1] * ex; // > 0: gemi solda
      out.sidestep = (cross > 0 ? 1 : -1) * TRAFFIC.sidestepM * (1 - Math.min(1, d / (spec.safetyM * TRAFFIC.slowBand)));
    }
  }
  return out;
}

/** Vapurun yol verme durumunu güncelle (çizim sapması yumuşak değişir). */
export function applyAvoidance(state: GameState, world: World, ship: Ship, a: Avoidance): void {
  const target = a.sidestep;
  const cur = ship.sidestep ?? 0;
  ship.sidestep = cur + (target - cur) * 0.35;
  if (Math.abs(ship.sidestep) < 1) delete ship.sidestep;
  if (a.factor < 1) {
    ship.yielding = (ship.yielding ?? 0) + 1;
    state.today.yieldMinutes = (state.today.yieldMinutes ?? 0) + 1;
    if (ship.yielding === TRAFFIC.feedAfterMin && random(state) < 0.5) pushFeed(state, world, 'tanker');
  } else delete ship.yielding;
}
