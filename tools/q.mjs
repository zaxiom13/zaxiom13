#!/usr/bin/env node
// Tiny CLI REPL for the interpreter:  node --import tsx tools/q.mjs '1+1'
import { createInterp, runConsole } from '../src/q/index.ts';
import { createInterface } from 'node:readline';

const ip = createInterp({ out: (s) => console.log(s) });
const args = process.argv.slice(2);

if (args.length) {
  for (const a of args) {
    const r = runConsole(ip, a);
    console.log(r.ok ? r.output : "'" + r.error.msg + (r.error.hint ? '  / ' + r.error.hint : ''));
  }
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'q)' });
  rl.prompt();
  rl.on('line', (line) => {
    const r = runConsole(ip, line);
    const out = r.ok ? r.output : "'" + r.error.msg + (r.error.hint ? '  / ' + r.error.hint : '');
    if (out) console.log(out);
    rl.prompt();
  });
}
