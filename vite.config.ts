import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {build, defineConfig, Plugin} from 'vite';

async function buildSingleFileOfflineHtml(rootDir: string): Promise<string> {
  const result = await build({
    configFile: false,
    root: rootDir,
    mode: 'production',
    logLevel: 'silent',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': rootDir,
      },
    },
    build: {
      write: false,
      minify: true,
      cssCodeSplit: false,
      assetsInlineLimit: 1024 * 1024 * 10,
      rollupOptions: {
        input: path.resolve(rootDir, 'src/main.tsx'),
        output: {
          format: 'iife',
          name: 'ElectribeWavExtractorApp',
          inlineDynamicImports: true,
        },
      },
    },
  });

  const outputs = Array.isArray(result) ? result : [result];
  let jsCode = '';
  let cssCode = '';

  for (const out of outputs) {
    if (!('output' in out)) continue;
    for (const item of out.output) {
      if (item.type === 'chunk' && item.isEntry) {
        jsCode = item.code;
      } else if (
        item.type === 'asset' &&
        typeof item.fileName === 'string' &&
        item.fileName.endsWith('.css')
      ) {
        cssCode +=
          typeof item.source === 'string'
            ? item.source
            : Buffer.from(item.source).toString('utf8');
      }
    }
  }

  const safeJs = jsCode.replace(/<\/script/gi, '<\\/script');
  const safeCss = cssCode.replace(/<\/style/gi, '<\\/style');

  return `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Electribe WAV Extractor (Offline)</title>
    <style>${safeCss}</style>
  </head>
  <body class="bg-[#0B0D11] text-zinc-100 antialiased selection:bg-orange-500/30 selection:text-orange-100">
    <div id="root"></div>
    <script>window.__ELECTRIBE_OFFLINE__ = true;</script>
    <script>${safeJs}</script>
  </body>
</html>`;
}

function offlineBundlePlugin(rootDir: string): Plugin {
  let cachedHtml: string | null = null;

  return {
    name: 'electribe-offline-bundle',
    configureServer(server) {
      server.middlewares.use(
        '/electribe-wav-extractor-offline.html',
        async (_req, res, next) => {
          try {
            if (!cachedHtml) {
              cachedHtml = await buildSingleFileOfflineHtml(rootDir);
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              'attachment; filename="electribe-wav-extractor-offline.html"'
            );
            res.end(cachedHtml);
          } catch (err) {
            next(err);
          }
        }
      );

      // Invalidate cached offline bundle when source files change
      server.watcher.on('change', (changedPath) => {
        if (changedPath.includes(`${path.sep}src${path.sep}`)) {
          cachedHtml = null;
        }
      });
    },
    async closeBundle(error?: Error) {
      if (error) return;
      const distDir = path.resolve(rootDir, 'dist');
      if (!fs.existsSync(distDir)) return;
      const html = await buildSingleFileOfflineHtml(rootDir);
      fs.writeFileSync(
        path.join(distDir, 'electribe-wav-extractor-offline.html'),
        html,
        'utf8'
      );
    },
  };
}

export default defineConfig(() => {
  return {
    base: '/wav/',
    plugins: [
      react(),
      tailwindcss(),
      offlineBundlePlugin(__dirname),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
