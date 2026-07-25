// Shape constructors: the friendly front door to scene tables.
//
// Everything here just builds an ordinary q table, so the result can still be
// filtered, updated and joined with the rest of the language.
//
// Position is a 2-vector column `p` (and `p2` for line ends). That means the
// same arithmetic that moves a particle — `v:v+a; p:p+v` — also builds scenes:
// tables teach columns, vectors teach geometry.

import type { Interp } from '../q/eval';
import { fillVec } from '../q/eval';
import {
  QValue,
  QAtom,
  QTable,
  QVector,
  table,
  sym,
  float,
  floatvec,
  listFrom,
  items,
  count,
  at,
  isAtom,
  isTable,
  isFunc,
  QError,
} from '../q/value';

/** Build a scene table, broadcasting atoms to the longest column. */
export function sceneTable(cols: Record<string, QValue | undefined>): QTable {
  const names: string[] = [];
  const vals: QValue[] = [];
  for (const [k, v] of Object.entries(cols)) {
    if (v === undefined) continue;
    names.push(k);
    vals.push(v);
  }
  let n = 1;
  for (const v of vals) if (!isAtom(v) && !isFunc(v)) n = Math.max(n, count(v));
  const full = vals.map((v) => {
    if (isAtom(v) || isFunc(v)) return fillVec(v, n);
    if (count(v) === n) return v;
    if (count(v) === 1) return fillVec(at(v, 0), n);
    throw new QError(
      'length',
      `shape arguments must be the same length (got ${count(v)} and ${n})`
    );
  });
  return table(names, full);
}

/** Text columns want a list of strings, one per row. */
function textCol(v: QValue, n: number): QValue {
  if (v.t === 10) return listFrom(new Array(Math.max(n, 1)).fill(v));
  if (v.t === -11 || v.t === 11 || v.t === 0) return v;
  return v;
}

const nOf = (v: QValue): number => {
  if (isAtom(v)) {
    const x = (v as QAtom).v;
    return typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? x : 0;
  }
  return 0;
};

const nums = (v: QValue): number[] => {
  if (isAtom(v)) return [nOf(v)];
  const n = count(v);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = nOf(at(v, i));
  return out;
};

/** Coerce one point to a float 2-vector. */
function asPoint(v: QValue): QValue {
  if (v.t >= 1 && v.t <= 9) {
    const a = (v as QVector).v as number[];
    if (a.length !== 2)
      throw new QError('type', 'each point must be a 2-vector (x;y)');
    return v.t === 9 ? v : floatvec([a[0], a[1]]);
  }
  if (v.t === 0 && count(v) === 2) return floatvec([nOf(at(v, 0)), nOf(at(v, 1))]);
  if (isAtom(v))
    throw new QError('type', 'a point is a 2-vector, not an atom — write 100 150f');
  throw new QError('type', 'each point must be a 2-vector (x;y)');
}

const isFlatNum = (v: QValue): boolean =>
  isAtom(v) || (v.t >= 1 && v.t <= 9);

/**
 * Normalize a position argument into a column of 2-vectors.
 *
 * Accepts:
 *   100 150f              — one point
 *   (p0;p1;p2)            — list of points
 *   flip (xs;ys)          — same, from two series
 *   (xs;ys)               — matrix form (when not already two 2-vectors)
 */
export function pointsCol(v: QValue): QValue {
  // (xs;ys) matrix — but (p0;p1) where each is a 2-vector is a list of points
  if (v.t === 0 && count(v) === 2) {
    const a = at(v, 0),
      b = at(v, 1);
    if (isFlatNum(a) && isFlatNum(b)) {
      const na = isAtom(a) ? 1 : count(a);
      const nb = isAtom(b) ? 1 : count(b);
      // two 2-vectors → two points (use flip (xs;ys) for the 2-point matrix)
      if (!isAtom(a) && !isAtom(b) && na === 2 && nb === 2)
        return listFrom([asPoint(a), asPoint(b)]);
      if (isAtom(a) && isAtom(b)) return listFrom([floatvec([nOf(a), nOf(b)])]);
      return zipPoints(a, b);
    }
  }
  // typed numeric 2-vector → one point
  if (v.t >= 1 && v.t <= 9) {
    const a = (v as QVector).v as number[];
    if (a.length === 2) return listFrom([v.t === 9 ? v : floatvec([a[0], a[1]])]);
    throw new QError(
      'type',
      'p must be a 2-vector or a list of them — build many with flip (xs;ys)'
    );
  }
  // general list of points
  if (v.t === 0) return listFrom(items(v).map(asPoint));
  throw new QError('type', 'p must be a 2-vector or a list of 2-vectors');
}

/** Zip two numeric series into a column of points. */
function zipPoints(xs: QValue, ys: QValue): QValue {
  const x = nums(xs),
    y = nums(ys);
  const n = Math.max(x.length, y.length);
  const pts: QValue[] = [];
  for (let i = 0; i < n; i++) pts.push(floatvec([x[i % x.length], y[i % y.length]]));
  return listFrom(pts);
}

export function installShapes(ip: Interp) {
  const def = (
    name: string,
    ranks: number[],
    f: (ip: Interp, args: QValue[]) => QValue,
    doc?: string,
    sig?: string,
    ex?: string[]
  ) => ip.def({ name, ranks, f, doc, sig, ex });

  // ---------------------------------------------------------------- shapes

  def(
    'circles',
    [2, 3],
    (_ip, a) =>
      sceneTable({
        shape: sym('circle'),
        p: pointsCol(a[0]),
        r: a[1] ?? float(10),
        fill: a[2],
      }),
    'A table of circles. p is a 2-vector (or a list of them).',
    'circles[p;r]  ·  circles[p;r;fill]',
    [
      'circles[100 150f;40]',
      'circles[flip (100 200 300f;150 150 150f);30;`gold`crimson`mint]',
    ]
  );

  def(
    'rings',
    [2, 3],
    (_ip, a) =>
      sceneTable({
        shape: sym('ring'),
        p: pointsCol(a[0]),
        r: a[1] ?? float(10),
        stroke: a[2],
        sw: float(2),
      }),
    'Circle outlines.',
    'rings[p;r]  ·  rings[p;r;stroke]',
    ['rings[.p5.cp;20*1+til 6]']
  );

  def(
    'rects',
    [3, 4],
    (_ip, a) =>
      sceneTable({
        shape: sym('rect'),
        p: pointsCol(a[0]),
        w: a[1],
        h: a[2],
        fill: a[3],
      }),
    'A table of rectangles, centred on p.',
    'rects[p;w;h]  ·  rects[p;w;h;fill]',
    ['rects[100 150f;60;40;`teal]']
  );

  def(
    'squares',
    [2, 3],
    (_ip, a) =>
      sceneTable({
        shape: sym('rect'),
        p: pointsCol(a[0]),
        w: a[1],
        h: a[1],
        fill: a[2],
      }),
    'Squares of side s.',
    'squares[p;s]  ·  squares[p;s;fill]',
    ['squares[flip (50*1+til 8;8#100f);30]']
  );

  def(
    'bars',
    [3, 4],
    (_ip, a) => {
      // bars grow upwards from a baseline y — xs stay 1-D; we build p for you
      const xs = nums(a[0]);
      const base = nums(a[1]);
      const hh = nums(a[3] === undefined ? a[2] : a[3]);
      const n = Math.max(xs.length, base.length, hh.length);
      const pts: QValue[] = [];
      for (let i = 0; i < n; i++) {
        const h = hh[i % hh.length];
        pts.push(floatvec([xs[i % xs.length], base[i % base.length] - h / 2]));
      }
      return sceneTable({
        shape: sym('rect'),
        p: listFrom(pts),
        w: a[3] === undefined ? float(12) : a[2],
        h: floatvec(Array.from({ length: n }, (_, i) => hh[i % hh.length])),
        fill: a[4],
      });
    },
    'Bars standing on a baseline: bars[xs;baseline;height] or bars[xs;baseline;width;height].',
    'bars[xs;y0;h]  ·  bars[xs;y0;w;h]',
    ['bars[40*1+til 10;300;20;10*1+til 10]']
  );

  def(
    'lines',
    [2, 3],
    (_ip, a) =>
      sceneTable({
        shape: sym('line'),
        p: pointsCol(a[0]),
        p2: pointsCol(a[1]),
        stroke: a[2],
        sw: float(1.5),
      }),
    'Line segments from p to p2.',
    'lines[p;p2]  ·  lines[p;p2;stroke]',
    ['lines[flip (0 100f;0 0f); flip (200 300f;200 200f);`white]']
  );

  def(
    'tris',
    [2, 3],
    (_ip, a) =>
      sceneTable({
        shape: sym('tri'),
        p: pointsCol(a[0]),
        r: a[1],
        fill: a[2],
      }),
    'Triangles, r is the distance from the centre to a corner.',
    'tris[p;r]  ·  tris[p;r;fill]',
    ['tris[flip (100 200f;150 150f);30;`mint]']
  );

  def(
    'ngons',
    [3, 4],
    (_ip, a) =>
      sceneTable({
        shape: sym('ngon'),
        p: pointsCol(a[0]),
        r: a[1],
        n: a[2],
        fill: a[3],
      }),
    'Regular polygons with n sides.',
    'ngons[p;r;n]  ·  ngons[p;r;n;fill]',
    ['ngons[flip (80*1+til 5;5#150f);30;3+til 5]']
  );

  def(
    'points',
    [1, 2],
    (_ip, a) =>
      sceneTable({
        shape: sym('point'),
        p: pointsCol(a[0]),
        sw: float(3),
        fill: a[1],
      }),
    'Single pixels (fast for thousands of them).',
    'points p  ·  points[p;colour]',
    ['points flip (100?400f;100?300f)']
  );

  def(
    'texts',
    [2, 3],
    (_ip, a) => {
      const p = pointsCol(a[0]);
      const n = count(p);
      return sceneTable({
        shape: sym('text'),
        p,
        txt: textCol(a[1], n),
        size: a[2] ?? float(14),
      });
    },
    'Text labels.',
    'texts[p;txt]  ·  texts[p;txt;size]',
    ['texts[.p5.cp;"hello q"]', 'texts[flip (60*1+til 3;3#100f);string 1 2 3]']
  );

  def(
    'arcs',
    [4, 5],
    (_ip, a) =>
      sceneTable({
        shape: sym('arc'),
        p: pointsCol(a[0]),
        r: a[1],
        a0: a[2],
        a1: a[3],
        stroke: a[4],
        sw: float(2),
      }),
    'Arcs from angle a0 to a1 (radians).',
    'arcs[p;r;a0;a1]',
    ['arcs[.p5.cp;80;0;pi]']
  );

  const pathLike = (shape: string) => (_ip: Interp, a: QValue[]) => {
    let pts: QValue;
    let colour: QValue | undefined;
    // path[xs;ys] / path[xs;ys;stroke] when both leading args are flat numerics
    if (a.length >= 2 && isFlatNum(a[0]) && isFlatNum(a[1])) {
      pts = zipPoints(a[0], a[1]);
      colour = a[2];
    } else {
      pts = pointsCol(a[0]);
      colour = a[1];
    }
    // one path row whose pts cell holds every vertex
    return sceneTable({
      shape: sym(shape),
      pts: listFrom([pts]),
      stroke: colour ?? sym('#5ec2ff'),
      fill: shape === 'poly' ? colour : undefined,
      sw: float(2),
    });
  };

  def(
    'path',
    [1, 2, 3],
    pathLike('path'),
    'One open path through the given points (a list of 2-vectors, or xs;ys).',
    'path pts  ·  path[pts;stroke]  ·  path[xs;ys]',
    ['path flip (til 300;150+50*sin 0.05*til 300)', 'path[til 300;150+50*sin 0.05*til 300]']
  );

  def(
    'poly',
    [1, 2, 3],
    pathLike('poly'),
    'One closed, filled polygon.',
    'poly pts  ·  poly[pts;fill]  ·  poly[xs;ys;fill]',
    ['poly[100 200 150;100 100 200;`gold]', 'poly[flip (100 200 150f;100 100 200f);`gold]']
  );

  // ---------------------------------------------------------------- combinators

  const styler = (col: string, doc: string, sig: string, ex: string[]) =>
    def(
      col,
      [2],
      (_ip2, a) => {
        const scene = a[0];
        if (!isTable(scene)) throw new QError('type', `${col} expects a scene table`);
        const t = scene as QTable;
        const nt = table(t.c.slice(), t.v.slice());
        const setCol = (name: string, v: QValue) => {
          const i = nt.c.indexOf(name);
          const full = isAtom(v) ? fillVec(v, count(t)) : v;
          if (i < 0) {
            nt.c.push(name);
            nt.v.push(full);
          } else nt.v[i] = full;
        };
        if (col === 'paint') setCol('fill', a[1]);
        else if (col === 'outline') {
          setCol('stroke', a[1]);
          if (!nt.c.includes('sw')) setCol('sw', float(1.5));
        } else if (col === 'fade') setCol('a', a[1]);
        else if (col === 'spin') setCol('rot', a[1]);
        return nt;
      },
      doc,
      sig,
      ex
    );

  styler('paint', 'Set the fill colour of a scene.', 'paint[scene;colour]', [
    'paint[circles[100 150f;40];`gold]',
  ]);
  styler('outline', 'Set the stroke colour of a scene.', 'outline[scene;colour]', [
    'outline[rects[150 150f;80;60];`white]',
  ]);
  styler('fade', 'Set the alpha (0-1) of a scene.', 'fade[scene;alpha]', [
    'fade[circles[100 150f;40];0.3]',
  ]);
  styler('spin', 'Rotate every shape (radians).', 'spin[scene;angle]', [
    'spin[rects[150 150f;80;30];0.4]',
  ]);

  def(
    'nudge',
    [2],
    (ip2, [scene, dp]) => {
      if (!isTable(scene)) throw new QError('type', 'nudge expects a scene table');
      const t = scene as QTable;
      const nt = table(t.c.slice(), t.v.slice());
      const d = asPoint(dp);
      const addEach = (pts: QValue) =>
        ip2.eachLeft(ip2.verbValue('+'), [pts, d]);
      const bump = (name: string) => {
        const i = nt.c.indexOf(name);
        if (i < 0) return;
        // p +\: dp  — add the 2-vector to every point
        nt.v[i] = addEach(nt.v[i]);
      };
      bump('p');
      bump('p2');
      bump('p3');
      // path vertices
      const pi = nt.c.indexOf('pts');
      if (pi >= 0) {
        const col = nt.v[pi];
        const n = count(col);
        const out: QValue[] = [];
        for (let i = 0; i < n; i++) out.push(addEach(at(col, i)));
        nt.v[pi] = listFrom(out);
      }
      return nt;
    },
    'Move a whole scene by a 2-vector dp.',
    'nudge[scene;dp]',
    ['nudge[circles[50 50f;20];100 40f]']
  );

  // ---------------------------------------------------------------- plotting

  const canvasW = () => (ip as any).__rt?.p?.width ?? 800;
  const canvasH = () => (ip as any).__rt?.p?.height ?? 600;

  const fitTo = (v: number[], lo: number, hi: number): number[] => {
    let mn = Infinity,
      mx = -Infinity;
    for (const x of v) {
      if (Number.isNaN(x)) continue;
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    if (!Number.isFinite(mn)) return v.map(() => (lo + hi) / 2);
    const span = mx - mn || 1;
    return v.map((x) => lo + ((x - mn) / span) * (hi - lo));
  };

  def(
    'fitx',
    [1],
    (_ip, [v]) => floatvec(fitTo(nums(v), 40, canvasW() - 40)),
    'Scale a vector across the canvas width (40px margins).',
    'fitx v',
    ['fitx til 10']
  );
  def(
    'fity',
    [1],
    (_ip, [v]) => floatvec(fitTo(nums(v), canvasH() - 40, 40)),
    'Scale a vector up the canvas height - bigger values are higher.',
    'fity v',
    ['fity 1 5 3 9']
  );

  const SERIES_COLOURS = ['#5ec2ff', '#ff7ab2', '#7ee787', '#ffd479', '#b892ff'];

  def(
    'plot',
    [1, 2, 3],
    (ip2, a) => {
      const yArg = a.length === 1 ? a[0] : a[1];
      // several series plot on one shared scale
      const many =
        yArg.t === 0 && count(yArg) > 0 && !isAtom(at(yArg, 0)) && !isTable(yArg);
      const series: number[][] = many ? items(yArg).map((v) => nums(v)) : [nums(yArg)];
      const xs = a.length === 1 ? series[0].map((_, i) => i) : nums(a[0]);
      const allY: number[] = [];
      for (const s2 of series) allY.push(...s2);
      const scaledY = fitTo(allY, canvasH() - 40, 40);
      const px = fitTo(xs, 40, canvasW() - 40);
      let off = 0;
      const parts: QValue[] = [];
      series.forEach((s2, si) => {
        const py = scaledY.slice(off, off + s2.length);
        off += s2.length;
        const colour =
          a[2] !== undefined && !many
            ? a[2]
            : a[2] !== undefined && many && !isAtom(a[2])
              ? at(a[2], si % count(a[2]))
              : sym(SERIES_COLOURS[si % SERIES_COLOURS.length]);
        parts.push(
          ip2.apply(ip2.globals.get('path')!, [
            floatvec(px.slice(0, py.length)),
            floatvec(py),
            colour,
          ])
        );
      });
      if (parts.length === 1) return parts[0];
      return parts.reduce((acc, p2) => ip2.apply(ip2.verbValue(','), [acc, p2]));
    },
    'A line chart, scaled to the canvas. Give it a list of vectors to draw several series on one scale.',
    'plot y  ·  plot[x;y]  ·  plot (y1;y2)',
    ['plot sums 200?1.0', 'plot (px;20 mavg px)']
  );

  def(
    'scatter',
    [2, 3, 4],
    (ip2, a) => {
      const px = fitTo(nums(a[0]), 40, canvasW() - 40);
      const py = fitTo(nums(a[1]), canvasH() - 40, 40);
      return ip2.apply(ip2.globals.get('circles')!, [
        zipPoints(floatvec(px), floatvec(py)),
        a[2] ?? float(4),
        a[3] ?? sym('#7dd3fc'),
      ]);
    },
    'A scatter plot of x against y, scaled to the canvas.',
    'scatter[x;y]  ·  scatter[x;y;r;colour]',
    ['scatter[til 50;noise 0.1*til 50]']
  );
}
