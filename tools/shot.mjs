#!/usr/bin/env node
// Screenshot / smoke-test the app in headless Chromium.
//   node tools/shot.mjs [url] [outdir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/tmp/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function shot(name, opts, steps) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}\n${(e.stack||'').split('\n').slice(0,4).join('\n')}`));
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  if (steps) await steps(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  await ctx.close();
}

await shot('desktop', { viewport: { width: 1440, height: 900 } });
await shot('mobile', {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
await shot('lessons', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.click('button[data-tab="learn"]');
  await page.waitForTimeout(300);
  await page.click('.lesson-list .card:nth-child(9)');
  await page.waitForTimeout(400);
});
await shot('reference', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.click('button[data-tab="ref"]');
  await page.waitForTimeout(400);
});
await shot('example-candles', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.selectOption('#examples', 'candles');
  await page.waitForTimeout(1200);
});
await shot('example-flow', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.selectOption('#examples', 'flow');
  await page.waitForTimeout(2500);
});
await shot('parity', { viewport: { width: 1440, height: 900 } }, async (page) => {
  await page.click('button[data-tab="parity"]');
  await page.waitForTimeout(300);
  await page.click('#parity button.primary');
  await page.waitForTimeout(9000);
});

await browser.close();
if (errors.length) {
  console.log('PAGE ERRORS:');
  for (const e of errors) console.log('  ' + e);
  process.exitCode = 1;
} else console.log('no page errors');
console.log('shots in ' + out);
