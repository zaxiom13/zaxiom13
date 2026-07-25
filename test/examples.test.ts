import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../src/content/examples';
import { headless, q } from './util';
import { isTable, isDict, count, float, UNIT, QValue } from '../src/q/value';

describe('gallery examples', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.id} runs and draws`, () => {
      const { ip, rt } = headless();
      const res = q(ip, ex.code);
      if (!res.ok) throw new Error(`${ex.id}: '${res.error!.msg} — ${res.error!.hint ?? ''}`);

      const frame = ip.globals.get('frame');
      const ts = ip.globals.get('.z.ts');

      if (frame) {
        const rank = ip.rankOf(frame);
        const init = ip.globals.get('init');
        let s: QValue = init === undefined ? UNIT : init;
        for (const t of [0, 0.5, 2.25]) {
          const out = rank >= 2 ? ip.apply(frame, [s, float(t)]) : ip.apply(frame, [float(t)]);
          if (rank >= 2) s = out;
          const scene = rt.lastDrawn ?? out;
          expect(isTable(scene) || isDict(scene), `${ex.id} frame ${t} drew nothing`).toBe(true);
          expect(count(scene!), `${ex.id} frame ${t} drew an empty scene`).toBeGreaterThan(0);
        }
      } else if (ts) {
        // a timer sketch: fire a few ticks by hand
        for (let i = 0; i < 3; i++) ip.apply(ts, [ip.globals.get('.z.P') ?? float(i)]);
        expect(rt.lastDrawn, `${ex.id} timer drew nothing`).toBeTruthy();
      } else {
        // a static sketch must have drawn during the program itself
        expect(rt.lastDrawn, `${ex.id} drew nothing`).toBeTruthy();
      }
    });
  }
});
