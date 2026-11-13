/** Saat ve gün sonu kancaları: hedefler, Peron paylaşımları, yıl sonu özeti. */
import { GOALS, TIME } from '../config/balance.ts';
import { hourlyFeed, pushFeed } from './feed.ts';
import { checkGoals, checkYearGoals } from './goals.ts';
import { dayIndex, yearIndex } from './state.ts';
import type { GameState, HourAcc } from './types.ts';
import type { World } from './world.ts';

/** En çok bekleyen iskele ve oradaki en uzun bekleme (dk). */
function worstPier(state: GameState): { name: string | null; wait: number; count: number } {
  let best: { name: string | null; wait: number; count: number } = { name: null, wait: 0, count: 0 };
  for (const p of state.piers) {
    const list = state.waiting[p.id] ?? [];
    const count = list.reduce((s, g) => s + g.count, 0);
    const wait = list.reduce((m, g) => Math.max(m, state.minute - g.since), 0);
    if (count > best.count) best = { name: p.name, wait, count };
  }
  return best;
}

export function onHourEnd(state: GameState, world: World, acc: HourAcc): void {
  for (const id of checkGoals(state, world)) pushFeed(state, world, 'goal', { goal: GOALS[id].title });
  const worst = worstPier(state);
  hourlyFeed(state, world, {
    denied: acc.denied,
    boardings: acc.boardings,
    missed: acc.missed,
    departures: acc.departures,
    avgWait: acc.waitCount ? acc.waitSum / acc.waitCount : 0,
    worstPier: worst.name,
    worstWait: worst.wait,
  });
}

export function onDayEnd(state: GameState, _world: World): void {
  if (dayIndex(state.minute) % TIME.daysPerYear !== 0) return;
  const y = state.year;
  const avg = y.satisfactionDays ? y.satisfactionSum / y.satisfactionDays : state.satisfaction;
  const before = state.money;
  checkYearGoals(state, avg);
  state.pendingYearSummary = {
    year: yearIndex(state.minute),
    revenue: y.revenue,
    costs: y.costs,
    boardings: y.boardings,
    satisfaction: avg,
    rewards: state.money - before,
  };
  state.year = { satisfactionSum: 0, satisfactionDays: 0, revenue: 0, costs: 0, boardings: 0 };
}
