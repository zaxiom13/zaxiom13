import { describe, it, expect } from 'vitest';
import { headless, q } from './util';
import { truthy } from '../src/q/eval';
import { count, isTable, QTable } from '../src/q/value';

const { ip, rt } = headless();
const run = (src: string) => {
  const r = q(ip, src);
  if (!r.ok) throw new Error("'" + r.error!.msg + ' — ' + (r.error!.hint ?? ''));
  return r.output;
};
const val = (src: string) => {
  const r = q(ip, src);
  if (!r.ok) throw new Error("'" + r.error!.msg);
  return r.value!;
};

describe('shape constructors', () => {
  it('circles builds a scene table', () => {
    const t = val('circles[100 200 300;150;40]') as QTable;
    expect(isTable(t)).toBe(true);
    expect(count(t)).toBe(3);
    expect(t.c).toEqual(['shape', 'x', 'y', 'r']);
  });

  it('broadcasts atoms and rejects ragged arguments', () => {
    expect(count(val('rects[1 2 3;10;20;30]'))).toBe(3);
    expect(q(ip, 'circles[1 2 3;1 2;5]').ok).toBe(false);
  });

  it('scenes join with ,', () => {
    expect(count(val('circles[1 2;3;4],rects[1;2;3;4]'))).toBe(3);
  });

  it('every builder produces something drawable', () => {
    const calls = [
      'circles[10;10;5]',
      'rings[10;10;5]',
      'rects[10;10;5;5]',
      'squares[10;10;5]',
      'bars[10 20;100;5;30 40]',
      'lines[0;0;10;10]',
      'tris[10;10;5]',
      'ngons[10;10;5;6]',
      'points[10 20;10]',
      'texts[10;10;"hi"]',
      'arcs[10;10;5;0;pi]',
      'path[til 5;til 5]',
      'poly[0 10 5;0 0 10]',
      'plot 1 5 3 9',
      'plot (1 5 3 9;2 2 2 2)',
      'scatter[til 5;til 5]',
    ];
    for (const c of calls) {
      const v = val(c);
      expect(isTable(v), c).toBe(true);
      expect(count(v), c).toBeGreaterThan(0);
    }
  });

  it('combinators restyle a scene', () => {
    expect(run('cols paint[circles[1;2;3];`gold]')).toContain('fill');
    expect(run('cols fade[circles[1;2;3];0.5]')).toContain('a');
    expect(run('cols spin[circles[1;2;3];0.5]')).toContain('rot');
    expect(run('exec x from nudge[circles[10;10;3];5;0]')).toBe(',15');
  });
});

describe('input state', () => {
  it('pressed is false with no keys held, and vectorises', () => {
    expect(run('pressed `w')).toBe('0b');
    expect(run('pressed `left`right')).toBe('00b');
  });

  it('reports keys once the runtime says they are down', () => {
    rt.keys.add('left');
    expect(run('pressed `left')).toBe('1b');
    expect(run('.p5.keys')).toBe(',`left');
    rt.keys.clear();
  });

  it('exposes a mouse dictionary', () => {
    expect(run('key .p5.mouse')).toBe('`x`y`down`clicks');
  });
});

describe('.z namespace and timers', () => {
  it('has a clock', () => {
    expect(run('type .z.P')).toBe('-12h');
    expect(run('type .z.D')).toBe('-14h');
    expect(run('type .z.T')).toBe('-19h');
    expect(run('type .z.N')).toBe('-16h');
    expect(truthy(val('.z.D within (2020.01.01;2100.01.01)'))).toBe(true);
  });

  it('\\t sets the timer interval', () => {
    run('\\t 250');
    expect(run('.z.ti')).toBe('250');
    expect(run('system "t"')).toBe('250');
    expect(rt.timerMs).toBe(250);
    run('\\t 0');
  });

  it('\\t times an expression', () => {
    expect(Number(run('\\t sum til 1000'))).toBeGreaterThanOrEqual(0);
  });

  it('\\P changes print precision for this interpreter only', () => {
    run('\\P 3');
    expect(run('1%3')).toBe('0.333');
    run('\\P 7');
    expect(run('1%3')).toBe('0.3333333');
  });

  it('.z.ts is an ordinary global a program can set', () => {
    run('.z.ts:{[now] 1}');
    expect(run('type .z.ts')).toBe('100h');
  });
});

describe('.Q namespace', () => {
  const cases: [string, string][] = [
    ['.Q.a', '"abcdefghijklmnopqrstuvwxyz"'],
    ['.Q.A', '"ABCDEFGHIJKLMNOPQRSTUVWXYZ"'],
    ['.Q.n', '"0123456789"'],
    ['.Q.f[2;3.14159]', '"3.14"'],
    ['.Q.fmt[8;2;3.14159]', '"    3.14"'],
    ['.Q.ty 1 2 3', '"j"'],
    ['.Q.ty `a', '"S"'],
    ['.Q.qt ([]a:1 2)', '1b'],
    ['.Q.qt 1 2', '0b'],
    ['.Q.dd[`a;`b]', '`a.b'],
    ['.Q.addmonths[2024.01.31;1]', '2024.02.29'],
    ['.Q.s 1 2 3', '"1 2 3"'],
    ['.Q.s1 (1 2;3 4)', '"(1 2;3 4)"'],
    ['.Q.fu[{x*2};1 1 2 2 3]', '2 2 4 4 6'],
    ['.Q.id `$"a b!c"', '`abc'],
    ['.Q.btoa "abc"', '"YWJj"'],
  ];
  for (const [src, want] of cases) it(src, () => expect(run(src)).toBe(want));
});

describe('the drawing model', () => {
  it('draw returns what it was given, so frame can thread it', () => {
    const { ip, rt } = headless();
    const r = q(ip, 'scene:draw circles[10;10;5]');
    expect(r.ok).toBe(true);
    expect(q(ip, 'count scene').output).toBe('1');
    expect(rt.lastDrawn).toBeTruthy();
  });

  it('frame with one parameter gets the time', () => {
    const { ip, rt } = headless();
    q(ip, 'frame:{[t] draw circles[t;10;5]}');
    ip.apply(ip.globals.get('frame')!, [{ t: -9, v: 42 } as any]);
    expect(rt.lastDrawn).toBeTruthy();
    expect(ip.rankOf(ip.globals.get('frame')!)).toBe(1);
  });

  it('frame with two parameters is a fold over time', () => {
    const { ip } = headless();
    q(ip, 'init:0\nframe:{[s;t] draw circles[10;10;5]; s+1}');
    const f = ip.globals.get('frame')!;
    expect(ip.rankOf(f)).toBe(2);
    let s = ip.globals.get('init')!;
    for (let i = 0; i < 3; i++) s = ip.apply(f, [s, { t: -9, v: 0 } as any]);
    expect((s as any).v).toBe(3);
  });

  it('still runs the old step/view pair, with a note', () => {
    const notes: string[] = [];
    const { ip, rt } = headless();
    rt.events.onNote = (m) => notes.push(m);
    q(ip, 'init:1\nstep:{[s;t] s+1}\nview:{[s] circles[s;10;5]}');
    rt.start();
    expect(notes.join(' ')).toMatch(/step and view are the old API/);
  });
});
