// The .z (system/time) and .Q (utility) namespaces, plus the \t timer that
// drives kdb+-style periodic work.

import type { Interp } from '../q/eval';
import type { SketchRuntime } from './runtime';
import {
  QValue,
  QAtom,
  QVector,
  QTable,
  QDict,
  atom,
  dict,
  table,
  sym,
  symvec,
  str,
  float,
  long,
  int,
  bool,
  listFrom,
  fromItems,
  floatvec,
  longvec,
  items,
  count,
  at,
  isAtom,
  isTable,
  isDict,
  isKeyedTable,
  isFunc,
  typedVec,
  QError,
  UNIT,
  NIL,
  TYPE_CHAR,
  matchValues,
} from '../q/value';
import { display, compact, gfmt, DEFAULT_OPTS } from '../q/format';
import { daysFromEpoch, ymdFromDays } from '../q/lexer';

const NS_PER_DAY = 86400000000000n;
const EPOCH_MS = Date.UTC(2000, 0, 1);

function nowNanos(local: boolean): bigint {
  const d = new Date();
  const ms = d.getTime() - EPOCH_MS - (local ? d.getTimezoneOffset() * 60000 : 0);
  return BigInt(Math.round(ms)) * 1000000n;
}

const dayNanos = (n: bigint) => ((n % NS_PER_DAY) + NS_PER_DAY) % NS_PER_DAY;

export function installNamespaces(ip: Interp, rt: SketchRuntime) {
  const def = (
    name: string,
    ranks: number[],
    f: (ip: Interp, args: QValue[]) => QValue,
    doc?: string,
    sig?: string,
    ex?: string[]
  ) => ip.def({ name, ranks, f, doc, sig, ex });

  const N = (v: QValue): number => {
    const x = (v as QAtom).v;
    return typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? x : 0;
  };
  const S = (v: QValue): string =>
    v.t === 10 ? ((v as QVector).v as string) : String((v as QAtom).v);

  (ip as any).nowTimestamp = () => atom(-12, nowNanos(true));

  // ---------------------------------------------------------------- .z

  const zHooks: Record<string, () => QValue> = {
    '.z.p': () => atom(-12, nowNanos(false)),
    '.z.P': () => atom(-12, nowNanos(true)),
    '.z.n': () => atom(-16, dayNanos(nowNanos(false))),
    '.z.N': () => atom(-16, dayNanos(nowNanos(true))),
    '.z.t': () => atom(-19, Number(dayNanos(nowNanos(false)) / 1000000n)),
    '.z.T': () => atom(-19, Number(dayNanos(nowNanos(true)) / 1000000n)),
    '.z.d': () => atom(-14, Number(nowNanos(false) / NS_PER_DAY)),
    '.z.D': () => atom(-14, Number(nowNanos(true) / NS_PER_DAY)),
    '.z.z': () => atom(-15, Number(nowNanos(false)) / Number(NS_PER_DAY)),
    '.z.Z': () => atom(-15, Number(nowNanos(true)) / Number(NS_PER_DAY)),
    '.z.i': () => int(0),
    '.z.a': () => int(0),
    '.z.w': () => int(0),
    '.z.h': () => sym('browser'),
    '.z.u': () => sym('q'),
    '.z.o': () => sym('browser'),
    '.z.f': () => sym(''),
    '.z.x': () => listFrom([]),
    '.z.K': () => float(4.0),
    '.z.k': () => atom(-14, daysFromEpoch(2026, 1, 1)),
    '.z.q': () => bool(false),
    '.z.b': () => dict(symvec([]), listFrom([])),
    // the timer interval, so `\t` and .z.ts can be inspected from q
    '.z.ti': () => long(rt.timerMs),
  };
  Object.assign(ip.dynamicHooks, zHooks);

  // ---------------------------------------------------------------- \ commands

  const systemCmd = (cmdRaw: string): QValue => {
    const cmd = cmdRaw.trim();
    if (!cmd) return UNIT;
    const head = cmd[0];
    const rest = cmd.slice(1).trim();
    switch (head) {
      case 't': {
        if (rest === '') return long(rt.timerMs);
        if (/^-?\d+$/.test(rest)) {
          rt.timerMs = Math.max(0, parseInt(rest, 10));
          rt.retime();
          return UNIT;
        }
        // \t expression - time it, in milliseconds
        const t0 = performance.now();
        ip.run(rest);
        return long(Math.round(performance.now() - t0));
      }
      case 'S': {
        const n = parseInt(rest, 10);
        ip.seed = (Number.isFinite(n) ? n : 1) >>> 0 || 1;
        return UNIT;
      }
      case 'P': {
        const n = parseInt(rest, 10);
        if (Number.isFinite(n)) ip.fmt.precision = Math.max(1, Math.min(17, n));
        return UNIT;
      }
      case 'c': {
        const parts = rest.split(/\s+/).map((x) => parseInt(x, 10));
        if (parts.length && Number.isFinite(parts[0])) ip.fmt.maxRows = Math.max(2, parts[0] - 5);
        return UNIT;
      }
      case 'a':
        return ip.apply(ip.globals.get('tables')!, [sym('.')]);
      case 'v': {
        const out: string[] = [];
        for (const [k] of ip.globals) if (!ip.builtins.has(k) && !k.startsWith('.')) out.push(k);
        return symvec(out.sort());
      }
      case '\\':
        return UNIT;
      default:
        return UNIT;
    }
  };
  (ip as any).systemCmd = systemCmd;

  ip.def({
    name: 'system',
    ranks: [1],
    f: (_ip, [x]) => systemCmd(S(x)),
    doc: 'Run a system command: "t 100" sets the timer, "S 42" the random seed, "P 3" print precision.',
    sig: 'system "t 100"',
    ex: ['system "t 250"'],
  });

  // ---------------------------------------------------------------- .Q

  ip.globals.set('.Q.a', str('abcdefghijklmnopqrstuvwxyz'));
  ip.globals.set('.Q.A', str('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  ip.globals.set('.Q.n', str('0123456789'));
  ip.globals.set('.Q.nA', str('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
  ip.globals.set('.Q.an', str('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789'));
  ip.globals.set('.Q.b6', str('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'));
  ip.globals.set('.Q.k', float(4.0));
  ip.globals.set(
    '.Q.res',
    symvec(
      `abs acos asin atan avg bin binr cor cos cov delete dev div do enlist exec exit exp getenv
       hopen if in insert last like log max min prd select setenv sin sqrt ss sum tan update var
       wavg while within wsum xexp from by`
        .split(/\s+/)
        .filter(Boolean)
    )
  );

  def('.Q.s', [1], (ip2, [x]) => str(display(x, ip2.fmt as any)), 'The console display of a value, as a string.');
  def('.Q.s1', [1], (_ip, [x]) => str(compact(x)), 'The one-line form of a value, as a string.');
  def(
    '.Q.f',
    [2],
    (_ip, [n, x]) => {
      const d = Math.max(0, Math.trunc(N(n)));
      const fmt1 = (v: number) => (Number.isNaN(v) ? '' : v.toFixed(d));
      if (isAtom(x)) return str(fmt1(N(x)));
      return listFrom(items(x).map((e) => str(fmt1(N(e)))));
    },
    'Format numbers with n decimal places.',
    '.Q.f[2;3.14159]'
  );
  def(
    '.Q.fmt',
    [3],
    (_ip, [w, p, x]) => {
      const width = Math.trunc(N(w));
      const prec = Math.trunc(N(p));
      const one = (v: number) => {
        const s = v.toFixed(Math.max(0, prec));
        return s.length > width ? '*'.repeat(width) : s.padStart(width);
      };
      if (isAtom(x)) return str(one(N(x)));
      return listFrom(items(x).map((e) => str(one(N(e)))));
    },
    'Format a number into a fixed-width string.',
    '.Q.fmt[8;2;3.14159]'
  );
  def(
    '.Q.addmonths',
    [2],
    (_ip, [d, n]) => {
      const add = (day: number, k: number) => {
        const [y, m, dd] = ymdFromDays(day);
        const total = (y * 12 + (m - 1)) + k;
        const ny = Math.floor(total / 12);
        const nm = total - ny * 12 + 1;
        const last = new Date(Date.UTC(2000, nm, 0)).getUTCDate();
        const lastOfMonth = daysInMonth(ny, nm);
        return daysFromEpoch(ny, nm, Math.min(dd, lastOfMonth));
      };
      const k = Math.trunc(N(n));
      if (isAtom(d)) return atom(-14, add(N(d), k));
      return typedVec(14, items(d).map((e) => add(N(e), k)));
    },
    'Add n months to a date.',
    '.Q.addmonths[2024.01.31;1]'
  );
  def(
    '.Q.ty',
    [1],
    (_ip, [x]) => {
      const t = x.t;
      const c = TYPE_CHAR[Math.abs(t)] ?? ' ';
      return atom(-10, t < 0 ? c.toUpperCase() : c);
    },
    'The type character of a value.'
  );
  def('.Q.qt', [1], (_ip, [x]) => bool(isTable(x) || isKeyedTable(x)), 'Is x a table?');
  def(
    '.Q.dd',
    [2],
    (_ip, [x, y]) => sym(String((x as QAtom).v) + '.' + String((y as QAtom).v)),
    'Join two symbols with a dot.',
    '.Q.dd[`a;`b]'
  );
  def(
    '.Q.fu',
    [2],
    (ip2, [f, x]) => {
      // apply f to the distinct items only, then spread the answers back
      const u = ip2.apply(ip2.globals.get('distinct')!, [x]);
      const res = ip2.apply(f, [u]);
      const idx = ip2.apply(ip2.globals.get('?')!, [u, x]);
      return ip2.index1(res, idx);
    },
    'Apply f to the distinct items of x only.',
    '.Q.fu[{x*2};1 1 2 2 3]'
  );
  def(
    '.Q.ind',
    [2],
    (ip2, [t, i]) => ip2.index1(t, i),
    'Index a table by row numbers.'
  );
  def(
    '.Q.id',
    [1],
    (_ip, [x]) => {
      const fix = (s: string) => {
        let out = s.replace(/[^a-zA-Z0-9_]/g, '');
        if (!out || /^[0-9]/.test(out)) out = 'a' + out;
        return out;
      };
      if (x.t === -11) return sym(fix(String((x as QAtom).v)));
      if (x.t === 11) return symvec(((x as QVector).v as string[]).map(fix));
      if (isTable(x)) {
        const t = x as QTable;
        return table(t.c.map(fix), t.v);
      }
      return x;
    },
    'Sanitise symbols (or a table\'s column names) into valid q names.'
  );
  const b64 = (s: string) =>
    typeof btoa === 'function'
      ? btoa(s)
      : Buffer.from(s, 'binary').toString('base64');
  def('.Q.btoa', [1], (_ip, [x]) => str(b64(S(x))), 'Base64-encode a string.');
  def(
    '.Q.j10',
    [1],
    (_ip, [x]) => {
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let v = 0;
      for (const c of S(x)) v = v * 64 + Math.max(0, alpha.indexOf(c));
      return long(v);
    },
    'Decode a base-64 string into a long.'
  );
  def(
    '.Q.x10',
    [1],
    (_ip, [x]) => {
      const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let v = Math.trunc(N(x));
      let out = '';
      while (v > 0) {
        out = alpha[v % 64] + out;
        v = Math.floor(v / 64);
      }
      return str(out || 'A');
    },
    'Encode a long as a base-64 string.'
  );
  def(
    '.Q.w',
    [1],
    () =>
      dict(
        symvec(['used', 'heap', 'peak', 'wmax', 'mmap', 'syms']),
        longvec([0, 0, 0, 0, 0, ip.globals.size])
      ),
    'Memory statistics (approximated in the browser).'
  );
  def('.Q.gc', [1], () => long(0), 'Garbage collect (a no-op here).');
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
