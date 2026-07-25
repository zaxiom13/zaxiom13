// Scene tables -> canvas drawing.
//
// A "scene" is an ordinary q table where every row is a shape. Columns are
// optional; anything missing falls back to a default. This is what makes the
// whole thing q-idiomatic: you build pictures with select/update/join.

import type p5 from 'p5';
import {
  QValue,
  QTable,
  QDict,
  count,
  at,
  raw,
  isTable,
  isDict,
  isAtom,
  QAtom,
  QVector,
} from '../q/value';

export interface SceneDefaults {
  fill: string;
  stroke: string;
  sw: number;
  size: number;
  r: number;
}

const NAMED: Record<string, string> = {
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
    if (t === 11 || t === 10) {
      const s = String(val);
      if (!s) return dflt;
      if (s[0] === '#') return s;
      const n = NAMED[s.toLowerCase()];
      if (n) return n;
      return s;
    }
    if (t === 9 || t === 8) {
      const g = Math.round(Math.max(0, Math.min(1, val as number)) * 255);
      return `rgb(${g},${g},${g})`;
    }
    if (t === 7 || t === 6 || t === 5 || t === 4) {
      const g = Math.round(Math.max(0, Math.min(255, val as number)));
      return `rgb(${g},${g},${g})`;
    }
    if (t === 1) return val ? '#ffffff' : '#000000';
    return dflt;
  }
  if (v.t === 10) {
    const s = (v as QVector).v as string;
    return s[0] === '#' ? s : NAMED[s.toLowerCase()] ?? s;
  }
  if (v.t >= 1 && v.t <= 9) {
    const arr = (v as QVector).v as number[];
    if (arr.length >= 3) {
      const sc = v.t === 9 || v.t === 8 ? 255 : 1;
      return `rgb(${Math.round(arr[0] * sc)},${Math.round(arr[1] * sc)},${Math.round(arr[2] * sc)})`;
    }
    if (arr.length === 1) {
      const g = Math.round(arr[0] * (v.t === 9 || v.t === 8 ? 255 : 1));
      return `rgb(${g},${g},${g})`;
    }
  }
  return dflt;
}

interface Col {
  name: string;
  get: (i: number) => any;
  isNull: (i: number) => boolean;
}

function columns(t: QTable): Record<string, (i: number) => QValue> {
  const out: Record<string, (i: number) => QValue> = {};
  t.c.forEach((name, ci) => {
    const col = t.v[ci];
    out[name] = (i: number) => at(col, i);
  });
  return out;
}

const num = (v: QValue | undefined, d: number): number => {
  if (v === undefined) return d;
  if (isAtom(v)) {
    const x = (v as QAtom).v;
    if (typeof x === 'bigint') return Number(x);
    if (typeof x === 'number') return Number.isNaN(x) ? d : x;
    if (typeof x === 'string') return d;
  }
  return d;
};

const text = (v: QValue | undefined): string => {
  if (v === undefined) return '';
  if (isAtom(v)) return String((v as QAtom).v);
  if (v.t === 10) return (v as QVector).v as string;
  if (v.t === 11) return ((v as QVector).v as string[]).join(' ');
  return '';
};

export interface DrawOpts {
  defaultFill: string;
  defaultStroke: string;
}

/** Draw one scene table onto a p5 instance. */
export function drawScene(p: p5, scene: QValue, opts: DrawOpts): number {
  if (isDict(scene) && !isTable(scene)) {
    // a single shape given as a dictionary
    const d = scene as QDict;
    const keys = (d.k as QVector).v as string[];
    const cols: Record<string, QValue> = {};
    keys.forEach((k, i) => (cols[k] = at(d.v, i)));
    drawRow(p, (n) => cols[n], opts);
    return 1;
  }
  if (!isTable(scene)) return 0;
  const t = scene as QTable;
  const n = count(t);
  const getters = columns(t);
  for (let i = 0; i < n; i++) {
    drawRow(p, (name) => (getters[name] ? getters[name](i) : undefined), opts);
  }
  return n;
}

function applyStyle(
  p: p5,
  get: (n: string) => QValue | undefined,
  opts: DrawOpts,
  defaultFilled: boolean
) {
  const fillV = get('fill');
  const strokeV = get('stroke');
  const alpha = num(get('a'), 1);
  const f = toColor(fillV, defaultFilled ? opts.defaultFill : 'none');
  const s = toColor(strokeV, strokeV === undefined && !defaultFilled ? opts.defaultStroke : 'none');
  if (f === 'none') p.noFill();
  else {
    const c = p.color(f);
    (c as any).setAlpha(255 * alpha);
    p.fill(c);
  }
  if (s === 'none') p.noStroke();
  else {
    const c = p.color(s);
    (c as any).setAlpha(255 * alpha);
    p.stroke(c);
    p.strokeWeight(num(get('sw'), 1));
  }
}

function drawRow(p: p5, get: (n: string) => QValue | undefined, opts: DrawOpts) {
  const shapeV = get('shape');
  const shape = shapeV === undefined ? 'circle' : text(shapeV) || 'circle';
  const x = num(get('x'), 0);
  const y = num(get('y'), 0);
  const rot = num(get('rot'), 0);
  const hasRot = rot !== 0;
  if (hasRot) {
    p.push();
    p.translate(x, y);
    p.rotate(rot);
  }
  const px = hasRot ? 0 : x;
  const py = hasRot ? 0 : y;

  switch (shape) {
    case 'circle':
    case 'dot': {
      applyStyle(p, get, opts, true);
      const r = num(get('r'), 10);
      p.circle(px, py, r * 2);
      break;
    }
    case 'ellipse': {
      applyStyle(p, get, opts, true);
      p.ellipse(px, py, num(get('w'), num(get('r'), 10) * 2), num(get('h'), num(get('r'), 10) * 2));
      break;
    }
    case 'ring': {
      applyStyle(p, get, opts, false);
      const r = num(get('r'), 10);
      p.noFill();
      p.circle(px, py, r * 2);
      break;
    }
    case 'rect':
    case 'square': {
      applyStyle(p, get, opts, true);
      const w = num(get('w'), num(get('r'), 10) * 2);
      const h = num(get('h'), w);
      p.rectMode(p.CENTER);
      p.rect(px, py, w, h, num(get('round'), 0));
      break;
    }
    case 'box': {
      applyStyle(p, get, opts, false);
      const w = num(get('w'), num(get('r'), 10) * 2);
      const h = num(get('h'), w);
      p.rectMode(p.CENTER);
      p.noFill();
      p.rect(px, py, w, h, num(get('round'), 0));
      break;
    }
    case 'line': {
      applyStyle(p, get, opts, false);
      p.line(px, py, num(get('x2'), px + 10) - (hasRot ? x : 0), num(get('y2'), py) - (hasRot ? y : 0));
      break;
    }
    case 'tri':
    case 'triangle': {
      applyStyle(p, get, opts, true);
      const r = num(get('r'), 12);
      if (get('x2') === undefined) {
        // equilateral, pointing up, centred on x,y
        const dx = r * Math.sin((2 * Math.PI) / 3);
        const dy = r * Math.cos((2 * Math.PI) / 3);
        p.triangle(px, py - r, px + dx, py - dy, px - dx, py - dy);
      } else {
        const ox = hasRot ? x : 0;
        const oy = hasRot ? y : 0;
        p.triangle(
          px,
          py,
          num(get('x2'), 0) - ox,
          num(get('y2'), 0) - oy,
          num(get('x3'), 0) - ox,
          num(get('y3'), 0) - oy
        );
      }
      break;
    }
    case 'arc': {
      applyStyle(p, get, opts, false);
      const r = num(get('r'), 20);
      p.arc(px, py, r * 2, r * 2, num(get('a0'), 0), num(get('a1'), Math.PI));
      break;
    }
    case 'text':
    case 'txt': {
      applyStyle(p, get, opts, true);
      p.noStroke();
      const c = toColor(get('fill'), opts.defaultFill);
      if (c !== 'none') p.fill(c);
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(num(get('size'), 16));
      p.text(text(get('txt') ?? get('text') ?? get('s')), px, py);
      break;
    }
    case 'point': {
      const c = toColor(get('fill') ?? get('stroke'), opts.defaultStroke);
      p.stroke(c === 'none' ? opts.defaultStroke : c);
      p.strokeWeight(num(get('sw'), num(get('r'), 2)));
      p.point(px, py);
      break;
    }
    case 'poly':
    case 'path': {
      applyStyle(p, get, opts, shape === 'poly');
      const pts = get('pts');
      p.beginShape();
      if (pts !== undefined) {
        const n = count(pts);
        for (let i = 0; i < n; i++) {
          const pt = at(pts, i);
          p.vertex(num(at(pt, 0), 0) - (hasRot ? x : 0), num(at(pt, 1), 0) - (hasRot ? y : 0));
        }
      }
      if (shape === 'poly') p.endShape(p.CLOSE);
      else p.endShape();
      break;
    }
    case 'ngon': {
      applyStyle(p, get, opts, true);
      const r = num(get('r'), 20);
      const sides = Math.max(3, Math.round(num(get('n'), 5)));
      p.beginShape();
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
        p.vertex(px + r * Math.cos(a), py + r * Math.sin(a));
      }
      p.endShape(p.CLOSE);
      break;
    }
    default: {
      applyStyle(p, get, opts, true);
      p.circle(px, py, num(get('r'), 10) * 2);
    }
  }
  if (hasRot) p.pop();
}
