import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Popup, type MapLayerMouseEvent, type MapMouseEvent, type Map as MapLibreMap } from 'maplibre-gl';
import { MAINT, PIER, SHIP_TYPES, TERSANE, TIME } from './config/balance.ts';
import { loadCityPack } from './cityPack.ts';
import { devLog, installDevLogBridge } from './devlog.ts';
import { Game } from './game.ts';
import type { LngLat } from './geo/geo.ts';
import { createMap, LAYER, renderDraft, renderGhost, renderNetwork, renderShips, setCoverageVisible, setNoBuildEmphasis, setOverlay } from './map/mapView.ts';
import { overlayData } from './map/overlay.ts';
import { horn, setSound } from './ui/sound.ts';
import { currentWeather } from './sim/events.ts';
import { waitingCount } from './sim/passengers.ts';
import { catchmentOf } from './sim/catchment.ts';
import { fmtMoney } from './sim/network.ts';
import { berthsInUse, shipPose } from './sim/tick.ts';
import type { Pier, Ship, Yard } from './sim/types.ts';
import { fleetCapacity, shipsAtYard } from './sim/yards.ts';
import { escapeHtml } from './ui/html.ts';
import { createPanel } from './ui/panel.ts';
import { toast } from './ui/toast.ts';
import { createSidebar } from './ui/sidebar.ts';
import { showModal } from './ui/modal.ts';
import { createTopbar, formatClock, formatDate } from './ui/topbar.ts';
import { AUTO_SLOT, MANUAL_SLOT } from './save/save.ts';

installDevLogBridge();

/** Performans logu eşikleri (geliştirme teşhisi; denge sayısı değil). */
const PERF_SLOW_FRAME_MS = 120;
const PERF_GAP_MS = 400;
const PERF_MAX_LOGS = 200;

const SIDE_LABEL: Record<string, string> = { avrupa: 'Avrupa yakası', anadolu: 'Anadolu yakası', ada: 'Ada' };
const STATUS_LABEL: Record<string, string> = {
  transit: 'tersaneden hatta gidiyor',
  sailing: 'seferde',
  queue: 'yanaşma sırası bekliyor',
  dwell: 'iskelede',
  layover: 'terminalde, sefer saatini bekliyor',
  toYard: 'tersaneye gidiyor',
  maintenance: 'bakımda',
};

async function main(): Promise<void> {
  const pack = await loadCityPack();
  const game = new Game(pack);
  game.setToast(toast);
  if (await game.load(AUTO_SLOT)) toast(`Kayıt yüklendi: ${formatDate(game.state.minute)} ${formatClock(game.state.minute)}`, 'info');

  const map = await createMap(document.getElementById('map')!, pack);
  const panel = createPanel(document.getElementById('panel')!, game);
  const topbar = createTopbar(document.getElementById('topbar')!, game);
  const sidebar = createSidebar(document.getElementById('sidebar')!, game, {
    onSave: async () => toast((await game.save(MANUAL_SLOT)) && (await game.save(AUTO_SLOT)) ? 'Oyun kaydedildi.' : 'Kayıt başarısız.', 'ok'),
    onLoad: async () => {
      const ok = (await game.load(MANUAL_SLOT)) || (await game.load(AUTO_SLOT));
      toast(ok ? `Kayıt yüklendi: ${formatDate(game.state.minute)}` : 'Kayıt bulunamadı.', ok ? 'ok' : 'error');
    },
    onNewGame: () => {
      if (!confirm('Yeni oyun başlasın mı? Otomatik kayıt üzerine yazılır.')) return;
      game.newGame();
      void game.save(AUTO_SLOT);
      toast('Yeni oyun başladı.', 'ok');
    },
    onLayer: (id) => {
      const cells = pack.data.cells;
      view.showLoad = id === 'load';
      setOverlay(map, (id === 'pop' || id === 'att') && cells ? overlayData(cells, id) : null);
      if ((id === 'pop' || id === 'att') && !cells) toast('Nüfus verisi yok: scripts/build-cells.mjs çalıştır.', 'error');
      renderNetwork(map, game, view);
      devLog('game', `katman: ${id}`);
    },
    onCoverage: (visible) => setCoverageVisible(map, visible),
    onSound: (on) => setSound(on),
    onMaintThreshold: (v) => game.setMaintThreshold(v),
    onNightSkip: (on) => game.setNightSkip(on),
  });
  const view = { showLoad: false };
  // Kalkışta düdük: gemi durumu yanaşmışken seyre geçtiyse ve ekrandaysa.
  const lastStatus = new Map<string, string>();
  function hornOnDepartures(): void {
    const bounds = map.getBounds();
    for (const ship of game.state.ships) {
      const prev = lastStatus.get(ship.id);
      lastStatus.set(ship.id, ship.status);
      if (ship.status !== 'sailing' || (prev !== 'layover' && prev !== 'dwell')) continue;
      const pose = shipPose(game.state, game.world, ship, 0);
      if (pose && bounds.contains(pose.p)) {
        horn();
        break;
      }
    }
  }

  let cursor: LngLat | null = null;
  let lastSpeed = 1;
  const redraw = () => {
    renderNetwork(map, game, view);
    renderDraft(map, game, cursor);
    const placing = game.tool === 'pier' || game.tool === 'yard';
    map.getCanvas().style.cursor = placing ? 'crosshair' : game.tool === 'line' ? 'cell' : '';
    setNoBuildEmphasis(map, placing);
    if (!placing) renderGhost(map, null);
  };
  game.onChange(() => {
    if (game.speedIndex) lastSpeed = game.speedIndex;
    panel.render();
    topbar.render();
    sidebar.render();
    redraw();
  });

  // ---------------------------------------------------------------- etkileşim
  const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'hover-popup' });
  map.on('mousemove', LAYER.historic, (ev: MapLayerMouseEvent) => {
    const f = ev.features?.[0];
    if (!f || f.geometry.type !== 'Point') return;
    hoverPopup
      .setLngLat(f.geometry.coordinates as LngLat)
      .setHTML(`<strong>${escapeHtml(String(f.properties.name))}</strong><br><small>Tarihi iskele · burada kurmak indirimli</small>`)
      .addTo(map);
  });
  map.on('mouseleave', LAYER.historic, () => hoverPopup.remove());
  for (const layer of [LAYER.pier, LAYER.ship, LAYER.yard]) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => redraw());
  }

  map.on('mousemove', (ev: MapMouseEvent) => {
    cursor = [ev.lngLat.lng, ev.lngLat.lat];
    if (game.tool === 'pier') {
      const r = game.previewPlacement(cursor);
      renderGhost(map, r.coast ? { click: cursor, coast: r.coast, ok: r.ok } : null);
      showTip(ev.point, r.ok ? `≈ ${fmtMoney(game.placementCost(r.coast))}` : r.message, r.ok);
    } else if (game.tool === 'yard') {
      const r = game.previewYard(cursor);
      renderGhost(map, r.coast ? { click: cursor, coast: r.coast, ok: r.ok } : null);
      showTip(ev.point, r.ok ? `Tersane ${fmtMoney(TERSANE.buildCost)}` : r.message, r.ok);
    } else if (game.tool === 'line' && game.draft.length) {
      renderDraft(map, game, cursor);
    }
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    cursor = null;
    renderGhost(map, null);
    tip.hidden = true;
  });

  // İskele aracında imleç yanında maliyet / ret sebebi.
  const tip = document.createElement('div');
  tip.className = 'cursor-tip';
  tip.hidden = true;
  document.body.append(tip);
  let lastTipCoast = '';
  function showTip(pt: { x: number; y: number }, text: string, ok: boolean): void {
    tip.hidden = false;
    tip.style.transform = `translate(${pt.x + 16}px, ${pt.y + 14}px)`;
    if (lastTipCoast !== text) {
      tip.textContent = text;
      tip.classList.toggle('bad', !ok);
      lastTipCoast = text;
    }
  }
  game.onChange(() => {
    if (game.tool !== 'pier' && game.tool !== 'yard') tip.hidden = true;
  });

  const infoPopup = new Popup({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: '290px' });
  map.on('click', (ev: MapMouseEvent) => {
    const pier = featureAt(map, ev, LAYER.pier, (id) => game.state.piers.find((p) => p.id === id));
    if (game.tool === 'line') {
      if (pier) game.clickPierForLine(pier.id);
      else game.toast('Hat için bir iskeleye tıkla.', 'info');
      return;
    }
    if (pier) return openPierPopup(pier);
    const ship = featureAt(map, ev, LAYER.ship, (id) => game.state.ships.find((s) => s.id === id));
    if (ship) return openShipPopup(ship);
    const yard = featureAt(map, ev, LAYER.yard, (id) => game.state.yards.find((y) => y.id === id));
    if (yard) return openYardPopup(yard);
    if (game.tool === 'pier') game.placePier([ev.lngLat.lng, ev.lngLat.lat]);
    else if (game.tool === 'yard') game.placeYard([ev.lngLat.lng, ev.lngLat.lat]);
  });

  function featureAt<T>(m: MapLibreMap, ev: MapMouseEvent, layer: string, get: (id: string) => T | undefined): T | undefined {
    const pad = 6;
    const { x, y } = ev.point;
    const f = m.queryRenderedFeatures(
      [
        [x - pad, y - pad],
        [x + pad, y + pad],
      ],
      { layers: [layer] },
    )[0];
    return f ? get(String(f.properties.id)) : undefined;
  }

  function openPierPopup(pier: Pier): void {
    const { state, world } = game;
    const lines = state.lines.filter((l) => l.pierIds.includes(pier.id));
    const waiting = (state.waiting[pier.id] ?? []).reduce((s, g) => s + g.count, 0);
    const c = catchmentOf(world, pier);
    const el = document.createElement('div');
    el.className = 'pier-popup';
    el.innerHTML = `
      <h3>${escapeHtml(pier.name)}</h3>
      <p class="tag-row">${pier.historicId ? '<span class="tag">Tarihi iskele</span>' : ''}<span class="tag side">${SIDE_LABEL[pier.side]}</span></p>
      <p>Yanaşma yeri: ${berthsInUse(state, pier.id)} / ${pier.berths} dolu · Bekleyen: ${waiting.toLocaleString('tr-TR')} yolcu</p>
      <p>Kapsama (${PIER.coverageRadiusM} m): ${Math.round(c.pop).toLocaleString('tr-TR')} kişi · çekim ${Math.round(c.att).toLocaleString('tr-TR')}</p>
      <p>Hatlar: ${lines.length ? lines.map((l) => `<span class="ldot" style="background:${l.color}"></span>${escapeHtml(l.name)}`).join(', ') : '—'}</p>
      <div class="row">
        <button type="button" data-a="berth">+1 yanaşma yeri</button>
        <button type="button" class="danger" data-a="delete">Sil</button>
      </div>`;
    el.querySelector('[data-a=berth]')!.addEventListener('click', () => {
      game.upgradeBerths(pier.id);
      openPierPopup(pier);
    });
    el.querySelector('[data-a=delete]')!.addEventListener('click', () => {
      if (lines.length && !confirm(`${pier.name} ${lines.length} hatta kullanılıyor; hatlar da kapanacak. Silinsin mi?`)) return;
      infoPopup.remove();
      game.deletePier(pier.id);
    });
    infoPopup.setLngLat(pier.coast).setDOMContent(el).addTo(map);
  }

  /** Açık gemi popup'ı: konumu ve sayıları canlı güncellenir. */
  let shipPopupId: string | null = null;
  infoPopup.on('close', () => (shipPopupId = null));

  function shipPopupHtml(ship: Ship): string {
    const { state } = game;
    const line = state.lines.find((l) => l.id === ship.lineId);
    const t = SHIP_TYPES[ship.type];
    const onboard = ship.onboard.reduce((s, g) => s + g.count, 0);
    const pier = ship.pierId ? state.piers.find((p) => p.id === ship.pierId) : undefined;
    const yard = state.yards.find((y) => y.id === ship.yardId);
    const ageDays = Math.floor((state.minute - ship.builtAt) / TIME.minutesPerDay);
    const cond = Math.round(ship.condition);
    const condCls = cond < MAINT.breakdownBelow ? 'bad' : cond < 60 ? 'mid' : 'good';
    const avgLoad = (c: { loadSum: number; loadN: number }) => (c.loadN ? Math.round((100 * c.loadSum) / c.loadN) : 0);
    const where = ship.status === 'maintenance' ? `${yard?.name ?? 'tersane'} · ${ship.readyAt ? `bitiş ${formatClock(ship.readyAt)}` : 'yuva bekliyor'}` : ship.status === 'toYard' ? `${yard?.name ?? 'tersaneye'} gidiyor${ship.broken ? ' (arızalı, çekiliyor)' : ''}` : pier ? escapeHtml(pier.name) : '';
    const num = (n: number) => Math.round(n).toLocaleString('tr-TR');
    return `
      <h3>${t.name} <span class="small">#${ship.id.replace('ship-', '')}</span></h3>
      <p>${line ? `<span class="ldot" style="background:${line.color}"></span>${escapeHtml(line.name)}` : ''}</p>
      <p>${STATUS_LABEL[ship.status]}${where ? ` · ${where}` : ''}${ship.maintRequested ? ' · <b>bakım istendi</b>' : ''}</p>
      <div class="cond"><span>Bakım durumu</span><div class="bar ${condCls}"><i style="width:${cond}%"></i></div><b>%${cond}</b></div>
      <table class="stats">
        <tr><th></th><th>Bugün</th><th>Toplam</th></tr>
        <tr><td>Sefer</td><td>${num(ship.today.trips)}</td><td>${num(ship.total.trips)}</td></tr>
        <tr><td>Yolcu</td><td>${num(ship.today.boardings)}</td><td>${num(ship.total.boardings)}</td></tr>
        <tr><td>Gelir</td><td>${fmtMoney(ship.today.revenue)}</td><td>${fmtMoney(ship.total.revenue)}</td></tr>
        <tr><td>Ort. doluluk</td><td>%${avgLoad(ship.today)}</td><td>%${avgLoad(ship.total)}</td></tr>
        <tr><td>Mesafe</td><td>${num(ship.today.km)} km</td><td>${num(ship.total.km)} km</td></tr>
      </table>
      <p class="small">Şu an ${num(onboard)} / ${t.capacity} yolcu · ${t.speedKn} kn (durum nedeniyle %${Math.round(100 * (MAINT.minSpeedFactor + ((1 - MAINT.minSpeedFactor) * ship.condition) / 100))} hız) · yaş ${ageDays} gün</p>
      <div class="row">
        <button type="button" data-a="maint" ${ship.status === 'toYard' || ship.status === 'maintenance' ? 'disabled' : ''}>${ship.maintRequested ? 'Bakım isteğini iptal et' : 'Bakıma gönder'}</button>
        <button type="button" class="danger" data-a="sell">Sat</button>
      </div>`;
  }

  function openShipPopup(ship: Ship): void {
    const pose = shipPose(game.state, game.world, ship, 0);
    if (!pose) return;
    const el = document.createElement('div');
    el.className = 'pier-popup ship-popup';
    el.innerHTML = shipPopupHtml(ship);
    el.addEventListener('click', (ev) => {
      const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a === 'maint') game.toggleMaintenance(ship.id);
      if (a === 'sell' && confirm('Gemi yarı fiyatına satılsın mı?')) {
        game.sellShipById(ship.id);
        infoPopup.remove();
        return;
      }
      el.innerHTML = shipPopupHtml(ship);
    });
    shipPopupId = ship.id;
    infoPopup.setLngLat(pose.p).setDOMContent(el).addTo(map);
  }

  /** Gemi popup'ını gemiyle birlikte taşı ve sayıları yenile (4 Hz). */
  function refreshShipPopup(): void {
    if (!shipPopupId) return;
    const ship = game.state.ships.find((s) => s.id === shipPopupId);
    if (!ship) {
      infoPopup.remove();
      return;
    }
    const pose = shipPose(game.state, game.world, ship, 0);
    if (pose) infoPopup.setLngLat(pose.p);
    const el = infoPopup.getElement()?.querySelector<HTMLElement>('.ship-popup');
    if (el && !el.matches(':hover')) el.innerHTML = shipPopupHtml(ship);
  }

  function openYardPopup(yard: Yard): void {
    const { state } = game;
    const at = shipsAtYard(state, yard.id);
    const el = document.createElement('div');
    el.className = 'pier-popup';
    const list = (ships: Ship[], label: string) =>
      ships.length ? `<p class="small">${label}: ${ships.map((s) => `${SHIP_TYPES[s.type].name} #${s.id.replace('ship-', '')}${s.readyAt ? ` (${formatClock(s.readyAt)})` : ''}`).join(', ')}</p>` : '';
    el.innerHTML = `
      <h3>⚓ ${escapeHtml(yard.name)}</h3>
      <p>Filo kapasitesine katkı: <b>${yard.capacity}</b> gemi (toplam ${state.ships.length} / ${fleetCapacity(state)})</p>
      <p>Bakım yuvası: ${at.active.length} / ${yard.slots} dolu · sırada ${at.queued.length} · yolda ${at.inbound.length}</p>
      ${list(at.active, 'Bakımda')}${list(at.queued, 'Sırada')}${list(at.inbound, 'Geliyor')}
      <p class="small">Bakım ${Math.round(MAINT.durationMin / 60)} saat sürer, ücreti gemi fiyatının %${Math.round(MAINT.costRatio * 100)}'sı (arızada ×${MAINT.breakdownCostMul}).</p>
      <div class="row">
        <button type="button" data-a="cap">+${TERSANE.upgradeStep} kapasite (${fmtMoney(TERSANE.upgradeCost)})</button>
        <button type="button" data-a="slot">+1 yuva (${fmtMoney(TERSANE.slotCost)})</button>
      </div>`;
    el.querySelector('[data-a=cap]')!.addEventListener('click', () => {
      game.upgradeYard(yard.id, 'capacity');
      openYardPopup(yard);
    });
    el.querySelector('[data-a=slot]')!.addEventListener('click', () => {
      game.upgradeYard(yard.id, 'slots');
      openYardPopup(yard);
    });
    shipPopupId = null;
    infoPopup.setLngLat(yard.coast).setDOMContent(el).addTo(map);
  }
  game.focusYard = (id) => {
    const y = game.state.yards.find((x) => x.id === id);
    if (!y) return;
    map.flyTo({ center: y.coast, zoom: Math.max(map.getZoom(), 13.5) });
    openYardPopup(y);
  };

  // ---------------------------------------------------------------- klavye
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLocaleLowerCase('tr');
    if (ev.key === 'Escape') {
      if (game.tool === 'line' && game.draft.length) game.cancelDraft();
      else game.setTool('pan');
    } else if (ev.key === 'Enter' && game.tool === 'line') game.finishDraft();
    else if (ev.key === 'Backspace' && game.tool === 'line') game.undoDraft();
    else if (k === 'g') game.setTool('pan');
    else if (k === 'i' || k === 'ı') game.setTool('pier');
    else if (k === 'h') game.setTool('line');
    else if (k === 't') game.setTool('yard');
    else if (ev.key === ' ') {
      ev.preventDefault();
      game.setSpeed(game.speedIndex === 0 ? lastSpeed : 0);
    } else if (/^[1-4]$/.test(ev.key)) game.setSpeed(Number(ev.key));
  });

  // ---------------------------------------------------------------- döngü
  let last = performance.now();
  let lastUi = 0;
  let lastNet = 0;
  let lastShips = 0;
  let lastHourLogged = -1;
  let slowFrames = 0;
  const frame = (now: number) => {
    const gap = now - last;
    const dt = Math.min(250, gap);
    last = now;
    const frac = game.advance(dt);
    const tAdv = game.lastAdvance;
    if (now - lastShips > 33) {
      try {
        renderShips(map, game, frac);
        hornOnDepartures();
      } catch (err) {
        if (slowFrames++ < PERF_MAX_LOGS) devLog('error', 'gemi çizimi hatası:', err);
      }
      lastShips = now;
    }
    if (now - lastUi > 250) {
      topbar.refresh();
      panel.refresh();
      sidebar.refresh();
      refreshShipPopup();
      for (const n of game.drainNotices()) toast(n.text, n.kind);
      if (game.state.pendingYearSummary) showYearSummary();
      game.autosave();
      lastUi = now;
    }
    // Kapsama alanları kareler arasına yayılarak hesaplanır; biri bitince ağ yeniden çizilir.
    if (game.pumpCoverage() || now - lastNet > 2000) {
      renderNetwork(map, game, view);
      lastNet = now;
    }
    // Performans: kare uzun sürdüyse ya da kareler arası boşluk büyükse logla.
    const work = performance.now() - now;
    if ((work > PERF_SLOW_FRAME_MS || (gap > PERF_GAP_MS && document.visibilityState === 'visible')) && slowFrames < PERF_MAX_LOGS) {
      slowFrames++;
      devLog('perf', `yavaş kare: iş ${Math.round(work)} ms (tick ${tAdv.ticks} = ${Math.round(tAdv.ms)} ms) · kareler arası ${Math.round(gap)} ms · hız ${game.speed}× · gemi ${game.state.ships.length} · iskele ${game.state.piers.length} · bekleyen grup ${Object.values(game.state.waiting).reduce((s, l) => s + l.length, 0)}`);
    }
    // Saatlik nabız: kasa ve durum (loglardan oyunun gidişatı okunabilsin).
    const hour = Math.floor(game.state.minute / 60);
    if (hour !== lastHourLogged && game.state.minute % 60 < 5) {
      lastHourLogged = hour;
      const s = game.state;
      const st: Record<string, number> = {};
      for (const sh of s.ships) st[sh.status] = (st[sh.status] ?? 0) + 1;
      const statuses = Object.entries(st).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
      devLog('pulse', `${formatDate(s.minute)} ${formatClock(s.minute)} · kasa ${fmtMoney(s.money)} · memnuniyet %${Math.round(s.satisfaction)} · bugün ${s.today.boardings} yolcu · bekleyen ${waitingCount(s)} · kaçan ${s.today.tripsMissed} · hava ${currentWeather(s)}${s.tanker ? ' +tanker' : ''} · gemiler: ${statuses} · hız ${game.speed}×`);
    }
    requestAnimationFrame(frame);
  };

  function showYearSummary(): void {
    const y = game.state.pendingYearSummary!;
    game.state.pendingYearSummary = null;
    const resume = game.speedIndex;
    game.setSpeed(0);
    const row = (k: string, v: string) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    showModal(
      `${y.year}. yıl özeti`,
      `<table>
        ${row('Yolcu', y.boardings.toLocaleString('tr-TR'))}
        ${row('Gelir', fmtMoney(y.revenue))}
        ${row('Gider', fmtMoney(y.costs))}
        ${row('Net', fmtMoney(y.revenue - y.costs))}
        ${row('Ortalama memnuniyet', `%${y.satisfaction.toFixed(1)}`)}
        ${row('Yıl sonu ödülü', fmtMoney(y.rewards))}
      </table>
      <p class="small">${y.satisfaction >= 95 ? '🏆 %95 memnuniyet hedefi tamam!' : 'İpucu: %95 ortalama memnuniyetle biten yıl büyük ödül verir.'}</p>`,
      () => game.setSpeed(resume || 1),
    );
    devLog('game', `yıl sonu ${y.year}: yolcu ${y.boardings} · net ${Math.round(y.revenue - y.costs)} · memnuniyet ${y.satisfaction.toFixed(1)}`);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      game.quickSave();
      void game.save(AUTO_SLOT);
    }
    devLog('info', `sekme ${document.visibilityState === 'hidden' ? 'gizlendi (oyun duraklar)' : 'göründü'} · ${formatClock(game.state.minute)}`);
  });
  window.addEventListener('pagehide', () => game.quickSave());
  map.on('webglcontextlost', () => devLog('error', 'WebGL bağlamı kayboldu: harita çizimi durdu'));
  map.on('webglcontextrestored', () => devLog('info', 'WebGL bağlamı geri geldi'));

  panel.render();
  topbar.render();
  sidebar.render();
  redraw();
  requestAnimationFrame(frame);
  devLog('info', `harita hazır · ${game.world.historic.length} tarihi iskele · ${game.state.piers.length} iskele · ${game.state.lines.length} hat`);
  (window as unknown as { vapur: unknown }).vapur = { map, game };
}

main().catch((err: unknown) => {
  console.error(err);
  toast(`Başlatılamadı: ${err instanceof Error ? err.message : String(err)}`, 'error');
});
