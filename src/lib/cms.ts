/**
 * `cms.ts` — the single data access layer.
 *
 * Every page and component reads content through this module and nothing else.
 * No page imports a JSON file, and no component reaches into `src/content`.
 * That rule is what makes the content model refactorable: if the storage moves
 * (Keystatic local → Keystatic GitHub → a database), only this file changes and
 * the page code is untouched. The previous project on this stack swapped data
 * sources twice with zero page edits, and this file was the only reason.
 *
 * Two properties worth noting:
 *
 * 1. **Everything is synchronous.** Content is loaded eagerly at module init, so
 *    getters return values, not promises. Pages do `const plans = getPlans()`
 *    with no `await`. The earlier project made every getter async to keep a
 *    remote CMS possible; with local JSON that cost readability for nothing.
 *
 * 2. **Content is validated on load.** A malformed file throws at import time
 *    with the offending path and field, so a broken content file fails the
 *    build loudly instead of rendering a half-empty page.
 *
 * Note on `import.meta.glob`: it is resolved by Vite at build time, which means
 * this module also works inside the Cloudflare Workers bundle where `node:fs`
 * does not exist. `/go/[plan]` deliberately avoids importing this module and
 * globs the plan files it needs directly, to keep the worker bundle small.
 */

import {
  COLLECTIONS,
  SINGLETONS,
  type About,
  type Affiliate,
  type Benchmark,
  type CollectionName,
  type Compare,
  type Datacenter,
  type Deal,
  type Disclosure,
  type Faq,
  type Glossary,
  type Guide,
  type Home,
  type Line,
  type Plan,
  type Post,
  type Scenario,
  type SiteConfig,
  type Tutorial,
} from './schemas';
import { affHref, buildAffUrl, planAffUrl, type AffiliateLike } from './affiliate';
import { effectiveDealStatus } from './freshness';
import { monthlyEquivalent } from './format';
import { SERIES_ORDER } from '../config/site';

/* -----------------------------------------------------------------------------
   Loading
   -------------------------------------------------------------------------- */

type ModuleMap = Record<string, unknown>;

/**
 * Each `import.meta.glob` call needs a literal pattern, so the collection list
 * is spelled out here rather than derived. The key of this object must match the
 * key in `COLLECTIONS` — `test:content` asserts that.
 */
const COLLECTION_MODULES: Record<CollectionName, ModuleMap> = {
  plans: import.meta.glob('../content/plans/*.json', { eager: true }),
  datacenters: import.meta.glob('../content/datacenters/*.json', { eager: true }),
  lines: import.meta.glob('../content/lines/*.json', { eager: true }),
  scenarios: import.meta.glob('../content/scenarios/*.json', { eager: true }),
  guides: import.meta.glob('../content/guides/*.json', { eager: true }),
  compare: import.meta.glob('../content/compare/*.json', { eager: true }),
  tutorials: import.meta.glob('../content/tutorials/*.json', { eager: true }),
  benchmarks: import.meta.glob('../content/benchmarks/*.json', { eager: true }),
  glossary: import.meta.glob('../content/glossary/*.json', { eager: true }),
  deals: import.meta.glob('../content/deals/*.json', { eager: true }),
  posts: import.meta.glob('../content/posts/*.json', { eager: true }),
  faqs: import.meta.glob('../content/faqs/*.json', { eager: true }),
};

/** Top-level `src/content/*.json` — the singletons. */
const SINGLETON_MODULES: ModuleMap = import.meta.glob('../content/*.json', { eager: true });

/** Vite wraps JSON modules in `{ default }`; tolerate both shapes. */
function unwrap(module: unknown): unknown {
  if (module && typeof module === 'object' && 'default' in module) {
    return (module as { default: unknown }).default;
  }
  return module;
}

/**
 * Drop `null` values before validation.
 *
 * Keystatic writes `null` for an optional field the editor left blank, and for
 * some empty collections. Zod's `.optional()` accepts `undefined` but not
 * `null`, so without this every save from the admin panel would fail the build
 * with a validation error that looks like a content problem but is really a
 * serialisation difference.
 *
 * `""` is deliberately *not* stripped here: an empty string in a required field
 * should fail loudly rather than be quietly converted into a missing field. The
 * optional string fields that can legitimately be blank normalise themselves in
 * `schemas.ts`.
 */
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls).filter((item) => item !== null);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === null) continue;
      out[key] = stripNulls(item);
    }
    return out;
  }
  return value;
}

function describeIssues(error: unknown): string {
  const issues = (error as { issues?: Array<{ path: Array<string | number>; message: string }> })
    ?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return String(error);
  return issues
    .map((issue) => `  · ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/** Structural type rather than `z.ZodType<T>` — avoids generic variance noise. */
type SafeParseResult<T> = { success: true; data: T } | { success: false; error: unknown };

interface Parseable<T> {
  safeParse: (value: unknown) => SafeParseResult<T>;
}

function loadCollection<T>(name: CollectionName, schema: Parseable<T>): T[] {
  const modules = COLLECTION_MODULES[name] ?? {};
  const items: T[] = [];
  const failures: string[] = [];

  for (const [file, module] of Object.entries(modules)) {
    const result = schema.safeParse(stripNulls(unwrap(module)));
    if (result.success) {
      items.push(result.data);
    } else {
      failures.push(`${file.replace(/^.*\/content\//, '')}\n${describeIssues(result.error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `内容校验失败（集合 ${name}），共 ${failures.length} 个文件有问题：\n${failures.join('\n')}`,
    );
  }

  return items;
}

function loadSingleton<T>(name: keyof typeof SINGLETONS, schema: Parseable<T>): T {
  const module = SINGLETON_MODULES[`../content/${name}.json`];
  if (module === undefined) {
    throw new Error(`缺少单例文件 src/content/${name}.json`);
  }
  const result = schema.safeParse(unwrap(module));
  if (!result.success) {
    throw new Error(`单例校验失败（${name}）：\n${describeIssues(result.error)}`);
  }
  return result.data;
}

/* -----------------------------------------------------------------------------
   Sorting
   -------------------------------------------------------------------------- */

interface Orderable {
  order?: number;
  name?: string;
  title?: string;
  question?: string;
  term?: string;
}

/** Explicit `order` first, then a stable label sort. Never rely on filename. */
function byOrder<T extends Orderable>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    const labelA = a.name ?? a.title ?? a.term ?? a.question ?? '';
    const labelB = b.name ?? b.title ?? b.term ?? b.question ?? '';
    return labelA.localeCompare(labelB, 'zh-Hans-CN');
  });
}

/* -----------------------------------------------------------------------------
   Singletons
   -------------------------------------------------------------------------- */

export const AFFILIATE: Affiliate = loadSingleton('affiliate', SINGLETONS.affiliate);
export const SITE: SiteConfig = loadSingleton('site', SINGLETONS.site);
export const HOME: Home = loadSingleton('home', SINGLETONS.home);
export const ABOUT: About = loadSingleton('about', SINGLETONS.about);
export const DISCLOSURE: Disclosure = loadSingleton('disclosure', SINGLETONS.disclosure);

/** The affiliate config narrowed to what the pure link helpers need. */
export const AFF: AffiliateLike = {
  enabled: AFFILIATE.enabled,
  affId: AFFILIATE.affId,
  baseUrl: AFFILIATE.baseUrl,
  params: AFFILIATE.params,
  rel: AFFILIATE.rel,
  trackClicks: AFFILIATE.trackClicks,
};

/* -----------------------------------------------------------------------------
   Collections — eagerly parsed, synchronously accessible
   -------------------------------------------------------------------------- */

/** Billing cycles read best in ascending commitment order, not author order. */
const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

function normalizePlan(plan: Plan): Plan {
  return {
    ...plan,
    pricing: {
      ...plan.pricing,
      cycles: [...plan.pricing.cycles].sort(
        (a, b) => (CYCLE_MONTHS[a.cycle] ?? 0) - (CYCLE_MONTHS[b.cycle] ?? 0),
      ),
    },
  };
}

const PLANS: Plan[] = byOrder(loadCollection('plans', COLLECTIONS.plans)).map((plan) =>
  normalizePlan(plan),
);
const DATACENTERS: Datacenter[] = byOrder(loadCollection('datacenters', COLLECTIONS.datacenters));
const LINES: Line[] = byOrder(loadCollection('lines', COLLECTIONS.lines));
const SCENARIOS: Scenario[] = byOrder(loadCollection('scenarios', COLLECTIONS.scenarios));
const GUIDES: Guide[] = byOrder(loadCollection('guides', COLLECTIONS.guides));
const COMPARES: Compare[] = byOrder(loadCollection('compare', COLLECTIONS.compare));
const TUTORIALS: Tutorial[] = byOrder(loadCollection('tutorials', COLLECTIONS.tutorials));
const BENCHMARKS: Benchmark[] = byOrder(loadCollection('benchmarks', COLLECTIONS.benchmarks));
const GLOSSARY: Glossary[] = byOrder(loadCollection('glossary', COLLECTIONS.glossary));
const DEALS: Deal[] = byOrder(loadCollection('deals', COLLECTIONS.deals));
const POSTS: Post[] = byOrder(loadCollection('posts', COLLECTIONS.posts));
const FAQS: Faq[] = byOrder(loadCollection('faqs', COLLECTIONS.faqs));

/* -----------------------------------------------------------------------------
   Indexes
   -------------------------------------------------------------------------- */

const planBySlug = new Map(PLANS.map((item) => [item.slug, item]));
const datacenterBySlug = new Map(DATACENTERS.map((item) => [item.slug, item]));
const lineBySlug = new Map(LINES.map((item) => [item.slug, item]));
const scenarioBySlug = new Map(SCENARIOS.map((item) => [item.slug, item]));
const guideBySlug = new Map(GUIDES.map((item) => [item.slug, item]));
const compareBySlug = new Map(COMPARES.map((item) => [item.slug, item]));
const tutorialBySlug = new Map(TUTORIALS.map((item) => [item.slug, item]));
const benchmarkBySlug = new Map(BENCHMARKS.map((item) => [item.slug, item]));
const glossaryBySlug = new Map(GLOSSARY.map((item) => [item.slug, item]));
const dealBySlug = new Map(DEALS.map((item) => [item.slug, item]));
const postBySlug = new Map(POSTS.map((item) => [item.slug, item]));

/* -----------------------------------------------------------------------------
   Getters — plans
   -------------------------------------------------------------------------- */

export function getPlans(): Plan[] {
  return PLANS;
}

export function getPlan(slug: string): Plan | undefined {
  return planBySlug.get(slug);
}

export function getPlansBySeries(): Array<{ series: string; plans: Plan[] }> {
  return SERIES_ORDER.map((series) => ({
    series,
    plans: PLANS.filter((plan) => plan.series === series),
  })).filter((group) => group.plans.length > 0);
}

export function getFeaturedPlans(): Plan[] {
  const featured = PLANS.filter((plan) => plan.featured);
  return featured.length > 0 ? featured : PLANS.slice(0, 4);
}

/** Only plans a visitor can actually buy today. */
export function getPurchasablePlans(): Plan[] {
  return PLANS.filter((plan) => plan.status === 'available' || plan.status === 'limited');
}

/**
 * The cheapest way to buy this plan, as a comparable monthly figure.
 *
 * Annual plans look expensive beside monthly ones until you divide by twelve,
 * and readers who have to do that arithmetic themselves usually don't.
 */
export function planMonthlyFrom(plan: Plan): number {
  if (plan.pricing.cycles.length === 0) return Number.POSITIVE_INFINITY;
  return Math.min(
    ...plan.pricing.cycles.map((entry) => monthlyEquivalent(entry.cycle, entry.price)),
  );
}

/** The single lowest total price, regardless of cycle. */
export function planEntryPrice(plan: Plan): Plan['pricing']['cycles'][number] | undefined {
  if (plan.pricing.cycles.length === 0) return undefined;
  return [...plan.pricing.cycles].sort((a, b) => a.price - b.price)[0];
}

export function plansBySlugs(slugs: string[]): Plan[] {
  return slugs.map((slug) => planBySlug.get(slug)).filter((item): item is Plan => Boolean(item));
}

export function getPlansForScenario(scenarioSlug: string): Plan[] {
  return PLANS.filter((plan) => plan.useCases.includes(scenarioSlug));
}

export function getPlansForDatacenter(datacenterSlug: string): Plan[] {
  return PLANS.filter((plan) => plan.network.datacenters.includes(datacenterSlug));
}

export function getPlansForLine(lineSlug: string): Plan[] {
  return PLANS.filter((plan) => plan.network.line === lineSlug);
}

/* -----------------------------------------------------------------------------
   Getters — datacenters and lines
   -------------------------------------------------------------------------- */

export function getDatacenters(): Datacenter[] {
  return DATACENTERS;
}

export function getDatacenter(slug: string): Datacenter | undefined {
  return datacenterBySlug.get(slug);
}

export function datacentersBySlugs(slugs: string[]): Datacenter[] {
  return slugs
    .map((slug) => datacenterBySlug.get(slug))
    .filter((item): item is Datacenter => Boolean(item));
}

export function getLines(): Line[] {
  return LINES;
}

export function getLine(slug: string): Line | undefined {
  return lineBySlug.get(slug);
}

export function linesBySlugs(slugs: string[]): Line[] {
  return slugs.map((slug) => lineBySlug.get(slug)).filter((item): item is Line => Boolean(item));
}

/* -----------------------------------------------------------------------------
   Getters — scenarios, guides, compare
   -------------------------------------------------------------------------- */

export function getScenarios(): Scenario[] {
  return SCENARIOS;
}

export function getScenario(slug: string): Scenario | undefined {
  return scenarioBySlug.get(slug);
}

export function scenariosBySlugs(slugs: string[]): Scenario[] {
  return slugs
    .map((slug) => scenarioBySlug.get(slug))
    .filter((item): item is Scenario => Boolean(item));
}

export function getGuides(): Guide[] {
  return GUIDES;
}

export function getGuide(slug: string): Guide | undefined {
  return guideBySlug.get(slug);
}

export function guidesBySlugs(slugs: string[]): Guide[] {
  return slugs.map((slug) => guideBySlug.get(slug)).filter((item): item is Guide => Boolean(item));
}

export function getCompares(): Compare[] {
  return COMPARES;
}

export function getCompare(slug: string): Compare | undefined {
  return compareBySlug.get(slug);
}

export function comparesBySlugs(slugs: string[]): Compare[] {
  return slugs
    .map((slug) => compareBySlug.get(slug))
    .filter((item): item is Compare => Boolean(item));
}

/** Compares that involve a given entity, for "related comparisons" blocks. */
export function getComparesFor(type: string, slug: string): Compare[] {
  return COMPARES.filter(
    (item) =>
      (item.left.type === type && item.left.slug === slug) ||
      (item.right.type === type && item.right.slug === slug),
  );
}

/* -----------------------------------------------------------------------------
   Getters — tutorials, benchmarks, glossary
   -------------------------------------------------------------------------- */

export function getTutorials(): Tutorial[] {
  return TUTORIALS;
}

export function getTutorial(slug: string): Tutorial | undefined {
  return tutorialBySlug.get(slug);
}

export function tutorialsBySlugs(slugs: string[]): Tutorial[] {
  return slugs
    .map((slug) => tutorialBySlug.get(slug))
    .filter((item): item is Tutorial => Boolean(item));
}

export function getTutorialsByCategory(): Array<{ category: string; tutorials: Tutorial[] }> {
  const categories = new Map<string, Tutorial[]>();
  for (const tutorial of TUTORIALS) {
    const bucket = categories.get(tutorial.category) ?? [];
    bucket.push(tutorial);
    categories.set(tutorial.category, bucket);
  }
  return [...categories.entries()].map(([category, tutorials]) => ({ category, tutorials }));
}

/** Tutorials that reference a plan — powers the retention cross-sell. */
export function getTutorialsForPlan(slug: string): Tutorial[] {
  return TUTORIALS.filter((tutorial) => tutorial.relatedPlans.includes(slug));
}

export function getBenchmarks(): Benchmark[] {
  return BENCHMARKS;
}

export function getBenchmark(slug: string): Benchmark | undefined {
  return benchmarkBySlug.get(slug);
}

export function getBenchmarksFor(type: 'plan' | 'datacenter', slug: string): Benchmark[] {
  return BENCHMARKS.filter((item) => item.target.type === type && item.target.slug === slug);
}

export function getGlossary(): Glossary[] {
  return GLOSSARY;
}

export function getGlossaryEntry(slug: string): Glossary | undefined {
  return glossaryBySlug.get(slug);
}

export function glossaryBySlugs(slugs: string[]): Glossary[] {
  return slugs
    .map((slug) => glossaryBySlug.get(slug))
    .filter((item): item is Glossary => Boolean(item));
}

/* -----------------------------------------------------------------------------
   Getters — deals, posts, faqs
   -------------------------------------------------------------------------- */

export function getDeals(): Deal[] {
  return DEALS;
}

export function getDeal(slug: string): Deal | undefined {
  return dealBySlug.get(slug);
}

export function dealsBySlugs(slugs: string[]): Deal[] {
  return slugs.map((slug) => dealBySlug.get(slug)).filter((item): item is Deal => Boolean(item));
}

/** Status is recomputed from dates so an expired promotion cannot keep lying. */
export function getDealStatus(deal: Deal): 'active' | 'expired' | 'upcoming' {
  return effectiveDealStatus(deal.status, deal.startsAt, deal.expiresAt);
}

export function getActiveDeals(): Deal[] {
  return DEALS.filter((deal) => getDealStatus(deal) === 'active');
}

export function getExpiredDeals(): Deal[] {
  return DEALS.filter((deal) => getDealStatus(deal) !== 'active');
}

/** Deals usable on a given plan, newest first. */
export function getDealsForPlan(slug: string): Deal[] {
  return DEALS.filter((deal) => deal.appliesToPlans.includes(slug));
}

export function getPosts(): Post[] {
  return [...POSTS].sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
}

export function getPost(slug: string): Post | undefined {
  return postBySlug.get(slug);
}

export function getFaqs(): Faq[] {
  return FAQS;
}

/**
 * Questions attached to a given entity.
 *
 * One question pool rendered in many places, so the same answer is never
 * written twice and then allowed to drift apart.
 */
export function getFaqsFor(
  kind: 'plans' | 'datacenters' | 'lines' | 'tutorials' | 'glossary' | 'deals',
  slug: string,
): Faq[] {
  return FAQS.filter((faq) => (faq.related?.[kind] ?? []).includes(slug));
}

/** Every FAQ that belongs to any of the supplied entities, de-duplicated. */
export function getFaqsForMany(
  refs: Array<{ kind: 'plans' | 'datacenters' | 'lines' | 'tutorials' | 'glossary' | 'deals'; slug: string }>,
): Faq[] {
  const seen = new Set<string>();
  const out: Faq[] = [];
  for (const ref of refs) {
    for (const faq of getFaqsFor(ref.kind, ref.slug)) {
      if (seen.has(faq.slug)) continue;
      seen.add(faq.slug);
      out.push(faq);
    }
  }
  return out;
}

/* -----------------------------------------------------------------------------
   Affiliate helpers
   -------------------------------------------------------------------------- */

/** Direct vendor URL for a plan, bypassing click tracking. */
export function affUrlFor(plan: Plan): string {
  return planAffUrl(AFF, plan);
}

/** Generic vendor URL with no product id — the fallback for unknown plans. */
export function affUrlGeneric(): string {
  return buildAffUrl(AFF);
}

/**
 * The `href` a CTA should use. Routes through `/go/[plan]` when tracking is on
 * so the click is recorded server-side, where ad blockers cannot drop it.
 */
export function affHrefFor(plan: Plan): string {
  return affHref(AFF, plan);
}

/** `rel` attribute every outbound affiliate link must carry. */
export function affRel(): string {
  return AFF.rel;
}

/* -----------------------------------------------------------------------------
   Cross-entity related content
   -------------------------------------------------------------------------- */

export interface RelatedBundle {
  plans: Plan[];
  datacenters: Datacenter[];
  lines: Line[];
  tutorials: Tutorial[];
  compares: Compare[];
  glossary: Glossary[];
  benchmarks: Benchmark[];
}

const EMPTY_BUNDLE: RelatedBundle = {
  plans: [],
  datacenters: [],
  lines: [],
  tutorials: [],
  compares: [],
  glossary: [],
  benchmarks: [],
};

/**
 * Everything worth linking to from a given page.
 *
 * Centralised so that every page emits the same shape of internal links. The
 * fixed cross-link budget (2 datacenters, 1 line, 2 tutorials, 1 comparison) is
 * what makes the glossary ↔ line ↔ plan ↔ datacenter graph closed rather than a
 * set of islands.
 */
export function getRelatedForPlan(plan: Plan): RelatedBundle {
  const siblings = PLANS.filter(
    (item) => item.slug !== plan.slug && item.series === plan.series,
  ).slice(0, 2);
  const fallback = PLANS.filter(
    (item) => item.slug !== plan.slug && item.tier === plan.tier,
  ).slice(0, 2);

  return {
    ...EMPTY_BUNDLE,
    plans: siblings.length > 0 ? siblings : fallback,
    datacenters: datacentersBySlugs(plan.network.datacenters).slice(0, 2),
    lines: linesBySlugs([plan.network.line]),
    tutorials: [
      ...tutorialsBySlugs(plan.relatedTutorials),
      ...getTutorialsForPlan(plan.slug),
    ]
      .filter((item, index, all) => all.findIndex((x) => x.slug === item.slug) === index)
      .slice(0, 2),
    compares: getComparesFor('plan', plan.slug).slice(0, 1),
    glossary: GLOSSARY.filter((item) => item.seeAlso.includes(`/plans/${plan.slug}`)).slice(0, 3),
    benchmarks: getBenchmarksFor('plan', plan.slug).slice(0, 1),
  };
}

export function getRelatedForDatacenter(datacenter: Datacenter): RelatedBundle {
  return {
    ...EMPTY_BUNDLE,
    plans: getPlansForDatacenter(datacenter.slug).slice(0, 4),
    datacenters: datacentersBySlugs(datacenter.migratableTargets).slice(0, 3),
    lines: linesBySlugs([datacenter.line]),
    tutorials: TUTORIALS.filter((item) =>
      item.relatedPlans.some((slug) => planBySlug.get(slug)?.network.datacenters.includes(datacenter.slug)),
    ).slice(0, 2),
    compares: getComparesFor('datacenter', datacenter.slug).slice(0, 1),
    benchmarks: getBenchmarksFor('datacenter', datacenter.slug).slice(0, 1),
  };
}

export function getRelatedForLine(line: Line): RelatedBundle {
  return {
    ...EMPTY_BUNDLE,
    plans: getPlansForLine(line.slug).slice(0, 4),
    datacenters: datacentersBySlugs(line.availableDatacenters).slice(0, 4),
    lines: linesBySlugs(line.comparedWith.map((entry) => entry.slug)),
    glossary: GLOSSARY.filter((item) => item.seeAlso.includes(`/lines/${line.slug}`)).slice(0, 3),
    compares: getComparesFor('line', line.slug).slice(0, 1),
  };
}

/* -----------------------------------------------------------------------------
   Search
   -------------------------------------------------------------------------- */

/** Route prefix per document type, used to build search result URLs. */
const SEARCH_TYPE_KEYS = {
  plan: '/plans/',
  datacenter: '/datacenters/',
  line: '/lines/',
  guide: '/guides/',
  tutorial: '/learn/',
  glossary: '/glossary/',
  compare: '/compare/',
  benchmark: '/benchmarks/',
  deal: '/deals/',
  post: '/blog/',
  faq: '/faq/#',
} as const;

export interface SearchDoc {
  type: keyof typeof SEARCH_TYPE_KEYS;
  slug: string;
  title: string;
  summary: string;
  url: string;
  keywords: string[];
}

let searchIndexCache: SearchDoc[] | null = null;

/**
 * Flattened index of everything a visitor might search for.
 *
 * Built lazily and cached. Small enough (a few hundred documents) that a linear
 * scan with substring scoring beats any index structure, and it runs on the
 * client for the search page, so the whole index is serialised into the page —
 * which is why it stays compact.
 */
export function getSearchIndex(): SearchDoc[] {
  if (searchIndexCache) return searchIndexCache;

  const docs: SearchDoc[] = [];

  for (const plan of PLANS) {
    docs.push({
      type: 'plan',
      slug: plan.slug,
      title: plan.name,
      summary: plan.summary,
      url: `/plans/${plan.slug}`,
      keywords: [...plan.bestFor, ...plan.useCases, plan.series, plan.tier],
    });
  }
  for (const item of DATACENTERS) {
    docs.push({
      type: 'datacenter',
      slug: item.slug,
      title: item.name,
      summary: item.summary,
      url: `/datacenters/${item.slug}`,
      keywords: [item.code, item.city, item.country],
    });
  }
  for (const item of LINES) {
    docs.push({
      type: 'line',
      slug: item.slug,
      title: item.name,
      summary: item.summary,
      url: `/lines/${item.slug}`,
      keywords: [item.abbr],
    });
  }
  for (const item of GUIDES) {
    docs.push({
      type: 'guide',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/guides/${item.slug}`,
      keywords: [item.intent],
    });
  }
  for (const item of TUTORIALS) {
    docs.push({
      type: 'tutorial',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/learn/${item.slug}`,
      keywords: [item.category],
    });
  }
  for (const item of GLOSSARY) {
    docs.push({
      type: 'glossary',
      slug: item.slug,
      title: item.term,
      summary: item.shortDef,
      url: `/glossary/${item.slug}`,
      keywords: [item.abbr ?? '', item.termEn ?? ''],
    });
  }
  for (const item of COMPARES) {
    docs.push({
      type: 'compare',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/compare/${item.slug}`,
      keywords: [item.left.label, item.right.label],
    });
  }
  for (const item of BENCHMARKS) {
    docs.push({
      type: 'benchmark',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/benchmarks/${item.slug}`,
      keywords: [item.target.label],
    });
  }
  for (const item of DEALS) {
    docs.push({
      type: 'deal',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/deals/${item.slug}`,
      keywords: [item.code ?? '', item.kind],
    });
  }
  for (const item of POSTS) {
    docs.push({
      type: 'post',
      slug: item.slug,
      title: item.title,
      summary: item.summary,
      url: `/blog/${item.slug}`,
      keywords: item.tags,
    });
  }
  for (const item of FAQS) {
    docs.push({
      type: 'faq',
      slug: item.slug,
      title: item.question,
      summary: item.answer,
      url: `/faq/#${item.slug}`,
      keywords: [item.category],
    });
  }

  searchIndexCache = docs;
  return docs;
}

export interface SearchHit extends SearchDoc {
  score: number;
}

/** Title matches dominate, then keywords, then body text. */
export function search(query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];

  const hits: SearchHit[] = [];
  for (const doc of getSearchIndex()) {
    const title = doc.title.toLowerCase();
    const summary = doc.summary.toLowerCase();
    const keywords = doc.keywords.join(' ').toLowerCase();

    let score = 0;
    if (title === needle) score += 40;
    else if (title.includes(needle)) score += 20;
    if (keywords.includes(needle)) score += 8;
    if (summary.includes(needle)) score += 3;

    // Every whitespace-separated token must appear somewhere, or the result is
    // noise. A single-token query is unaffected.
    const tokens = needle.split(/\s+/).filter(Boolean);
    if (tokens.length > 1) {
      const haystack = `${title} ${keywords} ${summary}`;
      if (!tokens.every((token) => haystack.includes(token))) continue;
      score += 2;
    }

    if (score > 0) hits.push({ ...doc, score });
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* -----------------------------------------------------------------------------
   Diagnostics — used by the test scripts
   -------------------------------------------------------------------------- */

export const CONTENT_COUNTS = {
  plans: PLANS.length,
  datacenters: DATACENTERS.length,
  lines: LINES.length,
  scenarios: SCENARIOS.length,
  guides: GUIDES.length,
  compare: COMPARES.length,
  tutorials: TUTORIALS.length,
  benchmarks: BENCHMARKS.length,
  glossary: GLOSSARY.length,
  deals: DEALS.length,
  posts: POSTS.length,
  faqs: FAQS.length,
} as const;

export {
  PLANS,
  DATACENTERS,
  LINES,
  SCENARIOS,
  GUIDES,
  COMPARES,
  TUTORIALS,
  BENCHMARKS,
  GLOSSARY,
  DEALS,
  POSTS,
  FAQS,
};
