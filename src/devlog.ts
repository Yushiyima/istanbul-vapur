/**
 * Sadece geliştirmede: tarayıcı uyarı/hatalarını ve oyun olaylarını Vite sunucusuna gönderir,
 * sunucu bunları logs/dev.log dosyasına yazar. Üretim paketinde hiçbir şey yapmaz.
 */

type Level = 'info' | 'warn' | 'error' | 'game' | 'perf' | 'pulse';
interface Entry {
  t: string;
  level: Level;
  msg: string;
}

const ENDPOINT = '/__devlog';
const FLUSH_MS = 400;
let queue: Entry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  timer = null;
  if (!queue.length) return;
  const body = JSON.stringify(queue);
  queue = [];
  fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {
    /* sunucu kapalıysa sessizce geç */
  });
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

export function devLog(level: Level, ...args: unknown[]): void {
  if (!import.meta.env.DEV) return;
  queue.push({ t: new Date().toISOString(), level, msg: format(args) });
  timer ??= setTimeout(flush, FLUSH_MS);
}

export function installDevLogBridge(): void {
  if (!import.meta.env.DEV) return;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      devLog(level, ...args);
    };
  }
  window.addEventListener('error', (ev) => devLog('error', `window.onerror: ${ev.message} @ ${ev.filename}:${ev.lineno}`, ev.error));
  window.addEventListener('unhandledrejection', (ev) => devLog('error', 'unhandledrejection:', ev.reason));
  window.addEventListener('pagehide', flush);
  devLog('info', `sayfa açıldı: ${location.href} · ${navigator.userAgent} · ${innerWidth}x${innerHeight}`);
}
