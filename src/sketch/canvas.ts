// A tiny canvas-2D runtime with the slice of the p5 API this project uses.
//
// p5 is a wonderful library and 343 kB gzipped; we drew with about forty of
// its functions, and the scene renderer already talked to the 2D context
// directly for big scenes. This module keeps the same shape (instance mode,
// setup/draw, the same method names) so sketches and the renderer are
// unchanged, while costing a few kilobytes.

export type ColorLike = string | Color;

export class Color {
  css: string;
  alpha = 255;
  constructor(css: string) {
    this.css = css;
  }
  setAlpha(a: number) {
    this.alpha = a;
    this.css = withAlpha(this.css, a / 255);
  }
  toString() {
    return this.css;
  }
}

function withAlpha(css: string, a: number): string {
  if (a >= 1) return css;
  let r = 0,
    g = 0,
    b = 0;
  if (css.charCodeAt(0) === 35) {
    const hex =
      css.length === 4 ? css[1] + css[1] + css[2] + css[2] + css[3] + css[3] : css.slice(1, 7);
    const v = parseInt(hex, 16);
    r = (v >> 16) & 255;
    g = (v >> 8) & 255;
    b = v & 255;
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(css);
    if (m) [r, g, b] = m[1].split(',').map((x) => parseFloat(x));
    else return css;
  }
  return `rgba(${r},${g},${b},${a})`;
}

const FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

export class Sketch {
  // p5-compatible constants
  readonly CENTER = 'center';
  readonly CORNER = 'corner';
  readonly CLOSE = 'close';
  readonly RADIANS = 'radians';

  width = 100;
  height = 100;
  mouseX = 0;
  mouseY = 0;
  mouseIsPressed = false;
  touches: { x: number; y: number; id: number }[] = [];
  frameCount = 0;
  drawingContext!: CanvasRenderingContext2D;

  setup?: () => void;
  draw?: () => void;
  windowResized?: () => void;
  mousePressed?: () => void;
  touchStarted?: () => void;

  private canvas!: HTMLCanvasElement;
  private density = 1;
  private looping = false;
  private raf = 0;
  private fps = 60;
  private lastFrame = 0;
  private shape: { x: number; y: number }[] | null = null;
  private fillCss: string | null = '#ffffff';
  private strokeCss: string | null = null;
  private weight = 1;
  private rectCentered = false;
  private textSizePx = 12;
  private stack: {
    fill: string | null;
    stroke: string | null;
    weight: number;
    rectCentered: boolean;
  }[] = [];
  private disposed = false;

  constructor(build: (p: Sketch) => void) {
    build(this);
    // p5 defers setup until the document is ready; do the same
    const start = () => {
      if (this.disposed) return;
      this.setup?.();
      this.tick(performance.now());
    };
    if (typeof document !== 'undefined' && document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', start, { once: true });
    else queueMicrotask(start);
  }

  // ---------------------------------------------------------------- canvas

  createCanvas(w: number, h: number) {
    const el = document.createElement('canvas');
    this.canvas = el;
    this.drawingContext = el.getContext('2d')!;
    this.resizeCanvas(w, h);
    this.bindInput(el);
    const self = this;
    return {
      elt: el,
      parent(target: HTMLElement | string) {
        const node = typeof target === 'string' ? document.getElementById(target) : target;
        node?.append(el);
        self.applySize();
        return this;
      },
    };
  }

  resizeCanvas(w: number, h: number) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    this.applySize();
  }

  pixelDensity(d?: number) {
    if (d === undefined) return this.density;
    this.density = Math.max(1, d);
    this.applySize();
    return this.density;
  }

  private applySize() {
    if (!this.canvas) return;
    const d = this.density;
    this.canvas.width = Math.round(this.width * d);
    this.canvas.height = Math.round(this.height * d);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.drawingContext.setTransform(d, 0, 0, d, 0, 0);
    this.drawingContext.lineJoin = 'round';
    this.drawingContext.lineCap = 'round';
  }

  /** stop the loop and detach (used when a runtime is thrown away) */
  remove() {
    this.disposed = true;
    this.looping = false;
    cancelAnimationFrame(this.raf);
    this.canvas?.remove();
  }

  // ---------------------------------------------------------------- loop

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.looping) return;
    const dt = now - this.lastFrame;
    if (dt > 0) this.fps = this.fps * 0.9 + (1000 / dt) * 0.1;
    this.lastFrame = now;
    this.frameCount++;
    this.draw?.();
  };

  loop() {
    if (!this.looping) {
      this.looping = true;
      this.lastFrame = performance.now();
    }
  }
  noLoop() {
    this.looping = false;
  }
  redraw() {
    this.draw?.();
  }
  frameRate(_target?: number) {
    return this.fps;
  }

  // ---------------------------------------------------------------- style

  color(css: ColorLike) {
    return new Color(typeof css === 'string' ? css : css.css);
  }
  fill(c: ColorLike) {
    this.fillCss = typeof c === 'string' ? c : c.css;
  }
  noFill() {
    this.fillCss = null;
  }
  stroke(c: ColorLike) {
    this.strokeCss = typeof c === 'string' ? c : c.css;
  }
  noStroke() {
    this.strokeCss = null;
  }
  strokeWeight(w: number) {
    this.weight = w;
  }
  rectMode(mode: string) {
    this.rectCentered = mode === this.CENTER;
  }
  textAlign(_h: string, _v?: string) {
    const ctx = this.drawingContext;
    ctx.textAlign = _h === this.CENTER ? 'center' : 'left';
    ctx.textBaseline = _v === this.CENTER ? 'middle' : 'alphabetic';
  }
  textSize(n: number) {
    this.textSizePx = n;
    this.drawingContext.font = `${n}px ${FONT}`;
  }

  push() {
    this.drawingContext.save();
    this.stack.push({
      fill: this.fillCss,
      stroke: this.strokeCss,
      weight: this.weight,
      rectCentered: this.rectCentered,
    });
  }
  pop() {
    this.drawingContext.restore();
    const s = this.stack.pop();
    if (s) {
      this.fillCss = s.fill;
      this.strokeCss = s.stroke;
      this.weight = s.weight;
      this.rectCentered = s.rectCentered;
    }
  }
  translate(x: number, y: number) {
    this.drawingContext.translate(x, y);
  }
  rotate(a: number) {
    this.drawingContext.rotate(a);
  }

  private paint(closePath = false) {
    const ctx = this.drawingContext;
    if (closePath) ctx.closePath();
    if (this.fillCss) {
      ctx.fillStyle = this.fillCss;
      ctx.fill();
    }
    if (this.strokeCss) {
      ctx.strokeStyle = this.strokeCss;
      ctx.lineWidth = this.weight;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- drawing

  background(c: ColorLike) {
    const ctx = this.drawingContext;
    ctx.save();
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0);
    ctx.fillStyle = typeof c === 'string' ? c : c.css;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }

  circle(x: number, y: number, d: number) {
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.arc(x, y, Math.abs(d) / 2, 0, 6.283185307179586);
    this.paint();
  }

  ellipse(x: number, y: number, w: number, h = w) {
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, 6.283185307179586);
    this.paint();
  }

  arc(x: number, y: number, w: number, h: number, a0: number, a1: number) {
    const ctx = this.drawingContext;
    ctx.beginPath();
    if (w === h) ctx.arc(x, y, Math.abs(w) / 2, a0, a1);
    else ctx.ellipse(x, y, Math.abs(w) / 2, Math.abs(h) / 2, 0, a0, a1);
    this.paint();
  }

  rect(x: number, y: number, w: number, h = w, r = 0) {
    const ctx = this.drawingContext;
    const px = this.rectCentered ? x - w / 2 : x;
    const py = this.rectCentered ? y - h / 2 : y;
    ctx.beginPath();
    if (r > 0 && typeof (ctx as any).roundRect === 'function') (ctx as any).roundRect(px, py, w, h, r);
    else ctx.rect(px, py, w, h);
    this.paint();
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    if (this.strokeCss) {
      ctx.strokeStyle = this.strokeCss;
      ctx.lineWidth = this.weight;
      ctx.stroke();
    } else if (this.fillCss) {
      ctx.strokeStyle = this.fillCss;
      ctx.lineWidth = this.weight;
      ctx.stroke();
    }
  }

  triangle(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) {
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    this.paint(true);
  }

  point(x: number, y: number) {
    const ctx = this.drawingContext;
    const r = Math.max(0.5, this.weight / 2);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.283185307179586);
    ctx.fillStyle = this.strokeCss ?? this.fillCss ?? '#ffffff';
    ctx.fill();
  }

  text(s: string, x: number, y: number) {
    const ctx = this.drawingContext;
    if (!ctx.font.includes(String(this.textSizePx))) ctx.font = `${this.textSizePx}px ${FONT}`;
    if (this.fillCss) {
      ctx.fillStyle = this.fillCss;
      ctx.fillText(s, x, y);
    }
  }

  beginShape() {
    this.shape = [];
  }
  vertex(x: number, y: number) {
    this.shape?.push({ x, y });
  }
  endShape(mode?: string) {
    const pts = this.shape;
    this.shape = null;
    if (!pts || pts.length === 0) return;
    const ctx = this.drawingContext;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (mode === this.CLOSE) {
      ctx.closePath();
      this.paint();
    } else {
      // an open path is a stroke, never a fill
      if (this.strokeCss) {
        ctx.strokeStyle = this.strokeCss;
        ctx.lineWidth = this.weight;
        ctx.stroke();
      }
    }
  }

  // ---------------------------------------------------------------- input

  private bindInput(el: HTMLCanvasElement) {
    const pos = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      this.mouseX = ((e.clientX - r.left) * this.width) / (r.width || 1);
      this.mouseY = ((e.clientY - r.top) * this.height) / (r.height || 1);
    };
    el.addEventListener('pointermove', (e) => pos(e));
    el.addEventListener('pointerdown', (e) => {
      pos(e);
      this.mouseIsPressed = true;
      this.mousePressed?.();
      if (e.pointerType === 'touch') {
        this.touches = [{ x: this.mouseX, y: this.mouseY, id: e.pointerId }];
        this.touchStarted?.();
      }
    });
    const up = () => {
      this.mouseIsPressed = false;
      this.touches = [];
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('touchmove', (e) => {
      const r = el.getBoundingClientRect();
      this.touches = Array.from(e.touches).map((t, i) => ({
        x: ((t.clientX - r.left) * this.width) / (r.width || 1),
        y: ((t.clientY - r.top) * this.height) / (r.height || 1),
        id: i,
      }));
      if (this.touches.length) {
        this.mouseX = this.touches[0].x;
        this.mouseY = this.touches[0].y;
      }
    });
  }

  // ---------------------------------------------------------------- noise

  noise(x: number, y = 0, z = 0): number {
    // four octaves of gradient noise, in 0..1, like p5's noise()
    let total = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < 4; o++) {
      total += amp * perlin(x * freq, y * freq, z * freq);
      amp *= 0.5;
      freq *= 2;
    }
    // 0.72 keeps the sum inside 0..1 without clipping the peaks flat
    return Math.min(1, Math.max(0, 0.5 + 0.72 * total));
  }
}

// ------------------------------------------------------------------ perlin

const PERM = new Uint8Array(512);
(() => {
  // a fixed permutation so sketches look the same on every run
  let seed = 1337;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u),
      v
    ),
    lerp(
      lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u),
      v
    ),
    w
  );
}
