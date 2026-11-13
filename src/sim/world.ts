/**
 * Dünya: şehir paketinden türetilen, kaydedilmeyen statik veri ve önbellekler
 * (kıyı indeksi, su ızgarası, rotalar, hücre havzaları). GameState ile birlikte kullanılır.
 */
import { NAV, PIER, TERSANE } from '../config/balance.ts';
import { buildCoastIndex, snapToCoast, waterSideOffset, type CoastIndex, type LngLat, type PolygonCoords } from '../geo/geo.ts';
import { buildWaterGrid, landComponentAt, type WaterGrid } from '../nav/grid.ts';
import { RouteCache, type Route } from '../nav/route.ts';
import type { HistoricPier, Place } from './piers.ts';
import type { GameState, Line, Pier, Side } from './types.ts';

export type BBox = [west: number, south: number, east: number, north: number];

export interface NoBuildZone {
  id: string;
  name: string;
  polygon: PolygonCoords;
}

export interface Zone {
  id: string;
  name: string;
  polygon: PolygonCoords;
}

export interface Station {
  name: string;
  kind: string;
  lat: number;
  lng: number;
}

export interface CellData {
  /** H3 hücre kimlikleri. */
  h: string[];
  lat: number[];
  lng: number[];
  pop: number[];
  att: number[];
}

/** Şehir paketinin saf veri kısmı (tarayıcıda fetch, testte dosyadan okunur). */
export interface CityData {
  bbox: BBox;
  coastLines: LngLat[][];
  waterPolygons: PolygonCoords[];
  noBuildZones: NoBuildZone[];
  zones: Zone[];
  historic: HistoricPier[];
  places: Place[];
  stations: Station[];
  cells: CellData | null;
}

export interface HistoricSite {
  id: string;
  name: string;
  area: string;
  coast: LngLat;
  dock: LngLat;
  snapDistanceM: number;
}

export interface World {
  data: CityData;
  coast: CoastIndex;
  grid: WaterGrid;
  routes: RouteCache;
  historic: HistoricSite[];
  comps: { avrupa: number; anadolu: number };
  tersane: { coast: LngLat; dock: LngLat };
  /** Tarihi iskele uyarıları (kıyıdan uzak koordinatlar). */
  warnings: string[];
  /** Hücre ↔ kara bileşeni (cells varsa). */
  cellComp: Int32Array | null;
  /** İskele havzası önbelleği: pierId → hücre indeksleri ve ağırlıklar. */
  catchments: Map<string, { cells: number[]; weights: number[]; pop: number; att: number }>;
}

export function createWorld(data: CityData): World {
  const coast = buildCoastIndex(data.coastLines);
  const grid = buildWaterGrid(data.waterPolygons, data.bbox, NAV.cellM);
  const warnings: string[] = [];
  const historic: HistoricSite[] = [];
  for (const h of data.historic) {
    const snap = snapToCoast(coast, [h.lng, h.lat]);
    if (!snap) {
      warnings.push(`[tarihi iskele] ${h.name}: kıyı bulunamadı, atlandı.`);
      continue;
    }
    if (snap.distanceM > PIER.historicWarnDistanceM) {
      warnings.push(
        `[tarihi iskele] ${h.name} kıyıdan ${Math.round(snap.distanceM)} m uzakta (sınır ${PIER.historicWarnDistanceM} m). ` +
          `Kıyı noktası: ${snap.point[1].toFixed(5)}, ${snap.point[0].toFixed(5)}`,
      );
    }
    historic.push({ id: h.id, name: h.name, area: h.area, coast: snap.point, dock: waterSideOffset(snap, PIER.dockOffsetM), snapDistanceM: snap.distanceM });
  }
  const compOf = (id: string) => {
    const h = historic.find((x) => x.id === id);
    return h ? landComponentAt(grid, h.coast) : -1;
  };
  const tSnap = snapToCoast(coast, [TERSANE.lng, TERSANE.lat])!;
  let cellComp: Int32Array | null = null;
  if (data.cells) {
    cellComp = new Int32Array(data.cells.h.length);
    for (let i = 0; i < cellComp.length; i++) cellComp[i] = landComponentAt(grid, [data.cells.lng[i]!, data.cells.lat[i]!], 2);
  }
  return {
    data,
    coast,
    grid,
    routes: new RouteCache(grid),
    historic,
    comps: { avrupa: compOf('eminonu'), anadolu: compOf('kadikoy') },
    tersane: { coast: tSnap.point, dock: waterSideOffset(tSnap, PIER.dockOffsetM) },
    warnings,
    cellComp,
    catchments: new Map(),
  };
}

export function sideOfComp(world: World, comp: number): Side {
  if (comp === world.comps.avrupa) return 'avrupa';
  if (comp === world.comps.anadolu) return 'anadolu';
  return 'ada';
}

// ---------------------------------------------------------------- hat bacakları

/** n iskeleli hatta 2(n-1) bacak: önce ileri (0→n-1), sonra geri. */
export function legCount(line: Line): number {
  return 2 * (line.pierIds.length - 1);
}

export function legEnds(line: Line, leg: number): { from: number; to: number; dir: 1 | -1 } {
  const n = line.pierIds.length;
  if (leg < n - 1) return { from: leg, to: leg + 1, dir: 1 };
  const from = 2 * (n - 1) - leg;
  return { from, to: from - 1, dir: -1 };
}

/** Bu iskeleden kalkan terminal bacağı (0: baştan ileri, n-1: sondan geri). */
export function isTerminalIndex(line: Line, idx: number): boolean {
  return idx === 0 || idx === line.pierIds.length - 1;
}

export function pierById(state: GameState, id: string): Pier | undefined {
  return state.piers.find((p) => p.id === id);
}

export function legRoute(world: World, state: GameState, line: Line, leg: number): Route | null {
  const { from, to } = legEnds(line, leg);
  const a = pierById(state, line.pierIds[from]!);
  const b = pierById(state, line.pierIds[to]!);
  if (!a || !b) return null;
  return world.routes.get(a.id, a.dock, b.id, b.dock);
}
