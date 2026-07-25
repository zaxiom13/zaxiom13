import { describe, it, expect } from 'vitest';
import { headless, q } from './util';
import { truthy } from '../src/q/eval';

const { ip } = headless();
const run = (src: string) => {
  const r = q(ip, src);
  if (!r.ok) throw new Error("'" + r.error!.msg + ' — ' + (r.error!.hint ?? ''));
  return r.output;
};
const isTrue = (src: string) => {
  const r = q(ip, src);
  if (!r.ok) throw new Error("'" + r.error!.msg);
  return truthy(r.value!);
};

describe('.c construction', () => {
  it('makes a complex out of parts', () => {
    expect(run('.c.z[3;4]')).toBe('re| 3\nim| 4');
    expect(run('.c.re .c.z[3;4]')).toBe('3');
    expect(run('.c.im .c.z[3;4]')).toBe('4');
  });
  it('treats reals as complex', () => {
    expect(isTrue('.c.z[7] ~ .c.z[7;0f]')).toBe(true);
    expect(run('.c.str .c.add[2;.c.i]')).toBe('"2+1i"');
  });
  it('vectorises', () => {
    expect(run('.c.re .c.z[til 4;1]')).toBe('0 1 2 3');
    expect(run('count .c.tbl .c.z[til 4;1]')).toBe('4');
  });
  it('accepts a re/im table', () => {
    expect(run('.c.str .c.z ([] re:1 2; im:0 1)')).toBe('"1+0i"\n"2+1i"');
  });
});

describe('.c arithmetic', () => {
  const cases: [string, string][] = [
    ['.c.str .c.add[.c.z[1;2];.c.z[3;4]]', '"4+6i"'],
    ['.c.str .c.sub[.c.z[1;2];.c.z[3;4]]', '"-2-2i"'],
    ['.c.str .c.mul[.c.z[1;2];.c.z[3;-1]]', '"5+5i"'],
    ['.c.str .c.mul[.c.i;.c.i]', '"-1+0i"'],
    ['.c.str .c.div[.c.z[1;0];.c.z[0;1]]', '"0-1i"'],
    ['.c.str .c.conj .c.z[3;4]', '"3-4i"'],
    ['.c.abs .c.z[3;4]', '5f'],
    ['.c.abs2 .c.z[3;4]', '25'],
    ['.c.str .c.inv .c.z[0;2]', '"0-0.5i"'],
    ['.c.str .c.neg .c.z[1;-2]', '"-1+2i"'],
    ['.c.str .c.pow[.c.i;2]', '"-1+1.224647e-16i"'],
    ['.c.str .c.rot[.c.z[1;0];pi]', '"-1+1.224647e-16i"'],
  ];
  for (const [src, want] of cases) it(src, () => expect(run(src)).toBe(want));

  it('knows Eulers identity', () => {
    expect(isTrue('1e-12 > .c.abs .c.add[.c.exp .c.mul[.c.i;pi];1]')).toBe(true);
  });
  it('round-trips through log and exp', () => {
    expect(isTrue('1e-12 > .c.abs .c.sub[.c.exp .c.log .c.z[3;4];.c.z[3;4]]')).toBe(true);
  });
  it('squares its own square root', () => {
    expect(isTrue('1e-12 > .c.abs .c.sub[.c.mul[s;s:.c.sqrt .c.z[-1;0]];.c.z[-1;0]]')).toBe(true);
  });
  it('has a modulus that matches Pythagoras', () => {
    expect(isTrue('(.c.abs .c.z[3 5;4 12]) ~ 5 13f')).toBe(true);
  });
  it('measures arguments', () => {
    expect(isTrue('1e-12 > abs (.c.arg .c.z[0;1]) - pi%2')).toBe(true);
  });
});

describe('.c sequences', () => {
  it('roots of unity sum to zero and lie on the unit circle', () => {
    expect(isTrue('all 1e-12 > abs 1 - .c.abs .c.roots 7')).toBe(true);
    expect(isTrue('1e-12 > .c.abs .c.sum .c.roots 7')).toBe(true);
  });
  it('grids span the rectangle row-major', () => {
    expect(run('.c.re .c.grid[3;2;.c.z[-1;-1];.c.z[1;1]]')).toBe('-1 0 1 -1 0 1f');
    expect(run('.c.im .c.grid[3;2;.c.z[-1;-1];.c.z[1;1]]')).toBe('-1 -1 -1 1 1 1f');
  });
  it('escape counts distinguish inside from outside the set', () => {
    // the origin never escapes; 2+2i leaves immediately
    expect(run('.c.escape[0;.c.z[0;0];50]')).toBe(',50');
    expect(run('.c.escape[0;.c.z[2;2];50]')).toBe(',1');
  });
  it('fft round-trips', () => {
    expect(isTrue('all 1e-9 > .c.abs .c.sub[.c.ifft .c.fft .c.z[1 2 3 4;0];.c.z[1 2 3 4;0]]')).toBe(
      true
    );
  });
  it('fft finds a pure tone', () => {
    // 8 samples of one cycle put all the energy in bin 1 (and its mirror)
    expect(isTrue('1 = first idesc .c.abs .c.fft sin (2*pi)*(til 8)%8')).toBe(true);
  });
});

describe('.c display', () => {
  it('prints a+bi', () => {
    expect(run('.c.str .c.z[3;-4]')).toBe('"3-4i"');
    expect(run('.c.str .c.z[1 2;0 1]')).toBe('"1+0i"\n"2+1i"');
  });
  it('makes a table for select', () => {
    expect(run('cols .c.tbl .c.roots 3')).toBe('`re`im');
  });
});
