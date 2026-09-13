/**
 * Freshness policy.
 *
 * Prices, coupon codes and stock status rot faster than anything else on this
 * site, and a stale price costs more trust than a missing one. Rather than
 * relying on someone remembering to re-check, every dated field is scored here
 * and surfaced in three places:
 *
 *   1. on the page, as an "价格已于 N 天前核对" stamp;
 *   2. at build time, through `test:freshness`, which warns and then fails;
 *   3. in `llms.txt`, so an answer engine quoting the price can see its age.
 *
 * Thresholds are intentionally tight. Thirty days is roughly how long a vendor
 * price survives before a promotion moves it.
 */

import { daysSince, formatRelativeDays } from './format';

export type FreshnessLevel = 'fresh' | 'aging' | 'stale';

export interface Freshness {
  /** Whole days since the field was last verified. */
  days: number;
  level: FreshnessLevel;
  /** Short label for a badge. */
  label: string;
  /** Full sentence for the on-page stamp. */
  message: string;
  /** Visual tone, mapped to colour by the components. */
  tone: 'ok' | 'warn' | 'alert';
}

/** Within this many days the value is presented as confirmed. */
export const FRESH_DAYS = 30;
/** Beyond this, `test:freshness` fails the pipeline. */
export const STALE_DAYS = 60;

export function freshnessOf(iso: string, now: Date = new Date()): Freshness {
  const days = daysSince(iso, now);

  if (!Number.isFinite(days)) {
    return {
      days: Number.POSITIVE_INFINITY,
      level: 'stale',
      label: '未标注',
      message: '该数据未标注核对日期，请以官方页面为准。',
      tone: 'alert',
    };
  }

  if (days <= FRESH_DAYS) {
    return {
      days,
      level: 'fresh',
      label: formatRelativeDays(days),
      message: `价格与库存已于${formatRelativeDays(days)}核对。`,
      tone: 'ok',
    };
  }

  if (days <= STALE_DAYS) {
    return {
      days,
      level: 'aging',
      label: `${days} 天前`,
      message: `价格已 ${days} 天未核对，可能已有变动，请以官方结账页为准。`,
      tone: 'warn',
    };
  }

  return {
    days,
    level: 'stale',
    label: `${days} 天前`,
    message: `价格已 ${days} 天未核对，很可能已经变动。下单前请务必在官方结账页确认最终金额。`,
    tone: 'alert',
  };
}

/**
 * A deal whose end date has passed is not deleted — the page keeps its search
 * history — but it must stop advertising itself as live.
 */
export function isExpired(expiresAt: string | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

export function isUpcoming(startsAt: string | undefined, now: Date = new Date()): boolean {
  if (!startsAt) return false;
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > now.getTime();
}

/**
 * Resolve a deal's effective status: the stored field is the author's intent,
 * but a date that has passed overrides it. Without this, an expired promotion
 * keeps claiming to be live until someone remembers to edit the file.
 */
export function effectiveDealStatus(
  stored: 'active' | 'expired' | 'upcoming',
  startsAt: string | undefined,
  expiresAt: string | undefined,
  now: Date = new Date(),
): 'active' | 'expired' | 'upcoming' {
  if (isExpired(expiresAt, now)) return 'expired';
  if (isUpcoming(startsAt, now)) return 'upcoming';
  return stored;
}
