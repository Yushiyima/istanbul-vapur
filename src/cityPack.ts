/**
 * Şehir paketi: /data altındaki işlenmiş veriler. Büyük GeoJSON'lar URL olarak paketlenir ve
 * çalışma anında indirilir; küçük JSON'lar doğrudan import edilir.
 */
import historicJson from '../data/historic_piers.json';
import placesJson from '../data/places.json';
import regionJson from '../data/region.json';
import waterUrl from '../data/water.geojson?url';
import coastlineUrl from '../data/coastline.geojson?url';
import noBuildUrl from '../data/no_build.geojson?url';
import type { FeatureCollection } from 'geojson';
import type { LngLat, PolygonCoords } from './geo/geo.ts';
import type { HistoricPier, Place } from './sim/piers.ts';

export type BBox = [west: number, south: number, east: number, north: number];

export interface NoBuildZone {
  id: string;
  name: string;
  polygon: PolygonCoords;
}

export interface CityPack {
  bbox: BBox;
  water: FeatureCollection;
  coastline: FeatureCollection;
  coastLines: LngLat[][];
  noBuild: FeatureCollection;
  noBuildZones: NoBuildZone[];
  historic: HistoricPier[];
  places: Place[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} yüklenemedi (HTTP ${res.status})`);
  return (await res.json()) as T;
}

export async function loadCityPack(): Promise<CityPack> {
  const [water, coastline, noBuild] = await Promise.all([
    fetchJson<FeatureCollection>(waterUrl),
    fetchJson<FeatureCollection>(coastlineUrl),
    fetchJson<FeatureCollection>(noBuildUrl),
  ]);

  const coastLines: LngLat[][] = [];
  for (const f of coastline.features) {
    if (f.geometry.type === 'LineString') coastLines.push(f.geometry.coordinates as LngLat[]);
    else if (f.geometry.type === 'MultiLineString') coastLines.push(...(f.geometry.coordinates as LngLat[][]));
  }

  const noBuildZones: NoBuildZone[] = [];
  for (const f of noBuild.features) {
    const id = String(f.properties?.id ?? noBuildZones.length);
    const name = String(f.properties?.name ?? 'Yasak bölge');
    if (f.geometry.type === 'Polygon') noBuildZones.push({ id, name, polygon: f.geometry.coordinates as PolygonCoords });
    else if (f.geometry.type === 'MultiPolygon') {
      for (const polygon of f.geometry.coordinates as PolygonCoords[]) noBuildZones.push({ id, name, polygon });
    }
  }

  return {
    bbox: regionJson.bbox as BBox,
    water,
    coastline,
    coastLines,
    noBuild,
    noBuildZones,
    historic: historicJson.piers as HistoricPier[],
    places: placesJson.places as Place[],
  };
}
