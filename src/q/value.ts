// Core value model for the q interpreter.
//
// Type numbers follow kdb+ exactly: atoms are negative, vectors positive,
// 0 is a general list, 98 table, 99 dictionary, 100+ functions.

export const NULL_LONG = -9223372036854775808; // -2^63, exactly representable as a double
export const INF_LONG = 9223372036854775808; //  2^63
export const NEG_INF_LONG = -9223372036854773760; // distinct sentinel just above -2^63
export const NULL_INT = -2147483648;
export const INF_INT = 2147483647;
export const NEG_INF_INT = -2147483647;
export const NULL_SHORT = -32768;
export const INF_SHORT = 32767;
export const NEG_INF_SHORT = -32767;
export const NULL_GUID = '00000000-0000-0000-0000-000000000000';

export type QValue =
  | QAtom
  | QVector
  | QDict
  | QTable
  | QLambda
  | QPrim
  | QProj
  | QComp
  | QIter;

export interface QAtom {
  t: number; // -1 .. -19
  v: any;
}

export interface QVector {
  t: number; // 0 .. 19
  v: any; // string for char vectors, array otherwise
  a?: string; // attribute: s u p g
}

export interface QDict {
  t: 99;
  k: QValue;
  v: QValue;
}

export interface QTable {
  t: 98;
  c: string[];
  v: QValue[]; // column vectors, all of equal length
}

export interface QLambda {
  t: 100;
  params: string[];
  body: any[]; // AST nodes
  src: string;
  ctx?: Record<string, QValue>; // captured locals (for closures created by projections)
}

export interface QPrim {
  t: 101 | 102;
  name: string;
  rank: number[]; // supported ranks
  f: (...args: any[]) => QValue;
}

export interface QProj {
  t: 104;
  f: QValue;
  args: (QValue | null)[]; // null = elided
}

export interface QComp {
  t: 105;
  fns: QValue[];
}

export interface QIter {
  t: 106 | 107 | 108 | 109 | 110 | 111;
  f: QValue;
  adv: string; // ' / \ ': /: \:
}

export const TYPE_CHAR: Record<number, string> = {
  0: '',
  1: 'b',
  2: 'g',
  4: 'x',
  5: 'h',
  6: 'i',
  7: 'j',
  8: 'e',
  9: 'f',
  10: 'c',
  11: 's',
  12: 'p',
  13: 'm',
  14: 'd',
  15: 'z',
  16: 'n',
  17: 'u',
  18: 'v',
  19: 't',
};

export const TYPE_NAME: Record<number, string> = {
  0: 'list',
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
  98: 'table',
  99: 'dictionary',
  100: 'lambda',
  101: 'unary primitive',
  102: 'operator',
  104: 'projection',
  105: 'composition',
};

export class QError extends Error {
  qmsg: string;
  hint?: string;
  constructor(msg: string, hint?: string) {
    super("'" + msg);
    this.qmsg = msg;
    this.hint = hint;
  }
}

export const err = (m: string, hint?: string): never => {
  throw new QError(m, hint);
};

// ---------------------------------------------------------------- constructors

export const atom = (t: number, v: any): QAtom => ({ t, v });
export const vec = (t: number, v: any): QVector => ({ t, v });
export const list = (v: QValue[]): QVector => ({ t: 0, v });
export const dict = (k: QValue, v: QValue): QDict => ({ t: 99, k, v });
export const table = (c: string[], v: QValue[]): QTable => ({ t: 98, c, v });

export const bool = (b: boolean | number): QAtom => atom(-1, b ? 1 : 0);
export const long = (n: number): QAtom => atom(-7, n);
export const int = (n: number): QAtom => atom(-6, n);
export const float = (n: number): QAtom => atom(-9, n);
export const char = (c: string): QAtom => atom(-10, c);
export const sym = (s: string): QAtom => atom(-11, s);
export const str = (s: string): QVector => vec(10, s);
export const symvec = (s: string[]): QVector => vec(11, s);
export const longvec = (n: number[]): QVector => vec(7, n);
export const floatvec = (n: number[]): QVector => vec(9, n);
export const boolvec = (n: number[]): QVector => vec(1, n);
export const NIL: QVector = { t: 0, v: [] };
export const UNIT: QAtom = { t: -101, v: 0 }; // :: generic null

export const isNil = (x: QValue) => x.t === -101;

// ---------------------------------------------------------------- predicates

export const isAtom = (x: QValue) => x.t < 0 && x.t >= -19;
export const isVector = (x: QValue) => x.t >= 0 && x.t <= 19;
export const isTable = (x: QValue): x is QTable => x.t === 98;
export const isDict = (x: QValue): x is QDict => x.t === 99;
export const isFunc = (x: QValue) => x.t >= 100 && x.t <= 112;
export const isKeyedTable = (x: QValue): x is QDict =>
  x.t === 99 && (x as QDict).k.t === 98 && (x as QDict).v.t === 98;
export const isNumericType = (t: number) => {
  const a = Math.abs(t);
  return a === 1 || a === 4 || (a >= 5 && a <= 9) || (a >= 12 && a <= 19);
};
export const isTemporalType = (t: number) => {
  const a = Math.abs(t);
  return a >= 12 && a <= 19;
};
export const isBigType = (t: number) => {
  const a = Math.abs(t);
  return a === 12 || a === 16;
};

// ---------------------------------------------------------------- null handling

export function nullValue(t: number): any {
  switch (Math.abs(t)) {
    case 1:
      return 0;
    case 2:
      return NULL_GUID;
    case 4:
      return 0;
    case 5:
      return NULL_SHORT;
    case 6:
      return NULL_INT;
    case 7:
      return NULL_LONG;
    case 8:
    case 9:
      return NaN;
    case 10:
      return ' ';
    case 11:
      return '';
    case 12:
    case 16:
      return NULL_BIG;
    case 13:
    case 14:
    case 17:
    case 18:
    case 19:
      return NULL_INT;
    case 15:
      return NaN;
    default:
      return null;
  }
}

export const NULL_BIG = -9223372036854775808n;
export const INF_BIG = 9223372036854775807n;

export function isNullValue(t: number, v: any): boolean {
  switch (Math.abs(t)) {
    case 1:
      return false;
    case 2:
      return v === NULL_GUID;
    case 4:
      return false;
    case 5:
      return v === NULL_SHORT;
    case 6:
      return v === NULL_INT;
    case 7:
      return v === NULL_LONG;
    case 8:
    case 9:
    case 15:
      return typeof v === 'number' && Number.isNaN(v);
    case 10:
      return v === ' ';
    case 11:
      return v === '';
    case 12:
    case 16:
      return v === NULL_BIG;
    case 13:
    case 14:
    case 17:
    case 18:
    case 19:
      return v === NULL_INT;
    default:
      return false;
  }
}

export const isNullAtom = (x: QValue) => x.t < 0 && x.t >= -19 && isNullValue(x.t, (x as QAtom).v);

// ---------------------------------------------------------------- access

export function count(x: QValue): number {
  if (x.t === 98) return (x as QTable).v.length ? len((x as QTable).v[0]) : 0;
  if (x.t === 99) return count((x as QDict).k);
  if (x.t < 0 || x.t > 19) return 1;
  return len(x as QVector);
}

function len(x: QValue): number {
  const v = (x as QVector).v;
  return typeof v === 'string' ? v.length : v.length;
}

/** Element i of a vector/list/table/dict, as a QValue. */
export function at(x: QValue, i: number): QValue {
  if (x.t === 0) return (x as QVector).v[i];
  if (x.t === 10) return atom(-10, (x as QVector).v[i]);
  if (x.t > 0 && x.t <= 19) return atom(-x.t, (x as QVector).v[i]);
  if (x.t === 98) {
    const tb = x as QTable;
    return dict(symvec(tb.c.slice()), listFrom(tb.v.map((c) => at(c, i))));
  }
  if (x.t === 99) {
    const d = x as QDict;
    return at(d.v, i);
  }
  return x;
}

/** Raw JS element (unwrapped). */
export function raw(x: QValue, i: number): any {
  if (x.t === 0) return (x as QVector).v[i];
  return (x as QVector).v[i];
}

/** JS array of raw values for a typed vector. */
export function rawArray(x: QValue): any[] {
  if (x.t === 10) return (x as QVector).v.split('');
  if (x.t >= 0 && x.t <= 19) return (x as QVector).v as any[];
  if (x.t < 0) return [(x as QAtom).v];
  return err('type');
}

/** Every element as QValue. */
export function items(x: QValue): QValue[] {
  const n = count(x);
  const out: QValue[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = at(x, i);
  return out;
}

export const listFrom = (xs: QValue[]): QVector => ({ t: 0, v: xs });

/** Build the most specific vector from a list of QValues. */
export function fromItems(xs: QValue[]): QVector {
  if (xs.length === 0) return { t: 0, v: [] };
  const t0 = xs[0].t;
  if (t0 < 0 && t0 >= -19) {
    let same = true;
    for (let i = 1; i < xs.length; i++)
      if (xs[i].t !== t0) {
        same = false;
        break;
      }
    if (same) {
      const t = -t0;
      if (t === 10) return vec(10, xs.map((x) => (x as QAtom).v).join(''));
      return vec(
        t,
        xs.map((x) => (x as QAtom).v)
      );
    }
  }
  return { t: 0, v: xs };
}

/** Build a typed vector from raw JS values of known type. */
export function typedVec(t: number, vals: any[]): QVector {
  if (t === 10) return vec(10, vals.join(''));
  return vec(t, vals);
}

export function enlist(x: QValue): QValue {
  if (x.t < 0 && x.t >= -19) return typedVec(-x.t, [(x as QAtom).v]);
  return listFrom([x]);
}

/** first element, q's `first` */
export function first(x: QValue): QValue {
  if (x.t === 98) {
    const tb = x as QTable;
    if (count(tb) === 0) return dict(symvec(tb.c.slice()), listFrom(tb.v.map((c) => nullAtomOf(c.t))));
    return at(x, 0);
  }
  if (x.t === 99) return first((x as QDict).v);
  if (x.t < 0 || x.t > 19) return x;
  if (count(x) === 0) return nullAtomOf(x.t);
  return at(x, 0);
}

export function nullAtomOf(t: number): QValue {
  const tt = Math.abs(t);
  if (tt === 0) return NIL;
  return atom(-tt, nullValue(tt));
}

// ---------------------------------------------------------------- equality

export function matchValues(a: QValue, b: QValue): boolean {
  if (a === b) return true;
  if (a.t !== b.t) return false;
  if (a.t === 98) {
    const x = a as QTable,
      y = b as QTable;
    if (x.c.length !== y.c.length) return false;
    for (let i = 0; i < x.c.length; i++) if (x.c[i] !== y.c[i]) return false;
    for (let i = 0; i < x.v.length; i++) if (!matchValues(x.v[i], y.v[i])) return false;
    return true;
  }
  if (a.t === 99) {
    const x = a as QDict,
      y = b as QDict;
    return matchValues(x.k, y.k) && matchValues(x.v, y.v);
  }
  if (a.t === 100) {
    return (a as QLambda).src === (b as QLambda).src;
  }
  if (a.t === 101 || a.t === 102) return (a as QPrim).name === (b as QPrim).name;
  if (a.t > 100) return false;
  if (a.t < 0) {
    return eqRaw((a as QAtom).v, (b as QAtom).v);
  }
  const n = count(a);
  if (n !== count(b)) return false;
  if (a.t === 0) {
    const av = (a as QVector).v as QValue[],
      bv = (b as QVector).v as QValue[];
    for (let i = 0; i < n; i++) if (!matchValues(av[i], bv[i])) return false;
    return true;
  }
  if (a.t === 10) return (a as QVector).v === (b as QVector).v;
  const av = (a as QVector).v as any[],
    bv = (b as QVector).v as any[];
  for (let i = 0; i < n; i++) if (!eqRaw(av[i], bv[i])) return false;
  return true;
}

function eqRaw(x: any, y: any): boolean {
  if (typeof x === 'number' && typeof y === 'number')
    return x === y || (Number.isNaN(x) && Number.isNaN(y));
  return x === y;
}

// ---------------------------------------------------------------- conversions

export function toNum(x: QValue): number {
  if (x.t < 0) {
    const v = (x as QAtom).v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
  }
  return err('type');
}

export function toInt(x: QValue): number {
  const n = toNum(x);
  return Math.trunc(n);
}

export function toStr(x: QValue): string {
  if (x.t === -11) return (x as QAtom).v;
  if (x.t === 10) return (x as QVector).v;
  if (x.t === -10) return (x as QAtom).v;
  if (x.t === 11 && count(x) === 1) return (x as QVector).v[0];
  return err('type');
}

export function symsOf(x: QValue): string[] {
  if (x.t === -11) return [(x as QAtom).v];
  if (x.t === 11) return (x as QVector).v as string[];
  if (x.t === 0 && count(x) === 0) return [];
  return err('type');
}

/** Promote a raw JS value to the widest of two numeric types. */
export function widerType(a: number, b: number): number {
  const ta = Math.abs(a),
    tb = Math.abs(b);
  if (ta === tb) return ta;
  const rank: Record<number, number> = { 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7 };
  const ra = rank[ta],
    rb = rank[tb];
  if (ra && rb) return ra > rb ? ta : tb;
  return ta > tb ? ta : tb;
}

export function shallowClone(x: QValue): QValue {
  if (x.t === 98) {
    const t = x as QTable;
    return table(t.c.slice(), t.v.slice());
  }
  if (x.t === 99) {
    const d = x as QDict;
    return dict(d.k, d.v);
  }
  if (x.t >= 0 && x.t <= 19) {
    const v = x as QVector;
    const out = vec(v.t, typeof v.v === 'string' ? v.v : (v.v as any[]).slice());
    out.a = v.a;
    return out;
  }
  return x;
}
