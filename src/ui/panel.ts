/**
 * Sol panel: araçlar, hat taslağı, hat listesi, tersane.
 * Tam yeniden çizim sadece game.changed() ile; canlı sayılar `refresh()` ile güncellenir.
 */
import { LINE, SHIP_TYPES, TERSANE } from '../config/balance.ts';
import type { Game, Tool } from '../game.ts';
import { cycleMinutes, fmtMoney, requiredShips, shipsOnLine } from '../sim/network.ts';
import { fleetCapacity, shipsAtYard } from '../sim/yards.ts';
import type { ShipTypeId } from '../sim/types.ts';
import { escapeHtml } from './html.ts';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'pan', label: 'Gez', key: 'G', hint: 'Haritayı gez. İskeleye ya da gemiye tıklayınca bilgisi çıkar.' },
  { id: 'pier', label: 'İskele', key: 'İ', hint: 'Kıyıya yakın bir yere tıkla: iskele en yakın kıyı noktasına yapışır. Esc: çık.' },
  { id: 'line', label: 'Hat', key: 'H', hint: 'İskelelere sırayla tıkla. Bitirmek için son iskeleye tekrar tıkla ya da Enter. Esc: iptal.' },
  { id: 'yard', label: 'Tersane', key: 'T', hint: `Kıyıya tersane kur (${fmtMoney(TERSANE.buildCost)}): +${TERSANE.buildCapacity} gemi kapasitesi, bakım yuvası. Yeni gemi ve bakım en yakın tersaneye gider.` },
];

export function createPanel(root: HTMLElement, game: Game): { render(): void; refresh(): void } {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const id = el.dataset.line ?? '';
    switch (el.dataset.action) {
      case 'tool':
        game.setTool(el.dataset.tool as Tool);
        break;
      case 'draft-finish':
        game.finishDraft();
        break;
      case 'draft-undo':
        game.undoDraft();
        break;
      case 'draft-cancel':
        game.cancelDraft();
        break;
      case 'ship-add':
        game.addShip(id);
        break;
      case 'ship-remove':
        game.removeShip(id);
        break;
      case 'line-select':
        game.selectedLineId = game.selectedLineId === id ? null : id;
        game.changed();
        break;
      case 'line-edit':
        game.editLine(id);
        break;
      case 'line-delete':
        if (confirm('Hat kapatılsın mı? Gemiler yarı fiyatına satılır.')) game.deleteLine(id);
        break;
      case 'yard-focus':
        game.focusYard?.(el.dataset.yard ?? '');
        break;
    }
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement | HTMLSelectElement;
    const id = el.dataset.line ?? '';
    if (el.dataset.action === 'interval') game.setInterval(id, Number(el.value));
    if (el.dataset.action === 'type') game.setShipType(id, el.value as ShipTypeId);
    if (el.dataset.action === 'night' && el instanceof HTMLInputElement) game.setNight(id, el.checked);
  });

  function render(): void {
    const { state, world } = game;
    const tool = TOOLS.find((t) => t.id === game.tool)!;
    const draftNames = game.draft.map((id) => state.piers.find((p) => p.id === id)?.name ?? '?');

    const lines = state.lines
      .map((line) => {
        const ships = shipsOnLine(state, line.id).length;
        const need = requiredShips(world, state, line);
        const cycle = Math.round(cycleMinutes(world, state, line));
        const intervals = [...new Set<number>([...LINE.intervalOptions, line.intervalMin])].sort((a, b) => a - b);
        const sel = line.id === game.selectedLineId;
        return `
        <div class="line-card${sel ? ' selected' : ''}" style="--c:${line.color}">
          <button class="line-name" data-action="line-select" data-line="${line.id}" title="Haritada vurgula">
            <span class="dot"></span>${escapeHtml(line.name)}
          </button>
          <div class="line-meta">${line.pierIds.length} iskele · tur ${cycle} dk</div>
          <div class="row">
            <label>Sefer
              <select data-action="interval" data-line="${line.id}">
                ${intervals.map((m) => `<option value="${m}"${m === line.intervalMin ? ' selected' : ''}>${m} dk</option>`).join('')}
              </select>
            </label>
            <label>Tip
              <select data-action="type" data-line="${line.id}">
                ${(Object.keys(SHIP_TYPES) as ShipTypeId[]).map((t) => `<option value="${t}"${t === line.shipType ? ' selected' : ''}>${SHIP_TYPES[t].name}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="row">
            <span class="ships${ships < need ? ' warn' : ''}">⛴ ${ships} / ${need} gemi</span>
            <button data-action="ship-remove" data-line="${line.id}" title="Gemi sat">−</button>
            <button data-action="ship-add" data-line="${line.id}" title="Gemi al (${fmtMoney(SHIP_TYPES[line.shipType].price)})">+</button>
            <label class="night" title="24 saat sefer"><input type="checkbox" data-action="night" data-line="${line.id}"${line.night ? ' checked' : ''}> Gece</label>
          </div>
          ${ships < need ? `<p class="warn-text">Bu aralığı tutturmak için en az ${need} gemi gerekli; seferler kaçacak.</p>` : ''}
          <div class="line-live" data-live-line="${line.id}"></div>
          <div class="row"><button class="link" data-action="line-edit" data-line="${line.id}">✎ Düzenle</button><button class="link danger-link" data-action="line-delete" data-line="${line.id}">Hattı kapat</button></div>
        </div>`;
      })
      .join('');

    root.innerHTML = `
      <div class="brand">Vapur <span>İstanbul</span></div>
      <div class="tools" role="toolbar" aria-label="Araçlar">
        ${TOOLS.map((t) => `<button type="button" data-action="tool" data-tool="${t.id}" class="${t.id === game.tool ? 'active' : ''}" aria-pressed="${t.id === game.tool}" title="${t.label} (${t.key})">${t.label} <kbd>${t.key}</kbd></button>`).join('')}
      </div>
      <p class="hint">${tool.hint}</p>
      ${
        game.tool === 'line'
          ? `<div class="draft">
              <div class="draft-list">${draftNames.length ? draftNames.map((n, i) => `<span>${i + 1}. ${escapeHtml(n)}</span>`).join('') : '<em>İlk iskeleyi seç…</em>'}</div>
              <div class="row">
                <button data-action="draft-finish" ${game.draft.length < 2 ? 'disabled' : ''}>${game.editingLineId ? 'Hattı güncelle' : 'Hattı aç'} <kbd>Enter</kbd></button>
                <button data-action="draft-undo" ${game.draft.length ? '' : 'disabled'}>Geri al</button>
                <button data-action="draft-cancel">İptal</button>
              </div>
              <p class="small">${game.editingLineId ? 'Düzenleme: yeni iskeleye tıkla (en uygun yere eklenir), listedeki iskeleye tıkla (çıkarılır). Gemiler yeni terminallere gider.' : `Yeni hatta 1 vapur tersaneden yola çıkar (${fmtMoney(SHIP_TYPES.vapur.price)}). Taslaktaki bir iskeleye tıklarsan çıkarılır.`}</p>
            </div>`
          : ''
      }
      <h4>Hatlar <span class="count">${state.lines.length}</span></h4>
      <div class="lines">${lines || '<p class="small">Henüz hat yok. <b>Hat</b> aracıyla iskeleleri bağla.</p>'}</div>
      <h4>Tersaneler <span class="count">${state.ships.length} / ${fleetCapacity(state)} gemi</span></h4>
      <div class="yards">
        ${state.yards
          .map((y) => {
            const at = shipsAtYard(state, y.id);
            return `<button class="yard-row" data-action="yard-focus" data-yard="${y.id}" title="Haritada göster">
              <span>⚓ ${escapeHtml(y.name)}</span>
              <span class="small">kapasite ${y.capacity} · bakım ${at.active.length}/${y.slots}${at.queued.length ? ` · sırada ${at.queued.length}` : ''}${at.inbound.length ? ` · yolda ${at.inbound.length}` : ''}</span>
            </button>`;
          })
          .join('')}
      </div>`;
    refresh();
  }

  function refresh(): void {
    const { state } = game;
    for (const el of root.querySelectorAll<HTMLElement>('[data-live-line]')) {
      const id = el.dataset.liveLine!;
      const ls = state.lineStats[id];
      if (!ls) continue;
      el.textContent = `Bugün: ${ls.boardings.toLocaleString('tr-TR')} yolcu · ${fmtMoney(ls.revenue)} · doluluk %${Math.round(ls.load * 100)} · kaçan sefer ${ls.missed}`;
    }
  }

  return { render, refresh };
}
