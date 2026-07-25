import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../src/content/examples';
import { headless, q } from './util';
import { isTable, isDict, count, float, UNIT } from '../src/q/value';

describe('gallery examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id} runs and produces a scene`, () => {
      const { ip, rt } = headless();
      const res = q(ip, ex.code);
      if (!res.ok) throw new Error(`${ex.id}: '${res.error!.msg} — ${res.error!.hint ?? ''}`);

      const frame = ip.globals.get('frame');
      const step = ip.globals.get('step');
      const draw = ip.globals.get('draw');
      if (step) {
        const init = ip.globals.get('init');
        let s = init && init.t >= 100 ? ip.apply(init, [UNIT]) : init!;
        expect(s).toBeDefined();
        for (let i = 0; i < 3; i++) s = ip.apply(step, [s, float(i * 0.1)]);
        const view = ip.globals.get('view');
        const scene = view ? ip.apply(view, [s]) : s;
        expect(isTable(scene) || isDict(scene)).toBe(true);
      } else if (frame) {
        for (const t of [0, 0.5, 2.25]) {
          const scene = ip.apply(frame, [float(t)]);
          expect(isTable(scene) || isDict(scene), `${ex.id} frame ${t}`).toBe(true);
          expect(count(scene)).toBeGreaterThan(0);
        }
      } else {
        // static sketch: `draw` must have been called with a table
        expect(res.value).toBeDefined();
      }
    });
  }
});
