// The bridge between the q interpreter and p5.js.

import type p5 from 'p5';
import { Interp } from '../q/eval';
import {
  QValue,
  QAtom,
  QTable,
  atom,
  table,
  dict,
  symvec,
  longvec,
  floatvec,
  boolvec,
  str,
  sym,
  long,
  float,
  bool,
  fromItems,
  listFrom,
  items,
  count,
  at,
  isAtom,
  isFunc,
  isTable,
  isDict,
  typedVec,
  QError,
  UNIT,
  NIL,
  raw,
  QVector,
} from '../q/value';
import { drawScene, toColor } from './scene';
import { PALETTES } from './palette';
import { AudioEngine } from './audio';

export type SketchMode = 'idle' | 'static' | 'frame' | 'state' | 'imperative';

export interface RuntimeEvents {
  onError?: (msg: string, hint?: string) => void;
  onStatus?: (s: { mode: SketchMode; fps: number; shapes: number }) => void;
}

export class SketchRuntime {
  p: p5 | null = null;
  private P5: any = null;
  private loading: Promise<void> | null = null;
  ip: Interp;
  container: HTMLElement;
  events: RuntimeEvents;
  mode: SketchMode = 'idle';
  running = false;
  paused = false;
  startTime = 0;
  frameNo = 0;
  state: QValue = UNIT;
  lastShapes = 0;
  fps = 0;
  audio = new AudioEngine();
  bgColor = '#0e1116';
  private pendingStatic: QValue | null = null;
  private errorShown = false;
  /** p5 creates the canvas asynchronously; nothing may paint before that */
  private canvasReady = false;

  /** headless runtimes (lesson sessions, tests) never touch the canvas */
  headless: boolean;

  constructor(ip: Interp, container: HTMLElement | null, events: RuntimeEvents = {}) {
    this.ip = ip;
    this.container = container as HTMLElement;
    this.events = events;
    this.headless = !container;
    this.install();
  }

  /** point the runtime at a fresh interpreter (one canvas, many programs) */
  attach(ip: Interp) {
    this.ip = ip;
    this.install();
  }

  // ------------------------------------------------------------------ p5

  /** p5 is ~900kB, so it is fetched in parallel with the first run. */
  ready(): Promise<void> {
    if (typeof document === 'undefined' || this.headless) return Promise.resolve();
    if (!this.loading)
      this.loading = import('p5').then((m) => {
        this.P5 = (m as any).default ?? m;
      });
    return this.loading;
  }

  mount() {
    if (this.p || this.headless) return;
    if (typeof document === 'undefined') return; // headless (tests)
    if (!this.P5) {
      void this.ready().then(() => {
        this.mount();
        if (this.mode === 'static' || this.mode === 'idle') this.redrawStatic();
        else {
          this.running = true;
          this.p?.loop();
        }
      });
      return;
    }
    const self = this;
    this.p = new this.P5((p: p5) => {
      p.setup = () => {
        const { w, h } = self.size();
        const c = p.createCanvas(w, h);
        (c as any).parent(self.container);
      (c as any).elt?.setAttribute('aria-label', 'sketch canvas');
        p.frameRate(60);
        p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
        p.background(self.bgColor);
        p.noLoop();
        self.canvasReady = true;
        self.resize();
        if (self.running && !self.paused) p.loop();
        else self.redrawStatic();
      };
      p.draw = () => self.tick();
      p.windowResized = () => {
        const { w, h } = self.size();
        p.resizeCanvas(w, h);
        if (!self.running) self.redrawStatic();
      };
    });
  }

  size() {
    const r = this.container?.getBoundingClientRect?.() ?? { width: 800, height: 600 };
    return { w: Math.max(64, Math.floor(r.width)), h: Math.max(64, Math.floor(r.height)) };
  }

  resize() {
    if (!this.p || !this.canvasReady) return;
    const { w, h } = this.size();
    if (w === this.p.width && h === this.p.height) return;
    this.p.resizeCanvas(w, h);
    if (!this.running) this.redrawStatic();
  }

  // ------------------------------------------------------------------ control

  /** Called after the user's program has been evaluated. */
  start() {
    this.mount();
    const g = this.ip.globals;
    this.errorShown = false;
    // only *user-defined* lambdas count, otherwise the builtin `draw` would
    // look like an imperative sketch
    const lam = (nm: string) => {
      const v = g.get(nm);
      return v && v.t === 100 ? v : null;
    };
    const hasFrame = !!lam('frame');
    const hasStep = !!lam('step');
    const hasDraw = !!lam('draw');
    if (hasStep) {
      this.mode = 'state';
      const init = g.get('init');
      this.state = init === undefined ? UNIT : isFunc(init) ? this.ip.apply(init, [UNIT]) : init;
    } else if (hasFrame) this.mode = 'frame';
    else if (hasDraw) this.mode = 'imperative';
    else this.mode = this.pendingStatic ? 'static' : 'idle';

    this.frameNo = 0;
    this.startTime = performance.now();
    if (this.mode === 'static' || this.mode === 'idle') {
      this.running = false;
      this.p?.noLoop();
      this.redrawStatic();
    } else {
      this.running = true;
      this.paused = false;
      this.p?.loop();
    }
    this.status();
  }

  stop() {
    this.running = false;
    this.p?.noLoop();
    this.status();
  }

  toggle() {
    if (this.mode === 'static' || this.mode === 'idle') return;
    this.paused = !this.paused;
    if (this.paused) this.p?.noLoop();
    else {
      this.startTime = performance.now() - this.frameNo * 16.7;
      this.p?.loop();
    }
    this.status();
  }

  /** Scene-shaped tables left at the end of a program are drawn automatically. */
  autoDraw(v: QValue): boolean {
    if (!isTable(v) && !isDict(v)) return false;
    const cols = isTable(v) ? (v as QTable).c : ((v as any).k?.v as string[]) ?? [];
    if (!Array.isArray(cols)) return false;
    if (!cols.some((c) => ['x', 'y', 'shape', 'pts', 'r'].includes(c))) return false;
    this.pendingStatic = v;
    this.mode = 'static';
    this.mount();
    this.redrawStatic();
    return true;
  }

  clear() {
    this.pendingStatic = null;
    this.mode = 'idle';
    this.running = false;
    this.lastShapes = 0;
    this.state = UNIT;
    if (this.p) {
      this.p.noLoop();
      this.p.background(this.bgColor);
    }
  }

  private status() {
    this.events.onStatus?.({ mode: this.mode, fps: Math.round(this.fps), shapes: this.lastShapes });
  }

  private redrawStatic() {
    if (!this.p || !this.canvasReady) {
      this.status();
      return;
    }
    this.p.background(this.bgColor);
    if (this.pendingStatic) {
      this.lastShapes = drawScene(this.p, this.pendingStatic, {
        defaultFill: '#7dd3fc',
        defaultStroke: '#e5e7eb',
      });
    }
    this.status();
  }

  private tick() {
    const p = this.p;
    if (!p || !this.canvasReady || !this.running) return;
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    this.frameNo++;
    this.fps = this.fps * 0.9 + (p.frameRate() ?? 0) * 0.1;
    this.pushInputs(t);
    try {
      const g = this.ip.globals;
      p.background(this.bgColor);
      if (this.mode === 'frame') {
        const f = g.get('frame')!;
        const scene = this.ip.apply(f, [float(t)]);
        this.lastShapes = drawScene(p, scene, { defaultFill: '#7dd3fc', defaultStroke: '#e5e7eb' });
      } else if (this.mode === 'state') {
        const step = g.get('step')!;
        this.state = this.ip.apply(step, [this.state, float(t)]);
        const view = g.get('view');
        const scene = view && isFunc(view) ? this.ip.apply(view, [this.state]) : this.state;
        this.lastShapes = drawScene(p, scene, { defaultFill: '#7dd3fc', defaultStroke: '#e5e7eb' });
      } else if (this.mode === 'imperative') {
        const d = g.get('draw')!;
        this.ip.apply(d, [float(t)]);
      }
    } catch (e: any) {
      this.running = false;
      p.noLoop();
      if (!this.errorShown) {
        this.errorShown = true;
        const msg = e instanceof QError ? "'" + e.qmsg : String(e?.message ?? e);
        this.events.onError?.(msg, e instanceof QError ? e.hint : undefined);
      }
    }
    if (this.frameNo % 15 === 0) this.status();
  }

  private pushInputs(t: number) {
    const p = this.p;
    if (!p) return;
    const g = this.ip.globals;
    g.set('.p5.t', float(t));
    g.set('.p5.f', long(this.frameNo));
    g.set('.p5.w', float(p.width));
    g.set('.p5.h', float(p.height));
    g.set('.p5.cx', float(p.width / 2));
    g.set('.p5.cy', float(p.height / 2));
    const inside = p.mouseX >= 0 && p.mouseY >= 0 && p.mouseX <= p.width && p.mouseY <= p.height;
    g.set('.p5.mx', float(inside ? p.mouseX : p.width / 2));
    g.set('.p5.my', float(inside ? p.mouseY : p.height / 2));
    g.set('.p5.down', bool(!!(p as any).mouseIsPressed));
    const touches = (p as any).touches as { x: number; y: number; id: number }[];
    g.set(
      '.p5.touch',
      table(
        ['x', 'y', 'id'],
        [
          floatvec(touches.map((tt) => tt.x)),
          floatvec(touches.map((tt) => tt.y)),
          longvec(touches.map((tt, i) => i)),
        ]
      )
    );
  }

  // ------------------------------------------------------------------ q API

  private install() {
    const ip = this.ip;
    const self = this;
    const def = (
      name: string,
      ranks: number[],
      f: (ip: Interp, args: QValue[]) => QValue,
      doc?: string,
      sig?: string,
      ex?: string[]
    ) => ip.def({ name, ranks, f, doc, sig, ex });

    const N = (v: QValue): number => {
      if (isAtom(v)) {
        const x = (v as QAtom).v;
        return typeof x === 'bigint' ? Number(x) : typeof x === 'number' ? x : 0;
      }
      return 0;
    };
    const nums = (v: QValue): number[] => {
      if (isAtom(v)) return [N(v)];
      const n = count(v);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = N(at(v, i));
      return out;
    };
    /** apply a numeric function elementwise, preserving atom/vector shape */
    const mapNum = (v: QValue, f: (x: number) => number): QValue =>
      isAtom(v) ? float(f(N(v))) : floatvec(nums(v).map(f));

    def(
      'draw',
      [1],
      (_ip, [scene]) => {
        self.pendingStatic = scene;
        if (!self.running) {
          self.mode = 'static';
          self.mount();
          self.redrawStatic();
        } else if (self.p) {
          self.lastShapes = drawScene(self.p, scene, {
            defaultFill: '#7dd3fc',
            defaultStroke: '#e5e7eb',
          });
        }
        return UNIT;
      },
      'Render a scene table on the canvas.',
      'draw scene',
      ['draw ([] x:100 200; y:100 100; r:40 25; fill:`gold`crimson)']
    );

    def(
      'bg',
      [1],
      (_ip, [c]) => {
        self.bgColor = toColor(c, '#0e1116');
        if (self.p && self.canvasReady && !self.running) {
          self.p.background(self.bgColor);
          self.redrawStatic();
        }
        return UNIT;
      },
      'Set the canvas background colour.',
      'bg `midnight',
      ['bg `#101820']
    );

    // ---- maths helpers ----------------------------------------------------
    def(
      'lerp',
      [3],
      (_ip, [a, b, t]) => {
        const ta = nums(t);
        if (isAtom(a) && isAtom(b) && isAtom(t)) return float(N(a) + (N(b) - N(a)) * N(t));
        const av = nums(a),
          bv = nums(b);
        const n = Math.max(av.length, bv.length, ta.length);
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
          const A = av[i % av.length],
            B = bv[i % bv.length],
            T = ta[i % ta.length];
          out[i] = A + (B - A) * T;
        }
        return floatvec(out);
      },
      'Linear interpolation: a + (b-a)*t',
      'lerp[a;b;t]',
      ['lerp[0;100;0.25]', 'lerp[0;360;(til 6)%6]']
    );

    def(
      'remap',
      [5],
      (_ip, [x, a0, a1, b0, b1]) => {
        const lo = N(a0),
          hi = N(a1),
          nlo = N(b0),
          nhi = N(b1);
        return mapNum(x, (v) => nlo + ((v - lo) / (hi - lo || 1)) * (nhi - nlo));
      },
      'Rescale x from one range to another.',
      'remap[x;lo;hi;newlo;newhi]',
      ['remap[til 5;0;4;0;100]']
    );

    def(
      'clamp',
      [3],
      (_ip, [x, lo, hi]) => {
        const l = N(lo),
          h = N(hi);
        return mapNum(x, (v) => Math.max(l, Math.min(h, v)));
      },
      'Clamp values into [lo;hi].',
      'clamp[x;lo;hi]',
      ['clamp[-5 5 50;0;10]']
    );

    def(
      'wave',
      [2],
      (_ip, [freq, t]) => {
        const f = N(freq);
        return mapNum(t, (v) => Math.sin(2 * Math.PI * f * v));
      },
      'A sine wave of the given frequency, sampled at t.',
      'wave[freq;t]',
      ['wave[0.5;.p5.t]']
    );

    def(
      'noise',
      [1, 2, 3],
      (_ip, a) => {
        const p = self.p;
        const f = (x: number, y = 0, z = 0) => (p ? p.noise(x, y, z) : 0.5);
        if (a.length === 1) return mapNum(a[0], (x) => f(x));
        const xs = nums(a[0]),
          ys = nums(a[1]);
        const zs = a.length > 2 ? nums(a[2]) : [0];
        const n = Math.max(xs.length, ys.length, zs.length);
        if (isAtom(a[0]) && isAtom(a[1]) && (a.length < 3 || isAtom(a[2])))
          return float(f(xs[0], ys[0], zs[0]));
        const out = new Array(n);
        for (let i = 0; i < n; i++)
          out[i] = f(xs[i % xs.length], ys[i % ys.length], zs[i % zs.length]);
        return floatvec(out);
      },
      'Perlin noise in 1, 2 or 3 dimensions. Vectorised.',
      'noise x  /  noise[x;y]',
      ['noise 0.1*til 10']
    );

    def(
      'polar',
      [2],
      (_ip, [r, th]) => {
        const rs = nums(r),
          ts = nums(th);
        const n = Math.max(rs.length, ts.length);
        const xs = new Array(n),
          ys = new Array(n);
        for (let i = 0; i < n; i++) {
          const R = rs[i % rs.length],
            T = ts[i % ts.length];
          xs[i] = R * Math.cos(T);
          ys[i] = R * Math.sin(T);
        }
        return table(['x', 'y'], [floatvec(xs), floatvec(ys)]);
      },
      'Polar to cartesian: returns a table with x and y columns.',
      'polar[radius;angle]',
      ['polar[100;(2*3.14159)*(til 8)%8]']
    );

    def(
      'grid',
      [2],
      (_ip, [nx, ny]) => {
        const cx = Math.max(0, Math.trunc(N(nx)));
        const cy = Math.max(0, Math.trunc(N(ny)));
        const xs: number[] = [],
          ys: number[] = [];
        for (let j = 0; j < cy; j++)
          for (let i = 0; i < cx; i++) {
            xs.push(i);
            ys.push(j);
          }
        return table(['x', 'y'], [longvec(xs), longvec(ys)]);
      },
      'A table of grid coordinates (the cross of til nx and til ny).',
      'grid[nx;ny]',
      ['grid[3;2]']
    );

    const chan = (v: number) =>
      Math.max(0, Math.min(255, Math.round(v <= 1.000001 && v >= 0 ? v * 255 : v)))
        .toString(16)
        .padStart(2, '0');
    const hexColor = (r: number, g: number, b: number): QValue =>
      sym('#' + chan(r) + chan(g) + chan(b));

    def(
      'rgb',
      [3],
      (_ip, [r, g, b]) => {
        const rs = nums(r),
          gs = nums(g),
          bs = nums(b);
        const n = Math.max(rs.length, gs.length, bs.length);
        if (isAtom(r) && isAtom(g) && isAtom(b)) return hexColor(rs[0], gs[0], bs[0]);
        const out: string[] = [];
        for (let i = 0; i < n; i++)
          out.push(
            ((hexColor(rs[i % rs.length], gs[i % gs.length], bs[i % bs.length]) as QAtom).v) as string
          );
        return symvec(out);
      },
      'Colour symbols from red/green/blue (0-1 or 0-255). Vectorised.',
      'rgb[r;g;b]',
      ['rgb[1;0.5;0]']
    );

    def(
      'hsv',
      [3],
      (_ip, [h, s, v]) => {
        const hs = nums(h),
          ss = nums(s),
          vs = nums(v);
        const n = Math.max(hs.length, ss.length, vs.length);
        const one = (i: number) => {
          const [r, g, b] = hsvRgb(hs[i % hs.length], ss[i % ss.length], vs[i % vs.length]);
          return (hexColor(r, g, b) as QAtom).v as string;
        };
        if (isAtom(h) && isAtom(s) && isAtom(v)) return sym(one(0));
        const out: string[] = [];
        for (let i = 0; i < n; i++) out.push(one(i));
        return symvec(out);
      },
      'Colours from hue/saturation/value, all in 0..1. Vectorised.',
      'hsv[h;s;v]',
      ['hsv[(til 6)%6;0.7;1]']
    );

    def(
      'gray',
      [1],
      (_ip, [x]) => {
        const vs = nums(x);
        if (isAtom(x)) return hexColor(vs[0], vs[0], vs[0]);
        return symvec(vs.map((v) => (hexColor(v, v, v) as QAtom).v as string));
      },
      'Greys from 0 (black) to 1 (white).',
      'gray x',
      ['gray 0.5']
    );

    // palettes as a plain q dictionary
    const palKeys = Object.keys(PALETTES);
    ip.globals.set(
      'pal',
      dict(
        symvec(palKeys),
        listFrom(palKeys.map((k) => symvec(PALETTES[k])))
      )
    );

    // ---- immediate mode ---------------------------------------------------
    const imm = (name: string, ranks: number[], fn: (p: p5, a: QValue[]) => void, doc: string) =>
      def(
        '.p5.' + name,
        ranks,
        (_ip, a) => {
          if (self.p) fn(self.p, a);
          return UNIT;
        },
        doc
      );

    imm('circle', [3], (p, [x, y, r]) => p.circle(N(x), N(y), 2 * N(r)), 'Draw a circle.');
    imm('line', [4], (p, [x, y, x2, y2]) => p.line(N(x), N(y), N(x2), N(y2)), 'Draw a line.');
    imm(
      'rect',
      [4],
      (p, [x, y, w, h]) => {
        p.rectMode(p.CENTER);
        p.rect(N(x), N(y), N(w), N(h));
      },
      'Draw a rectangle centred at x,y.'
    );
    imm(
      'text',
      [3],
      (p, [s, x, y]) => {
        p.textAlign(p.CENTER, p.CENTER);
        p.text(isAtom(s) ? String((s as QAtom).v) : String((s as QVector).v), N(x), N(y));
      },
      'Draw text.'
    );
    imm(
      'fill',
      [1],
      (p, [c]) => {
        const col = toColor(c, '#ffffff');
        if (col === 'none') p.noFill();
        else p.fill(col);
      },
      'Set the fill colour.'
    );
    imm(
      'stroke',
      [1],
      (p, [c]) => {
        const col = toColor(c, '#ffffff');
        if (col === 'none') p.noStroke();
        else p.stroke(col);
      },
      'Set the stroke colour.'
    );
    imm('sw', [1], (p, [w]) => p.strokeWeight(N(w)), 'Set the stroke weight.');
    imm('clear', [1], (p) => p.background(self.bgColor), 'Clear the canvas.');

    // ---- sound ------------------------------------------------------------
    def(
      'beep',
      [1, 2, 3],
      (_ip, a) => {
        const freq = N(a[0]);
        const dur = a.length > 1 ? N(a[1]) : 0.15;
        const amp = a.length > 2 ? N(a[2]) : 0.2;
        self.audio.note(freq, 0, dur, amp);
        return UNIT;
      },
      'Play a short tone.',
      'beep[freq;dur;amp]',
      ['beep 440']
    );

    def(
      'play',
      [1],
      (_ip, [score]) => {
        if (!isTable(score)) throw new QError('type', 'play expects a table with f (and t,d,amp)');
        const t = score as QTable;
        const col = (nm: string): number[] | null => {
          const i = t.c.indexOf(nm);
          if (i < 0) return null;
          return nums(t.v[i]);
        };
        const f = col('f') ?? [];
        const at0 = col('t');
        const d = col('d');
        const amp = col('amp');
        for (let i = 0; i < f.length; i++)
          self.audio.note(f[i], at0 ? at0[i] : i * 0.25, d ? d[i] : 0.2, amp ? amp[i] : 0.2);
        return UNIT;
      },
      'Play a score table: columns f (frequency), t (start), d (duration), amp.',
      'play score',
      ['play ([] f:440*1 1.25 1.5; t:0 0.25 0.5; d:0.2)']
    );

    // dynamic values so `.p5.t` works even before the first frame
    const dyn: Record<string, () => QValue> = {
      '.p5.t': () => float((performance.now() - this.startTime) / 1000),
      '.p5.f': () => long(this.frameNo),
      '.p5.w': () => float(this.p?.width ?? this.size().w),
      '.p5.h': () => float(this.p?.height ?? this.size().h),
      '.p5.cx': () => float((this.p?.width ?? this.size().w) / 2),
      '.p5.cy': () => float((this.p?.height ?? this.size().h) / 2),
      '.p5.mx': () => float(this.p?.mouseX ?? 0),
      '.p5.my': () => float(this.p?.mouseY ?? 0),
      '.p5.down': () => bool(!!(this.p as any)?.mouseIsPressed),
      '.p5.touch': () => table(['x', 'y', 'id'], [floatvec([]), floatvec([]), longvec([])]),
      pi: () => float(Math.PI),
      tau: () => float(Math.PI * 2),
    };
    Object.assign(ip.dynamicHooks, dyn);
  }
}

function hsvRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  s = Math.max(0, Math.min(1, s));
  v = Math.max(0, Math.min(1, v));
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  return [r, g, b];
}
