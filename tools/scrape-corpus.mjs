#!/usr/bin/env node
// Extract q REPL transcripts from the official kdb+/q documentation
// (github.com/KxSystems/docs, CC BY 4.0) into a parity corpus.
//
//   node tools/scrape-corpus.mjs /path/to/kxdocs > parity/corpus.json

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.argv[2] || '/tmp/kxdocs';
const docsRoot = join(root, 'docs');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith('.md')) out.push(p);
  }
  return out;
}

// Expressions whose results are not reproducible offline / out of scope.
const SKIP_PATTERNS = [
  /\brand\b/, /\?\s*\d+\s*\?/, /\bdeal\b/, /\d\s*\?/, /\?\s*`/, /\?\s*\(/,
  /\.z\./, /\.Q\./, /\.h\./, /\.j\./, /\.m\./, /\.o\./, /\.s\./, /\.u\./, /\.q\./, /\.k\b/,
  /\bhopen\b/, /\bhclose\b/, /\bsystem\b/, /\bgetenv\b/, /\bsetenv\b/,
  /\bread0\b/, /\bread1\b/, /\bsave\b/, /\bload\b/, /\bget\b\s*`:/, /\bset\b\s*`:/,
  /`:/, /\\\\/, /^\s*\\/, /\bexit\b/, /\btimer\b/, /\bshow\s+\\/,
  /\bpeach\b/, /\bview\b/, /\bviews\b/, /\bhdel\b/, /\bhsym\b/,
  /\bdlopen\b/, /2:/, /1:/, /0:/, /\bmd5\b/, /\bgtime\b/, /\bltime\b/,
  /\bwj\b/, /\bwj1\b/, /\baj0\b/, /\bews\b/,
  /\bupsert\b\s*`/, /\binsert\b\s*`/,
  /\bexec\s+.*\bfby\b/,
];

const NONDET_OUTPUT = [/^\s*$/];

function shouldSkipExpr(s) {
  return SKIP_PATTERNS.some((re) => re.test(s));
}

const files = walk(docsRoot);
const blocks = [];
let idBase = 0;

for (const file of files) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  let i = 0;
  let blockIx = 0;
  while (i < lines.length) {
    const m = /^\s*```\s*q\s*$/.exec(lines[i]);
    if (!m) {
      i++;
      continue;
    }
    const indent = lines[i].length - lines[i].trimStart().length;
    const body = [];
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      body.push(lines[i].slice(indent));
      i++;
    }
    i++;
    blockIx++;
    const steps = parseTranscript(body);
    if (steps.length) {
      blocks.push({
        id: `${rel}#${blockIx}`,
        file: rel,
        steps,
      });
    }
  }
}

function parseTranscript(body) {
  const steps = [];
  let i = 0;
  while (i < body.length) {
    const line = body[i];
    if (!line.startsWith('q)')) {
      i++;
      continue;
    }
    let input = line.slice(2);
    i++;
    const out = [];
    while (i < body.length && !body[i].startsWith('q)')) {
      out.push(body[i]);
      i++;
    }
    // trim trailing blank lines from output
    while (out.length && out[out.length - 1].trim() === '') out.pop();
    steps.push({ in: input, out: out.join('\n') });
  }
  // drop blocks that are entirely inputless
  return steps;
}

const corpus = [];
for (const b of blocks) {
  const steps = b.steps.filter((s) => s.in.trim() !== '');
  if (!steps.length) continue;
  const skip = steps.some((s) => shouldSkipExpr(s.in));
  corpus.push({ id: b.id, file: b.file, steps, skip });
}

process.stdout.write(
  JSON.stringify(
    {
      source: 'https://github.com/KxSystems/docs',
      license: 'CC BY 4.0',
      generated: new Date().toISOString().slice(0, 10),
      blocks: corpus,
    },
    null,
    1
  )
);
