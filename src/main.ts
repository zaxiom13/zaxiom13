import './styles.css';
import { EditorView } from '@codemirror/view';
import LZString from 'lz-string';

import { createInterp, runConsole, shouldPrint } from './q/index';
import type { Interp } from './q/eval';
import { display } from './q/format';
import { traceExpr } from './q/trace';
import { QError, isTable, isDict, isFunc, count, TYPE_NAME, QValue } from './q/value';
import { SketchRuntime } from './sketch/runtime';
import { createEditor, setEditorText, insertAtCursor } from './ui/editor';
import { el, $, clear, toast, md } from './ui/dom';
import { EXAMPLES } from './content/examples';
import { renderLessons } from './ui/lessons-view';
import { renderReference } from './ui/reference-view';
import { renderParity } from './ui/parity-view';
import { renderInspector } from './ui/inspector';

const STORAGE_KEY = 'qsketch.code';

// ---------------------------------------------------------------- shell

const app = $('#app')!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><b>q</b><span>·</span>sketch <small>creative coding for kdb+ minds</small></div>
    <div class="spacer"></div>
    <select id="examples" title="Load an example"></select>
    <button id="trace" class="ghost desktop-only" title="Explain the evaluation, right to left">Trace</button>
    <button id="share" class="ghost" title="Copy a link to this sketch">Share</button>
    <button id="run" class="primary" title="Ctrl/Cmd + Enter">Run ▶</button>
  </header>
  <main class="workspace">
    <section class="pane pane-left">
      <div class="tabbar" id="left-tabs">
        <button class="tab active" data-tab="code">Code</button>
        <button class="tab" data-tab="learn">Learn</button>
        <button class="tab" data-tab="ref">Reference</button>
        <button class="tab" data-tab="parity">Parity</button>
        <button class="tab mobile-only" data-tab="console">Console</button>
        <button class="tab mobile-only" data-tab="data">Data</button>
      </div>
      <div class="panels" id="left-panels">
        <div class="panel active" data-panel="code">
          <div class="editor-host" id="editor"></div>
          <div class="keypad" id="keypad"></div>
        </div>
        <div class="panel" data-panel="learn"><div class="scroll" id="learn"></div></div>
        <div class="panel" data-panel="ref"><div class="scroll" id="ref"></div></div>
        <div class="panel" data-panel="parity"><div class="scroll" id="parity"></div></div>
        <div class="panel mobile-only" data-panel="console">
          <div class="console" id="console-m"></div>
          <form class="repl" id="repl-m"><span>q)</span><input autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="evaluate against the live sketch" /></form>
        </div>
        <div class="panel mobile-only" data-panel="data"><div class="scroll" id="data-m"></div></div>
      </div>
    </section>
    <section class="pane pane-right">
      <div class="canvas-wrap" id="canvas-wrap">
        <div class="canvas-host" id="canvas"></div>
        <div class="canvas-tools">
          <button id="playpause" title="Pause / resume">⏸</button>
          <button id="snap" title="Save a PNG">PNG</button>
        </div>
        <div class="canvas-badges">
          <span class="badge mode" id="badge-mode">idle</span>
          <span class="badge" id="badge-fps"></span>
          <span class="badge" id="badge-shapes"></span>
        </div>
      </div>
      <div class="tabbar desktop-only" id="right-tabs">
        <button class="tab active" data-tab="console">Console</button>
        <button class="tab" data-tab="data">Data</button>
      </div>
      <div class="panels desktop-only" id="right-panels">
        <div class="panel active" data-panel="console">
          <div class="console" id="console"></div>
          <form class="repl" id="repl"><span>q)</span><input autocomplete="off" spellcheck="false" placeholder="evaluate against the live sketch — try: state" /></form>
        </div>
        <div class="panel" data-panel="data"><div class="scroll" id="data"></div></div>
      </div>
    </section>
  </main>
  <nav class="mobilenav" id="mobilenav">
    <button data-tab="code" class="active"><span class="ic">{ }</span>Code</button>
    <button data-tab="console"><span class="ic">q)</span>Console</button>
    <button data-tab="data"><span class="ic">▤</span>Data</button>
    <button data-tab="learn"><span class="ic">◎</span>Learn</button>
    <button data-tab="ref"><span class="ic">?</span>Ref</button>
  </nav>
`;

// ---------------------------------------------------------------- state

let ip: Interp = createInterp();
let runtime: SketchRuntime;
const consoles = [$('#console')!, $('#console-m')!];

function freshInterp() {
  ip = createInterp({ out: (s) => println(s, 'out') });
  if (runtime) runtime.attach(ip);
  else
    runtime = new SketchRuntime(ip, $('#canvas')!, {
      onError: (msg, hint) => {
        println(msg, 'err');
        if (hint) println(hint, 'hint');
        println('sketch paused', 'note');
        updateBadges();
      },
      onStatus: () => updateBadges(),
    });
  (window as any).qip = ip;
  (window as any).qrt = runtime;
}

function println(text: string, cls: 'in' | 'out' | 'err' | 'hint' | 'note' = 'out') {
  for (const c of consoles) {
    if (!c) continue;
    const atBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 40;
    c.append(el('div', { class: `entry ${cls}` }, text));
    if (atBottom) c.scrollTop = c.scrollHeight;
  }
}

function clearConsole() {
  for (const c of consoles) if (c) clear(c);
}

// ---------------------------------------------------------------- editor

const defaultCode = EXAMPLES[0].code;
const fromHash = () => {
  const m = /[#&]c=([^&]+)/.exec(location.hash);
  if (!m) return null;
  try {
    return LZString.decompressFromEncodedURIComponent(m[1]) || null;
  } catch {
    return null;
  }
};

const initialCode = fromHash() ?? localStorage.getItem(STORAGE_KEY) ?? defaultCode;

freshInterp();

const editor: EditorView = createEditor({
  parent: $('#editor')!,
  doc: initialCode,
  interp: ip,
  onRun: () => run(),
  onChange: (doc) => {
    localStorage.setItem(STORAGE_KEY, doc);
  },
});

// ---------------------------------------------------------------- running

async function run() {
  const code = editor.state.doc.toString();
  await runtime.ready();
  clearConsole();
  runtime.clear();
  freshInterp();
  runtime.mount();
  const t0 = performance.now();
  let ok = true;
  let last: QValue | undefined;
  let lastPrintable = false;
  try {
    const results = ip.runAll(code);
    results.forEach((r, i) => {
      last = r.value;
      lastPrintable = shouldPrint(r.node, r.value);
      // the final value is printed only if it does not end up on the canvas
      if (lastPrintable && i < results.length - 1) println(display(r.value), 'out');
    });
  } catch (e: any) {
    ok = false;
    const msg = e instanceof QError ? "'" + e.qmsg : String(e?.message ?? e);
    println(msg, 'err');
    if (e instanceof QError && e.hint) println(e.hint, 'hint');
  }
  const ms = performance.now() - t0;
  runtime.start();
  // a scene table left at the end of the program is drawn for you
  const drawn = ok && last && runtime.mode === 'idle' && runtime.autoDraw(last);
  if (drawn) println(`drew ${count(last!)} shapes`, 'note');
  else if (ok && lastPrintable && last) println(display(last), 'out');
  updateBadges();
  refreshData();
  println(`${ok ? 'ok' : 'failed'} in ${ms.toFixed(1)}ms · mode: ${runtime.mode}`, 'note');
}

function updateBadges() {
  const m = $('#badge-mode')!;
  m.textContent = runtime.mode + (runtime.paused ? ' (paused)' : '');
  $('#badge-fps')!.textContent =
    runtime.running && !runtime.paused ? `${Math.round(runtime.fps)} fps` : '';
  $('#badge-shapes')!.textContent = runtime.lastShapes ? `${runtime.lastShapes} shapes` : '';
  $('#playpause')!.textContent = runtime.paused || !runtime.running ? '▶' : '⏸';
}

$('#run')!.addEventListener('click', () => run());
$('#playpause')!.addEventListener('click', () => {
  runtime.toggle();
  updateBadges();
});
$('#snap')!.addEventListener('click', () => {
  const cv = $('#canvas')!.querySelector('canvas') as HTMLCanvasElement | null;
  if (!cv) return;
  const a = document.createElement('a');
  a.download = 'q-sketch.png';
  a.href = cv.toDataURL('image/png');
  a.click();
});

$('#share')!.addEventListener('click', async () => {
  const code = editor.state.doc.toString();
  const hash = '#c=' + LZString.compressToEncodedURIComponent(code);
  const url = location.origin + location.pathname + hash;
  history.replaceState(null, '', hash);
  try {
    await navigator.clipboard.writeText(url);
    toast('link copied — the whole sketch lives in the URL');
  } catch {
    toast('link is in the address bar');
  }
});

$('#trace')!.addEventListener('click', () => {
  const sel = editor.state.selection.main;
  const src = sel.empty
    ? editor.state.doc.lineAt(sel.head).text
    : editor.state.sliceDoc(sel.from, sel.to);
  if (!src.trim()) return;
  showTrace(src.trim());
});

function showTrace(src: string) {
  selectTab('console');
  println(src, 'in');
  println('— evaluation, right to left —', 'note');
  let steps;
  try {
    steps = traceExpr(ip, src);
  } catch (e: any) {
    println("'" + (e?.qmsg ?? e?.message ?? e), 'err');
    return;
  }
  for (const s of steps) {
    if (s.error) {
      println(`  ${s.src}   →  ${s.error}`, 'err');
      continue;
    }
    const val = s.value ? display(s.value).split('\n')[0] : '';
    const pad = '  '.repeat(Math.max(0, s.depth));
    const arrow = s.depth < 0 ? '=' : '→';
    println(`${pad}${s.src}  ${arrow}  ${val.length > 90 ? val.slice(0, 90) + '..' : val}`, 'note');
  }
}

// ---------------------------------------------------------------- repl

for (const id of ['#repl', '#repl-m']) {
  const form = $(id) as HTMLFormElement | null;
  if (!form) continue;
  const input = form.querySelector('input') as HTMLInputElement;
  const history: string[] = [];
  let hpos = 0;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const src = input.value.trim();
    if (!src) return;
    history.push(src);
    hpos = history.length;
    input.value = '';
    println(src, 'in');
    const res = runConsole(ip, src);
    if (res.output) println(res.output, 'out');
    if (!res.ok) {
      println("'" + res.error!.msg, 'err');
      if (res.error!.hint) println(res.error!.hint, 'hint');
    }
    refreshData();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hpos > 0) {
      hpos--;
      input.value = history[hpos] ?? '';
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      hpos = Math.min(history.length, hpos + 1);
      input.value = history[hpos] ?? '';
      e.preventDefault();
    }
  });
}

// ---------------------------------------------------------------- tabs

function selectTab(name: string) {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const rightTabs = ['console', 'data'];
  if (!isMobile && rightTabs.includes(name)) {
    setGroup('#right-tabs', '#right-panels', name);
    return;
  }
  setGroup('#left-tabs', '#left-panels', name);
  for (const b of Array.from($('#mobilenav')!.children) as HTMLElement[])
    b.classList.toggle('active', b.dataset.tab === name);
  if (name === 'data') refreshData();
  if (name === 'parity') mountParity();
}

function setGroup(tabsSel: string, panelsSel: string, name: string) {
  const tabs = $(tabsSel);
  const panels = $(panelsSel);
  if (!tabs || !panels) return;
  for (const b of Array.from(tabs.children) as HTMLElement[])
    b.classList.toggle('active', b.dataset.tab === name);
  for (const p of Array.from(panels.children) as HTMLElement[])
    p.classList.toggle('active', p.dataset.panel === name);
}

for (const sel of ['#left-tabs', '#right-tabs', '#mobilenav']) {
  $(sel)!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (b?.dataset.tab) selectTab(b.dataset.tab);
  });
}

// ---------------------------------------------------------------- keypad

const KEYS = [
  '`',
  ':',
  ';',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  '"',
  '#',
  '_',
  '$',
  '?',
  '@',
  '.',
  '!',
  '~',
  '^',
  '&',
  '|',
  '+',
  '-',
  '*',
  '%',
  '=',
  '<',
  '>',
  "'",
  '/',
  '\\',
  ',',
  '0N',
  'til ',
  'select ',
  'from ',
  'update ',
  'where ',
  'by ',
];
const keypad = $('#keypad')!;
for (const k of KEYS) {
  keypad.append(
    el(
      'button',
      {
        onclick: () => insertAtCursor(editor, k),
        title: k,
      },
      k.trim()
    )
  );
}

// ---------------------------------------------------------------- examples

const sel = $('#examples') as HTMLSelectElement;
sel.append(el('option', { value: '' }, 'Examples…'));
for (const ex of EXAMPLES) sel.append(el('option', { value: ex.id }, ex.title));
sel.addEventListener('change', () => {
  const ex = EXAMPLES.find((e) => e.id === sel.value);
  if (!ex) return;
  setEditorText(editor, ex.code);
  sel.value = '';
  selectTab('code');
  run();
});

// ---------------------------------------------------------------- data tab

function refreshData() {
  for (const id of ['#data', '#data-m']) {
    const host = $(id);
    if (!host) continue;
    renderInspector(host, ip, (src) => {
      println(src, 'in');
      const r = runConsole(ip, src);
      println(r.ok ? r.output : "'" + r.error!.msg, r.ok ? 'out' : 'err');
    });
  }
}

// ---------------------------------------------------------------- panels

renderLessons($('#learn')!, {
  onSendToEditor: (code) => {
    setEditorText(editor, code);
    selectTab('code');
    run();
  },
});

renderReference($('#ref')!, () => ip, {
  onInsert: (name) => {
    insertAtCursor(editor, name);
    selectTab('code');
  },
  onRun: (src) => {
    selectTab('console');
    println(src, 'in');
    const r = runConsole(ip, src);
    println(r.ok ? r.output : "'" + r.error!.msg, r.ok ? 'out' : 'err');
  },
});

let parityMounted = false;
function mountParity() {
  if (parityMounted) return;
  parityMounted = true;
  renderParity($('#parity')!);
}

// ---------------------------------------------------------------- go

window.addEventListener('resize', () => runtime.resize());
new ResizeObserver(() => runtime.resize()).observe($('#canvas-wrap')!);

// keep the canvas from scrolling the page on touch
$('#canvas')!.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

void run().then(() => {
  println('Ctrl+Enter runs · the q) line below talks to the live sketch', 'note');
});
