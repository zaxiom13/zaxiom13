#!/usr/bin/env node
// Drive the app with real mouse and keyboard input, and prove it reacts.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = '/tmp/interact';
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1100, height: 820 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);

const setCode = async (code) => {
  await page.evaluate((c) => window.qeditor.set(c), code);
  await page.click('#run');
  await page.waitForTimeout(900);
};

// ---- mouse ----------------------------------------------------------------
await setCode(`bg \`#0a0d13
frame:{[t]
  k:til 16;
  p:polar[70;(2*pi*k%16)+t];
  draw circles[.p5.mx+p\`x; .p5.my+p\`y; 8; hsv[k%16;0.7;1]];
  draw texts[.p5.mx;.p5.my-110;"mx=",string[floor .p5.mx],"  my=",string floor .p5.my] }`);

const box = await page.$eval('#canvas', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
for (const [dx, dy, name] of [
  [0.25, 0.3, 'mouse-1'],
  [0.7, 0.65, 'mouse-2'],
]) {
  await page.mouse.move(box.x + box.w * dx, box.y + box.h * dy);
  await page.waitForTimeout(500);
  await page.$eval('#canvas-wrap', (el) => el.scrollIntoView());
  await (await page.$('#canvas-wrap')).screenshot({ path: `${out}/${name}.png` });
  const pos = await page.evaluate(() => {
    const ip = window.qip;
    const g = (n) => ip.globals.get(n)?.v;
    return { mx: Math.round(g('.p5.mx')), my: Math.round(g('.p5.my')) };
  });
  console.log(name, pos);
}

// ---- keyboard -------------------------------------------------------------
await setCode(`bg \`#07090d
init:\`x\`y\`vx\`vy\`trail!(400f;300f;0f;0f;())
frame:{[s;t]
  ax:0.55*(pressed[\`right]-pressed \`left);
  ay:0.55*(pressed[\`down]-pressed \`up);
  s[\`vx]:0.94*s[\`vx]+ax;
  s[\`vy]:0.94*s[\`vy]+ay;
  s[\`x]:(s[\`x]+s\`vx) mod .p5.w;
  s[\`y]:(s[\`y]+s\`vy) mod .p5.h;
  s[\`trail]:(-90) sublist s[\`trail],enlist(s\`x;s\`y);
  if[count s\`trail; draw circles[s[\`trail][;0];s[\`trail][;1];2;\`#1f6feb]];
  draw circles[s\`x;s\`y;14;\`gold];
  draw texts[70;24;"keys: ",", " sv string .p5.keys;12];
  s }`);

await page.mouse.click(box.x + box.w / 2, box.y + box.h / 2); // focus away from the editor
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.qeval('floor (state`x;state`y)'));
await page.keyboard.down('ArrowRight');
await page.waitForTimeout(900);
await page.keyboard.up('ArrowRight');
await page.keyboard.down('ArrowDown');
await page.waitForTimeout(700);
await page.keyboard.up('ArrowDown');
await page.waitForTimeout(300);
const after = await page.evaluate(() => ({
  pos: window.qeval('floor (state`x;state`y)'),
  keys: [...window.qrt.keys],
}));
await (await page.$('#canvas-wrap')).screenshot({ path: `${out}/keys.png` });
console.log('ship before', before, 'after', after);

// ---- timer ----------------------------------------------------------------
await setCode(`bg \`#0a0d13
trade:([] time:\`time$(); px:100f)
trade:0#trade
px:100f
\\t 120
.z.ts:{[now]
  px::px+0.6*(rand 1.0)-0.5;
  \`trade insert (\`time$now; px);
  if[500<count trade; trade::-500#trade];
  draw plot[til count trade; trade\`px], texts[90;24;"ticks: ",string count trade;12] }`);
await page.waitForTimeout(2600);
const ticks = await page.evaluate(() => window.qeval('count trade'));
await (await page.$('#canvas-wrap')).screenshot({ path: `${out}/timer.png` });
console.log('timer ticks after 2.6s:', ticks, '| mode', await page.textContent('#badge-mode'));

const consoleErrs = await page.$$eval('#console .err', (es) => es.map((e) => e.textContent));
console.log('console errors:', consoleErrs, '| page errors:', errs);
await b.close();
