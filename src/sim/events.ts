/**
 * Olaylar (Aşama 4): hava (lodos, poyraz, sis), Boğaz akıntısı, tanker geçişi.
 * Rastgelelik GameState içindeki tohumlu üreteçten gelir; kayıt/yükleme sonrası aynı akar.
 */
import { EVENTS } from '../config/balance.ts';
import { pointInPolygon, type LngLat } from '../geo/geo.ts';
import { pointAlong, type Route } from '../nav/route.ts';
import { pushFeed } from './feed.ts';
import { minuteOfDay, monthIndex, random } from './state.ts';
import type { GameState, Line, WeatherKind } from './types.ts';
import { legEnds, legRoute, pierById, type World } from './world.ts';

export const WEATHER_NAME: Record<WeatherKind, string> = { acik: 'Açık', lodos: 'Lodos', poyraz: 'Poyraz', sis: 'Sis' };

export function currentWeather(state: GameState): WeatherKind {
  const w = state.weather;
  return state.minute >= w.from && state.minute < w.until ? w.kind : 'acik';
}

/** Gün başında o günün havasını belirler (aya göre olasılık). */
function scheduleWeather(state: GameState): void {
  const dayStart = state.minute - minuteOfDay(state.minute);
  const probs = EVENTS.weatherByMonth[monthIndex(state.minute)]!;
  const r = random(state);
  let kind: WeatherKind = 'acik';
  if (r < probs.lodos) kind = 'lodos';
  else if (r < probs.lodos + probs.poyraz) kind = 'poyraz';
  else if (r < probs.lodos + probs.poyraz + probs.sis) kind = 'sis';
  if (kind === 'acik') {
    state.weather = { kind, from: dayStart, until: dayStart };
    return;
  }
  const spec = EVENTS.duration[kind];
  const startH = spec.startHour[0] + random(state) * (spec.startHour[1] - spec.startHour[0]);
  const lenH = spec.hours[0] + random(state) * (spec.hours[1] - spec.hours[0]);
  const from = dayStart + Math.round(startH * 60);
  state.weather = { kind, from, until: from + Math.round(lenH * 60) };
}

export function updateEvents(state: GameState, world: World): void {
  const mod = minuteOfDay(state.minute);
  if (mod === 0 || state.weather.until === 0) scheduleWeather(state);

  const w = state.weather;
  if (w.kind !== 'acik' && state.minute === w.from) {
    const text: Record<string, string> = {
      lodos: 'Lodos başladı: açık deniz hatlarında seferler iptal.',
      poyraz: 'Poyraz başladı: açık deniz ve Karadeniz ağzında seferler iptal.',
      sis: 'Sis bastı: tüm hatlarda gemiler yavaşladı.',
    };
    state.notices.push({ at: state.minute, kind: 'info', text: `${w.kind === 'sis' ? '🌫' : '🌬'} ${text[w.kind]}` });
    pushFeed(state, world, w.kind);
  }
  if (w.kind !== 'acik' && state.minute === w.until) {
    state.notices.push({ at: state.minute, kind: 'info', text: `☀ ${WEATHER_NAME[w.kind]} geçti, seferler normale döndü.` });
  }

  if (state.tanker && state.minute >= state.tanker.until) state.tanker = null;
  const hour = Math.floor(mod / 60);
  if (!state.tanker && mod % 60 === 30 && hour >= EVENTS.tankerHours[0] && hour < EVENTS.tankerHours[1] && random(state) < EVENTS.tankerChancePerHour) {
    const len = EVENTS.tankerMinutes[0] + Math.round(random(state) * (EVENTS.tankerMinutes[1] - EVENTS.tankerMinutes[0]));
    state.tanker = { until: state.minute + len };
    state.notices.push({ at: state.minute, kind: 'info', text: `🚢 Tanker geçiyor: Boğaz'ı enine kesen seferler ${len} dk bekleyecek.` });
    pushFeed(state, world, 'tanker');
  }
}

// ---------------------------------------------------------------- rota özellikleri

interface RouteTraits {
  open: number;
  blackSea: number;
}
const traitCache = new WeakMap<Route, RouteTraits>();

function zonePoly(world: World, id: string) {
  return world.data.zones.find((z) => z.id === id)?.polygon;
}

function traits(world: World, route: Route): RouteTraits {
  let t = traitCache.get(route);
  if (t) return t;
  const open = zonePoly(world, 'acik_deniz');
  const black = zonePoly(world, 'karadeniz_agzi');
  const step = 100;
  let n = 0, inOpen = 0, inBlack = 0;
  for (let d = 0; d <= route.lengthM; d += step) {
    const p = pointAlong(route, d).p;
    n++;
    if (open && pointInPolygon(p, open)) inOpen++;
    if (black && pointInPolygon(p, black)) inBlack++;
  }
  t = { open: n ? inOpen / n : 0, blackSea: n ? inBlack / n : 0 };
  traitCache.set(route, t);
  return t;
}

/** Hız çarpanı: sis tüm hatlarda yavaşlatır; Boğaz'da kuzeyden güneye akıntı. */
export function speedFactor(state: GameState, world: World, route: Route, dist: number): number {
  let f = currentWeather(state) === 'sis' ? EVENTS.fogSpeedFactor : 1;
  const bogaz = zonePoly(world, 'bogaz');
  if (bogaz) {
    const { p, dir } = pointAlong(route, dist);
    if (pointInPolygon(p as LngLat, bogaz)) f *= 1 - EVENTS.currentStrength * dir[1];
  }
  return f;
}

/** Bacak Boğaz'ı enine mi kesiyor (iki ucu farklı yakada ve Boğaz bölgesinde)? */
export function crossesBosphorus(state: GameState, world: World, line: Line, leg: number): boolean {
  const { from, to } = legEnds(line, leg);
  const a = pierById(state, line.pierIds[from]!), b = pierById(state, line.pierIds[to]!);
  if (!a || !b || a.side === b.side || a.side === 'ada' || b.side === 'ada') return false;
  const route = legRoute(world, state, line, leg);
  const bogaz = zonePoly(world, 'bogaz');
  if (!route || !bogaz) return false;
  return pointInPolygon(pointAlong(route, route.lengthM / 2).p, bogaz);
}

export function legExposed(state: GameState, world: World, line: Line, leg: number, kind: WeatherKind): boolean {
  const route = legRoute(world, state, line, leg);
  if (!route) return false;
  const t = traits(world, route);
  const exposure = kind === 'poyraz' ? t.open + t.blackSea : t.open;
  return exposure >= EVENTS.exposureThreshold;
}

/** Bu bacakta kalkış serbest mi (lodos/poyraz iptali, tanker geçişi). */
export function canDepart(state: GameState, world: World, line: Line, leg: number): boolean {
  const w = currentWeather(state);
  if ((w === 'lodos' || w === 'poyraz') && legExposed(state, world, line, leg, w)) return false;
  if (state.tanker && crossesBosphorus(state, world, line, leg)) return false;
  return true;
}

