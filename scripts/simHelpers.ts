export { buyShip, createLine } from '../src/sim/network.ts';
import { dailyRunningCost } from '../src/sim/passengers.ts';
import type { GameState } from '../src/sim/types.ts';
export const dailyRunningCostSafe = (s: GameState) => dailyRunningCost(s);
