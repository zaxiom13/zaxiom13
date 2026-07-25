// Shape constructors: the friendly front door to scene tables.
//
// Everything here just builds an ordinary q table, so the result can still be
// filtered, updated and joined with the rest of the language.

import type { Interp } from '../q/eval';
import { fillVec } from '../q/eval';
import {
  QValue,
  QAtom,
  QTable,
  QVector,
  table,
  sym,
  symvec,
  str,
  float,
  floatvec,
  longvec,
  listFrom,
  fromItems,
  items,
  count,
  at,
  isAtom,
  isTable,
  isDict,
  isFunc,
  QError,
  QDict,
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

export function installShapes(ip: Interp) {
  const def = (
    name: string,
    ranks: number[],
    f: (ip: Interp, args: QValue[]) => QValue,
    doc?: string,
    sig?: string,
    ex?: string[]
  ) => ip.def({ name, ranks, f, doc, sig, ex });

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

  // ---------------------------------------------------------------- shapes

  def(
    'circles',
    [2, 3, 4],
    (_ip, a) =>
      sceneTable({
        shape: sym('circle'),
        x: a[0],
        y: a[1],
        r: a[2] ?? float(10),
        fill: a[3],
      }),
    'A table of circles.',
    'circles[x;y;r]  ·  circles[x;y;r;fill]',
    ['circles[100 200 300;150;40]', 'circles[100 200;150;30;`gold`crimson]']
  );

  def(
    'rings',
    [2, 3, 4],
    (_ip, a) =>
      sceneTable({
        shape: sym('ring'),
        x: a[0],
        y: a[1],
        r: a[2] ?? float(10),
        stroke: a[3],
        sw: float(2),
      }),
    'Circle outlines.',
    'rings[x;y;r]  ·  rings[x;y;r;stroke]',
    ['rings[.p5.cx;.p5.cy;20*1+til 6]']
  );

  def(
    'rects',
    [4, 5],
    (_ip, a) =>
      sceneTable({ shape: sym('rect'), x: a[0], y: a[1], w: a[2], h: a[3], fill: a[4] }),
    'A table of rectangles, centred on x,y.',
    'rects[x;y;w;h]  ·  rects[x;y;w;h;fill]',
    ['rects[100 200;150;60;40;`teal]']
  );

  def(
    'squares',
    [3, 4],
    (_ip, a) =>
      sceneTable({ shape: sym('rect'), x: a[0], y: a[1], w: a[2], h: a[2], fill: a[3] }),
    'Squares of side s.',
    'squares[x;y;s]  ·  squares[x;y;s;fill]',
    ['squares[50*1+til 8;100;30]']
  );

  def(
    'bars',
    [3, 4],
    (_ip, a) => {
      // bars grow upwards from a baseline y
      const base = nums(a[1]);
      const h = nums(a[3] ?? a[2]);
      const hh = a[3] === undefined ? nums(a[2]) : h;
      const n = Math.max(base.length, hh.length);
      const ys = new Array(n);
      for (let i = 0; i < n; i++) ys[i] = base[i % base.length] - hh[i % hh.length] / 2;
      return sceneTable({
        shape: sym('rect'),
        x: a[0],
        y: floatvec(ys),
        w: a[3] === undefined ? float(12) : a[2],
        h: floatvec(hh.slice(0, n).length === n ? hh : hh),
        fill: a[4],
      });
    },
    'Bars standing on a baseline: bars[x;baseline;height] or bars[x;baseline;width;height].',
    'bars[x;y0;h]  ·  bars[x;y0;w;h]',
    ['bars[40*1+til 10;300;20;10*1+til 10]']
  );

  def(
    'lines',
    [4, 5],
    (_ip, a) =>
      sceneTable({
        shape: sym('line'),
        x: a[0],
        y: a[1],
        x2: a[2],
        y2: a[3],
        stroke: a[4],
        sw: float(1.5),
      }),
    'Line segments from x,y to x2,y2.',
    'lines[x;y;x2;y2]  ·  lines[x;y;x2;y2;stroke]',
    ['lines[0 100;0 0;200 300;200 200;`white]']
  );

  def(
    'tris',
    [3, 4],
    (_ip, a) => sceneTable({ shape: sym('tri'), x: a[0], y: a[1], r: a[2], fill: a[3] }),
    'Triangles, r is the distance from the centre to a corner.',
    'tris[x;y;r]  ·  tris[x;y;r;fill]',
    ['tris[100 200;150;30;`mint]']
  );

  def(
    'ngons',
    [4, 5],
    (_ip, a) =>
      sceneTable({ shape: sym('ngon'), x: a[0], y: a[1], r: a[2], n: a[3], fill: a[4] }),
    'Regular polygons with n sides.',
    'ngons[x;y;r;n]  ·  ngons[x;y;r;n;fill]',
    ['ngons[80*1+til 5;150;30;3+til 5]']
  );

  def(
    'points',
    [2, 3],
    (_ip, a) => sceneTable({ shape: sym('point'), x: a[0], y: a[1], sw: float(3), fill: a[2] }),
    'Single pixels (fast for thousands of them).',
    'points[x;y]  ·  points[x;y;colour]',
    ['points[100?400f;100?300f]']
  );

  def(
    'texts',
    [3, 4],
    (_ip, a) => {
      const n = Math.max(
        isAtom(a[0]) ? 1 : count(a[0]),
        isAtom(a[1]) ? 1 : count(a[1]),
        a[2].t === 10 ? 1 : count(a[2])
      );
      return sceneTable({
        shape: sym('text'),
        x: a[0],
        y: a[1],
        txt: textCol(a[2], n),
        size: a[3] ?? float(14),
      });
    },
    'Text labels.',
    'texts[x;y;txt]  ·  texts[x;y;txt;size]',
    ['texts[.p5.cx;.p5.cy;"hello q"]', 'texts[60*1+til 3;100;string 1 2 3]']
  );

  def(
    'arcs',
    [5, 6],
    (_ip, a) =>
      sceneTable({
        shape: sym('arc'),
        x: a[0],
        y: a[1],
        r: a[2],
        a0: a[3],
        a1: a[4],
        stroke: a[5],
        sw: float(2),
      }),
    'Arcs from angle a0 to a1 (radians).',
    'arcs[x;y;r;a0;a1]',
    ['arcs[.p5.cx;.p5.cy;80;0;pi]']
  );

  const pathLike = (shape: string) => (_ip: Interp, a: QValue[]) => {
    const xs = nums(a[0]);
    const ys = nums(a[1]);
    const n = Math.max(xs.length, ys.length);
    const pts: QValue[] = [];
    for (let i = 0; i < n; i++)
      pts.push(floatvec([xs[i % xs.length], ys[i % ys.length]]));
    return sceneTable({
      shape: sym(shape),
      pts: listFrom([listFrom(pts)]),
      stroke: a[2] ?? sym('#5ec2ff'),
      fill: shape === 'poly' ? a[2] : undefined,
      sw: float(2),
    });
  };

  def(
    'path',
    [2, 3],
    pathLike('path'),
    'One open path through the given points.',
    'path[xs;ys]  ·  path[xs;ys;stroke]',
    ['path[til 300;150+50*sin 0.05*til 300]']
  );

  def(
    'poly',
    [2, 3],
    pathLike('poly'),
    'One closed, filled polygon.',
    'poly[xs;ys]  ·  poly[xs;ys;fill]',
    ['poly[100 200 150;100 100 200;`gold]']
  );

  // ---------------------------------------------------------------- combinators

  const styler = (col: string, doc: string, sig: string, ex: string[]) =>
    def(
      col === 'nudge' ? 'nudge' : col,
      col === 'nudge' ? [3] : [2],
      (ip2, a) => {
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
    'paint[circles[100 200;150;40];`gold]',
  ]);
  styler('outline', 'Set the stroke colour of a scene.', 'outline[scene;colour]', [
    'outline[rects[150;150;80;60];`white]',
  ]);
  styler('fade', 'Set the alpha (0-1) of a scene.', 'fade[scene;alpha]', [
    'fade[circles[100 200;150;40];0.3]',
  ]);
  styler('spin', 'Rotate every shape (radians).', 'spin[scene;angle]', [
    'spin[rects[150;150;80;30];0.4]',
  ]);

  def(
    'nudge',
    [3],
    (ip2, [scene, dx, dy]) => {
      if (!isTable(scene)) throw new QError('type', 'nudge expects a scene table');
      const t = scene as QTable;
      const nt = table(t.c.slice(), t.v.slice());
      const bump = (name: string, d: QValue) => {
        const i = nt.c.indexOf(name);
        if (i < 0) return;
        nt.v[i] = ip2.apply(ip2.verbValue('+'), [nt.v[i], d]);
      };
      bump('x', dx);
      bump('y', dy);
      bump('x2', dx);
      bump('y2', dy);
      return nt;
    },
    'Move a whole scene by dx,dy.',
    'nudge[scene;dx;dy]',
    ['nudge[circles[50;50;20];100;40]']
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
        floatvec(px),
        floatvec(py),
        a[2] ?? float(4),
        a[3] ?? sym('#7dd3fc'),
      ]);
    },
    'A scatter plot of x against y, scaled to the canvas.',
    'scatter[x;y]  ·  scatter[x;y;r;colour]',
    ['scatter[til 50;noise 0.1*til 50]']
  );
}
