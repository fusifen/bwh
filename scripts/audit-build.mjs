/**
 * Build output audit.
 *
 * `npm run build` succeeding only proves the pages rendered. It says nothing
 * about whether they are indexable. This script inspects the emitted HTML and
 * asserts the things that are invisible in a browser but decide whether the
 * site gets found:
 *
 *   - every page has a canonical URL and a non-empty meta description;
 *   - every page carries a JSON-LD block;
 *   - the sitemap excludes the routes that must never be indexed;
 *   - `robots.txt` points at the sitemap and allows the AI crawlers;
 *   - `llms.txt` exists and is not empty;
 *   - the artifact really is a Cloudflare build, not a Node one;
 *   - the site origin is not still the placeholder;
 *   - the placeholder affiliate id does not appear anywhere in the output.
 *
 * The output directory is detected rather than hardcoded, because Astro places
 * it differently depending on whether an adapter is configured and which one.
 * A wrong guess here would make the audit pass by finding nothing to check.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, heading, ok, fail, warn, detail, finish, paint } from './lib/project.mjs';

const problems = [];
const warnings = [];

/*
  Two checks here fail on values that are placeholders by design: the site origin
  and the affiliate id. Both must block a release — a wrong origin poisons every
  canonical and `@id`, and a placeholder affiliate id means the site earns
  nothing — but neither is a code defect, so a fresh clone could never pass
  `npm run verify`. That trains people to ignore a red result.

  `--allow-placeholder` (wired to `npm run audit:dev`) downgrades exactly those
  two to warnings so the artifact itself can be validated before the domain and
  affiliate id exist. Everything else still blocks.
*/
const allowPlaceholder =
  process.argv.includes('--allow-placeholder') || process.env.ALLOW_PLACEHOLDER_AFF === '1';

/** Candidate output directories, in the order Astro is likely to use them. */
const CANDIDATES = ['dist/client', 'dist', 'dist/static', 'build'];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function detectOutputDir() {
  for (const candidate of CANDIDATES) {
    const full = path.join(ROOT, candidate);
    if ((await exists(path.join(full, 'index.html'))) || (await exists(path.join(full, 'sitemap-index.xml')))) {
      return { relative: candidate, absolute: full };
    }
  }
  return null;
}

/** Recursively collect files with a given extension. */
async function walk(dir, extension, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '_astro') continue;
      await walk(full, extension, out);
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

const output = await detectOutputDir();

if (!output) {
  fail('找不到构建产物目录。先运行 npm run build。');
  detail(`已尝试：${CANDIDATES.join('、')}`);
  process.exitCode = 1;
} else {
  heading('构建产物');
  ok(`输出目录：${output.relative}`);
  detail(`绝对路径：${output.absolute}`);

  /*
    Build-target check.

    `npm run build` uses the Cloudflare config; a bare `astro build` uses the
    Node one. Both succeed, both write `dist/client`, and the difference is
    invisible until deployment — where a Node bundle simply cannot run on
    Workers. The adapter's auto-generated `wrangler.json` is the one artifact
    that only a Cloudflare build produces, so its presence is the check.
  */
  heading('构建目标');

  const wranglerConfig = path.join(ROOT, 'dist', 'server', 'wrangler.json');
  if (await exists(wranglerConfig)) {
    ok('产物是 Cloudflare Workers bundle（dist/server/wrangler.json 存在）');
  } else {
    problems.push('产物不是 Cloudflare 构建：缺少 dist/server/wrangler.json');
    fail('缺少 dist/server/wrangler.json —— 这不是 Cloudflare 构建');
    detail('用 npm run build 构建（它指向 astro.config.cloudflare.mjs）');
    detail('直接运行 astro build 会用 Node 适配器，产物无法部署到 Workers');
  }

  /* --- site origin ------------------------------------------------------ */

  const homepagePath = path.join(output.absolute, 'index.html');
  const homepage = await readFile(homepagePath, 'utf8');
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(homepage);

  if (!canonical) {
    problems.push('首页缺少 canonical，无法核对站点地址');
    fail('首页缺少 canonical');
  } else if (/example\.workers\.dev|\.pages\.dev|localhost/.test(canonical[1])) {
    const message = `站点地址仍是占位值：${canonical[1]}`;
    if (allowPlaceholder) {
      warn(`${message}（--allow-placeholder，仅限开发构建）`);
      warnings.push('这次构建的 canonical 指向占位域名，不能部署');
    } else {
      problems.push(message);
      fail(message);
      detail('site 决定 canonical、og:url、sitemap、RSS 和所有 JSON-LD 的 @id');
      detail('构建时覆盖：npm run build -- --site=https://your-domain.example');
    }
  } else {
    ok(`站点地址：${canonical[1]}`);
  }

  const pages = await walk(output.absolute, '.html');
  heading('页面基础元信息');
  detail(`共 ${pages.length} 个 HTML 文件`);

  let missingCanonical = 0;
  let missingDescription = 0;
  let missingJsonLd = 0;
  let noindexCount = 0;

  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    const relative = path.relative(output.absolute, file).replace(/\\/g, '/');

    if (!/<link rel="canonical" href="[^"]+"/.test(html)) {
      missingCanonical += 1;
      fail(`${relative}: 缺少 canonical`);
      problems.push(`${relative} 缺少 canonical`);
    }

    /*
      A noindex page cannot rank, so a missing meta description on one is not a
      defect — it is the correct shape for a 404 or a search page. Requiring it
      would force filler copy onto pages whose whole point is to not be indexed,
      and would train whoever reads this output to ignore a red line.
    */
    const isNoindex = /<meta name="robots" content="noindex/.test(html);
    if (isNoindex) noindexCount += 1;

    const description = /<meta name="description" content="([^"]*)"/.exec(html);
    if (!description || description[1].trim().length < 20) {
      if (isNoindex) {
        detail(`${relative}: 无 description（noindex，属预期）`);
      } else {
        missingDescription += 1;
        fail(`${relative}: description 缺失或过短`);
        problems.push(`${relative} description 缺失或过短`);
      }
    }

    if (!/<script type="application\/ld\+json"/.test(html)) {
      missingJsonLd += 1;
      fail(`${relative}: 缺少 JSON-LD`);
      problems.push(`${relative} 缺少 JSON-LD`);
    }
  }

  const indexed = pages.length - noindexCount;
  if (missingCanonical === 0 && missingDescription === 0 && missingJsonLd === 0) {
    ok(`全部 ${indexed} 个可索引页面都有 canonical、description 与 JSON-LD`);
  }
  if (noindexCount > 0) {
    detail(`${noindexCount} 个页面标记为 noindex（搜索页、404 等，属预期）`);
  }

  /* --- sitemap ---------------------------------------------------------- */

  heading('sitemap 排除规则');

  const sitemapFiles = (await walk(output.absolute, '.xml')).filter((file) =>
    path.basename(file).startsWith('sitemap'),
  );

  if (sitemapFiles.length === 0) {
    warnings.push('没有找到 sitemap 文件');
    warn('没有找到 sitemap 文件');
  } else {
    const FORBIDDEN = ['/keystatic', '/go/', '/search', '/api/'];
    let leaked = 0;

    for (const file of sitemapFiles) {
      const xml = await readFile(file, 'utf8');
      for (const forbidden of FORBIDDEN) {
        if (xml.includes(forbidden)) {
          leaked += 1;
          fail(`${path.basename(file)} 中出现了 ${forbidden}`);
          problems.push(`sitemap 泄漏了 ${forbidden}`);
        }
      }
    }

    if (leaked === 0) {
      ok(`sitemap 已排除 ${FORBIDDEN.join('、')}（共 ${sitemapFiles.length} 个文件）`);
    }
  }

  /* --- robots ----------------------------------------------------------- */

  heading('robots.txt');

  const robotsPath = path.join(output.absolute, 'robots.txt');
  if (!(await exists(robotsPath))) {
    problems.push('缺少 robots.txt');
    fail('缺少 robots.txt');
  } else {
    const robots = await readFile(robotsPath, 'utf8');
    if (!/^Sitemap:\s*https?:\/\//m.test(robots)) {
      problems.push('robots.txt 缺少 Sitemap 指令');
      fail('robots.txt 缺少 Sitemap 指令');
    } else {
      ok('robots.txt 指向 sitemap');
    }
    const aiBots = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Bytespider', 'Google-Extended'];
    const missing = aiBots.filter((bot) => !robots.includes(bot));
    if (missing.length > 0) {
      warnings.push(`robots.txt 未显式允许：${missing.join('、')}`);
      warn(`robots.txt 未显式允许：${missing.join('、')}`);
    } else {
      ok('robots.txt 已显式允许主要生成式引擎抓取');
    }
  }

  /* --- llms.txt --------------------------------------------------------- */

  heading('llms.txt');

  for (const name of ['llms.txt', 'llms-full.txt']) {
    const target = path.join(output.absolute, name);
    if (!(await exists(target))) {
      warnings.push(`缺少 ${name}（prebuild 脚本未运行？）`);
      warn(`缺少 ${name}`);
      continue;
    }
    const content = await readFile(target, 'utf8');
    if (content.trim().length < 200) {
      problems.push(`${name} 内容过短（${content.length} 字符）`);
      fail(`${name} 内容过短`);
    } else {
      ok(`${name}：${content.length} 字符`);
    }
  }

  /* --- placeholder leak ------------------------------------------------- */

  heading('占位值泄漏检查');

  /*
    This is the last gate before deploy, and the only check that inspects the
    real artifact rather than the source. A placeholder affId here means every
    link on the live site would silently earn nothing — a failure mode with no
    visible symptom, which is exactly why it must block.
  */

  const leakedFiles = [];
  for (const file of pages) {
    const html = await readFile(file, 'utf8');
    if (html.includes('aff=000000') || html.includes('YOUR_AFF_ID') || html.includes('REPLACE_ME')) {
      leakedFiles.push(path.relative(output.absolute, file));
    }
  }

  if (leakedFiles.length > 0 && allowPlaceholder) {
    warn(`占位 affId 出现在 ${leakedFiles.length} 个页面中（--allow-placeholder，仅限开发构建）`);
    warnings.push('这次构建带有占位 affId，绝不能部署到线上');
  } else if (leakedFiles.length > 0) {
    problems.push(`占位 affId 出现在 ${leakedFiles.length} 个页面中`);
    fail(`占位 affId 出现在 ${leakedFiles.length} 个页面中`);
    detail(leakedFiles.slice(0, 5).join('、'));
    detail('改 src/content/affiliate.json 的 affId 字段后重新构建');
    detail('若只想验证构建产物本身，用 npm run audit:dev 临时跳过此检查');
  } else {
    ok('产物中没有出现占位 affId');
  }

  /* --- summary ---------------------------------------------------------- */

  if (warnings.length > 0) {
    console.log(`\n${paint.yellow(`${warnings.length} 条提醒：`)}`);
    for (const item of warnings) console.log(`  ${paint.yellow('!')} ${item}`);
  }

  finish(problems, `产物检查通过：${pages.length} 个页面，元信息完整，sitemap 无泄漏`);
}
