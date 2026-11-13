import { UI } from '../config/balance.ts';

export type ToastKind = 'info' | 'ok' | 'error';

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.append(container);
  }
  return container;
}

export function toast(message: string, kind: ToastKind = 'info'): void {
  const root = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  root.append(el);
  // Aynı anda en fazla 3 toast.
  while (root.children.length > 3) root.firstElementChild?.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, UI.toastDurationMs);
}
