/**
 * Keystatic admin diagnostics.
 *
 * The admin has one failure mode that wastes an afternoon every time: a blank
 * `/keystatic` page. The cause is almost always the Vite dependency cache, not
 * the config — `astro check` or `astro build` running while `npm run dev` is up
 * writes to the same `node_modules/.vite`, the dev server is left holding `?v=`
 * hashes for a cache that no longer matches disk, every Keystatic module then
 * answers `504 Outdated Optimize Dep`, and the React island never hydrates.
 *
 * The fix is `npm run admin:reset`, which is why this script checks for exactly
 * that condition and says so instead of leaving you to guess.
 *
 * Requires a running dev server.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, withProject, heading, ok, fail, warn, detail, finish, paint } from './lib/project.mjs';

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const problems = [];
const warnings = [];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/* --- 1. config loads ------------------------------------------------------ */

heading('后台配置');

try {
  await withProject(
    async ({ keystatic }) => {
      if (!keystatic) {
        fail('keystatic.config.ts 没有导出默认配置');
        problems.push('keystatic.config.ts 未导出默认配置');
        return;
      }
      const collections = Object.keys(keystatic.collections ?? {});
      const singletons = Object.keys(keystatic.singletons ?? {});
      ok(`配置可加载：${collections.length} 个集合、${singletons.length} 个单例`);
      detail(`集合：${collections.join(', ')}`);
      detail(`单例：${singletons.join(', ')}`);

      if (keystatic.storage?.kind !== 'local') {
        warn(`storage.kind = "${keystatic.storage?.kind}"，本地开发预期为 "local"`);
        warnings.push('存储模式不是 local');
      } else {
        ok('storage.kind = "local"');
      }
    },
    { keystatic: true },
  );
} catch (error) {
  fail(`加载配置失败：${error instanceof Error ? error.message : String(error)}`);
  problems.push('keystatic.config.ts 加载失败');
}

/* --- 2. cache directories ------------------------------------------------- */

heading('Vite 缓存目录');

const viteDefault = path.join(ROOT, 'node_modules', '.vite');
const viteDev = path.join(ROOT, 'node_modules', '.vite-dev');
const viteCheck = path.join(ROOT, 'node_modules', '.vite-check');

const hasDefault = await exists(viteDefault);
const hasDev = await exists(viteDev);
const hasCheck = await exists(viteCheck);

/*
  Coexistence is the normal state, not a symptom.

  `astro.config.mjs` gives each command its own cacheDir, so `.vite` (build),
  `.vite-dev` (dev) and `.vite-check` (type check) are supposed to exist side by
  side. Reporting that as a warning would make this script cry wolf on every
  machine that has ever been built — so it is reported as context, and the only
  thing that escalates is an actual blank admin, below.
*/
if (hasDev) {
  ok('开发专用缓存存在：node_modules/.vite-dev');
} else {
  detail('node_modules/.vite-dev 尚未创建（首次运行 dev 后会出现）');
}

const others = [
  hasDefault ? '.vite（构建）' : null,
  hasCheck ? '.vite-check（类型检查）' : null,
].filter(Boolean);

if (others.length > 0) {
  detail(`同时存在：${others.join('、')} —— 这是缓存隔离后的正常状态`);
} else {
  detail('尚未运行过构建或类型检查（没有 .vite / .vite-check）');
}

/* --- 3. the admin route --------------------------------------------------- */

heading('/keystatic 响应');

let reachable = false;
try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(`${BASE}/keystatic`, {
    signal: controller.signal,
    headers: { 'user-agent': 'stellar-shell-admin-check/1.0' },
  });
  clearTimeout(timer);
  reachable = true;

  if (response.status !== 200) {
    fail(`/keystatic 返回 ${response.status}`);
    problems.push(`/keystatic 返回 ${response.status}`);
  } else {
    const html = await response.text();
    ok(`/keystatic 返回 200（${html.length} 字符）`);

    // The admin shell is a React island; its mount point must be present or the
    // page renders blank with a 200 status, which is the confusing case.
    if (/<script|data-astro-|keystatic/i.test(html)) {
      ok('响应中包含后台挂载点');
    } else {
      fail('响应中找不到后台挂载点，页面很可能是空白的');
      problems.push('/keystatic 响应缺少挂载点');
      detail('先试：npm run admin:reset，然后重启 npm run dev');
    }

    if (html.length < 400) {
      warn('响应体很短，可能是 504 Outdated Optimize Dep 的降级页面');
      warnings.push('响应体过短，建议运行 npm run admin:reset 后重启 dev');
    }
  }
} catch (error) {
  detail(`无法连接 ${BASE}：${error instanceof Error ? error.message : String(error)}`);
  console.log(
    `\n${paint.dim('后台只在 dev 模式下存在。先运行 npm run dev，再执行本脚本。')}`,
  );
}

/* --- 4. summary ----------------------------------------------------------- */

if (reachable && warnings.length > 0) {
  console.log(`\n${paint.yellow(`${warnings.length} 条提醒：`)}`);
  for (const item of warnings) console.log(`  ${paint.yellow('!')} ${item}`);
}

if (!reachable) {
  finish(problems, '配置与缓存检查通过（后台连通性未测，需要 dev server）');
} else {
  finish(problems, '后台检查通过');
}
