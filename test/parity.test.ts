// Regression guard: replay the kdb+ documentation corpus that ships with the
// app (ref/ and basics/ pages) and hold the pass rate.

import { describe, it, expect } from 'vitest';
import { createInterp, runConsole } from '../src/q/index';
import suite from '../src/content/parity-suite.json';

const QERRS = new Set([
  'type', 'parse', 'rank', 'length', 'domain', 'limit', 'stop', 'nyi', 'index',
  'sig', 'assign', 'adverb', 'char', 'value', 'cast', 'count',
]);

const norm = (s: string) =>
  s
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();

const stripComment = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s{2,}\/.*$/, '').replace(/\s+$/, ''))
    .join('\n')
    .trim();

const errName = (s: string) => /^'[^\s]*/.exec(s)?.[0] ?? s;

const SP_Q = `
s:([s:\`s1\`s2\`s3\`s4\`s5] name:\`smith\`jones\`blake\`clark\`adams; status:20 10 30 20 30; city:\`london\`paris\`paris\`london\`athens)
p:([p:\`p1\`p2\`p3\`p4\`p5\`p6] name:\`nut\`bolt\`screw\`screw\`cam\`cog; color:\`red\`green\`blue\`red\`blue\`red; weight:12 17 17 14 12 19; city:\`london\`paris\`rome\`london\`paris\`london)
sp:([] s:\`s1\`s1\`s1\`s1\`s4\`s1\`s2\`s2\`s3\`s4\`s4\`s1; p:\`p1\`p2\`p3\`p4\`p5\`p6\`p1\`p2\`p2\`p2\`p4\`p5; qty:300 200 400 200 100 100 300 400 200 200 300 400)
`;

/** the interpreter must not regress below this share of scored examples */
const THRESHOLD = 0.8;

describe('kdb+ documentation parity', () => {
  it(`matches at least ${Math.round(THRESHOLD * 100)}% of scored examples`, () => {
    const byFile = new Map<string, (typeof suite.blocks)[number][]>();
    for (const b of suite.blocks) {
      if (!byFile.has(b.file)) byFile.set(b.file, []);
      byFile.get(b.file)!.push(b);
    }
    let pass = 0,
      fixture = 0,
      total = 0;
    for (const [, blocks] of byFile) {
      const ip = createInterp();
      ip.stepLimit = 400_000;
      try {
        ip.run(SP_Q);
      } catch {}
      for (const block of blocks) {
        for (const step of block.steps) {
          total++;
          let res;
          try {
            res = runConsole(ip, step.in);
          } catch (e: any) {
            res = { ok: false, output: '', error: { msg: String(e?.message ?? e) } } as any;
          }
          let got = res.ok ? norm(res.output) : "'" + (res.error?.msg ?? 'error');
          let want = norm(stripComment(step.out));
          if (want.startsWith("'") && want.includes('\n')) {
            want = errName(want);
            got = errName(got);
          }
          if (got === want) {
            pass++;
            continue;
          }
          const m = /^'([A-Za-z_.][A-Za-z0-9_.]*)$/.exec(got.split('\n')[0]);
          if (m && !QERRS.has(m[1]) && !want.startsWith("'")) fixture++;
        }
      }
    }
    const scored = total - fixture;
    const rate = pass / scored;
    // eslint-disable-next-line no-console
    console.log(
      `parity: ${pass}/${scored} = ${(100 * rate).toFixed(1)}%  (${fixture} skipped, no fixture)`
    );
    expect(rate).toBeGreaterThan(THRESHOLD);
  });
});
