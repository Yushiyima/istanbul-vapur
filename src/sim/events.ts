/** Olaylar (Aşama 4): hava, akıntı, tanker. Şimdilik etkisiz. */
import type { Route } from '../nav/route.ts';
import type { GameState, Line } from './types.ts';
import type { World } from './world.ts';

export function updateEvents(_state: GameState, _world: World): void {}

/** Hız çarpanı (akıntı, sis). */
export function speedFactor(_state: GameState, _world: World, _route: Route, _dist: number): number {
  return 1;
}

/** Bu bacakta kalkış serbest mi (lodos/poyraz iptali, tanker geçişi). */
export function canDepart(_state: GameState, _world: World, _line: Line, _leg: number): boolean {
  return true;
}
