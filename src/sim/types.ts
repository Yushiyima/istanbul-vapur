/**
 * Oyun durumu tipleri. GameState tamamen JSON'a çevrilebilir olmalı (IndexedDB kaydı).
 */
import type { LngLat } from '../geo/geo.ts';

export type Side = 'avrupa' | 'anadolu' | 'ada';
export type ShipTypeId = 'vapur' | 'denizOtobusu' | 'arabali';

export interface Pier {
  id: string;
  name: string;
  coast: LngLat;
  dock: LngLat;
  historicId?: string;
  berths: number;
  side: Side;
  /** Kara bileşeni (su ızgarasında). Aynı bileşendeki hücreler yürüme kapsamına girer. */
  comp: number;
  builtAt: number;
}

export interface Line {
  id: string;
  name: string;
  color: string;
  pierIds: string[];
  intervalMin: number;
  shipType: ShipTypeId;
  /** Gece seferi: 24 saat çalışır. */
  night: boolean;
  createdAt: number;
}

export type ShipStatus = 'transit' | 'sailing' | 'queue' | 'dwell' | 'layover';

/** Gemideki yolcu grubu: inecekleri iskele ve son varış. */
export interface OnboardGroup {
  alight: string;
  dest: string;
  count: number;
  /** Yolculuğun başladığı dakika (toplam süre istatistiği için). */
  startedAt: number;
}

export interface Ship {
  id: string;
  type: ShipTypeId;
  lineId: string;
  status: ShipStatus;
  /** Hat üzerindeki bacak (0..2n-3). */
  leg: number;
  /** Bacak (ya da tersane transit rotası) üzerinde kat edilen mesafe (m). */
  dist: number;
  /** Bir önceki dakikadaki mesafe (çizimde ara değer için). */
  prevDist: number;
  /** Yanaştığı ya da sırada beklediği iskele. */
  pierId: string | null;
  /** Bu dakikadan önce kalkamaz. */
  readyAt: number;
  arrivedAt: number;
  onboard: OnboardGroup[];
  /** Tersaneden hatta giderken izlenen rota. */
  transit?: LngLat[];
  /** Transit bitince başlayacağı terminal bacağı. */
  transitLeg?: number;
}

/** İskelede bekleyen yolcu grubu. */
export interface WaitGroup {
  lineId: string;
  /** Hangi iskelede inecek (bu hattın bu biniş yönünde ileride). */
  alight: string;
  dest: string;
  count: number;
  /** Ağırlıklı ortalama bekleme başlangıcı. */
  since: number;
  startedAt: number;
}

export interface DayStats {
  boardings: number;
  revenue: number;
  costs: number;
  tripsDone: number;
  tripsMissed: number;
  denied: number;
  gaveUp: number;
  waitSum: number;
  waitCount: number;
  journeys: number;
}

export interface LineStats {
  boardings: number;
  revenue: number;
  missed: number;
  trips: number;
  /** Son seferlerin ortalama doluluk oranı (0..1+). */
  load: number;
}

export type GoalId =
  | 'connectSides'
  | 'connectSides3'
  | 'adalar'
  | 'halic'
  | 'sariyer'
  | 'historic5'
  | 'rail5'
  | 'coverage10'
  | 'coverage25'
  | 'satisfaction95'
  | 'night';

export type WeatherKind = 'acik' | 'lodos' | 'poyraz' | 'sis';

export interface Weather {
  kind: WeatherKind;
  until: number;
}

export interface Tanker {
  until: number;
}

export interface FeedPost {
  id: string;
  at: number;
  author: string;
  avatar: string;
  text: string;
}

export interface GameState {
  version: 1;
  seed: number;
  rng: number;
  seq: number;
  /** Oyun başından beri dakika (0 = 1. yıl Ocak, 06:00). */
  minute: number;
  money: number;
  piers: Pier[];
  lines: Line[];
  ships: Ship[];
  waiting: Record<string, WaitGroup[]>;
  /** OD talebi küsurat birikimi: "i>j" → yolcu. */
  demandCarry: Record<string, number>;
  satisfaction: number;
  today: DayStats;
  yesterday: DayStats | null;
  year: { satisfactionSum: number; satisfactionDays: number; revenue: number; costs: number; boardings: number };
  lineStats: Record<string, LineStats>;
  goals: Partial<Record<GoalId, number>>;
  weather: Weather;
  tanker: Tanker | null;
  feed: FeedPost[];
  tersaneCapacity: number;
  /** Yıl sonu özeti bekliyor mu (arayüz gösterince temizler). */
  pendingYearSummary: null | { year: number; revenue: number; costs: number; boardings: number; satisfaction: number; rewards: number };
}
