/**
 * Oyun denetleyicisi: GameState + World, kullanıcı eylemleri, zaman döngüsü.
 * Arayüz ve harita bunu okur; durumu sadece buradaki metotlar değiştirir.
 */
import { TIME } from './config/balance.ts';
import { devLog } from './devlog.ts';
import type { LngLat, PolygonCoords } from './geo/geo.ts';
import { buildWaterIndex, landCoverage, type WaterIndex } from './map/coverage.ts';
import {
  addPier,
  buyShip,
  changeShipType,
  createLine,
  deleteLine,
  fmtMoney,
  pierCost,
  removePier,
  sellShip,
  setInterval_,
  setNight,
  upgradeBerths,
  upgradeTersane,
} from './sim/network.ts';
import { evaluatePlacement, findHistoricMatch, normalizeName, pickPierName, uniqueName, type PlacementResult } from './sim/piers.ts';
import { createGame, dayIndex } from './sim/state.ts';
import { pushFeed } from './sim/feed.ts';
import { RouteCache } from './nav/route.ts';
import { AUTO_SLOT, loadGame, saveGame } from './save/save.ts';
import { tick } from './sim/tick.ts';
import type { GameState, Notice, Pier, ShipTypeId } from './sim/types.ts';
import { createWorld, type World } from './sim/world.ts';
import type { CityPack } from './cityPack.ts';

export type Tool = 'pan' | 'pier' | 'line';
export type ToastKind = 'info' | 'ok' | 'error';

const fmtLL = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;

export class Game {
  readonly world: World;
  state: GameState;
  tool: Tool = 'pan';
  speedIndex = 1;
  /** Çizilmekte olan hattın iskeleleri. */
  draft: string[] = [];
  selectedLineId: string | null = null;
  private acc = 0;
  private listeners = new Set<() => void>();
  private toastFn: (msg: string, kind: ToastKind) => void = () => {};
  private waterIndex: WaterIndex;
  private coverageCache = new Map<string, PolygonCoords[]>();

  readonly pack: CityPack;

  constructor(pack: CityPack, state?: GameState) {
    this.pack = pack;
    this.world = createWorld(pack.data);
    for (const w of this.world.warnings) console.warn(w);
    this.waterIndex = buildWaterIndex(pack.data.waterPolygons);
    this.state = state ? Game.normalize(state) : this.newState();
    this.lastSavedDay = dayIndex(this.state.minute);
  }

  /** Eski ya da eksik kayıtları güncel alanlarla tamamlar. */
  static normalize(saved: GameState): GameState {
    const base = createGame(saved.seed ?? 1);
    return { ...base, ...saved, today: { ...base.today, ...saved.today }, hourAcc: { ...base.hourAcc, ...(saved.hourAcc ?? {}) }, notices: [] };
  }

  /** Durumu değiştirir; dünya önbellekleri (rota, havza, talep) iskele kimliklerine bağlı olduğu için sıfırlanır. */
  replaceState(state: GameState): void {
    this.state = Game.normalize(state);
    this.world.routes = new RouteCache(this.world.grid);
    this.world.catchments.clear();
    this.world.od = null;
    this.coverageCache.clear();
    this.coverageQueue = [];
    this.draft = [];
    this.selectedLineId = null;
    this.lastSavedDay = dayIndex(this.state.minute);
    this.changed();
  }

  newGame(): void {
    this.replaceState(this.newState());
    devLog('game', 'yeni oyun');
  }

  private lastSavedDay = -1;

  private saving = false;

  async save(slot: string = AUTO_SLOT): Promise<boolean> {
    if (this.saving) return false;
    this.saving = true;
    const t0 = performance.now();
    try {
      await saveGame(this.state, slot);
      this.lastSavedDay = dayIndex(this.state.minute);
      devLog('game', `kaydedildi (${slot}) · gün ${dayIndex(this.state.minute)} · ${Math.round(performance.now() - t0)} ms`);
      return true;
    } catch (err) {
      console.error('Kayıt başarısız:', err);
      return false;
    } finally {
      this.saving = false;
    }
  }

  async load(slot: string = AUTO_SLOT): Promise<boolean> {
    try {
      const rec = await loadGame(slot);
      if (!rec) return false;
      this.replaceState(rec.state);
      devLog('game', `yüklendi (${slot}) · gün ${dayIndex(this.state.minute)}`);
      return true;
    } catch (err) {
      console.error('Yükleme başarısız:', err);
      return false;
    }
  }

  /** Gün değiştiyse otomatik kaydet. */
  autosave(): void {
    if (!this.saving && dayIndex(this.state.minute) !== this.lastSavedDay) void this.save(AUTO_SLOT);
  }

  /** Simülasyonun ürettiği bildirimleri alır ve boşaltır. */
  drainNotices(): Notice[] {
    if (!this.state.notices.length) return [];
    const out = this.state.notices;
    this.state.notices = [];
    return out;
  }

  private newState(): GameState {
    const state = createGame((Date.now() & 0x7fffffff) | 1);
    // Öğretici başlangıç: Eminönü ve Kadıköy, aralarında tek hat ve iki vapur.
    const starts = this.world.historic.filter((h) => this.pack.data.historic.find((x) => x.id === h.id)?.start);
    const ids: string[] = [];
    for (const h of starts) {
      const r = addPier(state, this.world, { name: h.name, coast: h.coast, dock: h.dock, historicId: h.id }, { free: true });
      if (r.ok) ids.push(r.value.id);
    }
    if (ids.length >= 2) {
      const line = createLine(state, this.world, ids);
      if (line.ok) {
        buyShip(state, this.world, line.value.id, { free: true, atTerminal: true });
        buyShip(state, this.world, line.value.id, { free: true, atTerminal: true });
      }
    }
    return state;
  }

  // ---------------------------------------------------------------- olaylar

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  setToast(fn: (msg: string, kind: ToastKind) => void): void {
    this.toastFn = fn;
  }

  changed(): void {
    for (const fn of this.listeners) fn();
  }

  toast(msg: string, kind: ToastKind = 'info'): void {
    this.toastFn(msg, kind);
  }

  // ---------------------------------------------------------------- zaman

  get speed(): number {
    return TIME.speeds[this.speedIndex] ?? 1;
  }

  setSpeed(i: number): void {
    this.speedIndex = Math.max(0, Math.min(TIME.speeds.length - 1, i));
    this.changed();
  }

  /** Gerçek zamanda `dtMs` ilerlet; son tick ile sonraki arasındaki oranı döner. */
  /** Son advance() çağrısının tick sayısı ve süresi (ms), performans logu için. */
  lastAdvance = { ticks: 0, ms: 0 };

  advance(dtMs: number): number {
    this.lastAdvance = { ticks: 0, ms: 0 };
    if (!this.speed) return 0;
    const t0 = performance.now();
    this.acc += (dtMs * this.speed) / TIME.realMsPerMinute;
    let n = 0;
    while (this.acc >= 1 && n < TIME.maxTicksPerFrame) {
      tick(this.state, this.world);
      this.acc -= 1;
      n++;
    }
    if (this.acc > 1) this.acc = 1; // yetişemiyorsak birikmesin
    this.lastAdvance = { ticks: n, ms: performance.now() - t0 };
    return this.acc;
  }

  // ---------------------------------------------------------------- araçlar

  setTool(t: Tool): void {
    if (t === this.tool) return;
    this.tool = t;
    if (t !== 'line') this.draft = [];
    devLog('game', `araç: ${t}`);
    this.changed();
  }

  // ---------------------------------------------------------------- iskele

  previewPlacement(click: LngLat): PlacementResult {
    return evaluatePlacement(click, { coast: this.world.coast, bbox: this.pack.data.bbox, piers: this.state.piers, noBuild: this.pack.data.noBuildZones });
  }

  placementCost(coast: LngLat): number {
    const used = new Set(this.state.piers.flatMap((p) => (p.historicId ? [p.historicId] : [])));
    const match = findHistoricMatch(coast, this.world.historic.filter((h) => !used.has(h.id)));
    return pierCost(this.world, coast, match?.id);
  }

  placePier(click: LngLat): Pier | null {
    const r = this.previewPlacement(click);
    if (!r.ok) {
      this.toast(r.message, 'error');
      devLog('game', `iskele reddedildi [${r.reason}] tık=${fmtLL(click)} · ${r.message}`);
      return null;
    }
    const used = new Set(this.state.piers.flatMap((p) => (p.historicId ? [p.historicId] : [])));
    const match = findHistoricMatch(r.coast, this.world.historic.filter((h) => !used.has(h.id)));
    const names = () => new Set(this.state.piers.map((p) => p.name));
    if (match) {
      const holder = this.state.piers.find((p) => !p.historicId && normalizeName(p.name) === normalizeName(match.name));
      if (holder) {
        const renamed = uniqueName(match.name, names());
        devLog('game', `iskele yeniden adlandırıldı "${holder.name}" → "${renamed}" (tarihi ${match.name} için)`);
        holder.name = renamed;
      }
    }
    const name = match
      ? uniqueName(match.name, names())
      : pickPierName(r.coast, this.pack.data.places, { used: names(), historicNames: this.world.historic.map((h) => h.name) });
    const res = addPier(this.state, this.world, { name, coast: r.coast, dock: r.dock, ...(match ? { historicId: match.id } : {}) });
    if (!res.ok) {
      this.toast(res.message, 'error');
      devLog('game', `iskele reddedildi [bütçe] ${res.message}`);
      return null;
    }
    this.toast(match ? `${name} tarihi iskelesi yeniden açıldı.` : `${name} iskelesi kuruldu.`, 'ok');
    if (match) pushFeed(this.state, this.world, 'historic', { pier: name });
    devLog('game', `iskele kuruldu "${name}"${match ? ` (tarihi: ${match.id})` : ''} tık=${fmtLL(click)} kıyı=${fmtLL(r.coast)} yapışma=${Math.round(r.snapDistanceM)} m · ${res.value.side} · toplam ${this.state.piers.length} · kasa ${this.money()}`);
    this.changed();
    return res.value;
  }

  deletePier(id: string): void {
    const pier = this.state.piers.find((p) => p.id === id);
    if (!pier) return;
    const lines = removePier(this.state, this.world, id);
    this.coverageCache.delete(id);
    this.draft = this.draft.filter((x) => x !== id);
    this.toast(lines.length ? `${pier.name} silindi; ${lines.length} hat da kaldırıldı.` : `${pier.name} iskelesi silindi.`);
    devLog('game', `iskele silindi "${pier.name}" · hatlar: ${lines.join(', ') || '-'} · toplam ${this.state.piers.length}`);
    this.changed();
  }

  upgradeBerths(id: string): void {
    const r = upgradeBerths(this.state, id);
    devLog('game', `yanaşma yeri ${id}: ${r.ok ? `${r.value} oldu` : r.message} · kasa ${this.money()}`);
    if (r.ok) this.toast(`Yanaşma yeri ${r.value} oldu.`, 'ok');
    else this.toast(r.message, 'error');
    this.changed();
  }

  private coverageQueue: Pier[] = [];

  /**
   * İskelenin karadaki kapsama alanı. Hesap iskele başına ~25 ms sürdüğü için hemen yapılmaz:
   * sıraya alınır, `pumpCoverage` her karede bir tane hesaplar. Hazır olana kadar boş döner.
   */
  coverage(pier: Pier): PolygonCoords[] {
    const c = this.coverageCache.get(pier.id);
    if (c) return c;
    if (!this.coverageQueue.some((p) => p.id === pier.id)) this.coverageQueue.push(pier);
    return [];
  }

  /** Sıradaki kapsama alanlarından birini hesaplar; bir şey hesaplandıysa true. */
  pumpCoverage(): boolean {
    while (this.coverageQueue.length) {
      const pier = this.coverageQueue.shift()!;
      if (this.coverageCache.has(pier.id) || !this.state.piers.some((p) => p.id === pier.id)) continue;
      this.coverageCache.set(pier.id, landCoverage(pier.coast, pier.comp, this.waterIndex, this.world.grid));
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- hat

  /** Hat aracıyla iskeleye tıklandı. */
  clickPierForLine(id: string): void {
    if (this.draft[this.draft.length - 1] === id) {
      this.finishDraft();
      return;
    }
    if (this.draft.includes(id)) {
      this.toast('Bu iskele hatta zaten var. Bitirmek için son iskeleye tekrar tıkla.', 'error');
      return;
    }
    this.draft.push(id);
    this.changed();
  }

  undoDraft(): void {
    this.draft.pop();
    this.changed();
  }

  cancelDraft(): void {
    this.draft = [];
    this.changed();
  }

  finishDraft(): void {
    if (this.draft.length < 2) {
      this.toast('Hat için en az iki iskele seç.', 'error');
      return;
    }
    const t0 = performance.now();
    const r = createLine(this.state, this.world, this.draft);
    if (!r.ok) {
      this.toast(r.message, 'error');
      devLog('game', `hat reddedildi: ${r.message}`);
      return;
    }
    const ship = buyShip(this.state, this.world, r.value.id);
    this.toast(ship.ok ? `${r.value.name} hattı açıldı, ilk vapur tersaneden yola çıktı.` : `${r.value.name} hattı açıldı. ${ship.message}`, ship.ok ? 'ok' : 'error');
    devLog('game', `hat açıldı "${r.value.name}" (${r.value.pierIds.length} iskele) · gemi: ${ship.ok ? 'var' : ship.message} · kasa ${this.money()} · ${Math.round(performance.now() - t0)} ms`);
    pushFeed(this.state, this.world, 'newLine', { line: r.value.name });
    this.draft = [];
    this.selectedLineId = r.value.id;
    this.changed();
  }

  deleteLine(id: string): void {
    const l = this.state.lines.find((x) => x.id === id);
    deleteLine(this.state, id);
    if (this.selectedLineId === id) this.selectedLineId = null;
    if (l) {
      this.toast(`${l.name} hattı kapatıldı.`);
      devLog('game', `hat kapatıldı "${l.name}"`);
    }
    this.changed();
  }

  setInterval(id: string, minutes: number): void {
    setInterval_(this.state, id, minutes);
    devLog('game', `sefer aralığı ${id} = ${minutes} dk`);
    this.changed();
  }

  setNight(id: string, night: boolean): void {
    setNight(this.state, id, night);
    if (night) pushFeed(this.state, this.world, 'night');
    devLog('game', `gece seferi ${id} = ${night}`);
    this.changed();
  }

  addShip(id: string): void {
    const r = buyShip(this.state, this.world, id);
    if (!r.ok) this.toast(r.message, 'error');
    else devLog('game', `gemi alındı ${id} (${r.value.type}) · kasa ${this.money()}`);
    this.changed();
  }

  removeShip(id: string): void {
    const r = sellShip(this.state, id);
    devLog('game', `gemi satıldı ${id}: ${r.ok ? 'tamam' : r.message} · kasa ${this.money()}`);
    if (!r.ok) this.toast(r.message, 'error');
    this.changed();
  }

  setShipType(id: string, type: ShipTypeId): void {
    const r = changeShipType(this.state, this.world, id, type);
    if (!r.ok) this.toast(r.message, 'error');
    else devLog('game', `gemi tipi ${id} = ${type}`);
    this.changed();
  }

  upgradeTersane(): void {
    const r = upgradeTersane(this.state);
    devLog('game', `tersane: ${r.ok ? `kapasite ${r.value}` : r.message} · kasa ${this.money()}`);
    this.toast(r.ok ? `Tersane kapasitesi ${r.value} gemi.` : r.message, r.ok ? 'ok' : 'error');
    this.changed();
  }

  money(): string {
    return fmtMoney(this.state.money);
  }
}
