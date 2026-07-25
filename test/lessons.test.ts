import { describe, it, expect } from 'vitest';
import { LESSONS } from '../src/content/lessons';
import { headless, q } from './util';
import { truthy } from '../src/q/eval';
import { float, isFunc, isTable, isDict, UNIT } from '../src/q/value';

describe('lessons', () => {
  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      // a lesson is one q session, like a page of documentation
      const { ip, rt } = headless();
      lesson.blocks.forEach((b, i) => {
        if (b.kind !== 'code' && b.kind !== 'sketch') return;
        it(`block ${i} runs`, () => {
          const res = q(ip, b.code!);
          if (b.err) {
            expect(res.ok, 'expected this snippet to fail').toBe(false);
            return;
          }
          if (!res.ok) throw new Error(`'${res.error!.msg} — ${res.error!.hint ?? ''}\n${b.code}`);
          // sketch blocks must actually put something on the canvas
          if (b.kind === 'sketch') {
            const frame = ip.globals.get('frame');
            const ts = ip.globals.get('.z.ts');
            if (frame) {
              const rank = ip.rankOf(frame);
              const init = ip.globals.get('init');
              let st = init === undefined ? UNIT : init;
              for (const t of [0.0, 0.4]) {
                const out =
                  rank >= 2 ? ip.apply(frame, [st, float(t)]) : ip.apply(frame, [float(t)]);
                if (rank >= 2) st = out;
              }
              const scene = rt.lastDrawn;
              expect(isTable(scene!) || isDict(scene!), 'frame drew nothing').toBe(true);
            } else if (ts) {
              ip.apply(ts, [float(0.1)]);
              expect(!!rt.lastDrawn, 'the timer drew nothing').toBe(true);
            } else {
              expect(!!rt.lastDrawn, 'the sketch drew nothing').toBe(true);
            }
          }
        });
      });

      if (lesson.challenge) {
        it('challenge solution passes its own check', () => {
          const { ip } = headless();
          const r1 = q(ip, lesson.challenge!.solution);
          if (!r1.ok) throw new Error(`solution failed: '${r1.error!.msg}`);
          const r2 = q(ip, lesson.challenge!.check);
          if (!r2.ok) throw new Error(`check failed: '${r2.error!.msg}`);
          expect(truthy(r2.value!), `check was ${r2.output}`).toBe(true);
        });

        it('challenge starter does not already pass', () => {
          const { ip } = headless();
          q(ip, lesson.challenge!.starter);
          const r = q(ip, lesson.challenge!.check);
          const passes = r.ok && truthy(r.value!);
          expect(passes).toBe(false);
        });
      }
    });
  }
});
