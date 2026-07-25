import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
await p.selectOption('#examples', 'flow');
await p.waitForTimeout(2000);
const info = await p.evaluate(() => {
  const rt = window.qrt, ip = window.qip;
  const view = ip.globals.get('view');
  const scene = ip.apply(view, [rt.state]);
  const cols = scene.c;
  return {
    cols,
    types: scene.v.map(v => v.t),
    firstRow: cols.map((c,i)=> [c, JSON.stringify(scene.v[i].v?.[0] ?? scene.v[i].v)]),
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
