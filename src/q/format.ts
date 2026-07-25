// Console formatting, mirroring q's own display (.Q.s).

import {
  QValue,
  QAtom,
  QVector,
  QDict,
  QTable,
  QLambda,
  QPrim,
  QProj,
  QIter,
  QComp,
  count,
  at,
  items,
  isAtom,
  isDict,
  isTable,
  isFunc,
  isKeyedTable,
  TYPE_CHAR,
  NULL_LONG,
  INF_LONG,
  NEG_INF_LONG,
  NULL_INT,
  NULL_SHORT,
  NULL_BIG,
  INF_BIG,
  isNullValue,
} from './value';
import { ymdFromDays } from './lexer';

export interface FmtOpts {
  precision: number; // \P
  maxRows: number;
  maxWidth: number;
}

export const DEFAULT_OPTS: FmtOpts = { precision: 7, maxRows: 25, maxWidth: 200 };

const pad2 = (n: number) => String(Math.abs(n)).padStart(2, '0');
const pad3 = (n: number) => String(Math.abs(n)).padStart(3, '0');
const pad4 = (n: number) => String(Math.abs(n)).padStart(4, '0');

/** C-style %g */
export function gfmt(v: number, prec = 7): string {
  if (Number.isNaN(v)) return '0n';
  if (v === Infinity) return '0w';
  if (v === -Infinity) return '-0w';
  if (v === 0) return Object.is(v, -0) ? '-0' : '0';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  let s: string;
  if (exp < -5 || exp >= prec) {
    s = v.toExponential(Math.max(prec - 1, 0));
    let [m, e] = s.split('e');
    if (m.indexOf('.') >= 0) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const en = parseInt(e, 10);
    s = m + 'e' + (en < 0 ? '-' : '+') + String(Math.abs(en)).padStart(2, '0');
  } else {
    s = v.toFixed(Math.max(0, prec - 1 - exp));
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

function fmtFloatAtom(v: number, suffix: string, prec: number): string {
  if (Number.isNaN(v)) return suffix === 'e' ? '0Ne' : '0n';
  if (v === Infinity) return suffix === 'e' ? '0We' : '0w';
  if (v === -Infinity) return suffix === 'e' ? '-0We' : '-0w';
  const s = gfmt(v, prec);
  return /[.e]/.test(s) ? s + (suffix === 'e' ? 'e' : '') : s + suffix;
}

export function fmtTime(ms: number): string {
  const neg = ms < 0;
  let v = Math.abs(ms);
  const h = Math.floor(v / 3600000);
  const m = Math.floor(v / 60000) % 60;
  const s = Math.floor(v / 1000) % 60;
  const f = v % 1000;
  return (neg ? '-' : '') + pad2(h) + ':' + pad2(m) + ':' + pad2(s) + '.' + pad3(f);
}

export function fmtDate(days: number): string {
  const [y, m, d] = ymdFromDays(days);
  return pad4(y) + '.' + pad2(m) + '.' + pad2(d);
}

function fmtMonth(m: number): string {
  const y = 2000 + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return pad4(y) + '.' + pad2(mm + 1) + 'm';
}

function fmtTimespan(n: bigint): string {
  const neg = n < 0n;
  let v = neg ? -n : n;
  const day = v / 86400000000000n;
  v %= 86400000000000n;
  const h = v / 3600000000000n;
  v %= 3600000000000n;
  const m = v / 60000000000n;
  v %= 60000000000n;
  const s = v / 1000000000n;
  const ns = v % 1000000000n;
  return (
    (neg ? '-' : '') +
    day.toString() +
    'D' +
    pad2(Number(h)) +
    ':' +
    pad2(Number(m)) +
    ':' +
    pad2(Number(s)) +
    '.' +
    String(ns).padStart(9, '0')
  );
}

function fmtTimestamp(n: bigint): string {
  const neg = n < 0n;
  let days = n / 86400000000000n;
  let rem = n % 86400000000000n;
  if (rem < 0n) {
    days -= 1n;
    rem += 86400000000000n;
  }
  const h = rem / 3600000000000n;
  rem %= 3600000000000n;
  const m = rem / 60000000000n;
  rem %= 60000000000n;
  const s = rem / 1000000000n;
  const ns = rem % 1000000000n;
  return (
    fmtDate(Number(days)) +
    'D' +
    pad2(Number(h)) +
    ':' +
    pad2(Number(m)) +
    ':' +
    pad2(Number(s)) +
    '.' +
    String(ns).padStart(9, '0')
  );
}

function fmtDatetime(v: number): string {
  if (Number.isNaN(v)) return '0Nz';
  const days = Math.floor(v);
  const ms = Math.round((v - days) * 86400000);
  return fmtDate(days) + 'T' + fmtTime(ms);
}

export function escapeStr(s: string): string {
  let out = '';
  for (const c of s) {
    if (c === '"') out += '\\"';
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\t') out += '\\t';
    else if (c === '\r') out += '\\r';
    else out += c;
  }
  return out;
}

/**
 * Format a raw value of type t.
 * `bare` drops type suffixes / backticks / quotes (table & dict cells).
 */
export function fmtRaw(t: number, v: any, opts: FmtOpts, bare = false): string {
  const tt = Math.abs(t);
  switch (tt) {
    case 1:
      return bare ? String(v ? 1 : 0) : (v ? '1' : '0') + 'b';
    case 2:
      return String(v);
    case 4:
      return (bare ? '' : '0x') + Number(v).toString(16).padStart(2, '0');
    case 5:
      return v === NULL_SHORT ? (bare ? '0N' : '0Nh') : v === 32767 ? (bare ? '0W' : '0Wh') : String(v) + (bare ? '' : 'h');
    case 6:
      return v === NULL_INT ? (bare ? '0N' : '0Ni') : v === 2147483647 ? (bare ? '0W' : '0Wi') : String(v) + (bare ? '' : 'i');
    case 7:
      if (v === NULL_LONG) return '0N';
      if (v === INF_LONG) return '0W';
      if (v === NEG_INF_LONG) return '-0W';
      return String(v);
    case 8:
      return fmtFloatAtom(v, bare ? '' : 'e', opts.precision);
    case 9:
      return fmtFloatAtom(v, bare ? '' : 'f', opts.precision);
    case 10:
      return bare ? String(v) : '"' + escapeStr(String(v)) + '"';
    case 11:
      return bare ? String(v) : '`' + String(v);
    case 12:
      return v === NULL_BIG ? '0Np' : v === INF_BIG ? '0Wp' : fmtTimestamp(v as bigint);
    case 13:
      return v === NULL_INT ? '0Nm' : fmtMonth(v);
    case 14:
      return v === NULL_INT ? '0Nd' : fmtDate(v);
    case 15:
      return fmtDatetime(v);
    case 16:
      return v === NULL_BIG ? '0Nn' : v === INF_BIG ? '0Wn' : fmtTimespan(v as bigint);
    case 17: {
      if (v === NULL_INT) return '0Nu';
      const neg = v < 0;
      const a = Math.abs(v);
      return (neg ? '-' : '') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
    }
    case 18: {
      if (v === NULL_INT) return '0Nv';
      const neg = v < 0;
      const a = Math.abs(v);
      return (
        (neg ? '-' : '') + pad2(Math.floor(a / 3600)) + ':' + pad2(Math.floor(a / 60) % 60) + ':' + pad2(a % 60)
      );
    }
    case 19:
      return v === NULL_INT ? '0Nt' : fmtTime(v);
    default:
      return String(v);
  }
}

/** One-line compact form, as used inside nested lists and cells. */
export function compact(x: QValue, opts: FmtOpts = DEFAULT_OPTS, bare = false): string {
  if (isFunc(x)) return fmtFunc(x, opts);
  if (x.t === -101) return '::';
  if (isAtom(x)) return fmtRaw(x.t, (x as QAtom).v, opts, bare);
  if (isTable(x)) return '+' + compact(tableToDict(x as QTable), opts);
  if (isDict(x)) {
    const d = x as QDict;
    return compact(d.k, opts) + '!' + compact(d.v, opts);
  }
  const n = count(x);
  if (x.t === 10) return bare ? (x as QVector).v : '"' + escapeStr((x as QVector).v as string) + '"';
  if (x.t === 0) {
    if (n === 0) return '()';
    return '(' + (x as QVector).v.map((e: QValue) => compact(e, opts, bare)).join(';') + ')';
  }
  if (n === 0) return '`' + (TYPE_CHAR[x.t] === 'j' ? 'long' : typeNameOf(x.t)) + '$()';
  const arr = (x as QVector).v as any[];
  if (x.t === 1) return arr.map((b) => (b ? '1' : '0')).join('') + (bare ? '' : 'b');
  if (x.t === 4)
    return (bare ? '' : '0x') + arr.map((b) => Number(b).toString(16).padStart(2, '0')).join('');
  if (x.t === 11) {
    if (bare) return arr.join(' ');
    return arr.map((s) => '`' + s).join('');
  }
  if (x.t === 9 || x.t === 8) {
    const strs = arr.map((v) => {
      if (Number.isNaN(v)) return '0n';
      if (v === Infinity) return '0w';
      if (v === -Infinity) return '-0w';
      return gfmt(v, opts.precision);
    });
    const allInt = strs.every((s) => !/[.e]/.test(s));
    const suffix = bare ? '' : allInt ? (x.t === 9 ? 'f' : 'e') : x.t === 8 ? 'e' : '';
    const body = strs.join(' ');
    return (n === 1 ? ',' : '') + body + suffix;
  }
  const strs = arr.map((v) => fmtRaw(x.t, v, opts, true));
  const suffix = bare ? '' : x.t === 5 ? 'h' : x.t === 6 ? 'i' : '';
  const attr = !bare && (x as QVector).a ? '`' + (x as QVector).a + '#' : '';
  return attr + (n === 1 ? ',' : '') + strs.join(' ') + suffix;
}

function typeNameOf(t: number): string {
  const names: Record<number, string> = {
    1: 'boolean',
    2: 'guid',
    4: 'byte',
    5: 'short',
    6: 'int',
    7: 'long',
    8: 'real',
    9: 'float',
    10: 'char',
    11: 'symbol',
    12: 'timestamp',
    13: 'month',
    14: 'date',
    15: 'datetime',
    16: 'timespan',
    17: 'minute',
    18: 'second',
    19: 'time',
  };
  return names[t] ?? 'long';
}

function tableToDict(t: QTable): QDict {
  return {
    t: 99,
    k: { t: 11, v: t.c.slice() } as QVector,
    v: { t: 0, v: t.v } as QVector,
  };
}

export function fmtFunc(x: QValue, opts: FmtOpts): string {
  switch (x.t) {
    case 100:
      return (x as QLambda).src;
    case 101:
    case 102:
      return (x as QPrim).name;
    case 104: {
      const p = x as QProj;
      return (
        fmtFunc(p.f, opts) +
        '[' +
        p.args.map((a) => (a === null ? '' : compact(a, opts))).join(';') +
        ']'
      );
    }
    case 105:
      return (x as QComp).fns.map((f) => fmtFunc(f, opts)).join(' ');
    default: {
      const it = x as QIter;
      return fmtFunc(it.f, opts) + it.adv;
    }
  }
}

/** Cell text for a value inside a table/dict column. */
export function cell(x: QValue, opts: FmtOpts): string {
  if (isAtom(x)) return fmtRaw(x.t, (x as QAtom).v, opts, true);
  if (isFunc(x)) return fmtFunc(x, opts);
  if (x.t === 10) return '"' + escapeStr((x as QVector).v as string) + '"';
  if (isTable(x)) return '+' + compact(tableToDict(x as QTable), opts);
  if (isDict(x)) return compact(x, opts);
  return compact(x, opts, false);
}

// q left-aligns every column, including numeric ones.
function isRightAligned(_t: number): boolean {
  return false;
}

/** Full multi-line display, as the q console prints it. */
export function display(x: QValue, opts: FmtOpts = DEFAULT_OPTS): string {
  return displayLines(x, opts).join('\n');
}

export function displayLines(x: QValue, opts: FmtOpts = DEFAULT_OPTS): string[] {
  if (isFunc(x)) return [fmtFunc(x, opts)];
  if (x.t === -101) return ['::'];
  if (isAtom(x)) return [fmtRaw(x.t, (x as QAtom).v, opts)];
  if (x.t > 0 && x.t <= 19) return [compact(x, opts)];
  return s2Lines(x, opts);
}

/** Pad a matrix of cells into aligned rows (q's .Q.tab). */
function tabAlign(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const r of rows)
    r.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 0, c.length);
    });
  return rows.map((r) =>
    r
      .map((c, i) => c.padEnd(widths[i]))
      .join(' ')
      .replace(/\s+$/, '')
  );
}

/**
 * q's .Q.s2: the block of lines used for a value inside a table column,
 * dictionary value or nested list.
 */
export function s2Lines(x: QValue, opts: FmtOpts = DEFAULT_OPTS): string[] {
  if (isTable(x)) return tableLines(x as QTable, opts);
  if (isKeyedTable(x)) return keyedTableLines(x as QDict, opts);
  if (isDict(x)) return dictLines(x as QDict, opts);
  if (isFunc(x)) return [fmtFunc(x, opts)];
  if (isAtom(x)) return [fmtRaw(x.t, (x as QAtom).v, opts, true)];
  const n = count(x);
  if (n === 0) return [];
  if (x.t > 0 && x.t <= 19) {
    const out: string[] = [];
    for (let i = 0; i < n; i++) out.push(cell(at(x, i), opts));
    return out;
  }
  const els = (x as QVector).v as QValue[];
  const types = new Set(els.map((e) => e.t));
  const anySpecial = els.some((e) => e.t < 0 || e.t > 97);
  const counts = new Set(els.map((e) => count(e)));
  const t0 = els[0].t;
  if (anySpecial || counts.size > 1 || (types.size === 1 && (t0 === 1 || t0 === 4 || t0 === 10)))
    return els.map((e) => (e.t > 97 || e.t < -19 ? s2Lines(e, opts).join('\n') : compact(e, opts)));
  return tabAlign(els.map((e) => s2Lines(e, opts)));
}

function colStrings(col: QValue, opts: FmtOpts): string[] {
  return s2Lines(col, opts);
}

function tableLines(t: QTable, opts: FmtOpts): string[] {
  const n = count(t);
  if (t.c.length === 0) return ['+`$()!()'];
  const shown = Math.min(n, opts.maxRows);
  const cols = t.v.map((c) => colStrings(selectFirst(c, shown), opts));
  const widths = t.c.map((name, i) =>
    Math.max(name.length, ...(cols[i].length ? cols[i].map((s) => s.length) : [0]))
  );
  const line = (cells: string[]) =>
    cells
      .map((s, i) => (s ?? '').padEnd(widths[i]))
      .join(' ')
      .replace(/\s+$/, '');
  const total = widths.reduce((a, b) => a + b, 0) + widths.length - 1;
  const out: string[] = [];
  out.push(line(t.c.slice()));
  out.push('-'.repeat(Math.max(total, 0)));
  for (let r = 0; r < shown; r++) out.push(line(cols.map((c) => c[r])));
  if (n > shown) out.push('..');
  return out;
}

function selectFirst(col: QValue, n: number): QValue {
  if (count(col) <= n) return col;
  if (col.t === 10) return { t: 10, v: (col.v as string).slice(0, n) } as QVector;
  if (col.t >= 0 && col.t <= 19) return { t: col.t, v: (col.v as any[]).slice(0, n) } as QVector;
  return col;
}

function dictLines(d: QDict, opts: FmtOpts): string[] {
  const n = count(d.k);
  const shown = Math.min(n, opts.maxRows);
  const keys = s2Lines(selectFirst(d.k, shown), opts);
  const vals = s2Lines(selectFirst(d.v, shown), opts);
  const kw = Math.max(0, ...keys.slice(0, shown).map((k) => k.length));
  const out: string[] = [];
  for (let i = 0; i < shown; i++) {
    out.push((keys[i].padEnd(kw) + '| ' + vals[i]).replace(/\s+$/, ''));
  }
  if (n > shown) out.push('..');
  return out;
}

function keyedTableLines(kt: QDict, opts: FmtOpts): string[] {
  const kT = kt.k as QTable;
  const vT = kt.v as QTable;
  const n = count(kT);
  const shown = Math.min(n, opts.maxRows);
  const kCols = kT.v.map((c) => colStrings(selectFirst(c, shown), opts));
  const vCols = vT.v.map((c) => colStrings(selectFirst(c, shown), opts));
  const kRight = kT.v.map((c) => isRightAligned(c.t));
  const vRight = vT.v.map((c) => isRightAligned(c.t));
  const kW = kT.c.map((name, i) => Math.max(name.length, ...(kCols[i].length ? kCols[i].map((s) => s.length) : [0])));
  const vW = vT.c.map((name, i) => Math.max(name.length, ...(vCols[i].length ? vCols[i].map((s) => s.length) : [0])));
  const mk = (kc: string[], vc: string[]) =>
    (
      kc.map((s, i) => (kRight[i] ? s.padStart(kW[i]) : s.padEnd(kW[i]))).join(' ') +
      '| ' +
      vc.map((s, i) => (vRight[i] ? s.padStart(vW[i]) : s.padEnd(vW[i]))).join(' ')
    ).replace(/\s+$/, '');
  const kTotal = kW.reduce((a, b) => a + b, 0) + kW.length - 1;
  const vTotal = vW.reduce((a, b) => a + b, 0) + vW.length - 1;
  const out: string[] = [];
  out.push(mk(kT.c.slice(), vT.c.slice()));
  out.push('-'.repeat(Math.max(kTotal, 0)) + '| ' + '-'.repeat(Math.max(vTotal, 0)));
  for (let r = 0; r < shown; r++) out.push(mk(kCols.map((c) => c[r]), vCols.map((c) => c[r])));
  if (n > shown) out.push('..');
  return out;
}
