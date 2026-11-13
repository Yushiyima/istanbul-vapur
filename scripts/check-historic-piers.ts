/**
 * data/historic_piers.json koordinatlarını kıyıya yapıştırıp mesafeleri listeler.
 *   node scripts/check-historic-piers.ts
 * Node 22.18+ / 24 TypeScript tiplerini kendisi siler; ek araç gerekmez.
 */
import fs from 'node:fs';
import { buildCoastIndex, snapToCoast, type LngLat } from '../src/geo/geo.ts';
import { PIER } from '../src/config/balance.ts';

const read = (f: string) => JSON.parse(fs.readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
const coast = read('coastline.geojson');
const piers: { id: string; name: string; lat: number; lng: number }[] = read('historic_piers.json').piers;

const index = buildCoastIndex(coast.features.flatMap((f: { geometry: { coordinates: LngLat[][] } }) => f.geometry.coordinates));
let far = 0;
for (const p of piers) {
  const snap = snapToCoast(index, [p.lng, p.lat]);
  const d = snap ? snap.distanceM : Infinity;
  const flag = d > PIER.historicWarnDistanceM ? '  <-- UZAK' : '';
  if (flag) far++;
  const at = snap ? `${snap.point[1].toFixed(5)}, ${snap.point[0].toFixed(5)}` : '-';
  console.log(`${p.name.padEnd(16)} ${String(Math.round(d)).padStart(6)} m   kıyı: ${at}${flag}`);
}
console.log(far ? `\n${far} iskele kıyıdan ${PIER.historicWarnDistanceM} m'den uzak.` : '\nHepsi kıyıya yakın.');
process.exitCode = far ? 1 : 0;
