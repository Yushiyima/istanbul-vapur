import { ECON, MAINT, TIME } from '../config/balance.ts';
import type { DayStats, GameState, HourAcc } from './types.ts';

export function emptyDay(): DayStats {
  return { boardings: 0, revenue: 0, costs: 0, tripsDone: 0, tripsMissed: 0, denied: 0, gaveUp: 0, waitSum: 0, waitCount: 0, journeys: 0 };
}

export function emptyHour(): HourAcc {
  return { waitSum: 0, waitCount: 0, boardings: 0, denied: 0, departures: 0, missed: 0, gaveUp: 0 };
}

export function createGame(seed: number): GameState {
  return {
    version: 1,
    seed,
    rng: seed >>> 0 || 1,
    seq: 0,
    minute: TIME.startMinuteOfDay,
    money: ECON.startMoney,
    piers: [],
    lines: [],
    ships: [],
    waiting: {},
    demandCarry: {},
    satisfaction: 75,
    hourAcc: emptyHour(),
    today: emptyDay(),
    yesterday: null,
    year: { satisfactionSum: 0, satisfactionDays: 0, revenue: 0, costs: 0, boardings: 0 },
    lineStats: {},
    goals: {},
    weather: { kind: 'acik', from: 0, until: 0 },
    tanker: null,
    feed: [],
    notices: [],
    yards: [],
    settings: { maintThreshold: MAINT.defaultThreshold, nightSkip: false },
    pendingYearSummary: null,
  };
}

export function nextId(state: GameState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}`;
}

/** mulberry32: durum GameState içinde, kayıt/yükleme sonrası aynı diziyi üretir. */
export function random(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------- takvim

export function minuteOfDay(minute: number): number {
  return ((minute % TIME.minutesPerDay) + TIME.minutesPerDay) % TIME.minutesPerDay;
}

export function dayIndex(minute: number): number {
  return Math.floor(minute / TIME.minutesPerDay);
}

export function yearIndex(minute: number): number {
  return Math.floor(dayIndex(minute) / TIME.daysPerYear);
}

export function monthIndex(minute: number): number {
  return dayIndex(minute) % TIME.daysPerYear;
}

export function inService(minute: number, night: boolean): boolean {
  if (night) return true;
  const m = minuteOfDay(minute);
  return m >= TIME.serviceStartMin && m < TIME.serviceEndMin;
}
