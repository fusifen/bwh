/**
 * Affiliate click redirect.
 *
 * This is the only revenue-critical piece of runtime code on the site, and it
 * exists for one reason: **the affiliate click is the one number that matters,
 * and client-side analytics cannot be trusted to capture it.** GA4 outbound
 * events are dropped by ad blockers, by Safari's tracking prevention and by
 * anyone with a content blocker — and those users are over-represented in this
 * audience. A server-side 302 logs the click before the browser can prevent it.
 *
 * Two deliberate constraints:
 *
 *   1. **`prerender = false`.** The route must execute per request. It uses an
 *      Astro server route rather than a repository-root `functions/` handler
 *      because `functions/` does not run under `npm run dev`, which would mean
 *      the click path is never exercised locally.
 *
 *   2. **It does not import `lib/cms`.** `cms` eagerly loads and Zod-validates
 *      every content file; pulling that into the Worker bundle to look up one
 *      product id would multiply the cold-start cost for no benefit. The two
 *      content sets it needs are globbed directly instead.
 *
 * The link works without JavaScript either way: this is a plain HTTP redirect.
 */
export const prerender = false;

import type { APIRoute } from 'astro';
import { buildAffUrl, type AffiliateLike } from '../../lib/affiliate';

/* -----------------------------------------------------------------------------
   Minimal, bundle-friendly content reads
   -------------------------------------------------------------------------- */

const PLAN_MODULES = import.meta.glob('../../content/plans/*.json', { eager: true });
const SINGLETON_MODULES = import.meta.glob('../../content/affiliate.json', { eager: true });

/** Vite wraps JSON modules in `{ default }`; tolerate both shapes. */
function unwrap(module: unknown): unknown {
  if (module && typeof module === 'object' && 'default' in module) {
    return (module as { default: unknown }).default;
  }
  return module;
}

interface PlanStub {
  slug?: string;
  affiliate?: { pid?: string };
}

function readPlan(slug: string): PlanStub | undefined {
  for (const [file, module] of Object.entries(PLAN_MODULES)) {
    if (!file.endsWith(`/${slug}.json`)) continue;
    const value = unwrap(module) as PlanStub;
    return value;
  }
  return undefined;
}

/**
 * The affiliate singleton, narrowed to the fields the link builder needs.
 *
 * Read defensively: a malformed config must not 500 the redirect, because a
 * broken redirect earns nothing at all while a generic landing page still
 * earns something.
 */
function readAffiliate(): AffiliateLike {
  const raw = (unwrap(SINGLETON_MODULES['../../content/affiliate.json']) ?? {}) as Partial<
    AffiliateLike
  >;

  return {
    enabled: raw.enabled !== false,
    affId: typeof raw.affId === 'string' ? raw.affId : '',
    baseUrl:
      typeof raw.baseUrl === 'string' && raw.baseUrl
        ? raw.baseUrl
        : 'https://bandwagonhost.com/aff.php',
    params: Array.isArray(raw.params) && raw.params.length > 0 ? raw.params : ['aff', 'pid'],
    rel: typeof raw.rel === 'string' ? raw.rel : 'sponsored nofollow noopener',
    trackClicks: raw.trackClicks !== false,
  };
}

/* -----------------------------------------------------------------------------
   Handler
   -------------------------------------------------------------------------- */

/**
 * Record the click. On Cloudflare Pages this lands in the deployment log, where
 * `wrangler pages deployment tail` can read it back — which is enough to answer
 * "which plan are people clicking", the question this route exists to answer.
 * A structured single line keeps it greppable and cheap.
 */
function logClick(request: Request, slug: string, resolved: string): void {
  const referer = request.headers.get('referer') ?? '';
  const country = request.headers.get('cf-ipcountry') ?? '';
  const ua = request.headers.get('user-agent') ?? '';

  // Truncate the user agent: the full string is noise, the family is not.
  const agent = ua.slice(0, 120);

  console.log(
    JSON.stringify({
      event: 'aff_click',
      plan: slug,
      url: resolved,
      referer,
      country,
      agent,
      at: new Date().toISOString(),
    }),
  );
}

export const GET: APIRoute = ({ params, request }) => {
  const slug = (params.plan ?? '').trim();
  const affiliate = readAffiliate();

  const plan = slug ? readPlan(slug) : undefined;
  const pid = plan?.affiliate?.pid;

  // `buildAffUrl` omits a placeholder pid rather than sending it, so an
  // unconfigured plan lands on the generic page instead of on the wrong product.
  const target = buildAffUrl(affiliate, pid);

  logClick(request, slug || '(none)', target);

  // 302 rather than 301: the destination can change when a pid is corrected,
  // and a permanently cached redirect would keep sending traffic to the old one.
  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
};
