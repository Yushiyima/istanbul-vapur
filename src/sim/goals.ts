/**
 * Şehir hedefleri: her biri bir kez, ödüllü. Saat başı kontrol edilir.
 */
import { DEMAND, GOAL_RULES, GOALS } from '../config/balance.ts';
import { haversineM, pointInPolygon, type LngLat } from '../geo/geo.ts';
import { coveredPopulation } from './catchment.ts';
import type { GameState, GoalId, Pier } from './types.ts';
import { pierById, type World } from './world.ts';

export const GOAL_IDS = Object.keys(GOALS) as GoalId[];

/** En az bir gemisi olan hatların iskeleleri. */
export function servedPiers(state: GameState): Pier[] {
  const ids = new Set<string>();
  for (const l of state.lines) {
    if (!state.ships.some((s) => s.lineId === l.id)) continue;
    for (const id of l.pierIds) ids.add(id);
  }
  return state.piers.filter((p) => ids.has(p.id));
}

function crossLegs(state: GameState): [Pier, Pier][] {
  const out: [Pier, Pier][] = [];
  const seen = new Set<string>();
  for (const l of state.lines) {
    for (let i = 0; i + 1 < l.pierIds.length; i++) {
      const a = pierById(state, l.pierIds[i]!), b = pierById(state, l.pierIds[i + 1]!);
      if (!a || !b) continue;
      const sides = new Set([a.side, b.side]);
      if (!(sides.has('avrupa') && sides.has('anadolu'))) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([a, b]);
    }
  }
  return out;
}

/** Birbirinden en az 1,5 km uzak yaka geçişlerinin sayısı. */
export function distinctCrossings(state: GameState): number {
  const picked: LngLat[] = [];
  for (const [a, b] of crossLegs(state)) {
    const mid: LngLat = [(a.coast[0] + b.coast[0]) / 2, (a.coast[1] + b.coast[1]) / 2];
    if (picked.every((p) => haversineM(p, mid) >= GOAL_RULES.crossingSeparationM)) picked.push(mid);
  }
  return picked.length;
}

/** Hatlarla (aktarmalı) birbirine ulaşılabilen iskele kümeleri. */
function components(state: GameState): Map<string, string> {
  const parent = new Map(state.piers.map((p) => [p.id, p.id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const l of state.lines) for (let i = 1; i < l.pierIds.length; i++) parent.set(find(l.pierIds[i]!), find(l.pierIds[0]!));
  return new Map(state.piers.map((p) => [p.id, find(p.id)]));
}

export function yearAverageSatisfaction(state: GameState): number {
  return state.year.satisfactionDays ? state.year.satisfactionSum / state.year.satisfactionDays : state.satisfaction;
}

export function goalProgress(state: GameState, world: World): Record<GoalId, { done: boolean; progress: string }> {
  const served = servedPiers(state);
  const halic = world.data.zones.find((z) => z.id === 'halic');
  const starts = new Set(world.data.historic.filter((h) => h.start).map((h) => h.id));
  const historic = state.piers.filter((p) => p.historicId && !starts.has(p.historicId)).length;
  const rail = served.filter((p) => world.data.stations.some((s) => haversineM(p.coast, [s.lng, s.lat]) <= DEMAND.railTransferRadiusM)).length;
  const cov = coveredPopulation(world, served);
  const covPct = cov.total ? (100 * cov.covered) / cov.total : 0;
  const crossings = distinctCrossings(state);
  const comps = components(state);
  const linked = new Set(state.lines.flatMap((l) => l.pierIds));
  const north = state.piers.filter((p) => p.coast[1] >= GOAL_RULES.sariyerLat && p.side !== 'ada' && linked.has(p.id));
  const south = state.piers.filter((p) => p.coast[1] <= GOAL_RULES.southLat && p.side === 'avrupa' && linked.has(p.id));
  const sariyer = north.some((n) => south.some((s) => comps.get(n.id) === comps.get(s.id)));
  let halicMax = 0;
  if (halic) {
    for (const l of state.lines) {
      const n = l.pierIds.filter((id) => {
        const p = pierById(state, id);
        return !!p && pointInPolygon(p.coast, halic.polygon);
      }).length;
      halicMax = Math.max(halicMax, n);
    }
  }
  const night = state.lines.some((l) => l.night && state.ships.some((s) => s.lineId === l.id));
  const ada = state.lines.some((l) => l.pierIds.some((id) => pierById(state, id)?.side === 'ada'));
  const r = (done: boolean, progress: string) => ({ done, progress });
  return {
    connectSides: r(crossings >= 1, `${Math.min(1, crossings)} / 1`),
    connectSides3: r(crossings >= 3, `${Math.min(3, crossings)} / 3`),
    adalar: r(ada, ada ? 'tamam' : '—'),
    halic: r(halicMax >= 2, `${Math.min(2, halicMax)} / 2 iskele`),
    sariyer: r(sariyer, sariyer ? 'tamam' : '—'),
    historic5: r(historic >= 5, `${Math.min(5, historic)} / 5`),
    rail5: r(rail >= 5, `${Math.min(5, rail)} / 5`),
    coverage10: r(covPct >= 10, `%${covPct.toFixed(1)} / %10`),
    coverage25: r(covPct >= 25, `%${covPct.toFixed(1)} / %25`),
    // Yıl sonunda değerlendirilir (bkz. checkYearGoals).
    satisfaction95: r(false, `yıl ort. %${yearAverageSatisfaction(state).toFixed(0)} / %95`),
    night: r(night, night ? 'tamam' : '—'),
  };
}

function award(state: GameState, id: GoalId): void {
  if (state.goals[id] !== undefined) return;
  const g = GOALS[id];
  state.goals[id] = state.minute;
  state.money += g.reward;
  state.today.revenue += g.reward;
  state.notices.push({ at: state.minute, kind: 'ok', text: `🏆 Hedef tamam: ${g.title} · ödül ${Math.round(g.reward).toLocaleString('tr-TR')} ₺` });
}

/** Saat başı: tamamlanan hedeflerin ödülünü ver. Yeni tamamlananları döner. */
export function checkGoals(state: GameState, world: World): GoalId[] {
  const progress = goalProgress(state, world);
  const done: GoalId[] = [];
  for (const id of GOAL_IDS) {
    if (id === 'satisfaction95' || state.goals[id] !== undefined) continue;
    if (progress[id].done) {
      award(state, id);
      done.push(id);
    }
  }
  return done;
}

/** Yıl sonu: ortalama memnuniyet hedefi. */
export function checkYearGoals(state: GameState, avgSatisfaction: number): boolean {
  if (state.goals.satisfaction95 === undefined && avgSatisfaction >= 95) {
    award(state, 'satisfaction95');
    return true;
  }
  return false;
}
