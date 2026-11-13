/** Saat ve gün sonu kancaları: hedefler, yıl sonu özeti. */
import { GOALS, TIME } from '../config/balance.ts';
import { pushFeed } from './feed.ts';
import { checkGoals, checkYearGoals } from './goals.ts';
import { dayIndex, yearIndex } from './state.ts';
import type { GameState } from './types.ts';
import type { World } from './world.ts';

export function onHourEnd(state: GameState, world: World): void {
  for (const id of checkGoals(state, world)) pushFeed(state, world, 'goal', { goal: GOALS[id].title });
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
