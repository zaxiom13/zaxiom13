import { createInterp, runConsole } from '../src/q/index';
import { SketchRuntime } from '../src/sketch/runtime';
import type { Interp } from '../src/q/eval';

const fakeContainer = {
  getBoundingClientRect: () => ({ width: 800, height: 600 }),
} as unknown as HTMLElement;

export function headless(): { ip: Interp; rt: SketchRuntime; out: string[] } {
  const out: string[] = [];
  const ip = createInterp({ out: (s) => out.push(s) });
  const rt = new SketchRuntime(ip, fakeContainer, {});
  return { ip, rt, out };
}

export function q(ip: Interp, src: string) {
  return runConsole(ip, src);
}
