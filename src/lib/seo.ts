/**
 * Structured data and URL helpers.
 *
 * Everything the site emits as JSON-LD is built here, so a page can never ship
 * a half-formed `@graph` or forget a `BreadcrumbList`. Each builder returns a
 * plain object; `jsonLdGraph` assembles them into a single `@graph` block, which
 * is the shape Google's parser handles most reliably (one script tag per page,
 * entities cross-referenced by `@id`).
 *
 * Deliberately **not** emitted:
 *   - `AggregateRating` / `Review`. Google's policy forbids self-serving review
 *     snippets for your own organisation, and fabricating a rating would be
 *     both a policy violation and an obvious trust tell on a site whose entire
 *     pitch is honest measurement.
 *   - Any `availability` value we cannot verify. Stock status comes from the
 *     content file, not from a guess.
 */

import type {
  Benchmark,
  Compare,
  Datacenter,
  Deal,
  FaqItem,
  Glossary,
  Guide,
  Line,
  Plan,
  Post,
  Tutorial,
} from './schemas';
import { markdownToPlainText } from './markdown';
import { SITE } from './cms';
import { SITE_ORIGIN } from '../config/site';

export type Json = Record<string, unknown>;

/** Turn a site-relative path into an absolute URL. */
export function abs(path: string, origin: string = SITE_ORIGIN): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = origin.replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Trim a string to a sane meta description length. */
export function clampDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

const SCHEMA_AVAILABILITY: Record<string, string> = {
  available: 'https://schema.org/InStock',
  limited: 'https://schema.org/LimitedAvailability',
  'out-of-stock': 'https://schema.org/OutOfStock',
  discontinued: 'https://schema.org/Discontinued',
};

/* -----------------------------------------------------------------------------
   Site-level entities
   -------------------------------------------------------------------------- */

export function organizationSchema(): Json {
  return {
    '@type': 'Organization',
    '@id': `${SITE_ORIGIN}/#organization`,
    name: SITE.publisher?.name || SITE.siteName,
    url: SITE_ORIGIN,
    description: SITE.description,
    ...(SITE.logo ? { logo: abs(SITE.logo) } : {}),
    ...(SITE.social.length > 0 ? { sameAs: SITE.social } : {}),
  };
}

export function websiteSchema(): Json {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_ORIGIN}/#website`,
    name: SITE.siteName,
    alternateName: SITE.shortName,
    url: SITE_ORIGIN,
    description: SITE.description,
    inLanguage: SITE.htmlLang,
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_ORIGIN}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface Crumb {
  label: string;
  href: string;
}

export function breadcrumbSchema(crumbs: Crumb[], url: string): Json {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: abs(crumb.href),
    })),
  };
}

/* -----------------------------------------------------------------------------
   Content entities
   -------------------------------------------------------------------------- */

export function faqSchema(faqs: Array<Pick<FaqItem, 'question' | 'answer'>>): Json | null {
  if (faqs.length === 0) return null;
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: markdownToPlainText(faq.answer),
      },
    })),
  };
}

export function planSchema(plan: Plan, url: string): Json {
  const cheapest = [...plan.pricing.cycles].sort((a, b) => a.price - b.price)[0];

  return {
    '@type': 'Product',
    '@id': `${url}#product`,
    name: plan.name,
    description: clampDescription(plan.summary, 300),
    sku: plan.slug,
    category: 'VPS 主机',
    brand: { '@type': 'Brand', name: 'BandwagonHost' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'CPU 核心数', value: plan.specs.cores },
      { '@type': 'PropertyValue', name: '内存', value: `${plan.specs.memoryMB} MB` },
      { '@type': 'PropertyValue', name: '硬盘', value: `${plan.specs.diskGB} GB` },
      { '@type': 'PropertyValue', name: '月流量', value: `${plan.specs.trafficTB} TB` },
      { '@type': 'PropertyValue', name: '端口带宽', value: `${plan.specs.bandwidthMbps} Mbps` },
      { '@type': 'PropertyValue', name: '虚拟化', value: plan.specs.virtualization },
    ],
    ...(cheapest
      ? {
          offers: {
            '@type': 'Offer',
            price: cheapest.price,
            priceCurrency: plan.pricing.currency,
            availability: SCHEMA_AVAILABILITY[plan.status] ?? 'https://schema.org/InStock',
            url,
            seller: { '@type': 'Organization', name: 'BandwagonHost' },
          },
        }
      : {}),
  };
}

export function lineSchema(line: Line, url: string): Json {
  return {
    '@type': 'DefinedTerm',
    '@id': `${url}#term`,
    name: line.name,
    alternateName: line.abbr,
    description: line.definition,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: '搬瓦工线路与机房术语',
      url: abs('/glossary'),
    },
  };
}

export function glossarySchema(entry: Glossary, url: string): Json {
  return {
    '@type': 'DefinedTerm',
    '@id': `${url}#term`,
    name: entry.term,
    ...(entry.termEn ? { alternateName: entry.termEn } : {}),
    description: entry.shortDef,
    inDefinedTermSet: {
      '@type': 'DefinedTermSet',
      name: '搬瓦工术语词典',
      url: abs('/glossary'),
    },
  };
}

export function datacenterSchema(datacenter: Datacenter, url: string): Json {
  return {
    '@type': 'Place',
    '@id': `${url}#place`,
    name: datacenter.name,
    description: clampDescription(datacenter.summary, 300),
    address: {
      '@type': 'PostalAddress',
      addressCountry: datacenter.country,
      addressLocality: datacenter.city,
    },
  };
}

export function articleSchema(
  input: {
    title: string;
    description: string;
    publishedAt?: string;
    updatedAt: string;
    author?: string;
  },
  url: string,
): Json {
  return {
    '@type': 'Article',
    '@id': `${url}#article`,
    headline: input.title,
    description: clampDescription(input.description),
    ...(input.publishedAt ? { datePublished: input.publishedAt } : {}),
    dateModified: input.updatedAt,
    inLanguage: SITE.htmlLang,
    author: { '@type': 'Person', name: input.author || '本站编辑部' },
    publisher: { '@id': `${SITE_ORIGIN}/#organization` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
}

export function postSchema(post: Post, url: string): Json {
  return articleSchema(
    {
      title: post.title,
      description: post.summary,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      author: post.author,
    },
    url,
  );
}

export function guideSchema(guide: Guide, url: string): Json {
  return articleSchema(
    {
      title: guide.title,
      description: guide.summary,
      publishedAt: guide.publishedAt,
      updatedAt: guide.updatedAt,
    },
    url,
  );
}

/**
 * HowTo for tutorials. Only emitted when there are real steps — an empty HowTo
 * is worse than none, because it advertises a procedure that isn't there.
 */
export function howToSchema(tutorial: Tutorial, url: string): Json | null {
  if (tutorial.steps.length === 0) return null;
  return {
    '@type': 'HowTo',
    '@id': `${url}#howto`,
    name: tutorial.title,
    description: tutorial.summary,
    totalTime: `PT${tutorial.timeMinutes}M`,
    ...(tutorial.prerequisites.length > 0
      ? {
          tool: tutorial.prerequisites.map((item) => ({
            '@type': 'HowToTool',
            name: item,
          })),
        }
      : {}),
    step: tutorial.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.title,
      text: markdownToPlainText(step.body, 500),
      url: `${url}#step-${index + 1}`,
    })),
  };
}

export function itemListSchema(items: Array<{ name: string; url: string }>, name: string): Json {
  return {
    '@type': 'ItemList',
    name,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: abs(item.url),
    })),
  };
}

export function compareSchema(compare: Compare, url: string): Json {
  return {
    '@type': 'ItemList',
    '@id': `${url}#comparison`,
    name: compare.title,
    description: compare.summary,
    numberOfItems: 2,
    itemListElement: [compare.left, compare.right].map((subject, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: subject.label,
      url: abs(`/${subject.type === 'plan' ? 'plans' : `${subject.type}s`}/${subject.slug}`),
    })),
  };
}

/**
 * Measured results are published as a Dataset, not as a Review.
 *
 * A Dataset says "here is what we measured, here is how"; a Review says "we
 * rate this 4.5 stars". The first is verifiable and the second is not, and only
 * one of them is honest when the site earns commission on the product.
 */
export function benchmarkSchema(benchmark: Benchmark, url: string): Json {
  return {
    '@type': 'Dataset',
    '@id': `${url}#dataset`,
    name: benchmark.title,
    description: benchmark.summary,
    datePublished: benchmark.testedAt,
    dateModified: benchmark.updatedAt,
    creator: { '@id': `${SITE_ORIGIN}/#organization` },
    measurementTechnique: benchmark.method,
    ...(benchmark.rawUrl ? { distribution: { '@type': 'DataDownload', contentUrl: benchmark.rawUrl } } : {}),
  };
}

export function dealSchema(deal: Deal, url: string): Json {
  return {
    '@type': 'Offer',
    '@id': `${url}#offer`,
    name: deal.title,
    description: deal.summary,
    url,
    ...(deal.code ? { identifier: deal.code } : {}),
    ...(deal.startsAt ? { validFrom: deal.startsAt } : {}),
    ...(deal.expiresAt ? { validThrough: deal.expiresAt } : {}),
    seller: { '@type': 'Organization', name: 'BandwagonHost' },
  };
}

/* -----------------------------------------------------------------------------
   Assembly
   -------------------------------------------------------------------------- */

/**
 * A node, a list of nodes, or an absent node.
 *
 * Recursive on purpose: pages build their `@graph` contribution as an array of
 * conditionally-present nodes (`[breadcrumb, planSchema, faq.length && faqSchema]`)
 * and shouldn't have to filter it before handing it over. `jsonLdGraph` flattens
 * and drops the holes.
 */
export type JsonLdNode = Json | null | undefined | JsonLdNode[];

/**
 * Merge nodes into one `@graph`.
 *
 * `@context` is added once at the top rather than on every node, and duplicate
 * `@id`s are dropped — two `Organization` blocks in one graph is a common way
 * to get the whole block ignored.
 */
export function jsonLdGraph(...nodes: JsonLdNode[]): string {
  const flat: Json[] = [];
  const seen = new Set<string>();

  const push = (node: JsonLdNode) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const child of node) push(child);
      return;
    }

    const id = typeof node['@id'] === 'string' ? node['@id'] : '';
    if (id) {
      if (seen.has(id)) return;
      seen.add(id);
    }
    flat.push(node);
  };

  for (const node of nodes) push(node);

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': flat });
}

/** Escape a JSON-LD payload for safe inlining into a `<script>` tag. */
export function safeJsonLd(payload: string): string {
  return payload.replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, (ch) =>
    ch === '\u2028' ? '\\u2028' : '\\u2029',
  );
}
