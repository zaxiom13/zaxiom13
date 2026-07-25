// Scene tables -> canvas drawing.
//
// A "scene" is an ordinary q table where every row is a shape. Columns are
// optional; anything missing falls back to a default. This is what makes the
// whole thing q-idiomatic: you build pictures with select/update/join.
//
// The renderer reads raw column arrays rather than boxed q values, so a scene
// with tens of thousands of rows costs no allocation per row.

import type p5 from 'p5';
import {
  QValue,
  QTable,
  QDict,
  QAtom,
  QVector,
  count,
  at,
  items,
  isTable,
  isDict,
  isAtom,
  table,
  enlist,
  symvec,
  listFrom,
} from '../q/value';

export const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff3b30',
  orange: '#ff9500',
  yellow: '#ffcc00',
  green: '#34c759',
  mint: '#00c7be',
  teal: '#30b0c7',
  cyan: '#32ade6',
  blue: '#0a84ff',
  indigo: '#5e5ce6',
  purple: '#af52de',
  pink: '#ff2d55',
  brown: '#a2845e',
  gray: '#8e8e93',
  grey: '#8e8e93',
  silver: '#c7c7cc',
  gold: '#ffd60a',
  lime: '#c6ff00',
  navy: '#1c1c5e',
  crimson: '#dc143c',
  magenta: '#ff00ff',
  none: 'none',
  clear: 'none',
};

/** q colour values: `red, `#ff0044, "#ff0044", 0.5 (grey), or 255 200 0 */
export function toColor(v: QValue | undefined, dflt: string): string {
  if (v === undefined) return dflt;
  if (isAtom(v)) {
    const t = Math.abs(v.t);
    const val = (v as QAtom).v;
    if (t === 11 || t === 10) return cssOfString(String(val), dflt);
    if (t === 9 || t === 8) return greyOf(val as number, true);
    if (t === 7 || t === 6 || t === 5 || t === 4) return greyOf(val as number, false);
    if (t === 1) return val ? '#ffffff' : '#000000';
    return dflt;
  }
  if (v.t === 10) return cssOfString((v as QVector).v as string, dflt);
  if (v.t >= 1 && v.t <= 9) {
    const arr = (v as QVector).v as number[];
    if (arr.length >= 3) {
      const sc = v.t === 9 || v.t === 8 ? 255 : 1;
      return `rgb(${Math.round(arr[0] * sc)},${Math.round(arr[1] * sc)},${Math.round(arr[2] * sc)})`;
    }
    if (arr.length === 1) return greyOf(arr[0], v.t === 9 || v.t === 8);
  }
  return dflt;
}

function cssOfString(s: string, dflt: string): string {
  if (!s) return dflt;
  if (s.charCodeAt(0) === 35) return s; // '#'
  return NAMED_COLORS[s.toLowerCase()] ?? s;
}

function greyOf(v: number, unit: boolean): string {
  const g = Math.round(Math.max(0, Math.min(unit ? 1 : 255, v)) * (unit ? 255 : 1));
  return `rgb(${g},${g},${g})`;
}

/** CSS colour with alpha folded in, cached (used by the raw-canvas fast path) */
const alphaCache = new Map<string, string>();
function cssAlpha(css: string, alpha: number): string {
  if (alpha >= 1) return css;
  const key = css + '|' + alpha.toFixed(3);
  let out = alphaCache.get(key);
  if (out === undefined) {
    if (alphaCache.size > 4096) alphaCache.clear();
    let r = 0,
      g = 0,
      b = 0;
    if (css.charCodeAt(0) === 35) {
      const hex = css.length === 4
        ? css[1] + css[1] + css[2] + css[2] + css[3] + css[3]
        : css.slice(1, 7);
      const v = parseInt(hex, 16);
      r = (v >> 16) & 255;
      g = (v >> 8) & 255;
      b = v & 255;
    } else {
      const m = /rgba?\(([^)]+)\)/.exec(css);
      if (m) {
        const parts = m[1].split(',').map((x) => parseFloat(x));
        [r, g, b] = parts;
      }
    }
    out = `rgba(${r},${g},${b},${alpha})`;
    alphaCache.set(key, out);
  }
  return out;
}

// p5 parses colour strings on every call, so cache the parsed objects
const colorCache = new Map<string, any>();
function p5color(p: p5, css: string, alpha: number): any {
  const key = alpha >= 1 ? css : css + '|' + alpha.toFixed(3);
  let c = colorCache.get(key);
  if (c === undefined) {
    if (colorCache.size > 4096) colorCache.clear();
    c = p.color(css);
    if (alpha < 1) (c as any).setAlpha(255 * alpha);
    colorCache.set(key, c);
  }
  return c;
}

export interface DrawOpts {
  defaultFill: string;
  defaultStroke: string;
}

/** A column, unboxed once per frame. */
interface Col {
  n?: number[]; // numeric
  s?: string[]; // symbol / char
  v?: QValue[]; // anything else (nested lists, mixed)
  atomNum?: number;
  atomStr?: string;
  atomVal?: QValue;
}

function unbox(col: QValue): Col {
  const t = col.t;
  if (t === 11) return { s: (col as QVector).v as string[] };
  if (t === 10) return { s: ((col as QVector).v as string).split('') };
  if (t > 0 && t <= 19) return { n: (col as QVector).v as number[] };
  if (t === 0) {
    const arr = (col as QVector).v as QValue[];
    // a column of strings ("abc";"de") is common for text
    if (arr.length && arr.every((e) => e.t === 10))
      return { s: arr.map((e) => (e as QVector).v as string) };
    return { v: arr };
  }
  if (isAtom(col)) {
    const v = (col as QAtom).v;
    if (typeof v === 'string') return { atomStr: v, atomVal: col };
    return { atomNum: typeof v === 'bigint' ? Number(v) : (v as number), atomVal: col };
  }
  return { v: [col] };
}

const numAt = (c: Col | undefined, i: number, dflt: number): number => {
  if (!c) return dflt;
  if (c.n) {
    const v = c.n[i];
    return typeof v === 'number' && !Number.isNaN(v) ? v : dflt;
  }
  if (c.atomNum !== undefined) return c.atomNum;
  if (c.v) {
    const e = c.v[i];
    if (e && isAtom(e)) {
      const v = (e as QAtom).v;
      if (typeof v === 'number') return Number.isNaN(v) ? dflt : v;
      if (typeof v === 'bigint') return Number(v);
    }
  }
  return dflt;
};

const strAt = (c: Col | undefined, i: number): string | undefined => {
  if (!c) return undefined;
  if (c.s) return c.s[i];
  if (c.atomStr !== undefined) return c.atomStr;
  if (c.n) return String(c.n[i]);
  if (c.atomNum !== undefined) return String(c.atomNum);
  if (c.v) {
    const e = c.v[i];
    if (!e) return undefined;
    if (e.t === 10) return (e as QVector).v as string;
    if (isAtom(e)) return String((e as QAtom).v);
  }
  return undefined;
};

const cssAt = (c: Col | undefined, i: number, dflt: string): string => {
  if (!c) return dflt;
  if (c.s) return cssOfString(c.s[i], dflt);
  if (c.atomStr !== undefined) return cssOfString(c.atomStr, dflt);
  if (c.n) return greyOf(c.n[i], !Number.isInteger(c.n[i]));
  if (c.atomNum !== undefined) return greyOf(c.atomNum, !Number.isInteger(c.atomNum));
  if (c.v) return toColor(c.v[i], dflt);
  return dflt;
};

const valAt = (c: Col | undefined, i: number): QValue | undefined => {
  if (!c) return undefined;
  if (c.v) return c.v[i];
  return c.atomVal;
};

/** Draw one scene table (or a list of them) onto a p5 instance. */
export function drawScene(p: p5, scene: QValue, opts: DrawOpts): number {
  // a list of scenes draws them all, so `draw (a;b;c)` works
  if (scene.t === 0 && count(scene) > 0) {
    let total = 0;
    const n = count(scene);
    for (let i = 0; i < n; i++) total += drawScene(p, at(scene, i), opts);
    return total;
  }
  if (isDict(scene) && !isTable(scene)) {
    // a single shape given as a dictionary
    const d = scene as QDict;
    const keys = items(d.k).map((k) => String((k as QAtom).v));
    return drawScene(
      p,
      table(keys, items(d.v).map((v) => enlist(v))),
      opts
    );
  }
  if (!isTable(scene)) return 0;
  const t = scene as QTable;
  const n = count(t);
  if (!n) return 0;

  const cols: Record<string, Col> = Object.create(null);
  t.c.forEach((name, ci) => (cols[name] = unbox(t.v[ci])));

  const shape = cols['shape'];
  const rot = cols['rot'];
  const hasAnyRot = !!rot;
  // big scenes bypass p5 and talk to the canvas directly
  const ctx = n > 400 ? ((p as any).drawingContext as CanvasRenderingContext2D) : null;
  for (let i = 0; i < n; i++) drawRow(p, cols, i, shape, hasAnyRot, opts, ctx);
  return n;
}

/** returns true when the row was drawn straight onto the 2d context */
function fastDraw(
  ctx: CanvasRenderingContext2D,
  shape: string,
  cols: Record<string, Col>,
  i: number,
  x: number,
  y: number,
  opts: DrawOpts
): boolean {
  const alpha = numAt(cols['a'], i, 1);
  const fillCol = cols['fill'];
  const strokeCol = cols['stroke'];
  const filled = shape !== 'ring' && shape !== 'box' && shape !== 'point';
  const f = fillCol ? cssAt(fillCol, i, opts.defaultFill) : filled ? opts.defaultFill : 'none';
  const st = strokeCol ? cssAt(strokeCol, i, opts.defaultStroke) : filled ? 'none' : opts.defaultStroke;

  switch (shape) {
    case 'rect':
    case 'square': {
      const w = numAt(cols['w'], i, numAt(cols['r'], i, 10) * 2);
      const h = numAt(cols['h'], i, w);
      if (f !== 'none') {
        ctx.fillStyle = cssAlpha(f, alpha);
        ctx.fillRect(x - w / 2, y - h / 2, w, h);
      }
      if (st !== 'none') {
        ctx.strokeStyle = cssAlpha(st, alpha);
        ctx.lineWidth = numAt(cols['sw'], i, 1);
        ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      }
      return true;
    }
    case 'point': {
      const sw = numAt(cols['sw'], i, numAt(cols['r'], i, 2));
      const css = fillCol || strokeCol ? (f !== 'none' ? f : st) : opts.defaultStroke;
      ctx.fillStyle = cssAlpha(css === 'none' ? opts.defaultStroke : css, alpha);
      ctx.fillRect(x - sw / 2, y - sw / 2, sw, sw);
      return true;
    }
    case 'circle':
    case 'dot': {
      const r = numAt(cols['r'], i, 10);
      ctx.beginPath();
      ctx.arc(x, y, Math.abs(r), 0, 6.283185307179586);
      if (f !== 'none') {
        ctx.fillStyle = cssAlpha(f, alpha);
        ctx.fill();
      }
      if (st !== 'none') {
        ctx.strokeStyle = cssAlpha(st, alpha);
        ctx.lineWidth = numAt(cols['sw'], i, 1);
        ctx.stroke();
      }
      return true;
    }
    case 'line': {
      if (st === 'none' && f === 'none') return true;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(numAt(cols['x2'], i, x + 10), numAt(cols['y2'], i, y));
      ctx.strokeStyle = cssAlpha(st !== 'none' ? st : f, alpha);
      ctx.lineWidth = numAt(cols['sw'], i, 1);
      ctx.stroke();
      return true;
    }
    default:
      return false;
  }
}

function drawRow(
  p: p5,
  cols: Record<string, Col>,
  i: number,
  shapeCol: Col | undefined,
  hasAnyRot: boolean,
  opts: DrawOpts,
  ctx: CanvasRenderingContext2D | null = null
) {
  const shape = (shapeCol ? strAt(shapeCol, i) : undefined) || 'circle';
  const x = numAt(cols['x'], i, 0);
  const y = numAt(cols['y'], i, 0);
  const rot = hasAnyRot ? numAt(cols['rot'], i, 0) : 0;
  const hasRot = rot !== 0;
  if (ctx && !hasRot && fastDraw(ctx, shape, cols, i, x, y, opts)) return;
  if (hasRot) {
    p.push();
    p.translate(x, y);
    p.rotate(rot);
  }
  const px = hasRot ? 0 : x;
  const py = hasRot ? 0 : y;
  const ox = hasRot ? x : 0;
  const oy = hasRot ? y : 0;

  switch (shape) {
    case 'circle':
    case 'dot': {
      style(p, cols, i, opts, true);
      p.circle(px, py, 2 * numAt(cols['r'], i, 10));
      break;
    }
    case 'ellipse': {
      style(p, cols, i, opts, true);
      const r = numAt(cols['r'], i, 10);
      p.ellipse(px, py, numAt(cols['w'], i, r * 2), numAt(cols['h'], i, r * 2));
      break;
    }
    case 'ring': {
      style(p, cols, i, opts, false);
      p.noFill();
      p.circle(px, py, 2 * numAt(cols['r'], i, 10));
      break;
    }
    case 'rect':
    case 'square': {
      style(p, cols, i, opts, true);
      const w = numAt(cols['w'], i, numAt(cols['r'], i, 10) * 2);
      p.rectMode(p.CENTER);
      p.rect(px, py, w, numAt(cols['h'], i, w), numAt(cols['round'], i, 0));
      break;
    }
    case 'box': {
      style(p, cols, i, opts, false);
      const w = numAt(cols['w'], i, numAt(cols['r'], i, 10) * 2);
      p.rectMode(p.CENTER);
      p.noFill();
      p.rect(px, py, w, numAt(cols['h'], i, w), numAt(cols['round'], i, 0));
      break;
    }
    case 'line': {
      style(p, cols, i, opts, false);
      p.line(px, py, numAt(cols['x2'], i, x + 10) - ox, numAt(cols['y2'], i, y) - oy);
      break;
    }
    case 'tri':
    case 'triangle': {
      style(p, cols, i, opts, true);
      const r = numAt(cols['r'], i, 12);
      if (cols['x2'] === undefined) {
        const dx = r * 0.8660254037844387; // sin 120
        const dy = r * 0.5;
        p.triangle(px, py - r, px + dx, py + dy, px - dx, py + dy);
      } else {
        p.triangle(
          px,
          py,
          numAt(cols['x2'], i, 0) - ox,
          numAt(cols['y2'], i, 0) - oy,
          numAt(cols['x3'], i, 0) - ox,
          numAt(cols['y3'], i, 0) - oy
        );
      }
      break;
    }
    case 'arc': {
      style(p, cols, i, opts, false);
      const r = numAt(cols['r'], i, 20);
      p.arc(px, py, r * 2, r * 2, numAt(cols['a0'], i, 0), numAt(cols['a1'], i, Math.PI));
      break;
    }
    case 'text':
    case 'txt': {
      const css = cssAt(cols['fill'], i, opts.defaultFill);
      p.noStroke();
      if (css !== 'none') p.fill(p5color(p, css, numAt(cols['a'], i, 1)));
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(numAt(cols['size'], i, 16));
      p.text(strAt(cols['txt'], i) ?? strAt(cols['text'], i) ?? strAt(cols['s'], i) ?? '', px, py);
      break;
    }
    case 'point': {
      const css = cssAt(cols['fill'] ?? cols['stroke'], i, opts.defaultStroke);
      p.stroke(p5color(p, css === 'none' ? opts.defaultStroke : css, numAt(cols['a'], i, 1)));
      p.strokeWeight(numAt(cols['sw'], i, numAt(cols['r'], i, 2)));
      p.point(px, py);
      break;
    }
    case 'poly':
    case 'path': {
      style(p, cols, i, opts, shape === 'poly');
      const pts = valAt(cols['pts'], i);
      p.beginShape();
      if (pts !== undefined) {
        const m = count(pts);
        for (let k = 0; k < m; k++) {
          const pt = at(pts, k);
          const vx = (pt as QVector).v as number[];
          if (Array.isArray(vx)) p.vertex(vx[0] - ox, vx[1] - oy);
          else {
            const a0 = at(pt, 0) as QAtom;
            const a1 = at(pt, 1) as QAtom;
            p.vertex(Number(a0.v) - ox, Number(a1.v) - oy);
          }
        }
      }
      p.endShape(shape === 'poly' ? p.CLOSE : undefined);
      break;
    }
    case 'ngon': {
      style(p, cols, i, opts, true);
      const r = numAt(cols['r'], i, 20);
      const sides = Math.max(3, Math.round(numAt(cols['n'], i, 5)));
      p.beginShape();
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2 - Math.PI / 2;
        p.vertex(px + r * Math.cos(a), py + r * Math.sin(a));
      }
      p.endShape(p.CLOSE);
      break;
    }
    default: {
      style(p, cols, i, opts, true);
      p.circle(px, py, numAt(cols['r'], i, 10) * 2);
    }
  }
  if (hasRot) p.pop();
}

function style(
  p: p5,
  cols: Record<string, Col>,
  i: number,
  opts: DrawOpts,
  defaultFilled: boolean
) {
  const alpha = numAt(cols['a'], i, 1);
  const fillCol = cols['fill'];
  const strokeCol = cols['stroke'];
  const f = fillCol ? cssAt(fillCol, i, opts.defaultFill) : defaultFilled ? opts.defaultFill : 'none';
  const s = strokeCol
    ? cssAt(strokeCol, i, opts.defaultStroke)
    : defaultFilled
    ? 'none'
    : opts.defaultStroke;
  if (f === 'none') p.noFill();
  else p.fill(p5color(p, f, alpha));
  if (s === 'none') p.noStroke();
  else {
    p.stroke(p5color(p, s, alpha));
    p.strokeWeight(numAt(cols['sw'], i, 1));
  }
}
