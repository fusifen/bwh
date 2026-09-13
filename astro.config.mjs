// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import node from '@astrojs/node';
import react from '@astrojs/react';
import keystatic from '@keystatic/astro';
import tailwindcss from '@tailwindcss/vite';

/**
 * Base configuration — dev, check and preview.
 *
 * The build uses a different adapter; see `astro.config.cloudflare.mjs` and the
 * "Two configs, one difference" note below.
 *
 * Deployment target
 * -----------------
 * **Cloudflare Workers.** `@astrojs/cloudflare` removed Pages support, so
 * `wrangler deploy` is the deploy step and the Worker serves the static assets
 * from the same bundle. There is no "build output directory" setting to get
 * wrong any more — that trap belonged to the Pages workflow, where pointing it
 * at `dist` instead of `dist/client` produced a site-wide 404.
 *
 * A Cloudflare build produces:
 *   dist/client   static assets (the whole public site)
 *   dist/server   the Worker: entry.mjs + an auto-generated wrangler.json
 *
 * Two configs, one difference
 * ---------------------------
 * This file carries the **Node** adapter; `astro.config.cloudflare.mjs` swaps in
 * the Cloudflare one and inherits everything else. The split is not a style
 * preference — `adapter` cannot depend on the Astro command:
 *
 *   - `defineConfig` is an identity function, so exporting a function to vary
 *     the config per command is a type error (`AstroUserConfig has no
 *     properties in common with ...`).
 *   - `@astrojs/cloudflare` runs `astro dev` under `workerd` via
 *     `@cloudflare/vite-plugin`. `workerd` has no filesystem, and Keystatic's
 *     `storage: { kind: 'local' }` admin writes JSON straight into
 *     `src/content` — under `workerd` it has nowhere to write. (Observed
 *     directly: with the Cloudflare adapter, `astro dev` served `/` and
 *     `/keystatic` but returned 404 for `/plans`, `/blog`, `/learn`,
 *     `/disclosure` and `/go/*`.)
 *
 * The cost is that `astro dev` does not exercise the Workers runtime. That is an
 * accepted trade: the only runtime code is one redirect route with no bindings,
 * and a working admin is worth more than previewing that redirect under
 * `workerd`.
 *
 * `site` must be overridden before launch
 * ---------------------------------------
 * The default below is a deliberate placeholder. `site` feeds canonical URLs,
 * `og:url`, the sitemap, RSS and every JSON-LD `@id` — a wrong value poisons all
 * of them at once and nothing in the build complains. `npm run audit` fails if
 * the placeholder survives into the artifact, so it cannot ship by accident.
 *
 *   npm run build -- --site=https://your-domain.example
 */
const SITE_URL = process.env.SITE_URL || 'https://stellar-shell.example.workers.dev';

/** Routes that must never reach the index or the sitemap. */
const EXCLUDED = /\/(keystatic|go|search|api)(\/|$)/;

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'ignore',

  /*
    Sessions are off.

    Astro enables sessions by default, and the Cloudflare adapter then declares a
    `SESSION` KV namespace binding — so the first `wrangler deploy` would
    provision a KV namespace for a site with no users, no logins and no server
    state. `session: false` removes the binding and drops the session runtime
    from the Worker bundle.
  */
  session: false,

  adapter: node({ mode: 'standalone' }),

  integrations: [
    // Keystatic renders its admin UI with React and needs server rendering.
    react(),
    keystatic(),
    mdx(),
    sitemap({
      filter: (page) => !EXCLUDED.test(new URL(page).pathname),
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],

  image: {
    // Sharp-based optimisation at build time: AVIF + WebP with JPEG fallback.
    // The Cloudflare config pairs this with `imageService: 'compile'` so image
    // work stays at build time; the adapter's own default, 'cloudflare-binding',
    // would require an Images binding this project does not use.
    service: { entrypoint: 'astro/assets/services/sharp' },
  },

  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },

  compressHTML: true,

  vite: {
    /*
      Every command gets its own dependency pre-bundle directory.

      Astro runs Vite for `dev`, for `check` and for `build`, and the resolved
      Vite config differs between them — most obviously the adapter, which is
      Cloudflare for builds and Node for everything else. Vite hashes that config
      and re-optimises its pre-bundle whenever the hash changes, so sharing one
      directory means every `npm run verify` deletes and rebuilds the cache
      several times.

      Two things go wrong when the caches are shared:

      1. **Keystatic blanks.** The dev server ends up holding `?v=` hashes for a
         cache that `astro check` or `astro build` has since replaced. Every
         Keystatic module then answers `504 Outdated Optimize Dep`, the React
         island never hydrates, and `/keystatic` renders blank.

      2. **The re-optimisation is pure waste.** A full verify run re-bundles
         dependencies once per command instead of once per cache.

      Splitting them makes the commands unable to clobber each other. `build`
      keeps Vite's default directory because it is the one command that writes
      the artifact.
    */
    cacheDir: (() => {
      switch (process.env.npm_lifecycle_event) {
        case 'dev':
          return 'node_modules/.vite-dev';
        case 'check':
          return 'node_modules/.vite-check';
        default:
          return undefined;
      }
    })(),

    // Tailwind 4 is a Vite plugin (not an Astro integration) — CSS-first config.
    plugins: [tailwindcss()],

    build: {
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // Keystatic's admin bundle is ~3 MB of React. Keeping it in its own
            // chunk guarantees it never leaks into a public page's payload.
            if (id.includes('node_modules')) return 'vendor';
            return undefined;
          },
        },
      },
    },

    ssr: {
      noExternal: ['@astrojs/*'],
    },
  },

  server: {
    host: true,
    port: 4321,
  },

  devToolbar: {
    enabled: false,
  },
});
