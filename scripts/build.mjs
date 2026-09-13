#!/usr/bin/env node
/**
 * Build the deployable Cloudflare Workers bundle.
 *
 * Two things this does that a bare `astro build` in package.json cannot:
 *
 * 1. **Selects the Cloudflare config.** `astro.config.mjs` carries the Node
 *    adapter so that `astro dev` can run Keystatic's local-storage admin (see
 *    `astro.config.cloudflare.mjs` for why the adapter cannot be chosen by
 *    command). The build therefore has to point at the Cloudflare config
 *    explicitly, and doing it here keeps that fact in one place instead of
 *    scattered across package.json scripts.
 *
 * 2. **Sets SITE_URL without shell-specific syntax.** `SITE_URL=... astro build`
 *    looks portable and is not: npm runs scripts through cmd.exe on Windows,
 *    which has no `VAR=value command` form. Setting it on the child process
 *    works everywhere.
 *
 * Usage
 * -----
 *   npm run build                                  # Cloudflare bundle
 *   npm run build -- --site=https://example.com    # override the site origin
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG = 'astro.config.cloudflare.mjs';

/** Accepts both `--site value` and `--site=value`. */
function readFlag(name) {
  const withEquals = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);

  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) {
    const next = process.argv[index + 1];
    return next && !next.startsWith('--') ? next : '';
  }
  return null;
}

const site = readFlag('site');
const env = { ...process.env };
if (site) env.SITE_URL = site;

const astroBin = path.join(ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');

console.log(`构建目标：Cloudflare Workers（配置 ${CONFIG}）`);
if (site) console.log(`站点地址：${site}`);

const child = spawn(process.execPath, [astroBin, 'build', '--config', CONFIG], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`无法启动构建：${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`构建被信号 ${signal} 终止`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
