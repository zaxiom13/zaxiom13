// A second build target: one self-contained HTML file.
//
// The normal build is split for fast first paint on the web. This one inlines
// everything so the page works when opened straight from disk (file://), where
// browsers refuse to fetch JavaScript modules.
//
//   npm run build:offline   ->   dist-offline/qsketch.html

import { defineConfig, type Plugin } from 'vite';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function inlineEverything(outDir: string): Plugin {
  return {
    name: 'inline-everything',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const htmlPath = join(outDir, 'index.html');
      if (!existsSync(htmlPath)) return;
      let html = readFileSync(htmlPath, 'utf8');
      const used: string[] = [];

      html = html.replace(
        /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
        (_m, src: string) => {
          const file = join(outDir, src.replace(/^\.?\//, ''));
          used.push(file);
          const code = readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
          return `<script type="module">${code}</script>`;
        }
      );
      html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href: string) => {
        if (/^https?:/.test(href)) return ''; // the web font is not available offline
        const file = join(outDir, href.replace(/^\.?\//, ''));
        used.push(file);
        return `<style>${readFileSync(file, 'utf8')}</style>`;
      });
      // and neither is the preloaded copy of it
      html = html.replace(/<link[^>]*rel="preload"[^>]*fonts\.googleapis[^>]*>/g, '');
      html = html.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
      // modulepreload hints point at files that no longer exist
      html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

      writeFileSync(join(outDir, 'qsketch.html'), html);
      for (const f of used) rmSync(f, { force: true });
      rmSync(htmlPath, { force: true });
      rmSync(join(outDir, 'assets'), { recursive: true, force: true });
      const kb = Math.round(Buffer.byteLength(html) / 1024);
      // eslint-disable-next-line no-console
      console.log(`\n  ${outDir}/qsketch.html  ${kb} kB  — open it from anywhere, no server needed`);
    },
  };
}

const outDir = 'dist-offline';

export default defineConfig({
  base: './',
  build: {
    outDir,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  plugins: [inlineEverything(outDir)],
});
