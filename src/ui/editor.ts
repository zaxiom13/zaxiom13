// CodeMirror 6 editor with a q language mode.

import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, highlightSpecialChars, drawSelection, lineNumbers, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
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
    '.cm-scroller': { overflow: 'auto', scrollbarWidth: 'thin' },
  },
  { dark: true }
);

export interface QEditorOpts {
  parent: HTMLElement;
  doc: string;
  onRun: () => void;
  onChange?: (doc: string) => void;
  interp: Interp;
}

export function createEditor(opts: QEditorOpts): EditorView {
  const completions = (ctx: CompletionContext): CompletionResult | null => {
    const word = ctx.matchBefore(/[.A-Za-z][A-Za-z0-9_.]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    const options: { label: string; type: string; detail?: string; info?: string }[] = [];
    for (const [name, b] of opts.interp.builtins) {
      if (!/^[.A-Za-z]/.test(name)) continue;
      options.push({
        label: name,
        type: 'function',
        detail: b.sig ?? '',
        info: b.doc ?? '',
      });
    }
    for (const [name] of opts.interp.globals) {
      if (!/^[.A-Za-z]/.test(name)) continue;
      if (opts.interp.builtins.has(name)) continue;
      options.push({ label: name, type: 'variable' });
    }
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
