// The Learn tab.

import { el, clear, md, toast } from './dom';
import { LESSONS, Lesson, Block } from '../content/lessons';
import { createInterp, runConsole } from '../q/index';
import { SketchRuntime } from '../sketch/runtime';
import { truthy } from '../q/eval';
import type { Interp } from '../q/eval';

const DONE_KEY = 'qsketch.done';

const loadDone = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
};
const saveDone = (s: Set<string>) => localStorage.setItem(DONE_KEY, JSON.stringify([...s]));

export interface LessonsOpts {
  onSendToEditor: (code: string) => void;
}

export function renderLessons(host: HTMLElement, opts: LessonsOpts) {
  const done = loadDone();
  index();

  function index() {
    clear(host);
    host.append(
      el('h2', {}, 'Learn q by drawing'),
      el(
        'p',
        {
          html: md(
            'Eighteen short lessons. Every snippet runs right here in the same interpreter that drives the canvas — poke at them, break them, rewrite them.'
          ),
        }
      )
    );
    const pct = Math.round((100 * done.size) / LESSONS.filter((l) => l.challenge).length);
    host.append(
      el('div', { class: 'meter' }, el('i', { style: { width: `${Math.min(100, pct)}%` } })),
      el('p', { class: 'note' }, `${done.size} challenge${done.size === 1 ? '' : 's'} solved`)
    );
    const list = el('div', { class: 'lesson-list' });
    LESSONS.forEach((l, i) => {
      list.append(
        el(
          'button',
          { class: `card${done.has(l.id) ? ' done' : ''}`, onclick: () => detail(l) },
          el('div', { class: 'n' }, String(i + 1).padStart(2, '0')),
          el('div', { class: 't' }, l.title),
          el('div', { class: 'd' }, l.blurb)
        )
      );
    });
    host.append(list);
    host.append(
      el('h3', {}, 'Cheat sheet'),
      el('div', {
        class: 'kv',
        html: CHEATS.map(([a, b]) => `<b>${escapeHtml(a)}</b><span>${escapeHtml(b)}</span>`).join(''),
      })
    );
  }

  function detail(l: Lesson) {
    clear(host);
    // each lesson gets its own q session, like a page of documentation
    const ip = createInterp({ out: () => {} });
    new SketchRuntime(ip, null, {});

    host.append(
      el(
        'div',
        { class: 'chips' },
        el('button', { class: 'chip', onclick: () => index() }, '← all lessons')
      ),
      el('h2', {}, l.title),
      el('p', { class: 'note' }, l.blurb)
    );

    for (const b of l.blocks) host.append(blockView(b, ip, opts));

    if (l.challenge) {
      const ch = l.challenge;
      host.append(el('h3', {}, 'Challenge'));
      host.append(el('p', { html: md(ch.prompt) }));
      const ta = el('textarea', {
        spellcheck: 'false',
        style: {
          width: '100%',
          minHeight: '96px',
          background: '#0d1219',
          color: '#dfe7ef',
          border: '1px solid #232e3b',
          borderRadius: '10px',
          padding: '10px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '12.5px',
          resize: 'vertical',
        },
      }) as HTMLTextAreaElement;
      ta.value = ch.starter;
      const result = el('div', { class: 'result', style: { display: 'none' } });
      const bar = el(
        'div',
        { class: 'chips' },
        el(
          'button',
          {
            class: 'chip',
            onclick: () => {
              const test = createInterp({ out: () => {} });
              new SketchRuntime(test, null, {});
              const r1 = runConsole(test, ta.value);
              result.style.display = 'block';
              if (!r1.ok) {
                result.className = 'result err';
                result.textContent = "'" + r1.error!.msg + (r1.error!.hint ? '\n' + r1.error!.hint : '');
                return;
              }
              const r2 = runConsole(test, ch.check);
              const ok = r2.ok && r2.value !== undefined && truthy(r2.value);
              result.className = ok ? 'result' : 'result err';
              result.textContent = ok
                ? '✓ correct — nice one'
                : `not yet.  ${ch.hint ?? 'check the expected shape of the answer'}`;
              if (ok) {
                done.add(l.id);
                saveDone(done);
                toast('challenge solved');
              }
            },
          },
          'Check'
        ),
        el(
          'button',
          { class: 'chip', onclick: () => opts.onSendToEditor(ta.value) },
          'open in editor'
        ),
        el(
          'button',
          {
            class: 'chip',
            onclick: () => {
              ta.value = ch.solution;
            },
          },
          'show solution'
        )
      );
      host.append(ta, bar, result);
    }

    const i = LESSONS.indexOf(l);
    const nav = el('div', { class: 'chips', style: { marginTop: '22px' } });
    if (i > 0)
      nav.append(
        el('button', { class: 'chip', onclick: () => detail(LESSONS[i - 1]) }, '← ' + LESSONS[i - 1].title)
      );
    if (i < LESSONS.length - 1)
      nav.append(
        el('button', { class: 'chip', onclick: () => detail(LESSONS[i + 1]) }, LESSONS[i + 1].title + ' →')
      );
    host.append(nav);
    host.scrollTop = 0;
  }
}

function blockView(b: Block, ip: Interp, opts: LessonsOpts): HTMLElement {
  if (b.kind === 'text') return el('p', { html: md(b.text!) });
  if (b.kind === 'note')
    return el('p', {
      html: md(b.text!),
      style: {
        borderLeft: '2px solid #2a6a9e',
        paddingLeft: '10px',
        color: '#9fb4c7',
        fontSize: '13px',
      },
    });

  const out = el('div', { class: 'result', style: { display: 'none' } });
  const pre = el('pre', {}, b.code!);
  const evaluate = () => {
    const r = runConsole(ip, b.code!);
    out.style.display = 'block';
    out.className = r.ok ? 'result' : 'result err';
    out.textContent = r.ok ? r.output || '(no output)' : "'" + r.error!.msg + (r.error!.hint ? '  — ' + r.error!.hint : '');
  };
  const bar = el(
    'div',
    { class: 'snippet-bar' },
    b.kind === 'sketch'
      ? el('button', { onclick: () => opts.onSendToEditor(b.code!) }, 'Run on canvas ▶')
      : el('button', { onclick: evaluate }, 'Evaluate'),
    el('button', { class: 'ghost', onclick: () => opts.onSendToEditor(b.code!) }, 'Edit'),
    b.err ? el('span', { class: 'pill bad', style: { marginLeft: 'auto' } }, 'errors on purpose') : null
  );
  return el('div', { class: 'snippet' }, pre, bar, out);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const CHEATS: [string, string][] = [
  ['til n', 'first n integers'],
  ['count x', 'length'],
  ['x where c', 'filter by a boolean vector'],
  ['sum / avg / max', 'aggregate a vector'],
  ['sums / deltas', 'running total / differences'],
  ['asc / desc / iasc', 'sort, sort down, grade'],
  ['x!y', 'make a dictionary'],
  ['([] a:..; b:..)', 'make a table'],
  ['select .. by .. from t where ..', 'query a table'],
  ['update c:expr from t', 'add or replace a column'],
  ['f each x', 'apply to every item'],
  ['f/ x   f\\ x', 'fold / running fold'],
  ['n f/ x', 'apply f n times'],
  ['x rotate y', 'shift, wrapping'],
  ['n xbar x', 'round down to a bucket'],
  ['?[c;a;b]', 'elementwise if'],
  ['0N!x', 'print and return x'],
  ['draw scene', 'render a scene table'],
  ['frame:{[t] .. }', 'animate: draw every ~16ms'],
  ['frame:{[s;t] .. }', '...and get back what you returned'],
];
