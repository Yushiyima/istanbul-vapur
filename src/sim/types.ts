/**
 * Oyun durumu tipleri. GameState tamamen JSON'a çevrilebilir olmalı (IndexedDB kaydı).
 */
import type { LngLat } from '../geo/geo.ts';

export type Side = 'avrupa' | 'anadolu' | 'ada';
export type ShipTypeId = 'vapur' | 'denizOtobusu' | 'arabali';
export type TrafficKind = 'tanker' | 'konteyner' | 'dokme' | 'kruvaziyer' | 'koster';

/** Boğaz'dan geçen transit gemi (oyuncunun değil). */
export interface TrafficShip {
  id: string;
  kind: TrafficKind;
  name: string;
  /** 1: Karadeniz → Marmara, -1: Marmara → Karadeniz. */
  dir: 1 | -1;
  dist: number;
  prevDist: number;
  speedMul: number;
}

export interface Pier {
  id: string;
  name: string;
  coast: LngLat;
  dock: LngLat;
  historicId?: string;
  berths: number;
  /** Araç rampası: arabalı vapur yanaşabilir. */
  ramp?: boolean;
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

export type ShipStatus = 'transit' | 'sailing' | 'queue' | 'dwell' | 'layover' | 'toYard' | 'maintenance';

/** Tersane: yeni gemiler buradan çıkar, bakım burada yapılır. */
export interface Yard {
  id: string;
  name: string;
  coast: LngLat;
  dock: LngLat;
  /** Filo kapasitesine katkı (gemi). */
  capacity: number;
  /** Aynı anda bakım yapılabilen gemi sayısı. */
  slots: number;
  builtAt: number;
}

export interface ShipCounters {
  trips: number;
  boardings: number;
  revenue: number;
  km: number;
  /** Kalkıştaki doluluk oranları toplamı ve sayısı (ortalama için). */
  loadSum: number;
  loadN: number;
}

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
  /** Tersaneden hatta (ya da hattan tersaneye) giderken izlenen rota. */
  transit?: LngLat[];
  /** Transit bitince başlayacağı terminal bacağı. */
  transitLeg?: number;
  builtAt: number;
  /** Bakım durumu 0–100. Düştükçe yavaşlar, arıza riski artar. */
  condition: number;
  /** Bakıma gittiği / bakımda olduğu tersane. */
  yardId?: string;
  /** Arızalı olarak çekiliyor mu (yavaş gider, onarım pahalı). */
  broken?: boolean;
  /** Oyuncu bakım istedi: bir sonraki yanaşmada tersaneye gider. */
  maintRequested?: boolean;
  /** Trafikten kaçınma: rotadan yana sapma (m, + sağ). */
  sidestep?: number;
  /** Kaç dakikadır bir gemiye yol veriyor. */
  yielding?: number;
  total: ShipCounters;
  today: ShipCounters;
}

export interface Settings {
  /** Bu durumun altına düşen gemi terminalde bakıma gider (0 = kapalı). */
  maintThreshold: number;
  /** Gece seferi olmayan saatleri hızlı geç. */
  nightSkip: boolean;
  /** Boğaz transit trafiği açık mı. */
  traffic: boolean;
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
  /** Aktarma yapan yolcu (indirimli bilet). */
  xfer?: boolean;
  /** Bu grup bir kez vapura sığamadı (reddedilen sadece bir kez sayılır). */
  denied?: boolean;
}

/** Saatlik memnuniyet hesabı için biriktiriciler. */
export interface HourAcc {
  waitSum: number;
  waitCount: number;
  boardings: number;
  denied: number;
  departures: number;
  missed: number;
  gaveUp: number;
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
  /** Vapurların transit gemilere yol vererek beklediği dakikalar. */
  yieldMinutes?: number;
  /** Arabalı vapurlarla taşınan araç. */
  vehicles?: number;
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
  from: number;
  until: number;
}

export interface Notice {
  at: number;
  kind: 'info' | 'ok' | 'error';
  text: string;
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
  hourAcc: HourAcc;
  today: DayStats;
  yesterday: DayStats | null;
  year: { satisfactionSum: number; satisfactionDays: number; revenue: number; costs: number; boardings: number };
  lineStats: Record<string, LineStats>;
  goals: Partial<Record<GoalId, number>>;
  weather: Weather;
  tanker: Tanker | null;
  feed: FeedPost[];
  /** Arayüzün toast olarak göstereceği bildirimler (gösterilince boşaltılır). */
  notices: Notice[];
  yards: Yard[];
  settings: Settings;
  traffic: TrafficShip[];
  /** Yıl sonu özeti bekliyor mu (arayüz gösterince temizler). */
  pendingYearSummary: null | { year: number; revenue: number; costs: number; boardings: number; satisfaction: number; rewards: number };
}
