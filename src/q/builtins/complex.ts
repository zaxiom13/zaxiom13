// The .c namespace: complex numbers.
//
// q has no complex type, so one is a dictionary `re`im!(x;y) whose two values
// are either atoms or conforming vectors. That means a single number and a
// million of them look the same, exactly like the rest of q. Anything real is
// accepted wherever a complex is expected, and a table with re and im columns
// works too.

import type { Interp } from '../eval';
import { fillVec } from '../eval';
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
  longvec,
  floatvec,
  listFrom,
  fromItems,
  items,
  count,
  at,
  isAtom,
  isTable,
  isDict,
  isFunc,
  isKeyedTable,
  QError,
  UNIT,
} from '../value';
import { gfmt } from '../format';

interface CX {
  re: QValue;
  im: QValue;
}

export function installComplex(ip: Interp) {
  const def = (
    name: string,
    ranks: number[],
    f: (ip: Interp, args: QValue[]) => QValue,
    doc?: string,
    sig?: string,
    ex?: string[]
  ) => ip.def({ name, ranks, f, doc, sig, ex });

  const V = (op: string) => ip.verbValue(op);
  const ap2 = (op: string, a: QValue, b: QValue) => ip.apply(V(op), [a, b]);
  const ap1 = (name: string, a: QValue) => ip.apply(ip.globals.get(name)!, [a]);

  const num = (v: QValue): number => {
    const x = (v as QAtom).v;
    return typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? x : NaN;
  };
  const nums = (v: QValue): number[] => {
    if (isAtom(v)) return [num(v)];
    const n = count(v);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = num(at(v, i));
    return out;
  };

  /** Accept a complex, a real, or a table of re/im. */
  const toC = (v: QValue): CX => {
    if (isKeyedTable(v)) throw new QError('type', 'a keyed table is not a complex number');
    if (isDict(v)) {
      const d = v as QDict;
      const keys = items(d.k).map((k) => String((k as QAtom).v));
      const ri = keys.indexOf('re');
      const ii = keys.indexOf('im');
      if (ri >= 0 && ii >= 0) return { re: at(d.v, ri), im: at(d.v, ii) };
      throw new QError('type', 'a complex dictionary needs re and im keys');
    }
    if (isTable(v)) {
      const t = v as QTable;
      const ri = t.c.indexOf('re');
      const ii = t.c.indexOf('im');
      if (ri >= 0 && ii >= 0) return { re: t.v[ri], im: t.v[ii] };
      throw new QError('type', 'a complex table needs re and im columns');
    }
    if (isFunc(v)) throw new QError('type', 'a function is not a complex number');
    // a real number (or vector of them)
    return { re: v, im: ap2('*', v, float(0)) };
  };

  const mk = (re: QValue, im: QValue): QValue =>
    dict(symvec(['re', 'im']), listFrom([re, im]));
  const out = (c: CX) => mk(c.re, c.im);

  const add = (a: CX, b: CX): CX => ({ re: ap2('+', a.re, b.re), im: ap2('+', a.im, b.im) });
  const sub = (a: CX, b: CX): CX => ({ re: ap2('-', a.re, b.re), im: ap2('-', a.im, b.im) });
  const mul = (a: CX, b: CX): CX => ({
    re: ap2('-', ap2('*', a.re, b.re), ap2('*', a.im, b.im)),
    im: ap2('+', ap2('*', a.re, b.im), ap2('*', a.im, b.re)),
  });
  const abs2 = (a: CX): QValue => ap2('+', ap2('*', a.re, a.re), ap2('*', a.im, a.im));
  const div = (a: CX, b: CX): CX => {
    const d = abs2(b);
    return {
      re: ap2('%', ap2('+', ap2('*', a.re, b.re), ap2('*', a.im, b.im)), d),
      im: ap2('%', ap2('-', ap2('*', a.im, b.re), ap2('*', a.re, b.im)), d),
    };
  };
  const absOf = (a: CX): QValue => ap1('sqrt', abs2(a));
  const argOf = (a: CX): QValue => {
    // atan2, built from the vectorised pieces q already has
    const rs = nums(a.re);
    const is = nums(a.im);
    const n = Math.max(rs.length, is.length);
    const res = new Array(n);
    for (let i = 0; i < n; i++)
      res[i] = Math.atan2(is[i % is.length], rs[i % rs.length]);
    return isAtom(a.re) && isAtom(a.im) ? float(res[0]) : floatvec(res);
  };
  const expOf = (a: CX): CX => {
    const e = ap1('exp', a.re);
    return { re: ap2('*', e, ap1('cos', a.im)), im: ap2('*', e, ap1('sin', a.im)) };
  };
  const logOf = (a: CX): CX => ({ re: ap1('log', absOf(a)), im: argOf(a) });
  const scaleReal = (a: CX, k: QValue): CX => ({
    re: ap2('*', a.re, k),
    im: ap2('*', a.im, k),
  });
  const polar = (r: QValue, th: QValue): CX => ({
    re: ap2('*', r, ap1('cos', th)),
    im: ap2('*', r, ap1('sin', th)),
  });
  const powOf = (a: CX, p: QValue): CX => {
    // exp(p * log a), which also covers fractional and negative powers
    return expOf(mul(toC(p), logOf(a)));
  };

  // ------------------------------------------------------------ construction

  ip.def({
    name: '.c.z',
    ranks: [1, 2],
    noInfix: true, // variadic, so it is only ever applied prefix
    f: (_ip, a) => (a.length === 1 ? out(toC(a[0])) : mk(a[0], a[1])),
    doc: 'A complex number (or vector of them) from real and imaginary parts.',
    sig: '.c.z[re;im]',
    ex: ['.c.z[3;4]', '.c.z[til 5;1]'],
  });
  ip.globals.set('.c.i', mk(float(0), float(1)));
  ip.globals.set('.c.one', mk(float(1), float(0)));
  ip.globals.set('.c.zero', mk(float(0), float(0)));

  def(
    '.c.re',
    [1],
    (_ip, [z]) => toC(z).re,
    'The real part.',
    '.c.re z',
    ['.c.re .c.z[3;4]']
  );
  def('.c.im', [1], (_ip, [z]) => toC(z).im, 'The imaginary part.', '.c.im z', ['.c.im .c.z[3;4]']);
  def(
    '.c.polar',
    [2],
    (_ip, [r, th]) => out(polar(r, th)),
    'A complex number from modulus and argument.',
    '.c.polar[r;angle]',
    ['.c.polar[1;pi%4]']
  );
  def(
    '.c.expi',
    [1],
    (_ip, [th]) => out(polar(float(1), th)),
    'e to the i times theta: the unit circle.',
    '.c.expi theta',
    ['.c.expi pi']
  );
  def(
    '.c.roots',
    [1],
    (_ip, [n]) => {
      const k = Math.max(1, Math.trunc(num(n)));
      const th = new Array(k);
      for (let i = 0; i < k; i++) th[i] = (2 * Math.PI * i) / k;
      return out(polar(float(1), floatvec(th)));
    },
    'The n complex roots of unity - instant regular polygons.',
    '.c.roots n',
    ['.c.roots 5']
  );

  // ------------------------------------------------------------ arithmetic

  const dyad = (
    name: string,
    f: (a: CX, b: CX) => CX,
    doc: string,
    ex: string[]
  ) =>
    def(
      name,
      [2],
      (_ip, [a, b]) => out(f(toC(a), toC(b))),
      doc,
      `${name}[z1;z2]`,
      ex
    );

  dyad('.c.add', add, 'Add. Either side may be an ordinary real number.', ['.c.add[.c.z[1;2];.c.z[3;4]]']);
  dyad('.c.sub', sub, 'Subtract.', ['.c.sub[.c.z[1;2];1]']);
  dyad('.c.mul', mul, 'Multiply - the one you cannot do with plain q arithmetic.', [
    '.c.mul[.c.z[0;1];.c.z[0;1]]',
  ]);
  dyad('.c.div', div, 'Divide.', ['.c.div[.c.z[1;0];.c.z[0;1]]']);

  def('.c.neg', [1], (_ip, [z]) => out(scaleReal(toC(z), long(-1))), 'Negate.', '.c.neg z');
  def(
    '.c.conj',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      return mk(c.re, ap2('*', c.im, long(-1)));
    },
    'The complex conjugate.',
    '.c.conj z',
    ['.c.conj .c.z[3;4]']
  );
  def(
    '.c.inv',
    [1],
    (_ip, [z]) => out(div(toC(float(1)), toC(z))),
    'The reciprocal 1%z.',
    '.c.inv z',
    ['.c.inv .c.z[0;2]']
  );
  def(
    '.c.abs',
    [1],
    (_ip, [z]) => absOf(toC(z)),
    'The modulus (distance from the origin).',
    '.c.abs z',
    ['.c.abs .c.z[3;4]']
  );
  def(
    '.c.abs2',
    [1],
    (_ip, [z]) => abs2(toC(z)),
    'The squared modulus - cheaper than .c.abs when you only need a comparison.',
    '.c.abs2 z'
  );
  def(
    '.c.arg',
    [1],
    (_ip, [z]) => argOf(toC(z)),
    'The argument (angle from the positive real axis), in radians.',
    '.c.arg z',
    ['.c.arg .c.z[0;1]']
  );
  def('.c.exp', [1], (_ip, [z]) => out(expOf(toC(z))), 'e to the power z.', '.c.exp z', [
    '.c.exp .c.mul[.c.i;pi]',
  ]);
  def('.c.log', [1], (_ip, [z]) => out(logOf(toC(z))), 'The principal logarithm.', '.c.log z');
  def(
    '.c.sqrt',
    [1],
    (_ip, [z]) => out(powOf(toC(z), float(0.5))),
    'The principal square root.',
    '.c.sqrt z',
    ['.c.sqrt .c.z[-1;0]']
  );
  def(
    '.c.pow',
    [2],
    (_ip, [z, p]) => out(powOf(toC(z), p)),
    'z to the power p (p may be real or complex).',
    '.c.pow[z;p]',
    ['.c.pow[.c.z[0;1];2]']
  );
  def(
    '.c.sin',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      const eIz = expOf(mul(toC(mk(float(0), float(1))), c));
      const eMz = expOf(mul(toC(mk(float(0), float(-1))), c));
      return out(div(sub(eIz, eMz), toC(mk(float(0), float(2)))));
    },
    'Complex sine.',
    '.c.sin z'
  );
  def(
    '.c.cos',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      const eIz = expOf(mul(toC(mk(float(0), float(1))), c));
      const eMz = expOf(mul(toC(mk(float(0), float(-1))), c));
      return out(scaleReal(add(eIz, eMz), float(0.5)));
    },
    'Complex cosine.',
    '.c.cos z'
  );
  def(
    '.c.rot',
    [2],
    (_ip, [z, th]) => out(mul(toC(z), polar(float(1), th))),
    'Rotate z about the origin by an angle in radians.',
    '.c.rot[z;angle]',
    ['.c.rot[.c.z[1;0];pi%2]']
  );

  def(
    '.c.sum',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      return mk(ap1('sum', c.re), ap1('sum', c.im));
    },
    'Sum a complex vector.',
    '.c.sum z'
  );
  def(
    '.c.avg',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      return mk(ap1('avg', c.re), ap1('avg', c.im));
    },
    'The mean of a complex vector (its centre of mass).',
    '.c.avg z'
  );

  // ------------------------------------------------------------ shapes & views

  def(
    '.c.tbl',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      const n = Math.max(isAtom(c.re) ? 1 : count(c.re), isAtom(c.im) ? 1 : count(c.im));
      return table(
        ['re', 'im'],
        [isAtom(c.re) ? fillVec(c.re, n) : c.re, isAtom(c.im) ? fillVec(c.im, n) : c.im]
      );
    },
    'As a table of re and im columns - one row per number, ready for select.',
    '.c.tbl z',
    ['.c.tbl .c.roots 5']
  );

  def(
    '.c.str',
    [1],
    (ip2, [z]) => {
      const c = toC(z);
      const rs = nums(c.re);
      const is = nums(c.im);
      const n = Math.max(rs.length, is.length);
      const prec = ip2.fmt.precision;
      const one = (i: number) => {
        const r = rs[i % rs.length];
        const m = is[i % is.length];
        const rt = gfmt(r, prec);
        const it = gfmt(Math.abs(m), prec);
        return `${rt}${m < 0 ? '-' : '+'}${it}i`;
      };
      if (isAtom(c.re) && isAtom(c.im)) return str(one(0));
      const outs: QValue[] = [];
      for (let i = 0; i < n; i++) outs.push(str(one(i)));
      return listFrom(outs);
    },
    'Human-readable "3+4i" strings.',
    '.c.str z',
    ['.c.str .c.z[3;-4]']
  );

  def(
    '.c.show',
    [1],
    (ip2, [z]) => {
      const s = ip2.apply(ip2.globals.get('.c.str')!, [z]);
      const lines = s.t === 10 ? [(s as QVector).v as string] : items(s).map((e) => (e as QVector).v as string);
      ip2.out(lines.join('\n'));
      return UNIT;
    },
    'Print a complex value in a+bi form.',
    '.c.show z'
  );

  def(
    '.c.grid',
    [4],
    (_ip, [nx, ny, z0, z1]) => {
      const w = Math.max(1, Math.trunc(num(nx)));
      const h = Math.max(1, Math.trunc(num(ny)));
      const a = toC(z0);
      const b = toC(z1);
      const x0 = num(isAtom(a.re) ? a.re : at(a.re, 0));
      const y0 = num(isAtom(a.im) ? a.im : at(a.im, 0));
      const x1 = num(isAtom(b.re) ? b.re : at(b.re, 0));
      const y1 = num(isAtom(b.im) ? b.im : at(b.im, 0));
      const re = new Array(w * h);
      const im = new Array(w * h);
      let k = 0;
      for (let j = 0; j < h; j++) {
        const y = h === 1 ? y0 : y0 + ((y1 - y0) * j) / (h - 1);
        for (let i = 0; i < w; i++) {
          re[k] = w === 1 ? x0 : x0 + ((x1 - x0) * i) / (w - 1);
          im[k] = y;
          k++;
        }
      }
      return mk(floatvec(re), floatvec(im));
    },
    'A row-major nx by ny grid of complex numbers spanning the rectangle z0..z1.',
    '.c.grid[nx;ny;z0;z1]',
    ['.c.grid[3;2;.c.z[-1;-1];.c.z[1;1]]']
  );

  ip.def({
    name: '.c.escape',
    ranks: [3, 4],
    noInfix: true,
    doc: 'Escape-time iteration of z:=z*z+c. Returns how many steps each point survived - Mandelbrot when z0 is 0, Julia when c is fixed.',
    sig: '.c.escape[z0;c;maxIter]  ·  .c.escape[z0;c;maxIter;radius]',
    ex: ['.c.escape[0;.c.grid[8;4;.c.z[-2;-1];.c.z[1;1]];50]'],
    f: (_ip, a) => {
      // z := z*z + c, counting iterations until |z| exceeds the radius
      const z0 = toC(a[0]);
      const cc = toC(a[1]);
      const maxIter = Math.max(1, Math.trunc(num(a[2])));
      const radius = a.length > 3 ? num(a[3]) : 2;
      const r2 = radius * radius;
      const zr = nums(z0.re);
      const zi = nums(z0.im);
      const cr = nums(cc.re);
      const ci = nums(cc.im);
      const n = Math.max(zr.length, zi.length, cr.length, ci.length);
      if (n > 4_000_000) throw new QError('limit', 'too many points');
      const outv = new Array(n);
      for (let k = 0; k < n; k++) {
        let x = zr[k % zr.length];
        let y = zi[k % zi.length];
        const px = cr[k % cr.length];
        const py = ci[k % ci.length];
        let i = 0;
        for (; i < maxIter; i++) {
          const x2 = x * x;
          const y2 = y * y;
          if (x2 + y2 > r2) break;
          y = 2 * x * y + py;
          x = x2 - y2 + px;
        }
        outv[k] = i;
      }
      return longvec(outv);
    },
  });

  def(
    '.c.fft',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      const { re, im } = fft(nums(c.re), nums(c.im), false);
      return mk(floatvec(re), floatvec(im));
    },
    'Fast Fourier transform (the input is zero-padded to a power of two).',
    '.c.fft z',
    ['.c.abs .c.fft sin 0.4*til 16']
  );
  def(
    '.c.ifft',
    [1],
    (_ip, [z]) => {
      const c = toC(z);
      const { re, im } = fft(nums(c.re), nums(c.im), true);
      return mk(floatvec(re), floatvec(im));
    },
    'Inverse fast Fourier transform.',
    '.c.ifft z'
  );
}

/** iterative radix-2 Cooley-Tukey, zero-padded to a power of two */
function fft(reIn: number[], imIn: number[], inverse: boolean): { re: number[]; im: number[] } {
  const len = Math.max(reIn.length, imIn.length);
  let n = 1;
  while (n < len) n <<= 1;
  const re = new Array(n).fill(0);
  const im = new Array(n).fill(0);
  for (let i = 0; i < len; i++) {
    re[i] = reIn[i % reIn.length] ?? 0;
    im[i] = imIn[i % imIn.length] ?? 0;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += size) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < size / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + size / 2] * cwr - im[i + j + size / 2] * cwi;
        const vi = re[i + j + size / 2] * cwi + im[i + j + size / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + size / 2] = ur - vr;
        im[i + j + size / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  return { re, im };
}
