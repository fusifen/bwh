/**
 * Presentation helpers for numbers, sizes and dates.
 *
 * Everything here is pure and locale-fixed (Simplified Chinese). The site is
 * single-language by design — see PLAN.md §5.3 — so there is no locale
 * parameter to thread through, and no second set of date formats to keep in
 * sync.
 */

import type { BillingCycle } from './schemas';

/** Months per billing cycle, used to derive a comparable per-month figure. */
const CYCLE_MONTHS: Record<BillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

const CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: '月付',
  quarterly: '季付',
  semiannual: '半年付',
  annual: '年付',
};

const CYCLE_SUFFIX: Record<BillingCycle, string> = {
  monthly: '/月',
  quarterly: '/季',
  semiannual: '/半年',
  annual: '/年',
};

/** Render a number without trailing zeros: 2.5 → "2.5", 1.0 → "1". */
export function trimNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '0';
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, '');
}

/** Round for display. Prices are shown to the cent, never as floats. */
export function formatPrice(amount: number, currency = 'USD'): string {
  const symbols: Record<string, string> = { USD: '$', CNY: '¥', EUR: '€' };
  const symbol = symbols[currency] ?? '';
  const value = amount.toFixed(2).replace(/\.00$/, '');
  return `${symbol}${value}`;
}

/**
 * Convert any billing cycle to a comparable monthly figure.
 *
 * This is the single most useful number on a pricing table: annual plans look
 * expensive next to monthly ones until you divide by twelve, and readers who
 * have to do that arithmetic themselves usually don't.
 */
export function monthlyEquivalent(cycle: BillingCycle, price: number): number {
  return price / CYCLE_MONTHS[cycle];
}

export function cycleLabel(cycle: BillingCycle): string {
  return CYCLE_LABELS[cycle];
}

export function cycleSuffix(cycle: BillingCycle): string {
  return CYCLE_SUFFIX[cycle];
}

export function formatMemory(memoryMB: number): string {
  if (memoryMB >= 1024) return `${trimNumber(memoryMB / 1024)} GB`;
  return `${memoryMB} MB`;
}

export function formatDisk(diskGB: number): string {
  if (diskGB >= 1024) return `${trimNumber(diskGB / 1024)} TB`;
  return `${diskGB} GB`;
}

export function formatTraffic(trafficTB: number): string {
  if (trafficTB < 1) return `${Math.round(trafficTB * 1024)} GB`;
  return `${trimNumber(trafficTB)} TB`;
}

export function formatBandwidth(bandwidthMbps: number): string {
  if (bandwidthMbps >= 1000) return `${trimNumber(bandwidthMbps / 1000)} Gbps`;
  return `${bandwidthMbps} Mbps`;
}

/** `2026-09-13` → `2026-09-13`; anything unparseable is passed through. */
export function formatDate(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

/** `2026-09-13` → `2026 年 9 月 13 日` */
export function formatDateCn(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月 ${date.getUTCDate()} 日`;
}

/** `2026-09-13` → `2026 年 9 月` — used in freshness-stamped titles. */
export function formatYearMonthCn(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getUTCFullYear()} 年 ${date.getUTCMonth() + 1} 月`;
}

/**
 * Whole days between an ISO date and today.
 *
 * Both sides are normalised to UTC midnight so the result does not shift by one
 * depending on the hour the build happens to run at.
 */
export function daysSince(iso: string, now: Date = new Date()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return Number.POSITIVE_INFINITY;
  const a = Date.UTC(then.getUTCFullYear(), then.getUTCMonth(), then.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

export function formatRelativeDays(days: number): string {
  if (!Number.isFinite(days)) return '未知';
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.round(days / 30)} 个月前`;
  return `${Math.round(days / 365)} 年前`;
}

/** `45` → `45 分钟`; `90` → `1.5 小时` */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} 小时` : `${trimNumber(hours)} 小时`;
}

/** 0..1 → `4.6` on a five-point scale, for the editor score bars. */
export function formatScore(score: number): string {
  return trimNumber(score, 1);
}

/** Join class names, dropping falsy entries. */
export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

/** Human-readable label for the plan series enum. */
export const SERIES_LABELS: Record<string, string> = {
  basic: '基础 VPS',
  'cn2-gt': 'CN2 GT',
  'cn2-gia': 'CN2 GIA',
  'cn2-gia-e': 'CN2 GIA-E',
  ecommerce: 'E-Commerce',
  ultra: 'Ultra',
  hongkong: '香港机房',
  tokyo: '东京机房',
  osaka: '大阪机房',
  singapore: '新加坡机房',
  dubai: '迪拜机房',
  limited: '限量特价',
};

export const TIER_LABELS: Record<string, string> = {
  entry: '入门',
  mainstream: '主流',
  pro: '进阶',
  enterprise: '企业',
};

export const STATUS_LABELS: Record<string, string> = {
  available: '在售',
  'out-of-stock': '已售罄',
  discontinued: '已下架',
  limited: '限量供应',
};

export const PAYMENT_LABELS: Record<string, string> = {
  alipay: '支付宝',
  paypal: 'PayPal',
  creditcard: '信用卡',
  unionpay: '银联',
  crypto: '加密货币',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '较难',
};

export const TUTORIAL_CATEGORY_LABELS: Record<string, string> = {
  purchase: '购买与注册',
  kiwivm: 'KiwiVM 面板',
  network: '网络与线路',
  os: '系统与重装',
  deploy: '部署与应用',
  security: '安全加固',
  billing: '计费与续费',
  troubleshoot: '故障排查',
};

export const DEAL_KIND_LABELS: Record<string, string> = {
  coupon: '优惠码',
  event: '限时活动',
  'limited-stock': '限量库存',
};

export const DEAL_STATUS_LABELS: Record<string, string> = {
  active: '进行中',
  expired: '已结束',
  upcoming: '即将开始',
};

export const GUIDE_INTENT_LABELS: Record<string, string> = {
  beginner: '新手入门',
  website: '建站',
  'cross-border': '跨境业务',
  developer: '开发测试',
  team: '团队采购',
  budget: '预算有限',
};

export const COMPARE_TYPE_LABELS: Record<string, string> = {
  plan: '套餐',
  datacenter: '机房',
  line: '线路',
  brand: '服务商',
};

export const COMPARE_WINNER_LABELS: Record<string, string> = {
  left: '左侧更优',
  right: '右侧更优',
  tie: '各有取舍',
};
