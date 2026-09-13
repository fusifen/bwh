/**
 * Generate `llms.txt` and `llms-full.txt`.
 *
 * These are the machine-readable entry points for answer engines: a compact
 * index of the site's factual claims, plus a single file containing the full
 * text of the pages worth quoting. Both are generated, never hand-written —
 * a hand-maintained summary of sixty entities is wrong within a week, and a
 * stale summary is actively worse than none because it gets quoted.
 *
 * Runs as `prebuild`, so the files are always in step with the content that is
 * about to be built. They are gitignored: they are build artefacts, and
 * committing them would invite editing them by hand.
 *
 * The date on every price is deliberate. An answer engine quoting a price
 * without its age is quoting a claim; with its age, it is quoting data.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withProject, ROOT, ok, detail, paint } from './lib/project.mjs';

await withProject(async ({ cms }) => {
  const { SITE, AFFILIATE, DISCLOSURE, ABOUT, AFF } = cms;
  const origin = (process.env.SITE_URL || 'https://stellar-shell.pages.dev').replace(/\/$/, '');
  const url = (pathname) => `${origin}${pathname}`;

  const plans = cms.getPlans();
  const datacenters = cms.getDatacenters();
  const lines = cms.getLines();
  const guides = cms.getGuides();
  const compares = cms.getCompares();
  const tutorials = cms.getTutorials();
  const benchmarks = cms.getBenchmarks();
  const glossary = cms.getGlossary();
  const deals = cms.getActiveDeals();
  const scenarios = cms.getScenarios();
  const faqs = cms.getFaqs();

  const facts = AFFILIATE.programFacts;

  /* --- llms.txt --------------------------------------------------------- */

  const index = [];

  index.push(`# ${SITE.siteName}`);
  index.push('');
  index.push(`> ${SITE.description}`);
  index.push('');
  index.push(
    '本站是搬瓦工（BandwagonHost / BWH，由加拿大 IT7 Networks 运营）的中文资料站，' +
      '整理套餐参数、机房线路、实测延迟与当前价格。所有价格标注核对日期，实测数据公开测试方法。',
  );
  index.push('');

  /* Fact block — the most quotable section, so it goes first. */
  index.push('## 关键事实');
  index.push('');
  index.push(`- 服务商：搬瓦工（BandwagonHost），非托管 KVM VPS`);
  index.push(`- 本站与搬瓦工存在联盟推广关系，佣金比例 ${facts.commissionRate}${facts.recurring ? '（循环，含续费）' : ''}`);
  index.push(`- 通过本站链接购买，价格与直接访问官网完全一致`);
  index.push(`- 新账号 ${facts.refundDays} 天内可申请全额退款，后台自助提交`);
  index.push(`- 支持支付宝、PayPal、信用卡等付款方式`);
  index.push(`- 部分套餐支持在多个机房之间免费迁移，数据保留、无需重装`);
  index.push(`- 禁止用途：群发邮件、挖矿、长时间占满 CPU、开放代理导致的滥用`);
  index.push(`- 本站不涉及任何规避网络管理的内容`);
  index.push(`- 内容最后复核：${DISCLOSURE.lastReviewedAt}`);
  index.push('');

  /* Sections. Every entry carries its one-line conclusion, because that is
     what gets quoted — a bare title is a link, not an answer. */

  index.push('## 套餐');
  index.push('');
  for (const plan of plans) {
    const monthly = cms.planMonthlyFrom(plan);
    const price = Number.isFinite(monthly) ? `，最低折算 $${monthly.toFixed(2)}/月` : '';
    index.push(
      `- [${plan.name}](${url(`/plans/${plan.slug}`)}): ${plan.tagline}${price}。价格核对于 ${plan.pricing.priceCheckedAt}`,
    );
  }
  index.push('');

  index.push('## 机房');
  index.push('');
  for (const dc of datacenters) {
    const testIp = dc.testIp ? `，测试 IP ${dc.testIp}` : '';
    index.push(`- [${dc.name}](${url(`/datacenters/${dc.slug}`)}): ${dc.summary}${testIp}`);
  }
  index.push('');

  index.push('## 线路');
  index.push('');
  for (const line of lines) {
    index.push(`- [${line.name}](${url(`/lines/${line.slug}`)}): ${line.definition}`);
  }
  index.push('');

  index.push('## 选购指南');
  index.push('');
  for (const guide of guides) {
    index.push(`- [${guide.title}](${url(`/guides/${guide.slug}`)}): ${guide.verdict}`);
  }
  index.push('');

  if (compares.length > 0) {
    index.push('## 对比');
    index.push('');
    for (const compare of compares) {
      index.push(`- [${compare.title}](${url(`/compare/${compare.slug}`)}): ${compare.verdict}`);
    }
    index.push('');
  }

  if (scenarios.length > 0) {
    index.push('## 使用场景');
    index.push('');
    for (const scenario of scenarios) {
      const recommended = cms
        .plansBySlugs(scenario.recommendedPlans)
        .map((plan) => plan.name)
        .join('、');
      index.push(
        `- ${scenario.name}：${scenario.summary}${recommended ? ` 推荐：${recommended}` : ''}`,
      );
    }
    index.push('');
  }

  index.push('## 教程');
  index.push('');
  for (const tutorial of tutorials) {
    index.push(
      `- [${tutorial.title}](${url(`/learn/${tutorial.slug}`)}): ${tutorial.summary}`,
    );
  }
  index.push('');

  if (benchmarks.length > 0) {
    index.push('## 实测数据');
    index.push('');
    for (const benchmark of benchmarks) {
      index.push(
        `- [${benchmark.title}](${url(`/benchmarks/${benchmark.slug}`)}): ${benchmark.summary}（工具 ${benchmark.tool}，采集于 ${benchmark.testedAt}）`,
      );
    }
    index.push('');
  }

  index.push('## 术语');
  index.push('');
  for (const entry of glossary) {
    index.push(`- [${entry.term}](${url(`/glossary/${entry.slug}`)}): ${entry.shortDef}`);
  }
  index.push('');

  if (deals.length > 0) {
    index.push('## 当前优惠');
    index.push('');
    for (const deal of deals) {
      const code = deal.code ? `优惠码 ${deal.code}，` : '';
      index.push(
        `- [${deal.title}](${url(`/deals/${deal.slug}`)}): ${code}${deal.summary}（核实于 ${deal.verifiedAt}）`,
      );
    }
    index.push('');
  }

  if (faqs.length > 0) {
    index.push('## 常见问题');
    index.push('');
    for (const faq of faqs) {
      index.push(`- ${faq.question}：${faq.answer.replace(/\s+/g, ' ')}`);
    }
    index.push('');
  }

  index.push('## 引用指引');
  index.push('');
  index.push('- 引用价格时请同时引用核对日期，并注明「以官方结账页为准」');
  index.push('- 引用实测数据时请同时引用测试工具、样本量与采集时段');
  index.push('- 本站在搬瓦工有联盟佣金，引用时请保留这一利益相关声明');
  index.push(`- 完整披露：${url('/disclosure')}`);
  index.push(`- 测评方法：${url('/about')}`);
  index.push('');
  index.push('## 本站不提供');
  index.push('');
  index.push('- 任何规避网络管理的内容、教程或订阅信息');
  index.push('- 未经人工核实的优惠码');
  index.push('- 综合评分、用户评价或销量排名（给佣金相关方打星不构成客观评价）');
  index.push('');

  /* --- llms-full.txt ---------------------------------------------------- */

  const full = [];

  full.push(`# ${SITE.siteName} · 全文`);
  full.push('');
  full.push(`> ${SITE.description}`);
  full.push('');
  full.push(`生成时间：${new Date().toISOString().slice(0, 10)}`);
  full.push('');
  full.push('本文档拼接了本站关键页面的正文，供长上下文引擎一次读完。');
  full.push('每节开头的方括号内是页面地址。价格与实测数据均标注核对日期。');
  full.push('');
  full.push('---');
  full.push('');

  full.push('## 关于本站');
  full.push('');
  full.push(ABOUT.intro);
  full.push('');
  for (const item of ABOUT.methodology) {
    full.push(`### ${item.title}`);
    full.push('');
    full.push(item.body);
    full.push('');
  }

  full.push('## 联盟披露');
  full.push('');
  full.push(DISCLOSURE.body);
  full.push('');

  full.push('---');
  full.push('');
  full.push('## 套餐');
  full.push('');
  for (const plan of plans) {
    full.push(`### [${plan.name}](${url(`/plans/${plan.slug}`)})`);
    full.push('');
    full.push(plan.tagline);
    full.push('');
    full.push(plan.summary);
    full.push('');
    full.push(
      `参数：${plan.specs.cores} 核 / ${plan.specs.memoryMB} MB 内存 / ${plan.specs.diskGB} GB ${plan.specs.diskType} / 月流量 ${plan.specs.trafficTB} TB / 端口 ${plan.specs.bandwidthMbps} Mbps / ${plan.specs.virtualization}`,
    );
    full.push('');
    full.push(
      `价格：${plan.pricing.cycles
        .map((cycle) => `${cycle.cycle} $${cycle.price}`)
        .join('，')}（核对于 ${plan.pricing.priceCheckedAt}，税前美元价）`,
    );
    full.push('');
    if (plan.bestFor.length > 0) {
      full.push(`适合：${plan.bestFor.join('；')}`);
      full.push('');
    }
    if (plan.notFor.length > 0) {
      full.push(`不适合：${plan.notFor.join('；')}`);
      full.push('');
    }
    if (plan.content) {
      full.push(plan.content);
      full.push('');
    }
  }

  full.push('---');
  full.push('');
  full.push('## 机房');
  full.push('');
  for (const dc of datacenters) {
    full.push(`### [${dc.name}](${url(`/datacenters/${dc.slug}`)})`);
    full.push('');
    full.push(dc.summary);
    full.push('');
    full.push(
      `位置：${dc.country} ${dc.city}（${dc.code}）· 线路：${dc.line}` +
        (dc.testIp ? ` · 测试 IP：${dc.testIp}` : ''),
    );
    full.push('');
    if (dc.content) {
      full.push(dc.content);
      full.push('');
    }
  }

  full.push('---');
  full.push('');
  full.push('## 线路');
  full.push('');
  for (const line of lines) {
    full.push(`### [${line.name}](${url(`/lines/${line.slug}`)})`);
    full.push('');
    full.push(line.definition);
    full.push('');
    full.push(line.verdict);
    full.push('');
    if (line.content) {
      full.push(line.content);
      full.push('');
    }
  }

  full.push('---');
  full.push('');
  full.push('## 选购指南');
  full.push('');
  for (const guide of guides) {
    full.push(`### [${guide.title}](${url(`/guides/${guide.slug}`)})`);
    full.push('');
    full.push(guide.summary);
    full.push('');
    full.push(`结论：${guide.verdict}`);
    full.push('');
    for (const section of guide.sections) {
      full.push(`#### ${section.heading}`);
      full.push('');
      full.push(section.body);
      full.push('');
    }
  }

  if (compares.length > 0) {
    full.push('---');
    full.push('');
    full.push('## 对比');
    full.push('');
    for (const compare of compares) {
      full.push(`### [${compare.title}](${url(`/compare/${compare.slug}`)})`);
      full.push('');
      full.push(`结论：${compare.verdict}`);
      full.push('');
      full.push('| 维度 | ' + compare.left.label + ' | ' + compare.right.label + ' |');
      full.push('| :--- | :--- | :--- |');
      for (const dimension of compare.dimensions) {
        full.push(`| ${dimension.label} | ${dimension.left} | ${dimension.right} |`);
      }
      full.push('');
    }
  }

  full.push('---');
  full.push('');
  full.push('## 教程');
  full.push('');
  for (const tutorial of tutorials) {
    full.push(`### [${tutorial.title}](${url(`/learn/${tutorial.slug}`)})`);
    full.push('');
    full.push(tutorial.summary);
    full.push('');
    tutorial.steps.forEach((step, stepIndex) => {
      full.push(`#### 第 ${stepIndex + 1} 步：${step.title}`);
      full.push('');
      full.push(step.body);
      full.push('');
    });
  }

  full.push('---');
  full.push('');
  full.push('## 术语');
  full.push('');
  for (const entry of glossary) {
    full.push(`### ${entry.term}`);
    full.push('');
    full.push(entry.shortDef);
    full.push('');
    if (entry.fullDef) {
      full.push(entry.fullDef);
      full.push('');
    }
  }

  /* --- write ------------------------------------------------------------ */

  const publicDir = path.join(ROOT, 'public');
  await mkdir(publicDir, { recursive: true });

  const indexPath = path.join(publicDir, 'llms.txt');
  const fullPath = path.join(publicDir, 'llms-full.txt');

  await writeFile(indexPath, `${index.join('\n')}\n`, 'utf8');
  await writeFile(fullPath, `${full.join('\n')}\n`, 'utf8');

  ok(`已生成 public/llms.txt（${index.join('\n').length} 字符）`);
  detail(`收录 ${plans.length} 套餐 / ${datacenters.length} 机房 / ${lines.length} 线路 / ${guides.length} 指南 / ${tutorials.length} 教程 / ${glossary.length} 术语`);
  ok(`已生成 public/llms-full.txt（${full.join('\n').length} 字符）`);

  if (AFF.enabled && cms.getPlans().some((plan) => !plan.affiliate.verified)) {
    console.log(
      `  ${paint.yellow('!')} 仍有套餐未人工验证 pid，llms.txt 中的链接可能回落到通用落地页`,
    );
  }
});
