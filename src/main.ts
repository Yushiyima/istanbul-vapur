import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Popup, type MapLayerMouseEvent, type MapMouseEvent, type Map as MapLibreMap } from 'maplibre-gl';
import { PIER, SHIP_TYPES } from './config/balance.ts';
import { loadCityPack } from './cityPack.ts';
import { devLog, installDevLogBridge } from './devlog.ts';
import { Game } from './game.ts';
import type { LngLat } from './geo/geo.ts';
import { createMap, LAYER, renderDraft, renderGhost, renderNetwork, renderShips, setNoBuildEmphasis } from './map/mapView.ts';
import { catchmentOf } from './sim/catchment.ts';
import { berthsInUse, shipPose } from './sim/tick.ts';
import type { Pier, Ship } from './sim/types.ts';
import { escapeHtml } from './ui/html.ts';
import { createPanel } from './ui/panel.ts';
import { toast } from './ui/toast.ts';
import { createTopbar } from './ui/topbar.ts';

installDevLogBridge();

const SIDE_LABEL: Record<string, string> = { avrupa: 'Avrupa yakası', anadolu: 'Anadolu yakası', ada: 'Ada' };
const STATUS_LABEL: Record<string, string> = {
  transit: 'tersaneden hatta gidiyor',
  sailing: 'seferde',
  queue: 'yanaşma sırası bekliyor',
  dwell: 'iskelede',
  layover: 'terminalde, sefer saatini bekliyor',
};

async function main(): Promise<void> {
  const pack = await loadCityPack();
  const game = new Game(pack);
  game.setToast(toast);

  const map = await createMap(document.getElementById('map')!, pack);
  const panel = createPanel(document.getElementById('panel')!, game);
  const topbar = createTopbar(document.getElementById('topbar')!, game);
  const view = { showLoad: false };

  let cursor: LngLat | null = null;
  let lastSpeed = 1;
  const redraw = () => {
    renderNetwork(map, game, view);
    renderDraft(map, game, cursor);
    map.getCanvas().style.cursor = game.tool === 'pier' ? 'crosshair' : game.tool === 'line' ? 'cell' : '';
    setNoBuildEmphasis(map, game.tool === 'pier');
    if (game.tool !== 'pier') renderGhost(map, null);
  };
  game.onChange(() => {
    if (game.speedIndex) lastSpeed = game.speedIndex;
    panel.render();
    topbar.render();
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
  for (const layer of [LAYER.pier, LAYER.ship]) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => redraw());
  }

  map.on('mousemove', (ev: MapMouseEvent) => {
    cursor = [ev.lngLat.lng, ev.lngLat.lat];
    if (game.tool === 'pier') {
      const r = game.previewPlacement(cursor);
      renderGhost(map, r.coast ? { click: cursor, coast: r.coast, ok: r.ok } : null);
    } else if (game.tool === 'line' && game.draft.length) {
      renderDraft(map, game, cursor);
    }
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    cursor = null;
    renderGhost(map, null);
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
    if (game.tool === 'pier') game.placePier([ev.lngLat.lng, ev.lngLat.lat]);
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

  function openShipPopup(ship: Ship): void {
    const line = game.state.lines.find((l) => l.id === ship.lineId);
    const t = SHIP_TYPES[ship.type];
    const onboard = ship.onboard.reduce((s, g) => s + g.count, 0);
    const pier = ship.pierId ? game.state.piers.find((p) => p.id === ship.pierId) : undefined;
    const pose = shipPose(game.state, game.world, ship, 0);
    if (!pose) return;
    const el = document.createElement('div');
    el.className = 'pier-popup';
    el.innerHTML = `
      <h3>${t.name}</h3>
      <p>${line ? `<span class="ldot" style="background:${line.color}"></span>${escapeHtml(line.name)}` : ''}</p>
      <p>${STATUS_LABEL[ship.status]}${pier ? ` · ${escapeHtml(pier.name)}` : ''}</p>
      <p>Yolcu: ${onboard.toLocaleString('tr-TR')} / ${t.capacity} · ${t.speedKn} kn</p>`;
    infoPopup.setLngLat(pose.p).setDOMContent(el).addTo(map);
  }

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
  const frame = (now: number) => {
    const dt = Math.min(250, now - last);
    last = now;
    const frac = game.advance(dt);
    if (now - lastShips > 33) {
      renderShips(map, game, frac);
      lastShips = now;
    }
    if (now - lastUi > 250) {
      topbar.refresh();
      panel.refresh();
      lastUi = now;
    }
    if (now - lastNet > 2000) {
      renderNetwork(map, game, view);
      lastNet = now;
    }
    requestAnimationFrame(frame);
  };

  panel.render();
  topbar.render();
  redraw();
  requestAnimationFrame(frame);
  devLog('info', `harita hazır · ${game.world.historic.length} tarihi iskele · ${game.state.piers.length} iskele · ${game.state.lines.length} hat`);
  (window as unknown as { vapur: unknown }).vapur = { map, game };
}

main().catch((err: unknown) => {
  console.error(err);
  toast(`Başlatılamadı: ${err instanceof Error ? err.message : String(err)}`, 'error');
});
