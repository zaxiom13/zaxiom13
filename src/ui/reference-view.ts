// The Reference tab: generated from the interpreter's own builtin registry,
// so it can never drift from what is actually implemented.

import { el, clear, md } from './dom';
import type { Interp, Builtin } from '../q/eval';
import { DOCS } from '../content/reference-docs';

export interface RefOpts {
  onInsert: (name: string) => void;
  onRun: (src: string) => void;
}

export function renderReference(host: HTMLElement, getIp: () => Interp, opts: RefOpts) {
  const ip = getIp();
  clear(host);
  host.append(
    el('h2', {}, 'Reference'),
    el(
      'p',
      {
        html: md(
          'Everything this interpreter implements, listed straight from its own registry. Names not listed here are not supported yet — see the **Parity** tab for how close the whole thing is to real kdb+.'
        ),
      }
    )
  );

  host.append(
    el('h3', {}, 'The canvas API in one screen'),
    el('div', {
      class: 'kv',
      html: [
        ['draw scene', 'the one way to put anything on the canvas (returns the scene)'],
        ['frame:{[t] … draw … }', 'called ~60×/s with the time'],
        ['frame:{[s;t] … draw … ; s}', '…and handed back whatever it returned last tick'],
        ['init', 'the first value of s (optional)'],
        ['\\t 100 · .z.ts:{[now] … }', 'the kdb+ timer: same idea, your own rate'],
        ['.p5.scene', 'everything drawn during the previous tick'],
        ['shape builders', 'circles rings rects squares bars lines tris ngons points texts arcs path poly'],
        ['restyle a scene', 'paint outline fade spin nudge'],
        ['charts', 'plot y · plot[x;y] · plot (y1;y2) · scatter[x;y] · fitx · fity'],
        ['shape column', '`circle `ring `rect `box `line `tri `ngon `text `point `path `poly `arc `ellipse'],
        ['position', 'x y  (x2 y2 x3 y3 for line/tri, pts for path/poly)'],
        ['size', 'r  w h  size (text)  n (ngon sides)  round (rect corner)'],
        ['style', 'fill stroke sw (weight) a (alpha 0-1) rot (radians)'],
        ['colour', '`red `gold … · `#ff6b6b · hsv[h;s;v] · rgb[r;g;b] · gray x · pal`sunset'],
        ['mouse', '.p5.mx .p5.my .p5.down .p5.clicks .p5.mouse .p5.touch'],
        ['keyboard', '.p5.keys .p5.key · pressed `w · pressed `left`right'],
        ['canvas', '.p5.t .p5.f .p5.w .p5.h .p5.cx .p5.cy · bg `colour'],
        ['helpers', 'grid polar lerp remap clamp wave noise'],
        ['sound', 'beep[freq;dur;amp] · play ([] f:…; t:…; d:…)'],
      ]
        .map(([a, b]) => `<b>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b><span>${b
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</span>`)
        .join(''),
    })
  );

  host.append(
    el('h3', {}, 'Values in .z and .Q'),
    el('div', {
      class: 'kv',
      html: [
        ['.z.p .z.P', 'UTC / local timestamp, right now'],
        ['.z.t .z.T', 'UTC / local time'],
        ['.z.d .z.D', 'UTC / local date'],
        ['.z.n .z.N', 'time since midnight (timespan)'],
        ['.z.z .z.Z', 'UTC / local datetime'],
        ['.z.ts', 'your timer callback — assign a function to it'],
        ['.z.ti', 'the current \\t interval in milliseconds'],
        ['.Q.a .Q.A .Q.n', 'the alphabets and digits'],
        ['.Q.s x  .Q.s1 x', 'the console display of a value, as a string'],
        ['.Q.f[n;x]  .Q.fmt[w;p;x]', 'format numbers'],
        ['.Q.addmonths[d;n]', 'date arithmetic in months'],
        ['.Q.id x  .Q.ty x  .Q.qt x', 'sanitise names · type char · is-a-table'],
        ['.Q.fu[f;x]', 'apply f to the distinct items only'],
        ['.c.z[re;im] · .c.i', 'complex numbers: a `re`im dictionary'],
        ['.c.add .c.sub .c.mul .c.div', 'complex arithmetic (reals accepted on either side)'],
        ['.c.abs .c.arg .c.conj .c.inv', 'modulus · argument · conjugate · reciprocal'],
        ['.c.exp .c.log .c.sqrt .c.pow', 'and .c.sin .c.cos .c.rot .c.polar .c.expi'],
        ['.c.roots n · .c.grid[..]', 'roots of unity · a rectangle of the plane'],
        ['.c.escape[z0;c;n]', 'escape-time iteration: Mandelbrot and Julia'],
        ['.c.tbl .c.str .c.show', 'as a table · as "3+4i" · print it'],
        ['.c.fft .c.ifft', 'fast Fourier transform'],
        ['\\t 100 · \\t expr', 'set the timer · time an expression'],
        ['\\P 3 · \\S 42 · \\c 40', 'print precision · random seed · console rows'],
      ]
        .map(([a, b]) => `<b>${a.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</b><span>${b
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</span>`)
        .join(''),
    })
  );

  const search = el('input', {
    placeholder: 'search…',
    spellcheck: 'false',
    style: {
      width: '100%',
      background: '#0d1219',
      color: '#dfe7ef',
      border: '1px solid #232e3b',
      borderRadius: '10px',
      padding: '8px 10px',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '13px',
      margin: '6px 0 10px',
    },
  }) as HTMLInputElement;
  host.append(search);

  const listHost = el('div');
  host.append(listHost);

  const all = [...ip.builtins.values()].sort((a, b) => cmpName(a.name, b.name));

  const render = (q: string) => {
    clear(listHost);
    const ql = q.trim().toLowerCase();
    const groups: Record<string, Builtin[]> = {
      Operators: [],
      Keywords: [],
      'Canvas, input & sound': [],
      'Namespaces (.z .Q .c)': [],
    };
    for (const b of all) {
      const doc = DOCS[b.name];
      const hay = (b.name + ' ' + (doc?.doc ?? b.doc ?? '') + ' ' + (doc?.sig ?? '')).toLowerCase();
      if (ql && !hay.includes(ql)) continue;
      const group = !/^[.a-z]/i.test(b.name)
        ? 'Operators'
        : b.name.startsWith('.z.') || b.name.startsWith('.Q.') || b.name.startsWith('.c.')
        ? 'Namespaces (.z .Q .c)'
        : SKETCH_NAMES.has(b.name) || b.name.startsWith('.p5.')
        ? 'Canvas, input & sound'
        : 'Keywords';
      groups[group].push(b);
    }
    for (const [name, items] of Object.entries(groups)) {
      if (!items.length) continue;
      listHost.append(el('h3', {}, `${name} (${items.length})`));
      for (const b of items) listHost.append(entry(b));
    }
    if (!Object.values(groups).some((g) => g.length))
      listHost.append(el('p', {}, 'nothing matches that'));
  };

  const entry = (b: Builtin): HTMLElement => {
    const doc = DOCS[b.name] ?? {};
    const sig = doc.sig ?? b.sig ?? '';
    const text = doc.doc ?? b.doc ?? '';
    const examples = doc.ex ?? b.ex ?? [];
    const body = el('div', { style: { display: 'none', padding: '0 12px 10px' } });
    body.append(
      text ? el('p', { html: md(text), style: { margin: '2px 0 6px' } }) : null,
      ...examples.map((ex) =>
        el(
          'div',
          { class: 'chips', style: { margin: '2px 0' } },
          el('button', { class: 'chip', onclick: () => opts.onRun(ex) }, '▶ ' + ex)
        )
      )
    );
    const head = el(
      'div',
      {
        style: {
          display: 'flex',
          gap: '10px',
          alignItems: 'baseline',
          padding: '8px 12px',
          cursor: 'pointer',
        },
        onclick: () => {
          body.style.display = body.style.display === 'none' ? 'block' : 'none';
        },
      },
      el(
        'code',
        { style: { color: '#5ec2ff', background: 'transparent', border: 'none', padding: 0 } },
        b.name
      ),
      el(
        'span',
        { style: { color: '#8fa1b3', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" } },
        sig
      ),
      el(
        'span',
        { style: { marginLeft: 'auto', color: '#5f7183', fontSize: '11px' } },
        b.ranks.join('/') + '-arg'
      )
    );
    const wrap = el(
      'div',
      { style: { border: '1px solid #232e3b', borderRadius: '10px', marginBottom: '6px', background: '#0e131a' } },
      head,
      body
    );
    return wrap;
  };

  search.addEventListener('input', () => render(search.value));
  render('');
}

function cmpName(a: string, b: string) {
  const an = /^[a-z.]/i.test(a);
  const bn = /^[a-z.]/i.test(b);
  if (an !== bn) return an ? 1 : -1;
  return a.localeCompare(b);
}

const SKETCH_NAMES = new Set([
  'circles','rings','rects','squares','bars','lines','tris','ngons','points','texts','arcs',
  'path','poly','paint','outline','fade','spin','nudge','plot','scatter','fitx','fity','pressed',
  'draw',
  'bg',
  'lerp',
  'remap',
  'clamp',
  'wave',
  'noise',
  'polar',
  'grid',
  'rgb',
  'hsv',
  'gray',
  'beep',
  'play',
]);
