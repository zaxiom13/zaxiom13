#!/usr/bin/env node
// Parity harness: run the docs corpus against our interpreter and report.
//
//   node tools/parity.mjs                  summary
//   node tools/parity.mjs --fail 40        show first 40 failures
//   node tools/parity.mjs --file ref/asc   only blocks from matching files
//   node tools/parity.mjs --kind mismatch  filter failure kind
//   node tools/parity.mjs --json out.json  write full results

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createInterp, runConsole } from '../src/q/index.ts';

const corpus = JSON.parse(readFileSync(new URL('../parity/corpus.json', import.meta.url), 'utf8'));

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : dflt;
};
const showFails = parseInt(opt('fail', '0'), 10);
const fileFilter = opt('file', null);
const kindFilter = opt('kind', null);
const jsonOut = opt('json', null);
const groupBy = args.includes('--group');

// q error names that mean "our interpreter refused", not "name not defined"
const QERRS = new Set([
  'type', 'parse', 'rank', 'length', 'domain', 'limit', 'stop', 'nyi', 'index',
  'sig', 'assign', 'adverb', 'char', 'splay', 'value', 'cast', 'count',
]);

export function classify(want, got, srcNames) {
  if (got === want) return 'pass';
  const m = /^'([A-Za-z_.][A-Za-z0-9_.]*)$/.exec(got.split('\n')[0]);
  if (m && !QERRS.has(m[1]) && !want.startsWith("'")) return 'fixture';
  if (got.startsWith("'parse")) return 'unsupported';
  if (got.startsWith("'") && !want.startsWith("'")) return 'error';
  return 'mismatch';
}

const norm = (s) =>
  s
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();

// the docs sometimes annotate output lines with "  / comment"
const stripOutComment = (s) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s{2,}\/.*$/, '').replace(/\s+$/, ''))
    .join('\n')
    .trim();

// q prints errors with a backtrace; we only require the error name to match
const errName = (s) => /^'[^\s]*/.exec(s)?.[0] ?? s;

// The suppliers-and-parts database that many doc pages load with \l sp.q
const SP_Q = `
s:([s:\`s1\`s2\`s3\`s4\`s5] name:\`smith\`jones\`blake\`clark\`adams; status:20 10 30 20 30; city:\`london\`paris\`paris\`london\`athens)
p:([p:\`p1\`p2\`p3\`p4\`p5\`p6] name:\`nut\`bolt\`screw\`screw\`cam\`cog; color:\`red\`green\`blue\`red\`blue\`red; weight:12 17 17 14 12 19; city:\`london\`paris\`rome\`london\`paris\`london)
sp:([] s:\`s1\`s1\`s1\`s1\`s4\`s1\`s2\`s2\`s3\`s4\`s4\`s1; p:\`p1\`p2\`p3\`p4\`p5\`p6\`p1\`p2\`p2\`p2\`p4\`p5; qty:300 200 400 200 100 100 300 400 200 200 300 400)
`;

let total = 0;
const counts = { pass: 0, fixture: 0, unsupported: 0, error: 0, mismatch: 0 };
const failures = [];
const byFile = new Map();

// group blocks by file: a documentation page is one q session
const files = new Map();
for (const b of corpus.blocks) {
  if (fileFilter && !b.file.includes(fileFilter)) continue;
  if (!files.has(b.file)) files.set(b.file, []);
  files.get(b.file).push(b);
}

for (const [file, blocks] of files) {
  const ip = createInterp();
  ip.stepLimit = 2_000_000;
  try {
    ip.run(SP_Q);
  } catch {}
  for (const block of blocks) {
  if (block.skip) {
    // still execute, so later blocks on the page see the state, but never
    // let a skipped block build a multi-million row fixture
    const budget = Date.now() + 400;
    for (const step of block.steps) {
      if (Date.now() > budget) break;
      if (/\d{3,}\s*[*#?]|\?\s*\d{4,}/.test(step.in)) continue;
      try {
        runConsole(ip, step.in);
      } catch {}
    }
    continue;
  }
  for (const step of block.steps) {
    const wantRaw = stripOutComment(step.out);
    total++;
    let res;
    if (process.env.TRACE) process.stderr.write(`${block.id} :: ${step.in}\n`);
    try {
      res = runConsole(ip, step.in);
    } catch (e) {
      res = { ok: false, output: '', error: { msg: String(e && e.message) } };
    }
    let actual = res.ok ? norm(res.output) : "'" + (res.error?.msg ?? 'error');
    let want = norm(wantRaw);
    if (want.startsWith("'") && want.includes('\n')) {
      want = errName(want);
      actual = errName(actual);
    }
    const kind = classify(want, actual, null);
    counts[kind]++;
    const f = byFile.get(block.file) ?? { pass: 0, fail: 0 };
    if (kind === 'pass') f.pass++;
    else {
      f.fail++;
      failures.push({ id: block.id, file: block.file, in: step.in, want, got: actual, kind });
    }
    byFile.set(block.file, f);
  }
  }
}

const scored = total - counts.fixture;
console.log(`steps attempted : ${total}`);
console.log(`missing fixture : ${counts.fixture}   (docs blocks that need data we don't ship)`);
console.log(`scored          : ${scored}`);
console.log(
  `PASS            : ${counts.pass}  (${((100 * counts.pass) / scored).toFixed(1)}% of scored)`
);
console.log(`mismatch        : ${counts.mismatch}`);
console.log(`error           : ${counts.error}`);
console.log(`unsupported     : ${counts.unsupported}`);

if (groupBy) {
  const rows = [...byFile.entries()].sort((a, b) => b[1].fail - a[1].fail).slice(0, 30);
  console.log('\nworst files:');
  for (const [f, s] of rows)
    console.log(`  ${String(s.fail).padStart(4)} fail  ${String(s.pass).padStart(4)} pass  ${f}`);
}

if (showFails) {
  const list = kindFilter ? failures.filter((f) => f.kind === kindFilter) : failures;
  console.log(`\n--- failures (${list.length}) ---`);
  for (const f of list.slice(0, showFails)) {
    console.log(`\n[${f.kind}] [${f.id}]  ${f.in}`);
    console.log('  want: ' + JSON.stringify(f.want));
    console.log('  got:  ' + JSON.stringify(f.got));
  }
}

if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ total, counts, failures }, null, 1));
