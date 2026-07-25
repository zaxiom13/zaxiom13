#!/usr/bin/env node
// Fail the build if the published HTML points at files that are not there.
//
// A deploy that ships index.html without its assets looks fine to the build
// system and completely broken to a visitor, so check it here instead.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const htmlPath = join(dir, 'index.html');

if (!existsSync(htmlPath)) {
  console.error(`verify-dist: ${htmlPath} does not exist — did the build run?`);
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#)/.test(u));

const missing = [];
for (const ref of refs) {
  const file = join(dir, ref.replace(/^\.?\//, '').split('?')[0]);
  if (!existsSync(file)) missing.push(ref);
}

const assetsDir = join(dir, 'assets');
const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
const total = assets.reduce((a, f) => a + statSync(join(assetsDir, f)).size, 0);

if (missing.length || !assets.length) {
  console.error('\nverify-dist: the build output is incomplete.\n');
  if (!assets.length) console.error(`  ${assetsDir} is empty or missing`);
  for (const m of missing) console.error(`  index.html references ${m}, which was not built`);
  console.error('');
  process.exit(1);
}

console.log(
  `verify-dist: ${refs.length} references, ${assets.length} assets, ${(total / 1024).toFixed(0)} kB — all present`
);
