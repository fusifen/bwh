/**
 * Freshness check.
 *
 * Prices, coupon codes and stock status rot faster than anything else here, and
 * a stale price costs more trust than a missing one. The site surfaces the age
 * of every dated field on the page; this script is the build-time half of the
 * same policy, so nobody has to remember to re-check.
 *
 * Two severities, deliberately different:
 *
 *   - **aged** (past `FRESH_DAYS`) — a warning. The page already shows an amber
 *     notice, so the reader is informed. Blocking the build here would mean a
 *     single forgotten date stops an unrelated content fix from shipping.
 *   - **stale** (past `STALE_DAYS`) — a failure. By this point the page is
 *     telling readers the price "很可能已经变动", which is a page that should
 *     not be published as-is.
 */

import { withProject, heading, ok, fail, warn, detail, finish, paint } from './lib/project.mjs';

const problems = [];
const warnings = [];

await withProject(async ({ cms, freshness }) => {
  const { freshnessOf, FRESH_DAYS, STALE_DAYS } = freshness;

  console.log(
    `\n${paint.dim(`阈值：≤ ${FRESH_DAYS} 天为新鲜，${FRESH_DAYS}–${STALE_DAYS} 天为待复核，> ${STALE_DAYS} 天阻断构建`)}`,
  );

  /* --- prices ----------------------------------------------------------- */

  heading('套餐价格');

  const priceRows = cms
    .getPlans()
    .map((plan) => ({ slug: plan.slug, date: plan.pricing.priceCheckedAt, state: freshnessOf(plan.pricing.priceCheckedAt) }))
    .sort((a, b) => b.state.days - a.state.days);

  const stalePrices = priceRows.filter((row) => row.state.level === 'stale');
  const agingPrices = priceRows.filter((row) => row.state.level === 'aging');

  for (const row of stalePrices) {
    problems.push(`plans/${row.slug}: 价格已 ${row.state.days} 天未核对（阈值 ${STALE_DAYS} 天）`);
    fail(`plans/${row.slug}: 价格 ${row.date} 已过期 ${row.state.days} 天`);
  }
  for (const row of agingPrices) {
    warnings.push(`plans/${row.slug}: 价格 ${row.date} 已 ${row.state.days} 天未核对`);
    warn(`plans/${row.slug}: 价格 ${row.date} 已 ${row.state.days} 天未核对`);
  }

  if (priceRows.length > 0 && stalePrices.length === 0 && agingPrices.length === 0) {
    const oldest = priceRows[0];
    ok(`${priceRows.length} 个套餐的价格均在 ${FRESH_DAYS} 天内核对过（最旧 ${oldest.state.days} 天）`);
  }

  /* --- deals ------------------------------------------------------------ */

  heading('优惠条目');

  const deals = cms.getDeals();
  const dealRows = deals.map((deal) => ({
    slug: deal.slug,
    date: deal.verifiedAt,
    state: freshnessOf(deal.verifiedAt),
    effective: cms.getDealStatus(deal),
    stored: deal.status,
  }));

  for (const row of dealRows) {
    if (row.state.level === 'stale') {
      problems.push(`deals/${row.slug}: 已 ${row.state.days} 天未核实`);
      fail(`deals/${row.slug}: 核实日期 ${row.date} 已过期 ${row.state.days} 天`);
    } else if (row.state.level === 'aging') {
      warnings.push(`deals/${row.slug}: 已 ${row.state.days} 天未核实`);
      warn(`deals/${row.slug}: 核实日期 ${row.date} 已 ${row.state.days} 天未核实`);
    }

    // The stored status is the author's intent; dates override it. A mismatch
    // is not a bug — it is the mechanism working — but it is worth surfacing so
    // nobody "fixes" it by editing the stored value.
    if (row.effective !== row.stored) {
      detail(
        `deals/${row.slug}: 存储状态为「${row.stored}」，按日期判定为「${row.effective}」` +
          paint.dim('（日期优先，页面显示以判定结果为准）'),
      );
    }
  }

  if (dealRows.length > 0 && !dealRows.some((row) => row.state.level !== 'fresh')) {
    ok(`${dealRows.length} 个优惠条目均在 ${FRESH_DAYS} 天内核实过`);
  }
  if (deals.length === 0) {
    detail('暂无优惠条目');
  }

  /* --- measured data ---------------------------------------------------- */

  heading('实测数据采集日期');

  const benchmarks = cms.getBenchmarks();
  const datacenters = cms.getDatacenters().filter((dc) => dc.latencyMeasuredAt);

  for (const benchmark of benchmarks) {
    const state = freshnessOf(benchmark.testedAt);
    if (state.days > 180) {
      warnings.push(`benchmarks/${benchmark.slug}: 采集于 ${benchmark.testedAt}（${state.days} 天前），建议重测`);
      warn(`benchmarks/${benchmark.slug}: 数据已 ${state.days} 天未更新`);
    }
  }

  for (const dc of datacenters) {
    const state = freshnessOf(dc.latencyMeasuredAt);
    if (state.days > 180) {
      warnings.push(`datacenters/${dc.slug}: 延迟数据已 ${state.days} 天未重测`);
      warn(`datacenters/${dc.slug}: 延迟数据已 ${state.days} 天未重测`);
    }
  }

  const measuredCount = benchmarks.length + datacenters.length;
  if (measuredCount === 0) {
    detail('暂无实测数据（机房页面会显示测试 IP 供读者自测）');
  } else if (!warnings.some((item) => item.includes('重测'))) {
    ok(`${measuredCount} 条实测数据的采集日期均在 180 天内`);
  }

  /* --- summary ---------------------------------------------------------- */

  if (warnings.length > 0) {
    console.log(`\n${paint.yellow(`${warnings.length} 条待复核提醒（不阻断构建）：`)}`);
    for (const item of warnings) console.log(`  ${paint.yellow('!')} ${item}`);
    console.log(
      `  ${paint.dim('复核完成后更新对应的 priceCheckedAt / verifiedAt 字段，提醒会自动消失。')}`,
    );
  }

  finish(problems, '新鲜度检查通过：没有超期到必须阻断的内容');
});
