#!/usr/bin/env node
// Check a deployed URL the way a browser would: fetch the page, then every
// asset it references.
//
//   npm run verify:url https://example.com/

const base = process.argv[2];
if (!base) {
  console.error('usage: node tools/verify-url.mjs <url>');
  process.exit(2);
}

const res = await fetch(base, { redirect: 'follow' });
const html = await res.text();
console.log(`${res.status} ${base}  (${(html.length / 1024).toFixed(1)} kB)`);
if (!res.ok) process.exit(1);

const refs = [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
  ...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g),
]
  .map((m) => m[1])
  .filter((u) => !/^(data:|#)/.test(u) && !/^https?:/.test(u));

let bad = 0;
for (const ref of refs) {
  const url = new URL(ref, base).href;
  const r = await fetch(url, { redirect: 'follow' });
  const type = r.headers.get('content-type') ?? '';
  // a "200" that is really the 404 page counts as broken
  const looksLikeHtml = type.includes('text/html') && !/\.html?($|\?)/.test(ref);
  const ok = r.ok && !looksLikeHtml;
  if (!ok) bad++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.status} ${ref}${looksLikeHtml ? '  (served as HTML)' : ''}`);
}

if (bad) {
  console.error(`\n${bad} of ${refs.length} assets are missing — the deploy is incomplete.`);
  process.exit(1);
}
console.log(`\nall ${refs.length} assets present`);
