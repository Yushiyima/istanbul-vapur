#!/usr/bin/env node
/**
 * OSM'den kıyı çizgisi, su poligonu ve yer adlarını hazırlar.
 *
 *   node scripts/build-coast.mjs            # data/raw/ önbelleği varsa onu kullanır
 *   node scripts/build-coast.mjs --refresh  # Overpass'tan yeniden indirir
 *
 * Girdi : data/region.json (bbox)
 * Ham   : data/raw/coastline-osm.json, data/raw/places-osm.json   (gitignore)
 * Çıktı : data/coastline.geojson, data/water.geojson, data/places.json
 *
 * Yöntem: natural=coastline yolları birleştirilir (OSM kuralı: kara solda, su sağda), bbox'a
 * kırpılır, kırpılan parçalar bbox kenarı boyunca saat yönünün tersine kapatılarak kara
 * poligonları kurulur. Su = bbox − kara.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import polygonClipping from 'polygon-clipping';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const RAW = path.join(DATA, 'raw');

const region = JSON.parse(await fs.readFile(path.join(DATA, 'region.json'), 'utf8'));
const [W, S, E, N] = region.bbox;

/** Kıyı yolları bbox'tan biraz geniş indirilir ki zincirler bbox dışına taşsın. */
const FETCH_PAD_DEG = 0.08;
/** Douglas–Peucker toleransı (metre). */
const SIMPLIFY_TOLERANCE_M = 4;
/** Bundan küçük adacıklar (m²) atılır. */
const MIN_ISLAND_AREA_M2 = 150;
const MAX_ROUNDS = 7;
const USER_AGENT = 'istanbul-vapur-datascript/0.1 (+https://github.com/Yushiyima/istanbul-vapur)';
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const refresh = process.argv.includes('--refresh');

// ---------------------------------------------------------------- indirme

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query, label) {
  let wait = 10_000;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const url of ENDPOINTS) {
      const host = new URL(url).host;
      try {
        console.log(`  ${label}: ${host} (tur ${round})`);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(300_000),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = JSON.parse(text);
        if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark);
        return json;
      } catch (err) {
        console.warn(`  ${label}: ${host} başarısız (${err.message.slice(0, 80)})`);
      }
    }
    if (round < MAX_ROUNDS) {
      console.log(`  ${wait / 1000} sn bekleniyor...`);
      await sleep(wait);
      wait = Math.min(wait * 2, 180_000);
    }
  }
  throw new Error(`${label}: tüm Overpass sunucuları başarısız`);
}

async function cached(file, query, label) {
  const full = path.join(RAW, file);
  if (!refresh) {
    try {
      const json = JSON.parse(await fs.readFile(full, 'utf8'));
      console.log(`${label}: önbellekten (${path.relative(ROOT, full)})`);
      return json;
    } catch {
      /* indir */
    }
  }
  console.log(`${label}: Overpass'tan indiriliyor...`);
  const json = await overpass(query, label);
  await fs.mkdir(RAW, { recursive: true });
  await fs.writeFile(full, JSON.stringify(json));
  return json;
}

// ---------------------------------------------------------------- geometri

const LAT0 = ((S + N) / 2) * (Math.PI / 180);
const KX = 111_320 * Math.cos(LAT0);
const KY = 110_574;

function signedAreaM2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * KX) * (ring[i][1] * KY) - (ring[i][0] * KX) * (ring[j][1] * KY);
  }
  return a / 2;
}

/** Douglas–Peucker, metre cinsinden tolerans, uç noktalar korunur. */
function simplify(coords, tol) {
  if (coords.length <= 2) return coords;
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = coords[a][0] * KX, ay = coords[a][1] * KY;
    const bx = coords[b][0] * KX, by = coords[b][1] * KY;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = coords[i][0] * KX, py = coords[i][1] * KY;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

const inside = ([x, y]) => x > W && x < E && y > S && y < N;

/** Liang–Barsky: segmentin bbox içindeki [t0, t1] aralığı veya null. */
function clipSegment(p, q) {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  const checks = [[-dx, p[0] - W], [dx, E - p[0]], [-dy, p[1] - S], [dy, N - p[1]]];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
    } else {
      const r = qq / pp;
      if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return t0 < t1 ? [t0, t1] : null;
}

const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];

/** Çizgiyi bbox'a kırpar; her parça için kenardan girip kenardan çıkıp çıkmadığını işaretler. */
function clipLine(coords) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i < coords.length - 1; i++) {
    const p = coords[i], q = coords[i + 1];
    const c = clipSegment(p, q);
    if (!c) {
      if (cur) { cur.endsOnEdge = false; pieces.push(cur); cur = null; }
      continue;
    }
    if (!cur) cur = { coords: [lerp(p, q, c[0])], startsOnEdge: c[0] > 0 || !inside(p) };
    cur.coords.push(lerp(p, q, c[1]));
    if (c[1] < 1) { cur.endsOnEdge = true; pieces.push(cur); cur = null; }
  }
  if (cur) { cur.endsOnEdge = !inside(coords[coords.length - 1]); pieces.push(cur); }
  return pieces.filter((p) => p.coords.length >= 2);
}

// bbox çevresi, SW köşesinden saat yönünün tersine (x sağa, y yukarı) parametre
const BW = E - W, BH = N - S, PER = 2 * (BW + BH);
const CORNERS = [
  { t: 0, c: [W, S] },
  { t: BW, c: [E, S] },
  { t: BW + BH, c: [E, N] },
  { t: 2 * BW + BH, c: [W, N] },
];
function perimeterParam([x, y]) {
  const d = [Math.abs(y - S), Math.abs(x - E), Math.abs(y - N), Math.abs(x - W)];
  const edge = d.indexOf(Math.min(...d));
  if (edge === 0) return x - W;
  if (edge === 1) return BW + (y - S);
  if (edge === 2) return BW + BH + (E - x);
  return 2 * BW + BH + (N - y);
}

/** Kenar boyunca `from`'dan `dist` kadar CCW yürürken geçilen köşeler. */
function cornersAlong(from, dist) {
  return CORNERS.map((k) => {
    let d = k.t - from;
    if (d <= 0) d += PER;
    return { d, c: k.c };
  })
    .filter((k) => k.d < dist)
    .sort((a, b) => a.d - b.d)
    .map((k) => k.c);
}

/** Kırpılmış kıyı parçalarını bbox kenarıyla kapatarak kara halkaları üretir. */
function closePieces(pieces) {
  const items = pieces.map((p) => ({
    coords: p.coords,
    entry: perimeterParam(p.coords[0]),
    exit: perimeterParam(p.coords[p.coords.length - 1]),
    used: false,
  }));
  const rings = [];
  for (const start of items) {
    if (start.used) continue;
    start.used = true;
    const ring = [...start.coords];
    let cur = start;
    for (let guard = 0; guard <= items.length; guard++) {
      let best = null, bestD = Infinity;
      for (const it of items) {
        if (it.used && it !== start) continue;
        let d = it.entry - cur.exit;
        if (d < 0) d += PER;
        if (d < bestD) { bestD = d; best = it; }
      }
      ring.push(...cornersAlong(cur.exit, bestD));
      if (best === start) { ring.push(start.coords[0]); break; }
      best.used = true;
      ring.push(...best.coords);
      cur = best;
    }
    rings.push(ring);
  }
  return rings;
}

// ---------------------------------------------------------------- kıyı

function mergeWays(ways) {
  const byStart = new Map(), byEnd = new Map();
  for (const w of ways) {
    byStart.set(w.nodes[0], w);
    byEnd.set(w.nodes[w.nodes.length - 1], w);
  }
  const used = new Set();
  const chains = [];
  const coordsOf = (w) => w.geometry.map((g) => [g.lon, g.lat]);
  for (const w of ways) {
    if (used.has(w.id)) continue;
    used.add(w.id);
    let nodes = [...w.nodes];
    let coords = coordsOf(w);
    for (;;) {
      const last = nodes[nodes.length - 1];
      if (last === nodes[0]) break;
      const nx = byStart.get(last);
      if (!nx || used.has(nx.id)) break;
      used.add(nx.id);
      for (const n of nx.nodes.slice(1)) nodes.push(n);
      for (const c of coordsOf(nx).slice(1)) coords.push(c);
    }
    for (;;) {
      const first = nodes[0];
      if (first === nodes[nodes.length - 1]) break;
      const pv = byEnd.get(first);
      if (!pv || used.has(pv.id)) break;
      used.add(pv.id);
      nodes = [...pv.nodes.slice(0, -1), ...nodes];
      coords = [...coordsOf(pv).slice(0, -1), ...coords];
    }
    chains.push({ coords, closed: nodes[0] === nodes[nodes.length - 1] });
  }
  return chains;
}

const round6 = (c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];

function buildCoast(osm) {
  const ways = osm.elements.filter((e) => e.type === 'way' && e.geometry?.length >= 2);
  const chains = mergeWays(ways);
  console.log(`  ${ways.length} kıyı yolu → ${chains.length} zincir`);

  const pieces = [];
  const islandsLand = [];
  const islandsWater = [];
  let dangling = 0, tinyIslands = 0;

  for (const ch of chains) {
    let coords = simplify(ch.coords, SIMPLIFY_TOLERANCE_M);
    if (ch.closed) {
      const outIdx = coords.findIndex((c) => !inside(c));
      if (outIdx === -1) {
        if (coords.length < 4 || Math.abs(signedAreaM2(coords)) < MIN_ISLAND_AREA_M2) { tinyIslands++; continue; }
        (signedAreaM2(coords) > 0 ? islandsLand : islandsWater).push(coords);
        continue;
      }
      // bbox'ı kesen kapalı halka: dışarıdaki bir noktadan başlat, çizgi gibi kırp
      const open = coords.slice(0, -1);
      coords = [...open.slice(outIdx), ...open.slice(0, outIdx), open[outIdx]];
    }
    for (const p of clipLine(coords)) {
      if (!p.startsOnEdge || !p.endsOnEdge) { dangling++; continue; }
      pieces.push(p);
    }
  }
  if (dangling) console.warn(`  UYARI: bbox içinde biten ${dangling} kopuk kıyı parçası atlandı`);
  console.log(`  ${pieces.length} kenar parçası, ${islandsLand.length} ada, ${tinyIslands} minik adacık atlandı`);

  const landRings = [...closePieces(pieces), ...islandsLand];
  let land = polygonClipping.union(...landRings.map((r) => [r]));
  if (islandsWater.length) land = polygonClipping.difference(land, ...islandsWater.map((r) => [r]));
  const bboxPoly = [[[W, S], [E, S], [E, N], [W, N], [W, S]]];
  const water = polygonClipping.difference(bboxPoly, land);

  const lines = [...pieces.map((p) => p.coords), ...islandsLand, ...islandsWater].map((l) => l.map(round6));
  const waterCoords = water.map((poly) => poly.map((ring) => ring.map(round6)));

  const total = BW * KX * BH * KY;
  const waterArea = water.reduce(
    (s, poly) => s + Math.abs(signedAreaM2(poly[0])) - poly.slice(1).reduce((h, r) => h + Math.abs(signedAreaM2(r)), 0),
    0,
  );
  console.log(`  su oranı: %${((100 * waterArea) / total).toFixed(1)}`);
  return { lines, waterCoords };
}

// ---------------------------------------------------------------- yer adları

const PLACE_TYPES = ['suburb', 'quarter', 'neighbourhood', 'town', 'village', 'hamlet', 'island', 'islet', 'locality'];

function buildPlaces(osm) {
  const seen = new Set();
  const out = [];
  for (const e of osm.elements) {
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    const name = e.tags?.['name:tr'] ?? e.tags?.name;
    if (lat == null || lng == null || !name) continue;
    if (lng < W || lng > E || lat < S || lat > N) continue;
    const key = `${name}|${e.tags.place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, place: e.tags.place, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return out;
}

// ---------------------------------------------------------------- ana akış

const p = FETCH_PAD_DEG;
const coastQuery = `[out:json][timeout:240];way["natural"="coastline"](${S - p},${W - p},${N + p},${E + p});out body geom;`;
const placeQuery = `[out:json][timeout:180];nwr["place"~"^(${PLACE_TYPES.join('|')})$"]["name"](${S},${W},${N},${E});out center tags;`;

const breakwaterQuery = `[out:json][timeout:180];way["man_made"~"^(breakwater|groyne)$"](${S},${W},${N},${E});out geom;`;

const coastOsm = await cached('coastline-osm.json', coastQuery, 'Kıyı çizgisi');
const placesOsm = await cached('places-osm.json', placeQuery, 'Yer adları');
const breakwaterOsm = await cached('breakwaters-osm.json', breakwaterQuery, 'Dalgakıranlar');
const osmDate = coastOsm.osm3s?.timestamp_osm_base ?? null;

console.log('Kıyı işleniyor...');
const { lines, waterCoords } = buildCoast(coastOsm);
const places = buildPlaces(placesOsm);

const meta = { source: 'OpenStreetMap natural=coastline', license: 'ODbL © OpenStreetMap katkıcıları', osmDate, bbox: region.bbox };

await fs.writeFile(
  path.join(DATA, 'coastline.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { ...meta, note: 'Kara solda, su sağda (OSM kuralı).' }, geometry: { type: 'MultiLineString', coordinates: lines } }] }),
);
await fs.writeFile(
  path.join(DATA, 'water.geojson'),
  JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: meta, geometry: { type: 'MultiPolygon', coordinates: waterCoords } }] }),
);
await fs.writeFile(path.join(DATA, 'places.json'), JSON.stringify({ ...meta, source: 'OpenStreetMap place=*', places }, null, 0));

// Dalgakıran / mahmuz: kıyı çizgisi değil ama gemiler geçemez. Su ızgarasında kara sayılır.
const breakwaters = breakwaterOsm.elements
  .filter((e) => e.type === 'way' && e.geometry?.length >= 2)
  .map((e) => simplify(e.geometry.map((g) => [g.lon, g.lat]), 2).map(round6));
await fs.writeFile(
  path.join(DATA, 'breakwaters.geojson'),
  JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { ...meta, source: 'OpenStreetMap man_made=breakwater|groyne' }, geometry: { type: 'MultiLineString', coordinates: breakwaters } }],
  }),
);
console.log(`Dalgakıran: ${breakwaters.length} çizgi`);

const pts = lines.reduce((s, l) => s + l.length, 0);
console.log(`Tamam: ${lines.length} kıyı çizgisi (${pts} nokta), ${waterCoords.length} su poligonu, ${places.length} yer adı.`);
