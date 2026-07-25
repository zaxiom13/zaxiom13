#!/usr/bin/env node
// Build the in-app parity suite: the reference and basics pages only.
import { readFileSync, writeFileSync } from 'node:fs';

const corpus = JSON.parse(readFileSync(new URL('../parity/corpus.json', import.meta.url), 'utf8'));
const blocks = corpus.blocks.filter(
  (b) => !b.skip && (b.file.startsWith('docs/ref/') || b.file.startsWith('docs/basics/'))
);
const out = {
  source: corpus.source,
  license: corpus.license,
  generated: corpus.generated,
  blocks: blocks.map((b) => ({ id: b.id, file: b.file.replace(/^docs\//, ''), steps: b.steps })),
};
writeFileSync(new URL('../src/content/parity-suite.json', import.meta.url), JSON.stringify(out));
console.log('blocks', out.blocks.length, 'steps', out.blocks.reduce((a, b) => a + b.steps.length, 0));
