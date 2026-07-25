// Run an animated example for a while and confirm it keeps drawing.
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await p.selectOption('#examples', 'flow');
await p.waitForTimeout(20000);
const state = await p.evaluate(() => ({
  mode: window.qrt.mode,
  running: window.qrt.running,
  frames: window.qrt.frameNo,
  fps: Math.round(window.qrt.fps),
  errors: [...document.querySelectorAll('#console .err')].map((e) => e.textContent),
}));
console.log(state);
if (errs.length) console.log('page errors:', errs);
await b.close();
