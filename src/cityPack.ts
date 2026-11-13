/**
 * Şehir paketi: /data altındaki işlenmiş veriler. Büyük dosyalar URL olarak paketlenir ve
 * çalışma anında indirilir; küçük JSON'lar doğrudan import edilir.
 */
import type { FeatureCollection } from 'geojson';
import historicJson from '../data/historic_piers.json';
import placesJson from '../data/places.json';
import regionJson from '../data/region.json';
import waterUrl from '../data/water.geojson?url';
import coastlineUrl from '../data/coastline.geojson?url';
import noBuildUrl from '../data/no_build.geojson?url';
import type { LngLat, PolygonCoords } from './geo/geo.ts';
import type { HistoricPier, Place } from './sim/piers.ts';
import type { BBox, CellData, CityData, NoBuildZone, Station, Zone } from './sim/world.ts';

/** İsteğe bağlı veri dosyaları (veri scripti çalışmadıysa yoktur). */
const optional = import.meta.glob<string>(['../data/zones.geojson', '../data/stations.json', '../data/cells.json', '../data/breakwaters.geojson'], {
  query: '?url',
  import: 'default',
  eager: true,
});

export interface CityPack {
  data: CityData;
  water: FeatureCollection;
  coastline: FeatureCollection;
  noBuild: FeatureCollection;
  zones: FeatureCollection;
  breakwaters: FeatureCollection;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} yüklenemedi (HTTP ${res.status})`);
  return (await res.json()) as T;
}

async function fetchOptional<T>(path: string, fallback: T): Promise<T> {
  const url = optional[path];
  return url ? fetchJson<T>(url) : fallback;
}

function polygons<T extends { id: string; name: string; polygon: PolygonCoords }>(fc: FeatureCollection): T[] {
  const out: T[] = [];
  for (const f of fc.features) {
    const id = String(f.properties?.id ?? out.length);
    const name = String(f.properties?.name ?? id);
    if (f.geometry.type === 'Polygon') out.push({ id, name, polygon: f.geometry.coordinates as PolygonCoords } as T);
    else if (f.geometry.type === 'MultiPolygon') {
      for (const polygon of f.geometry.coordinates as PolygonCoords[]) out.push({ id, name, polygon } as T);
    }
  }
  return out;
}

export async function loadCityPack(): Promise<CityPack> {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const [water, coastline, noBuild, zones, stations, cells, breakwaters] = await Promise.all([
    fetchJson<FeatureCollection>(waterUrl),
    fetchJson<FeatureCollection>(coastlineUrl),
    fetchJson<FeatureCollection>(noBuildUrl),
    fetchOptional<FeatureCollection>('../data/zones.geojson', empty),
    fetchOptional<{ stations: Station[] }>('../data/stations.json', { stations: [] }),
    fetchOptional<CellData | null>('../data/cells.json', null),
    fetchOptional<FeatureCollection>('../data/breakwaters.geojson', empty),
  ]);
  const barriers: LngLat[][] = [];
  for (const f of breakwaters.features) {
    if (f.geometry.type === 'LineString') barriers.push(f.geometry.coordinates as LngLat[]);
    else if (f.geometry.type === 'MultiLineString') barriers.push(...(f.geometry.coordinates as LngLat[][]));
  }

  const coastLines: LngLat[][] = [];
  for (const f of coastline.features) {
    if (f.geometry.type === 'LineString') coastLines.push(f.geometry.coordinates as LngLat[]);
    else if (f.geometry.type === 'MultiLineString') coastLines.push(...(f.geometry.coordinates as LngLat[][]));
  }
  const waterPolygons: PolygonCoords[] = [];
  for (const f of water.features) {
    if (f.geometry.type === 'Polygon') waterPolygons.push(f.geometry.coordinates as PolygonCoords);
    else if (f.geometry.type === 'MultiPolygon') waterPolygons.push(...(f.geometry.coordinates as PolygonCoords[]));
  }

  const data: CityData = {
    bbox: regionJson.bbox as BBox,
    coastLines,
    waterPolygons,
    barriers,
    noBuildZones: polygons<NoBuildZone>(noBuild),
    zones: polygons<Zone>(zones),
    historic: historicJson.piers as HistoricPier[],
    places: placesJson.places as Place[],
    stations: stations.stations,
    cells,
  };
  return { data, water, coastline, noBuild, zones, breakwaters };
}
