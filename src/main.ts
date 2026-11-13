import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { Popup, type MapLayerMouseEvent, type MapMouseEvent, type Map as MapLibreMap } from 'maplibre-gl';
import { PIER } from './config/balance.ts';
import { loadCityPack, type CityPack } from './cityPack.ts';
import { buildCoastIndex, snapToCoast, type CoastIndex, type LngLat } from './geo/geo.ts';
import { createMap, LAYER, renderGhost, renderHistoric, renderPiers, setNoBuildEmphasis, type HistoricMarker } from './map/mapView.ts';
import { evaluatePlacement, findHistoricMatch, normalizeName, pickPierName, PierNetwork, uniqueName, type Pier } from './sim/piers.ts';
import { devLog, installDevLogBridge } from './devlog.ts';
import { toast } from './ui/toast.ts';

installDevLogBridge();

const fmtLL = (p: LngLat) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;
import { createToolbar, type Tool } from './ui/toolbar.ts';

/** Tarihi iskeleleri kıyıya yapıştırır; çok uzak olanlar için konsola uyarı basar. */
function snapHistoric(pack: CityPack, coast: CoastIndex): HistoricMarker[] {
  const out: HistoricMarker[] = [];
  for (const h of pack.historic) {
    const snap = snapToCoast(coast, [h.lng, h.lat]);
    if (!snap) {
      console.warn(`[tarihi iskele] ${h.name}: kıyı bulunamadı, atlandı.`);
      continue;
    }
    if (snap.distanceM > PIER.historicWarnDistanceM) {
      console.warn(
        `[tarihi iskele] ${h.name} kıyıdan ${Math.round(snap.distanceM)} m uzakta (sınır ${PIER.historicWarnDistanceM} m). ` +
          `Kıyı noktası: ${snap.point[1].toFixed(5)}, ${snap.point[0].toFixed(5)}`,
      );
    }
    out.push({ id: h.id, name: h.name, coast: snap.point, snapDistanceM: snap.distanceM });
  }
  return out;
}

async function main(): Promise<void> {
  const mapEl = document.getElementById('map')!;
  const toolbarEl = document.getElementById('toolbar')!;

  // Araç çubuğu harita yüklenmeden görünsün; araç değişimi harita hazır olunca bağlanır.
  let onToolChange: (t: Tool) => void = () => {};
  const toolbar = createToolbar(toolbarEl, (t) => onToolChange(t));

  const pack = await loadCityPack();
  const coast = buildCoastIndex(pack.coastLines);
  const historic = snapHistoric(pack, coast);
  const network = new PierNetwork();

  const usedHistoricIds = () => new Set(network.list().flatMap((p) => (p.historicId ? [p.historicId] : [])));

  function tryPlace(click: LngLat, quiet = false): Pier | null {
    const result = evaluatePlacement(click, { coast, bbox: pack.bbox, piers: network.list(), noBuild: pack.noBuildZones });
    if (!result.ok) {
      if (!quiet) toast(result.message, 'error');
      devLog('game', `iskele reddedildi [${result.reason}] tık=${fmtLL(click)} · ${result.message}`);
      return null;
    }
    const used = usedHistoricIds();
    const match = findHistoricMatch(result.coast, historic.filter((h) => !used.has(h.id)));
    if (match) {
      // Tarihi iskele kendi adını alır; ad daha önce sıradan bir iskeleye verildiyse o "X 2" olur.
      const holder = network.list().find((p) => !p.historicId && normalizeName(p.name) === normalizeName(match.name));
      if (holder) {
        const renamed = uniqueName(match.name, network.names());
        network.rename(holder.id, renamed);
        devLog('game', `iskele yeniden adlandırıldı "${holder.name}" → "${renamed}" (tarihi ${match.name} için)`);
      }
    }
    const name = match
      ? uniqueName(match.name, network.names())
      : pickPierName(result.coast, pack.places, { used: network.names(), historicNames: historic.map((h) => h.name) });
    const pier = network.add({ name, coast: result.coast, dock: result.dock, ...(match ? { historicId: match.id } : {}) });
    if (!quiet) toast(match ? `${name} tarihi iskelesi yeniden açıldı.` : `${name} iskelesi kuruldu.`, 'ok');
    devLog(
      'game',
      `iskele kuruldu "${name}"${match ? ` (tarihi: ${match.id})` : ''} tık=${fmtLL(click)} kıyı=${fmtLL(result.coast)} ` +
        `yapışma=${Math.round(result.snapDistanceM)} m · toplam ${network.list().length}`,
    );
    return pier;
  }

  // Öğretici başlangıç: Eminönü ve Kadıköy (hat Aşama 2'de).
  for (const h of pack.historic.filter((x) => x.start)) {
    if (!tryPlace([h.lng, h.lat], true)) console.warn(`[başlangıç] ${h.name} iskelesi kurulamadı.`);
  }

  const map = await createMap(mapEl, pack);

  let tool: Tool = 'pan';
  onToolChange = (t) => setTool(t);

  function render(): void {
    renderPiers(map, network.list());
    renderHistoric(map, historic, usedHistoricIds());
    toolbar.setPierCount(network.list().length);
  }

  function setTool(t: Tool): void {
    if (t !== tool) devLog('game', `araç: ${t}`);
    tool = t;
    toolbar.setTool(t);
    map.getCanvas().style.cursor = t === 'pier' ? 'crosshair' : '';
    setNoBuildEmphasis(map, t === 'pier');
    if (t !== 'pier') renderGhost(map, null);
  }

  // ---- tarihi iskele: üstüne gelince ad
  const hoverPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'hover-popup' });
  map.on('mousemove', LAYER.historic, (ev: MapLayerMouseEvent) => {
    const f = ev.features?.[0];
    if (!f || f.geometry.type !== 'Point') return;
    hoverPopup
      .setLngLat(f.geometry.coordinates as LngLat)
      .setHTML(`<strong>${escapeHtml(String(f.properties.name))}</strong><br><small>Tarihi iskele · burada kurmak indirimli olacak</small>`)
      .addTo(map);
    if (tool === 'pan') map.getCanvas().style.cursor = 'help';
  });
  map.on('mouseleave', LAYER.historic, () => {
    hoverPopup.remove();
    if (tool === 'pan') map.getCanvas().style.cursor = '';
  });

  // ---- iskele: üstüne gelince el imleci
  map.on('mouseenter', LAYER.pier, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', LAYER.pier, () => (map.getCanvas().style.cursor = tool === 'pier' ? 'crosshair' : ''));

  // ---- yerleştirme önizlemesi
  map.on('mousemove', (ev: MapMouseEvent) => {
    if (tool !== 'pier') return;
    const click: LngLat = [ev.lngLat.lng, ev.lngLat.lat];
    const r = evaluatePlacement(click, { coast, bbox: pack.bbox, piers: network.list(), noBuild: pack.noBuildZones });
    const coastPt = r.coast;
    renderGhost(map, coastPt ? { click, coast: coastPt, ok: r.ok } : null);
  });
  map.getCanvas().addEventListener('mouseleave', () => renderGhost(map, null));

  // ---- tıklama
  const pierPopup = new Popup({ closeButton: true, closeOnClick: true, offset: 14, maxWidth: '260px' });
  map.on('click', (ev: MapMouseEvent) => {
    const hit = pierAt(map, ev);
    if (hit) {
      openPierPopup(hit);
      return;
    }
    if (tool === 'pier') {
      if (tryPlace([ev.lngLat.lng, ev.lngLat.lat])) {
        render();
        renderGhost(map, null);
      }
    }
  });

  function pierAt(m: MapLibreMap, ev: MapMouseEvent): Pier | undefined {
    const pad = 6;
    const { x, y } = ev.point;
    const f = m.queryRenderedFeatures(
      [
        [x - pad, y - pad],
        [x + pad, y + pad],
      ],
      { layers: [LAYER.pier] },
    )[0];
    return f ? network.get(String(f.properties.id)) : undefined;
  }

  function openPierPopup(pier: Pier): void {
    const el = document.createElement('div');
    el.className = 'pier-popup';
    const historicName = pier.historicId ? historic.find((h) => h.id === pier.historicId)?.name : undefined;
    el.innerHTML = `
      <h3>${escapeHtml(pier.name)}</h3>
      ${historicName ? `<p class="tag">Tarihi iskele</p>` : ''}
      <p>Kapsama: ${PIER.coverageRadiusM} m yürüme</p>
      <p class="coords">${pier.coast[1].toFixed(5)}, ${pier.coast[0].toFixed(5)}</p>
      <button type="button" class="danger">İskeleyi sil</button>`;
    el.querySelector('button')!.addEventListener('click', () => {
      network.remove(pier.id);
      pierPopup.remove();
      render();
      toast(`${pier.name} iskelesi silindi.`, 'info');
      devLog('game', `iskele silindi "${pier.name}" · toplam ${network.list().length}`);
    });
    pierPopup.setLngLat(pier.coast).setDOMContent(el).addTo(map);
  }

  render();
  setTool('pan');
  devLog('info', `harita hazır · ${historic.length} tarihi iskele · ${network.list().length} başlangıç iskelesi`);
  (window as unknown as { vapur: unknown }).vapur = { map, network, pack, coast };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

main().catch((err: unknown) => {
  console.error(err);
  toast(`Başlatılamadı: ${err instanceof Error ? err.message : String(err)}`, 'error');
});
