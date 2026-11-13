/**
 * İskele havzası: 800 m yürüme yarıçapındaki, iskeleyle aynı kara bileşenindeki H3 hücreleri.
 * Karşı kıyı (Boğaz'ın dar yerleri) ve deniz havzaya girmez.
 */
import { DEMAND, PIER } from '../config/balance.ts';
import { haversineM, mPerDegLng, type LngLat } from '../geo/geo.ts';
import type { Pier } from './types.ts';
import type { World } from './world.ts';

export interface Catchment {
  cells: number[];
  weights: number[];
  pop: number;
  att: number;
}

export function computeCatchment(world: World, coast: LngLat, comp: number): Catchment {
  const cells = world.data.cells;
  const out: Catchment = { cells: [], weights: [], pop: 0, att: 0 };
  if (!cells || !world.cellComp) return out;
  const R = PIER.coverageRadiusM;
  const dLat = R / 110_574;
  const dLng = R / mPerDegLng(coast[1]);
  for (let i = 0; i < cells.h.length; i++) {
    const lat = cells.lat[i]!, lng = cells.lng[i]!;
    if (Math.abs(lat - coast[1]) > dLat || Math.abs(lng - coast[0]) > dLng) continue;
    if (world.cellComp[i] !== comp) continue;
    const d = haversineM(coast, [lng, lat]);
    if (d > R) continue;
    const w = 1 - DEMAND.walkDecay * (d / R);
    out.cells.push(i);
    out.weights.push(w);
    out.pop += cells.pop[i]! * w;
    out.att += cells.att[i]! * w;
  }
  return out;
}

export function catchmentOf(world: World, pier: Pier): Catchment {
  let c = world.catchments.get(pier.id);
  if (!c) {
    c = computeCatchment(world, pier.coast, pier.comp);
    world.catchments.set(pier.id, c);
  }
  return c;
}

/** Kapsanan nüfus (hücre başına bir kez sayılır) ve toplam nüfus. */
export function coveredPopulation(world: World, piers: readonly Pier[]): { covered: number; total: number } {
  const cells = world.data.cells;
  if (!cells) return { covered: 0, total: 0 };
  const seen = new Set<number>();
  let covered = 0;
  for (const p of piers) {
    for (const i of catchmentOf(world, p).cells) {
      if (seen.has(i)) continue;
      seen.add(i);
      covered += cells.pop[i]!;
    }
  }
  let total = 0;
  for (const v of cells.pop) total += v;
  return { covered, total };
}
