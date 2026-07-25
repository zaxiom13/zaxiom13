// AST -> q parse tree, the value `parse` returns.
//
// In a parse tree a symbol means a *name*, so literal symbols are enlisted;
// an application is a list whose head is the function.

import { Node, ColSpec } from './parser';
import { Interp, deriveName } from './eval';
import {
  QValue,
  QLambda,
  listFrom,
  fromItems,
  sym,
  symvec,
  enlist,
  bool,
  isFunc,
  NIL,
  UNIT,
  QError,
  dict,
  long,
} from './value';

export function astToTree(ip: Interp, n: Node): QValue {
  switch (n.k) {
    case 'lit': {
      const v = n.v;
      // a bare symbol would be read as a name, so literals are enlisted
      if (v.t === -11 || v.t === 11) return enlist(v);
      return v;
    }
    case 'name': {
      // keywords resolve to their function value, variables stay symbols
      const b = ip.builtins.get(n.n);
      if (b && /^[a-z]/i.test(n.n)) return ip.globals.get(n.n) ?? sym(n.n);
      return sym(n.n);
    }
    case 'verb':
      return ip.verbValue(n.n);
    case 'adv':
      return ip.makeIter(n.adv, astToTree(ip, n.f));
    case 'lambda':
      return { t: 100, params: n.params, body: n.body, src: n.src } as QLambda;
    case 'nil':
      return UNIT;
    case 'listlit':
      return listFrom([ip.verbValue(','), ...n.xs.map((x) => astToTree(ip, x))]);
    case 'call': {
      const f = astToTree(ip, n.f);
      return listFrom([f, ...n.args.map((a) => (a ? astToTree(ip, a) : UNIT))]);
    }
    case 'assign':
      return listFrom([ip.verbValue(':'), sym(n.name), astToTree(ip, n.v)]);
    case 'cond':
      return listFrom([ip.verbValue('$'), ...n.xs.map((x) => astToTree(ip, x))]);
    case 'exprs':
      return listFrom(n.xs.map((x) => astToTree(ip, x)));
    case 'seq':
      return seqToTree(ip, n);
    case 'qsql':
      return qsqlToTree(ip, n);
    default:
      return astToTree(ip, { k: 'lit', v: NIL } as Node);
  }
}

function seqToTree(ip: Interp, n: Node & { k: 'seq' }): QValue {
  const xs = n.xs;
  const trees = xs.map((x) => astToTree(ip, x));
  const isVerbNode = (i: number) =>
    xs[i].k === 'verb' || xs[i].k === 'adv' || (isFunc(trees[i]) && xs[i].k !== 'lit');
  let i = xs.length - 1;
  let val = trees[i];
  i--;
  while (i >= 0) {
    const v = trees[i];
    if (isVerbNode(i)) {
      const rank = ip.rankOf(v);
      if (i > 0 && rank >= 2 && !(xs[i] as any).paren) {
        val = listFrom([v, trees[i - 1], val]);
        i -= 2;
      } else {
        val = listFrom([v, val]);
        i--;
      }
    } else {
      val = listFrom([v, val]);
      i--;
    }
  }
  return val;
}

function specDict(ip: Interp, specs: ColSpec[], fallback: (i: number) => string): QValue {
  const names = specs.map((s, i) => s.name ?? deriveName(s.e, i));
  const vals = specs.map((s) => astToTree(ip, s.e));
  return dict(symvec(names), fromItems(vals));
}

function qsqlToTree(ip: Interp, n: Node & { k: 'qsql' }): QValue {
  const t = astToTree(ip, n.from);
  const where = n.where.length ? listFrom(n.where.map((w) => astToTree(ip, w))) : NIL;
  const by = n.by && n.by.length ? specDict(ip, n.by, (i) => 'x' + (i || '')) : bool(false);
  const cols = n.cols.length ? specDict(ip, n.cols, (i) => 'x' + (i || '')) : NIL;
  if (n.op === 'select' || n.op === 'exec') {
    const head = ip.verbValue('?');
    if (n.op === 'exec' && n.cols.length === 1 && !n.cols[0].name)
      return listFrom([head, t, where, by, astToTree(ip, n.cols[0].e)]);
    return listFrom([head, t, where, by, cols]);
  }
  const head = ip.verbValue('!');
  if (n.op === 'delete') {
    const dropped = n.cols.length
      ? symvec(n.cols.map((c) => (c.e.k === 'name' ? c.e.n : (c.name ?? ''))))
      : NIL;
    return listFrom([head, t, where, bool(false), dropped]);
  }
  return listFrom([head, t, where, by, cols]);
}
