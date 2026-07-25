#!/usr/bin/env node
// The single-file build must be exactly that: one file, with nothing left to fetch.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'dist-offline';
const file = join(dir, 'qsketch.html');
if (!existsSync(file)) {
  console.error('verify-offline: qsketch.html was not produced');
  process.exit(1);
}
const html = readFileSync(file, 'utf8');
const leftovers = readdirSync(dir).filter((f) => f !== 'qsketch.html');
// only real tags count; the inlined script is full of strings that look like attributes
const external = [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
  ...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g),
]
  .map((m) => m[1])
  .filter((u) => !/^(data:|#)/.test(u) && !/^https?:/.test(u));

if (leftovers.length || external.length) {
  console.error('\nverify-offline: the single-file build is not self-contained.');
  for (const l of leftovers) console.error(`  stray file: ${dir}/${l}`);
  for (const e of external) console.error(`  still fetches: ${e}`);
  process.exit(1);
}
console.log(
  `verify-offline: qsketch.html is self-contained (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB)`
);
