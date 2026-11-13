/**
 * Üst bar: tarih/saat, hız, kasa, memnuniyet, günlük yolcu, hava.
 */
import { MONTHS, TIME } from '../config/balance.ts';
import type { Game } from '../game.ts';
import { fmtMoney } from '../sim/network.ts';
import { currentWeather, legExposed } from '../sim/events.ts';
import { waitingCount } from '../sim/passengers.ts';
import { inService, minuteOfDay, monthIndex, yearIndex } from '../sim/state.ts';

const formatHour = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const WEATHER_LABEL: Record<string, string> = { acik: '☀ Açık', lodos: '🌬 Lodos', poyraz: '🌬 Poyraz', sis: '🌫 Sis' };
const SPEED_LABEL = ['⏸', '1×', '2×', '4×', '8×'];

export function formatClock(minute: number): string {
  const m = minuteOfDay(minute);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatDate(minute: number): string {
  return `${yearIndex(minute) + 1}. yıl · ${MONTHS[monthIndex(minute)]}`;
}

export function createTopbar(root: HTMLElement, game: Game): { refresh(): void; render(): void } {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-speed]');
    if (el) game.setSpeed(Number(el.dataset.speed));
  });

  function render(): void {
    root.innerHTML = `
      <div class="tb-group tb-time"><span class="tb-date"></span><span class="tb-clock"></span></div>
      <div class="tb-group tb-speed" role="group" aria-label="Hız">
        ${TIME.speeds.map((_, i) => `<button data-speed="${i}" class="${i === game.speedIndex ? 'active' : ''}" title="${i ? `${TIME.speeds[i]}× hız` : 'Duraklat'} (${i ? i : 'Boşluk'})">${SPEED_LABEL[i]}</button>`).join('')}
      </div>
      <div class="tb-group"><span class="tb-label">Kasa</span><span class="tb-money"></span></div>
      <div class="tb-group"><span class="tb-label">Memnuniyet</span><span class="tb-sat"></span></div>
      <div class="tb-group"><span class="tb-label">Bugün</span><span class="tb-pax"></span><span class="tb-net"></span></div>
      <div class="tb-group"><span class="tb-label">Bekleyen</span><span class="tb-wait"></span></div>
      <div class="tb-group"><span class="tb-weather"></span></div>`;
    refresh();
  }

  function refresh(): void {
    const s = game.state;
    const set = (cls: string, text: string) => {
      const el = root.querySelector<HTMLElement>(cls);
      if (el && el.textContent !== text) el.textContent = text;
    };
    set('.tb-date', formatDate(s.minute));
    set('.tb-clock', formatClock(s.minute));
    set('.tb-money', fmtMoney(s.money));
    root.querySelector('.tb-money')?.classList.toggle('neg', s.money < 0);
    set('.tb-sat', `%${Math.round(s.satisfaction)}`);
    set('.tb-pax', `${s.today.boardings.toLocaleString('tr-TR')} yolcu`);
    const net = s.today.revenue - s.today.costs;
    set('.tb-net', `${net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(net))}`);
    root.querySelector('.tb-net')?.classList.toggle('neg', net < 0);
    set('.tb-wait', waitingCount(s).toLocaleString('tr-TR'));
    // Durum: gece (seferler durur), lodos/poyraz (kaç hat bekliyor), tanker.
    const parts: string[] = [WEATHER_LABEL[currentWeather(s)] ?? ''];
    const nightOnly = s.lines.filter((l) => l.night).length;
    if (!inService(s.minute, false)) {
      parts.push(nightOnly ? `🌙 Gece · ${nightOnly} gece hattı çalışıyor` : `🌙 Gece · seferler ${formatHour(TIME.serviceStartMin)}'da başlar${game.nightSkipping ? ' (hızlı geçiliyor)' : ''}`);
    }
    const w = currentWeather(s);
    if (w === 'lodos' || w === 'poyraz') {
      const held = s.lines.filter((l) => [0, l.pierIds.length - 1].some((leg) => legExposed(s, game.world, l, leg, w))).length;
      if (held) parts.push(`${held} hat iskelede bekliyor`);
    }
    if (s.traffic.length) {
      const big = s.traffic.filter((t) => t.kind === 'tanker').length;
      const yielding = s.ships.filter((sh) => (sh.yielding ?? 0) > 0).length;
      parts.push(`🚢 Boğaz: ${s.traffic.length} gemi${big ? ` (${big} tanker)` : ''}${yielding ? ` · ${yielding} vapur yol veriyor` : ''}`);
    }
    set('.tb-weather', parts.filter(Boolean).join(' · '));
  }

  return { refresh, render };
}
