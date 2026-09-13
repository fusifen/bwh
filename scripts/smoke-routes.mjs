/**
 * Route smoke test.
 *
 * Requests every route the site should emit and reports the status code. The
 * point is not to duplicate what the build already proved — it is to catch the
 * things that only exist at runtime:
 *
 *   - `/go/[plan]` is a server route with `prerender = false`. It is the only
 *     revenue-critical code path on the site and the only one that a static
 *     build never exercises.
 *   - `robots.txt`, `rss.xml` and the sitemap are generated endpoints.
 *   - Redirects declared in `public/_redirects` only exist once a host applies
 *     them.
 *
 * Requires a running server (`npm run dev` or `npm run preview`). The base URL
 * is taken from `SMOKE_BASE_URL`, defaulting to the dev server.
 */

import { withProject, heading, ok, fail, warn, detail, finish, paint } from './lib/project.mjs';

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:4321').replace(/\/$/, '');
const TIMEOUT_MS = 8000;

const problems = [];
const warnings = [];

/** Static routes plus generated endpoints. */
const STATIC_ROUTES = [
  '/',
  '/plans',
  '/datacenters',
  '/lines',
  '/compare',
  '/guides',
  '/learn',
  '/benchmarks',
  '/deals',
  '/glossary',
  '/blog',
  '/faq',
  '/tools/chooser',
  '/about',
  '/disclosure',
  '/privacy',
  '/contact',
  '/changelog',
  '/search',
  '/robots.txt',
  '/rss.xml',
];

/**
 * Routes that only exist after a build.
 *
 * `sitemap-index.xml` is emitted by the sitemap integration during `astro
 * build`, not by the dev server. Since this script is normally pointed at
 * `npm run dev` — the only local server that serves every route, including the
 * non-prerendered `/go/` — these are reported as notes rather than failures.
 * Run against `astro preview` and they will be present.
 */
const BUILD_ONLY_ROUTES = ['/sitemap-index.xml'];

/** Routes that must return 404. */
const EXPECTED_404 = ['/definitely-not-a-page-xyz'];

/** Routes that must redirect away (checked with redirect: 'manual'). */
const REDIRECT_ROUTES = ['/plan'];

async function probe(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      redirect: options.redirect ?? 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'stellar-shell-smoke/1.0' },
    });
    return { status: response.status, location: response.headers.get('location') };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/* --- connectivity --------------------------------------------------------- */

heading('服务可达性');

const ping = await probe('/');
if (ping.status === 0) {
  fail(`无法连接 ${BASE}`);
  detail(ping.error ?? '');
  console.log(
    `\n${paint.dim('先启动服务：npm run dev（或 npm run preview），然后重试。')}`,
  );
  process.exitCode = 1;
} else {
  ok(`服务可达：${BASE}（首页返回 ${ping.status}）`);

  const routes = await withProject(async ({ cms }) => {
    const PREFIX = {
      plans: '/plans',
      datacenters: '/datacenters',
      lines: '/lines',
      guides: '/guides',
      compare: '/compare',
      tutorials: '/learn',
      benchmarks: '/benchmarks',
      glossary: '/glossary',
      deals: '/deals',
      posts: '/blog',
    };

    const collectionRoutes = [
      ...cms.getPlans().map((item) => `${PREFIX.plans}/${item.slug}`),
      ...cms.getDatacenters().map((item) => `${PREFIX.datacenters}/${item.slug}`),
      ...cms.getLines().map((item) => `${PREFIX.lines}/${item.slug}`),
      ...cms.getGuides().map((item) => `${PREFIX.guides}/${item.slug}`),
      ...cms.getCompares().map((item) => `${PREFIX.compare}/${item.slug}`),
      ...cms.getTutorials().map((item) => `${PREFIX.tutorials}/${item.slug}`),
      ...cms.getBenchmarks().map((item) => `${PREFIX.benchmarks}/${item.slug}`),
      ...cms.getGlossary().map((item) => `${PREFIX.glossary}/${item.slug}`),
      ...cms.getDeals().map((item) => `${PREFIX.deals}/${item.slug}`),
      ...cms.getPosts().map((item) => `${PREFIX.posts}/${item.slug}`),
    ];

    return { collectionRoutes, planSlugs: cms.getPlans().map((plan) => plan.slug) };
  });

  /* --- static and collection routes ------------------------------------ */

  heading('静态与内容路由');

  const all = [...STATIC_ROUTES, ...routes.collectionRoutes];
  let failures = 0;

  for (const route of all) {
    const result = await probe(route);
    if (result.status !== 200) {
      failures += 1;
      problems.push(`${route} 返回 ${result.status}`);
      fail(`${route} → ${result.status}`);
    }
  }

  if (failures === 0) {
    ok(`${all.length} 条路由全部返回 200`);
  }

  /* --- build-only routes ------------------------------------------------ */

  const missingBuildOnly = [];
  for (const route of BUILD_ONLY_ROUTES) {
    const result = await probe(route);
    if (result.status !== 200) missingBuildOnly.push(`${route} → ${result.status}`);
  }

  if (missingBuildOnly.length > 0) {
    detail(`${missingBuildOnly.join('、')}（构建期产物，dev 下不存在属正常）`);
  } else {
    ok(`${BUILD_ONLY_ROUTES.length} 条构建期路由存在`);
  }

  /* --- the click route -------------------------------------------------- */

  heading('联盟跳转路由（/go/[plan]）');

  const sampleSlug = routes.planSlugs[0];
  if (!sampleSlug) {
    detail('没有套餐内容，跳过');
  } else {
    const result = await probe(`/go/${sampleSlug}`, { redirect: 'manual' });
    if (result.status === 0) {
      fail(`/go/${sampleSlug} 无响应`);
      problems.push('/go 路由无响应');
    } else if (result.status === 302 || result.status === 301) {
      const location = result.location ?? '';
      if (location.startsWith('https://')) {
        ok(`/go/${sampleSlug} → ${result.status} ${location}`);
      } else {
        fail(`/go/${sampleSlug} 跳转目标异常：${location}`);
        problems.push('/go 跳转目标异常');
      }
    } else if (result.status === 200) {
      // Astro's dev server may follow the redirect internally.
      warn(`/go/${sampleSlug} 返回 200（开发服务器可能内联了跳转），请在生产环境复核`);
    } else {
      fail(`/go/${sampleSlug} 返回 ${result.status}（期望 302）`);
      problems.push('/go 路由返回了非跳转状态');
    }

    const unknown = await probe('/go/no-such-plan-xyz', { redirect: 'manual' });
    if (unknown.status === 302 || unknown.status === 301 || unknown.status === 200) {
      ok('未知套餐仍会跳转到通用落地页（不会 404，收入路径不会断）');
    } else {
      warnings.push(`/go/no-such-plan-xyz 返回 ${unknown.status}，建议回落到通用落地页`);
      warn(`未知套餐返回 ${unknown.status}`);
    }
  }

  /* --- redirects -------------------------------------------------------- */

  heading('重定向规则');

  for (const route of REDIRECT_ROUTES) {
    const result = await probe(route, { redirect: 'manual' });
    if (result.status === 301 || result.status === 302) {
      ok(`${route} → ${result.status} ${result.location ?? ''}`);
    } else {
      detail(`${route} 返回 ${result.status}（_redirects 只在部署后生效，开发环境不适用）`);
    }
  }

  /* --- expected 404 ----------------------------------------------------- */

  heading('404 处理');

  for (const route of EXPECTED_404) {
    const result = await probe(route);
    if (result.status === 404) {
      ok(`${route} → 404`);
    } else {
      problems.push(`${route} 返回 ${result.status}（期望 404）`);
      fail(`${route} → ${result.status}（期望 404）`);
    }
  }

  if (warnings.length > 0) {
    console.log(`\n${paint.yellow(`${warnings.length} 条提醒：`)}`);
    for (const item of warnings) console.log(`  ${paint.yellow('!')} ${item}`);
  }

  finish(problems, `冒烟测试通过：${all.length} 条路由 + 跳转与 404 均正常`);
}
