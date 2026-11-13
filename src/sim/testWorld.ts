/** Sadece testler için: data/ klasöründen CityData okur (Node). */
import { existsSync, readFileSync } from 'node:fs';
import type { LngLat, PolygonCoords } from '../geo/geo.ts';
import { evaluatePlacement } from './piers.ts';
import { addPier } from './network.ts';
import type { GameState, Pier } from './types.ts';
import { createWorld, type CityData, type World } from './world.ts';

const file = (f: string) => new URL(`../../data/${f}`, import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(file(f), 'utf8'));

let cached: World | null = null;

export function loadTestData(): CityData {
  const fc = (f: string) => (existsSync(file(f)) ? read(f) : { features: [] });
  return {
    bbox: read('region.json').bbox,
    coastLines: read('coastline.geojson').features.flatMap((f: { geometry: { coordinates: LngLat[][] } }) => f.geometry.coordinates),
    waterPolygons: read('water.geojson').features[0].geometry.coordinates as PolygonCoords[],
    barriers: fc('breakwaters.geojson').features.flatMap((f: { geometry: { coordinates: LngLat[][] } }) => f.geometry.coordinates),
    noBuildZones: fc('no_build.geojson').features.map((f: { properties: { id: string; name: string }; geometry: { coordinates: PolygonCoords } }) => ({
      id: f.properties.id,
      name: f.properties.name,
      polygon: f.geometry.coordinates,
    })),
    zones: fc('zones.geojson').features.map((f: { properties: { id: string; name: string }; geometry: { coordinates: PolygonCoords } }) => ({
      id: f.properties.id,
      name: f.properties.name,
      polygon: f.geometry.coordinates,
    })),
    historic: read('historic_piers.json').piers,
    places: read('places.json').places,
    stations: existsSync(file('stations.json')) ? read('stations.json').stations : [],
    cells: existsSync(file('cells.json')) ? read('cells.json') : null,
  };
}

/** Test dünyası (bir kez kurulur, testler arasında paylaşılır). */
export function testWorld(): World {
  cached ??= createWorld(loadTestData());
  return cached;
}

/** Tarihi iskelenin yerine bedava iskele kurar. */
export function placeHistoric(state: GameState, world: World, id: string): Pier {
  const h = world.data.historic.find((x) => x.id === id)!;
  const r = evaluatePlacement([h.lng, h.lat], { coast: world.coast, piers: state.piers, noBuild: [] });
  if (!r.ok) throw new Error(`${id}: ${r.message}`);
  const res = addPier(state, world, { name: h.name, coast: r.coast, dock: r.dock, historicId: h.id }, { free: true });
  if (!res.ok) throw new Error(res.message);
  return res.value;
}
