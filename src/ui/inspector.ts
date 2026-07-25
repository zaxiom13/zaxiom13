// The Data tab: every variable you have defined, rendered as real tables.

import { el, clear } from './dom';
import type { Interp } from '../q/eval';
import {
  QValue,
  QTable,
  QDict,
  QAtom,
  QVector,
  isTable,
  isDict,
  isFunc,
  isKeyedTable,
  isAtom,
  count,
  at,
  TYPE_NAME,
} from '../q/value';
import { display, compact, cell, DEFAULT_OPTS } from '../q/format';

const MAX_ROWS = 200;

export function renderInspector(host: HTMLElement, ip: Interp, onEval: (src: string) => void) {
  clear(host);
  const names = [...ip.globals.keys()]
    .filter((n) => !ip.builtins.has(n))
    .filter((n) => !n.startsWith('.p5.') && n !== 'pal')
    .sort();

  host.append(
    el(
      'p',
      {},
      names.length
        ? 'Everything your program defined. Tap a name to inspect it.'
        : 'Nothing defined yet — run some code.'
    )
  );

  const list = el('div', { class: 'chips' });
  for (const n of names) {
    list.append(
      el(
        'button',
        {
          class: 'chip',
          onclick: () => {
            show(n);
            for (const c of Array.from(list.children)) c.classList.remove('active');
            (event?.target as HTMLElement)?.classList.add('active');
          },
        },
        n
      )
    );
  }
  host.append(list);

  const detail = el('div');
  host.append(detail);

  const summaryRows: [string, string][] = names.map((n) => {
    const v = ip.globals.get(n)!;
    return [n, describe(v)];
  });
  if (summaryRows.length) {
    const kv = el('div', { class: 'kv' });
    for (const [k, d] of summaryRows) kv.append(el('b', {}, k), el('span', {}, d));
    host.append(el('h3', {}, 'Summary'), kv);
  }

  function show(name: string) {
    clear(detail);
    const v = ip.globals.get(name);
    if (!v) return;
    detail.append(el('h3', {}, `${name}  ·  ${describe(v)}`));
    detail.append(valueView(v));
    detail.append(
      el(
        'div',
        { class: 'chips' },
        el('button', { class: 'chip', onclick: () => onEval(name) }, 'print in console'),
        el('button', { class: 'chip', onclick: () => onEval(`meta ${name}`) }, 'meta'),
        el('button', { class: 'chip', onclick: () => onEval(`count ${name}`) }, 'count')
      )
    );
  }

  if (names.length) show(names[0]);
}

export function describe(v: QValue): string {
  if (isFunc(v)) return v.t === 100 ? 'function' : 'primitive';
  if (isKeyedTable(v)) return `keyed table · ${count(v)} rows`;
  if (isTable(v)) return `table · ${count(v)} rows × ${(v as QTable).c.length} cols`;
  if (isDict(v)) return `dictionary · ${count(v)} keys`;
  if (isAtom(v)) return `${TYPE_NAME[Math.abs(v.t)] ?? '?'} atom`;
  return `${TYPE_NAME[Math.abs(v.t)] ?? 'list'} · ${count(v)}`;
}

function valueView(v: QValue): HTMLElement {
  if (isKeyedTable(v)) {
    const kt = v as QDict;
    const k = kt.k as QTable;
    const val = kt.v as QTable;
    return tableView(
      [...k.c.map((c) => c + ' ▸'), ...val.c],
      [...k.v, ...val.v],
      count(v)
    );
  }
  if (isTable(v)) {
    const t = v as QTable;
    return tableView(t.c, t.v, count(t));
  }
  if (isDict(v)) {
    const d = v as QDict;
    const n = Math.min(count(d.k), MAX_ROWS);
    const rows: HTMLElement[] = [];
    for (let i = 0; i < n; i++)
      rows.push(
        el(
          'tr',
          {},
          el('td', { class: 'sym' }, cell(at(d.k, i), DEFAULT_OPTS)),
          el('td', {}, cell(at(d.v, i), DEFAULT_OPTS))
        )
      );
    return el(
      'div',
      { style: { overflow: 'auto', maxHeight: '50vh' } },
      el(
        'table',
        { class: 'grid' },
        el('thead', {}, el('tr', {}, el('th', {}, 'key'), el('th', {}, 'value'))),
        el('tbody', {}, ...rows)
      )
    );
  }
  return el('pre', { style: { whiteSpace: 'pre', overflow: 'auto', fontSize: '12px' } }, display(v));
}

function tableView(cols: string[], vals: QValue[], n: number): HTMLElement {
  const rows: HTMLElement[] = [];
  const shown = Math.min(n, MAX_ROWS);
  for (let r = 0; r < shown; r++) {
    rows.push(
      el(
        'tr',
        {},
        ...vals.map((c) => {
          const v = at(c, r);
          const t = Math.abs(v.t);
          const cls = t === 11 ? 'sym' : t === 10 ? 'str' : t >= 1 && t <= 9 ? 'num' : '';
          return el('td', { class: cls }, cell(v, DEFAULT_OPTS));
        })
      )
    );
  }
  return el(
    'div',
    { style: { overflow: 'auto', maxHeight: '50vh' } },
    el(
      'table',
      { class: 'grid' },
      el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {}, c)))),
      el('tbody', {}, ...rows)
    ),
    n > shown ? el('p', {}, `… ${n - shown} more rows`) : null
  );
}
