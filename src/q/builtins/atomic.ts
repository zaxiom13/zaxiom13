// Atomic (element-wise) primitives and the type-promotion rules behind them.

import {
  QValue,
  QAtom,
  QVector,
  QDict,
  QTable,
  atom,
  vec,
  typedVec,
  dict,
  table,
  listFrom,
  fromItems,
  items,
  count,
  at,
  isAtom,
  isDict,
  isTable,
  isFunc,
  isKeyedTable,
  matchValues,
  nullValue,
  isNullValue,
  NULL_LONG,
  NULL_INT,
  NULL_SHORT,
  NULL_BIG,
  err,
  QError,
} from '../value';
import { Interp } from '../eval';

const RANK: Record<number, number> = { 1: 0, 4: 1, 5: 2, 6: 3, 7: 4, 8: 5, 9: 6 };

/** Result type for + - * on two simple types. */
export function arithType(ta: number, tb: number): number {
  const a = Math.abs(ta),
    b = Math.abs(tb);
  const ra = RANK[a],
    rb = RANK[b];
  if (ra !== undefined && rb !== undefined) {
    const t = ra > rb ? a : b;
    return t === 1 || t === 4 ? 7 : t; // booleans and bytes widen to long
  }
  // temporal wins
  if (a >= 12 && a <= 19) return a;
  if (b >= 12 && b <= 19) return b;
  throw new QError('type', 'Arithmetic needs numeric or temporal arguments.');
}

const isTemporal = (t: number) => t >= 12 && t <= 19;
const isBig = (t: number) => t === 12 || t === 16;

export function numOf(v: any): number {
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') return v.length === 1 ? v.charCodeAt(0) : NaN;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v as number;
}

/** null-aware scalar wrapper for integer types */
function isIntNull(t: number, v: any): boolean {
  return isNullValue(t, v) && t !== 1 && t !== 4;
}

export interface AtomicSpec {
  name: string;
  /** raw scalar computation on numbers */
  num: (a: number, b: number) => number;
  /** variant that also sees the operand types (comparisons need them) */
  numT?: (a: number, b: number, ta: number, tb: number) => number;
  /** result type; default arithType */
  rtype?: (ta: number, tb: number) => number;
  /** bigint variant for timestamp/timespan */
  big?: (a: bigint, b: bigint) => bigint;
  /** allow symbol/char operands */
  sym?: (a: any, b: any) => any;
  keepNulls?: boolean;
}

export function atomicScalar(spec: AtomicSpec, ta: number, tb: number, a: any, b: any): [number, any] {
  const A = Math.abs(ta),
    B = Math.abs(tb);
  let rt = (spec.rtype ?? arithType)(A, B);
  if (isBig(A) || isBig(B) || isBig(rt)) {
    const ba = toBig(A, a),
      bb = toBig(B, b);
    if (ba === NULL_BIG || bb === NULL_BIG) return [rt, isBig(rt) ? NULL_BIG : nullValue(rt)];
    if (spec.big) {
      const r = spec.big(ba, bb);
      return [rt, isBig(rt) ? r : Number(r)];
    }
    const r = spec.num(Number(ba), Number(bb));
    return [rt, isBig(rt) ? BigInt(Math.round(r)) : r];
  }
  const na = numOf(a),
    nb = numOf(b);
  if (!spec.keepNulls && (isIntNull(A, a) || isIntNull(B, b))) return [rt, nullValue(rt)];
  let r = spec.numT ? spec.numT(na, nb, A, B) : spec.num(na, nb);
  if (rt === 10) return [10, String.fromCharCode(Math.trunc(r))];
  if (rt !== 9 && rt !== 8 && rt !== 15) {
    if (!Number.isFinite(r)) r = nullValue(rt);
    else {
      r = Math.trunc(r);
      if (rt === 6 || rt === 13 || rt === 14 || rt === 17 || rt === 18 || rt === 19) r = r | 0;
      else if (rt === 5) r = (r << 16) >> 16;
      else if (rt === 4) r = r & 255;
    }
  }
  return [rt, r];
}

function toBig(t: number, v: any): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (isNullValue(t, v)) return NULL_BIG;
    if (t === 14) return BigInt(Math.round(v)) * 86400000000000n; // date -> ns
    if (t === 19) return BigInt(Math.round(v)) * 1000000n; // time ms -> ns
    if (t === 17) return BigInt(Math.round(v)) * 60000000000n;
    if (t === 18) return BigInt(Math.round(v)) * 1000000000n;
    return BigInt(Math.round(v));
  }
  return 0n;
}

/** Apply a scalar operation element-wise across any two q values. */
export function atomic2(ip: Interp, x: QValue, y: QValue, spec: AtomicSpec): QValue {
  // tables
  if (isTable(x) || isTable(y)) {
    if (isTable(x) && isTable(y)) {
      const tx = x as QTable,
        ty = y as QTable;
      return table(
        tx.c.slice(),
        tx.v.map((c, i) => atomic2(ip, c, ty.v[ty.c.indexOf(tx.c[i])], spec))
      );
    }
    if (isTable(x)) {
      const tx = x as QTable;
      return table(tx.c.slice(), tx.v.map((c) => atomic2(ip, c, y, spec)));
    }
    const ty = y as QTable;
    return table(ty.c.slice(), ty.v.map((c) => atomic2(ip, x, c, spec)));
  }
  // dictionaries (upsert semantics when both are dicts)
  if (isDict(x) || isDict(y)) {
    if (isKeyedTable(x) && isKeyedTable(y)) {
      return dict((x as QDict).k, atomic2(ip, (x as QDict).v, (y as QDict).v, spec));
    }
    if (isKeyedTable(x)) return dict((x as QDict).k, atomic2(ip, (x as QDict).v, y, spec));
    if (isKeyedTable(y)) return dict((y as QDict).k, atomic2(ip, x, (y as QDict).v, spec));
    if (isDict(x) && isDict(y)) {
      const dx = x as QDict,
        dy = y as QDict;
      const keys: QValue[] = items(dx.k);
      const vals: QValue[] = items(dx.v);
      const ykeys = items(dy.k);
      const yvals = items(dy.v);
      ykeys.forEach((k, i) => {
        const ix = keys.findIndex((kk) => matchValues(kk, k));
        if (ix < 0) {
          keys.push(k);
          vals.push(yvals[i]);
        } else vals[ix] = atomic2(ip, vals[ix], yvals[i], spec);
      });
      return dict(fromItems(keys), fromItems(vals));
    }
    if (isDict(x)) {
      const dx = x as QDict;
      return dict(dx.k, atomic2(ip, dx.v, y, spec));
    }
    const dy = y as QDict;
    return dict(dy.k, atomic2(ip, x, dy.v, spec));
  }

  const xa = isAtom(x),
    ya = isAtom(y);
  if (xa && ya) {
    const [t, v] = atomicScalar(spec, x.t, y.t, (x as QAtom).v, (y as QAtom).v);
    return atom(-t, v);
  }
  if (x.t === 0 || y.t === 0) {
    // general list: recurse
    const n = xa ? count(y) : ya ? count(x) : Math.min(count(x), count(y));
    if (!xa && !ya && count(x) !== count(y)) throw new QError('length');
    const out: QValue[] = new Array(n);
    for (let i = 0; i < n; i++)
      out[i] = atomic2(ip, xa ? x : at(x, i), ya ? y : at(y, i), spec);
    return fromItems(out);
  }
  if (xa) {
    const n = count(y);
    const rt = (spec.rtype ?? arithType)(Math.abs(x.t), Math.abs(y.t));
    const out = new Array(n);
    const yv = (y as QVector).v;
    const xv = (x as QAtom).v;
    for (let i = 0; i < n; i++) out[i] = atomicScalar(spec, x.t, y.t, xv, yv[i])[1];
    return typedVec(rt, out);
  }
  if (ya) {
    const n = count(x);
    const rt = (spec.rtype ?? arithType)(Math.abs(x.t), Math.abs(y.t));
    const out = new Array(n);
    const xv = (x as QVector).v;
    const yv = (y as QAtom).v;
    for (let i = 0; i < n; i++) out[i] = atomicScalar(spec, x.t, y.t, xv[i], yv)[1];
    return typedVec(rt, out);
  }
  const n = count(x);
  if (n !== count(y)) throw new QError('length', `Vectors must be the same length (${n} vs ${count(y)}).`);
  const rt = (spec.rtype ?? arithType)(Math.abs(x.t), Math.abs(y.t));
  const out = new Array(n);
  const xv = (x as QVector).v;
  const yv = (y as QVector).v;
  for (let i = 0; i < n; i++) out[i] = atomicScalar(spec, x.t, y.t, xv[i], yv[i])[1];
  return typedVec(rt, out);
}

/** Monadic atomic application. */
export function atomic1(
  ip: Interp,
  x: QValue,
  f: (t: number, v: any) => [number, any]
): QValue {
  if (isTable(x)) {
    const t = x as QTable;
    return table(t.c.slice(), t.v.map((c) => atomic1(ip, c, f)));
  }
  if (isDict(x)) {
    const d = x as QDict;
    return dict(d.k, atomic1(ip, d.v, f));
  }
  if (isAtom(x)) {
    const [t, v] = f(x.t, (x as QAtom).v);
    return atom(-t, v);
  }
  if (x.t === 0) {
    return fromItems(items(x).map((e) => atomic1(ip, e, f)));
  }
  const n = count(x);
  const arr = x.t === 10 ? ((x as QVector).v as string).split('') : ((x as QVector).v as any[]);
  const out = new Array(n);
  let rt = x.t;
  for (let i = 0; i < n; i++) {
    const [t, v] = f(x.t, arr[i]);
    rt = t;
    out[i] = v;
  }
  if (n === 0) {
    const [t] = f(x.t, nullValue(x.t));
    rt = t;
  }
  return typedVec(rt, out);
}

/** numeric comparison key that sorts nulls first, like q */
export function cmpKey(t: number, v: any): number | string {
  const a = Math.abs(t);
  if (a === 11) return v as string;
  if (a === 10) return (v as string).charCodeAt(0);
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'number' && Number.isNaN(v)) return -Infinity;
  return v as number;
}

/** q's comparison tolerance is exactly 2^-43 */
export const FLOAT_TOLERANCE = Math.pow(2, -43);

const isFloatType = (t: number) => t === 8 || t === 9 || t === 15;

/**
 * Tolerant equality, but only when one side is a float/real/datetime, and
 * never for zero - exactly as documented in basics/precision.
 */
export function floatEq(a: number, b: number, ta = 9, tb = 9): boolean {
  if (a === b) return true;
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (!isFloatType(ta) && !isFloatType(tb)) return false;
  if (a === 0 || b === 0) return false;
  const m = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= FLOAT_TOLERANCE * m;
}

export function compareValues(x: QValue, y: QValue): number {
  const a = cmpKey(x.t, (x as QAtom).v);
  const b = cmpKey(y.t, (y as QAtom).v);
  if (typeof a === 'string' || typeof b === 'string') {
    const sa = String(a),
      sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** total order across mixed values (used by asc/desc on general lists) */
export function compareAny(x: QValue, y: QValue): number {
  if (isAtom(x) && isAtom(y)) {
    // q orders mixed lists by datatype first
    if (x.t !== y.t) return Math.abs(x.t) < Math.abs(y.t) ? -1 : 1;
    return compareValues(x, y);
  }
  if (isAtom(x)) return -1;
  if (isAtom(y)) return 1;
  const n = Math.min(count(x), count(y));
  for (let i = 0; i < n; i++) {
    const c = compareAny(at(x, i), at(y, i));
    if (c) return c;
  }
  return count(x) - count(y);
}

function numericish(t: number): boolean {
  const a = Math.abs(t);
  return a === 1 || a === 4 || (a >= 5 && a <= 9) || (a >= 12 && a <= 19);
}
