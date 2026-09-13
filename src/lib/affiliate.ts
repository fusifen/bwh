/**
 * Affiliate link construction — the single place in the codebase that turns an
 * affiliate id plus a plan's product id into a URL.
 *
 * Why this is its own module
 * --------------------------
 * Every link on this site is the only revenue channel it has. A wrong `aff`
 * parameter, a mistyped `pid`, or a swapped parameter order produces pages that
 * look completely normal and earn exactly nothing — there is no runtime error
 * to catch it. Concentrating the logic here means:
 *
 *   - `affId` lives in one JSON file and changing accounts is a one-line edit;
 *   - `test:affiliate` can enumerate every plan and assert the generated URL is
 *     well-formed before anything ships;
 *   - the `rel="sponsored nofollow"` requirement (Google's rule for affiliate
 *     links) cannot be forgotten on a new component.
 *
 * The functions here are pure. Loading and validating the config is `cms.ts`'s
 * job, so this module has no imports and no circular dependency risk.
 */

/** The subset of the affiliate singleton these helpers need. */
export interface AffiliateLike {
  enabled: boolean;
  affId: string;
  baseUrl: string;
  params: string[];
  rel: string;
  trackClicks: boolean;
}

/** The subset of a plan these helpers need. */
export interface AffiliateTarget {
  slug: string;
  affiliate: { pid: string };
}

/**
 * Ids that mean "nobody has filled this in yet". Kept in one place so the test
 * suite and the docs agree on what counts as unconfigured.
 */
const PLACEHOLDER_IDS = new Set([
  '',
  '0',
  '000000',
  'your-aff-id',
  'YOUR_AFF_ID',
  'REPLACE_ME',
  'placeholder',
]);

export function isPlaceholderAffId(affId: string | undefined | null): boolean {
  const value = (affId ?? '').trim();
  return PLACEHOLDER_IDS.has(value) || /^x+$/i.test(value);
}

/**
 * A product id that can actually be sent to the vendor.
 *
 * `"0"` is the value the seed content ships with, meaning "nobody has copied
 * the real pid out of the affiliate dashboard yet". Treating it as usable would
 * be worse than omitting it: a wrong pid sends the buyer to a different product
 * and still earns, silently, which is the hardest kind of bug to notice.
 * Omitting it falls back to the generic landing page, which converts worse but
 * is never wrong.
 */
export function usablePid(pid: string | undefined | null): string | undefined {
  const value = (pid ?? '').trim();
  if (value === '') return undefined;
  if (PLACEHOLDER_IDS.has(value)) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  return value;
}

/** Values are looked up by the parameter names declared in the config. */
function paramValue(name: string, aff: AffiliateLike, pid?: string): string | undefined {
  if (name === 'aff' || name === 'affid' || name === 'a') return aff.affId;
  if (name === 'pid' || name === 'id') return pid;
  return undefined;
}

/**
 * Build the vendor URL for a plan (or for the generic landing page when no
 * product id is given).
 *
 * Parameter order follows `aff.params` from the config, so it is stable across
 * builds and diffable. `pid` is omitted entirely rather than sent empty — a
 * dangling `&pid=` is the kind of thing a vendor's tracking script may or may
 * not tolerate, and there is no upside to finding out.
 */
export function buildAffUrl(
  aff: AffiliateLike,
  pid?: string,
): string {
  const resolved = usablePid(pid);
  const pairs = aff.params
    .map((name) => {
      const value = paramValue(name, aff, resolved);
      return value ? `${name}=${encodeURIComponent(value)}` : null;
    })
    .filter((pair): pair is string => pair !== null);

  const query = pairs.join('&');
  return query ? `${aff.baseUrl}?${query}` : aff.baseUrl;
}

export function planAffUrl(aff: AffiliateLike, plan: AffiliateTarget): string {
  return buildAffUrl(aff, plan.affiliate?.pid);
}

/**
 * Where a CTA's `href` should point.
 *
 * With click tracking on, the link goes through `/go/[plan]` so the click is
 * recorded server-side. That matters because GA4 outbound events are dropped by
 * ad blockers, and the affiliate click is the one number the whole site exists
 * to move.
 *
 * Tracking off (or a disabled program) falls through to the direct vendor URL,
 * which is also what a no-JS visitor gets either way — `/go/` responds with a
 * plain 302, so the link works without JavaScript.
 */
export function affHref(aff: AffiliateLike, plan: AffiliateTarget): string {
  if (!aff.enabled) return planAffUrl(aff, plan);
  if (aff.trackClicks) return `/go/${plan.slug}`;
  return planAffUrl(aff, plan);
}

export interface AffUrlCheck {
  ok: boolean;
  reasons: string[];
  url: string;
}

/**
 * Assert a generated URL is shaped the way the vendor expects.
 *
 * This catches the mistakes that are invisible in a browser: a missing `aff`
 * parameter, a `pid` that came through as a float (`44.0`), a duplicated query
 * string. It cannot tell whether the pid is the *right* pid — only a human
 * opening the link can do that, which is what `affiliate.verified` records.
 */
export function validateAffUrl(url: string, aff: AffiliateLike): AffUrlCheck {
  const reasons: string[] = [];

  if (!url.startsWith(aff.baseUrl)) {
    reasons.push(`URL 未以 baseUrl 开头：${url}`);
  }

  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) {
    reasons.push('URL 没有查询参数，aff 参数缺失');
    return { ok: false, reasons, url };
  }

  const query = url.slice(queryIndex + 1);
  if (query.includes('?')) {
    reasons.push('查询字符串中出现多余的 ?');
  }

  const params = new URLSearchParams(query);
  const affParam = aff.params.find((name) => name === 'aff' || name === 'affid' || name === 'a');
  if (affParam && params.get(affParam) !== aff.affId) {
    reasons.push(`aff 参数缺失或不匹配：期望 ${affParam}=${aff.affId}`);
  }

  const pidParam = aff.params.find((name) => name === 'pid' || name === 'id');
  const pid = pidParam ? params.get(pidParam) : null;
  if (pid !== null && pid !== undefined) {
    if (!/^\d+$/.test(pid)) {
      reasons.push(`pid 不是纯数字：${pid}`);
    }
  }

  return { ok: reasons.length === 0, reasons, url };
}

/**
 * A plan whose pid is blank or a placeholder cannot produce a per-plan link.
 * The generic landing page still earns, but at a lower conversion rate, so this
 * is worth surfacing in the test output rather than silently degrading.
 */
export function hasUsablePid(plan: AffiliateTarget): boolean {
  return usablePid(plan.affiliate?.pid) !== undefined;
}
