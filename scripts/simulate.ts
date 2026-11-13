/**
 * Headless denge simülasyonu: başlangıç ağıyla (ya da --big ile genişletilmiş ağla) N gün oynatır.
 *   node scripts/simulate.ts [gün] [--big]
 */
import { TIME } from '../src/config/balance.ts';
import { buyShip, createLine, dailyRunningCostSafe } from './simHelpers.ts';
import { createGame } from '../src/sim/state.ts';
import { tick } from '../src/sim/tick.ts';
import { odTable } from '../src/sim/passengers.ts';
import { catchmentOf } from '../src/sim/catchment.ts';
import { placeHistoric, testWorld } from '../src/sim/testWorld.ts';

const days = Number(process.argv[2] ?? 1);
const big = process.argv.includes('--big');
const world = testWorld();
const state = createGame(7);
const e = placeHistoric(state, world, 'eminonu');
const k = placeHistoric(state, world, 'kadikoy');
const l1 = createLine(state, world, [e.id, k.id]);
if (!l1.ok) throw new Error(l1.message);
buyShip(state, world, l1.value.id, { free: true, atTerminal: true });
buyShip(state, world, l1.value.id, { free: true, atTerminal: true });
if (big) {
  const u = placeHistoric(state, world, 'uskudar');
  const b = placeHistoric(state, world, 'besiktas');
  const kb = placeHistoric(state, world, 'karakoy');
  const l2 = createLine(state, world, [kb.id, u.id]);
  const l3 = createLine(state, world, [b.id, k.id]);
  for (const l of [l2, l3]) if (l.ok) { buyShip(state, world, l.value.id, { free: true, atTerminal: true }); buyShip(state, world, l.value.id, { free: true, atTerminal: true }); }
}
for (const p of state.piers) { const c = catchmentOf(world, p); console.log(`${p.name.padEnd(10)} pop ${Math.round(c.pop).toLocaleString('tr-TR').padStart(8)} att ${Math.round(c.att).toLocaleString('tr-TR').padStart(9)} side ${p.side}`); }
const od = odTable(state, world);
for (const p of od.pairs) console.log(`${p.key.padEnd(18)} base ${(p.base * 60).toFixed(1).padStart(7)}/sa · Tv ${p.tVapur.toFixed(0)} · Tk peak ${p.tLand.peak.toFixed(0)} off ${p.tLand.offpeak.toFixed(0)} · pay peak ${(p.share.peak * 100).toFixed(0)}% off ${(p.share.offpeak * 100).toFixed(0)}%`);
const startMoney = state.money;
for (let d = 0; d < days; d++) {
  const hourly: number[] = [];
  let lastB = 0;
  for (let m = 0; m < TIME.minutesPerDay; m++) {
    tick(state, world);
    if (state.minute % 60 === 0) { const b = state.today.boardings; hourly.push(b - lastB); lastB = b; if (state.today.boardings === 0 && hourly.length > 1) lastB = 0; }
  }
  const y = state.yesterday!;
  const wx = state.notices.filter((n) => /başladı|bastı|Tanker|Hedef/.test(n.text)).map((n) => n.text.split(':')[0]).join(', ');
  state.notices = [];
  console.log(`\nGün ${d + 1}${wx ? ` [${wx}]` : ''}: biniş ${y.boardings.toLocaleString('tr-TR')} · gelir ${Math.round(y.revenue).toLocaleString('tr-TR')} · gider ${Math.round(y.costs).toLocaleString('tr-TR')} · reddedilen ${y.denied} · vazgeçen ${y.gaveUp} · ort. bekleme ${(y.waitSum / Math.max(1, y.waitCount)).toFixed(1)} dk · kaçan ${y.tripsMissed} · memnuniyet ${state.satisfaction.toFixed(1)}`);
  if (days <= 3) console.log('saatlik biniş:', hourly.slice(0, 18).join(' '));
}
console.log(`\nPeron: ${state.feed.length} paylaşım (en fazla 40) · hedefler: ${Object.keys(state.goals).join(', ') || '-'}`);
console.log('Son paylaşımlar:\n  ' + state.feed.slice(0, 6).map((p) => `${p.avatar} ${p.text}`).join('\n  '));
if (state.pendingYearSummary) console.log('Yıl özeti:', JSON.stringify(state.pendingYearSummary));
console.log(`\nKasa değişimi: ${Math.round(state.money - startMoney).toLocaleString('tr-TR')} · günlük sabit gider ${dailyRunningCostSafe(state).toLocaleString('tr-TR')}`);
