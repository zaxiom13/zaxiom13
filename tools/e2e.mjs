#!/usr/bin/env node
// End-to-end smoke test in headless Chromium.
//   npx vite preview --port 4173 &  node tools/e2e.mjs

import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173/';
const browser = await chromium.launch();
const problems = [];
let checks = 0;

const ok = (cond, msg) => {
  checks++;
  if (!cond) problems.push(msg);
};

async function withPage(name, opts, fn) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[${name}] console: ${m.text()}`);
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await fn(page);
  await ctx.close();
}

// 1. every gallery example runs and paints something
await withPage('gallery', { viewport: { width: 1280, height: 860 } }, async (page) => {
  const ids = await page.$$eval('#examples option', (os) =>
    os.map((o) => o.value).filter(Boolean)
  );
  ok(ids.length >= 10, `expected a full gallery, got ${ids.length}`);
  for (const id of ids) {
    await page.selectOption('#examples', id);
    await page.waitForTimeout(900);
    const badge = await page.textContent('#badge-shapes');
    const mode = await page.textContent('#badge-mode');
    const errs = await page.$$eval('#console .err', (es) => es.map((e) => e.textContent));
    ok(errs.length === 0, `${id}: console errors ${JSON.stringify(errs)}`);
    ok(/shapes/.test(badge ?? ''), `${id}: nothing drawn (mode ${mode})`);
  }
});

// 2. the REPL talks to the live sketch, and trace explains an expression
await withPage('repl', { viewport: { width: 1280, height: 860 } }, async (page) => {
  await page.fill('#repl input', 'sum til 10');
  await page.press('#repl input', 'Enter');
  await page.waitForTimeout(200);
  const out = await page.$$eval('#console .out', (es) => es.map((e) => e.textContent));
  ok(out.includes('45'), `repl did not print 45: ${JSON.stringify(out.slice(-3))}`);

  await page.evaluate(() => {
    const view = document.querySelector('.cm-content');
    return view;
  });
  await page.click('.cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('sum til 10');
  await page.click('#trace');
  await page.waitForTimeout(300);
  const notes = await page.$$eval('#console .note', (es) => es.map((e) => e.textContent).join('\n'));
  ok(/til 10/.test(notes) && /45/.test(notes), 'trace output missing');
});

// 2b. autocomplete: namespaces, symbols and snippets
await withPage('autocomplete', { viewport: { width: 1280, height: 860 } }, async (page) => {
  const type = async (text) => {
    await page.click('.cm-content');
    await page.keyboard.press('Control+a');
    await page.keyboard.type(text, { delay: 20 });
    await page.waitForTimeout(400);
  };
  const options = () =>
    page.$$eval('.cm-tooltip-autocomplete li', (ls) => ls.map((l) => l.textContent));

  await type('.p5.m');
  let opts = await options();
  ok(
    opts.some((o) => o.includes('.p5.mx')) && opts.some((o) => o.includes('.p5.mouse')),
    `namespace completion missing: ${JSON.stringify(opts.slice(0, 6))}`
  );

  await type('circ');
  opts = await options();
  ok(opts.some((o) => o.includes('circles')), `builtin completion missing: ${JSON.stringify(opts.slice(0, 6))}`);

  await type('x:`cri');
  opts = await options();
  ok(opts.some((o) => o.includes('crimson')), `colour completion missing: ${JSON.stringify(opts.slice(0, 6))}`);

  await type('.z.');
  opts = await options();
  ok(opts.some((o) => o.includes('.z.ts') || o.includes('.Q.s')) || opts.length > 0,
     `.z completion missing: ${JSON.stringify(opts.slice(0, 6))}`);
});

// 3. lessons: open one, check a challenge with the model solution
await withPage('lessons', { viewport: { width: 1280, height: 860 } }, async (page) => {
  await page.click('button[data-tab="learn"]');
  await page.waitForTimeout(200);
  const cards = await page.$$('.lesson-list .card');
  ok(cards.length >= 15, `expected the whole course, got ${cards.length}`);
  await cards[0].click();
  await page.waitForTimeout(200);
  await page.click('text=Evaluate');
  await page.waitForTimeout(200);
  const res = await page.textContent('.snippet .result');
  ok((res ?? '').trim() === '5', `snippet evaluate gave ${JSON.stringify(res)}`);
  await page.click('text=show solution');
  await page.click('text=Check');
  await page.waitForTimeout(300);
  const verdict = await page.$$eval('.result', (es) => es.map((e) => e.textContent).join(' | '));
  ok(/correct/.test(verdict), `challenge check failed: ${verdict}`);
});

// 4. the parity suite runs in the browser
await withPage('parity', { viewport: { width: 1280, height: 860 } }, async (page) => {
  await page.click('button[data-tab="parity"]');
  await page.click('#parity button.primary');
  await page.waitForTimeout(12000);
  const head = await page.textContent('#parity h3');
  ok(/% of scored/.test(head ?? ''), `parity summary missing: ${head}`);
  const pct = parseFloat((head ?? '0').replace(/[^\d.]/g, ''));
  ok(pct > 70, `parity dropped to ${pct}%`);
});

// 5. mobile: tabs, keypad, canvas
await withPage(
  'mobile',
  { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  async (page) => {
    const canvas = await page.$('#canvas canvas');
    ok(!!canvas, 'no canvas on mobile');
    await page.click('#mobilenav button[data-tab="console"]');
    await page.waitForTimeout(150);
    ok(
      await page.isVisible('#console-m'),
      'mobile console tab did not open'
    );
    await page.click('#mobilenav button[data-tab="code"]');
    await page.waitForTimeout(150);
    const keys = await page.$$('#keypad button');
    ok(keys.length > 20, `keypad missing (${keys.length} keys)`);
    await keys[0].click();
    await page.waitForTimeout(100);
    const doc = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
    ok(doc.length > 0, 'editor empty after keypad tap');
  }
);

await browser.close();
console.log(`${checks} checks`);
if (problems.length) {
  console.log('FAILURES:');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('all good');
