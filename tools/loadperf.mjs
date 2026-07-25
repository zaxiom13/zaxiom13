#!/usr/bin/env node
// Measure first-load on a throttled mobile-ish connection.
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:4173/';
const label = process.argv[3] || 'run';
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// Fast-3G-ish network + 4x CPU slowdown
const client = await ctx.newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
});
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });


const t0 = Date.now();
await page.goto(url, { waitUntil: 'commit' });
const firstPaint = await page
  .waitForFunction(() => {
    const e = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    return e ? e.startTime : null;
  }, { timeout: 60000 })
  .then((h) => h.jsonValue());

// the app is usable when the canvas exists and the first sketch has drawn
await page.waitForFunction(() => !!document.querySelector('#canvas canvas'), { timeout: 90000 });
const canvasAt = Date.now() - t0;
await page.waitForFunction(() => (window.qrt?.lastShapes ?? 0) > 0, { timeout: 90000 });
const drawnAt = Date.now() - t0;

const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource');
  const wire = res.reduce((a, r) => a + (r.transferSize || 0), 0) + (n.transferSize || 0);
  const raw = res.reduce((a, r) => a + (r.decodedBodySize || 0), 0) + (n.decodedBodySize || 0);
  const top = res
    .map((r) => [r.name.split('/').pop(), Math.round((r.transferSize || 0) / 1024)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  return {
    domContentLoaded: Math.round(n.domContentLoadedEventEnd),
    load: Math.round(n.loadEventEnd),
    wire: Math.round(wire / 1024),
    raw: Math.round(raw / 1024),
    top,
  };
});

console.log(`[${label}]`);
console.log(`  first contentful paint : ${Math.round(firstPaint)} ms`);
console.log(`  canvas exists          : ${canvasAt} ms`);
console.log(`  first sketch drawn     : ${drawnAt} ms`);
console.log(`  DOMContentLoaded       : ${nav.domContentLoaded} ms`);
console.log(`  transferred (gzip)     : ${nav.wire} kB   (${nav.raw} kB unpacked)`);
for (const [n2, kb] of nav.top) console.log(`      ${String(n2).slice(0, 34).padEnd(36)} ${kb} kB`);
await b.close();
