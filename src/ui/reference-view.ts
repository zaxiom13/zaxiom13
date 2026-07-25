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
      'Canvas & sound': [],
    };
    for (const b of all) {
      const doc = DOCS[b.name];
      const hay = (b.name + ' ' + (doc?.doc ?? b.doc ?? '') + ' ' + (doc?.sig ?? '')).toLowerCase();
      if (ql && !hay.includes(ql)) continue;
      const group = /^[.a-z]/i.test(b.name)
        ? SKETCH_NAMES.has(b.name) || b.name.startsWith('.p5.')
          ? 'Canvas & sound'
          : 'Keywords'
        : 'Operators';
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
