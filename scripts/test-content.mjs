/**
 * Content integrity checks.
 *
 * Three classes of problem, all of which render as a plausible-looking page
 * rather than an error:
 *
 *   1. **Duplicate or mismatched slugs.** Two files claiming the same slug
 *      silently shadow each other; a slug that does not match its filename
 *      produces a URL nobody can predict from the file tree.
 *   2. **Empty required fields.** A blank summary renders as an empty block.
 *      Zod accepts `""` because it is a string, so it has to be caught here.
 *   3. **Dangling references.** A plan pointing at a datacenter slug that does
 *      not exist loses its cross-links and its place in the link graph, with no
 *      visible symptom.
 *
 * This checks the *content*. `test:keystatic` checks the *field definitions*.
 */

import { withProject, heading, ok, fail, detail, finish, paint } from './lib/project.mjs';

const problems = [];

/** Every relation on the site, as `[collection, path, targetCollection]`. */
const RELATIONS = [
  ['plans', 'network.line', 'lines'],
  ['plans', 'network.datacenters', 'datacenters'],
  ['plans', 'useCases', 'scenarios'],
  ['plans', 'relatedPlans', 'plans'],
  ['plans', 'relatedTutorials', 'tutorials'],
  ['datacenters', 'line', 'lines'],
  ['datacenters', 'migratableTargets', 'datacenters'],
  ['lines', 'availableDatacenters', 'datacenters'],
  ['lines', 'comparedWith.slug', 'lines'],
  ['scenarios', 'recommendedPlans', 'plans'],
  ['scenarios', 'recommendedDatacenters', 'datacenters'],
  ['scenarios', 'guide', 'guides'],
  ['guides', 'recommendedPlans', 'plans'],
  ['guides', 'relatedGuides', 'guides'],
  ['guides', 'relatedCompare', 'compare'],
  ['compare', 'relatedPlans', 'plans'],
  ['tutorials', 'relatedTutorials', 'tutorials'],
  ['tutorials', 'relatedPlans', 'plans'],
  ['benchmarks', 'relatedPlans', 'plans'],
  ['glossary', 'related', 'glossary'],
  ['deals', 'appliesToPlans', 'plans'],
  ['posts', 'relatedPlans', 'plans'],
];

function readPath(object, path) {
  return path.split('.').reduce((value, key) => (value == null ? value : value[key]), object);
}

await withProject(async ({ cms }) => {
  const collections = {
    plans: cms.getPlans(),
    datacenters: cms.getDatacenters(),
    lines: cms.getLines(),
    scenarios: cms.getScenarios(),
    guides: cms.getGuides(),
    compare: cms.getCompares(),
    tutorials: cms.getTutorials(),
    benchmarks: cms.getBenchmarks(),
    glossary: cms.getGlossary(),
    deals: cms.getDeals(),
    posts: cms.getPosts(),
    faqs: cms.getFaqs(),
  };

  const slugSets = {};
  for (const [name, items] of Object.entries(collections)) {
    slugSets[name] = new Set(items.map((item) => item.slug));
  }

  /* --- 1. slugs --------------------------------------------------------- */

  heading('Slug 唯一性与命名');
  for (const [name, items] of Object.entries(collections)) {
    const seen = new Map();
    for (const item of items) {
      if (seen.has(item.slug)) {
        problems.push(`${name}: slug 重复 "${item.slug}"`);
        fail(`${name}: slug 重复 "${item.slug}"`);
      }
      seen.set(item.slug, item);
    }

    const bad = items.filter((item) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug));
    if (bad.length > 0) {
      problems.push(`${name}: slug 命名不合规 → ${bad.map((item) => item.slug).join(', ')}`);
      fail(`${name}: slug 命名不合规 → ${bad.map((item) => item.slug).join(', ')}`);
    }
  }
  if (problems.length === 0) {
    ok(`${Object.keys(collections).length} 个集合的 slug 均唯一且命名合规`);
  }

  /* --- 2. required text ------------------------------------------------- */

  heading('必填文本非空');

  /** Fields that must carry real text. A blank one renders as an empty block. */
  const REQUIRED_TEXT = {
    plans: ['name', 'tagline', 'summary'],
    datacenters: ['name', 'code', 'country', 'city', 'line', 'summary'],
    lines: ['name', 'abbr', 'summary', 'definition'],
    scenarios: ['name', 'question', 'summary'],
    guides: ['title', 'summary', 'verdict'],
    compare: ['title', 'summary', 'verdict'],
    tutorials: ['title', 'summary'],
    benchmarks: ['title', 'summary', 'method', 'tool'],
    glossary: ['term', 'shortDef'],
    deals: ['title', 'discount', 'summary'],
    posts: ['title', 'summary'],
    faqs: ['question', 'answer'],
  };

  let blankCount = 0;
  for (const [name, fields] of Object.entries(REQUIRED_TEXT)) {
    for (const item of collections[name]) {
      for (const field of fields) {
        const value = readPath(item, field);
        if (typeof value !== 'string' || value.trim() === '') {
          problems.push(`${name}/${item.slug}: 字段 "${field}" 为空`);
          fail(`${name}/${item.slug}: 字段 "${field}" 为空`);
          blankCount += 1;
        }
      }
    }
  }

  /** Dates that drive freshness must parse, or the stamp silently reads "未标注". */
  for (const plan of collections.plans) {
    if (!plan.pricing.priceCheckedAt) {
      problems.push(`plans/${plan.slug}: 缺少 priceCheckedAt`);
      fail(`plans/${plan.slug}: 缺少 priceCheckedAt`);
      blankCount += 1;
    }
    if (plan.pricing.cycles.length === 0) {
      problems.push(`plans/${plan.slug}: 没有任何计费周期`);
      fail(`plans/${plan.slug}: 没有任何计费周期`);
      blankCount += 1;
    }
  }

  for (const deal of collections.deals) {
    if (!deal.verifiedAt) {
      problems.push(`deals/${deal.slug}: 缺少 verifiedAt（优惠条目必须标注核实日期）`);
      fail(`deals/${deal.slug}: 缺少 verifiedAt`);
      blankCount += 1;
    }
  }

  if (blankCount === 0) ok('必填文本与关键日期均有值');

  /* --- 3. relations ----------------------------------------------------- */

  heading('关联 slug 有效性');
  let dangling = 0;

  for (const [collection, path, target] of RELATIONS) {
    for (const item of collections[collection]) {
      const value = readPath(item, path);
      const refs = value == null ? [] : Array.isArray(value) ? value : [value];
      for (const ref of refs) {
        if (typeof ref !== 'string' || ref === '') continue;
        if (!slugSets[target].has(ref)) {
          problems.push(`${collection}/${item.slug}: ${path} 指向不存在的 ${target} "${ref}"`);
          fail(`${collection}/${item.slug}: ${path} → ${target} "${ref}" 不存在`);
          dangling += 1;
        }
      }
    }
  }

  /** Compare subjects resolve against the collection named by their `type`. */
  const TYPE_TO_COLLECTION = {
    plan: 'plans',
    datacenter: 'datacenters',
    line: 'lines',
  };
  for (const item of collections.compare) {
    for (const side of ['left', 'right']) {
      const subject = item[side];
      const collection = TYPE_TO_COLLECTION[subject.type];
      if (!collection) continue; // `brand` has no page of its own.
      if (subject.slug && !slugSets[collection].has(subject.slug)) {
        problems.push(`compare/${item.slug}: ${side} 指向不存在的 ${collection} "${subject.slug}"`);
        fail(`compare/${item.slug}: ${side} → ${collection} "${subject.slug}" 不存在`);
        dangling += 1;
      }
    }
  }

  /** Benchmark targets are polymorphic, so they need their own check. */
  for (const item of collections.benchmarks) {
    const collection = item.target.type === 'plan' ? 'plans' : 'datacenters';
    if (!slugSets[collection].has(item.target.slug)) {
      problems.push(`benchmarks/${item.slug}: 测试对象 ${item.target.slug} 不存在`);
      fail(`benchmarks/${item.slug}: 测试对象 ${item.target.slug} 不存在`);
      dangling += 1;
    }
  }

  /** The FAQ pool attaches to entities; a stale slug silently unhooks it. */
  const FAQ_KINDS = ['plans', 'datacenters', 'lines', 'tutorials', 'glossary', 'deals'];
  for (const faq of collections.faqs) {
    for (const kind of FAQ_KINDS) {
      for (const ref of faq.related?.[kind] ?? []) {
        if (!slugSets[kind].has(ref)) {
          problems.push(`faqs/${faq.slug}: related.${kind} 指向不存在的 "${ref}"`);
          fail(`faqs/${faq.slug}: related.${kind} → "${ref}" 不存在`);
          dangling += 1;
        }
      }
    }
  }

  /** Homepage and other singleton lists reference collections too. */
  const singletons = [
    ['home.featuredPlans', cms.HOME.featuredPlans, 'plans'],
    ['home.featuredGuides', cms.HOME.featuredGuides, 'guides'],
    ['home.featuredTutorials', cms.HOME.featuredTutorials, 'tutorials'],
  ];
  for (const [label, refs, target] of singletons) {
    for (const ref of refs) {
      if (!slugSets[target].has(ref)) {
        problems.push(`${label} 指向不存在的 ${target} "${ref}"`);
        fail(`${label} → ${target} "${ref}" 不存在`);
        dangling += 1;
      }
    }
  }

  if (dangling === 0) ok('全部关联 slug 均可解析');

  /* --- 4. affiliate pid format ------------------------------------------ */

  heading('推广产品编号格式');
  let badPid = 0;
  for (const plan of collections.plans) {
    const pid = plan.affiliate.pid ?? '';
    if (pid !== '' && !/^\d+$/.test(pid)) {
      problems.push(`plans/${plan.slug}: pid "${pid}" 不是纯数字`);
      fail(`plans/${plan.slug}: pid "${pid}" 不是纯数字`);
      badPid += 1;
    }
  }

  const unverified = collections.plans.filter((plan) => !plan.affiliate.verified);
  if (badPid === 0) {
    ok(`${collections.plans.length} 个套餐的 pid 格式合规`);
  }
  if (unverified.length > 0) {
    console.log(
      `  ${paint.yellow('!')} ${unverified.length} 个套餐尚未人工验证 pid：` +
        paint.dim(unverified.map((plan) => plan.slug).join(', ')),
    );
    console.log(
      `    ${paint.dim('这不影响构建。上线前需要逐个打开链接确认落到正确套餐，然后勾选「已人工验证」。')}`,
    );
  }

  /* --- 5. counts -------------------------------------------------------- */

  heading('内容规模');
  for (const [name, items] of Object.entries(collections)) {
    detail(`${name}: ${items.length}`);
  }

  finish(problems, `内容检查通过：${Object.values(collections).flat().length} 个条目，无问题`);
});
