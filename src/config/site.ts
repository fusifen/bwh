/**
 * Build-time constants.
 *
 * Anything an editor should be able to change lives in `src/content/site.json`
 * and is read through `lib/cms`. This file holds only values that are genuinely
 * structural — the origin used for absolute URLs, defaults for fields the CMS
 * leaves blank, and the enums that drive list ordering.
 */

/** Production origin. Set at build time with `SITE_URL=...`. */
export const SITE_ORIGIN = (import.meta.env.SITE ?? 'https://stellar-shell.pages.dev').replace(
  /\/$/,
  '',
);

/** Fallback OG image, used when a page does not supply one. */
export const DEFAULT_OG_IMAGE = '/brand/og-default.svg';

/** Fallback site name, used when the CMS singleton is blank. */
export const FALLBACK_SITE_NAME = '瓦工笔记';
export const FALLBACK_SHORT_NAME = '瓦工笔记';

/**
 * Display order for plan series listings.
 *
 * A stable order matters more than a "correct" one: readers compare the same
 * list across pages, and a list that reshuffles between visits reads as
 * arbitrary.
 */
export const SERIES_ORDER = [
  'limited',
  'basic',
  'cn2-gt',
  'cn2-gia',
  'cn2-gia-e',
  'ecommerce',
  'ultra',
  'hongkong',
  'tokyo',
  'osaka',
  'singapore',
  'dubai',
] as const;

/** Display order for datacenter listings — by region, not alphabetically. */
export const DATACENTER_REGION_ORDER = [
  '美国',
  '加拿大',
  '日本',
  '中国香港',
  '新加坡',
  '荷兰',
  '阿联酋',
] as const;

/** Series that are worth surfacing on the homepage even when unfeatured. */
export const HOMEPAGE_SERIES = ['basic', 'cn2-gia-e', 'ecommerce', 'hongkong'] as const;

/** Number of items per page for list routes that paginate. */
export const PAGE_SIZE = 12;
