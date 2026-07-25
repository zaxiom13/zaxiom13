// The q builtin library.

import {
  QValue,
  QAtom,
  QVector,
  QDict,
  QTable,
  QLambda,
  QPrim,
  atom,
  vec,
  list,
  listFrom,
  dict,
  table,
  typedVec,
  fromItems,
  items,
  count,
  at,
  raw,
  rawArray,
  isAtom,
  isVector,
  isDict,
  isTable,
  isFunc,
  isKeyedTable,
  matchValues,
  nullValue,
  isNullValue,
  nullAtomOf,
  enlist,
  first as qfirst,
  long,
  longvec,
  int,
  float,
  floatvec,
  bool,
  boolvec,
  sym,
  symvec,
  str,
  char,
  NIL,
  UNIT,
  NULL_LONG,
  INF_LONG,
  NEG_INF_LONG,
  NULL_INT,
  NULL_BIG,
  INF_BIG,
  TYPE_CHAR,
  TYPE_NAME,
  err,
  QError,
  shallowClone,
  toNum,
  symsOf,
  isKeyedTable as isKT,
} from '../value';
import { Interp, Builtin, prim, fillVec, keyStr, setAt, subTable, selectRows, truthy, nullLike } from '../eval';
import { atomic1, atomic2, arithType, compareValues, compareAny, cmpKey, numOf, floatEq } from './atomic';
import { display, compact, cell, fmtRaw, DEFAULT_OPTS, gfmt, fmtDate, fmtTime } from '../format';
import { daysFromEpoch, ymdFromDays, typeFromChar } from '../lexer';
import { parse as parseQ } from '../parser';
import { astToTree } from '../parsetree';

type Args = QValue[];

const A = (x: QValue) => (x as QAtom).v;
const N = (x: QValue) => numOf((x as QAtom).v);

export const MAX_LEN = 4_000_000;
export function checkLen(n: number): number {
  if (!Number.isFinite(n) || Math.abs(n) > MAX_LEN)
    throw new QError('limit', `Refusing to build a ${n}-element list (limit ${MAX_LEN}).`);
  return n;
}

function needInt(x: QValue): number {
  if (!isAtom(x)) throw new QError('type');
  return Math.trunc(N(x));
}

// ------------------------------------------------------------------ helpers

export function rawItems(x: QValue): any[] {
  if (isAtom(x)) return [A(x)];
  if (x.t === 10) return ((x as QVector).v as string).split('');
  if (x.t >= 0 && x.t <= 19) return (x as QVector).v as any[];
  if (x.t === 0) return (x as QVector).v as any[];
  return [];
}

function vectorOf(t: number, vals: any[]): QValue {
  return typedVec(t, vals);
}

function toBool(x: QValue): boolean {
  return truthy(x);
}

/** Numeric list as JS numbers (nulls become NaN when asFloat). */
function nums(x: QValue): number[] {
  const n = count(x);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw(x, i);
    out[i] = isNullValue(Math.abs(x.t), v) ? NaN : numOf(v);
  }
  return out;
}

/** pairs of non-null values from two vectors */
function pairs(x: QValue, y: QValue): [number[], number[]] {
  const a = nums(x),
    b = nums(y);
  const ra: number[] = [],
    rb: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (Number.isNaN(a[i]) || Number.isNaN(b[i])) continue;
    ra.push(a[i]);
    rb.push(b[i]);
  }
  return [ra, rb];
}

function isNullAt(t: number, v: any): boolean {
  return isNullValue(Math.abs(t), v);
}

// ------------------------------------------------------------------ install

export function installBuiltins(ip: Interp) {
  let export_extract: (nm: string, y: QValue) => QValue;
  const def = (
    name: string,
    ranks: number[],
    f: (ip: Interp, args: Args) => QValue,
    doc?: string,
    sig?: string,
    ex?: string[]
  ) => ip.def({ name, ranks, f, doc, sig, ex });

  // ---------------------------------------------------------------- atomic math

  const addSpec = {
    name: '+',
    num: (a: number, b: number) => a + b,
    big: (a: bigint, b: bigint) => a + b,
    rtype: (a: number, b: number) => {
      // date + time -> timestamp
      if ((a === 14 && (b === 19 || b === 16 || b === 17 || b === 18)) || (b === 14 && (a === 19 || a === 16 || a === 17 || a === 18)))
        return 12;
      return arithType(a, b);
    },
  };
  const subSpec = {
    name: '-',
    num: (a: number, b: number) => a - b,
    big: (a: bigint, b: bigint) => a - b,
    rtype: (a: number, b: number) => {
      if (a === b && a >= 12 && a <= 19) return a === 12 ? 16 : a === 14 ? 7 : a;
      if (a === 14 && (b === 19 || b === 16 || b === 17 || b === 18)) return 12;
      return arithType(a, b);
    },
  };
  const mulSpec = { name: '*', num: (a: number, b: number) => a * b, big: (a: bigint, b: bigint) => a * b };
  const divSpec = {
    name: '%',
    num: (a: number, b: number) => a / b,
    rtype: () => 9,
    keepNulls: false,
  };
  const minSpec = {
    name: '&',
    num: (a: number, b: number) => (a < b ? a : b),
    big: (a: bigint, b: bigint) => (a < b ? a : b),
    rtype: (a: number, b: number) => {
      if (a === 1 && b === 1) return 1;
      if (a === 10 || b === 10) return 10;
      return arithType(a, b);
    },
    keepNulls: true,
  };
  const maxSpec = {
    name: '|',
    num: (a: number, b: number) => (a > b ? a : b),
    big: (a: bigint, b: bigint) => (a > b ? a : b),
    rtype: (a: number, b: number) => {
      if (a === 1 && b === 1) return 1;
      if (a === 10 || b === 10) return 10;
      return arithType(a, b);
    },
    keepNulls: true,
  };

  const cmp3 = (a: number, b: number, ta = 9, tb = 9) =>
    floatEq(a, b, ta, tb) ? 0 : a < b ? -1 : 1;

  const eqSpec = {
    name: '=',
    num: (a: number, b: number) => (a === b ? 1 : 0),
    numT: (a: number, b: number, ta: number, tb: number) => (floatEq(a, b, ta, tb) ? 1 : 0),
    rtype: () => 1,
    keepNulls: true,
    big: (a: bigint, b: bigint) => (a === b ? 1n : 0n),
  };

  /** comparison that also handles symbols/chars */
  const cmpOp = (name: string, test: (c: number) => boolean) => (ip2: Interp, [x, y]: Args) => {
    return atomicCmp(ip2, x, y, test);
  };

  function atomicCmp(ip2: Interp, x: QValue, y: QValue, test: (c: number) => boolean): QValue {
    const spec = {
      name: 'cmp',
      num: (a: number, b: number) => (test(cmp3(a, b)) ? 1 : 0),
      numT: (a: number, b: number, ta: number, tb: number) => (test(cmp3(a, b, ta, tb)) ? 1 : 0),
      rtype: () => 1,
      keepNulls: true,
      big: (a: bigint, b: bigint) => (test(a < b ? -1 : a > b ? 1 : 0) ? 1n : 0n),
    };
    if (hasSymbols(x) || hasSymbols(y)) return symCompare(ip2, x, y, test);
    return atomic2(ip2, x, y, spec as any);
  }

  function hasSymbols(x: QValue): boolean {
    return Math.abs(x.t) === 11;
  }

  function symCompare(ip2: Interp, x: QValue, y: QValue, test: (c: number) => boolean): QValue {
    const xa = isAtom(x),
      ya = isAtom(y);
    if (xa && ya) {
      const a = String(A(x)),
        b = String(A(y));
      return bool(test(a < b ? -1 : a > b ? 1 : 0));
    }
    const n = xa ? count(y) : ya ? count(x) : Math.min(count(x), count(y));
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = String(xa ? A(x) : raw(x, i));
      const b = String(ya ? A(y) : raw(y, i));
      out[i] = test(a < b ? -1 : a > b ? 1 : 0) ? 1 : 0;
    }
    return vec(1, out);
  }

  def('+', [1, 2], (ip2, a) =>
    a.length === 1 ? flip(a[0]) : atomic2(ip2, a[0], a[1], addSpec as any)
  );
  def('-', [1, 2], (ip2, a) =>
    a.length === 1
      ? atomic2(ip2, long(0), a[0], subSpec as any)
      : atomic2(ip2, a[0], a[1], subSpec as any)
  );
  def('*', [1, 2], (ip2, a) => (a.length === 1 ? qfirst(a[0]) : atomic2(ip2, a[0], a[1], mulSpec as any)));
  def('%', [1, 2], (ip2, a) =>
    a.length === 1
      ? atomic2(ip2, float(1), a[0], divSpec as any)
      : atomic2(ip2, a[0], a[1], divSpec as any)
  );
  def('&', [1, 2], (ip2, a) => (a.length === 1 ? where(ip2, a[0]) : atomic2(ip2, a[0], a[1], minSpec as any)));
  def('|', [1, 2], (ip2, a) => (a.length === 1 ? reverse(a[0]) : atomic2(ip2, a[0], a[1], maxSpec as any)));
  def('=', [1, 2], (ip2, a) => (a.length === 1 ? group(ip2, a[0]) : atomicEq(ip2, a[0], a[1])));
  def('<>', [2], (ip2, a) => notV(ip2, atomicEq(ip2, a[0], a[1])));
  def('<', [1, 2], (ip2, a) => (a.length === 1 ? iasc(ip2, a[0]) : cmpOp('<', (c) => c < 0)(ip2, a)));
  def('>', [1, 2], (ip2, a) => (a.length === 1 ? idesc(ip2, a[0]) : cmpOp('>', (c) => c > 0)(ip2, a)));
  def('<=', [2], cmpOp('<=', (c) => c <= 0));
  def('>=', [2], cmpOp('>=', (c) => c >= 0));

  function atomicEq(ip2: Interp, x: QValue, y: QValue): QValue {
    if (hasSymbols(x) || hasSymbols(y)) return symCompare(ip2, x, y, (c) => c === 0);
    return atomic2(ip2, x, y, eqSpec as any);
  }

  function notV(ip2: Interp, x: QValue): QValue {
    return atomic1(ip2, x, (t, v) => [1, numOf(v) === 0 || isNullAt(t, v) ? 1 : 0]);
  }

  def('~', [2], (ip2, [x, y]) => bool(matchValues(x, y)));
  def(':', [1, 2], (ip2, a) => (a.length === 1 ? a[0] : a[1]));
  def('not', [1], (ip2, [x]) => notV(ip2, x));
  def('neg', [1], (ip2, [x]) => {
    const out = atomic2(ip2, long(0), x, subSpec as any);
    // q widens boolean negation to int, rather than long.
    if (Math.abs(x.t) === 1) return castTo(6, out);
    return out;
  });
  def('abs', [1], (ip2, [x]) =>
    atomic1(ip2, x, (t, v) => [
      Math.abs(t) === 1 || Math.abs(t) === 4 ? 7 : Math.abs(t),
      typeof v === 'bigint' ? (v < 0n ? -v : v) : isNullAt(t, v) ? v : Math.abs(numOf(v)),
    ])
  );
  def('signum', [1], (ip2, [x]) =>
    atomic1(ip2, x, (t, v) => {
      if (isNullAt(t, v)) return [6, -1];
      const n = typeof v === 'bigint' ? Number(v) : numOf(v);
      return [6, n > 0 ? 1 : n < 0 ? -1 : 0];
    })
  );
  def('reciprocal', [1], (ip2, [x]) => atomic1(ip2, x, (t, v) => [9, 1 / numOf(v)]));
  def('sqrt', [1], (ip2, [x]) => mathFn(ip2, x, Math.sqrt));
  def('exp', [1], (ip2, [x]) => mathFn(ip2, x, Math.exp));
  def('log', [1], (ip2, [x]) => mathFn(ip2, x, (n) => (n === 0 ? -Infinity : Math.log(n))));
  def('sin', [1], (ip2, [x]) => mathFn(ip2, x, Math.sin));
  def('cos', [1], (ip2, [x]) => mathFn(ip2, x, Math.cos));
  def('tan', [1], (ip2, [x]) => mathFn(ip2, x, Math.tan));
  def('asin', [1], (ip2, [x]) => mathFn(ip2, x, Math.asin));
  def('acos', [1], (ip2, [x]) => mathFn(ip2, x, Math.acos));
  def('atan', [1], (ip2, [x]) => mathFn(ip2, x, Math.atan));

  function mathFn(ip2: Interp, x: QValue, f: (n: number) => number): QValue {
    return atomic1(ip2, x, (t, v) => [9, isNullAt(t, v) ? NaN : f(numOf(v))]);
  }

  def('floor', [1], (ip2, [x]) =>
    atomic1(ip2, x, (t, v) => {
      const a = Math.abs(t);
      if (a === 9 || a === 8) return [7, Number.isNaN(v) ? NULL_LONG : Math.floor(v)];
      if (a === 15) return [14, Number.isNaN(v) ? NULL_INT : Math.floor(v)];
      if (a === 1 || a === 4) return [6, numOf(v)];
      return [a, v];
    })
  );
  def('ceiling', [1], (ip2, [x]) =>
    atomic1(ip2, x, (t, v) => {
      const a = Math.abs(t);
      if (a === 9 || a === 8) return [7, Number.isNaN(v) ? NULL_LONG : Math.ceil(v)];
      if (a === 1 || a === 4) return [6, numOf(v)];
      return [a, v];
    })
  );
  def('div', [2], (ip2, [x, y]) =>
    atomic2(ip2, x, y, {
      name: 'div',
      num: (a, b) => Math.floor(a / b),
      // q returns the left type, widened to at least int
      rtype: (a: number) => (a === 9 || a === 8 ? a : a <= 6 || a === 10 ? 6 : a),
    } as any)
  );
  def('mod', [2], (ip2, [x, y]) =>
    atomic2(ip2, x, y, {
      name: 'mod',
      num: (a, b) => a - b * Math.floor(a / b),
      big: (a, b) => ((a % b) + b) % b,
    } as any)
  );
  def('xexp', [2], (ip2, [x, y]) =>
    atomic2(ip2, x, y, { name: 'xexp', num: (a, b) => Math.pow(a, b), rtype: () => 9 } as any)
  );
  def('xlog', [2], (ip2, [x, y]) =>
    atomic2(ip2, x, y, {
      name: 'xlog',
      num: (a, b) => Math.log(b) / Math.log(a),
      rtype: () => 9,
    } as any)
  );
  def('and', [2], (ip2, [x, y]) => atomic2(ip2, x, y, minSpec as any));
  def('or', [2], (ip2, [x, y]) => atomic2(ip2, x, y, maxSpec as any));

  def('^', [2], (ip2, [x, y]) => fill(ip2, x, y));
  function fill(ip2: Interp, x: QValue, y: QValue): QValue {
    if (isDict(y) && !isDict(x)) return dict((y as QDict).k, fill(ip2, x, (y as QDict).v));
    if (isTable(y) && !isTable(x)) {
      const t = y as QTable;
      return table(t.c.slice(), t.v.map((c) => fill(ip2, x, c)));
    }
    return atomic2(ip2, x, y, {
      name: '^',
      num: (a, b) => b,
      keepNulls: true,
      rtype: (a, b) => arithType(a, b),
    } as any as any);
  }
  // ^ needs the "use x when y is null" logic; do it directly
  ip.def({
    name: '^',
    ranks: [1, 2],
    f: (ip2, a) => {
      if (a.length === 1) return isNullV(ip2, a[0]);
      const [x, y] = a;
      const doFill = (xx: QValue, yy: QValue): QValue => {
        if (isDict(xx) && isDict(yy) && !isKeyedTable(xx) && !isKeyedTable(yy)) {
          const xd = xx as QDict;
          const yd = yy as QDict;
          const keys = items(xd.k);
          const vals = items(xd.v);
          items(yd.k).forEach((key, i) => {
            const ix = keys.findIndex((k) => matchValues(k, key));
            if (ix < 0) {
              keys.push(key);
              vals.push(at(yd.v, i));
            } else vals[ix] = doFill(vals[ix], at(yd.v, i));
          });
          return dict(fromItems(keys), fromItems(vals));
        }
        if (isTable(yy)) {
          const t = yy as QTable;
          return table(t.c.slice(), t.v.map((c) => doFill(xx, c)));
        }
        if (isDict(yy)) return dict((yy as QDict).k, doFill(xx, (yy as QDict).v));
        if (isAtom(yy)) {
          const xv = isAtom(xx) ? xx : at(xx, 0);
          const chosen = isNullAt(yy.t, A(yy)) ? xv : yy;
          try {
            return castTo(arithType(Math.abs(xv.t), Math.abs(yy.t)), chosen);
          } catch {
            return chosen;
          }
        }
        const n = count(yy);
        const out: QValue[] = new Array(n);
        for (let i = 0; i < n; i++) {
          const e = at(yy, i);
          const xv = isAtom(xx) ? xx : at(xx, i);
          out[i] = doFill(xv, e);
        }
        return fromItems(out);
      };
      return doFill(x, y);
    },
  });

  function isNullV(ip2: Interp, x: QValue): QValue {
    if (isTable(x)) {
      const t = x as QTable;
      return table(t.c.slice(), t.v.map((c) => isNullV(ip2, c)));
    }
    if (isDict(x)) return dict((x as QDict).k, isNullV(ip2, (x as QDict).v));
    if (isFunc(x)) return bool(false);
    return atomic1(ip2, x, (t, v) => [1, isNullAt(t, v) ? 1 : 0]);
  }
  def('null', [1], (ip2, [x]) => isNullV(ip2, x));

  // ---------------------------------------------------------------- structure

  def(',', [1, 2], (ip2, a) => (a.length === 1 ? enlist(a[0]) : join(ip2, a[0], a[1])));
  ip.def({
    name: 'enlist',
    ranks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    // variadic, so q applies it prefix only
    noInfix: true,
    f: (ip2, a) => (a.length === 1 ? enlist(a[0]) : fromItems(a)),
  });

  function join(ip2: Interp, x: QValue, y: QValue): QValue {
    if (isTable(x) && isTable(y)) {
      const tx = x as QTable,
        ty = y as QTable;
      if (tx.c.join() === ty.c.join())
        return table(tx.c.slice(), tx.v.map((c, i) => join(ip2, c, ty.v[i])));
      // union of columns, filling nulls
      const cols = [...tx.c];
      ty.c.forEach((c) => {
        if (!cols.includes(c)) cols.push(c);
      });
      const nx = count(tx),
        ny = count(ty);
      return table(
        cols,
        cols.map((c) => {
          const xi = tx.c.indexOf(c),
            yi = ty.c.indexOf(c);
          const xc = xi >= 0 ? tx.v[xi] : fillVec(nullLike(yi >= 0 ? ty.v[yi] : NIL), nx);
          const yc = yi >= 0 ? ty.v[yi] : fillVec(nullLike(xi >= 0 ? tx.v[xi] : NIL), ny);
          return join(ip2, xc, yc);
        })
      );
    }
    if (isTable(x) && isDict(y)) return join(ip2, x, tableFromRow(y as QDict));
    if (isDict(x) && isTable(y)) return join(ip2, tableFromRow(x as QDict), y);
    if (isKeyedTable(x) && isKeyedTable(y)) {
      return upsertKeyed(ip2, x as QDict, y as QDict);
    }
    if (isDict(x) && isDict(y)) {
      const dx = x as QDict,
        dy = y as QDict;
      const keys = items(dx.k);
      const vals = items(dx.v);
      items(dy.k).forEach((k, i) => {
        const ix = keys.findIndex((kk) => matchValues(kk, k));
        const v = at(dy.v, i);
        if (ix < 0) {
          keys.push(k);
          vals.push(v);
        } else vals[ix] = v;
      });
      return dict(fromItems(keys), fromItems(vals));
    }
    const xs = isAtom(x) || isFunc(x) ? [x] : items(x);
    const ys = isAtom(y) || isFunc(y) ? [y] : items(y);
    return fromItems([...xs, ...ys]);
  }

  function tableFromRow(d: QDict): QTable {
    const keys = symsOf(d.k);
    return table(keys, items(d.v).map((v) => enlist(v)));
  }

  def('#', [1, 2], (ip2, a) =>
    a.length === 1 ? long(count(a[0])) : setAttribute(ip2, a[0], a[1])
  );
  def('count', [1], (ip2, [x]) => long(count(x)));
  def('take', [2], (ip2, [x, y]) => take(ip2, x, y));

  function setAttribute(ip2: Interp, x: QValue, y: QValue): QValue {
    if (x.t !== -11) return take(ip2, x, y);
    const attr = String(A(x));
    if (!['', 's', 'u', 'p', 'g'].includes(attr)) return take(ip2, x, y);
    if (isKeyedTable(y)) {
      const d = y as QDict;
      const keys = shallowClone(d.k) as QTable;
      if (keys.v.length) keys.v[0] = setAttribute(ip2, x, keys.v[0]);
      return dict(keys, d.v);
    }
    if (isDict(y)) {
      const d = y as QDict;
      return dict(setAttribute(ip2, x, d.k), d.v);
    }
    if (isTable(y)) {
      const t = shallowClone(y) as QTable;
      if (t.v.length) t.v[0] = setAttribute(ip2, x, t.v[0]);
      return t;
    }
    if (!isVector(y)) throw new QError('type');
    if (attr === 's') {
      for (let i = 1; i < count(y); i++) {
        if (compareAny(at(y, i - 1), at(y, i)) > 0) throw new QError('s-fail');
      }
    } else if (attr === 'u') {
      for (let i = 1; i < count(y); i++) {
        for (let j = 0; j < i; j++) {
          if (matchValues(at(y, j), at(y, i))) throw new QError('u-fail');
        }
      }
    }
    const out = shallowClone(y) as QVector;
    out.a = attr || undefined;
    return out;
  }

  function take(ip2: Interp, x: QValue, y: QValue): QValue {
    if (x.t === -11 || x.t === 11) {
      // column/key subset
      if (isTable(y)) {
        const cols = symsOf(x);
        return table(cols, cols.map((c) => (y as QTable).v[(y as QTable).c.indexOf(c)]));
      }
      if (isDict(y)) {
        const keys = symsOf(x);
        return dict(symvec(keys), fromItems(keys.map((k) => ip2.index1(y, sym(k)))));
      }
    }
    if (isFunc(y)) {
      // filter:  f#x is not standard; treat as where
      throw new QError('type');
    }
    if (!isAtom(x)) {
      // reshape
      const dims = rawArray(x).map((d) => Math.trunc(numOf(d)));
      return reshape(dims, y);
    }
    let n = checkLen(Math.trunc(N(x)));
    if (isKeyedTable(y)) {
      const kt = y as QDict;
      return dict(take(ip2, x, kt.k) as QTable, take(ip2, x, kt.v) as QTable);
    }
    if (isTable(y)) {
      const t = y as QTable;
      const len = count(t);
      const idx = takeIdx(n, len);
      return table(t.c.slice(), t.v.map((c) => selectRows(c, idx)));
    }
    if (isDict(y)) {
      const d = y as QDict;
      const len = count(d.k);
      const idx = takeIdx(n, len);
      return dict(selectRows(d.k, idx), selectRows(d.v, idx));
    }
    const src = isAtom(y) ? enlist(y) : y;
    const len = count(src);
    if (len === 0) {
      const t = Math.abs(y.t);
      return typedVec(t > 19 ? 0 : t, new Array(Math.abs(n)).fill(nullValue(t)));
    }
    const idx = takeIdx(n, len);
    return selectRows(src, idx);
  }

  function takeIdx(n: number, len: number): number[] {
    checkLen(n);
    const out: number[] = [];
    if (n >= 0) {
      for (let i = 0; i < n; i++) out.push(len ? i % len : 0);
    } else {
      const m = -n;
      for (let i = 0; i < m; i++) out.push(len ? (((len - m + i) % len) + len) % len : 0);
    }
    return out;
  }

  function reshape(dims: number[], y: QValue): QValue {
    const flat = isAtom(y) ? [y] : items(y);
    let pos = 0;
    const build = (d: number[]): QValue => {
      if (d.length === 1) {
        const out: QValue[] = [];
        const n = checkLen(d[0]);
        for (let i = 0; i < n; i++) out.push(flat[pos++ % flat.length]);
        return fromItems(out);
      }
      const out: QValue[] = [];
      for (let i = 0; i < d[0]; i++) out.push(build(d.slice(1)));
      return listFrom(out);
    };
    const isNull = (d: number) => Number.isNaN(d) || d === NULL_LONG;
    if (dims.length === 2 && isNull(dims[1]) && !isNull(dims[0])) {
      // n 0N # x : split into n pieces
      const n = Math.max(1, dims[0]);
      const per = Math.ceil(flat.length / n);
      const out: QValue[] = [];
      for (let i = 0; i < flat.length; i += per) out.push(fromItems(flat.slice(i, i + per)));
      while (out.length < n) out.push(fromItems([]));
      return listFrom(out);
    }
    if (dims.some(isNull)) {
      // 0N n # x : pieces of length n
      const known = dims.filter((d) => !isNull(d));
      const per = known.length ? known[known.length - 1] : 1;
      const out: QValue[] = [];
      for (let i = 0; i < flat.length; i += per) out.push(fromItems(flat.slice(i, i + per)));
      return listFrom(out);
    }
    return build(dims);
  }

  def('_', [2], (ip2, [x, y]) => dropOp(ip2, x, y));
  def('drop', [2], (ip2, [x, y]) => dropOp(ip2, x, y));
  def('cut', [2], (ip2, [x, y]) => cutOp(ip2, x, y));

  function dropOp(ip2: Interp, x: QValue, y: QValue): QValue {
    const intAtom = (v: QValue) =>
      isAtom(v) && (Math.abs(v.t) === 7 || Math.abs(v.t) === 6 || Math.abs(v.t) === 5);
    // x _ i : delete the item at index i
    if (!isAtom(x) && intAtom(y)) {
      const i = Math.trunc(N(y));
      const len = count(x);
      const idx: number[] = [];
      for (let j = 0; j < len; j++) if (j !== i) idx.push(j);
      if (isTable(x)) return selectTableRows(x as QTable, idx);
      if (isDict(x)) {
        const d = x as QDict;
        return dict(selectRows(d.k, idx), selectRows(d.v, idx));
      }
      return selectRows(x, idx);
    }
    // d _ `key : drop entries
    if ((isDict(x) || isTable(x)) && (y.t === -11 || y.t === 11)) {
      const drop = symsOf(y);
      if (isTable(x)) {
        const t = x as QTable;
        const keep = t.c.map((c, i) => i).filter((i) => !drop.includes(t.c[i]));
        return table(keep.map((i) => t.c[i]), keep.map((i) => t.v[i]));
      }
      const d = x as QDict;
      const keep: number[] = [];
      items(d.k).forEach((k, i) => {
        if (!(k.t === -11 && drop.includes(A(k)))) keep.push(i);
      });
      return dict(selectRows(d.k, keep), selectRows(d.v, keep));
    }
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6 || Math.abs(x.t) === 5)) {
      const n = Math.trunc(N(x));
      const len = count(y);
      const idx: number[] = [];
      if (n >= 0) for (let i = Math.min(n, len); i < len; i++) idx.push(i);
      else for (let i = 0; i < Math.max(0, len + n); i++) idx.push(i);
      if (isKeyedTable(y)) {
        const kt = y as QDict;
        return dict(selectTableRows(kt.k as QTable, idx), selectTableRows(kt.v as QTable, idx));
      }
      if (isTable(y)) return selectTableRows(y as QTable, idx);
      if (isDict(y)) {
        const d = y as QDict;
        return dict(selectRows(d.k, idx), selectRows(d.v, idx));
      }
      return selectRows(y, idx);
    }
    if (!isAtom(x) && (x.t === 7 || x.t === 6)) return cutOp(ip2, x, y);
    if (isDict(y) && (x.t === -11 || x.t === 11)) {
      // drop keys
      const d = y as QDict;
      const drop = symsOf(x);
      const keep: number[] = [];
      const ks = items(d.k);
      ks.forEach((k, i) => {
        if (!(k.t === -11 && drop.includes(A(k)))) keep.push(i);
      });
      return dict(selectRows(d.k, keep), selectRows(d.v, keep));
    }
    if (isTable(y) && (x.t === -11 || x.t === 11)) {
      const t = y as QTable;
      const drop = symsOf(x);
      const keep = t.c.map((c, i) => i).filter((i) => !drop.includes(t.c[i]));
      return table(keep.map((i) => t.c[i]), keep.map((i) => t.v[i]));
    }
    // x _ i : delete element at index i
    if (isAtom(y)) {
      const i = Math.trunc(N(y));
      const len = count(x);
      const idx: number[] = [];
      for (let j = 0; j < len; j++) if (j !== i) idx.push(j);
      if (isTable(x)) return selectTableRows(x as QTable, idx);
      if (isDict(x)) {
        const d = x as QDict;
        return dict(selectRows(d.k, idx), selectRows(d.v, idx));
      }
      return selectRows(x, idx);
    }
    throw new QError('type');
  }

  function cutOp(ip2: Interp, x: QValue, y: QValue): QValue {
    if (isAtom(x)) {
      const n = Math.trunc(N(x));
      const len = count(y);
      const out: QValue[] = [];
      for (let i = 0; i < len; i += n) {
        const idx: number[] = [];
        for (let j = i; j < Math.min(i + n, len); j++) idx.push(j);
        out.push(isTable(y) ? selectTableRows(y as QTable, idx) : selectRows(y, idx));
      }
      return listFrom(out);
    }
    const cuts = rawArray(x).map((v) => Math.trunc(numOf(v)));
    const len = count(y);
    const out: QValue[] = [];
    for (let i = 0; i < cuts.length; i++) {
      const start = cuts[i];
      const end = i + 1 < cuts.length ? cuts[i + 1] : len;
      const idx: number[] = [];
      for (let j = start; j < end; j++) idx.push(j);
      out.push(isTable(y) ? selectTableRows(y as QTable, idx) : selectRows(y, idx));
    }
    return listFrom(out);
  }

  function selectTableRows(t: QTable, idx: number[]): QTable {
    return table(t.c.slice(), t.v.map((c) => selectRows(c, idx)));
  }

  def('til', [1], (ip2, [x]) => {
    const n = checkLen(Math.trunc(N(x)));
    const out = new Array(Math.max(0, n));
    for (let i = 0; i < n; i++) out[i] = i;
    return longvec(out);
  });

  function bangOp(ip2: Interp, a: Args): QValue {
    if (a.length === 1) return keyOf(ip2, a[0]);
    const [x, y] = a;
    if (isAtom(x) && Math.abs(x.t) === 7 && isNullAt(x.t, A(x))) {
      // 0N!x  - display and return
      ip2.out(display(y, ip2.fmt as any));
      return y;
    }
    if (isAtom(x) && Math.abs(x.t) === 7 && y.t === -11) {
      const nm = A(y) as string;
      const cur = ip2.resolve(nm, { locals: null });
      const res = ip2.apply(prim(ip2.builtins.get('!')!), [x, cur]);
      ip2.globals.set(nm, res);
      return y;
    }
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6) && isTable(y)) {
      const n = Math.trunc(N(x));
      const t = y as QTable;
      if (n === 0) return t;
      return dict(
        table(t.c.slice(0, n), t.v.slice(0, n)),
        table(t.c.slice(n), t.v.slice(n))
      );
    }
    if ((x.t === 11 || x.t === -11) && isTable(y)) return xkey(ip2, x, y);
    if (isAtom(x) && Math.abs(x.t) === 7 && isKeyedTable(y)) {
      const kt = y as QDict;
      const full = table(
        [...(kt.k as QTable).c, ...(kt.v as QTable).c],
        [...(kt.k as QTable).v, ...(kt.v as QTable).v]
      );
      const n = Math.trunc(N(x));
      if (n === 0) return full;
      return dict(table(full.c.slice(0, n), full.v.slice(0, n)), table(full.c.slice(n), full.v.slice(n)));
    }
    return dict(x, y);
  }

  function keyOf(ip2: Interp, x: QValue): QValue {
    if (isKeyedTable(x)) return (x as QDict).k;
    if (isDict(x)) return (x as QDict).k;
    if (isTable(x)) return NIL;
    if (isVector(x)) return sym(TYPE_NAME[Math.abs(x.t)] ?? '');
    if (isAtom(x) && Math.abs(x.t) === 7) {
      const n = Math.trunc(N(x));
      const out = new Array(Math.max(0, n));
      for (let i = 0; i < n; i++) out[i] = i;
      return longvec(out);
    }
    return NIL;
  }
  def('key', [1], (ip2, [x]) => keyOf(ip2, x));
  def('value', [1], (ip2, [x]) => valueOf(ip2, x));
  def('get', [1], (ip2, [x]) => valueOf(ip2, x));

  function valueOf(ip2: Interp, x: QValue): QValue {
    if (x.t === 0 && count(x) > 1) {
      const head = at(x, 0);
      const fn = head.t === -11 && ip2.globals.has((head as QAtom).v as string)
        ? ip2.globals.get((head as QAtom).v as string)!
        : head;
      if (isFunc(fn)) return evalTree(ip2, x, null);
    }
    if (isDict(x)) return (x as QDict).v;
    if (isTable(x)) return flip(x);
    if (x.t === -11) return ip2.resolve(A(x), { locals: null });
    if (x.t === 10) return ip2.run((x as QVector).v as string);
    if (x.t === 100) {
      const l = x as QLambda;
      return str(l.src);
    }
    return x;
  }

  def('flip', [1], (ip2, [x]) => flip(x));

  function flip(x: QValue): QValue {
    if (isTable(x)) {
      const t = x as QTable;
      return dict(symvec(t.c.slice()), listFrom(t.v.slice()));
    }
    if (isDict(x)) {
      const d = x as QDict;
      if (d.k.t === 11 && (d.v.t === 0 || (d.v.t > 0 && d.v.t <= 19))) {
        const cols = symsOf(d.k);
        const vals = items(d.v);
        const lens = vals.filter((v) => !isAtom(v)).map((v) => count(v));
        if (lens.length && lens.every((l) => l === lens[0])) {
          const n = lens[0];
          return table(cols, vals.map((v) => (isAtom(v) ? fillVec(v, n) : v)));
        }
      }
      return x;
    }
    // matrix transpose
    const n = count(x);
    if (n === 0) return x;
    const m = count(at(x, 0));
    const out: QValue[] = [];
    for (let j = 0; j < m; j++) {
      const row: QValue[] = [];
      for (let i = 0; i < n; i++) row.push(at(at(x, i), j));
      out.push(fromItems(row));
    }
    return listFrom(out);
  }

  def('reverse', [1], (ip2, [x]) => reverse(x));
  function reverse(x: QValue): QValue {
    if (isAtom(x)) return x;
    if (isTable(x)) {
      const t = x as QTable;
      return table(t.c.slice(), t.v.map((c) => reverse(c)));
    }
    if (isDict(x)) {
      const d = x as QDict;
      return dict(reverse(d.k), reverse(d.v));
    }
    const n = count(x);
    const idx: number[] = [];
    for (let i = n - 1; i >= 0; i--) idx.push(i);
    return selectRows(x, idx);
  }

  def('first', [1], (ip2, [x]) => qfirst(x));
  def('last', [1], (ip2, [x]) => {
    if (isAtom(x)) return x;
    if (isDict(x) && !isKeyedTable(x)) return at((x as QDict).v, count(x) - 1);
    const n = count(x);
    if (n === 0) return nullLike(x);
    return at(x, n - 1);
  });

  def('where', [1], (ip2, [x]) => where(ip2, x));
  function where(ip2: Interp, x: QValue): QValue {
    if (isDict(x)) {
      const d = x as QDict;
      const w = where(ip2, d.v);
      return ip2.index1(d.k, w);
    }
    const out: number[] = [];
    const n = count(x);
    for (let i = 0; i < n; i++) {
      const v = numOf(raw(x, i));
      for (let j = 0; j < v; j++) {
        if (out.length > MAX_LEN) checkLen(Infinity);
        out.push(i);
      }
    }
    return longvec(out);
  }

  def('group', [1], (ip2, [x]) => group(ip2, x));
  function group(ip2: Interp, x: QValue): QValue {
    const n = count(x);
    const map = new Map<string, { k: QValue; idx: number[] }>();
    const order: string[] = [];
    for (let i = 0; i < n; i++) {
      const e = at(x, i);
      const ks = keyStr(e);
      let g = map.get(ks);
      if (!g) {
        g = { k: e, idx: [] };
        map.set(ks, g);
        order.push(ks);
      }
      g.idx.push(i);
    }
    const keys = order.map((k) => map.get(k)!.k);
    const vals = order.map((k) => longvec(map.get(k)!.idx));
    return dict(fromItems(keys), vals.length ? fromItems(vals) : listFrom([]));
  }

  def('distinct', [1], (ip2, [x]) => {
    if (isTable(x)) {
      const t = x as QTable;
      const seen = new Set<string>();
      const idx: number[] = [];
      const n = count(t);
      for (let i = 0; i < n; i++) {
        const k = keyStr(at(t, i));
        if (!seen.has(k)) {
          seen.add(k);
          idx.push(i);
        }
      }
      return selectTableRows(t, idx);
    }
    const n = count(x);
    const seen = new Set<string>();
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = keyStr(at(x, i));
      if (!seen.has(k)) {
        seen.add(k);
        idx.push(i);
      }
    }
    return selectRows(x, idx);
  });

  def('?', [2, 3, 4, 5, 6], (ip2, a) => {
    if (a.length === 2) return findOrRoll(ip2, a[0], a[1]);
    if (a.length === 3 && !isTable(a[0]) && a[0].t !== -11) return vectorCond(ip2, a[0], a[1], a[2]);
    return funcSelect(ip2, a);
  });

  function vectorCond(ip2: Interp, c: QValue, t: QValue, f: QValue): QValue {
    if (isAtom(c)) return truthy(c) ? t : f;
    const n = count(c);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) {
      const cond = truthy(at(c, i));
      out.push(cond ? (isAtom(t) ? t : at(t, i)) : isAtom(f) ? f : at(f, i));
    }
    return fromItems(out);
  }

  function findOrRoll(ip2: Interp, x: QValue, y: QValue): QValue {
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6)) {
      const n = Math.trunc(N(x));
      return rollDeal(ip2, n, y);
    }
    // find
    if (isDict(x)) {
      const d = x as QDict;
      const ix = findOrRoll(ip2, d.v, y);
      return ip2.index1(d.k, ix);
    }
    const find1 = (e: QValue): number => {
      const n = count(x);
      for (let i = 0; i < n; i++) if (matchValues(at(x, i), e)) return i;
      return n;
    };
    if (isAtom(y) || (isTable(x) && isDict(y))) return long(find1(y));
    const n = count(y);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = find1(at(y, i));
    return longvec(out);
  }

  function rollDeal(ip2: Interp, n: number, y: QValue): QValue {
    if (n === NULL_LONG && isAtom(y) && Math.abs(y.t) === 7) n = -Math.trunc(N(y));
    if (n === NULL_LONG) n = -count(isAtom(y) ? enlist(y) : y);
    const deal = n < 0;
    const cnt = checkLen(Math.abs(n));
    const rnd = () => ip2Rand(ip2);
    if (isAtom(y) && Math.abs(y.t) === 7) {
      const m = Math.trunc(N(y));
      if (m === 0) {
        const out = new Array(cnt);
        for (let i = 0; i < cnt; i++) out[i] = rnd();
        return floatvec(out);
      }
      if (deal) {
        const pool: number[] = [];
        for (let i = 0; i < m; i++) pool.push(i);
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        return longvec(pool.slice(0, cnt));
      }
      const out = new Array(cnt);
      for (let i = 0; i < cnt; i++) out[i] = Math.floor(rnd() * m);
      return longvec(out);
    }
    if (isAtom(y) && Math.abs(y.t) === 9) {
      const m = N(y);
      const out = new Array(cnt);
      for (let i = 0; i < cnt; i++) out[i] = rnd() * m;
      return floatvec(out);
    }
    const len = count(y);
    if (deal) {
      const pool: number[] = [];
      for (let i = 0; i < len; i++) pool.push(i);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return selectRows(y, pool.slice(0, cnt));
    }
    const idx = new Array(cnt);
    for (let i = 0; i < cnt; i++) idx[i] = Math.floor(rnd() * len);
    return selectRows(y, idx);
  }

  def('rand', [1], (ip2, [x]) => {
    const r = rollDeal(ip2, 1, x);
    return at(r, 0);
  });

  /**
   * Evaluate a q parse tree against a set of columns.
   * A symbol names a column (or a global); an enlisted value is a literal;
   * a list headed by a function is an application.
   */
  function evalTree(ip2: Interp, tree: QValue, cols: Map<string, QValue> | null): QValue {
    if (tree.t === -11) {
      const nm = (tree as QAtom).v as string;
      if (cols && cols.has(nm)) return cols.get(nm)!;
      if (ip2.globals.has(nm)) return ip2.globals.get(nm)!;
      throw new QError(nm, `Undefined name: ${nm}`);
    }
    if (tree.t === 0) {
      const its = items(tree);
      if (its.length === 1) return its[0]; // enlist x -> the literal x
      let head = its.length ? its[0] : UNIT;
      if (head.t === -11 && ip2.globals.has((head as QAtom).v as string))
        head = ip2.globals.get((head as QAtom).v as string)!;
      if (its.length && isFunc(head)) {
        const f = head;
        const args = its.slice(1).map((e) => evalTree(ip2, e, cols));
        return ip2.apply(f, args.length ? args : [UNIT]);
      }
      return tree;
    }
    return tree;
  }

  function asTable(ip2: Interp, t: QValue): { tbl: QTable; name: string | null; keys: string[] } {
    let name: string | null = null;
    let v = t;
    if (v.t === -11) {
      name = (v as QAtom).v as string;
      v = ip2.resolve(name, { locals: null });
    }
    if (isKeyedTable(v)) {
      const kt = v as QDict;
      const k = kt.k as QTable,
        val = kt.v as QTable;
      return { tbl: table([...k.c, ...val.c], [...k.v, ...val.v]), name, keys: k.c.slice() };
    }
    if (!isTable(v)) throw new QError('type', 'functional query needs a table');
    return { tbl: v as QTable, name, keys: [] };
  }

  const scopeOf = (t: QTable, rows: number[]): Map<string, QValue> => {
    const m = new Map<string, QValue>();
    t.c.forEach((c, i) => m.set(c, selectRows(t.v[i], rows)));
    m.set('i', longvec(rows.map((_, ix) => ix)));
    return m;
  };

  /** ?[t;c;b;a] and ?[t;i;p] */
  function funcSelect(ip2: Interp, a: Args): QValue {
    const { tbl, keys } = asTable(ip2, a[0]);
    const nrows = count(tbl);
    // ?[t;i;p] - apply a parse tree to selected rows
    if (a.length === 3 && (a[1].t === 7 || a[1].t === 6 || isAtom(a[1]))) {
      const idx = isAtom(a[1]) ? [Math.trunc(N(a[1]))] : (rawArray(a[1]) as number[]);
      return evalTree(ip2, a[2], scopeOf(tbl, idx));
    }
    let rows: number[] = [];
    for (let i = 0; i < nrows; i++) rows.push(i);
    const cons = a[1];
    if (cons && !isAtom(cons) && count(cons) > 0) {
      for (const c of items(cons)) {
        const res = evalTree(ip2, c, scopeOf(tbl, rows));
        const keep: number[] = [];
        if (isAtom(res)) {
          if (truthy(res)) keep.push(...rows);
        } else {
          for (let i = 0; i < rows.length; i++) if (truthy(at(res, i))) keep.push(rows[i]);
        }
        rows = keep;
      }
    }
    const b = a[2];
    const sel = a[3];

    const selSpecs = (): { names: string[]; trees: QValue[] } | null => {
      if (sel === undefined) return null;
      if (isDict(sel)) {
        const d = sel as QDict;
        return { names: symsOf(d.k), trees: items(d.v) };
      }
      if (sel.t === -11) return { names: [(sel as QAtom).v as string], trees: [sel] };
      if (sel.t === 0 && count(sel) === 0) return null; // () -> all columns
      return { names: ['x'], trees: [sel] };
    };

    const byGroups = (): { names: string[]; trees: QValue[] } | null => {
      if (b === undefined) return null;
      if (isDict(b)) return { names: symsOf((b as QDict).k), trees: items((b as QDict).v) };
      if (b.t === -11) return { names: [(b as QAtom).v as string], trees: [b] };
      if (b.t === 11) return { names: symsOf(b), trees: items(b) };
      return null;
    };

    const by = byGroups();
    const spec = selSpecs();
    // b of () (rather than 0b) asks for exec-style results
    const execMode = b !== undefined && b.t === 0 && count(b) === 0;
    const wantTable =
      !execMode && (sel === undefined || isDict(sel) || (sel.t === 0 && count(sel) === 0));

    if (by) {
      const scope = scopeOf(tbl, rows);
      const keyVals = by.trees.map((t2) => {
        const v = evalTree(ip2, t2, scope);
        return isAtom(v) ? fillVec(v, rows.length) : v;
      });
      const map = new Map<string, number[]>();
      const order: string[] = [];
      for (let i = 0; i < rows.length; i++) {
        const k = keyVals.map((v) => keyStr(at(v, i))).join('\u0001');
        if (!map.has(k)) {
          map.set(k, []);
          order.push(k);
        }
        map.get(k)!.push(rows[i]);
      }
      const firstIdx = order.map((k) => rows.indexOf(map.get(k)![0]));
      const sortIdx = order.map((_, i) => i);
      sortIdx.sort((x, y) => {
        for (let ci = 0; ci < keyVals.length; ci++) {
          const c = compareAny(at(keyVals[ci], firstIdx[x]), at(keyVals[ci], firstIdx[y]));
          if (c) return c;
        }
        return 0;
      });
      const keyTable = table(
        by.names,
        keyVals.map((v) => fromItems(sortIdx.map((i) => at(v, firstIdx[i]))))
      );
      const specs = spec ?? {
        names: tbl.c.filter((c) => !by.names.includes(c)),
        trees: tbl.c.filter((c) => !by.names.includes(c)).map((c) => sym(c)),
      };
      const valCols = specs.trees.map((t2, ci) =>
        fromItems(
          sortIdx.map((i) => evalTree(ip2, t2, scopeOf(tbl, map.get(order[i])!)))
        )
      );
      const valTable = table(specs.names, valCols);
      if (!wantTable && specs.names.length === 1)
        return dict(keyTable.v.length === 1 ? keyTable.v[0] : keyTable, valCols[0]);
      return dict(keyTable, valTable);
    }

    const scope = scopeOf(tbl, rows);
    if (!spec) {
      if (execMode) {
        // exec with no columns: the last record, as a dictionary
        const last = rows.length ? rows[rows.length - 1] : -1;
        return dict(
          symvec(tbl.c.slice()),
          fromItems(tbl.v.map((c) => (last < 0 ? nullLike(c) : at(c, last))))
        );
      }
      return selectTableRows(tbl, rows);
    }
    if (!wantTable) {
      const vals = spec.trees.map((t2) => evalTree(ip2, t2, scope));
      if (isDict(sel)) return dict(symvec(spec.names), fromItems(vals));
      return vals.length === 1 ? vals[0] : fromItems(vals);
    }
    let vals = spec.trees.map((t2) => evalTree(ip2, t2, scope));
    let m = 1;
    for (const v of vals) if (!isAtom(v)) m = Math.max(m, count(v));
    vals = vals.map((v) => (isAtom(v) ? fillVec(v, m) : v));
    let res: QValue = table(spec.names, vals);
    if (a.length > 4 && a[4] !== undefined && !isAtom(a[4])) return res;
    if (a.length > 4 && a[4] !== undefined && isAtom(a[4]) && Number.isFinite(N(a[4])))
      res = take(ip2, a[4], res);
    return res;
  }

  /** ![t;c;b;a] - functional update and delete */
  def('!', [1, 2, 4, 5], (ip2, a) => {
    if (a.length <= 2) return bangOp(ip2, a);
    const { tbl, name, keys } = asTable(ip2, a[0]);
    const nrows = count(tbl);
    let rows: number[] = [];
    for (let i = 0; i < nrows; i++) rows.push(i);
    const cons = a[1];
    if (cons && !isAtom(cons) && count(cons) > 0) {
      for (const c of items(cons)) {
        const res = evalTree(ip2, c, scopeOf(tbl, rows));
        const keep: number[] = [];
        if (isAtom(res)) {
          if (truthy(res)) keep.push(...rows);
        } else for (let i = 0; i < rows.length; i++) if (truthy(at(res, i))) keep.push(rows[i]);
        rows = keep;
      }
    }
    const sel = a[3];
    let result: QValue;
    if (isDict(sel)) {
      // update
      const names = symsOf((sel as QDict).k);
      const trees = items((sel as QDict).v);
      const cols = tbl.c.slice();
      const vals = tbl.v.map((c) => shallowClone(c));
      names.forEach((nm, i) => {
        const v = evalTree(ip2, trees[i], scopeOf(table(cols, vals), rows));
        const ci = cols.indexOf(nm);
        if (rows.length === nrows) {
          const full = isAtom(v) ? fillVec(v, nrows) : v;
          if (ci >= 0) vals[ci] = full;
          else {
            cols.push(nm);
            vals.push(full);
          }
        } else {
          let col = ci >= 0 ? shallowClone(vals[ci]) : fillVec(nullLike(isAtom(v) ? v : at(v, 0)), nrows);
          rows.forEach((r, ix) => {
            col = setAt(col, r, isAtom(v) ? v : at(v, ix));
          });
          if (ci >= 0) vals[ci] = col;
          else {
            cols.push(nm);
            vals.push(col);
          }
        }
      });
      result = table(cols, vals);
    } else if (sel !== undefined && (sel.t === 11 || sel.t === -11) && count(sel) > 0) {
      // delete columns
      const drop = symsOf(sel);
      const keep = tbl.c.map((c, i) => i).filter((i) => !drop.includes(tbl.c[i]));
      result = table(keep.map((i) => tbl.c[i]), keep.map((i) => tbl.v[i]));
    } else {
      // delete rows
      const del = new Set(rows);
      const keep: number[] = [];
      for (let i = 0; i < nrows; i++) if (!del.has(i)) keep.push(i);
      result = selectTableRows(tbl, keep);
    }
    if (keys.length) result = xkey(ip2, symvec(keys), result);
    if (name) {
      ip2.globals.set(name, result);
      return sym(name);
    }
    return result;
  });

  def('@', [1, 2, 3, 4], (ip2, a) => {
    if (a.length === 1) return atom(-5, a[0].t === -101 ? 101 : a[0].t);
    if (a.length === 2) return ip2.apply(a[0], [a[1]]);
    const [x, i, f, y] = a;
    if (isFunc(x)) {
      // trap
      try {
        return ip2.apply(x, [i]);
      } catch (e: any) {
        if (isFunc(f)) return ip2.apply(f, [str(e.qmsg ?? String(e.message ?? e))]);
        return f;
      }
    }
    const idx = isAtom(i) ? [i] : items(i);
    let out = x;
    idx.forEach((ii, k) => {
      const cur = ip2.index1(out, ii);
      const nv =
        a.length === 4
          ? ip2.apply(f, [cur, isAtom(y!) ? y! : at(y!, k)])
          : ip2.apply(f, [cur]);
      out = ip2.amend(out, [ii], nv, null);
    });
    return out;
  });

  def('type', [1], (ip2, [x]) => atom(-5, x.t === -101 ? 101 : x.t));
  ip.globals.set('type', ip.verbValue('@:'));

  def('.', [2, 3, 4], (ip2, a) => {
    let [x, y] = a;
    if (x.t === -11 && ip2.globals.has(A(x) as string)) x = ip2.globals.get(A(x) as string)!;
    if (a.length === 2) {
      if (
        isFunc(x) ||
        (x.t === 0 && (x as QVector).v.some((v: QValue) => v.t === -101))
      ) {
        const args = isAtom(y) ? [y] : items(y);
        return ip2.apply(x, args.length ? args : [UNIT]);
      }
      return ip2.index(x, isAtom(y) ? [y] : items(y));
    }
    const [xx, idx, f, yv] = a;
    if (isFunc(xx) && a.length === 3) {
      try {
        const args = isAtom(idx) ? [idx] : items(idx);
        return ip2.apply(xx, args);
      } catch (e: any) {
        if (isFunc(f)) return ip2.apply(f, [str(e.qmsg ?? String(e.message ?? e))]);
        return f;
      }
    }
    const path = isAtom(idx) ? [idx] : items(idx);
    const cur = path.length ? ip2.index(xx, path) : xx;
    const nv = a.length === 4 ? ip2.apply(f, [cur, yv!]) : ip2.apply(f, [cur]);
    return path.length ? ip2.amend(xx, path, nv, null) : nv;
  });

  def('$', [2, 3], (ip2, a) => {
    if (a.length === 3) {
      return truthy(a[0]) ? a[1] : a[2];
    }
    const [x, y] = a;
    if (
      x.t === -11 ||
      x.t === 11 ||
      x.t === -10 ||
      x.t === 10 ||
      x.t === 0 ||
      Math.abs(x.t) === 5
    )
      return castValue(ip2, x, y);
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6)) {
      // pad
      const n = Math.trunc(N(x));
      const padOne = (s: string) => {
        if (n >= 0) return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
        const m = -n;
        return s.length >= m ? s.slice(s.length - m) : ' '.repeat(m - s.length) + s;
      };
      if (y.t === 10) return str(padOne((y as QVector).v as string));
      if (y.t === -10) return str(padOne(A(y)));
      if (y.t === 0) return listFrom(items(y).map((e) => str(padOne(qToString(e)))));
      if (y.t === 11 || y.t === -11) {
        if (isAtom(y)) return str(padOne(A(y)));
        return listFrom(symsOf(y).map((s) => str(padOne(s))));
      }
      throw new QError('type');
    }
    // matrix multiply
    return mmu(ip2, x, y);
  });

  def('string', [1], (ip2, [x]) => stringOf(x));
  function stringOf(x: QValue): QValue {
    if (isAtom(x) || isFunc(x)) return str(qToString(x));
    if (isTable(x)) {
      const t = x as QTable;
      return table(t.c.slice(), t.v.map((c) => stringOf(c)));
    }
    if (isDict(x)) return dict((x as QDict).k, stringOf((x as QDict).v));
    const n = count(x);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(stringOf(at(x, i)));
    return listFrom(out);
  }
  function qToString(x: QValue): string {
    if (isFunc(x)) return compact(x, DEFAULT_OPTS);
    if (isAtom(x)) return fmtRaw(x.t, A(x), DEFAULT_OPTS, true);
    return compact(x, DEFAULT_OPTS, true);
  }

  const EXTRACTORS: Record<string, (t: number, v: any) => number> = {
    year: (t, v) => ymdFromDays(daysOf(t, v))[0],
    mm: (t, v) => ymdFromDays(daysOf(t, v))[1],
    dd: (t, v) => ymdFromDays(daysOf(t, v))[2],
    hh: (t, v) => Math.floor(msOfDay(t, v) / 3600000),
    uu: (t, v) => Math.floor(msOfDay(t, v) / 60000) % 60,
    ss: (t, v) => Math.floor(msOfDay(t, v) / 1000) % 60,
    week: (t, v) => Math.floor((daysOf(t, v) + 3) / 7),
  };

  function daysOf(t: number, v: any): number {
    const a = Math.abs(t);
    if (a === 14) return v as number;
    if (a === 13) return daysFromMonth(v as number);
    if (a === 12) return Math.floor(Number(v as bigint) / 86400000000000);
    if (a === 15) return Math.floor(v as number);
    return 0;
  }
  function msOfDay(t: number, v: any): number {
    const a = Math.abs(t);
    if (a === 19) return v as number;
    if (a === 18) return (v as number) * 1000;
    if (a === 17) return (v as number) * 60000;
    if (a === 12 || a === 16) {
      const ns = Number(v as bigint) % 86400000000000;
      return Math.floor(((ns % 86400000000000) + 86400000000000) % 86400000000000 / 1e6);
    }
    if (a === 15) return Math.round(((v as number) % 1) * 86400000);
    return 0;
  }

  /** `hh$x, `dd$x ... extract a component of a temporal value */
  export_extract = (nm: string, y: QValue): QValue => {
    const f = EXTRACTORS[nm];
    return atomic1(ip, y, (t, v) => [6, isNullValue(Math.abs(t), v) ? NULL_INT : f(t, v)]);
  };

  function castValue(ip2: Interp, x: QValue, y: QValue): QValue {
    if (!isAtom(x)) {
      const specs = items(x);
      if (!isAtom(y) && count(y) === specs.length)
        return fromItems(specs.map((s2, i) => castValue(ip2, s2, at(y, i))));
      return fromItems(specs.map((s2) => castValue(ip2, s2, y)));
    }
    if (Math.abs(x.t) === 5 || Math.abs(x.t) === 6 || Math.abs(x.t) === 7) {
      return castTo(Math.abs(Math.trunc(N(x))), y);
    }
    const nameOrChar = isAtom(x) ? String(A(x)) : null;
    if (nameOrChar === null) throw new QError('type');
    const parseMode = x.t === -10 && /[A-Z]/.test(nameOrChar);
    if (nameOrChar === '') return castTo(11, y);
    if (EXTRACTORS[nameOrChar]) return export_extract(nameOrChar, y);
    const tname = nameOrChar.toLowerCase();
    const t = typeNumFromName(tname);
    if (parseMode) return parseFromString(t, y);
    return castTo(t, y);
  }

  function typeNumFromName(nm: string): number {
    const names: Record<string, number> = {
      boolean: 1,
      b: 1,
      guid: 2,
      g: 2,
      byte: 4,
      x: 4,
      short: 5,
      h: 5,
      int: 6,
      i: 6,
      long: 7,
      j: 7,
      real: 8,
      e: 8,
      float: 9,
      f: 9,
      char: 10,
      c: 10,
      symbol: 11,
      s: 11,
      timestamp: 12,
      p: 12,
      month: 13,
      m: 13,
      date: 14,
      d: 14,
      datetime: 15,
      z: 15,
      timespan: 16,
      n: 16,
      minute: 17,
      u: 17,
      second: 18,
      v: 18,
      time: 19,
      t: 19,
      '*': 0,
      ' ': 0,
    };
    const t = names[nm];
    if (t === undefined) throw new QError('type', `Unknown type name: ${nm}`);
    return t;
  }

  function castTo(t: number, y: QValue): QValue {
    if (t === 0) return y;
    if (t === 11 && (y.t === 10 || y.t === -10))
      return sym(String(y.t === 10 ? (y as QVector).v : A(y)).trim());
    if (t === 10 && y.t === -11) return str(A(y));
    if (t === 11 && y.t === 0) return symvec(items(y).map((e) => (e.t === 10 ? ((e as QVector).v as string) : e.t === -10 ? A(e) : qToString(e))));
    if (isTable(y)) {
      const tb = y as QTable;
      return table(tb.c.slice(), tb.v.map((c) => castTo(t, c)));
    }
    if (isDict(y)) return dict((y as QDict).k, castTo(t, (y as QDict).v));
    if (isAtom(y)) {
      const [tt, v] = castScalar(t, y.t, A(y));
      return atom(-tt, v);
    }
    if (y.t === 0) {
      if (count(y) === 0) return typedVec(t, []); // `float$() is an empty float vector
      return fromItems(items(y).map((e) => castTo(t, e)));
    }
    const n = count(y);
    const out = new Array(n);
    const arr = y.t === 10 ? ((y as QVector).v as string).split('') : ((y as QVector).v as any[]);
    for (let i = 0; i < n; i++) out[i] = castScalar(t, y.t, arr[i])[1];
    return typedVec(t, out);
  }

  function castScalar(t: number, from: number, v: any): [number, any] {
    const f = Math.abs(from);
    if (t === f) return [t, v];
    if (isNullValue(f, v) && t !== 11 && t !== 10) return [t, nullValue(t)];
    let n: number;
    if (typeof v === 'bigint') n = Number(v);
    else if (typeof v === 'string') n = v.length === 1 ? v.charCodeAt(0) : NaN;
    else n = v;
    switch (t) {
      case 1:
        return [1, n ? 1 : 0];
      case 4:
        return [4, Math.trunc(n) & 255];
      case 5:
      case 6:
      case 7: {
        const v2 = convertTemporal(f, t, n);
        // q rounds when narrowing a float, and rounds halves away from zero
        const r = f === 9 || f === 8 ? (v2 < 0 ? -Math.round(-v2) : Math.round(v2)) : Math.trunc(v2);
        return [t, r];
      }
      case 8:
      case 9:
        return [t, convertTemporal(f, t, n)];
      case 10:
        return [10, String.fromCharCode(Math.trunc(n))];
      case 11:
        return [11, typeof v === 'string' ? v : fmtRaw(-f, v, DEFAULT_OPTS, true)];
      case 12:
      case 16: {
        const big = toNs(f, v);
        return [t, big];
      }
      default:
        return [t, Math.trunc(convertTemporal(f, t, n))];
    }
  }

  function toNs(from: number, v: any): bigint {
    if (typeof v === 'bigint') return v;
    const n = numOf(v);
    if (from === 14) return BigInt(Math.round(n)) * 86400000000000n;
    if (from === 19) return BigInt(Math.round(n)) * 1000000n;
    if (from === 18) return BigInt(Math.round(n)) * 1000000000n;
    if (from === 17) return BigInt(Math.round(n)) * 60000000000n;
    if (from === 15) return BigInt(Math.round(n * 86400000)) * 1000000n;
    return BigInt(Math.round(n));
  }

  /** convert a numeric value of temporal type `from` into type `to` */
  function convertTemporal(from: number, to: number, n: number): number {
    if (from === to) return n;
    const nsFrom = (f: number, v: number): number => {
      switch (f) {
        case 14:
          return v * 86400000000000;
        case 19:
          return v * 1e6;
        case 18:
          return v * 1e9;
        case 17:
          return v * 6e10;
        case 15:
          return v * 86400000 * 1e6;
        case 13:
          return daysFromMonth(v) * 86400000000000;
        default:
          return NaN;
      }
    };
    const isTemp = (t: number) => t >= 12 && t <= 19;
    if (isTemp(from) && isTemp(to)) {
      const ns = from === 12 || from === 16 ? n : nsFrom(from, n);
      switch (to) {
        case 14:
          return Math.floor(ns / 86400000000000);
        case 19:
          return Math.floor((mod(ns, 86400000000000)) / 1e6);
        case 18:
          return Math.floor(mod(ns, 86400000000000) / 1e9);
        case 17:
          return Math.floor(mod(ns, 86400000000000) / 6e10);
        case 13:
          return monthFromDays(Math.floor(ns / 86400000000000));
        case 15:
          return ns / 86400000000000;
        default:
          return ns;
      }
    }
    return n;
  }

  function mod(a: number, b: number): number {
    return ((a % b) + b) % b;
  }

  function daysFromMonth(m: number): number {
    const y = 2000 + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;
    return daysFromEpoch(y, mm + 1, 1);
  }
  function monthFromDays(d: number): number {
    const [y, m] = ymdFromDays(d);
    return (y - 2000) * 12 + (m - 1);
  }

  function parseFromString(t: number, y: QValue): QValue {
    const one = (s: string): any => {
      s = s.trim();
      switch (t) {
        case 1:
          return s === '1' || /^[ty]$/i.test(s) || s.toLowerCase() === 'true' ? 1 : 0;
        case 4:
          return s === '' ? 0 : parseInt(s, 16) & 255;
        case 5: {
          if (s === '') return nullValue(t);
          const n = Math.trunc(parseFloat(s));
          return n < -32767 || n > 32767 ? nullValue(t) : n;
        }
        case 6: {
          if (s === '') return nullValue(t);
          const ip4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
          if (ip4) {
            const u = ip4.slice(1).reduce((n, part) => n * 256 + Number(part), 0);
            return u | 0;
          }
          const n = Math.trunc(parseFloat(s));
          return n < -2147483647 || n > 2147483647 ? nullValue(t) : n;
        }
        case 7:
          return s === '' ? nullValue(t) : Math.trunc(parseFloat(s));
        case 8:
        case 9:
          return s === '' ? NaN : parseFloat(s);
        case 11:
          return s;
        case 14: {
          const m = /^(\d{4})[.\-/]?(\d{2})[.\-/]?(\d{2})$/.exec(s);
          if (!m) return NULL_INT;
          return daysFromEpoch(+m[1], +m[2], +m[3]);
        }
        case 19: {
          const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/.exec(s);
          if (!m) return NULL_INT;
          return ((+m[1] * 60 + +m[2]) * 60 + (+(m[3] || 0))) * 1000 + +((m[4] || '0').padEnd(3, '0'));
        }
        default:
          return parseFloat(s);
      }
    };
    if (y.t === 10) return atom(-t, one((y as QVector).v as string));
    if (y.t === -10) return atom(-t, one(A(y)));
    if (y.t === 11) return typedVec(t, symsOf(y).map(one));
    if (y.t === -11) return atom(-t, one(A(y)));
    if (y.t === 0) return typedVec(t, items(y).map((e) => one(qToString(e))));
    throw new QError('type');
  }

  function mmu(ip2: Interp, x: QValue, y: QValue): QValue {
    // vector arguments are treated as a single row / column
    const yIsVec = count(y) > 0 && isAtom(at(y, 0));
    const xIsVec = count(x) > 0 && isAtom(at(x, 0));
    if (xIsVec && !yIsVec) return at(mmu(ip2, listFrom([x]), y), 0);
    if (yIsVec) {
      const rows = xIsVec ? [x] : items(x);
      const yv = nums(y);
      const out = rows.map((r) => {
        const rv = nums(r);
        let s2 = 0;
        for (let i = 0; i < Math.min(rv.length, yv.length); i++) s2 += rv[i] * yv[i];
        return s2;
      });
      return xIsVec ? float(out[0]) : floatvec(out);
    }
    const xr = count(x);
    const out: QValue[] = [];
    for (let i = 0; i < xr; i++) {
      const row = at(x, i);
      const yr = count(y);
      const ycols = count(at(y, 0));
      const res = new Array(ycols).fill(0);
      for (let k = 0; k < yr; k++) {
        const rv = numOf(raw(row, k));
        const yrow = at(y, k);
        for (let j = 0; j < ycols; j++) res[j] += rv * numOf(raw(yrow, j));
      }
      out.push(floatvec(res));
    }
    return listFrom(out);
  }
  def('mmu', [2], (ip2, [x, y]) => mmu(ip2, x, y));

  // ---------------------------------------------------------------- aggregates

  const sumOf = (x: QValue): QValue => {
    if (isAtom(x)) return x;
    if (isDict(x)) return sumOf((x as QDict).v);
    if (isTable(x)) {
      const t = x as QTable;
      return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => sumOf(c))));
    }
    const n = count(x);
    if (n === 0) return long(0);
    if (x.t === 0) {
      let acc = at(x, 0);
      for (let i = 1; i < n; i++) acc = atomic2(ip, acc, at(x, i), addSpec as any);
      return acc;
    }
    const isFloat = x.t === 9 || x.t === 8;
    let s = 0;
    let big = x.t === 12 || x.t === 16;
    if (big) {
      let bs = 0n;
      for (let i = 0; i < n; i++) {
        const v = raw(x, i) as bigint;
        if (v !== NULL_BIG) bs += v;
      }
      return atom(-x.t, bs);
    }
    for (let i = 0; i < n; i++) {
      const v = numOf(raw(x, i));
      if (isNullAt(x.t, raw(x, i))) continue;
      s += v;
    }
    const rt = x.t === 1 || x.t === 4 ? 7 : x.t === 6 || x.t === 5 ? 7 : x.t;
    return atom(-(isFloat ? x.t : rt), isFloat ? s : Math.trunc(s));
  };
  def('sum', [1], (ip2, [x]) => sumOf(x));

  def('prd', [1], (ip2, [x]) => {
    if (isAtom(x)) return x;
    if (isDict(x)) return ip2.apply(prim(ip2.builtins.get('prd')!), [(x as QDict).v]);
    const n = count(x);
    if (n === 0) return long(1);
    if (x.t === 0) {
      let acc = at(x, 0);
      for (let i = 1; i < n; i++) acc = atomic2(ip2, acc, at(x, i), mulSpec as any);
      return acc;
    }
    let p = 1;
    for (let i = 0; i < n; i++) {
      if (isNullAt(x.t, raw(x, i))) continue;
      p *= numOf(raw(x, i));
    }
    const isFloat = x.t === 9 || x.t === 8;
    const rt = x.t === 1 ? 6 : isFloat ? x.t : 7;
    return atom(-rt, isFloat ? p : Math.trunc(p));
  });

  const avgOf = (x: QValue): QValue => {
    if (isAtom(x)) return float(numOf(A(x)));
    if (isTable(x)) {
      const t = x as QTable;
      return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => avgOf(c))));
    }
    if (isDict(x)) return avgOf((x as QDict).v);
    const n = count(x);
    if (x.t === 0) {
      let acc: QValue | null = null;
      let cnt = 0;
      for (let i = 0; i < n; i++) {
        const e = at(x, i);
        cnt++;
        // A null atom is omitted from a mixed-list average. Nulls inside
        // nested vectors remain positional and therefore propagate.
        if (isAtom(e) && isNullAt(e.t, A(e))) continue;
        acc = acc === null ? e : atomic2(ip, acc, e, addSpec as any);
      }
      if (acc === null) return float(NaN);
      return atomic2(ip, acc, long(cnt), divSpec as any);
    }
    let s = 0,
      c = 0;
    for (let i = 0; i < n; i++) {
      const v = raw(x, i);
      if (isNullAt(x.t, v)) continue;
      s += numOf(v);
      c++;
    }
    return float(c === 0 ? NaN : s / c);
  };
  def('avg', [1], (ip2, [x]) => avgOf(x));

  const minMax = (x: QValue, isMin: boolean): QValue => {
    if (isAtom(x)) return x;
    if (isTable(x)) {
      const t = x as QTable;
      return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => minMax(c, isMin))));
    }
    if (isDict(x)) return minMax((x as QDict).v, isMin);
    const n = count(x);
    if (n === 0) return isMin ? atom(-9, Infinity) : atom(-9, -Infinity);
    if (x.t === 0) {
      let acc = at(x, 0);
      for (let i = 1; i < n; i++)
        acc = atomic2(ip, acc, at(x, i), (isMin ? minSpec : maxSpec) as any);
      return acc;
    }
    if (x.t === 11) {
      let best = raw(x, 0) as string;
      for (let i = 1; i < n; i++) {
        const v = raw(x, i) as string;
        if (isMin ? v < best : v > best) best = v;
      }
      return sym(best);
    }
    let best: any = null;
    for (let i = 0; i < n; i++) {
      const v = raw(x, i);
      if (isNullAt(x.t, v)) continue;
      if (best === null) best = v;
      else if (isMin ? numOf(v) < numOf(best) : numOf(v) > numOf(best)) best = v;
    }
    if (best === null) {
      const inf =
        x.t === 5
          ? isMin
            ? 32767
            : -32767
          : x.t === 6
            ? isMin
              ? 2147483647
              : -2147483647
            : x.t === 7
              ? isMin
                ? INF_LONG
                : NEG_INF_LONG
              : isMin
                ? Infinity
                : -Infinity;
      return atom(-x.t, inf);
    }
    return atom(-x.t, best);
  };
  def('min', [1], (ip2, [x]) => minMax(x, true));
  def('max', [1], (ip2, [x]) => minMax(x, false));

  def('all', [1], (ip2, [x]) => {
    if (isAtom(x)) return bool(truthy(x));
    const n = count(x);
    for (let i = 0; i < n; i++) if (!truthy(at(x, i))) return bool(false);
    return bool(true);
  });
  def('any', [1], (ip2, [x]) => {
    if (isAtom(x)) return bool(truthy(x));
    const n = count(x);
    for (let i = 0; i < n; i++) if (truthy(at(x, i))) return bool(true);
    return bool(false);
  });

  const varOf = (x: QValue): number => {
    const v = nums(x).filter((n) => !Number.isNaN(n));
    if (!v.length) return NaN;
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length;
  };
  def('var', [1], (ip2, [x]) => float(varOf(x)));
  def('dev', [1], (ip2, [x]) => float(Math.sqrt(varOf(x))));
  def('svar', [1], (ip2, [x]) => {
    const v = nums(x).filter((n) => !Number.isNaN(n));
    return float((v.length * varOf(x)) / (v.length - 1));
  });
  def('sdev', [1], (ip2, [x]) => {
    const v = nums(x).filter((n) => !Number.isNaN(n));
    return float(Math.sqrt((v.length * varOf(x)) / (v.length - 1)));
  });
  def('med', [1], (ip2, [x]) => {
    const v = nums(x).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (!v.length) return float(NaN);
    const n = v.length;
    const lo = v[Math.floor(0.5 * (n - 1))];
    const hi = v[Math.floor(0.5 * n)];
    return float((lo + hi) / 2);
  });
  def('cov', [2], (ip2, [x, y]) => {
    const [a, b] = pairs(x, y);
    const n = a.length;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return float(s / n);
  });
  def('scov', [2], (ip2, [x, y]) => {
    const [a, b] = pairs(x, y);
    const n = a.length;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb);
    return float(s / (n - 1));
  });
  def('cor', [2], (ip2, [x, y]) => {
    const [a, b] = pairs(x, y);
    const n = a.length;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let sab = 0,
      sa = 0,
      sb = 0;
    for (let i = 0; i < n; i++) {
      sab += (a[i] - ma) * (b[i] - mb);
      sa += (a[i] - ma) ** 2;
      sb += (b[i] - mb) ** 2;
    }
    return float(sab / Math.sqrt(sa * sb));
  });
  def('wsum', [2], (ip2, [x, y]) => {
    if (isTable(y)) {
      const t = y as QTable;
      return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => ip2.apply(prim(ip2.builtins.get('wsum')!), [x, c]))));
    }
    if (isDict(y)) {
      const d = y as QDict;
      return dict(d.k, fromItems(items(d.v).map((v) => ip2.apply(prim(ip2.builtins.get('wsum')!), [x, v]))));
    }
    const total = sumOf(atomic2(ip2, x, y, mulSpec as any));
    // A simple vector of weights produces a float scalar; scalar and nested
    // weights preserve the arithmetic result type.
    return x.t > 0 ? castTo(9, total) : total;
  });
  def('wavg', [2], (ip2, [x, y]) => {
    if (isTable(y)) {
      const t = y as QTable;
      return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => ip2.apply(prim(ip2.builtins.get('wavg')!), [x, c]))));
    }
    if (isDict(y)) {
      const d = y as QDict;
      return dict(d.k, fromItems(items(d.v).map((v) => ip2.apply(prim(ip2.builtins.get('wavg')!), [x, v]))));
    }
    const validWeightSpec = {
      name: 'wavg-mask',
      num: (a: number) => a,
      numT: (a: number, b: number, ta: number, tb: number) =>
        isNullValue(ta, a) || isNullValue(tb, b) ? 0 : a,
      rtype: () => 9,
      keepNulls: true,
    };
    const numerator = sumOf(atomic2(ip2, x, y, mulSpec as any));
    const denominator = sumOf(atomic2(ip2, x, y, validWeightSpec as any));
    return atomic2(ip2, numerator, denominator, divSpec as any);
  });

  // ---------------------------------------------------------------- running ops

  const running = (
    name: string,
    step: (acc: any, v: any) => any,
    init: (v: any) => any,
    floatResult = false
  ) =>
    def(name, [1], (ip2, [x]) => {
      if (isAtom(x)) return x;
      if (isDict(x)) return dict((x as QDict).k, ip2.apply(prim(ip2.builtins.get(name)!), [(x as QDict).v]));
      if (isTable(x)) {
        const t = x as QTable;
        return table(t.c.slice(), t.v.map((c) => ip2.apply(prim(ip2.builtins.get(name)!), [c])));
      }
      const n = count(x);
      if (x.t === 0) {
        const out: QValue[] = [];
        let acc: QValue | null = null;
        for (let i = 0; i < n; i++) {
          const e = at(x, i);
          acc = acc === null ? e : (atomic2(ip2, acc, e, (name === 'sums' ? addSpec : name === 'prds' ? mulSpec : name === 'maxs' ? maxSpec : minSpec) as any) as QValue);
          out.push(acc);
        }
        return listFrom(out);
      }
      const out = new Array(n);
      let acc: any = null;
      for (let i = 0; i < n; i++) {
        let v = raw(x, i);
        if (x.t === 10) {
          if (name !== 'maxs' && name !== 'mins') throw new QError('type');
          acc = acc === null ? v : step(acc, v);
          out[i] = acc;
          continue;
        }
        if (isNullAt(x.t, v)) {
          if (name === 'sums') v = 0;
          else if (name === 'prds') v = 1;
          else if (acc !== null) v = acc;
          else {
            const isMin = name === 'mins';
            v =
              x.t === 5
                ? isMin
                  ? 32767
                  : -32767
                : x.t === 6
                  ? isMin
                    ? 2147483647
                    : -2147483647
                  : x.t === 7
                    ? isMin
                      ? INF_LONG
                      : NEG_INF_LONG
                    : isMin
                      ? Infinity
                      : -Infinity;
          }
        }
        acc = acc === null ? init(v) : step(acc, numOf(v));
        out[i] = acc;
      }
      const rt =
        x.t === 10
          ? 10
          : floatResult || x.t === 9 || x.t === 8
            ? x.t === 8
              ? 8
              : 9
            : 7;
      return typedVec(rt, out);
    });

  running('sums', (a, v) => a + v, (v) => numOf(v));
  running('prds', (a, v) => a * v, (v) => numOf(v));
  running('maxs', (a, v) => (v > a ? v : a), (v) => numOf(v));
  running('mins', (a, v) => (v < a ? v : a), (v) => numOf(v));

  def('deltas', [1], (ip2, [x]) => {
    const n = count(x);
    if (isAtom(x)) return x;
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) {
      const cur = at(x, i);
      const prev = i === 0 ? castTo(Math.abs(cur.t), long(0)) : at(x, i - 1);
      out.push(atomic2(ip2, cur, prev, subSpec as any));
    }
    return fromItems(out);
  });
  // q exposes deltas as the derived function -':, including its optional
  // left seed and its canonical console representation.
  ip.globals.set('deltas', ip.makeIter("':", ip.verbValue('-')));
  def('ratios', [1], (ip2, [x]) => {
    const n = count(x);
    if (isAtom(x)) return x;
    if (x.t === 0) {
      const out: QValue[] = [];
      for (let i = 0; i < n; i++)
        out.push(i === 0 ? at(x, i) : atomic2(ip2, at(x, i), at(x, i - 1), divSpec as any));
      return fromItems(out);
    }
    const vals = nums(x);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = i === 0 ? vals[0] : vals[i] / vals[i - 1];
    return floatvec(out);
  });
  def('differ', [1], (ip2, [x]) => {
    const n = count(x);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = i === 0 ? 1 : matchValues(at(x, i), at(x, i - 1)) ? 0 : 1;
    return vec(1, out);
  });
  def('prev', [1], (ip2, [x]) => {
    const n = count(x);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(i === 0 ? nullLike(x) : at(x, i - 1));
    return fromItems(out);
  });
  def('next', [1], (ip2, [x]) => {
    const n = count(x);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(i === n - 1 ? nullLike(x) : at(x, i + 1));
    return fromItems(out);
  });
  def('xprev', [2], (ip2, [x, y]) => {
    const k = Math.trunc(N(x));
    const n = count(y);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(i - k < 0 || i - k >= n ? nullLike(y) : at(y, i - k));
    return fromItems(out);
  });
  def('fills', [1], (ip2, [x]) => {
    const n = count(x);
    const out: QValue[] = [];
    let last: QValue | null = null;
    for (let i = 0; i < n; i++) {
      const e = at(x, i);
      if (isAtom(e) && isNullAt(e.t, A(e))) out.push(last ?? e);
      else {
        last = e;
        out.push(e);
      }
    }
    return fromItems(out);
  });
  def('avgs', [1], (ip2, [x]) => {
    if (isDict(x)) return dict((x as QDict).k, ip2.apply(prim(ip2.builtins.get('avgs')!), [(x as QDict).v]));
    if (isTable(x)) {
      const t = x as QTable;
      return table(t.c.slice(), t.v.map((c) => ip2.apply(prim(ip2.builtins.get('avgs')!), [c])));
    }
    const n = count(x);
    const out = new Array(n);
    let s = 0,
      c = 0;
    for (let i = 0; i < n; i++) {
      const v = raw(x, i);
      if (!isNullAt(x.t, v)) {
        s += numOf(v);
        c++;
      }
      out[i] = c ? s / c : NaN;
    }
    return floatvec(out);
  });

  const moving = (name: string, f: (win: number[]) => number, floatOut: boolean) =>
    def(name, [2], (ip2, [x, y]) => {
      if (isDict(y)) {
        const d = y as QDict;
        const f2 = prim(ip2.builtins.get(name)!);
        return dict(d.k, fromItems(items(d.v).map((v) => ip2.apply(f2, [x, v]))));
      }
      if (isTable(y)) {
        const t = y as QTable;
        return table(t.c.slice(), t.v.map((c) => ip2.apply(prim(ip2.builtins.get(name)!), [x, c])));
      }
      const w = Math.trunc(N(x));
      const n = count(y);
      const out = new Array(n);
      const vals = nums(y);
      for (let i = 0; i < n; i++) {
        const start = Math.max(0, i - w + 1);
        out[i] = f(vals.slice(start, i + 1).filter((v) => !Number.isNaN(v)));
      }
      const rt = floatOut ? 9 : y.t === 9 || y.t === 8 ? y.t : 7;
      return typedVec(rt, floatOut ? out : out.map((v) => Math.trunc(v)));
    });
  moving('msum', (w) => w.reduce((a, b) => a + b, 0), false);
  moving('mcount', (w) => w.length, false);
  moving('mavg', (w) => (w.length ? w.reduce((a, b) => a + b, 0) / w.length : NaN), true);
  moving('mmax', (w) => (w.length ? Math.max(...w) : NaN), false);
  moving('mmin', (w) => (w.length ? Math.min(...w) : NaN), false);
  moving(
    'mdev',
    (w) => {
      if (!w.length) return NaN;
      const m = w.reduce((a, b) => a + b, 0) / w.length;
      return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
    },
    true
  );
  def('ema', [2], (ip2, [x, y]) => {
    const a = N(x);
    const n = count(y);
    const out = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const v = numOf(raw(y, i));
      acc = i === 0 ? v : a * v + (1 - a) * acc;
      out[i] = acc;
    }
    return floatvec(out);
  });

  // ---------------------------------------------------------------- sorting

  function gradeIdx(x: QValue, desc: boolean): number[] {
    const n = count(x);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const els = items(x);
    idx.sort((a, b) => {
      const c = compareAny(els[a], els[b]);
      if (c !== 0) return desc ? -c : c;
      return a - b;
    });
    return idx;
  }
  function iasc(ip2: Interp, x: QValue): QValue {
    if (isDict(x)) return selectRows((x as QDict).k, gradeIdx((x as QDict).v, false));
    if (isTable(x)) return longvec(gradeIdx(fromItems(items(x)), false));
    return longvec(gradeIdx(x, false));
  }
  function idesc(ip2: Interp, x: QValue): QValue {
    if (isDict(x)) return selectRows((x as QDict).k, gradeIdx((x as QDict).v, true));
    if (isTable(x)) return longvec(gradeIdx(fromItems(items(x)), true));
    return longvec(gradeIdx(x, true));
  }
  def('iasc', [1], (ip2, [x]) => iasc(ip2, x));
  def('idesc', [1], (ip2, [x]) => idesc(ip2, x));
  def('asc', [1], (ip2, [x]) => sortVal(ip2, x, false));
  def('desc', [1], (ip2, [x]) => sortVal(ip2, x, true));
  def('rank', [1], (ip2, [x]) => longvec(gradeIdx(longvec(gradeIdx(x, false)), false)));

  function sortVal(ip2: Interp, x: QValue, desc: boolean): QValue {
    if (isDict(x)) {
      const d = x as QDict;
      const idx = gradeIdx(d.v, desc);
      return dict(selectRows(d.k, idx), selectRows(d.v, idx));
    }
    if (isTable(x)) {
      const t = x as QTable;
      const idx = gradeIdx(fromItems(items(t)), desc);
      return selectTableRows(t, idx);
    }
    const idx = gradeIdx(x, desc);
    const out = selectRows(x, idx);
    if (!desc && out.t > 0 && out.t <= 19) (out as QVector).a = 's';
    return out;
  }

  def('xasc', [2], (ip2, [x, y]) => sortTableBy(ip2, x, y, false));
  def('xdesc', [2], (ip2, [x, y]) => sortTableBy(ip2, x, y, true));
  function sortTableBy(ip2: Interp, x: QValue, y: QValue, desc: boolean): QValue {
    const cols = symsOf(x);
    const t = (isKeyedTable(y) ? unkey(y as QDict) : y) as QTable;
    const n = count(t);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push(i);
    const colVals = cols.map((c) => {
      const ci = t.c.indexOf(c);
      if (ci < 0) throw new QError(c);
      return items(t.v[ci]);
    });
    idx.sort((a, b) => {
      for (const cv of colVals) {
        const cmp = compareAny(cv[a], cv[b]);
        if (cmp !== 0) return desc ? -cmp : cmp;
      }
      return a - b;
    });
    return selectTableRows(t, idx);
  }

  def('bin', [2], (ip2, [x, y]) => binSearch(ip2, x, y, false));
  def('binr', [2], (ip2, [x, y]) => binSearch(ip2, x, y, true));
  function binSearch(ip2: Interp, x: QValue, y: QValue, right: boolean): QValue {
    if (isDict(x)) {
      const d = x as QDict;
      const ix = binSearch(ip2, d.v, y, right);
      return ip2.index1(d.k, ix);
    }
    const n = count(x);
    const find = (e: QValue): number => {
      let lo = 0,
        hi = n - 1,
        res = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const c = compareAny(at(x, mid), e);
        if (right) {
          if (c >= 0) {
            res = mid;
            hi = mid - 1;
          } else lo = mid + 1;
        } else {
          if (c <= 0) {
            res = mid;
            lo = mid + 1;
          } else hi = mid - 1;
        }
      }
      return right ? (res === -1 ? n : res) : res;
    };
    if (isAtom(y)) return long(find(y));
    const m = count(y);
    const out = new Array(m);
    for (let i = 0; i < m; i++) out[i] = find(at(y, i));
    return longvec(out);
  }

  // ---------------------------------------------------------------- sets

  def('in', [2], (ip2, [x, y]) => {
    // y is an atom or simple vector -> left-atomic; y is a general list ->
    // a single boolean saying whether x itself is an item of y
    const yIsList = y.t === 0 && count(y) > 0 && at(y, 0).t >= 0;
    if (yIsList) {
      const n = count(y);
      for (let i = 0; i < n; i++) if (matchValues(at(y, i), x)) return bool(true);
      return bool(false);
    }
    const has = (e: QValue): boolean => {
      if (isAtom(y)) return matchValues(y, e);
      const n = count(y);
      for (let i = 0; i < n; i++) if (matchValues(at(y, i), e)) return true;
      return false;
    };
    const walk = (v: QValue): QValue => {
      if (isAtom(v)) return bool(has(v));
      const n = count(v);
      const out: QValue[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = walk(at(v, i));
      return fromItems(out);
    };
    return walk(x);
  });

  def('within', [2], (ip2, [x, y]) => {
    const lo = at(y, 0),
      hi = at(y, 1);
    const test = (e: QValue, lower: QValue, upper: QValue): QValue => {
      if (!isAtom(lower) || !isAtom(upper)) {
        if (count(lower) !== count(upper)) throw new QError('length');
        const n = count(lower);
        if (!isAtom(e) && count(e) !== n) throw new QError('length');
        const out: QValue[] = new Array(n);
        for (let i = 0; i < n; i++)
          out[i] = test(isAtom(e) ? e : at(e, i), at(lower, i), at(upper, i));
        return fromItems(out);
      }
      if (isAtom(e))
        return bool(compareAny(e, lower) >= 0 && compareAny(e, upper) <= 0);
      const n = count(e);
      const out: QValue[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = test(at(e, i), lower, upper);
      return fromItems(out);
    };
    if (isDict(x)) return dict((x as QDict).k, test((x as QDict).v, lo, hi));
    return test(x, lo, hi);
  });

  def('except', [2], (ip2, [x, y]) => {
    const n = count(x);
    const keep: number[] = [];
    const ys = new Set(items(isAtom(y) ? enlist(y) : y).map(keyStr));
    for (let i = 0; i < n; i++) if (!ys.has(keyStr(at(x, i)))) keep.push(i);
    if (isTable(x)) return selectTableRows(x as QTable, keep);
    return selectRows(x, keep);
  });
  def('inter', [2], (ip2, [x, y]) => {
    const n = count(x);
    const keep: number[] = [];
    const ys = new Set(items(isAtom(y) ? enlist(y) : y).map(keyStr));
    for (let i = 0; i < n; i++) if (ys.has(keyStr(at(x, i)))) keep.push(i);
    if (isTable(x)) return selectTableRows(x as QTable, keep);
    return selectRows(x, keep);
  });
  def('union', [2], (ip2, [x, y]) => {
    const all = join(ip2, isAtom(x) ? enlist(x) : x, isAtom(y) ? enlist(y) : y);
    return ip2.apply(prim(ip2.builtins.get('distinct')!), [all]);
  });

  def('raze', [1], (ip2, [x]) => {
    if (isAtom(x)) return enlist(x);
    const n = count(x);
    if (n === 0) return x;
    if (x.t === 0) {
      // flatten in one pass rather than n joins
      const parts = (x as QVector).v as QValue[];
      let total = 0;
      let allSame = true;
      const t0 = parts[0].t;
      for (const p2 of parts) {
        if (p2.t !== t0) allSame = false;
        total += isAtom(p2) ? 1 : count(p2);
      }
      checkLen(total);
      if (allSame && t0 > 0 && t0 <= 19) {
        if (t0 === 10) return str(parts.map((p2) => (p2 as QVector).v as string).join(''));
        const out: any[] = new Array(total);
        let k = 0;
        for (const p2 of parts) for (const v of (p2 as QVector).v as any[]) out[k++] = v;
        return typedVec(t0, out);
      }
      const out: QValue[] = [];
      for (const p2 of parts) {
        if (isAtom(p2) || isFunc(p2)) out.push(p2);
        else for (const e of items(p2)) out.push(e);
      }
      return fromItems(out);
    }
    let acc: QValue | null = null;
    for (let i = 0; i < n; i++) {
      const e = at(x, i);
      acc = acc === null ? e : join(ip2, acc, e);
    }
    return acc!;
  });

  def('cross', [2], (ip2, [x, y]) => {
    const xs = isAtom(x) ? [x] : items(x);
    const ys = isAtom(y) ? [y] : items(y);
    if (isTable(x) && isTable(y)) {
      const tx = x as QTable,
        ty = y as QTable;
      const xi: number[] = [],
        yi: number[] = [];
      for (let i = 0; i < count(tx); i++)
        for (let j = 0; j < count(ty); j++) {
          xi.push(i);
          yi.push(j);
        }
      return table(
        [...tx.c, ...ty.c],
        [...tx.v.map((c) => selectRows(c, xi)), ...ty.v.map((c) => selectRows(c, yi))]
      );
    }
    const out: QValue[] = [];
    for (const a of xs) for (const b of ys) out.push(join(ip2, a, b));
    return listFrom(out);
  });

  def('rotate', [2], (ip2, [x, y]) => {
    const n = count(y);
    if (n === 0) return y;
    const k = ((Math.trunc(N(x)) % n) + n) % n;
    const idx: number[] = [];
    for (let i = 0; i < n; i++) idx.push((i + k) % n);
    if (isTable(y)) return selectTableRows(y as QTable, idx);
    return selectRows(y, idx);
  });

  def('sublist', [2], (ip2, [x, y]) => {
    if (isAtom(x)) {
      // unlike take, sublist never recycles: it clamps to what is there
      const n = Math.trunc(N(x));
      const len = count(y);
      const idx: number[] = [];
      if (n >= 0) for (let i = 0; i < Math.min(n, len); i++) idx.push(i);
      else for (let i = Math.max(0, len + n); i < len; i++) idx.push(i);
      if (isKeyedTable(y)) {
        const kt = y as QDict;
        return dict(selectTableRows(kt.k as QTable, idx), selectTableRows(kt.v as QTable, idx));
      }
      if (isTable(y)) return selectTableRows(y as QTable, idx);
      if (isDict(y)) {
        const d = y as QDict;
        return dict(selectRows(d.k, idx), selectRows(d.v, idx));
      }
      return selectRows(y, idx);
    }
    const start = Math.trunc(numOf(raw(x, 0)));
    const len = Math.trunc(numOf(raw(x, 1)));
    const n = count(y);
    const idx: number[] = [];
    for (let i = Math.max(0, start); i < Math.min(n, start + len); i++) idx.push(i);
    if (isTable(y)) return selectTableRows(y as QTable, idx);
    return selectRows(y, idx);
  });

  def('xbar', [2], (ip2, [x, y]) =>
    atomic2(ip2, x, y, {
      name: 'xbar',
      num: (a, b) => a * Math.floor(b / a),
      big: (a, b) => a * (b / a),
      rtype: (a, b) => (b >= 12 && b <= 19 ? b : arithType(a, b)),
    } as any)
  );

  def('xrank', [2], (ip2, [x, y]) => {
    const n = Math.trunc(N(x));
    const len = count(y);
    const g = gradeIdx(longvec(gradeIdx(y, false)), false);
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = Math.floor((n * g[i]) / len);
    return longvec(out);
  });

  // ---------------------------------------------------------------- strings

  def('lower', [1], (ip2, [x]) => strCase(x, false));
  def('upper', [1], (ip2, [x]) => strCase(x, true));
  function strCase(x: QValue, up: boolean): QValue {
    const f = (s: string) => (up ? s.toUpperCase() : s.toLowerCase());
    if (x.t === -11) return sym(f(A(x)));
    if (x.t === 11) return symvec(symsOf(x).map(f));
    if (x.t === -10) return char(f(A(x)));
    if (x.t === 10) return str(f((x as QVector).v as string));
    if (x.t === 0) return listFrom(items(x).map((e) => strCase(e, up)));
    throw new QError('type');
  }
  const trimFns: Record<string, (s: string) => string> = {
    trim: (s) => s.replace(/^ +| +$/g, ''),
    ltrim: (s) => s.replace(/^ +/, ''),
    rtrim: (s) => s.replace(/ +$/, ''),
  };
  for (const nm of ['trim', 'ltrim', 'rtrim']) {
    def(nm, [1], (ip2, [x]) => {
      const f = trimFns[nm];
      if (x.t === 10) return str(f((x as QVector).v as string));
      if (x.t === -10) return x;
      if (isTable(x)) {
        const t = x as QTable;
        return table(t.c.slice(), t.v.map((c) => ip2.apply(prim(ip2.builtins.get(nm)!), [c])));
      }
      if (isDict(x))
        return dict(
          (x as QDict).k,
          ip2.apply(prim(ip2.builtins.get(nm)!), [(x as QDict).v])
        );
      if (x.t === 0)
        return listFrom(
          items(x).map((e) => ip2.apply(prim(ip2.builtins.get(nm)!), [e]))
        );
      if (isAtom(x)) return x;
      let start = 0;
      let end = count(x);
      if (nm !== 'rtrim')
        while (start < end && isNullValue(x.t, raw(x, start))) start++;
      if (nm !== 'ltrim')
        while (end > start && isNullValue(x.t, raw(x, end - 1))) end--;
      return selectRows(
        x,
        Array.from({ length: end - start }, (_, i) => start + i)
      );
    });
  }

  def('like', [2], (ip2, [x, y]) => {
    if (isDict(x)) return dict((x as QDict).k, ip2.apply(prim(ip2.builtins.get('like')!), [(x as QDict).v, y]));
    const pat = y.t === 10 ? ((y as QVector).v as string) : String(A(y));
    const re = likeToRegex(pat);
    const test = (s: string) => (re.test(s) ? 1 : 0);
    if (x.t === 10) return bool(!!test((x as QVector).v as string));
    if (x.t === -11) return bool(!!test(A(x)));
    if (x.t === 11) return vec(1, symsOf(x).map(test));
    if (x.t === 0) return vec(1, items(x).map((e) => test(e.t === 10 ? ((e as QVector).v as string) : String(A(e)))));
    throw new QError('type');
  });

  function likeToRegex(pat: string): RegExp {
    let out = '^';
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c === '*') out += '[\\s\\S]*';
      else if (c === '?') out += '[\\s\\S]';
      else if (c === '[') {
        let j = i + 1;
        let cls = '';
        while (j < pat.length && pat[j] !== ']') {
          cls += pat[j];
          j++;
        }
        out += '[' + cls + ']';
        i = j;
      } else out += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(out + '$');
  }

  def('ss', [2], (ip2, [x, y]) => {
    const s = (x as QVector).v as string;
    const pat = y.t === 10 ? ((y as QVector).v as string) : String(A(y));
    const out: number[] = [];
    if (/[*?\[]/.test(pat)) {
      const re = new RegExp(likeToRegex(pat).source.slice(1, -1), 'g');
      let m;
      while ((m = re.exec(s)) !== null) {
        out.push(m.index);
        re.lastIndex = m.index + 1;
      }
    } else {
      let i = s.indexOf(pat);
      while (i >= 0) {
        out.push(i);
        i = s.indexOf(pat, i + 1);
      }
    }
    return longvec(out);
  });

  def('ssr', [3], (ip2, [x, y, z]) => {
    const s = (x as QVector).v as string;
    const pat = y.t === 10 ? ((y as QVector).v as string) : String(A(y));
    const rep = z.t === 10 ? ((z as QVector).v as string) : String(A(z));
    if (/[*?\[]/.test(pat)) {
      const re = new RegExp(likeToRegex(pat).source.slice(1, -1), 'g');
      return str(s.replace(re, rep));
    }
    return str(s.split(pat).join(rep));
  });

  def('sv', [2], (ip2, [x, y]) => {
    // ` sv `a`b -> `a.b ;  ` sv strings -> newline-joined
    if (x.t === -11 && A(x) === '') {
      if (y.t === 11 || y.t === -11) return sym(symsOf(y).join('.'));
      return str(items(y).map((e) => (e.t === 10 ? ((e as QVector).v as string) : qToString(e))).join('\n'));
    }
    if (x.t === 10 || x.t === -10) {
      const sep = x.t === 10 ? ((x as QVector).v as string) : A(x);
      const parts = items(y).map((e) => (e.t === 10 ? ((e as QVector).v as string) : qToString(e)));
      return str(parts.join(sep));
    }
    // base decode
    const digits = (): number[] => {
      if (y.t === 0) return items(y).map((e) => numOf(raw(e, 0) ?? A(e)));
      return nums(y);
    };
    if (Math.abs(x.t) === 4) {
      // bytes: the result width follows the number of digits
      const ds = y.t === 0 ? items(y).map((e) => nums(e)) : [nums(y)];
      const dec = (arr: number[]) => arr.reduce((a, b) => a * 256 + b, 0);
      if (y.t === 0) return fromItems(ds.map((arr) => atom(-4, dec(arr) & 255)));
      const arr = nums(y);
      const v = arr.reduce((a, b) => a * 256 + b, 0);
      const n = arr.length;
      if (isAtom(x) && A(x) === 0) {
        if (n <= 1) return atom(-4, v & 255);
        if (n === 2) return atom(-5, (v << 16) >> 16);
        if (n <= 4) return atom(-6, v | 0);
        return long(v);
      }
      return long(v);
    }
    if (Math.abs(x.t) === 1) {
      const arr = nums(y);
      let v = 0;
      for (const b of arr) v = v * 2 + b;
      if (arr.length === 64) {
        // two's complement 64-bit
        let big = 0n;
        for (const b of arr) big = big * 2n + BigInt(b);
        if (big >= 1n << 63n) big -= 1n << 64n;
        return long(Number(big));
      }
      return long(v);
    }
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6 || Math.abs(x.t) === 5)) {
      const base = N(x);
      const arr = digits();
      let acc = 0;
      for (const d of arr) acc = acc * base + d;
      return long(acc);
    }
    if (x.t === 7 || x.t === 6 || x.t === 5) {
      const bases = nums(x);
      const arr = digits();
      let acc = 0;
      for (let i = 0; i < arr.length; i++) acc = acc * (bases[i] ?? 1) + arr[i];
      return long(acc);
    }
    throw new QError('type');
  });

  def('vs', [2], (ip2, [x, y]) => {
    if (x.t === 10 || x.t === -10) {
      const sep = x.t === 10 ? ((x as QVector).v as string) : A(x);
      const s2 = y.t === 10 ? ((y as QVector).v as string) : qToString(y);
      return listFrom(s2.split(sep).map((p2) => str(p2)));
    }
    if (x.t === -11 && A(x) === '') {
      if (y.t === -11) return symvec(String(A(y)).split('.'));
      const s2 = y.t === 10 ? ((y as QVector).v as string) : qToString(y);
      return listFrom(s2.split('\n').map((p2) => str(p2)));
    }
    if (Math.abs(x.t) === 4) {
      // encode into bytes, width from the value's type
      const one = (v: number, t: number): number[] => {
        const width = t === 5 ? 2 : t === 6 || t === 14 || t === 19 ? 4 : t === 4 ? 1 : 8;
        const out: number[] = new Array(width);
        let bi = BigInt(Math.trunc(v));
        if (bi < 0n) bi += 1n << BigInt(8 * width);
        for (let i = width - 1; i >= 0; i--) {
          out[i] = Number(bi & 255n);
          bi >>= 8n;
        }
        return out;
      };
      if (isAtom(y)) return typedVec(4, one(N(y), Math.abs(y.t)));
      return listFrom(items(y).map((e) => typedVec(4, one(N(e), Math.abs(e.t)))));
    }
    if (Math.abs(x.t) === 1) {
      const one = (v: number, t: number): number[] => {
        const width = t === 5 ? 16 : t === 6 ? 32 : t === 4 ? 8 : 64;
        const out: number[] = new Array(width);
        let bi = BigInt(Math.trunc(v));
        if (bi < 0n) bi += 1n << BigInt(width);
        for (let i = width - 1; i >= 0; i--) {
          out[i] = Number(bi & 1n);
          bi >>= 1n;
        }
        return out;
      };
      if (isAtom(y)) return typedVec(1, one(N(y), Math.abs(y.t)));
      return listFrom(items(y).map((e) => typedVec(1, one(N(e), Math.abs(e.t)))));
    }
    if (isAtom(x) && (Math.abs(x.t) === 7 || Math.abs(x.t) === 6)) {
      const base = N(x);
      const enc = (n0: number): number[] => {
        let v = Math.trunc(n0);
        const out: number[] = [];
        while (v > 0) {
          out.unshift(v % base);
          v = Math.floor(v / base);
        }
        return out.length ? out : [0];
      };
      if (isAtom(y)) return longvec(enc(N(y)));
      return listFrom(items(y).map((e) => longvec(enc(N(e)))));
    }
    if (x.t === 7 || x.t === 6 || x.t === 5) {
      const bases = nums(x);
      const enc = (n0: number): number[] => {
        let v = Math.trunc(n0);
        const out = new Array(bases.length).fill(0);
        for (let i = bases.length - 1; i >= 0; i--) {
          const b = bases[i];
          if (!b) {
            out[i] = v;
            v = 0;
          } else {
            out[i] = ((v % b) + b) % b;
            v = Math.floor(v / b);
          }
        }
        return out;
      };
      if (isAtom(y)) return longvec(enc(N(y)));
      return listFrom(items(y).map((e) => longvec(enc(N(e)))));
    }
    throw new QError('type');
  });

  // ---------------------------------------------------------------- tables

  function unkey(kt: QDict): QTable {
    const k = kt.k as QTable,
      v = kt.v as QTable;
    return table([...k.c, ...v.c], [...k.v, ...v.v]);
  }

  function xkey(ip2: Interp, x: QValue, y: QValue): QValue {
    const cols = symsOf(x);
    const t = isKeyedTable(y) ? unkey(y as QDict) : (y as QTable);
    const keyIdx = cols.map((c) => {
      const i = t.c.indexOf(c);
      if (i < 0) throw new QError(c);
      return i;
    });
    const valIdx = t.c.map((_, i) => i).filter((i) => !keyIdx.includes(i));
    return dict(
      table(keyIdx.map((i) => t.c[i]), keyIdx.map((i) => t.v[i])),
      table(valIdx.map((i) => t.c[i]), valIdx.map((i) => t.v[i]))
    );
  }
  def('xkey', [2], (ip2, [x, y]) => xkey(ip2, x, y));
  def('keys', [1], (ip2, [x]) => (isKeyedTable(x) ? symvec(((x as QDict).k as QTable).c.slice()) : symvec([])));
  def('cols', [1], (ip2, [x]) => {
    if (isKeyedTable(x)) return symvec(unkey(x as QDict).c.slice());
    if (isTable(x)) return symvec((x as QTable).c.slice());
    if (isDict(x)) return (x as QDict).k;
    throw new QError('type');
  });
  def('xcol', [2], (ip2, [x, y]) => {
    const names = symsOf(x);
    const t = y as QTable;
    const c = t.c.slice();
    names.forEach((nm, i) => {
      if (i < c.length) c[i] = nm;
    });
    return table(c, t.v.slice());
  });
  def('xcols', [2], (ip2, [x, y]) => {
    const names = symsOf(x);
    const t = isKeyedTable(y) ? unkey(y as QDict) : (y as QTable);
    const rest = t.c.filter((c) => !names.includes(c));
    const order = [...names, ...rest];
    return table(order, order.map((c) => t.v[t.c.indexOf(c)]));
  });
  def('meta', [1], (ip2, [x]) => {
    const kt = isKeyedTable(x);
    const t = kt ? unkey(x as QDict) : (x as QTable);
    const keyCols = kt ? ((x as QDict).k as QTable).c : [];
    const types = t.v.map((c) => {
      const tc = TYPE_CHAR[Math.abs(c.t)] ?? ' ';
      return c.t < 0 ? tc.toUpperCase() : c.t === 0 ? ' ' : tc;
    });
    return dict(
      table(['c'], [symvec(t.c.slice())]),
      table(
        ['t', 'f', 'a'],
        [
          str(types.join('')),
          symvec(t.c.map(() => '')),
          symvec(t.c.map((c, i) => (keyCols.includes(c) ? 's' : ((t.v[i] as QVector).a ?? '')))),
        ]
      )
    );
  });

  def('insert', [2], (ip2, [x, y]) => {
    const name = A(x) as string;
    const cur = ip2.globals.get(name);
    if (!cur || !(isTable(cur) || isKeyedTable(cur))) throw new QError('type');
    const flat = isKeyedTable(cur) ? unkey(cur as QDict) : (cur as QTable);
    const row = isDict(y) && !isTable(y)
      ? tableFromRow(y as QDict)
      : isTable(y)
      ? (y as QTable)
      : rowFromList(flat, y);
    const merged = join(ip2, flat, row);
    const before = count(cur);
    const after = count(merged);
    const res = isKeyedTable(cur)
      ? xkey(ip2, symvec(((cur as QDict).k as QTable).c), merged)
      : merged;
    ip2.globals.set(name, res);
    const idx: number[] = [];
    for (let i = before; i < after; i++) idx.push(i);
    return idx.length === 1 ? long(idx[0]) : longvec(idx);
  });

  function rowFromList(t: QTable, y: QValue): QTable {
    const vals = items(y);
    return table(t.c.slice(), vals.map((v) => (isAtom(v) ? enlist(v) : v)));
  }

  def('upsert', [2], (ip2, [x, y]) => {
    let target: QValue;
    let name: string | null = null;
    if (x.t === -11) {
      name = A(x);
      target = ip2.resolve(name!, { locals: null });
    } else target = x;
    let result: QValue;
    if (isKeyedTable(target)) {
      const row = isTable(y) ? (y as QTable) : isDict(y) ? tableFromRow(y as QDict) : rowFromList(unkey(target as QDict), y);
      result = upsertKeyed(ip2, target as QDict, xkey(ip2, symvec(((target as QDict).k as QTable).c), row) as QDict);
    } else {
      const row = isTable(y) ? (y as QTable) : isDict(y) ? tableFromRow(y as QDict) : rowFromList(target as QTable, y);
      result = join(ip2, target, row);
    }
    if (name) {
      ip2.globals.set(name, result);
      return sym(name);
    }
    return result;
  });

  function upsertKeyed(ip2: Interp, x: QDict, y: QDict): QValue {
    const xk = x.k as QTable,
      xv = x.v as QTable;
    const yk = y.k as QTable,
      yv = y.v as QTable;
    let keys = items(xk).map(keyStr);
    let kRows = items(xk);
    let vRows = items(xv);
    const yKeys = items(yk);
    const yVals = items(yv);
    yKeys.forEach((k, i) => {
      const ks = keyStr(k);
      const ix = keys.indexOf(ks);
      if (ix < 0) {
        keys.push(ks);
        kRows.push(k);
        vRows.push(yVals[i]);
      } else {
        vRows[ix] = yVals[i];
      }
    });
    return dict(rowsToTable(xk.c, kRows), rowsToTable(xv.c, vRows));
  }

  function rowsToTable(cols: string[], rows: QValue[]): QTable {
    return table(
      cols,
      cols.map((c) => fromItems(rows.map((r) => ip.index1(r, sym(c)))))
    );
  }

  def('ungroup', [1], (ip2, [x]) => {
    const t = (isKeyedTable(x) ? unkey(x as QDict) : x) as QTable;
    const n = count(t);
    const nestedIdx = t.v.map((c, i) => (c.t === 0 ? i : -1)).filter((i) => i >= 0);
    if (!nestedIdx.length) return t;
    const rows: number[] = [];
    const subIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const m = count(at(t.v[nestedIdx[0]], i));
      for (let j = 0; j < m; j++) {
        rows.push(i);
        subIdx.push(j);
      }
    }
    return table(
      t.c.slice(),
      t.v.map((c, ci) => {
        if (nestedIdx.includes(ci)) {
          return fromItems(rows.map((r, k) => at(at(c, r), subIdx[k])));
        }
        return selectRows(c, rows);
      })
    );
  });

  def('xgroup', [2], (ip2, [x, y]) => {
    const cols = symsOf(x);
    const t = (isKeyedTable(y) ? unkey(y as QDict) : y) as QTable;
    const n = count(t);
    const map = new Map<string, number[]>();
    const order: string[] = [];
    for (let i = 0; i < n; i++) {
      const k = cols.map((c) => keyStr(at(t.v[t.c.indexOf(c)], i))).join('\u0001');
      if (!map.has(k)) {
        map.set(k, []);
        order.push(k);
      }
      map.get(k)!.push(i);
    }
    const keyT = table(
      cols,
      cols.map((c) => fromItems(order.map((k) => at(t.v[t.c.indexOf(c)], map.get(k)![0]))))
    );
    const restCols = t.c.filter((c) => !cols.includes(c));
    const valT = table(
      restCols,
      restCols.map((c) => listFrom(order.map((k) => selectRows(t.v[t.c.indexOf(c)], map.get(k)!))))
    );
    return dict(keyT, valT);
  });

  // joins
  def('lj', [2], (ip2, [x, y]) => leftJoin(ip2, x as QTable, y as QDict));
  def('ij', [2], (ip2, [x, y]) => innerJoin(ip2, x as QTable, y as QDict));
  def('uj', [2], (ip2, [x, y]) => join(ip2, x, y));
  def('pj', [2], (ip2, [x, y]) => leftJoin(ip2, x as QTable, y as QDict, true));

  function leftJoin(ip2: Interp, x: QTable, y: QDict, plus = false): QValue {
    if (!isKeyedTable(y)) throw new QError('type', 'lj needs a keyed table on the right');
    const keyT = y.k as QTable;
    const valT = y.v as QTable;
    const n = count(x);
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
      const wanted = keyT.c.map((c) => at(x.v[x.c.indexOf(c)], i));
      let found = -1;
      const m = count(keyT);
      for (let r = 0; r < m; r++) {
        let ok = true;
        for (let ci = 0; ci < keyT.c.length; ci++)
          if (!matchValues(at(keyT.v[ci], r), wanted[ci])) {
            ok = false;
            break;
          }
        if (ok) {
          found = r;
          break;
        }
      }
      rows.push(found);
    }
    const cols = [...x.c];
    const vals = [...x.v];
    valT.c.forEach((c, ci) => {
      const newCol = fromItems(
        rows.map((r) => (r < 0 ? nullLike(valT.v[ci]) : at(valT.v[ci], r)))
      );
      const ix = cols.indexOf(c);
      if (ix < 0) {
        cols.push(c);
        vals.push(newCol);
      } else if (plus) {
        vals[ix] = atomic2(ip2, vals[ix], newCol, addSpec as any);
      } else {
        vals[ix] = fromItems(
          rows.map((r, i) => (r < 0 ? at(vals[ix], i) : at(valT.v[ci], r)))
        );
      }
    });
    return table(cols, vals);
  }

  function innerJoin(ip2: Interp, x: QTable, y: QDict): QValue {
    const keyT = y.k as QTable;
    const valT = y.v as QTable;
    const n = count(x);
    const keep: number[] = [];
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
      const wanted = keyT.c.map((c) => at(x.v[x.c.indexOf(c)], i));
      const m = count(keyT);
      for (let r = 0; r < m; r++) {
        let ok = true;
        for (let ci = 0; ci < keyT.c.length; ci++)
          if (!matchValues(at(keyT.v[ci], r), wanted[ci])) {
            ok = false;
            break;
          }
        if (ok) {
          keep.push(i);
          rows.push(r);
          break;
        }
      }
    }
    const cols = [...x.c];
    const vals = x.v.map((c) => selectRows(c, keep));
    valT.c.forEach((c, ci) => {
      const newCol = fromItems(rows.map((r) => at(valT.v[ci], r)));
      const ix = cols.indexOf(c);
      if (ix < 0) {
        cols.push(c);
        vals.push(newCol);
      } else vals[ix] = newCol;
    });
    return table(cols, vals);
  }

  def('aj', [3], (ip2, [x, y, z]) => asofJoin(ip2, symsOf(x), y as QTable, z as QTable));
  function asofJoin(ip2: Interp, cols: string[], x: QTable, y: QTable): QValue {
    const matchCols = cols.slice(0, -1);
    const timeCol = cols[cols.length - 1];
    const n = count(x);
    const m = count(y);
    const outCols = [...x.c];
    const outVals: QValue[] = x.v.map((c) => c);
    const extra = y.c.filter((c) => !cols.includes(c));
    const rows: number[] = [];
    for (let i = 0; i < n; i++) {
      let best = -1;
      for (let r = 0; r < m; r++) {
        let ok = true;
        for (const c of matchCols) {
          if (!matchValues(at(y.v[y.c.indexOf(c)], r), at(x.v[x.c.indexOf(c)], i))) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        if (compareAny(at(y.v[y.c.indexOf(timeCol)], r), at(x.v[x.c.indexOf(timeCol)], i)) <= 0) best = r;
      }
      rows.push(best);
    }
    for (const c of extra) {
      const ci = y.c.indexOf(c);
      const col = fromItems(rows.map((r) => (r < 0 ? nullLike(y.v[ci]) : at(y.v[ci], r))));
      const ix = outCols.indexOf(c);
      if (ix < 0) {
        outCols.push(c);
        outVals.push(col);
      } else outVals[ix] = col;
    }
    return table(outCols, outVals);
  }

  def('fby', [2], (ip2, [x, y]) => {
    // x is (aggregate;data), y is the grouping vector
    const f = at(x, 0);
    const data = at(x, 1);
    const g = group(ip2, y) as QDict;
    const n = count(y);
    const out: QValue[] = new Array(n);
    const gk = items(g.k);
    const gv = items(g.v);
    gk.forEach((_, i) => {
      const idx = rawArray(gv[i]) as number[];
      const sub = selectRows(data, idx);
      const val = ip2.apply(f, [sub]);
      idx.forEach((r) => (out[r] = val));
    });
    return fromItems(out);
  });

  // ---------------------------------------------------------------- iteration keywords

  def('each', [2], (ip2, [f, x]) => ip2.each(f, [x]));
  def('peach', [2], (ip2, [f, x]) => ip2.each(f, [x]));
  def('over', [2, 3], (ip2, a) => ip2.over(a[0], a.slice(1), false));
  def('scan', [2, 3], (ip2, a) => ip2.over(a[0], a.slice(1), true));
  def('prior', [2], (ip2, [f, x]) => ip2.eachPrior(f, [x], false));

  // ---------------------------------------------------------------- system-ish

  for (const adv of ["'", '/', '\\', "':", '/:', '\\:']) {
    def(adv, [1, 2], (ip2, a) => {
      if (a.length === 1) return ip2.makeIter(adv, a[0]);
      if (adv === "'") {
        // '[f;g] composes a unary f with g
        const [f, g] = a;
        return { t: 105, fns: [f, g] } as any;
      }
      return ip2.apply(ip2.makeIter(adv, a[0]), [a[1]]);
    });
  }

  def('show', [1], (ip2, [x]) => {
    ip2.out(display(x, ip2.fmt as any));
    return UNIT;
  });
  def('eval', [1], (ip2, [x]) => {
    if (x.t === 10) return ip2.run((x as QVector).v as string);
    if (x.t === 11 && count(x) === 1) return evalTree(ip2, at(x, 0), null);
    if (x.t === 0 || x.t === -11) return evalTree(ip2, x, null);
    return x;
  });
  def('parse', [1], (ip2, [x]) => {
    const src = x.t === 10 ? ((x as QVector).v as string) : String(A(x));
    const stmts = parseQ(src);
    if (!stmts.length) return UNIT;
    if (stmts.length === 1) return astToTree(ip2, stmts[0]);
    return listFrom(stmts.map((st) => astToTree(ip2, st)));
  });
  def('set', [2], (ip2, [x, y]) => {
    ip2.globals.set(String(A(x)), y);
    return x;
  });
  def('attr', [1], (ip2, [x]) => sym((x as QVector).a ?? ''));
  def('tables', [1], (ip2, [x]) => {
    const out: string[] = [];
    for (const [k, v] of ip2.globals) if (isTable(v) || isKeyedTable(v)) out.push(k);
    return symvec(out.sort());
  });
  ip.globals.set('csv', char(','));

  def('system', [1], (ip2, [x]) => {
    const cmd = ((x as QVector).v as string).trim();
    if (cmd.startsWith('S')) {
      ip2.seed = parseInt(cmd.slice(1).trim(), 10) >>> 0 || 1;
      return UNIT;
    }
    return UNIT;
  });

  def('cast', [2], (ip2, [x, y]) => castValue(ip2, x, y));

  // helpers used by the evaluator and the p5 bridge
  (ip as any).castTo = castTo;
  (ip as any).temporalPart = (nm: string, y: QValue) =>
    EXTRACTORS[nm] ? export_extract(nm, y) : null;
  (ip as any).castByName = (nm: string, y: QValue) => castTo(typeNumFromName(nm), y);
  (ip as any).joinValues = (x: QValue, y: QValue) => join(ip, x, y);
  (ip as any).groupValues = (x: QValue) => group(ip, x);
}

// deterministic PRNG so sketches and tests are reproducible
function ip2Rand(ip: Interp): number {
  let t = (ip.seed = (ip.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
