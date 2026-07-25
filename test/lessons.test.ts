import { describe, it, expect } from 'vitest';
import { LESSONS } from '../src/content/lessons';
import { headless, q } from './util';
import { truthy } from '../src/q/eval';
import { float, isFunc, isTable, isDict, UNIT } from '../src/q/value';

describe('lessons', () => {
  for (const lesson of LESSONS) {
    describe(lesson.id, () => {
      // a lesson is one q session, like a page of documentation
      const { ip } = headless();
      lesson.blocks.forEach((b, i) => {
        if (b.kind !== 'code' && b.kind !== 'sketch') return;
        it(`block ${i} runs`, () => {
          const res = q(ip, b.code!);
          if (b.err) {
            expect(res.ok, 'expected this snippet to fail').toBe(false);
            return;
          }
          if (!res.ok) throw new Error(`'${res.error!.msg} — ${res.error!.hint ?? ''}\n${b.code}`);
          // sketch blocks must actually produce something drawable
          if (b.kind === 'sketch') {
            const frame = ip.globals.get('frame');
            const step = ip.globals.get('step');
            if (frame) {
              const scene = ip.apply(frame, [float(0.4)]);
              expect(isTable(scene) || isDict(scene)).toBe(true);
            } else if (step) {
              const init = ip.globals.get('init')!;
              const s2 = ip.apply(step, [init, float(0.1)]);
              const view = ip.globals.get('view');
              const scene = view ? ip.apply(view, [s2]) : s2;
              expect(isTable(scene) || isDict(scene)).toBe(true);
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
