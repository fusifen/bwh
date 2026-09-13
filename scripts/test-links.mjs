/**
 * Internal link check.
 *
 * A dead internal link on a content site is not a cosmetic problem. It is a
 * reader who leaves, a crawl budget spent on a 404, and — because the site's
 * whole design is a closed link graph (glossary ↔ line ↔ plan ↔ datacenter) —
 * a hole in the graph that quietly orphans pages.
 *
 * The check works by building the set of routes the build will actually emit,
 * then walking every Markdown-bearing field for `/path` references and
 * verifying each one resolves. Paths that are not internal (external URLs,
 * `mailto:`, anchors) are ignored rather than guessed at.
 *
 * It cannot check external links: doing so would make the build depend on the
 * availability of third-party sites, which is a worse failure mode than an
 * unchecked outbound link.
 */

import { withProject, heading, ok, fail, detail, finish } from './lib/project.mjs';

const problems = [];

/** Routes that exist without coming from a collection. */
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
  '/rss.xml',
  '/robots.txt',
  '/sitemap-index.xml',
];

/** Fields that hold Markdown, by collection. Everything else is plain text. */
const MARKDOWN_FIELDS = {
  plans: ['content', 'summary', 'tagline'],
  datacenters: ['content', 'summary'],
  lines: ['content', 'summary', 'definition', 'verdict'],
  scenarios: ['content', 'summary'],
  guides: ['verdict', 'summary'],
  compare: ['verdict', 'summary', 'whenChooseLeft', 'whenChooseRight'],
  tutorials: ['summary'],
  benchmarks: ['conclusion', 'summary', 'method'],
  glossary: ['fullDef', 'shortDef'],
  deals: ['content', 'summary'],
  posts: ['content', 'summary'],
  faqs: ['answer'],
};

/** Nested Markdown-bearing fields, walked by hand because they are arrays. */
function nestedMarkdown(collection, item) {
  const chunks = [];
  if (collection === 'guides') {
    for (const section of item.sections ?? []) chunks.push(section.body);
  }
  if (collection === 'tutorials') {
    for (const step of item.steps ?? []) {
      chunks.push(step.body);
      if (step.note) chunks.push(step.note);
      if (step.warning) chunks.push(step.warning);
    }
    // Troubleshooting prose is rendered as table cells and can carry links.
    // `fix` in particular reads like instructions, so it is worth scanning.
    for (const row of item.troubleshooting ?? []) {
      chunks.push(row.cause, row.fix);
    }
  }
  if (collection === 'compare') {
    for (const dimension of item.dimensions ?? []) {
      chunks.push(dimension.left, dimension.right);
      if (dimension.note) chunks.push(dimension.note);
    }
  }
  if (collection === 'plans' || collection === 'datacenters' || collection === 'lines') {
    for (const faq of item.faqs ?? []) chunks.push(faq.answer);
  }
  return chunks;
}

/** Strip a fragment and query, normalise the trailing slash. */
function normalise(href) {
  const withoutHash = href.split('#')[0].split('?')[0];
  if (withoutHash === '') return null; // pure anchor, e.g. #pricing
  const trimmed = withoutHash.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Remove code from a Markdown chunk before scanning for links.
 *
 * Filesystem paths and shell commands live in code spans — `/etc/ssh/sshd_config`,
 * `/root`, `/var/log` — and they are indistinguishable from a site path by shape
 * alone. Stripping code first is the principled fix: a path inside backticks is
 * never a link, so it should never be treated as a link candidate.
 *
 * Fenced blocks are removed before inline spans, otherwise the opening fence of
 * a block would be consumed as an inline span and leave the block body behind.
 */
function stripCode(source) {
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

await withProject(async ({ cms }) => {
  const collections = {
    plans: cms.getPlans(),
    datacenters: cms.getDatacenters(),
    lines: cms.getLines(),
    scenarios: cms.getScenarios(),
    guides: cms.getGuides(),
    compare: cms.getCompares(),
    tutorials: cms.getTutorials(),
    benchmarks: cms.getBenchmarks(),
    glossary: cms.getGlossary(),
    deals: cms.getDeals(),
    posts: cms.getPosts(),
    faqs: cms.getFaqs(),
  };

  /* --- build the route set ---------------------------------------------- */

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

  const routes = new Set(STATIC_ROUTES);
  for (const [collection, prefix] of Object.entries(PREFIX)) {
    for (const item of collections[collection]) {
      routes.add(`${prefix}/${item.slug}`);
    }
  }
  // FAQ questions are anchors on a single page.
  for (const faq of collections.faqs) {
    routes.add(`/faq/#${faq.slug}`);
  }

  heading('站内链接目标');
  detail(`已知路由 ${routes.size} 条`);

  /* --- collect and check every reference -------------------------------- */

  const LINK_PATTERN = /\]\((\/[^)\s]*)\)/g;
  const BARE_PATTERN = /(?:^|[\s"'`(])(\/[a-z0-9][a-z0-9\-/]*)/g;

  /*
    Top-level path segments the site actually serves.

    A bare `/foo` in prose is ambiguous: it could be a site route or a
    filesystem path that escaped a code span. Markdown link targets `](/foo)`
    are unambiguous — someone wrote a link — so those are always checked. Bare
    paths are only checked when their first segment matches a real route, which
    makes `/var/log` and `/etc/nginx` uninteresting without weakening detection
    of an actual mistyped route.
  */
  const KNOWN_SEGMENTS = new Set(
    [...routes]
      .map((route) => route.split('/')[1])
      .filter((segment) => segment && !segment.includes('.')),
  );

  let checked = 0;
  let skippedBare = 0;
  const broken = new Map();

  function report(path, source) {
    if (!broken.has(path)) broken.set(path, []);
    broken.get(path).push(source);
  }

  function check(collection, slug, source) {
    if (typeof source !== 'string' || source === '') return;

    const text = stripCode(source);
    const origin = `${collection}/${slug}`;

    /** Shared tail: resolve a candidate against the route set. */
    const verify = (candidate) => {
      const path = normalise(candidate);
      if (path === null) return;
      if (!path.startsWith('/')) return;
      // A dot in the last segment means an asset or a file, not a page.
      if (/\.(png|jpe?g|svg|webp|avif|ico|txt|xml|json|css|js|zip|gz)$/i.test(path)) return;
      if (path.startsWith('/go/')) return; // redirect route, no page
      if (path.startsWith('/keystatic')) return;

      checked += 1;
      if (routes.has(path)) return;
      report(path, origin);
    };

    for (const match of text.matchAll(LINK_PATTERN)) verify(match[1]);

    for (const match of text.matchAll(BARE_PATTERN)) {
      const segment = match[1].split('/')[1];
      if (!KNOWN_SEGMENTS.has(segment)) {
        skippedBare += 1;
        continue;
      }
      verify(match[1]);
    }
  }

  for (const [collection, items] of Object.entries(collections)) {
    for (const item of items) {
      for (const field of MARKDOWN_FIELDS[collection] ?? []) {
        check(collection, item.slug, item[field]);
      }
      for (const chunk of nestedMarkdown(collection, item)) {
        check(collection, item.slug, chunk);
      }
      // `seeAlso` is an explicit list of internal paths and must resolve.
      for (const href of item.seeAlso ?? []) {
        const path = normalise(href);
        if (path === null) continue;
        checked += 1;
        if (!routes.has(path)) report(path, `${collection}/${item.slug} (seeAlso)`);
      }
    }
  }

  /* --- report ----------------------------------------------------------- */

  if (broken.size > 0) {
    for (const [path, sources] of [...broken.entries()].sort()) {
      const unique = [...new Set(sources)];
      problems.push(`站内链接指向不存在的页面：${path}（来自 ${unique.join('、')}）`);
      fail(`${path}`);
      detail(`来自 ${unique.join('、')}`);
    }
  } else {
    ok(`检查了 ${checked} 处站内引用，全部可解析`);
    if (skippedBare > 0) {
      detail(`另有 ${skippedBare} 处裸路径因一级段不匹配任何路由而跳过（多为代码外的文件路径）`);
    }
  }

  /* --- hubs ------------------------------------------------------------- */

  heading('枢纽页可达性');

  /** The four hubs that carry most of the internal link equity. */
  const hubs = [
    ['/lines/cn2-gia', '线路枢纽'],
    ['/plans', '套餐总览'],
    ['/guides/beginner', '新手入口'],
    ['/deals', '优惠页'],
  ];

  for (const [route, label] of hubs) {
    if (routes.has(route)) {
      ok(`${label}：${route}`);
    } else {
      detail(`${label}：${route} 尚未创建（内容补齐后会自动出现）`);
    }
  }

  finish(problems, `链接检查通过：${checked} 处站内引用全部有效`);
});
