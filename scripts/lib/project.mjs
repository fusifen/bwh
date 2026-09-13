/**
 * Shared loader for the self-check scripts.
 *
 * Every script needs the same three things: the parsed content, the Zod
 * schemas, and the Keystatic config. All three live in TypeScript modules with
 * extensionless relative imports, which Node cannot execute directly —
 * `--experimental-strip-types` requires explicit `.ts` extensions in relative
 * specifiers and the source does not use them.
 *
 * So the modules are loaded through Vite's SSR module runner instead. That is
 * not a workaround for a limitation of the scripts; it is the only way to load
 * them through the *same* resolver the build uses, which is what makes these
 * checks meaningful. A script that loaded content by a different path could
 * pass while the build failed.
 *
 * The Vite server is created once per script and must be closed, or the process
 * hangs on exit — hence `withProject`.
 */

import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Project root. This file lives in `scripts/lib/`, so the root is two levels
 * up — one level lands on `scripts/`, which silently makes every
 * `ssrLoadModule('/src/...')` call fail with ERR_LOAD_URL because Vite then
 * looks for `scripts/src/...`.
 *
 * Normalised to forward slashes: Vite treats `root` as a URL path, and while
 * backslashes happen to work on Windows, the normalised form is what the rest
 * of Vite's internals use and avoids surprises in the `resolveId` hooks.
 */
export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url))).split(path.sep).join('/');

/** Colourised output. Windows terminals support these; the fallback is plain. */
export const paint = {
  red: (text) => `\u001b[31m${text}\u001b[0m`,
  green: (text) => `\u001b[32m${text}\u001b[0m`,
  yellow: (text) => `\u001b[33m${text}\u001b[0m`,
  dim: (text) => `\u001b[2m${text}\u001b[0m`,
  bold: (text) => `\u001b[1m${text}\u001b[0m`,
};

export function heading(text) {
  console.log(`\n${paint.bold(text)}`);
}

export function ok(text) {
  console.log(`  ${paint.green('✓')} ${text}`);
}

export function warn(text) {
  console.log(`  ${paint.yellow('!')} ${text}`);
}

export function fail(text) {
  console.log(`  ${paint.red('✗')} ${text}`);
}

export function detail(text) {
  console.log(`    ${paint.dim(text)}`);
}

/** Exit non-zero with a summary, or zero with one. */
export function finish(problems, summary) {
  if (problems.length > 0) {
    console.log(`\n${paint.red(`失败：${problems.length} 个问题`)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\n${paint.green(summary)}`);
}

/**
 * Load the project modules through Vite's SSR runner and hand them to `fn`.
 *
 * `keystatic.config.ts` is loaded lazily: the config pulls in the whole
 * `@keystatic/core` package, and most scripts do not need it. Requesting it is
 * a flag rather than the default so a broken admin config cannot take down the
 * content checks.
 */
export async function withProject(fn, options = {}) {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const cms = await server.ssrLoadModule('/src/lib/cms.ts');
    const schemas = await server.ssrLoadModule('/src/lib/schemas.ts');
    const affiliate = await server.ssrLoadModule('/src/lib/affiliate.ts');
    const freshness = await server.ssrLoadModule('/src/lib/freshness.ts');

    let keystatic = null;
    if (options.keystatic) {
      const mod = await server.ssrLoadModule('/keystatic.config.ts');
      keystatic = mod.default ?? mod;
    }

    return await fn({ cms, schemas, affiliate, freshness, keystatic, server });
  } finally {
    await server.close();
  }
}
