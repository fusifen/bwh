/**
 * Affiliate link check — the highest-value script in this directory.
 *
 * Why it exists
 * -------------
 * The affiliate link is the site's only revenue channel, and every way it can
 * break is invisible in a browser. A wrong `affId`, a mistyped `pid`, a swapped
 * parameter order, a `rel` attribute that lost its `nofollow` — all of them
 * produce pages that look completely normal and earn nothing, with no runtime
 * error to catch it.
 *
 * What it can and cannot do
 * -------------------------
 * It checks *shape*: the id is present, the parameter names are the ones the
 * config declares, the pid is numeric, the URL parses, the click route resolves.
 * It cannot tell whether a pid is the *right* pid — only a human opening the
 * link can, which is what `affiliate.verified` records. So the script also
 * reports which plans are still unverified, because that is the one remaining
 * manual step before launch.
 */

import { withProject, heading, ok, fail, warn, detail, finish, paint } from './lib/project.mjs';

const problems = [];
const warnings = [];

await withProject(async ({ cms, affiliate }) => {
  const aff = cms.AFF;
  const plans = cms.getPlans();
  const raw = cms.AFFILIATE;

  /* --- 1. the account itself -------------------------------------------- */

  heading('联盟账号配置');

  // A placeholder affId is a *configuration* gap, not a code defect — the same
  // class of thing as an unverified pid. It resolves to a working URL, so every
  // link on the site is structurally sound; it just does not earn anything yet.
  //
  // It is deliberately NOT an error here. Making it one would mean a fresh
  // clone can never run `npm run verify`, which trains people to ignore a red
  // result. The hard gate lives in `audit-build.mjs`, which inspects the actual
  // production artifact and refuses to pass a build that would ship a link
  // earning nothing. That is the right place to block: it is the last step
  // before deploy, and it checks the real output rather than the source.
  if (affiliate.isPlaceholderAffId(aff.affId)) {
    warnings.push(
      `affId 仍是占位值 "${aff.affId}"：所有链接都会生成，但不会计佣。` +
        '改 src/content/affiliate.json 的 affId 字段（搬瓦工后台 → Affiliate → 推广链接里的 aff 参数）。',
    );
    warn(`affId 仍是占位值 "${aff.affId}"（上线前必须替换）`);
    detail('影响：链接可正常跳转，但不计入佣金');
    detail('构建审计会拦截带占位 affId 的产物，所以这个问题不会漏到线上');
  } else {
    ok(`affId 已配置（${aff.affId.length} 位）`);
  }

  if (!aff.enabled) {
    warnings.push('联盟链接当前被禁用（affiliate.enabled = false），所有 CTA 将指向官网而不计佣。');
    warn('联盟链接当前被禁用');
  }

  if (!/^https:\/\//.test(aff.baseUrl)) {
    problems.push(`baseUrl 不是 https：${aff.baseUrl}`);
    fail(`baseUrl 不是 https：${aff.baseUrl}`);
  } else {
    ok(`baseUrl：${aff.baseUrl}`);
  }

  if (!aff.rel.includes('sponsored')) {
    problems.push(`rel 缺少 sponsored：${aff.rel}。联盟链接必须标注 sponsored，否则违反搜索引擎的链接规范。`);
    fail(`rel 缺少 sponsored：${aff.rel}`);
  } else if (!aff.rel.includes('nofollow')) {
    warnings.push(`rel 缺少 nofollow：${aff.rel}`);
    warn(`rel 缺少 nofollow：${aff.rel}`);
  } else {
    ok(`rel = "${aff.rel}"`);
  }

  /* --- 2. every plan produces a well-formed URL -------------------------- */

  heading('逐套餐链接校验');

  let usable = 0;
  let generic = 0;

  for (const plan of plans) {
    const url = affiliate.planAffUrl(aff, plan);
    const check = affiliate.validateAffUrl(url, aff);

    if (!check.ok) {
      problems.push(`plans/${plan.slug}: 生成的链接不合法 → ${check.reasons.join('；')}`);
      fail(`plans/${plan.slug}: ${check.reasons.join('；')}`);
      continue;
    }

    // A placeholder pid is not an error — the link falls back to the generic
    // landing page, which is worse-converting but never wrong. It is reported
    // because it is the one thing a human still has to fix.
    if (affiliate.hasUsablePid(plan)) {
      usable += 1;
      if (!plan.affiliate.verified) {
        warnings.push(`plans/${plan.slug}: pid ${plan.affiliate.pid} 已填写但未人工验证`);
      }
    } else {
      generic += 1;
      detail(
        `${plan.slug}: pid 未填写 → 回落到通用落地页 ${paint.dim(url)}`,
      );
    }
  }

  if (usable + generic === plans.length && problems.length === 0) {
    ok(`${plans.length} 个套餐均能生成可解析的链接（${usable} 个定向到具体套餐，${generic} 个回落通用页）`);
  }

  /* --- 3. the click route ------------------------------------------------ */

  heading('点击归因路径');

  if (aff.trackClicks && aff.enabled) {
    const sample = plans[0];
    const href = cms.affHrefFor(sample);
    if (href !== `/go/${sample.slug}`) {
      problems.push(`CTA href 未走 /go 路由：${href}（期望 /go/${sample.slug}）`);
      fail(`CTA href 未走 /go 路由：${href}`);
    } else {
      ok(`CTA 走 /go/[plan]，点击由服务端记录：${href}`);
    }
    detail('对应实现：src/pages/go/[plan].ts（prerender = false）');
  } else {
    warn('点击归因已关闭，CTA 直接指向商家，点击只能依赖客户端统计（会被拦截器丢弃）');
  }

  /* --- 4. the generic fallback ------------------------------------------ */

  heading('通用落地页');

  const genericUrl = cms.affUrlGeneric();
  const genericCheck = affiliate.validateAffUrl(genericUrl, aff);
  if (genericCheck.ok) {
    ok(`通用链接可用：${genericUrl}`);
  } else {
    problems.push(`通用链接不合法 → ${genericCheck.reasons.join('；')}`);
    fail(`通用链接不合法 → ${genericCheck.reasons.join('；')}`);
  }

  /* --- 5. disclosure ---------------------------------------------------- */

  heading('披露文案');

  if (!raw.disclosureShort || raw.disclosureShort.trim().length < 10) {
    problems.push('disclosureShort 为空或过短，CTA 附近会缺少必要声明。');
    fail('disclosureShort 为空或过短');
  } else {
    ok('简短披露已配置');
  }

  if (!raw.disclosureFull || raw.disclosureFull.trim().length < 80) {
    problems.push('disclosureFull 为空或过短，/disclosure 页面内容不足。');
    fail('disclosureFull 为空或过短');
  } else {
    ok('完整披露已配置');
  }

  /* --- summary ---------------------------------------------------------- */

  if (warnings.length > 0) {
    console.log(`\n${paint.yellow(`${warnings.length} 条提醒（不阻断构建）：`)}`);
    for (const item of warnings) console.log(`  ${paint.yellow('!')} ${item}`);
  }

  // Two things genuinely cannot be verified from source: whether the affId is
  // real, and whether each pid lands on the intended plan. Both are manual
  // steps, so they are collected into one explicit pre-launch block rather
  // than scattered through the output.
  const manual = [];
  if (affiliate.isPlaceholderAffId(aff.affId)) manual.push('把 affiliate.json 的 affId 换成真实推广 ID');
  if (plans.some((plan) => !plan.verified)) {
    manual.push(`逐个核对 ${plans.filter((plan) => !plan.verified).length} 个套餐的 pid，确认落到正确购买页后勾选「已人工验证」`);
  }
  if (manual.length > 0) {
    console.log(`\n${paint.bold('上线前必须人工完成：')}`);
    for (const [index, item] of manual.entries()) console.log(`  ${index + 1}. ${item}`);
    console.log(`  ${paint.dim('这两项无法自动验证：脚本只能确认链接结构合法，不能确认它指向对的商品。')}`);
  }

  finish(problems, `联盟链接检查通过：${plans.length} 个套餐、${usable} 个定向链接`);
});
