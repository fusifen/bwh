// @ts-check
/**
 * Cloudflare Workers build configuration.
 *
 * This file exists because `adapter` cannot depend on the Astro command.
 * `defineConfig` is an identity function, so the only way to vary the config
 * per command would be to export a function — which Astro's config type does
 * not accept.
 *
 * Why the split is necessary
 * --------------------------
 * The two adapters are wrong for each other's job:
 *
 *   - The **Cloudflare** adapter runs `astro dev` under `workerd` via
 *     `@cloudflare/vite-plugin`. `workerd` has no filesystem, and Keystatic's
 *     `storage: { kind: 'local' }` admin writes JSON straight into `src/content`.
 *     Under `workerd` the admin would have nowhere to write.
 *
 *   - The **Node** adapter cannot produce a deployable Worker.
 *
 * So `astro.config.mjs` keeps the Node adapter for `dev`, `check` and
 * `preview`, and this file supplies the Cloudflare adapter for builds.
 *
 * Everything except the adapter is inherited from the base config, so there is
 * exactly one place to edit a setting. If a new option is ever added to the
 * base config it applies to the deployed build automatically — the only way
 * this file can drift is by editing the spread below, which is one line.
 *
 * Build with:  npm run build      (wraps `astro build --config <this file>`)
 */
import base from './astro.config.mjs';
import cloudflare from '@astrojs/cloudflare';

export default {
  ...base,

  /*
    `imageService: 'compile'` keeps image work at build time. The adapter's
    default is 'cloudflare-binding', which needs an Images binding this project
    does not use; 'compile' also matches the Sharp service configured in the
    base config.
  */
  adapter: cloudflare({ imageService: 'compile' }),
};
