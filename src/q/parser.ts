// Parser: tokens -> AST.
//
// q has no operator precedence: an expression is a sequence of terms that is
// folded right-to-left at evaluation time (see eval.ts). The parser therefore
// keeps sequences intact and only resolves the syntax that *is* structural:
// brackets, lambdas, literals, control words and qSQL.

import { lex, Tok, QSQL_WORDS, CONTROL_WORDS, daysFromEpoch } from './lexer';
import { QError, QValue, atom, vec, typedVec, listFrom, NIL, str, sym, symvec } from './value';

export type Node =
  | { k: 'lit'; v: QValue; i?: number }
  | { k: 'name'; n: string; i: number }
  | { k: 'verb'; n: string; i: number }
  | { k: 'adv'; adv: string; f: Node; i: number }
  | { k: 'seq'; xs: Node[]; i: number }
  | { k: 'call'; f: Node; args: (Node | null)[]; i: number }
  | { k: 'lambda'; params: string[]; body: Node[]; src: string; i: number }
  | {
      k: 'assign';
      name: string;
      idx: (Node | null)[] | null;
      op: string | null;
      v: Node;
      global: boolean;
      i: number;
    }
  | { k: 'exprs'; xs: Node[]; i: number }
  | { k: 'listlit'; xs: Node[]; i: number }
  | { k: 'cond'; xs: Node[]; i: number }
  | { k: 'ctrl'; w: string; xs: Node[]; i: number }
  | { k: 'ret'; v: Node | null; i: number }
  | { k: 'sig'; v: Node; i: number }
  | { k: 'tablit'; keys: ColSpec[]; cols: ColSpec[]; i: number }
  | { k: 'qsql'; op: string; cols: ColSpec[]; by: ColSpec[] | null; from: Node; where: Node[]; limit: Node | null; i: number }
  | { k: 'nil'; i: number };

export interface ColSpec {
  name: string | null;
  e: Node;
}

interface Ctx {
  stopComma?: boolean;
  stopWords?: Set<string>;
}

const VALUE_END = new Set(['name', 'num', 'str', 'sym', 'rparen', 'rbrack', 'rbrace']);

export function parse(src: string): Node[] {
  const p = new Parser(lex(src), src);
  return p.program();
}

export function parseExprSrc(src: string): Node {
  const stmts = parse(src);
  if (stmts.length === 1) return stmts[0];
  return { k: 'exprs', xs: stmts, i: 0 };
}

class Parser {
  toks: Tok[];
  src: string;
  p = 0;
  braceDepth = 0;
  parenDepth = 0;
  brackDepth = 0;

  constructor(toks: Tok[], src: string) {
    this.toks = toks;
    this.src = src;
  }

  peek(o = 0): Tok {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  next(): Tok {
    return this.toks[this.p++];
  }
  at(k: string, s?: string): boolean {
    const t = this.peek();
    return t.k === k && (s === undefined || t.s === s);
  }
  expect(k: string, s?: string): Tok {
    if (!this.at(k, s))
      throw new QError(
        'parse',
        `Expected ${s ?? k} but found ${JSON.stringify(this.peek().s || 'end of input')}.`
      );
    return this.next();
  }
  skipNl() {
    while (this.at('nl')) this.next();
  }

  program(): Node[] {
    const out: Node[] = [];
    for (;;) {
      while (this.at('nl') || this.at('semi')) this.next();
      if (this.at('eof')) break;
      out.push(this.expr({}));
      if (this.at('semi') || this.at('nl')) continue;
      if (this.at('eof')) break;
      throw new QError(
        'parse',
        `Unexpected ${JSON.stringify(this.peek().s)} at position ${this.peek().i}.`
      );
    }
    return out;
  }

  /** Is the current newline a statement separator (vs. a continuation)? */
  nlSeparates(): boolean {
    if (!this.at('nl')) return false;
    if (this.parenDepth > 0 || this.brackDepth > 0) return false;
    const prev = this.toks[this.p - 1];
    if (this.braceDepth === 0) {
      // in a script a newline ends the statement unless the next line is
      // indented (or obviously continues the current one)
      if (this.peek().v === true) return false;
      let k = this.p;
      while (this.toks[k] && this.toks[k].k === 'nl') k++;
      const nxt = this.toks[k];
      if (nxt && nxt.k === 'name' && (nxt.s === 'by' || nxt.s === 'from' || nxt.s === 'where'))
        return false;
      return true;
    }
    if (!prev || !VALUE_END.has(prev.k)) return false;
    let q = this.p;
    while (this.toks[q] && this.toks[q].k === 'nl') q++;
    const nx = this.toks[q];
    if (!nx) return true;
    if (nx.k === 'eof' || nx.k === 'rbrace' || nx.k === 'rbrack' || nx.k === 'rparen') return false;
    if (nx.k === 'op' || nx.k === 'adv' || nx.k === 'semi') return false;
    // these words continue a qSQL statement and can never start one
    if (nx.k === 'name' && (nx.s === 'by' || nx.s === 'from' || nx.s === 'where')) return false;
    return true;
  }

  atStop(ctx: Ctx): boolean {
    const t = this.peek();
    if (t.k === 'eof' || t.k === 'semi' || t.k === 'rparen' || t.k === 'rbrack' || t.k === 'rbrace')
      return true;
    if (t.k === 'nl') return this.nlSeparates();
    if (ctx.stopComma && t.k === 'op' && t.s === ',') return true;
    if (ctx.stopWords && t.k === 'name' && ctx.stopWords.has(t.s)) return true;
    return false;
  }

  /** Parse one expression: a sequence of terms folded right-to-left later. */
  expr(ctx: Ctx): Node {
    const start = this.peek().i;
    const xs: Node[] = [];
    for (;;) {
      while (this.at('nl') && !this.nlSeparates()) this.next();
      if (this.atStop(ctx)) break;

      // leading ':' -> return statement
      if (xs.length === 0 && this.at('op', ':')) {
        const save = this.p;
        this.next();
        if (this.at('adv')) {
          this.p = save;
          xs.push(this.term(ctx));
          continue;
        }
        if (this.atStop(ctx)) {
          // a bare ":" is the assign/replace verb (used by amend)
          this.p = save;
          xs.push(this.term(ctx));
          continue;
        }
        return { k: 'ret', v: this.expr(ctx), i: start };
      }
      if (xs.length === 0 && this.at('op', "'") && this.peek(1).k !== 'eof') {
        // signal:  'err  (only when nothing to the left)
        const nx = this.peek(1);
        if (nx.k === 'sym' || nx.k === 'str') {
          this.next();
          return { k: 'sig', v: this.expr(ctx), i: start };
        }
      }

      const term = this.term(ctx);

      // assignment?
      const t = this.peek();
      if (t.k === 'op' && (t.s === ':' || t.s === '::' || (t.s.length === 2 && t.s[1] === ':'))) {
        const target = assignTarget(term);
        if (target) {
          this.next();
          const value = this.expr(ctx);
          xs.push({
            k: 'assign',
            name: target.name,
            idx: target.idx,
            op: t.s.length === 2 && t.s !== '::' ? t.s[0] : null,
            v: value,
            global: t.s === '::',
            i: term.i ?? start,
          });
          break;
        }
      }
      xs.push(term);
    }
    if (xs.length === 0) return { k: 'nil', i: start };
    if (xs.length === 1) return xs[0];
    return { k: 'seq', xs, i: start };
  }

  term(ctx: Ctx): Node {
    let base = this.base(ctx);
    for (;;) {
      if (this.at('adv')) {
        const t = this.next();
        base = { k: 'adv', adv: t.s, f: base, i: t.i };
        continue;
      }
      if (this.at('lbrack')) {
        const t = this.next();
        const args = this.bracketArgs();
        if (base.k === 'verb' && base.n === '$' && args.length >= 3) {
          base = { k: 'cond', xs: args as Node[], i: t.i };
        } else {
          base = { k: 'call', f: base, args, i: t.i };
        }
        continue;
      }
      break;
    }
    return base;
  }

  bracketArgs(): (Node | null)[] {
    this.brackDepth++;
    const args: (Node | null)[] = [];
    this.skipNl();
    if (this.at('rbrack')) {
      this.next();
      this.brackDepth--;
      return args;
    }
    for (;;) {
      this.skipNl();
      if (this.at('semi')) {
        args.push(null);
        this.next();
        continue;
      }
      if (this.at('rbrack')) {
        args.push(null);
        break;
      }
      const e = this.expr({});
      args.push(e.k === 'nil' ? null : e);
      this.skipNl();
      if (this.at('semi')) {
        this.next();
        continue;
      }
      break;
    }
    this.skipNl();
    this.expect('rbrack');
    this.brackDepth--;
    return args;
  }

  base(ctx: Ctx): Node {
    const t = this.peek();
    switch (t.k) {
      case 'num':
        return this.numeric();
      case 'str': {
        this.next();
        const s: string = t.v;
        return { k: 'lit', v: s.length === 1 ? atom(-10, s) : vec(10, s), i: t.i };
      }
      case 'sym': {
        const syms: string[] = [];
        while (this.at('sym')) syms.push(this.next().v);
        return {
          k: 'lit',
          v: syms.length === 1 ? sym(syms[0]) : symvec(syms),
          i: t.i,
        };
      }
      case 'name': {
        if (QSQL_WORDS.has(t.s)) return this.qsql();
        if (CONTROL_WORDS.has(t.s) && this.peek(1).k === 'lbrack') {
          this.next();
          this.next();
          const args = this.bracketArgs();
          return { k: 'ctrl', w: t.s, xs: args.map((a) => a ?? { k: 'nil', i: t.i }), i: t.i };
        }
        this.next();
        return { k: 'name', n: t.s, i: t.i };
      }
      case 'op': {
        this.next();
        return { k: 'verb', n: t.s, i: t.i };
      }
      case 'adv': {
        // adverb in noun position (e.g. (/) or f over) - treat as verb token
        this.next();
        return { k: 'verb', n: t.s, i: t.i };
      }
      case 'lparen':
        return this.paren();
      case 'lbrace':
        return this.lambda();
      case 'lbrack': {
        this.next();
        const args = this.bracketArgs();
        return { k: 'exprs', xs: args.map((a) => a ?? { k: 'nil', i: t.i }), i: t.i };
      }
      default:
        throw new QError(
          'parse',
          `Unexpected ${JSON.stringify(t.s || 'end of input')} at position ${t.i}.`
        );
    }
  }

  numeric(): Node {
    const start = this.peek().i;
    const toks: Tok[] = [];
    while (this.at('num')) toks.push(this.next());
    return { k: 'lit', v: mergeNums(toks), i: start };
  }

  paren(): Node {
    const open = this.expect('lparen');
    this.parenDepth++;
    this.skipNl();
    if (this.at('lbrack')) return this.tableLit(open);
    const xs: Node[] = [];
    let trailingSemi = false;
    if (!this.at('rparen')) {
      for (;;) {
        this.skipNl();
        if (this.at('rparen')) {
          trailingSemi = true;
          break;
        }
        if (this.at('semi')) {
          this.next();
          xs.push({ k: 'nil', i: open.i });
          continue;
        }
        xs.push(this.expr({}));
        this.skipNl();
        if (this.at('semi')) {
          this.next();
          continue;
        }
        break;
      }
    }
    this.skipNl();
    this.expect('rparen');
    this.parenDepth--;
    if (xs.length === 0) return { k: 'lit', v: NIL, i: open.i };
    if (xs.length === 1 && !trailingSemi) {
      // a parenthesised expression is a noun: it is never applied infix
      (xs[0] as any).paren = true;
      return xs[0];
    }
    return { k: 'listlit', xs, i: open.i };
  }

  tableLit(open: Tok): Node {
    this.expect('lbrack');
    this.brackDepth++;
    const keys: ColSpec[] = [];
    this.skipNl();
    while (!this.at('rbrack')) {
      keys.push(this.colSpec({ stopComma: true }));
      this.skipNl();
      if (this.at('op', ',') || this.at('semi')) {
        this.next();
        this.skipNl();
        continue;
      }
      break;
    }
    this.skipNl();
    this.expect('rbrack');
    this.brackDepth--;
    const cols: ColSpec[] = [];
    this.skipNl();
    while (!this.at('rparen')) {
      if (this.at('op', ',') || this.at('semi')) {
        this.next();
        this.skipNl();
        continue;
      }
      const spec = this.colSpec({ stopComma: true });
      if (spec.name !== null || spec.e.k !== 'nil') cols.push(spec);
      this.skipNl();
      if (this.at('op', ',') || this.at('semi')) {
        this.next();
        this.skipNl();
        continue;
      }
      break;
    }
    this.skipNl();
    this.expect('rparen');
    this.parenDepth--;
    return { k: 'tablit', keys, cols, i: open.i };
  }

  colSpec(ctx: Ctx): ColSpec {
    // name:expr | expr   (a newline before the spec is a continuation)
    this.skipNl();
    if (this.at('name') && this.peek(1).k === 'op' && this.peek(1).s === ':') {
      const nm = this.next().s;
      this.next();
      return { name: nm, e: this.expr(ctx) };
    }
    const e = this.expr(ctx);
    // "c:expr" parsed as an assignment is still a column spec
    if (e.k === 'assign' && e.idx === null && !e.op && !e.global)
      return { name: e.name, e: e.v };
    return { name: null, e };
  }

  lambda(): Node {
    const open = this.expect('lbrace');
    this.braceDepth++;
    const startPos = open.i;
    let params: string[] = [];
    let explicit = false;
    this.skipNl();
    if (this.at('lbrack')) {
      // could be params or an expression starting with [ - params only contain names
      const save = this.p;
      this.next();
      const ps: string[] = [];
      let ok = true;
      if (this.at('rbrack')) {
        this.next();
      } else {
        for (;;) {
          if (this.at('name') && (this.peek(1).k === 'semi' || this.peek(1).k === 'rbrack')) {
            ps.push(this.next().s);
            if (this.at('semi')) {
              this.next();
              continue;
            }
            this.next(); // rbrack
            break;
          }
          ok = false;
          break;
        }
      }
      if (ok) {
        params = ps;
        explicit = true;
      } else {
        this.p = save;
      }
    }
    const body: Node[] = [];
    for (;;) {
      this.skipNl();
      if (this.at('rbrace')) break;
      if (this.at('semi')) {
        this.next();
        continue;
      }
      if (this.at('eof')) throw new QError('parse', 'Unclosed { in lambda.');
      const before = this.p;
      body.push(this.expr({}));
      this.skipNl();
      if (this.at('semi')) {
        this.next();
        continue;
      }
      if (this.p === before)
        throw new QError('parse', `Unexpected ${JSON.stringify(this.peek().s)} in lambda body.`);
    }
    const close = this.expect('rbrace');
    this.braceDepth--;
    if (!explicit) {
      const used = new Set<string>();
      collectNames(body, used);
      const implicits = ['x', 'y', 'z'];
      let last = -1;
      implicits.forEach((nm, ix) => {
        if (used.has(nm)) last = ix;
      });
      params = implicits.slice(0, last + 1);
    }
    return {
      k: 'lambda',
      params,
      body,
      src: this.src.slice(startPos, close.e),
      i: startPos,
    };
  }

  qsql(): Node {
    const t = this.next(); // select/exec/update/delete
    const op = t.s;
    let limit: Node | null = null;
    if (this.at('lbrack')) {
      this.next();
      this.brackDepth++;
      if (!this.at('rbrack')) limit = this.expr({});
      this.expect('rbrack');
      this.brackDepth--;
    }
    const stop = new Set(['by', 'from', 'where']);
    const cols: ColSpec[] = [];
    while (!this.at('name', 'from') && !this.at('name', 'by')) {
      if (this.atStop({})) break;
      cols.push(this.colSpec({ stopComma: true, stopWords: stop }));
      if (this.at('op', ',')) {
        this.next();
        continue;
      }
      break;
    }
    let by: ColSpec[] | null = null;
    if (this.at('name', 'by')) {
      this.next();
      by = [];
      while (!this.at('name', 'from')) {
        if (this.atStop({})) break;
        by.push(this.colSpec({ stopComma: true, stopWords: stop }));
        if (this.at('op', ',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    let from: Node = { k: 'nil', i: t.i };
    if (this.at('name', 'from')) {
      this.next();
      from = this.expr({ stopWords: new Set(['where']) });
    } else {
      throw new QError('parse', `${op} needs a "from" clause.`);
    }
    const where: Node[] = [];
    if (this.at('name', 'where')) {
      this.next();
      for (;;) {
        where.push(this.expr({ stopComma: true }));
        if (this.at('op', ',')) {
          this.next();
          continue;
        }
        break;
      }
    }
    return { k: 'qsql', op, cols, by, from, where, limit, i: t.i };
  }
}

function assignTarget(n: Node): { name: string; idx: (Node | null)[] | null } | null {
  if (n.k === 'name') return { name: n.n, idx: null };
  if (n.k === 'call' && n.f.k === 'name') return { name: n.f.n, idx: n.args };
  return null;
}

function collectNames(ns: (Node | null)[], out: Set<string>) {
  for (const n of ns) {
    if (!n) continue;
    switch (n.k) {
      case 'name':
        out.add(n.n);
        break;
      case 'seq':
      case 'listlit':
      case 'exprs':
      case 'cond':
        collectNames(n.xs, out);
        break;
      case 'ctrl':
        collectNames(n.xs, out);
        break;
      case 'call':
        collectNames([n.f, ...n.args], out);
        break;
      case 'adv':
        collectNames([n.f], out);
        break;
      case 'assign':
        out.add(n.name);
        collectNames([n.v, ...(n.idx ?? [])], out);
        break;
      case 'ret':
        collectNames([n.v], out);
        break;
      case 'sig':
        collectNames([n.v], out);
        break;
      case 'tablit':
        collectNames([...n.keys.map((c) => c.e), ...n.cols.map((c) => c.e)], out);
        break;
      case 'qsql':
        collectNames(
          [n.from, ...n.where, ...n.cols.map((c) => c.e), ...(n.by ?? []).map((c) => c.e)],
          out
        );
        break;
      case 'lambda':
        // nested lambdas have their own x/y/z
        break;
    }
  }
}

const NUM_RANK: Record<number, number> = { 1: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7 };


/** Juxtaposed numeric literals form a single vector, promoted to a common type. */
export function mergeNums(toks: Tok[]): QValue {
  const vals: any[] = [];
  const types: number[] = [];
  for (const t of toks) {
    const tt = t.t!;
    if (tt > 0) {
      // 010b / 0x0102 vector literal
      for (const v of t.v as any[]) {
        vals.push(v);
        types.push(tt);
      }
    } else {
      vals.push(t.v);
      types.push(-tt);
    }
  }
  // an explicit type suffix (2 3 4h) applies to the whole vector
  const explicit = toks.filter((t) => t.x).map((t) => Math.abs(t.t!));
  if (explicit.length) {
    const rt2 = explicit[explicit.length - 1];
    const out2 = vals.map((v, ix) => coerceLit(v, types[ix], rt2, toks[ix]?.s));
    return toks.length === 1 && toks[0].t! < 0 ? atom(-rt2, out2[0]) : typedVec(rt2, out2);
  }
  let rt = types[0];
  for (const ty of types) {
    if (ty === rt) continue;
    if (NUM_RANK[ty] && NUM_RANK[rt]) rt = NUM_RANK[ty] > NUM_RANK[rt] ? ty : rt;
    else if (ty >= 12 || rt >= 12) rt = Math.max(ty, rt);
    else rt = 9;
  }
  const out = vals.map((v, ix) => coerceLit(v, types[ix], rt, toks[ix]?.s));
  const single = toks.length === 1 && toks[0].t! < 0;
  if (single) return atom(-rt, out[0]);
  return typedVec(rt, out);
}

function coerceLit(v: any, from: number, to: number, src?: string): any {
  if (from === to) return v;
  // 2017.05 2017.09m : the suffix makes the earlier literals months too
  if (to === 13 && from === 9 && src) {
    const m = /^(\d{4})\.(\d{1,2})$/.exec(src);
    if (m) return (+m[1] - 2000) * 12 + (+m[2] - 1);
  }
  if ((to === 14 || to === 12) && from === 9 && src) {
    const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(src);
    if (m) return daysFromEpoch(+m[1], +m[2], +m[3]);
  }
  if (to === 12 || to === 16) {
    if (typeof v === 'bigint') return v;
    if (v === -9223372036854775808) return -9223372036854775808n;
    return BigInt(Math.trunc(v));
  }
  if (typeof v === 'bigint') return Number(v);
  if (to === 9 || to === 8) {
    if (v === -9223372036854775808 || v === -2147483648) return NaN;
    return v;
  }
  return v;
}
