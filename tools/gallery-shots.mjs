#!/usr/bin/env node
// Screenshot the canvas for every gallery example.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = '/tmp/gallery';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1100, height: 800 } });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const ids = await page.$$eval('#examples option', (os) => os.map((o) => o.value).filter(Boolean));
for (const id of ids) {
  await page.selectOption('#examples', id);
  await page.waitForTimeout(2200);
  const el = await page.$('#canvas-wrap');
  await el.screenshot({ path: `${out}/${id}.png` });
  console.log(id, await page.textContent('#badge-shapes'));
}
await b.close();
