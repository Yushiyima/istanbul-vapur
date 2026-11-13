/** Yolcu ve ekonomi (Aşama 3). Şimdilik sadece gün devri. */
import { TIME } from '../config/balance.ts';
import { emptyDay } from './state.ts';
import type { GameState, Line, Pier, Ship } from './types.ts';
import type { World } from './world.ts';

export function generateDemand(_state: GameState, _world: World): void {}

export function alightAt(_state: GameState, _world: World, ship: Ship, _pier: Pier): void {
  ship.onboard = [];
}

export function boardAt(_state: GameState, _world: World, _ship: Ship, _line: Line, _pier: Pier): void {}

export function updateEconomyAndSatisfaction(state: GameState, _world: World): void {
  if (state.minute % TIME.minutesPerDay === 0) {
    state.yesterday = state.today;
    state.today = emptyDay();
  }
}
