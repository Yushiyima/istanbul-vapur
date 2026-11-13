export type Tool = 'pan' | 'pier';

interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  hint: string;
}

const TOOLS: ToolDef[] = [
  { id: 'pan', label: 'Gez', key: 'G', hint: 'Haritayı sürükle, iskeleye tıklayıp bilgisini gör.' },
  { id: 'pier', label: 'İskele', key: 'İ', hint: 'Kıyıya yakın bir yere tıkla: iskele en yakın kıyı noktasına yapışır. Esc: çık.' },
];

export interface Toolbar {
  setTool(tool: Tool): void;
  setPierCount(n: number): void;
}

export function createToolbar(root: HTMLElement, onChange: (tool: Tool) => void): Toolbar {
  root.innerHTML = `
    <div class="brand">Vapur <span>İstanbul</span></div>
    <div class="tools" role="toolbar" aria-label="Araçlar"></div>
    <div class="stats"><span class="pier-count">0</span> iskele</div>
    <p class="hint"></p>`;
  const toolsEl = root.querySelector<HTMLElement>('.tools')!;
  const hintEl = root.querySelector<HTMLElement>('.hint')!;
  const countEl = root.querySelector<HTMLElement>('.pier-count')!;

  const buttons = new Map<Tool, HTMLButtonElement>();
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `${t.label} <kbd>${t.key}</kbd>`;
    b.title = `${t.label} (${t.key})`;
    b.addEventListener('click', () => setTool(t.id, true));
    toolsEl.append(b);
    buttons.set(t.id, b);
  }

  let current: Tool = 'pan';
  function setTool(tool: Tool, notify = false): void {
    current = tool;
    for (const [id, b] of buttons) {
      b.classList.toggle('active', id === tool);
      b.setAttribute('aria-pressed', String(id === tool));
    }
    hintEl.textContent = TOOLS.find((t) => t.id === tool)?.hint ?? '';
    if (notify) onChange(tool);
  }

  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.toLocaleLowerCase('tr');
    if (ev.key === 'Escape' || k === 'g') setTool('pan', current !== 'pan');
    else if (k === 'i' || k === 'ı') setTool('pier', current !== 'pier');
  });

  setTool('pan');
  return {
    setTool: (t) => setTool(t, false),
    setPierCount: (n) => {
      countEl.textContent = String(n);
    },
  };
}
