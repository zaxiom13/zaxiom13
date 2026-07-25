// Public API for the embedded q interpreter.

import { Interp } from './eval';
import { installBuiltins } from './builtins/index';
import { display, displayLines, compact, DEFAULT_OPTS, FmtOpts } from './format';
import { QValue, QError, UNIT } from './value';

export { Interp } from './eval';
export * from './value';
export { display, displayLines, compact } from './format';
export { parse } from './parser';
export { lex } from './lexer';

export function createInterp(opts?: { out?: (s: string) => void }): Interp {
  const ip = new Interp();
  installBuiltins(ip);
  if (opts?.out) ip.out = opts.out;
  return ip;
}

export interface RunResult {
  ok: boolean;
  /** everything written to stdout (show, 0N!, trailing value) */
  output: string;
  value?: QValue;
  error?: { msg: string; hint?: string };
}

/** Run a script the way the q console does: print the value of each statement. */
export function runConsole(ip: Interp, src: string, fmt?: FmtOpts): RunResult {
  fmt = fmt ?? (ip.fmt as FmtOpts);
  const buf: string[] = [];
  const prevOut = ip.out;
  ip.out = (s) => buf.push(s);
  try {
    const results = ip.runAll(src);
    let last: QValue | undefined;
    for (const r of results) {
      last = r.value;
      if (shouldPrint(r.node, r.value)) buf.push(display(r.value, fmt));
    }
    return { ok: true, output: buf.join('\n'), value: last };
  } catch (e: any) {
    const msg = e instanceof QError ? e.qmsg : String(e?.message ?? e);
    return {
      ok: false,
      output: buf.join('\n'),
      error: { msg, hint: e instanceof QError ? e.hint : undefined },
    };
  } finally {
    ip.out = prevOut;
  }
}

export function shouldPrint(node: any, v: QValue): boolean {
  if (v === undefined) return false;
  if (v.t === -101) return false; // ::
  if (node && node.k === 'assign') return false;
  if (node && node.k === 'ctrl') return false;
  return true;
}
