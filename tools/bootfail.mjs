import { chromium } from 'playwright';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
// simulate a broken/blocked bundle
await page.route('**/assets/index-*.js', (r) => r.abort('failed'));
await page.goto('http://localhost:4173/').catch(() => {});
await page.waitForTimeout(1500);
console.log('status:', await page.textContent('#boot-status'));
console.log('error :', (await page.textContent('#boot-err')).slice(0, 120));
await page.screenshot({ path: '/tmp/interact/boot-error.png' });
await b.close();
