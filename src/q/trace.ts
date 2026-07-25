// Right-to-left evaluation trace: the "why does q read backwards" explainer.

import { Node, parse } from './parser';
import { Interp, Frame, compose } from './eval';
import { QValue, QProj, isFunc, QError, UNIT } from './value';
import { compact } from './format';

export interface TraceStep {
  depth: number;
  src: string;
  value: QValue | null;
  error?: string;
}

/** Reconstruct q source from an AST node (used for trace labels). */
/** one-line, length-capped rendering of a value for trace labels */
function short(v: QValue): string {
  const s = compact(v);
  return s.length > 34 ? s.slice(0, 32) + '..' : s;
}

export function unparse(n: Node | null): string {
  if (!n) return '';
  switch (n.k) {
    case 'lit':
      return compact(n.v);
    case 'name':
      return n.n;
    case 'verb':
      return n.n;
    case 'adv':
      return unparse(n.f) + n.adv;
    case 'seq':
      return n.xs.map(unparse).join(' ');
    case 'call':
      return unparse(n.f) + '[' + n.args.map((a) => (a ? unparse(a) : '')).join(';') + ']';
    case 'lambda':
      return n.src;
    case 'assign':
      return (
        n.name +
        (n.idx ? '[' + n.idx.map((a) => (a ? unparse(a) : '')).join(';') + ']' : '') +
        (n.op ?? '') +
        (n.global ? '::' : ':') +
        unparse(n.v)
      );
    case 'exprs':
      return '[' + n.xs.map(unparse).join(';') + ']';
    case 'listlit':
      return '(' + n.xs.map(unparse).join(';') + ')';
    case 'cond':
      return '$[' + n.xs.map(unparse).join(';') + ']';
    case 'ctrl':
      return n.w + '[' + n.xs.map(unparse).join(';') + ']';
    case 'ret':
      return ':' + unparse(n.v);
    case 'sig':
      return "'" + unparse(n.v);
    case 'tablit':
      return (
        '([' +
        n.keys.map((k) => (k.name ? k.name + ':' : '') + unparse(k.e)).join(';') +
        '] ' +
        n.cols.map((k) => (k.name ? k.name + ':' : '') + unparse(k.e)).join('; ') +
        ')'
      );
    case 'qsql':
      return (
        n.op +
        ' ' +
        n.cols.map((k) => (k.name ? k.name + ':' : '') + unparse(k.e)).join(',') +
        (n.by ? ' by ' + n.by.map((k) => (k.name ? k.name + ':' : '') + unparse(k.e)).join(',') : '') +
        ' from ' +
        unparse(n.from) +
        (n.where.length ? ' where ' + n.where.map(unparse).join(',') : '')
      );
    case 'nil':
      return '';
  }
  return '?';
}

/**
 * Evaluate `src` in a scratch copy of the interpreter, recording every
 * sub-expression in the order q evaluates it (right to left).
 */
export function traceExpr(base: Interp, src: string): TraceStep[] {
  const ip = Object.create(Object.getPrototypeOf(base)) as Interp;
  Object.assign(ip, base);
  ip.globals = new Map(base.globals);
  ip.out = () => {};

  const steps: TraceStep[] = [];
  const stmts = parse(src);
  const frame: Frame = { locals: null };

  const rec = (node: Node, depth: number): QValue => {
    switch (node.k) {
      case 'seq':
        return traceSeq(node, depth);
      case 'call': {
        const fn = rec(node.f, depth + 1);
        const args = node.args.map((a) => (a === null ? null : rec(a, depth + 1)));
        const v = ip.applyMaybeProject(fn, args);
        push(node, v, depth);
        return v;
      }
      case 'listlit':
      case 'exprs': {
        const v = ip.evalNode(node, frame);
        push(node, v, depth);
        return v;
      }
      case 'lit':
      case 'name':
      case 'verb':
      case 'lambda':
      case 'nil': {
        const v = ip.evalNode(node, frame);
        // naming a function is not a step worth showing
        if (node.k === 'name' && !isFunc(v)) push(node, v, depth);
        return v;
      }
      default: {
        const v = ip.evalNode(node, frame);
        push(node, v, depth);
        return v;
      }
    }
  };

  const push = (node: Node, v: QValue, depth: number) => {
    steps.push({ depth, src: unparse(node), value: v });
  };

  const traceSeq = (node: Node & { k: 'seq' }, depth: number): QValue => {
    const xs = node.xs;
    const cache: (QValue | undefined)[] = new Array(xs.length);
    const ev = (i: number) => {
      if (cache[i] === undefined) cache[i] = rec(xs[i], depth + 1);
      return cache[i]!;
    };
    let i = xs.length - 1;
    let val = ev(i);
    i--;
    while (i >= 0) {
      const v = ev(i);
      if (isFunc(v)) {
        if (i > 0 && ip.rankOf(v) >= 2 && !(xs[i] as any).paren) {
          const lv = ev(i - 1);
          const label = `${short(lv)} ${unparse(xs[i])} ${short(val)}`;
          val = ip.apply(v, [lv, val]);
          steps.push({ depth, src: label, value: val });
          i -= 2;
        } else {
          const label = `${unparse(xs[i])} ${short(val)}`;
          val = ip.apply(v, [val]);
          steps.push({ depth, src: label, value: val });
          i--;
        }
      } else if (isFunc(val)) {
        const label = `${short(v)} ${unparse(xs[i + 1] ?? xs[i])}`;
        val = { t: 104, f: val, args: [v, null] } as QProj;
        steps.push({ depth, src: label, value: val });
        i--;
      } else {
        const label = `${short(v)} ${short(val)}`;
        val = ip.apply(v, [val]);
        steps.push({ depth, src: label, value: val });
        i--;
      }
    }
    return val;
  };

  for (const st of stmts) {
    try {
      const v = rec(st, 0);
      steps.push({ depth: -1, src: unparse(st), value: v });
    } catch (e: any) {
      steps.push({
        depth: -1,
        src: unparse(st),
        value: null,
        error: e instanceof QError ? "'" + e.qmsg : String(e?.message ?? e),
      });
      break;
    }
  }
  return steps;
}
