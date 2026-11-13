#!/usr/bin/env node
/**
 * Nüfus, çekim ve raylı istasyon verisi.
 *
 *   node scripts/build-cells.mjs            # data/raw/ önbelleği varsa onu kullanır
 *   node scripts/build-cells.mjs --refresh  # Overpass sorgularını yeniler
 *
 * Girdi : data/region.json
 *         data/raw/ghs/GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0_R5_C21.tif
 *           (yoksa JRC'den indirilir: ~120 MB zip)
 * Ham   : data/raw/pois-*.json, data/raw/stations-osm.json   (gitignore)
 * Çıktı : data/cells.json     H3 r9 hücreleri: h, lat, lng, pop, att
 *         data/stations.json  metro / hafif raylı / banliyö / Marmaray istasyonları
 *
 * pop = GHS-POP 2025 tahmini (3 açısaniye ≈ 90 m pikseller hücre merkezine göre toplanır).
 * att = 0,3 × pop + Σ ağırlık × OSM yeri (ofis, okul, hastane, dükkân, müze …).
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromFile } from 'geotiff';
import { cellToLatLng, latLngToCell } from 'h3-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');
const GHS_DIR = path.join(RAW, 'ghs');
const GHS_TILE = 'GHS_POP_E2025_GLOBE_R2023A_4326_3ss_V1_0_R5_C21';
const GHS_URL = `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_3ss/V1-0/tiles/${GHS_TILE}.zip`;
const H3_RES = 9;
const USER_AGENT = 'istanbul-vapur-datascript/0.1 (+https://github.com/Yushiyima/istanbul-vapur)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** OSM yer kategorileri ve çekim ağırlıkları. */
const POI_QUERIES = [
  { key: 'office', weight: 6, q: 'nwr["office"]' },
  { key: 'education', weight: 25, q: 'nwr["amenity"~"^(school|university|college)$"]' },
  { key: 'health', weight: 20, q: 'nwr["amenity"~"^(hospital|clinic)$"]' },
  { key: 'civic', weight: 10, q: 'nwr["amenity"~"^(townhall|courthouse|library|theatre|cinema|marketplace|bank)$"]' },
  { key: 'food', weight: 2, q: 'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub)$"]' },
  { key: 'shop', weight: 2, q: 'nwr["shop"]' },
  { key: 'tourism', weight: 12, q: 'nwr["tourism"~"^(museum|attraction|hotel|viewpoint)$"]' },
];
const ATT_POP_SHARE = 0.3;

const refresh = process.argv.includes('--refresh');
const region = JSON.parse(await fs.readFile(path.join(DATA, 'region.json'), 'utf8'));
const [W, S, E, N] = region.bbox;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- indirme

async function overpass(query, label, rounds = 6) {
  let wait = 10_000;
  for (let round = 1; round <= rounds; round++) {
    for (const url of ENDPOINTS) {
      const host = new URL(url).host;
      try {
        console.log(`  ${label}: ${host} (tur ${round})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(150_000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = JSON.parse(text);
        if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark);
        return json;
      } catch (err) {
        console.warn(`  ${label}: ${host} başarısız (${String(err.message).slice(0, 80)})`);
      }
    }
    if (round === rounds) break;
    console.log(`  ${wait / 1000} sn bekleniyor...`);
    await sleep(wait);
    wait = Math.min(wait * 2, 180_000);
  }
  throw new Error(`${label}: tüm Overpass sunucuları başarısız`);
}

async function cached(file, query, label, rounds) {
  const full = path.join(RAW, file);
  if (!refresh && existsSync(full)) {
    console.log(`${label}: önbellekten`);
    return JSON.parse(await fs.readFile(full, 'utf8'));
  }
  console.log(`${label}: Overpass'tan indiriliyor...`);
  const json = await overpass(query, label, rounds);
  await fs.mkdir(RAW, { recursive: true });
  await fs.writeFile(full, JSON.stringify(json));
  return json;
}

async function ensureGhs() {
  const tif = path.join(GHS_DIR, `${GHS_TILE}.tif`);
  if (existsSync(tif)) return tif;
  await fs.mkdir(GHS_DIR, { recursive: true });
  const zip = path.join(GHS_DIR, `${GHS_TILE}.zip`);
  if (!existsSync(zip)) {
    console.log(`GHS-POP indiriliyor (~120 MB): ${GHS_URL}`);
    const res = await fetch(GHS_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`GHS-POP indirilemedi: HTTP ${res.status}`);
    await fs.writeFile(zip, Buffer.from(await res.arrayBuffer()));
  }
  console.log('GHS-POP açılıyor...');
  // Windows 10+ ve macOS'taki bsdtar zip açabilir; olmazsa unzip dene.
  const tarBin = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar';
  try {
    execFileSync(tarBin, ['-xf', zip, '-C', GHS_DIR], { stdio: 'inherit' });
  } catch {
    execFileSync('unzip', ['-o', zip, '-d', GHS_DIR], { stdio: 'inherit' });
  }
  if (!existsSync(tif)) throw new Error(`${tif} bulunamadı`);
  return tif;
}

// ---------------------------------------------------------------- nüfus

async function readPopulation() {
  const tif = await ensureGhs();
  const tiff = await fromFile(tif);
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution(); // ry negatif
  const nodata = image.getGDALNoData();
  const x0 = Math.floor((W - ox) / rx), x1 = Math.ceil((E - ox) / rx);
  const y0 = Math.floor((N - oy) / ry), y1 = Math.ceil((S - oy) / ry);
  console.log(`GHS-POP penceresi: ${x1 - x0} × ${y1 - y0} piksel (${rx.toFixed(6)}°)`);
  const [band] = await image.readRasters({ window: [x0, y0, x1, y1] });
  const width = x1 - x0;
  const pop = new Map();
  let total = 0;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if (!(v > 0) || v === nodata) continue;
    const px = i % width, py = (i / width) | 0;
    const lng = ox + (x0 + px + 0.5) * rx;
    const lat = oy + (y0 + py + 0.5) * ry;
    if (lng < W || lng > E || lat < S || lat > N) continue;
    const h = latLngToCell(lat, lng, H3_RES);
    pop.set(h, (pop.get(h) ?? 0) + v);
    total += v;
  }
  console.log(`Nüfus: ${Math.round(total).toLocaleString('tr-TR')} kişi, ${pop.size} hücre`);
  return pop;
}

// ---------------------------------------------------------------- çekim ve istasyonlar

const bboxQ = `(${S},${W},${N},${E})`;

/** Bbox'u nx × ny parçaya böler (ağır sorgular için). */
function tiles(nx, ny) {
  const out = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const w = W + ((E - W) * i) / nx, e = W + ((E - W) * (i + 1)) / nx;
      const s = S + ((N - S) * j) / ny, n = S + ((N - S) * (j + 1)) / ny;
      out.push({ id: `${i}${j}`, q: `(${s},${w},${n},${e})` });
    }
  }
  return out;
}

async function readPois() {
  const score = new Map();
  for (const c of POI_QUERIES) {
    // Dükkân sorgusu çok yoğun: 2×3 parçada sorgula.
    const parts = c.key === 'shop' ? tiles(2, 3) : [{ id: '', q: bboxQ }];
    let n = 0, failed = 0;
    for (const part of parts) {
      const file = `pois-${c.key}${part.id ? '-' + part.id : ''}.json`;
      let json;
      try {
        json = await cached(file, `[out:json][timeout:120];${c.q}${part.q};out ids center qt;`, `OSM ${c.key}${part.id ? ' ' + part.id : ''}`, 3);
      } catch (err) {
        console.warn(`  UYARI: ${c.key} ${part.id} atlandı (${err.message}). Çekim bu kategoride eksik kalır; sonra tekrar çalıştır.`);
        failed++;
        continue;
      }
      for (const e of json.elements) {
        const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
        if (lat == null) continue;
        const h = latLngToCell(lat, lng, H3_RES);
        score.set(h, (score.get(h) ?? 0) + c.weight);
        n++;
      }
    }
    console.log(`  ${c.key}: ${n} yer${failed ? ` (${failed} parça eksik)` : ''}`);
  }
  return score;
}

async function readStations() {
  const q =
    `[out:json][timeout:180];(` +
    `nwr["railway"="station"]${bboxQ};` +
    `nwr["public_transport"="station"]["subway"="yes"]${bboxQ};` +
    `nwr["public_transport"="station"]["light_rail"="yes"]${bboxQ};` +
    `nwr["railway"="halt"]${bboxQ};` +
    `);out center tags;`;
  const json = await cached('stations-osm.json', q, 'İstasyonlar');
  const out = [];
  const seen = new Set();
  for (const e of json.elements) {
    const t = e.tags ?? {};
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    const name = t['name:tr'] ?? t.name;
    if (lat == null || !name) continue;
    if (t.station === 'funicular' || t.railway === 'tram_stop' || t.station === 'monorail') continue;
    const net = `${t.network ?? ''} ${t.operator ?? ''} ${t.line ?? ''} ${name}`.toLowerCase();
    const kind = /marmaray/.test(net) ? 'marmaray' : t.station === 'subway' || t.subway === 'yes' ? 'metro' : t.station === 'light_rail' || t.light_rail === 'yes' ? 'hafif-rayli' : 'banliyo';
    const key = `${name}|${Math.round(lat * 500)}|${Math.round(lng * 500)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, kind, lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return out;
}

// ---------------------------------------------------------------- ana akış

const pop = await readPopulation();
const pois = await readPois();
const stations = await readStations();

const ids = [...new Set([...pop.keys(), ...pois.keys()])].sort();
const cells = { h: [], lat: [], lng: [], pop: [], att: [] };
let attTotal = 0;
for (const h of ids) {
  const [lat, lng] = cellToLatLng(h);
  if (lng < W || lng > E || lat < S || lat > N) continue;
  const p = pop.get(h) ?? 0;
  const a = ATT_POP_SHARE * p + (pois.get(h) ?? 0) * 25;
  if (p < 1 && a < 1) continue;
  cells.h.push(h);
  cells.lat.push(+lat.toFixed(5));
  cells.lng.push(+lng.toFixed(5));
  cells.pop.push(Math.round(p));
  cells.att.push(Math.round(a));
  attTotal += a;
}

const meta = {
  source: 'GHS-POP R2023A (E2025, 3ss) © Avrupa Komisyonu JRC; çekim: © OpenStreetMap katkıcıları',
  h3Resolution: H3_RES,
  bbox: region.bbox,
};
await fs.writeFile(path.join(DATA, 'cells.json'), JSON.stringify({ ...meta, ...cells }));
await fs.writeFile(path.join(DATA, 'stations.json'), JSON.stringify({ source: '© OpenStreetMap katkıcıları', stations }, null, 0));
const popTotal = cells.pop.reduce((s, v) => s + v, 0);
console.log(
  `Tamam: ${cells.h.length} hücre · nüfus ${popTotal.toLocaleString('tr-TR')} · çekim ${Math.round(attTotal).toLocaleString('tr-TR')} · ${stations.length} istasyon ` +
    `(${['metro', 'marmaray', 'hafif-rayli', 'banliyo'].map((k) => `${k} ${stations.filter((s) => s.kind === k).length}`).join(', ')})`,
);
