/**
 * Clear the build and dev caches.
 *
 * The command to reach for when `/keystatic` renders blank, when Tailwind
 * classes stop appearing, or when the dev server insists a module it just
 * rebuilt is out of date. All three are the same underlying problem: a cache on
 * disk that no longer matches the source, usually because `astro check` or
 * `astro build` ran while `npm run dev` was holding the same directory open.
 *
 * Only ever removes directories this project generated. It never touches
 * `src/`, `public/`, `scripts/`, config files or content — if a path is not in
 * the list below, it is not touched.
 *
 * On this machine the delete can be intercepted by the bulk-delete guard. If
 * that happens the script says so and gives the override, rather than leaving a
 * half-cleared cache behind.
 */

import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, heading, ok, warn, detail, paint } from './lib/project.mjs';

/** Directories that are pure build output. Nothing authored lives here. */
const TARGETS = [
  ['node_modules/.vite', 'Vite 依赖预打包缓存（构建用）'],
  ['node_modules/.vite-dev', '开发服务器专用依赖缓存'],
  ['node_modules/.vite-check', '类型检查专用依赖缓存'],
  ['.astro', 'Astro 生成的类型与内容缓存'],
  ['dist', '上一次的构建产物'],
];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

heading('清理缓存');

let removed = 0;
let skipped = 0;
const failures = [];

for (const [relative, description] of TARGETS) {
  const full = path.join(ROOT, relative);

  if (!(await exists(full))) {
    detail(`跳过 ${relative}（不存在）`);
    skipped += 1;
    continue;
  }

  try {
    await rm(full, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    ok(`已删除 ${relative} — ${description}`);
    removed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ relative, message });
    warn(`删除 ${relative} 失败：${message}`);
  }
}

if (failures.length > 0) {
  console.log(
    `\n${paint.yellow('有目录没能删除。最常见的原因是 dev server 仍在运行，或批量删除保护拦截了操作。')}`,
  );
  console.log(`\n${paint.dim('处理方式：')}`);
  console.log(`  1. 先停掉 dev server：${paint.bold('astro dev stop')}`);
  console.log(`  2. 若仍失败，用环境变量放行删除：`);
  console.log(`     ${paint.bold('CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run admin:reset')}`);
  console.log(`  3. 或者改用重命名（重命名不走删除路径）：`);
  for (const failure of failures) {
    console.log(`     ${paint.bold(`mv ${failure.relative} ${failure.relative}.stale-$(date +%s)`)}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `\n${paint.green(`缓存已清理：删除 ${removed} 个，跳过 ${skipped} 个。`)}`,
  );
  console.log(`${paint.dim('下一步：npm run dev，然后打开 http://localhost:4321/keystatic')}`);
}
