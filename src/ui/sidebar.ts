/**
 * Sağ kolon: hedefler, Peron akışı, katmanlar, kayıt. Sekmeli, katlanabilir.
 */
import { GOALS, MAINT } from '../config/balance.ts';
import type { Game } from '../game.ts';
import { GOAL_IDS, goalProgress } from '../sim/goals.ts';
import { fmtMoney } from '../sim/network.ts';
import { escapeHtml } from './html.ts';
import { formatClock, formatDate } from './topbar.ts';

export type LayerId = 'none' | 'pop' | 'att' | 'coverage' | 'load' | 'rail' | 'flows';
type Tab = 'goals' | 'feed' | 'menu';

export interface SidebarHandlers {
  onSave(): void;
  onLoad(): void;
  onNewGame(): void;
  onLayer?(id: LayerId): void;
  onCoverage?(visible: boolean): void;
  onSound?(on: boolean): void;
  onMaintThreshold?(v: number): void;
  onNightSkip?(on: boolean): void;
  onTraffic?(on: boolean): void;
}

export function createSidebar(root: HTMLElement, game: Game, h: SidebarHandlers): { render(): void; refresh(): void } {
  let tab: Tab = 'goals';
  let collapsed = false;
  let layer: LayerId = 'none';
  let coverage = true;
  let sound = false;
  let lastFeedId = '';
  let lastGoalSig = '';

  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el) return;
    const act = el.dataset.act!;
    if (act === 'tab') {
      tab = el.dataset.tab as Tab;
      collapsed = false;
      render();
    } else if (act === 'collapse') {
      collapsed = !collapsed;
      render();
    } else if (act === 'save') h.onSave();
    else if (act === 'load') h.onLoad();
    else if (act === 'new') h.onNewGame();
  });
  root.addEventListener('change', (ev) => {
    const el = ev.target as HTMLInputElement;
    if (el.name === 'layer') {
      layer = el.value as LayerId;
      h.onLayer?.(layer);
    } else if (el.name === 'coverage') {
      coverage = el.checked;
      h.onCoverage?.(coverage);
    } else if (el.name === 'maint') {
      h.onMaintThreshold?.(Number(el.value));
    } else if (el.name === 'nightSkip') {
      h.onNightSkip?.(el.checked);
    } else if (el.name === 'traffic') {
      h.onTraffic?.(el.checked);
    } else if (el.name === 'sound') {
      sound = el.checked;
      h.onSound?.(sound);
    }
  });

  function goalsHtml(): string {
    const prog = goalProgress(game.state, game.world);
    const done = GOAL_IDS.filter((id) => game.state.goals[id] !== undefined).length;
    return `
      <p class="small">${done} / ${GOAL_IDS.length} hedef tamam. Her hedef bir kez ödül verir.</p>
      <ul class="goals">
        ${GOAL_IDS.map((id) => {
          const g = GOALS[id];
          const at = game.state.goals[id];
          const isDone = at !== undefined;
          return `<li class="${isDone ? 'done' : ''}">
            <span class="check">${isDone ? '✔' : '○'}</span>
            <div><b>${g.title}</b> <span class="reward">${fmtMoney(g.reward)}</span>
              <div class="small">${g.desc}</div>
              <div class="prog">${isDone ? `${formatDate(at)} ${formatClock(at)}` : prog[id].progress}</div>
            </div>
          </li>`;
        }).join('')}
      </ul>`;
  }

  function feedHtml(): string {
    const posts = game.state.feed;
    if (!posts.length) return '<p class="small">Henüz paylaşım yok. Seferler başlayınca yolcular konuşmaya başlar.</p>';
    return `<ul class="feed">${posts
      .map(
        (p) => `<li><span class="avatar">${p.avatar}</span><div><div class="author">${escapeHtml(p.author)} <span class="when">${formatClock(p.at)}</span></div><div>${escapeHtml(p.text)}</div></div></li>`,
      )
      .join('')}</ul>`;
  }

  function menuHtml(): string {
    const opt = (id: LayerId, label: string) => `<label><input type="radio" name="layer" value="${id}"${layer === id ? ' checked' : ''}> ${label}</label>`;
    const layers = h.onLayer
      ? `<h5>Katmanlar</h5>
      <div class="layers">
        ${opt('none', 'Yok')}${opt('pop', 'Nüfus')}${opt('att', 'Çekim')}${opt('load', 'Hat doluluğu')}${opt('rail', 'Raylı sistem')}${opt('flows', 'Talep akışları')}
        <label><input type="checkbox" name="coverage"${coverage ? ' checked' : ''}> Kapsama alanları</label>
      </div>
      <p class="small">Nüfus ve çekim: açık renk az, koyu çok. Raylı sistem: istasyonlar ve 400 m aktarma halkası (metro kırmızı, Marmaray mavi). Talep akışları: iskele çiftleri arası günlük potansiyel yolcu; yeşil hatla bağlı, turuncu bağlı değil.</p>`
      : '';
    const audio = h.onSound ? `<h5>Ses</h5><label><input type="checkbox" name="sound"${sound ? ' checked' : ''}> Vapur düdüğü</label>` : '';
    const st = game.state.settings;
    const play = `<h5>Oyun</h5>
      <label>Otomatik bakım: <select name="maint">${MAINT.thresholdOptions.map((v) => `<option value="${v}"${v === st.maintThreshold ? ' selected' : ''}>${v ? `durum %${v} altına düşünce` : 'kapalı'}</option>`).join('')}</select></label>
      <label><input type="checkbox" name="nightSkip"${st.nightSkip ? ' checked' : ''}> Gece seferi yoksa geceyi hızlı geç</label>
      <label><input type="checkbox" name="traffic"${st.traffic ? ' checked' : ''}> Boğaz gemi trafiği (vapurlar yol verir)</label>`;
    return `
      ${play}
      ${layers}
      ${audio}
      <h5>Kayıt</h5>
      <p class="small">Oyun her gün sonunda ve sekme kapanırken otomatik kaydedilir.</p>
      <div class="row">
        <button data-act="save">Kaydet</button>
        <button data-act="load">Kayıttan yükle</button>
        <button data-act="new" class="danger-btn">Yeni oyun</button>
      </div>`;
  }

  function render(): void {
    const unread = game.state.feed[0]?.id !== lastFeedId && tab !== 'feed' ? ' •' : '';
    root.classList.toggle('collapsed', collapsed);
    root.innerHTML = `
      <div class="tabs">
        <button data-act="tab" data-tab="goals" class="${tab === 'goals' ? 'active' : ''}">🏆 Hedefler</button>
        <button data-act="tab" data-tab="feed" class="${tab === 'feed' ? 'active' : ''}">💬 Peron${unread}</button>
        <button data-act="tab" data-tab="menu" class="${tab === 'menu' ? 'active' : ''}">☰</button>
        <button data-act="collapse" class="collapse" title="${collapsed ? 'Aç' : 'Katla'}">${collapsed ? '▾' : '▴'}</button>
      </div>
      <div class="tab-body">${collapsed ? '' : tab === 'goals' ? goalsHtml() : tab === 'feed' ? feedHtml() : menuHtml()}</div>`;
    if (tab === 'feed') lastFeedId = game.state.feed[0]?.id ?? '';
    lastGoalSig = goalSig();
  }

  function goalSig(): string {
    return GOAL_IDS.map((id) => (game.state.goals[id] !== undefined ? 1 : 0)).join('') + '|' + game.state.piers.length + '|' + game.state.lines.length;
  }

  /** Değişen bir şey varsa (yeni paylaşım, hedef) yeniden çiz. */
  function refresh(): void {
    const feedChanged = (game.state.feed[0]?.id ?? '') !== lastFeedId;
    if ((tab === 'goals' && goalSig() !== lastGoalSig) || feedChanged) render();
  }

  return { render, refresh };
}
