/**
 * Sentezlenmiş vapur düdüğü (WebAudio, dosya yok). Varsayılan kapalı; kullanıcı açar.
 */
import { SOUND } from '../config/balance.ts';

let ctx: AudioContext | null = null;
let enabled = false;
let lastHorn = 0;

export function setSound(on: boolean): void {
  enabled = on;
  if (on) {
    ctx ??= new AudioContext();
    void ctx.resume();
    horn(0.6);
  }
}

/** Kısa, iki tonlu gemi düdüğü. */
export function horn(volumeScale = 1): void {
  if (!enabled || !ctx) return;
  const now = performance.now();
  if (now - lastHorn < SOUND.hornMinGapMs) return;
  lastHorn = now;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(SOUND.volume * volumeScale, t + 0.08);
  gain.gain.setValueAtTime(SOUND.volume * volumeScale, t + 0.9);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  for (const f of [110, 165]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * 0.97, t);
    osc.frequency.linearRampToValueAtTime(f, t + 0.15);
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + 1.45);
  }
  filter.connect(gain).connect(ctx.destination);
}
