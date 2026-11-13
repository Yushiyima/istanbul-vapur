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
import { createGame } from './sim/state.ts';
import { tick } from './sim/tick.ts';
import type { GameState, Pier, ShipTypeId } from './sim/types.ts';
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
    this.state = state ?? this.newState();
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
  advance(dtMs: number): number {
    if (!this.speed) return 0;
    this.acc += (dtMs * this.speed) / TIME.realMsPerMinute;
    let n = 0;
    while (this.acc >= 1 && n < TIME.maxTicksPerFrame) {
      tick(this.state, this.world);
      this.acc -= 1;
      n++;
    }
    if (this.acc > 1) this.acc = 1; // yetişemiyorsak birikmesin
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
    devLog('game', `iskele kuruldu "${name}"${match ? ` (tarihi: ${match.id})` : ''} tık=${fmtLL(click)} kıyı=${fmtLL(r.coast)} yapışma=${Math.round(r.snapDistanceM)} m · ${res.value.side} · toplam ${this.state.piers.length}`);
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
    if (r.ok) this.toast(`Yanaşma yeri ${r.value} oldu.`, 'ok');
    else this.toast(r.message, 'error');
    this.changed();
  }

  /** İskelenin karadaki kapsama alanı (önbellekli). */
  coverage(pier: Pier): PolygonCoords[] {
    let c = this.coverageCache.get(pier.id);
    if (!c) {
      c = landCoverage(pier.coast, pier.comp, this.waterIndex, this.world.grid);
      this.coverageCache.set(pier.id, c);
    }
    return c;
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
    const r = createLine(this.state, this.world, this.draft);
    if (!r.ok) {
      this.toast(r.message, 'error');
      devLog('game', `hat reddedildi: ${r.message}`);
      return;
    }
    const ship = buyShip(this.state, this.world, r.value.id);
    this.toast(ship.ok ? `${r.value.name} hattı açıldı, ilk vapur tersaneden yola çıktı.` : `${r.value.name} hattı açıldı. ${ship.message}`, ship.ok ? 'ok' : 'error');
    devLog('game', `hat açıldı "${r.value.name}" (${r.value.pierIds.length} iskele) · gemi: ${ship.ok ? 'var' : ship.message}`);
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
    devLog('game', `gece seferi ${id} = ${night}`);
    this.changed();
  }

  addShip(id: string): void {
    const r = buyShip(this.state, this.world, id);
    if (!r.ok) this.toast(r.message, 'error');
    else devLog('game', `gemi alındı ${id} (${r.value.type})`);
    this.changed();
  }

  removeShip(id: string): void {
    const r = sellShip(this.state, id);
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
    this.toast(r.ok ? `Tersane kapasitesi ${r.value} gemi.` : r.message, r.ok ? 'ok' : 'error');
    this.changed();
  }

  money(): string {
    return fmtMoney(this.state.money);
  }
}
