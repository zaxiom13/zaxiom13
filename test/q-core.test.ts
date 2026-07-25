import { describe, it, expect } from 'vitest';
import { runConsole } from '../src/q/index';
import { headless } from './util';

const { ip } = headless();
const run = (src: string) => {
  const r = runConsole(ip, src);
  return r.ok ? r.output : "'" + r.error!.msg;
};

// expression -> exactly what the q console prints
const GOLDEN: [string, string][] = [
  // atoms and vectors
  ['1+1', '2'],
  ['2*3+4', '14'],
  ['(2*3)+4', '10'],
  ['til 5', '0 1 2 3 4'],
  ['1 2 3+10', '11 12 13'],
  ['1 2 3*1 2 3', '1 4 9'],
  ['10%4', '2.5'],
  ['1%3', '0.3333333'],
  ['7 div 2', '3'],
  ['7 mod 3', '1'],
  ['1 -1', '1 -1'],
  ['x:10 20 30;x 1', '20'],
  ['count til 10', '10'],
  ['sum til 10', '45'],
  ['4.0', '4f'],
  ['1 2 3.0', '1 2 3f'],
  ['1 2.5', '1 2.5'],
  ['enlist 1', ',1'],
  ['0#0', '`long$()'],
  ['1b', '1b'],
  ['101b', '101b'],
  ['0x0a', '0x0a'],
  ['"a"', '"a"'],
  ['"abc"', '"abc"'],
  ['`abc', '`abc'],
  ['`a`b`c', '`a`b`c'],
  ['0N', '0N'],
  ['1 0N 3', '1 0N 3'],
  ['type 1 2 3', '7h'],
  ['type `a', '-11h'],
  ['type ([]a:1 2)', '98h'],

  // evaluation and functions
  ['{x*x} 7', '49'],
  ['{x*x} 1 2 3', '1 4 9'],
  ['{[a;b] a+b*b}[2;3]', '11'],
  ['f:{x+y};2 f 3', '5'],
  ['add10:10+;add10 1 2 3', '11 12 13'],
  ['sq:{x*x};sq each 1 2 3', '1 4 9'],
  ['(+/)1 2 3 4', '10'],
  ['(+\\)1 2 3 4', '1 3 6 10'],
  ['100+\\1 2 3', '101 103 106'],
  ['5{2*x}\\1', '1 2 4 8 16 32'],
  ['{x<100}{x*2}/1', '128'],
  ['count each ("ab";"cde")', '2 3'],
  ['1 2 ,\\: 10', '1 10\n2 10'],
  ['(-\':)1 3 6 10', '1 2 3 4'],

  // lists
  ['reverse til 5', '4 3 2 1 0'],
  ['3 4 1 2 where 1 0 1 1b', '3 1 2'],
  ['where 1 0 1 1b', '0 2 3'],
  ['asc 3 1 2', '`s#1 2 3'],
  ['desc 3 1 2', '3 2 1'],
  ['iasc 30 10 20', '1 2 0'],
  ['distinct 1 1 2 3 3', '1 2 3'],
  ['sums 1 2 3', '1 3 6'],
  ['deltas 1 3 6', '1 2 3'],
  ['3#1 2', '1 2 1'],
  ['-2#til 5', '3 4'],
  ['2_til 5', '2 3 4'],
  ['2 3#til 6', '0 1 2\n3 4 5'],
  ['3 cut til 6', '0 1 2\n3 4 5'],
  ['1 rotate 1 2 3 4', '2 3 4 1'],
  ['raze (1 2;3 4)', '1 2 3 4'],
  ['flip (1 2;3 4)', '1 3\n2 4'],
  ['1 2 3 in 2 4', '010b'],
  ['1 5 9 within 2 6', '011b'.slice(0, 3) === '011' ? '010b' : '010b'],
  ['5 xbar 0 3 7 11', '0 0 5 10'],
  ['"," sv ("ab";"cd")', '"ab,cd"'],
  ['"," vs "ab,cd"', '"ab"\n"cd"'],
  ['string 42', '"42"'],
  ['string `a`b', '"a"\n"b"'],
  ['?[1 0 1b;`on;`off]', '`on`off`on'],
  ['@[10 20 30;1;:;99]', '10 99 30'],
  ['@[1 2 3;1;+;10]', '1 12 3'],
  ['group `a`b`a', 'a| 0 2\nb| ,1'],

  // dictionaries and tables
  ['`a`b!1 2', 'a| 1\nb| 2'],
  ['d:`a`b!1 2;d`b', '2'],
  ['d:`a`b!1 2;key d', '`a`b'],
  ['d:`a`b!1 2;d+10', 'a| 11\nb| 12'],
  ['([]a:1 2;b:`x`y)', 'a b\n---\n1 x\n2 y'],
  ['t:([]a:1 20;b:`x`y);t', 'a  b\n----\n1  x\n20 y'],
  ['t:([]a:1 2;b:3 4);t`a', '1 2'],
  ['t:([]a:1 2;b:3 4);count t', '2'],
  ['t:([]a:1 2;b:3 4);first t', 'a| 1\nb| 3'],
  ['([k:1 2]v:3 4)', 'k| v\n-| -\n1| 3\n2| 4'],
  ['t:([]a:1 2 3);select from t where a>1', 'a\n-\n2\n3'],
  ['t:([]a:1 2 3);select b:a*2 from t', 'b\n-\n2\n4\n6'],
  [
    't:([]s:`x`y`x;v:1 2 3);select sum v by s from t',
    's| v\n-| -\nx| 4\ny| 2',
  ],
  ['t:([]a:1 2);update b:a*10 from t', 'a b\n----\n1 10\n2 20'],
  ['t:([]a:1 2;b:3 4);delete b from t', 'a\n-\n1\n2'],
  ['t:([]a:1 2 3);exec a from t', '1 2 3'],
  ['t:([]a:1 2 3);select from t where i<2', 'a\n-\n1\n2'],

  // errors
  ['1 2 3+4 5', "'length"],
  ['2+"hi"', "'type"],
  ['{x+y}[1;2;3]', "'rank"],
];

describe('q golden output', () => {
  for (const [src, want] of GOLDEN) {
    it(src, () => {
      expect(run(src)).toBe(want);
    });
  }
});

describe('temporal types', () => {
  const cases: [string, string][] = [
    ['2024.03.01', '2024.03.01'],
    ['2024.03.01+1', '2024.03.02'],
    ['09:30:00.000', '09:30:00.000'],
    ['09:30', '09:30'],
    ['00:05 xbar 09:37', '09:35'],
    ['2024.03.01D09:30:00.123456789', '2024.03.01D09:30:00.123456789'],
    ['0D00:00:01', '0D00:00:01.000000000'],
    ['`hh`uu`ss$03:55:58.11', '3 55 58i'],
    ['t:09:30:01.000 09:31:02.000;t.minute', '09:30 09:31'],
  ];
  for (const [src, want] of cases) it(src, () => expect(run(src)).toBe(want));
});

describe('sketch-facing helpers exist as plain q', () => {
  it('grid is a cross join', () => {
    expect(run('grid[2;2]')).toBe('p\n---\n0 0\n1 0\n0 1\n1 1');
  });
  it('remap rescales', () => {
    expect(run('remap[til 5;0;4;0;100]')).toBe('0 25 50 75 100f');
  });
});
