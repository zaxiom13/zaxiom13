// The Parity tab: run the official kdb+ documentation examples, in the
// browser, against this interpreter, and show exactly where it differs.

import { el, clear, md } from './dom';
import { createInterp, runConsole } from '../q/index';

interface Step {
  in: string;
  out: string;
}
interface Block {
  id: string;
  file: string;
  steps: Step[];
}

type Kind = 'pass' | 'fixture' | 'mismatch' | 'error' | 'unsupported';

interface Failure {
  id: string;
  file: string;
  in: string;
  want: string;
  got: string;
  kind: Kind;
}

const QERRS = new Set([
  'type', 'parse', 'rank', 'length', 'domain', 'limit', 'stop', 'nyi', 'index',
  'sig', 'assign', 'adverb', 'char', 'value', 'cast', 'count',
]);

const norm = (s: string) =>
  s
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();

const stripComment = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/\s{2,}\/.*$/, '').replace(/\s+$/, ''))
    .join('\n')
    .trim();

const errName = (s: string) => /^'[^\s]*/.exec(s)?.[0] ?? s;

const SP_Q = `
s:([s:\`s1\`s2\`s3\`s4\`s5] name:\`smith\`jones\`blake\`clark\`adams; status:20 10 30 20 30; city:\`london\`paris\`paris\`london\`athens)
p:([p:\`p1\`p2\`p3\`p4\`p5\`p6] name:\`nut\`bolt\`screw\`screw\`cam\`cog; color:\`red\`green\`blue\`red\`blue\`red; weight:12 17 17 14 12 19; city:\`london\`paris\`rome\`london\`paris\`london)
sp:([] s:\`s1\`s1\`s1\`s1\`s4\`s1\`s2\`s2\`s3\`s4\`s4\`s1; p:\`p1\`p2\`p3\`p4\`p5\`p6\`p1\`p2\`p2\`p2\`p4\`p5; qty:300 200 400 200 100 100 300 400 200 200 300 400)
`;

export function renderParity(host: HTMLElement) {
  clear(host);
  host.append(
    el('h2', {}, 'Parity with real kdb+'),
    el('p', {
      html: md(
        'This interpreter is checked against **every runnable example in the official kdb+ documentation** ([KxSystems/docs](https://github.com/KxSystems/docs), CC BY 4.0). Each page is replayed as one q session and the printed output is compared character for character with what KX shows.'
      ),
    }),
    el('p', {
      html: md(
        'Examples that need data we do not ship (a market-data table, a file on disk) are counted separately as *no fixture* rather than silently passed.'
      ),
    })
  );

  const runBtn = el('button', { class: 'primary' }, 'Run the suite');
  const bar = el('div', { class: 'meter' }, el('i', { style: { width: '0%' } }));
  const summary = el('div');
  const detail = el('div');
  host.append(el('div', { class: 'chips' }, runBtn), bar, summary, detail);

  runBtn.addEventListener('click', async () => {
    runBtn.setAttribute('disabled', 'true');
    clear(summary);
    clear(detail);
    const suite = (await import('../content/parity-suite.json')) as unknown as {
      default: { blocks: Block[]; generated: string };
    };
    const blocks: Block[] = (suite as any).default?.blocks ?? (suite as any).blocks;

    const byFile = new Map<string, Block[]>();
    for (const b of blocks) {
      if (!byFile.has(b.file)) byFile.set(b.file, []);
      byFile.get(b.file)!.push(b);
    }

    const counts: Record<Kind, number> = {
      pass: 0,
      fixture: 0,
      mismatch: 0,
      error: 0,
      unsupported: 0,
    };
    const failures: Failure[] = [];
    const fileStats = new Map<string, { pass: number; fail: number }>();
    const files = [...byFile.entries()];
    let fi = 0;

    const tick = async () => {
      const t0 = performance.now();
      while (fi < files.length && performance.now() - t0 < 40) {
        const [file, fblocks] = files[fi++];
        const ip = createInterp({ out: () => {} });
        ip.stepLimit = 400_000;
        try {
          ip.run(SP_Q);
        } catch {}
        for (const block of fblocks) {
          for (const step of block.steps) {
            let res;
            try {
              res = runConsole(ip, step.in);
            } catch (e: any) {
              res = { ok: false, output: '', error: { msg: String(e?.message ?? e) } } as any;
            }
            let got = res.ok ? norm(res.output) : "'" + (res.error?.msg ?? 'error');
            let want = norm(stripComment(step.out));
            if (want.startsWith("'") && want.includes('\n')) {
              want = errName(want);
              got = errName(got);
            }
            const kind = classify(want, got);
            counts[kind]++;
            const st = fileStats.get(file) ?? { pass: 0, fail: 0 };
            if (kind === 'pass') st.pass++;
            else {
              st.fail++;
              failures.push({ id: block.id, file, in: step.in, want, got, kind });
            }
            fileStats.set(file, st);
          }
        }
      }
      const pct = Math.round((100 * fi) / files.length);
      (bar.firstElementChild as HTMLElement).style.width = pct + '%';
      if (fi < files.length) {
        requestAnimationFrame(() => tick());
      } else {
        report(counts, failures, fileStats);
        runBtn.removeAttribute('disabled');
      }
    };
    requestAnimationFrame(() => tick());
  });

  function report(
    counts: Record<Kind, number>,
    failures: Failure[],
    fileStats: Map<string, { pass: number; fail: number }>
  ) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const scored = total - counts.fixture;
    const pct = ((100 * counts.pass) / scored).toFixed(1);
    clear(summary);
    summary.append(
      el('h3', {}, `${pct}% of scored examples match kdb+ exactly`),
      el(
        'p',
        {},
        el('span', { class: 'pill ok' }, `${counts.pass} pass`),
        el('span', { class: 'pill bad' }, `${counts.mismatch} different output`),
        el('span', { class: 'pill bad' }, `${counts.error} error`),
        el('span', { class: 'pill bad' }, `${counts.unsupported} not parsed`),
        el('span', { class: 'pill' }, `${counts.fixture} no fixture`),
        el('span', { class: 'pill' }, `${total} examples`)
      )
    );

    const worst = [...fileStats.entries()].sort((a, b) => b[1].fail - a[1].fail).slice(0, 12);
    summary.append(
      el('h3', {}, 'Pages with the most differences'),
      el('div', {
        class: 'kv',
        html: worst
          .map(
            ([f, s]) =>
              `<b>${f}</b><span>${s.fail} differ · ${s.pass} match</span>`
          )
          .join(''),
      })
    );

    clear(detail);
    detail.append(el('h3', {}, `Differences (${failures.length})`));
    const kinds: Kind[] = ['mismatch', 'error', 'unsupported'];
    const chips = el('div', { class: 'chips' });
    let filter: Kind | null = null;
    const list = el('div');
    const draw = () => {
      clear(list);
      const items = failures.filter((f) => !filter || f.kind === filter).slice(0, 300);
      for (const f of items) {
        list.append(
          el(
            'div',
            { class: 'snippet' },
            el('pre', {}, `q)${f.in}`),
            el(
              'div',
              { class: 'snippet-bar' },
              el('span', { class: `pill bad` }, f.kind),
              el('span', { class: 'pill' }, f.file)
            ),
            el(
              'div',
              { class: 'result err' },
              `kdb+ says:\n${f.want}\n\nwe say:\n${f.got}`
            )
          )
        );
      }
      if (failures.length > items.length)
        list.append(el('p', {}, `… and ${failures.length - items.length} more`));
    };
    for (const k of kinds)
      chips.append(
        el(
          'button',
          {
            class: 'chip',
            onclick: (e: Event) => {
              filter = filter === k ? null : k;
              for (const c of Array.from(chips.children)) c.classList.remove('active');
              if (filter) (e.target as HTMLElement).classList.add('active');
              draw();
            },
          },
          k
        )
      );
    detail.append(chips, list);
    draw();
  }
}

function classify(want: string, got: string): Kind {
  if (got === want) return 'pass';
  const m = /^'([A-Za-z_.][A-Za-z0-9_.]*)$/.exec(got.split('\n')[0]);
  if (m && !QERRS.has(m[1]) && !want.startsWith("'")) return 'fixture';
  if (got.startsWith("'parse")) return 'unsupported';
  if (got.startsWith("'") && !want.startsWith("'")) return 'error';
  return 'mismatch';
}
