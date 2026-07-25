// CodeMirror 6 editor with a q language mode.

import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  lineNumbers,
  highlightActiveLine,
  hoverTooltip,
  placeholder as cmPlaceholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { Interp } from '../q/eval';
import { DOCS, DYNAMIC_DOCS } from '../content/reference-docs';
import { TYPE_NAME, count, type QValue } from '../q/value';

const KEYWORDS = new Set(
  `abs acos aj aj0 all and any asc asin asof atan attr avg avgs bin binr ceiling cols cor cos count cov cross csv cut
   delete deltas desc dev differ distinct div do dsave each ej ema enlist eval except exec exp fby fills first fkeys
   flip floor from get group gtime hcount iasc idesc if ij in insert inter inv key keys last like lj load log lower
   lsq ltime ltrim mavg max maxs mcount md5 mdev med meta min mins mmax mmin mmu mod msum neg next not null or over
   parse peach pj prd prds prev prior rand rank ratios raze reciprocal reverse rload rotate rsave save scan scov sdev
   select set setenv show signum sin sqrt ss ssr string sublist sum sums sv svar system tables tan til trim type uj
   ungroup union upper upsert value var view views vs wavg where while within wj wj1 wsum xasc xbar xcol xcols xdesc
   xexp xgroup xkey xlog xprev xrank by update`
    .split(/\s+/)
    .filter(Boolean)
);

const CONTROL = new Set(['if', 'do', 'while', 'select', 'exec', 'update', 'delete', 'from', 'by', 'where']);

const qLanguage = StreamLanguage.define<{ inBlockComment: boolean }>({
  name: 'q',
  startState: () => ({ inBlockComment: false }),
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.sol() && stream.match(/^\\\s*$/)) {
        state.inBlockComment = false;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.sol() && stream.match(/^\/\s*$/)) {
      state.inBlockComment = true;
      return 'comment';
    }
    if (stream.eatSpace()) return null;

    const ch = stream.peek()!;

    // comments: / at line start, or preceded by whitespace
    if (ch === '/') {
      const before = stream.string.charAt(stream.pos - 1);
      if (stream.pos === 0 || before === ' ' || before === '\t') {
        stream.skipToEnd();
        return 'comment';
      }
    }
    if (ch === '"') {
      stream.next();
      let escaped = false;
      while (!stream.eol()) {
        const c = stream.next()!;
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') break;
      }
      return 'string';
    }
    if (ch === '`') {
      stream.next();
      stream.eatWhile(/[A-Za-z0-9_.:]/);
      return 'atom';
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(stream.string.charAt(stream.pos + 1)))) {
      stream.eatWhile(/[0-9a-zA-Z_.:]/);
      return 'number';
    }
    if (/[A-Za-z]/.test(ch) || (ch === '.' && /[A-Za-z]/.test(stream.string.charAt(stream.pos + 1)))) {
      stream.next();
      stream.eatWhile(/[A-Za-z0-9_.]/);
      const word = stream.current();
      if (CONTROL.has(word)) return 'controlKeyword';
      if (KEYWORDS.has(word)) return 'keyword';
      if (word.startsWith('.')) return 'namespace';
      return 'variableName';
    }
    if (/[+\-*%&|^=<>!,#_$?@~]/.test(ch)) {
      stream.next();
      if (stream.peek() === ':') stream.next();
      return 'operator';
    }
    if (ch === "'" || ch === '\\') {
      stream.next();
      if (stream.peek() === ':') stream.next();
      return 'modifier';
    }
    if (/[[\](){};]/.test(ch)) {
      stream.next();
      return 'bracket';
    }
    stream.next();
    return null;
  },
});

const qHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#5c6b7a', fontStyle: 'italic' },
  { tag: t.string, color: '#98d67c' },
  { tag: t.atom, color: '#f2b45c' },
  { tag: t.number, color: '#e08cff' },
  { tag: t.keyword, color: '#5ec2ff' },
  { tag: t.controlKeyword, color: '#ff7ab2', fontWeight: '600' },
  { tag: t.operator, color: '#ffd479' },
  { tag: t.modifier, color: '#ff9f6b', fontWeight: '600' },
  { tag: t.namespace, color: '#7fe3d0' },
  { tag: t.variableName, color: '#dfe7ef' },
  { tag: t.bracket, color: '#8aa0b4' },
]);

const theme = EditorView.theme(
  {
    '&': { color: '#dfe7ef', backgroundColor: 'transparent', height: '100%' },
    '.cm-content': {
      caretColor: '#5ec2ff',
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 'var(--code-size, 13.5px)',
      lineHeight: '1.55',
      padding: '10px 0 40vh 0',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: '#3f4d5c',
      border: 'none',
      fontSize: '11px',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.035)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#7f8fa0' },
    '.cm-cursor': { borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(94,194,255,0.22)',
    },
    '.cm-tooltip': {
      backgroundColor: '#161b22',
      border: '1px solid #2b3440',
      borderRadius: '8px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: '#1f6feb44',
    },
    '.cm-tooltip.cm-q-definition': {
      maxWidth: 'min(430px, calc(100vw - 28px))',
      overflow: 'hidden',
      border: '1px solid rgba(94,194,255,0.3)',
      borderRadius: '10px',
      background: 'linear-gradient(145deg, #18212b 0%, #11171e 100%)',
      boxShadow: '0 14px 36px rgba(0,0,0,0.42), inset 0 1px rgba(255,255,255,0.04)',
    },
    '.q-hover-card': {
      display: 'grid',
      gap: '8px',
      boxSizing: 'border-box',
      width: 'min(400px, calc(100vw - 56px))',
      padding: '12px 14px 13px',
      borderRadius: '9px',
      background: 'linear-gradient(145deg, #18212b 0%, #11171e 100%)',
      color: '#c9d6e2',
      lineHeight: '1.45',
    },
    '.q-hover-head': {
      display: 'flex',
      alignItems: 'baseline',
      gap: '9px',
    },
    '.q-hover-name': {
      color: '#71d1ff',
      fontSize: '14px',
      fontWeight: '700',
      letterSpacing: '-0.01em',
    },
    '.q-hover-kind': {
      color: '#718396',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '9px',
      fontWeight: '700',
      letterSpacing: '0.13em',
      textTransform: 'uppercase',
    },
    '.q-hover-signature, .q-hover-source, .q-hover-example': {
      overflowX: 'auto',
      padding: '7px 9px',
      borderRadius: '6px',
      backgroundColor: 'rgba(5,10,15,0.62)',
      color: '#f0c674',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11.5px',
      whiteSpace: 'pre-wrap',
    },
    '.q-hover-description': {
      color: '#b9c6d2',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
    },
    '.q-hover-example': {
      color: '#8edb9b',
    },
    '.q-hover-example::before': {
      content: '"e.g.  "',
      color: '#5e7183',
    },
    '.cm-scroller': { overflow: 'auto', scrollbarWidth: 'thin' },
  },
  { dark: true }
);

import type { CodeSource, CodeOpts } from './code-source';

export interface QEditorOpts extends CodeOpts {
  interp: Interp;
  /** The runtime is replaced on every Run, so hover/completion can follow it. */
  getInterp?: () => Interp;
}

const COLOR_NAMES = [
  'black','white','red','orange','yellow','green','mint','teal','cyan','blue','indigo',
  'purple','pink','brown','gray','silver','gold','lime','navy','crimson','magenta','none',
];
const SHAPE_NAMES = [
  'circle','ring','rect','box','square','line','tri','ngon','text','point','path','poly','arc','ellipse',
];
const PALETTE_NAMES = ['sunset','neon','ice','ember','forest','candy','mono','kdb','earth','vapor'];

const SNIPPETS: { label: string; detail: string; body: string }[] = [
  {
    label: 'frame',
    detail: 'animation: draw every frame',
    body: 'frame:{[t]\n  i:til 30;\n  draw circles[flip (20+22*i;.p5.cp[1]+90*sin[t+0.3*i]); 8; hsv[i%30;0.6;1]] }',
  },
  {
    label: 'framestate',
    detail: 'animation with state: frame[s;t]',
    body: 'init:([] p:flip(100?800f;100?600f); v:flip(100#1f;100#0f))\nframe:{[s;t]\n  s:update p:p+v from s;\n  s:update p:p mod\\: .p5.wh from s;\n  draw circles[s`p; 3; `#7dd3fc];\n  s }',
  },
  {
    label: 'timer',
    detail: 'kdb+ style timer: \\t and .z.ts',
    body: '\\t 250\n.z.ts:{[t]\n  / runs every 250ms\n  draw circles[.p5.cp;40] }',
  },
  {
    label: 'select',
    detail: 'select ... by ... from ... where ...',
    body: 'select sum v by k from t where v>0',
  },
  { label: 'tablelit', detail: 'a table literal', body: '([] a:1 2 3; b:`x`y`z)' },
];

export function createEditor(opts: QEditorOpts): EditorView {
  const currentInterp = () => opts.getInterp?.() ?? opts.interp;
  const infoFor = (name: string, b: any): string => {
    const doc = DOCS[name] ?? {};
    const sig = doc.sig ?? b?.sig ?? '';
    const text = doc.doc ?? b?.doc ?? '';
    const ex = (doc.ex ?? b?.ex ?? []) as string[];
    return [sig, text, ex.length ? 'e.g.  ' + ex[0] : ''].filter(Boolean).join('\n');
  };

  const completions = (ctx: CompletionContext): CompletionResult | null => {
    // `symbol completions: colours, shapes, palettes
    const tick = ctx.matchBefore(/`[A-Za-z#0-9]*/);
    if (tick) {
      const options = [
        ...COLOR_NAMES.map((c) => ({ label: '`' + c, type: 'constant', detail: 'colour' })),
        ...SHAPE_NAMES.map((c) => ({ label: '`' + c, type: 'enum', detail: 'shape' })),
        ...PALETTE_NAMES.map((c) => ({ label: '`' + c, type: 'variable', detail: 'palette' })),
      ];
      return { from: tick.from, options, validFor: /^`[A-Za-z#0-9]*$/ };
    }

    const word = ctx.matchBefore(/[.A-Za-z][A-Za-z0-9_.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;

    const options: {
      label: string;
      type: string;
      detail?: string;
      info?: string;
      boost?: number;
      apply?: string;
    }[] = [];

    const interp = currentInterp();
    for (const [name, b] of interp.builtins) {
      if (!/^[.A-Za-z]/.test(name)) continue;
      const ns = name.startsWith('.');
      options.push({
        label: name,
        type: 'function',
        detail: (DOCS[name]?.sig ?? b.sig ?? '').split('·')[0].trim(),
        info: infoFor(name, b),
        boost: ns ? -10 : name.length < 4 ? 5 : 0,
      });
    }
    for (const [name, v] of interp.globals) {
      if (!/^[.A-Za-z]/.test(name)) continue;
      if (interp.builtins.has(name)) continue;
      options.push({
        label: name,
        type: v && v.t === 100 ? 'function' : v && (v.t === 98 || v.t === 99) ? 'class' : 'variable',
        detail: v ? describeType(v) : '',
        boost: 20,
      });
    }
    for (const [name, hook] of Object.entries(interp.dynamicHooks)) {
      if (!/^[.A-Za-z]/.test(name)) continue;
      if (interp.globals.has(name)) continue;
      options.push({
        label: name,
        type: 'constant',
        detail: DYNAMIC_DOCS[name] ?? 'live value',
        boost: name.startsWith('.p5.') ? 8 : 0,
      });
    }
    for (const s of SNIPPETS)
      options.push({
        label: s.label,
        type: 'keyword',
        detail: s.detail,
        apply: s.body,
        info: s.body,
        boost: 10,
      });

    return { from: word.from, options, validFor: /^[.A-Za-z][A-Za-z0-9_.]*$/ };
  };

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      lineNumbers(),
      history(),
      drawSelection(),
      highlightSpecialChars(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      bracketMatching(),
      closeBrackets(),
      autocompletion({ override: [completions], activateOnTyping: true }),
      hoverTooltip(
        (view, pos, side) => {
          const hit = hoverDefinitionAt(
            view.state.doc.toString(),
            pos,
            currentInterp(),
            side
          );
          if (!hit) return null;
          return {
            pos: hit.from,
            end: hit.to,
            above: true,
            create: () => ({ dom: definitionTooltip(hit.definition) }),
          };
        },
        { hoverTime: 140, hideOnChange: true }
      ),
      qLanguage,
      syntaxHighlighting(qHighlight),
      theme,
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            opts.onRun();
            return true;
          },
        },
        {
          key: 'Shift-Enter',
          run: () => {
            opts.onRun();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...completionKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange?.(u.state.doc.toString());
      }),
    ],
  });

  return new EditorView({ state, parent: opts.parent });
}

export interface HoverDefinition {
  name: string;
  kind: 'builtin' | 'function';
  signature?: string;
  description: string;
  example?: string;
  source?: string;
}

export interface HoverDefinitionHit {
  from: number;
  to: number;
  definition: HoverDefinition;
}

const IDENT_CHAR = /[A-Za-z0-9_.]/;
const OP_CHAR = /[+\-*%&|^=<>!,#_$?@~:'\/\\]/;

/**
 * Resolve the q name/operator under a document position. Kept separate from
 * CodeMirror so the behavior can be tested without a browser.
 */
export function hoverDefinitionAt(
  doc: string,
  position: number,
  interp: Interp,
  side = 0
): HoverDefinitionHit | null {
  if (!doc.length) return null;
  // CodeMirror gives us a cursor position between characters plus the side
  // the pointer is actually on. Honour that side so a name immediately
  // followed by an operator (for example `move:{...}`) remains hoverable
  // across its full width instead of resolving its right half as `:`.
  let p = position - (side < 0 ? 1 : 0);
  p = Math.max(0, Math.min(p, doc.length - 1));
  if (!IDENT_CHAR.test(doc[p]) && !OP_CHAR.test(doc[p]) && p > 0) p--;
  const family = IDENT_CHAR.test(doc[p]) ? IDENT_CHAR : OP_CHAR.test(doc[p]) ? OP_CHAR : null;
  if (!family || !isCodePosition(doc, p)) return null;

  let from = p;
  let to = p + 1;
  while (from > 0 && family.test(doc[from - 1])) from--;
  while (to < doc.length && family.test(doc[to])) to++;
  const name = doc.slice(from, to);
  if (family === IDENT_CHAR && (!/^[A-Za-z.]/.test(name) || doc[from - 1] === '`')) return null;

  const local = localFunctionDefinition(doc, name, position, interp);
  if (local) return { from, to, definition: local };

  const builtin = interp.builtins.get(name);
  const ref = DOCS[name];
  if (builtin || ref) {
    return {
      from,
      to,
      definition: {
        name,
        kind: 'builtin',
        signature: ref?.sig ?? builtin?.sig,
        description: plainText(ref?.doc ?? builtin?.doc ?? 'q builtin'),
        example: (ref?.ex ?? builtin?.ex ?? [])[0],
      },
    };
  }

  const value = interp.globals.get(name);
  if (value && value.t >= 100 && value.t <= 112) {
    const source = value.t === 100 ? (value as any).src : undefined;
    return {
      from,
      to,
      definition: {
        name,
        kind: 'function',
        signature: source ? lambdaSignature(name, source) : `${name} · function`,
        description: 'Function defined in the live q session.',
        source: source ? `${name}:${source}` : undefined,
      },
    };
  }

  return null;
}

function isCodePosition(doc: string, pos: number): boolean {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  let quoted = false;
  let escaped = false;
  for (let i = lineStart; i <= pos; i++) {
    const c = doc[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      if (i === pos) return false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      if (i === pos) return false;
      continue;
    }
    if (c === '/' && (i === lineStart || /\s/.test(doc[i - 1]))) return false;
  }
  return !quoted;
}

function localFunctionDefinition(
  doc: string,
  name: string,
  hoverPos: number,
  interp: Interp
): HoverDefinition | null {
  if (!/^[A-Za-z.][A-Za-z0-9_.]*$/.test(name)) return null;
  const pattern = new RegExp(
    `(?:^|[;\\n])\\s*${escapeRegex(name)}\\s*(?:::|:)\\s*`,
    'g'
  );
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(doc))) matches.push(match);
  if (!matches.length) return null;
  const chosen =
    [...matches].reverse().find((m) => m.index <= hoverPos) ?? matches[0];
  const start = chosen.index + chosen[0].length;
  const source = readDefinitionExpression(doc, start).trim();
  if (!source) return null;
  const live = interp.globals.get(name);
  const functionLike =
    source.startsWith('{') ||
    /(?:[+\-*%&|^=<>!,#_$?@~:'\/\\]|[A-Za-z.][A-Za-z0-9_.]*)$/.test(source) &&
      !!live &&
      live.t >= 100 &&
      live.t <= 112;
  if (!functionLike) return null;
  return {
    name,
    kind: 'function',
    signature: source.startsWith('{') ? lambdaSignature(name, source) : `${name} · function`,
    description: 'Function defined in this sketch.',
    source: `${name}:${source}`,
  };
}

function readDefinitionExpression(doc: string, start: number): string {
  if (doc[start] !== '{') {
    const end = doc.slice(start).search(/[;\n]/);
    return doc.slice(start, end < 0 ? doc.length : start + end);
  }
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < doc.length; i++) {
    const c = doc[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return doc.slice(start, i + 1);
  }
  return doc.slice(start);
}

function lambdaSignature(name: string, source: string): string {
  const explicit = /^\{\s*\[([^\]]*)\]/.exec(source);
  if (explicit) {
    const params = explicit[1].split(';').map((s) => s.trim()).filter(Boolean);
    return params.length ? `${name}[${params.join(';')}]` : `${name}[]`;
  }
  const used = ['x', 'y', 'z'].filter((param) =>
    new RegExp(`\\b${param}\\b`).test(source)
  );
  return used.length ? `${name}[${used.join(';')}]` : `${name}[]`;
}

function plainText(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`([^`]*)`/g, '$1');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function definitionTooltip(def: HoverDefinition): HTMLElement {
  const card = document.createElement('div');
  card.className = 'cm-q-definition q-hover-card';
  const head = document.createElement('div');
  head.className = 'q-hover-head';
  const name = document.createElement('span');
  name.className = 'q-hover-name';
  name.textContent = def.name;
  const kind = document.createElement('span');
  kind.className = 'q-hover-kind';
  kind.textContent = def.kind;
  head.append(name, kind);
  card.append(head);
  if (def.signature) card.append(tooltipRow('q-hover-signature', def.signature));
  card.append(tooltipRow('q-hover-description', def.description));
  if (def.source) card.append(tooltipRow('q-hover-source', def.source));
  if (def.example) card.append(tooltipRow('q-hover-example', def.example));
  return card;
}

function tooltipRow(className: string, text: string): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  row.textContent = text;
  return row;
}

function describeType(v: QValue): string {
  if (v.t === 100) return 'lambda';
  if (v.t === 98) return `table · ${count(v)} rows`;
  if (v.t === 99) return `dict · ${count(v)} keys`;
  if (v.t < 0) return `${TYPE_NAME[Math.abs(v.t)] ?? '?'} atom`;
  return `${TYPE_NAME[Math.abs(v.t)] ?? 'list'} · ${count(v)}`;
}

/** the CodeMirror implementation of the CodeSource interface */
export function createCodeMirrorSource(opts: QEditorOpts): CodeSource {
  const view = createEditor(opts);
  return {
    get: () => view.state.doc.toString(),
    set: (text) => setEditorText(view, text),
    insert: (text) => insertAtCursor(view, text),
    selectionOrLine() {
      const sel = view.state.selection.main;
      return sel.empty
        ? view.state.doc.lineAt(sel.head).text
        : view.state.sliceDoc(sel.from, sel.to);
    },
    focus: () => view.focus(),
  };
}

export function setEditorText(view: EditorView, text: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: Math.min(text.length, view.state.selection.main.anchor) },
  });
}

export function insertAtCursor(view: EditorView, text: string) {
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
    scrollIntoView: true,
  });
  view.focus();
}
