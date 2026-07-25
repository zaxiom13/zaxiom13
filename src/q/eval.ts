// Evaluator.

import { Node, ColSpec, parse } from './parser';
import {
  QError,
  QValue,
  QAtom,
  QVector,
  QDict,
  QTable,
  QLambda,
  QPrim,
  QProj,
  QComp,
  QIter,
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
  isAtom,
  isTable,
  isDict,
  isFunc,
  isKeyedTable,
  TYPE_NAME,
  matchValues,
  nullAtomOf,
  nullValue,
  isNullValue,
  symvec,
  sym,
  long,
  longvec,
  bool,
  str,
  NIL,
  UNIT,
  err,
  rawArray,
  enlist,
  shallowClone,
  first,
} from './value';

export class ReturnSignal {
  constructor(public v: QValue) {}
}

export interface Frame {
  locals: Map<string, QValue> | null;
}

export type BuiltinFn = (ip: Interp, args: QValue[]) => QValue;

export interface Builtin {
  name: string;
  ranks: number[];
  f: BuiltinFn;
  doc?: string;
  sig?: string;
  ex?: string[];
}

export function prim(b: Builtin): QPrim {
  return {
    t: b.ranks.length === 1 && b.ranks[0] === 1 ? 101 : 102,
    name: b.name,
    rank: b.ranks,
    f: b.f as any,
  } as QPrim;
}

export class Interp {
  globals = new Map<string, QValue>();
  builtins = new Map<string, Builtin>();
  out: (s: string) => void = () => {};
  seed = 0x2f6e2b1;
  steps = 0;
  stepLimit = 40_000_000;
  trace: { depth: number; src: string; val: QValue }[] | null = null;

  constructor() {}

  def(b: Builtin) {
    this.builtins.set(b.name, b);
    this.globals.set(b.name, prim(b));
  }

  lookup(name: string): QValue | undefined {
    return this.globals.get(name);
  }

  /** Run source, returning the value of the last statement. */
  run(src: string): QValue {
    const stmts = parse(src);
    let v: QValue = UNIT;
    try {
      for (const s of stmts) v = this.evalNode(s, { locals: null });
    } catch (e) {
      if (e instanceof ReturnSignal) return e.v;
      throw e;
    }
    return v;
  }

  /** Run source, returning every statement's value (for the console). */
  runAll(src: string): { node: Node; value: QValue }[] {
    const stmts = parse(src);
    const out: { node: Node; value: QValue }[] = [];
    for (const s of stmts) {
      try {
        out.push({ node: s, value: this.evalNode(s, { locals: null }) });
      } catch (e) {
        if (e instanceof ReturnSignal) out.push({ node: s, value: e.v });
        else throw e;
      }
    }
    return out;
  }

  tick() {
    if (++this.steps > this.stepLimit) {
      this.steps = 0;
      throw new QError('stop', 'Execution limit reached - possible infinite loop.');
    }
  }

  // -------------------------------------------------------------- evaluation

  evalNode(n: Node, f: Frame): QValue {
    this.tick();
    switch (n.k) {
      case 'lit':
        return n.v;
      case 'nil':
        return UNIT;
      case 'name':
        return this.resolve(n.n, f, n.i);
      case 'verb':
        return this.verbValue(n.n, n.i);
      case 'adv':
        return this.makeIter(n.adv, this.evalNode(n.f, f));
      case 'seq':
        return this.evalSeq(n, f);
      case 'listlit': {
        const xs = n.xs.map((x) => this.evalNode(x, f));
        return fromItems(xs);
      }
      case 'exprs': {
        let v: QValue = UNIT;
        for (const x of n.xs) v = this.evalNode(x, f);
        return v;
      }
      case 'call':
        return this.evalCall(n, f);
      case 'lambda':
        return {
          t: 100,
          params: n.params,
          body: n.body,
          src: n.src,
        } as QLambda;
      case 'assign':
        return this.evalAssign(n, f);
      case 'cond':
        return this.evalCond(n.xs, f);
      case 'ctrl':
        return this.evalCtrl(n, f);
      case 'ret':
        throw new ReturnSignal(n.v ? this.evalNode(n.v, f) : UNIT);
      case 'sig': {
        const v = this.evalNode(n.v, f);
        const msg = v.t === -11 ? (v as QAtom).v : v.t === 10 ? (v as QVector).v : 'error';
        throw new QError(msg);
      }
      case 'tablit':
        return this.evalTableLit(n, f);
      case 'qsql':
        return this.evalQsql(n, f);
    }
    return err('parse');
  }

  resolve(name: string, f: Frame, pos?: number): QValue {
    if (f.locals && f.locals.has(name)) return f.locals.get(name)!;
    const g = this.globals.get(name);
    if (g !== undefined) return g;
    const dyn = this.dynamic(name);
    if (dyn !== undefined) return dyn;
    const dotted = this.dottedAccess(name, f);
    if (dotted !== undefined) return dotted;
    throw new QError(name, `Undefined name: ${name}`);
  }

  /** time.minute, dict.key, table.col ... */
  dottedAccess(name: string, f: Frame): QValue | undefined {
    const parts = name.split('.');
    if (parts.length < 2) return undefined;
    let base: QValue | undefined;
    let i = 0;
    for (; i < parts.length - 1; i++) {
      const head = parts.slice(0, i + 1).join('.');
      if (f.locals && f.locals.has(head)) {
        base = f.locals.get(head);
        break;
      }
      if (this.globals.has(head)) {
        base = this.globals.get(head);
        break;
      }
    }
    if (base === undefined) return undefined;
    for (let j = i + 1; j < parts.length; j++) {
      const part = parts[j];
      const anyIp = this as any;
      const t = Math.abs(base!.t);
      if (t >= 12 && t <= 19) {
        const tp = anyIp.temporalPart?.(part, base);
        if (tp) {
          base = tp;
          continue;
        }
        try {
          base = anyIp.castByName(part, base);
          continue;
        } catch {
          return undefined;
        }
      }
      try {
        base = this.index1(base!, atom(-11, part));
      } catch {
        return undefined;
      }
    }
    return base;
  }

  dynamicHooks: Record<string, () => QValue> = {};

  dynamic(name: string): QValue | undefined {
    const h = this.dynamicHooks[name];
    if (h) return h();
    return undefined;
  }

  verbValue(op: string, pos?: number): QValue {
    if (op === '::') return UNIT;
    if (op.length === 2 && op[1] === ':') {
      // +: -: #: ... force the monadic (unary) form
      const b0 = this.builtins.get(op[0]);
      if (b0 && b0.ranks.includes(1))
        return { t: 101, name: op, rank: [1], f: b0.f as any } as QPrim;
    }
    const b = this.builtins.get(op);
    if (!b) throw new QError('parse', `Unknown operator ${op}`);
    return prim(b);
  }

  makeIter(adv: string, fn: QValue): QValue {
    const codes: Record<string, 106 | 107 | 108 | 109 | 110 | 111> = {
      "'": 106,
      '/': 107,
      '\\': 108,
      "':": 109,
      '/:': 110,
      '\\:': 111,
    };
    return { t: codes[adv], f: fn, adv } as QIter;
  }

  evalSeq(n: Node & { k: 'seq' }, f: Frame): QValue {
    const xs = n.xs;
    const cache: (QValue | undefined)[] = new Array(xs.length);
    const ev = (i: number) => {
      if (cache[i] === undefined) cache[i] = this.evalNode(xs[i], f);
      return cache[i]!;
    };
    let i = xs.length - 1;
    let val = ev(i);
    i--;
    while (i >= 0) {
      const v = ev(i);
      if (isFunc(v)) {
        // q applies a function infix only when it is (at least) binary and
        // not parenthesised (parentheses make it a noun)
        if (i > 0 && this.rankOf(v) >= 2 && !(xs[i] as any).paren) {
          const lv = ev(i - 1);
          val = this.apply(v, [lv, val]);
          i -= 2;
        } else {
          val = this.apply(v, [val]);
          i--;
        }
      } else if (isFunc(val)) {
        // noun to the left of a function value: a projection, e.g. 2*
        val = { t: 104, f: val, args: [v, null] } as QProj;
        i--;
      } else {
        val = this.apply(v, [val]);
        i--;
      }
    }
    return val;
  }

  evalCall(n: Node & { k: 'call' }, f: Frame): QValue {
    const fn = this.evalNode(n.f, f);
    const args = n.args.map((a) => (a === null ? null : this.evalNode(a, f)));
    if (args.length === 0) {
      if (isFunc(fn)) return this.apply(fn, []);
      return fn;
    }
    return this.applyMaybeProject(fn, args);
  }

  applyMaybeProject(fn: QValue, args: (QValue | null)[]): QValue {
    if (args.some((a) => a === null)) {
      if (!isFunc(fn)) {
        // elided index means "all"
        return this.index(fn, args.map((a) => (a === null ? UNIT : a)));
      }
      return { t: 104, f: fn, args } as QProj;
    }
    return this.apply(fn, args as QValue[]);
  }

  // -------------------------------------------------------------- application

  apply(fn: QValue, args: QValue[]): QValue {
    this.tick();
    switch (fn.t) {
      case 100: {
        const lam = fn as QLambda;
        if (args.length === 1 && args[0].t === -101 && lam.params.length === 0) args = [];
        if (args.length > Math.max(lam.params.length, 1))
          throw new QError('rank', `${lam.src} takes ${lam.params.length} argument(s).`);
        if (args.length < lam.params.length)
          return { t: 104, f: fn, args: padArgs(args, lam.params.length) } as QProj;
        const locals = new Map<string, QValue>();
        if (lam.ctx) for (const k in lam.ctx) locals.set(k, lam.ctx[k]);
        lam.params.forEach((p, ix) => locals.set(p, args[ix] ?? UNIT));
        const frame: Frame = { locals };
        let v: QValue = UNIT;
        try {
          for (const s of lam.body) v = this.evalNode(s, frame);
        } catch (e) {
          if (e instanceof ReturnSignal) return e.v;
          throw e;
        }
        return v;
      }
      case 101:
      case 102: {
        const p = fn as QPrim;
        if (args.length === 1 && args[0].t === -101 && !p.rank.includes(1)) {
          return fn;
        }
        if (!p.rank.includes(args.length)) {
          if (args.length < Math.min(...p.rank))
            return { t: 104, f: fn, args: padArgs(args, Math.min(...p.rank)) } as QProj;
          throw new QError('rank', `${p.name} cannot be applied to ${args.length} argument(s).`);
        }
        return (p.f as any)(this, args);
      }
      case 104: {
        const pr = fn as QProj;
        const filled: (QValue | null)[] = [];
        let ai = 0;
        for (const a of pr.args) {
          if (a === null) filled.push(ai < args.length ? args[ai++] : null);
          else filled.push(a);
        }
        while (ai < args.length) filled.push(args[ai++]);
        if (filled.some((x) => x === null)) return { t: 104, f: pr.f, args: filled } as QProj;
        return this.apply(pr.f, filled as QValue[]);
      }
      case 105: {
        const c = fn as QComp;
        let v = this.apply(c.fns[c.fns.length - 1], args);
        for (let i = c.fns.length - 2; i >= 0; i--) v = this.apply(c.fns[i], [v]);
        return v;
      }
      case 106:
      case 107:
      case 108:
      case 109:
      case 110:
      case 111:
        return this.applyIter(fn as QIter, args);
      default:
        if (fn.t === -11) {
          // a symbol names a function: `f[1;2]
          const target = this.resolve((fn as QAtom).v, { locals: null });
          if (isFunc(target)) return this.apply(target, args);
          return this.index(target, args);
        }
        return this.index(fn, args);
    }
  }

  call1(f: QValue, x: QValue): QValue {
    return this.apply(f, [x]);
  }
  call2(f: QValue, x: QValue, y: QValue): QValue {
    return this.apply(f, [x, y]);
  }

  /** rank of a function value (best effort) */
  rankOf(f: QValue): number {
    switch (f.t) {
      case 100:
        return (f as QLambda).params.length || 1;
      case 101:
        return 1;
      case 102:
        return 2;
      case 104: {
        const p = f as QProj;
        return p.args.filter((a) => a === null).length || 1;
      }
      case 105:
        return this.rankOf((f as QComp).fns[(f as QComp).fns.length - 1]);
      case 106:
      case 107:
      case 108:
      case 109:
      case 110:
      case 111:
        // derived functions are ambivalent; q allows infix application
        return 2;
      default:
        return 1;
    }
  }

  // -------------------------------------------------------------- iterators

  applyIter(it: QIter, args: QValue[]): QValue {
    const f = it.f;
    switch (it.adv) {
      case "'":
        return this.each(f, args);
      case '/':
        return this.over(f, args, false);
      case '\\':
        return this.over(f, args, true);
      case "':":
        return this.eachPrior(f, args, false);
      case '/:':
        return this.eachRight(f, args);
      case '\\:':
        return this.eachLeft(f, args);
    }
    return err('adverb');
  }

  each(f: QValue, args: QValue[]): QValue {
    if (args.length === 1) {
      const x = args[0];
      if (isAtom(x) || isFunc(x)) return this.apply(f, [x]);
      const n = count(x);
      const out: QValue[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = this.apply(f, [at(x, i)]);
      if (isDict(x)) return dict((x as QDict).k, fromItems(out));
      return fromItems(out);
    }
    // each-both / general each over conforming arguments
    let n = -1;
    for (const a of args) {
      if (!isAtom(a) && !isFunc(a)) {
        const c = count(a);
        if (n === -1) n = c;
        else if (n !== c) throw new QError('length', 'each: arguments must conform');
      }
    }
    if (n === -1) return this.apply(f, args);
    const out: QValue[] = new Array(n);
    for (let i = 0; i < n; i++) {
      out[i] = this.apply(
        f,
        args.map((a) => (isAtom(a) || isFunc(a) ? a : at(a, i)))
      );
    }
    return fromItems(out);
  }

  eachLeft(f: QValue, args: QValue[]): QValue {
    const [x, y] = args;
    const n = isAtom(x) ? 1 : count(x);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(this.apply(f, [isAtom(x) ? x : at(x, i), y]));
    return isAtom(x) ? out[0] : fromItems(out);
  }

  eachRight(f: QValue, args: QValue[]): QValue {
    const [x, y] = args;
    const n = isAtom(y) ? 1 : count(y);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) out.push(this.apply(f, [x, isAtom(y) ? y : at(y, i)]));
    return isAtom(y) ? out[0] : fromItems(out);
  }

  eachPrior(f: QValue, args: QValue[], scan: boolean): QValue {
    let x: QValue;
    let seed: QValue | null = null;
    if (args.length === 2) {
      seed = args[0];
      x = args[1];
    } else x = args[0];
    const n = count(x);
    const out: QValue[] = [];
    for (let i = 0; i < n; i++) {
      const cur = at(x, i);
      const prev = i === 0 ? seed : at(x, i - 1);
      out.push(prev === null ? nullAtomOf(cur.t) : this.apply(f, [cur, prev]));
    }
    if (n === 0) return isAtom(x) ? x : fromItems([]);
    return fromItems(out);
  }

  over(f: QValue, args: QValue[], scan: boolean): QValue {
    const rank = this.rankOf(f);
    if (args.length === 1) {
      const x = args[0];
      if (rank >= 2) {
        // reduce
        const n = count(x);
        if (isAtom(x)) return x;
        if (n === 0) return this.reduceIdentity(f, x);
        const ident = this.reduceIdentity(f, x, true);
        if (ident) {
          let acc2 = ident;
          const outs2: QValue[] = [];
          for (let i = 0; i < n; i++) {
            acc2 = this.apply(f, [acc2, at(x, i)]);
            if (scan) outs2.push(acc2);
          }
          return scan ? fromItems(outs2) : acc2;
        }
        let acc = at(x, 0);
        const outs: QValue[] = scan ? [acc] : [];
        for (let i = 1; i < n; i++) {
          acc = this.apply(f, [acc, at(x, i)]);
          if (scan) outs.push(acc);
        }
        return scan ? fromItems(outs) : acc;
      }
      // converge
      let cur = x;
      const outs: QValue[] = scan ? [cur] : [];
      const seen: QValue[] = [x];
      for (let i = 0; i < 10000; i++) {
        const nx = this.apply(f, [cur]);
        if (matchValues(nx, cur) || matchValues(nx, seen[0])) break;
        cur = nx;
        if (scan) outs.push(cur);
        this.tick();
      }
      return scan ? fromItems(outs) : cur;
    }
    if (args.length === 2) {
      const [a, x] = args;
      if (rank >= 2 && !(isAtom(a) && (a.t === -7 || a.t === -6) && false)) {
        // n f/ x  (do) when left is an int and f is monadic handled below
      }
      if (rank === 1) {
        if (a.t === -7 || a.t === -6 || a.t === -5) {
          // do: apply f n times, the scan keeps the starting value
          let cur = x;
          const outs: QValue[] = [cur];
          const n = (a as QAtom).v as number;
          for (let i = 0; i < n; i++) {
            cur = this.apply(f, [cur]);
            if (scan) outs.push(cur);
            this.tick();
          }
          return scan ? fromItems(outs) : cur;
        }
        if (isFunc(a)) {
          // while: keep applying f while the predicate holds
          let cur = x;
          const outs: QValue[] = [cur];
          for (let i = 0; i < 1000000; i++) {
            const c = this.apply(a, [cur]);
            if (!truthy(c)) break;
            cur = this.apply(f, [cur]);
            if (scan) outs.push(cur);
            this.tick();
          }
          return scan ? fromItems(outs) : cur;
        }
      }
      // fold with initial value
      const n = count(x);
      let acc = a;
      const outs: QValue[] = [];
      if (isAtom(x)) {
        acc = this.apply(f, [acc, x]);
        return scan ? acc : acc;
      }
      for (let i = 0; i < n; i++) {
        acc = this.apply(f, [acc, at(x, i)]);
        if (scan) outs.push(acc);
      }
      return scan ? fromItems(outs) : acc;
    }
    // multi-arg over: f/[x;y;z]
    const acc0 = args[0];
    const rest = args.slice(1);
    let n = -1;
    for (const r of rest) if (!isAtom(r)) n = n === -1 ? count(r) : Math.min(n, count(r));
    if (n === -1) n = 1;
    let acc = acc0;
    const outs: QValue[] = [];
    for (let i = 0; i < n; i++) {
      acc = this.apply(f, [acc, ...rest.map((r) => (isAtom(r) ? r : at(r, i)))]);
      if (scan) outs.push(acc);
    }
    return scan ? fromItems(outs) : acc;
  }

  /**
   * The identity element of a reduction. `seedOnly` asks for an element that
   * must seed the fold (join is the only one), otherwise the value returned
   * for an empty argument.
   */
  reduceIdentity(f: QValue, x?: QValue, seedOnly = false): QValue | null {
    const nm = f.t === 101 || f.t === 102 ? (f as QPrim).name : null;
    if (nm === ',') return NIL;
    if (seedOnly) return null;
    if (nm === '+' || nm === '-') return long(0);
    if (nm === '*' || nm === '%') return long(1);
    if (nm === '|') return long(0);
    if (nm === '&') return long(1);
    if (nm === null) return x ?? NIL; // lambdas: an empty argument passes through
    return long(0);
  }

  // -------------------------------------------------------------- indexing

  index(x: QValue, idx: QValue[]): QValue {
    if (idx.length === 0) return x;
    const [i, ...rest] = idx;
    let v = this.index1(x, i);
    if (rest.length) {
      if (isAtom(i) || i.t === -101) {
        if (i.t === -101) {
          // all: distribute over items
          const n = count(x);
          const out: QValue[] = [];
          for (let j = 0; j < n; j++) out.push(this.index(at(x, j), rest));
          return fromItems(out);
        }
        return this.index(v, rest);
      }
      const n = count(v);
      const out: QValue[] = [];
      for (let j = 0; j < n; j++) out.push(this.index(at(v, j), rest));
      return fromItems(out);
    }
    return v;
  }

  index1(x: QValue, i: QValue): QValue {
    if (i.t === -101) return x;
    if (isFunc(x)) return this.apply(x, [i]);
    if (isDict(i) && !isKeyedTable(i) && !isDict(x) && !isTable(x)) {
      const di = i as QDict;
      return dict(di.k, this.index1(x, di.v));
    }
    if (isKeyedTable(x)) {
      const kt = x as QDict;
      const keyT = kt.k as QTable;
      const rows = this.findRows(keyT, i);
      return this.index1(kt.v, rows);
    }
    if (isDict(x)) {
      const d = x as QDict;
      if (isAtom(i) || i.t === 10) {
        const ix = this.findIndex(d.k, i);
        if (ix < 0) return nullLike(d.v);
        return at(d.v, ix);
      }
      const n = count(i);
      const out: QValue[] = [];
      for (let j = 0; j < n; j++) out.push(this.index1(d, at(i, j)));
      return fromItems(out);
    }
    if (isTable(x)) {
      const t = x as QTable;
      if (i.t === -11) {
        const ci = t.c.indexOf((i as QAtom).v);
        if (ci < 0) throw new QError((i as QAtom).v, `No column named ${(i as QAtom).v}`);
        return t.v[ci];
      }
      if (i.t === 11) {
        const cols = (i as QVector).v as string[];
        return table(
          cols.slice(),
          cols.map((c) => {
            const ci = t.c.indexOf(c);
            if (ci < 0) throw new QError(c, `No column named ${c}`);
            return t.v[ci];
          })
        );
      }
      if (isAtom(i)) return at(t, (i as QAtom).v as number);
      const n = count(i);
      const idxs = rawArray(i) as number[];
      return table(
        t.c.slice(),
        t.v.map((col) => this.index1(col, i))
      );
    }
    if (isAtom(x)) {
      if (isAtom(i) && (i as QAtom).v === 0) return x;
      throw new QError('type', 'Cannot index an atom.');
    }
    // vector / list
    if (isAtom(i)) {
      const n = count(x);
      let ix = (i as QAtom).v as number;
      if (typeof ix !== 'number' || !Number.isFinite(ix)) throw new QError('type');
      if (ix < 0 || ix >= n) return nullLike(x);
      return at(x, ix);
    }
    const n = count(i);
    const out: QValue[] = new Array(n);
    for (let j = 0; j < n; j++) out[j] = this.index1(x, at(i, j));
    if (i.t === 0 || i.t === 7 || i.t === 6 || i.t === 5 || i.t === 1) return fromItems(out);
    return fromItems(out);
  }

  findIndex(keys: QValue, key: QValue): number {
    const n = count(keys);
    for (let i = 0; i < n; i++) if (matchValues(at(keys, i), key)) return i;
    return -1;
  }

  findRows(keyT: QTable, i: QValue): QValue {
    // i is a dict/row or table of key values
    const rowsOf = (rowDict: QDict): number => {
      const n = count(keyT);
      outer: for (let r = 0; r < n; r++) {
        for (let c = 0; c < keyT.c.length; c++) {
          const kv = at(keyT.v[c], r);
          const want = this.index1(rowDict, sym(keyT.c[c]));
          if (!matchValues(kv, want)) continue outer;
        }
        return r;
      }
      return -1;
    };
    if (isDict(i) && !isTable((i as QDict).v)) {
      const r = rowsOf(i as QDict);
      return long(r < 0 ? count(keyT) : r);
    }
    if (isTable(i)) {
      const n = count(i);
      const out: number[] = [];
      for (let r = 0; r < n; r++) {
        const rr = rowsOf(at(i, r) as QDict);
        out.push(rr < 0 ? count(keyT) : rr);
      }
      return longvec(out);
    }
    // single value against single key column
    if (keyT.c.length === 1) {
      const ix = this.findIndex(keyT.v[0], i);
      if (isAtom(i)) return long(ix < 0 ? count(keyT) : ix);
      const n = count(i);
      const out: number[] = [];
      for (let r = 0; r < n; r++) {
        const j = this.findIndex(keyT.v[0], at(i, r));
        out.push(j < 0 ? count(keyT) : j);
      }
      return longvec(out);
    }
    throw new QError('type', 'Bad key for keyed table.');
  }

  // -------------------------------------------------------------- assignment

  evalAssign(n: Node & { k: 'assign' }, f: Frame): QValue {
    const isLocal = !!f.locals && !n.global && !n.name.includes('.') && f.locals.has(n.name);
    const declareLocal = !!f.locals && !n.global && !n.name.includes('.');
    let value = this.evalNode(n.v, f);

    if (n.idx === null) {
      if (n.op) {
        const cur = this.resolve(n.name, f, n.i);
        value = this.apply(this.verbValue(n.op), [cur, value]);
      }
      if (declareLocal) f.locals!.set(n.name, value);
      else this.globals.set(n.name, value);
      return value;
    }
    // indexed amend
    const idx = n.idx.map((a) => (a === null ? UNIT : this.evalNode(a, f)));
    const container = declareLocal && f.locals!.has(n.name)
      ? f.locals!.get(n.name)!
      : this.globals.has(n.name)
      ? this.globals.get(n.name)!
      : this.resolve(n.name, f, n.i);
    const opFn = n.op ? this.verbValue(n.op) : null;
    const updated = this.amend(container, idx, value, opFn);
    if (declareLocal && f.locals!.has(n.name)) f.locals!.set(n.name, updated);
    else this.globals.set(n.name, updated);
    if (opFn) {
      try {
        return this.index(updated, idx);
      } catch {
        return value;
      }
    }
    return value;
  }

  amend(x: QValue, idx: QValue[], value: QValue, opFn: QValue | null): QValue {
    if (idx.length === 0) return value;
    const [i, ...rest] = idx;
    const setOne = (cur: QValue, nv: QValue): QValue => {
      if (rest.length) return this.amend(cur, rest, nv, opFn);
      if (opFn) return this.apply(opFn, [cur, nv]);
      return nv;
    };

    if (isTable(x)) {
      const t = x as QTable;
      if (i.t === -11 || i.t === 11) {
        const names = i.t === -11 ? [(i as QAtom).v] : ((i as QVector).v as string[]);
        const nt = table(t.c.slice(), t.v.slice());
        names.forEach((nm, k) => {
          const nv = names.length === 1 ? value : at(value, k);
          const ci = nt.c.indexOf(nm);
          const col = ci < 0 ? null : nt.v[ci];
          const newCol = col ? setOne(col, nv) : nv;
          const full = isAtom(newCol) ? fillVec(newCol, count(nt)) : newCol;
          if (ci < 0) {
            nt.c.push(nm);
            nt.v.push(full);
          } else nt.v[ci] = full;
        });
        return nt;
      }
      // row index
      const rows = isAtom(i) ? [(i as QAtom).v as number] : (rawArray(i) as number[]);
      const nt = table(t.c.slice(), t.v.map((c) => shallowClone(c) as QValue));
      rows.forEach((r, k) => {
        const rowVal = isAtom(i) ? value : at(value, k);
        nt.c.forEach((cn, ci) => {
          const nv = isDict(rowVal) ? this.index1(rowVal, sym(cn)) : rowVal;
          nt.v[ci] = setAt(nt.v[ci], r, setOne(at(nt.v[ci], r), nv));
        });
      });
      return nt;
    }

    if (isDict(x)) {
      const d = x as QDict;
      const keys = isAtom(i) || i.t === 10 ? [i] : items(i);
      let nk = d.k;
      let nv = d.v;
      keys.forEach((key, k) => {
        const val = keys.length === 1 && (isAtom(i) || i.t === 10) ? value : at(value, k);
        const ix = this.findIndex(nk, key);
        if (ix < 0) {
          nk = fromItems([...items(nk), key]);
          nv = fromItems([...items(nv), rest.length || opFn ? setOne(nullLike(nv), val) : val]);
        } else {
          nv = setAt(nv, ix, setOne(at(nv, ix), val));
        }
      });
      return dict(nk, nv);
    }

    if (i.t === -101) {
      const n = count(x);
      let out = shallowClone(x);
      for (let j = 0; j < n; j++) {
        const nv = isAtom(value) ? value : at(value, j);
        out = setAt(out, j, setOne(at(out, j), nv));
      }
      return out;
    }

    const idxs = isAtom(i) ? [(i as QAtom).v as number] : (rawArray(i) as number[]);
    let out = shallowClone(x);
    idxs.forEach((r, k) => {
      const nv = isAtom(i) ? value : isAtom(value) ? value : at(value, k);
      out = setAt(out, r, setOne(at(out, r), nv));
    });
    return out;
  }

  // -------------------------------------------------------------- control

  evalCond(xs: Node[], f: Frame): QValue {
    let i = 0;
    while (i + 1 < xs.length) {
      const c = this.evalNode(xs[i], f);
      if (truthy(c)) return this.evalNode(xs[i + 1], f);
      i += 2;
    }
    if (i < xs.length) return this.evalNode(xs[i], f);
    return UNIT;
  }

  evalCtrl(n: Node & { k: 'ctrl' }, f: Frame): QValue {
    const xs = n.xs;
    if (n.w === 'if') {
      if (truthy(this.evalNode(xs[0], f))) {
        for (let i = 1; i < xs.length; i++) this.evalNode(xs[i], f);
      }
      return UNIT;
    }
    if (n.w === 'do') {
      const cnt = this.evalNode(xs[0], f);
      const times = Math.trunc(Number((cnt as QAtom).v));
      for (let k = 0; k < times; k++) {
        this.tick();
        for (let i = 1; i < xs.length; i++) this.evalNode(xs[i], f);
      }
      return UNIT;
    }
    if (n.w === 'while') {
      let guard = 0;
      while (truthy(this.evalNode(xs[0], f))) {
        this.tick();
        if (++guard > 10_000_000) throw new QError('stop', 'while loop did not terminate');
        for (let i = 1; i < xs.length; i++) this.evalNode(xs[i], f);
      }
      return UNIT;
    }
    return UNIT;
  }

  // -------------------------------------------------------------- tables

  evalTableLit(n: Node & { k: 'tablit' }, f: Frame): QValue {
    const build = (specs: ColSpec[]): QTable => {
      const names: string[] = [];
      const cols: QValue[] = [];
      for (const s of specs) {
        let nm = s.name;
        if (!nm) {
          if (s.e.k === 'name') nm = s.e.n;
          else nm = 'x' + (names.length ? names.length : '');
        }
        names.push(nm);
        cols.push(this.evalNode(s.e, f));
      }
      let n = 0;
      for (const c of cols) if (!isAtom(c)) n = Math.max(n, count(c));
      if (cols.length && cols.every((c) => isAtom(c))) n = 1;
      const full = cols.map((c) => (isAtom(c) ? fillVec(c, n) : c));
      full.forEach((c) => {
        if (count(c) !== n) throw new QError('length', 'Table columns must be the same length.');
      });
      return table(names, full);
    };
    const body = build(n.cols);
    if (n.keys.length === 0) return body;
    const keyT = build(n.keys);
    if (count(keyT) !== count(body) && n.cols.length) {
      throw new QError('length', 'Key and value columns must have the same length.');
    }
    if (!n.cols.length) return dict(keyT, table([], []));
    return dict(keyT, body);
  }

  // -------------------------------------------------------------- qSQL

  evalQsql(n: Node & { k: 'qsql' }, f: Frame): QValue {
    let src = this.evalNode(n.from, f);
    if (src.t === -11 && (n.op === 'update' || n.op === 'delete')) {
      const nm = (src as QAtom).v as string;
      const tbl0 = this.resolve(nm, f);
      const res = this.evalQsql({ ...n, from: { k: 'lit', v: tbl0, i: n.i } } as any, f);
      this.globals.set(nm, res);
      return sym(nm);
    }
    if (src.t === -11) src = this.resolve((src as QAtom).v as string, f);
    let tbl: QTable;
    let keyCols: string[] = [];
    if (isKeyedTable(src)) {
      const kt = src as QDict;
      keyCols = (kt.k as QTable).c.slice();
      tbl = table(
        [...(kt.k as QTable).c, ...(kt.v as QTable).c],
        [...(kt.k as QTable).v, ...(kt.v as QTable).v]
      );
    } else if (isTable(src)) {
      tbl = src as QTable;
    } else if (isDict(src)) {
      tbl = table(['key', 'value'], [(src as QDict).k, (src as QDict).v]);
    } else {
      throw new QError('type', 'from expects a table.');
    }

    const nrows = count(tbl);
    let rows: number[] = [];
    for (let i = 0; i < nrows; i++) rows.push(i);

    // where
    for (const w of n.where) {
      const sub = subTable(tbl, rows);
      const scope = this.tableFrame(sub, f, rows);
      const res = this.evalNode(w, scope);
      const keep: number[] = [];
      if (isAtom(res)) {
        if (truthy(res)) keep.push(...rows);
      } else {
        const arr = rawArray(res);
        for (let i = 0; i < rows.length; i++) if (arr[i]) keep.push(rows[i]);
      }
      rows = keep;
    }

    const filtered = subTable(tbl, rows);

    if (n.op === 'delete') {
      if (n.cols.length) {
        // delete columns
        const drop = n.cols.map((c) => (c.e.k === 'name' ? c.e.n : ''));
        const keepIdx = tbl.c.map((c, i) => i).filter((i) => !drop.includes(tbl.c[i]));
        const res = table(keepIdx.map((i) => tbl.c[i]), keepIdx.map((i) => tbl.v[i]));
        return this.rekey(res, keyCols);
      }
      const keepRows: number[] = [];
      const del = new Set(rows);
      for (let i = 0; i < nrows; i++) if (!del.has(i)) keepRows.push(i);
      return this.rekey(subTable(tbl, keepRows), keyCols);
    }

    if (n.op === 'update') {
      if (n.by && n.by.length) {
        const groups = this.groupBy(filtered, n.by, f, rows);
        const newCols = new Map<string, QValue[]>();
        const assigns: { name: string; vals: (QValue | null)[] }[] = [];
        const result = table(tbl.c.slice(), tbl.v.map((c) => shallowClone(c)));
        for (const spec of n.cols) {
          const nm = spec.name ?? deriveName(spec.e, 0);
          let col = result.c.indexOf(nm) >= 0 ? shallowClone(result.v[result.c.indexOf(nm)]) : null;
          const values: (QValue | null)[] = new Array(nrows).fill(null);
          for (const g of groups) {
            const gsub = subTable(tbl, g.rows);
            const scope = this.tableFrame(gsub, f, g.rows);
            const v = this.evalNode(spec.e, scope);
            g.rows.forEach((r, ix) => {
              values[r] = isAtom(v) ? v : at(v, ix);
            });
          }
          const base = result.c.indexOf(nm) >= 0 ? result.v[result.c.indexOf(nm)] : null;
          const merged = fromItems(
            new Array(nrows).fill(0).map((_, r) => values[r] ?? (base ? at(base, r) : nullAtomOf(0)))
          );
          if (result.c.indexOf(nm) >= 0) result.v[result.c.indexOf(nm)] = merged;
          else {
            result.c.push(nm);
            result.v.push(merged);
          }
        }
        return this.rekey(result, keyCols);
      }
      const scope = this.tableFrame(filtered, f, rows);
      const result = table(tbl.c.slice(), tbl.v.map((c) => shallowClone(c)));
      for (const spec of n.cols) {
        const nm = spec.name ?? deriveName(spec.e, 0);
        const v = this.evalNode(spec.e, this.tableFrame(subTable(result, rows), f, rows));
        const ci = result.c.indexOf(nm);
        if (rows.length === nrows) {
          const full = isAtom(v) ? fillVec(v, nrows) : v;
          if (ci >= 0) result.v[ci] = full;
          else {
            result.c.push(nm);
            result.v.push(full);
          }
        } else {
          let col: QValue;
          if (ci >= 0) col = shallowClone(result.v[ci]);
          else col = fillVec(nullAtomOf(isAtom(v) ? v.t : at(v, 0).t), nrows);
          rows.forEach((r, ix) => {
            col = setAt(col, r, isAtom(v) ? v : at(v, ix));
          });
          if (ci >= 0) result.v[ci] = col;
          else {
            result.c.push(nm);
            result.v.push(col);
          }
        }
      }
      return this.rekey(result, keyCols);
    }

    // select / exec
    const isExec = n.op === 'exec';
    if (n.by && n.by.length) {
      const groups = this.groupBy(filtered, n.by, f, rows, true);
      const byNames = n.by.map((b, i) => b.name ?? deriveName(b.e, i));
      const keyColsOut: QValue[][] = n.by.map(() => []);
      const valColsOut: QValue[][] = [];
      const colNames: string[] = [];
      const specs = n.cols.length ? n.cols : allColSpecs(tbl, byNames);
      specs.forEach((s, i) => {
        colNames.push(s.name ?? deriveName(s.e, i));
        valColsOut.push([]);
      });
      for (const g of groups) {
        g.keys.forEach((kv, i) => keyColsOut[i].push(kv));
        const gsub = subTable(tbl, g.rows);
        const scope = this.tableFrame(gsub, f, g.rows);
        specs.forEach((s, i) => {
          valColsOut[i].push(this.evalNode(s.e, scope));
        });
      }
      const keyTable = table(byNames, keyColsOut.map((c) => fromItems(c)));
      const valTable = table(colNames, valColsOut.map((c) => fromItems(c)));
      if (isExec) {
        if (colNames.length === 1) return dict(keyTable.v.length === 1 ? keyTable.v[0] : keyTable, valTable.v[0]);
        return dict(keyTable.v.length === 1 ? keyTable.v[0] : keyTable, valTable);
      }
      return dict(keyTable, valTable);
    }

    const scope = this.tableFrame(filtered, f, rows);
    if (isExec) {
      const specs = n.cols.length ? n.cols : allColSpecs(tbl, []);
      if (specs.length === 1 && !specs[0].name) {
        return this.evalNode(specs[0].e, scope);
      }
      const names = specs.map((s, i) => s.name ?? deriveName(s.e, i));
      const vals = specs.map((s) => this.evalNode(s.e, scope));
      return dict(symvec(names), fromItems(vals));
    }

    let specs = n.cols.length ? n.cols : allColSpecs(tbl, []);
    const names = specs.map((s, i) => s.name ?? deriveName(s.e, i));
    let vals = specs.map((s) => this.evalNode(s.e, scope));
    let m = 1;
    for (const v of vals) if (!isAtom(v)) m = Math.max(m, count(v));
    vals = vals.map((v) => (isAtom(v) ? fillVec(v, m) : v));
    let res: QValue = table(names, vals);
    if (n.limit) {
      const lim = this.evalNode(n.limit, f);
      res = this.builtins.get('#')!.f(this, [lim, res]);
    }
    if (keyCols.length && n.cols.length === 0) return this.rekey(res as QTable, keyCols);
    return res;
  }

  rekey(t: QTable, keyCols: string[]): QValue {
    if (!keyCols.length) return t;
    const have = keyCols.filter((c) => t.c.includes(c));
    if (!have.length) return t;
    const keyIdx = have.map((c) => t.c.indexOf(c));
    const valIdx = t.c.map((_, i) => i).filter((i) => !keyIdx.includes(i));
    return dict(
      table(keyIdx.map((i) => t.c[i]), keyIdx.map((i) => t.v[i])),
      table(valIdx.map((i) => t.c[i]), valIdx.map((i) => t.v[i]))
    );
  }

  tableFrame(t: QTable, parent: Frame, rows: number[]): Frame {
    const locals = new Map<string, QValue>();
    if (parent.locals) for (const [k, v] of parent.locals) locals.set(k, v);
    t.c.forEach((c, i) => locals.set(c, t.v[i]));
    locals.set('i', longvec(rows.map((_, ix) => ix)));
    return { locals };
  }

  groupBy(
    t: QTable,
    by: ColSpec[],
    f: Frame,
    rows: number[],
    sorted = false
  ): { keys: QValue[]; rows: number[] }[] {
    const scope = this.tableFrame(t, f, rows);
    const byVals = by.map((b) => {
      const v = this.evalNode(b.e, scope);
      return isAtom(v) ? fillVec(v, rows.length) : v;
    });
    const map = new Map<string, { keys: QValue[]; rows: number[] }>();
    const order: string[] = [];
    for (let i = 0; i < rows.length; i++) {
      const keys = byVals.map((v) => at(v, i));
      const kk = keys.map((k) => keyStr(k)).join('\u0001');
      let e = map.get(kk);
      if (!e) {
        e = { keys, rows: [] };
        map.set(kk, e);
        order.push(kk);
      }
      e.rows.push(rows[i]);
    }
    const groups = order.map((k) => map.get(k)!);
    if (sorted)
      groups.sort((a, b) => {
        for (let i = 0; i < a.keys.length; i++) {
          const c = compareForGroup(a.keys[i], b.keys[i]);
          if (c) return c;
        }
        return 0;
      });
    return groups;
  }
}

function compareForGroup(a: QValue, b: QValue): number {
  const av = (a as QAtom).v;
  const bv = (b as QAtom).v;
  if (typeof av === 'string' || typeof bv === 'string')
    return String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0;
  const an = typeof av === 'bigint' ? Number(av) : (av as number);
  const bn = typeof bv === 'bigint' ? Number(bv) : (bv as number);
  return an < bn ? -1 : an > bn ? 1 : 0;
}

// ---------------------------------------------------------------- helpers

export function truthy(x: QValue): boolean {
  if (isAtom(x)) {
    const v = (x as QAtom).v;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'string') return v !== '' && v !== ' ';
    return !!v;
  }
  if (count(x) === 0) return false;
  return truthy(at(x, 0));
}

export function compose(f: QValue, g: QValue): QComp {
  const fns: QValue[] = [];
  const add = (v: QValue) => {
    if (v.t === 105) fns.push(...(v as QComp).fns);
    else fns.push(v);
  };
  add(f);
  add(g);
  return { t: 105, fns } as QComp;
}

export function isNounish(n: Node): boolean {
  return n.k === 'lit' || n.k === 'listlit' || n.k === 'tablit' || n.k === 'qsql';
}

export function padArgs(args: (QValue | null)[], n: number): (QValue | null)[] {
  const out = args.slice();
  while (out.length < n) out.push(null);
  return out;
}

export function fillVec(a: QValue, n: number): QValue {
  if (!Number.isFinite(n) || n > 4_000_000) throw new QError('limit', 'list too long');
  if (isAtom(a)) {
    const t = -a.t;
    const v = (a as QAtom).v;
    if (t === 10) return vec(10, v.repeat(n));
    return typedVec(t, new Array(n).fill(v));
  }
  const out: QValue[] = [];
  for (let i = 0; i < n; i++) out.push(a);
  return fromItems(out);
}

export function nullLike(x: QValue): QValue {
  if (x.t > 0 && x.t <= 19) return nullAtomOf(x.t);
  if (x.t === 0) {
    if (count(x) > 0) return nullLike(at(x, 0));
    return NIL;
  }
  if (x.t < 0) return nullAtomOf(-x.t);
  if (isTable(x)) {
    const t = x as QTable;
    return dict(symvec(t.c.slice()), fromItems(t.v.map((c) => nullLike(c))));
  }
  return NIL;
}

/** immutable element set */
export function setAt(x: QValue, i: number, v: QValue): QValue {
  if (x.t === 10) {
    const s = (x as QVector).v as string;
    const ch = v.t === -10 ? (v as QAtom).v : String((v as QAtom).v);
    if (i >= s.length) {
      return vec(10, s + ' '.repeat(i - s.length) + ch);
    }
    return vec(10, s.slice(0, i) + ch + s.slice(i + 1));
  }
  if (x.t > 0 && x.t <= 19) {
    const arr = ((x as QVector).v as any[]).slice();
    if (isAtom(v) && -v.t === x.t) {
      arr[i] = (v as QAtom).v;
      return vec(x.t, arr);
    }
    throw new QError('type', `Cannot put a ${TYPE_NAME[Math.abs(v.t)] ?? 'value'} into a ${TYPE_NAME[x.t]} vector.`);
  }
  if (x.t === 0) {
    const arr = ((x as QVector).v as QValue[]).slice();
    while (arr.length <= i) arr.push(NIL);
    arr[i] = v;
    return fromItems(arr);
  }
  if (isTable(x)) {
    const t = x as QTable;
    const nt = table(t.c.slice(), t.v.slice());
    nt.c.forEach((c, ci) => {
      const nv = isDict(v) ? (v as QDict) : null;
      nt.v[ci] = setAt(nt.v[ci], i, nv ? indexDict(nv, c) : v);
    });
    return nt;
  }
  if (isDict(x)) {
    const d = x as QDict;
    return dict(d.k, setAt(d.v, i, v));
  }
  return x;
}

function indexDict(d: QDict, key: string): QValue {
  const n = count(d.k);
  for (let i = 0; i < n; i++) {
    const k = at(d.k, i);
    if (k.t === -11 && (k as QAtom).v === key) return at(d.v, i);
  }
  return NIL;
}

export function subTable(t: QTable, rows: number[]): QTable {
  return table(
    t.c.slice(),
    t.v.map((c) => selectRows(c, rows))
  );
}

export function selectRows(col: QValue, rows: number[]): QValue {
  if (col.t === 10) {
    const s = col.v as string;
    return vec(10, rows.map((r) => s[r] ?? ' ').join(''));
  }
  if (col.t > 0 && col.t <= 19) {
    const arr = col.v as any[];
    return vec(col.t, rows.map((r) => arr[r]));
  }
  if (col.t === 0) {
    const arr = col.v as QValue[];
    return listFrom(rows.map((r) => arr[r]));
  }
  return col;
}

export function keyStr(x: QValue): string {
  if (isAtom(x)) return x.t + ':' + String((x as QAtom).v);
  if (x.t === 10) return '10:' + (x as QVector).v;
  if (x.t === 0) return '0:(' + ((x as QVector).v as QValue[]).map(keyStr).join(';') + ')';
  if (x.t >= 0 && x.t <= 19) return x.t + ':' + (x.v as any[]).join(',');
  if (isDict(x)) return 'd:' + keyStr((x as QDict).k) + '|' + keyStr((x as QDict).v);
  if (isTable(x)) {
    const t = x as QTable;
    return 't:' + t.c.join(',') + '|' + t.v.map(keyStr).join('|');
  }
  return String(x.t);
}

export function deriveName(e: Node, i: number): string {
  const n = nameOf(e);
  if (n) return n;
  return i === 0 ? 'x' : 'x' + i;
}

function nameOf(e: Node): string | null {
  if (e.k === 'name') {
    if (e.n === 'i') return 'x';
    const parts = e.n.split('.');
    return parts[parts.length - 1];
  }
  if (e.k === 'seq' && e.xs.length === 2) return nameOf(e.xs[1]);
  if (e.k === 'call' && e.args.length === 1 && e.args[0]) return nameOf(e.args[0]!);
  if (e.k === 'adv') return null;
  return null;
}

function allColSpecs(t: QTable, exclude: string[]): ColSpec[] {
  return t.c
    .filter((c) => !exclude.includes(c))
    .map((c) => ({ name: c, e: { k: 'name', n: c, i: 0 } as Node }));
}
