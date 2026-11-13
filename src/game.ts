/**
 * Oyun denetleyicisi: GameState + World, kullanıcı eylemleri, zaman döngüsü.
 * Arayüz ve harita bunu okur; durumu sadece buradaki metotlar değiştirir.
 */
import { SHIP_TYPES, TERSANE, TIME } from './config/balance.ts';
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
  requiredShips,
  sellShip,
  setInterval_,
  setNight,
  upgradeBerths,
  buildRamp,
  updateLinePiers,
} from './sim/network.ts';
import { warmTraffic } from './sim/traffic.ts';
import { buildYard, emptyCounters, ensureDefaultYard, previewYard, upgradeYardCapacity, upgradeYardSlots, yardById } from './sim/yards.ts';
import { evaluatePlacement, findHistoricMatch, normalizeName, pickPierName, uniqueName, type PlacementResult } from './sim/piers.ts';
import { createGame, dayIndex, inService } from './sim/state.ts';
import { pushFeed } from './sim/feed.ts';
import { RouteCache } from './nav/route.ts';
import { AUTO_SLOT, loadGame, quickClear, quickLoad, quickSave, saveGame } from './save/save.ts';
import { tick } from './sim/tick.ts';
import type { GameState, Notice, Pier, ShipTypeId } from './sim/types.ts';
import { createWorld, type World } from './sim/world.ts';
import type { CityPack } from './cityPack.ts';

export type Tool = 'pan' | 'pier' | 'line' | 'yard';
export type ToastKind = 'info' | 'ok' | 'error';

const fmtLL = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;

export class Game {
  readonly world: World;
  state: GameState;
  tool: Tool = 'pan';
  speedIndex = 1;
  /** Çizilmekte olan hattın iskeleleri. */
  draft: string[] = [];
  /** Taslak mevcut bir hattı düzenliyorsa onun kimliği. */
  editingLineId: string | null = null;
  selectedLineId: string | null = null;
  /** Arayüz bağlar: tersaneyi haritada göster. */
  focusYard?: (id: string) => void;
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
    ensureDefaultYard(this.state, this.world);
    warmTraffic(this.state, this.world);
    this.lastSavedDay = dayIndex(this.state.minute);
  }

  /** Eski ya da eksik kayıtları güncel alanlarla tamamlar. */
  static normalize(saved: GameState): GameState {
    const base = createGame(saved.seed ?? 1);
    const old = saved as GameState & { tersaneCapacity?: number };
    const state: GameState = {
      ...base,
      ...saved,
      today: { ...base.today, ...saved.today },
      hourAcc: { ...base.hourAcc, ...(saved.hourAcc ?? {}) },
      settings: { ...base.settings, ...(saved.settings ?? {}) },
      yards: saved.yards ?? [],
      traffic: saved.traffic ?? [],
      notices: [],
    };
    // Eski kayıtlarda gemi bakım/istatistik alanları yok.
    state.ships = state.ships.map((s) => ({ ...s, builtAt: s.builtAt ?? saved.minute, condition: s.condition ?? 100, total: s.total ?? emptyCounters(), today: s.today ?? emptyCounters() }));
    if (!saved.yards && old.tersaneCapacity) (state as GameState & { _legacyCapacity?: number })._legacyCapacity = old.tersaneCapacity;
    return state;
  }

  /** Eski kayıttan gelen tek tersaneyi kurar. */
  private migrateYards(): void {
    const legacy = (this.state as GameState & { _legacyCapacity?: number })._legacyCapacity;
    ensureDefaultYard(this.state, this.world, legacy ?? TERSANE.capacity);
    delete (this.state as GameState & { _legacyCapacity?: number })._legacyCapacity;
  }

  /** Durumu değiştirir; dünya önbellekleri (rota, havza, talep) iskele kimliklerine bağlı olduğu için sıfırlanır. */
  replaceState(state: GameState): void {
    this.state = Game.normalize(state);
    this.migrateYards();
    warmTraffic(this.state, this.world);
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
    quickClear();
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

  /** Sayfa kapanırken senkron anlık kopya. */
  quickSave(): void {
    quickSave(this.state);
  }

  async load(slot: string = AUTO_SLOT): Promise<boolean> {
    try {
      const rec = await loadGame(slot);
      // Otomatik yüklemede sayfa kapanırken alınan anlık kopya daha yeniyse onu kullan.
      const quick = slot === AUTO_SLOT ? quickLoad() : null;
      const pick = quick && (!rec || quick.savedAt > rec.savedAt) ? quick.state : rec?.state;
      if (!pick) return false;
      this.replaceState(pick);
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
        // Başlangıç hattı tarifeyi tutturacak kadar gemiyle gelir.
        const need = requiredShips(this.world, state, line.value);
        for (let i = 0; i < need; i++) buyShip(state, this.world, line.value.id, { free: true, atTerminal: true });
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

  /** Gece seferi yokken gece saatleri hızlı mı geçiliyor? */
  get nightSkipping(): boolean {
    const s = this.state;
    if (!s.settings.nightSkip || !this.speed || inService(s.minute, false)) return false;
    return !s.lines.some((l) => l.night && s.ships.some((sh) => sh.lineId === l.id));
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
    const speed = this.nightSkipping ? Math.max(this.speed, TIME.nightSkipSpeed) : this.speed;
    this.acc += (dtMs * speed) / TIME.realMsPerMinute;
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
    if (t !== 'line') {
      this.draft = [];
      this.editingLineId = null;
    }
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

  buildRamp(id: string): void {
    const r = buildRamp(this.state, id);
    this.toast(r.ok ? 'Araç rampası kuruldu: arabalı vapur yanaşabilir.' : r.message, r.ok ? 'ok' : 'error');
    devLog('game', `rampa ${id}: ${r.ok ? 'kuruldu' : r.message} · kasa ${this.money()}`);
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
    // Son iskeleye tekrar tıklamak bitirir; taslaktaki başka bir iskeleye tıklamak onu çıkarır.
    if (this.draft[this.draft.length - 1] === id && !this.editingLineId) {
      this.finishDraft();
      return;
    }
    if (this.draft.includes(id)) {
      this.draft = this.draft.filter((x) => x !== id);
      this.changed();
      return;
    }
    if (this.editingLineId && this.draft.length >= 2) this.draft.splice(this.bestInsertIndex(id), 0, id);
    else this.draft.push(id);
    this.changed();
  }

  /** Düzenlemede yeni iskeleyi, toplam mesafeyi en az artıran yere koy. */
  private bestInsertIndex(id: string): number {
    const at = (pid: string) => this.state.piers.find((p) => p.id === pid)!.coast;
    const p = at(id);
    const d = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]);
    let best = this.draft.length, bestCost = Infinity;
    for (let i = 0; i <= this.draft.length; i++) {
      const prev = i > 0 ? at(this.draft[i - 1]!) : null;
      const next = i < this.draft.length ? at(this.draft[i]!) : null;
      const cost = prev && next ? d(prev, p) + d(p, next) - d(prev, next) : prev ? d(prev, p) : d(p, next!);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    }
    return best;
  }

  editLine(id: string): void {
    const line = this.state.lines.find((l) => l.id === id);
    if (!line) return;
    this.tool = 'line';
    this.editingLineId = id;
    this.draft = [...line.pierIds];
    this.selectedLineId = id;
    devLog('game', `hat düzenleniyor "${line.name}"`);
    this.changed();
  }

  undoDraft(): void {
    this.draft.pop();
    this.changed();
  }

  cancelDraft(): void {
    this.draft = [];
    this.editingLineId = null;
    this.changed();
  }

  finishDraft(): void {
    if (this.draft.length < 2) {
      this.toast('Hat için en az iki iskele seç.', 'error');
      return;
    }
    const t0 = performance.now();
    if (this.editingLineId) {
      const u = updateLinePiers(this.state, this.world, this.editingLineId, this.draft);
      if (!u.ok) {
        this.toast(u.message, 'error');
        return;
      }
      this.toast(`${u.value.name} hattı güncellendi; gemiler yeni terminallere gidiyor.`, 'ok');
      devLog('game', `hat güncellendi "${u.value.name}" (${u.value.pierIds.length} iskele)`);
      this.draft = [];
      this.editingLineId = null;
      this.tool = 'pan';
      this.changed();
      return;
    }
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

  sellShipById(shipId: string): void {
    const ship = this.state.ships.find((s) => s.id === shipId);
    if (!ship) return;
    this.state.ships = this.state.ships.filter((s) => s.id !== shipId);
    const refund = Math.round(SHIP_TYPES[ship.type].price * TERSANE.resaleRatio);
    this.state.money += refund;
    this.toast(`${SHIP_TYPES[ship.type].name} satıldı: +${fmtMoney(refund)}.`, 'info');
    devLog('game', `gemi satıldı ${shipId} · kasa ${this.money()}`);
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

  // ---------------------------------------------------------------- tersane ve bakım

  previewYard(click: LngLat): PlacementResult {
    return previewYard(this.state, this.world, click);
  }

  placeYard(click: LngLat): void {
    const r = buildYard(this.state, this.world, click);
    if (!r.ok) {
      this.toast(r.message, 'error');
      devLog('game', `tersane reddedildi: ${r.message}`);
      return;
    }
    this.toast(`${r.value.name} kuruldu: +${r.value.capacity} gemi kapasitesi, ${r.value.slots} bakım yuvası.`, 'ok');
    devLog('game', `tersane kuruldu "${r.value.name}" kıyı=${fmtLL(r.value.coast)} · kasa ${this.money()}`);
    this.changed();
  }

  upgradeYard(id: string, what: 'capacity' | 'slots'): void {
    const r = what === 'capacity' ? upgradeYardCapacity(this.state, id) : upgradeYardSlots(this.state, id);
    const y = yardById(this.state, id);
    this.toast(r.ok ? `${y?.name}: ${what === 'capacity' ? `filo kapasitesi +${TERSANE.upgradeStep}` : 'bakım yuvası +1'}.` : r.message, r.ok ? 'ok' : 'error');
    devLog('game', `tersane ${what} ${id}: ${r.ok ? r.value : r.message} · kasa ${this.money()}`);
    this.changed();
  }

  /** Gemiyi bir sonraki yanaşmada bakıma gönder (iptal için tekrar çağır). */
  toggleMaintenance(shipId: string): void {
    const ship = this.state.ships.find((s) => s.id === shipId);
    if (!ship) return;
    if (ship.status === 'toYard' || ship.status === 'maintenance') {
      this.toast('Gemi zaten tersanede ya da yolda.', 'info');
      return;
    }
    ship.maintRequested = !ship.maintRequested;
    if (!ship.maintRequested) delete ship.maintRequested;
    this.toast(ship.maintRequested ? 'Gemi ilk yanaşmada tersaneye gidecek.' : 'Bakım isteği iptal edildi.', 'info');
    devLog('game', `bakım isteği ${shipId}: ${!!ship.maintRequested} · durum %${Math.round(ship.condition)}`);
    this.changed();
  }

  setMaintThreshold(v: number): void {
    this.state.settings.maintThreshold = v;
    devLog('game', `otomatik bakım eşiği %${v}`);
    this.changed();
  }

  setTraffic(on: boolean): void {
    this.state.settings.traffic = on;
    devLog('game', `Boğaz trafiği: ${on}`);
    this.changed();
  }

  setNightSkip(on: boolean): void {
    this.state.settings.nightSkip = on;
    devLog('game', `geceyi hızlı geç: ${on}`);
    this.changed();
  }

  money(): string {
    return fmtMoney(this.state.money);
  }
}
