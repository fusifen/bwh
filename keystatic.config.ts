/**
 * Keystatic admin configuration.
 *
 * This file defines the editing UI. It is the *other half* of the content
 * contract: `src/lib/schemas.ts` decides what the build accepts, and this file
 * decides what an editor can type. They must agree exactly.
 *
 * Why that matters, and why `npm run test:keystatic` exists
 * --------------------------------------------------------
 * The build only ever walks the Zod path. If a field exists here but not in
 * `schemas.ts`, Zod strips it silently and the admin shows an input whose value
 * goes nowhere — a blank section on the live site with no error anywhere. If a
 * field exists in `schemas.ts` but not here, the build demands a value nobody
 * can enter. Neither failure is visible from `npm run build`, which is exactly
 * why the check is a separate script rather than a hope.
 *
 * Enum options are imported from `schemas.ts` rather than retyped. A select
 * whose options drifted from the Zod enum would produce content that fails the
 * build — so the options are derived from the same array the validator uses.
 *
 * `storage: 'local'` writes straight into `src/content/**` on disk and the
 * admin is only reachable from `npm run dev`. Nothing is exposed in production.
 * Switching to the GitHub storage mode later is a change to this block only.
 */

import { config, fields, collection, singleton } from '@keystatic/core';

import {
  BILLING_CYCLES,
  COMPARE_SUBJECT_TYPES,
  COMPARE_WINNERS,
  DEAL_KINDS,
  DEAL_STATUSES,
  DIFFICULTIES,
  GUIDE_INTENTS,
  PAYMENT_METHODS,
  PLAN_SERIES,
  PLAN_STATUSES,
  PLAN_TIERS,
  TUTORIAL_CATEGORIES,
} from './src/lib/schemas';

/* -----------------------------------------------------------------------------
   Shared field builders
   -------------------------------------------------------------------------- */

/**
 * A select whose options come straight from the Zod enum, so the two can never
 * disagree about which values are legal.
 *
 * `defaultValue` is required by Keystatic's `select` type, so it falls back to
 * the first enum member. That is also the right behaviour: the first value in
 * each enum is the most common case (see the ordering comments in schemas.ts),
 * and a select with no default would leave new entries with an empty field that
 * Zod then rejects.
 */
function enumSelect(
  label: string,
  values: readonly string[],
  labels: Record<string, string>,
  defaultValue?: string,
  description?: string,
) {
  return fields.select({
    label,
    description,
    options: values.map((value) => ({ label: labels[value] ?? value, value })),
    defaultValue: defaultValue ?? values[0]!,
  });
}

const SERIES_LABELS: Record<string, string> = {
  basic: '基础 VPS（Basic）',
  'cn2-gt': 'CN2 GT',
  'cn2-gia': 'CN2 GIA',
  'cn2-gia-e': 'CN2 GIA-E',
  ecommerce: 'E-Commerce',
  ultra: 'Ultra',
  hongkong: '香港机房（HKHK）',
  tokyo: '东京机房（JPTYO）',
  osaka: '大阪机房（JPOSA）',
  singapore: '新加坡机房',
  dubai: '迪拜机房',
  limited: '限量特价（Limited）',
};

const TIER_LABELS: Record<string, string> = {
  entry: '入门',
  mainstream: '主流',
  pro: '进阶',
  enterprise: '企业',
};

const STATUS_LABELS: Record<string, string> = {
  available: '在售',
  'out-of-stock': '已售罄（保留页面）',
  discontinued: '已下架（保留页面）',
  limited: '限量供应',
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: '月付',
  quarterly: '季付',
  semiannual: '半年付',
  annual: '年付',
};

const PAYMENT_LABELS: Record<string, string> = {
  alipay: '支付宝',
  paypal: 'PayPal',
  creditcard: '信用卡',
  unionpay: '银联',
  crypto: '加密货币',
};

const TUTORIAL_CATEGORY_LABELS: Record<string, string> = {
  purchase: '购买与注册',
  kiwivm: 'KiwiVM 面板',
  network: '网络与线路',
  os: '系统与重装',
  deploy: '部署与应用',
  security: '安全加固',
  billing: '计费与续费',
  troubleshoot: '故障排查',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '较难',
};

const DEAL_KIND_LABELS: Record<string, string> = {
  coupon: '优惠码',
  event: '限时活动',
  'limited-stock': '限量库存',
};

const DEAL_STATUS_LABELS: Record<string, string> = {
  active: '进行中',
  expired: '已结束',
  upcoming: '即将开始',
};

const GUIDE_INTENT_LABELS: Record<string, string> = {
  beginner: '新手入门',
  website: '建站',
  'cross-border': '跨境业务',
  developer: '开发测试',
  team: '团队采购',
  budget: '预算有限',
};

const COMPARE_TYPE_LABELS: Record<string, string> = {
  plan: '套餐',
  datacenter: '机房',
  line: '线路',
  brand: '服务商',
};

const COMPARE_WINNER_LABELS: Record<string, string> = {
  left: '左侧更优',
  right: '右侧更优',
  tie: '各有取舍',
};

/* --- Reusable composite fields ------------------------------------------- */

/** `updatedAt` / `publishedAt` / `order`, present on every collection. */
const auditFields = {
  publishedAt: fields.date({
    label: '发布日期',
    description: '留空表示沿用更新日期。',
    validation: { isRequired: false },
  }),
  updatedAt: fields.date({
    label: '最后更新日期',
    description: '内容实质变动时更新这一项，页面上的「更新于」和 sitemap 的 lastmod 都读它。',
  }),
  order: fields.integer({
    label: '排序',
    description: '数字越小越靠前。相同数字时按名称排序，不要依赖文件名。',
    defaultValue: 0,
  }),
};

const seoField = fields.object(
  {
    title: fields.text({
      label: 'SEO 标题',
      description: '留空则使用页面自身的标题。建议 30 字以内，包含核心关键词。',
      validation: { isRequired: false },
    }),
    description: fields.text({
      label: 'SEO 描述',
      description: '留空则使用摘要。建议 80–155 字，写清这页能回答什么问题。',
      multiline: true,
      validation: { isRequired: false },
    }),
    keywords: fields.array(fields.text({ label: '关键词' }), {
      label: '关键词',
      description: '每行一个。不需要堆砌，写用户真实会搜的说法。',
    }),
    noindex: fields.checkbox({
      label: '不参与索引',
      description: '仅在页面不应出现在搜索结果中时勾选。',
      defaultValue: false,
    }),
  },
  { label: 'SEO 覆盖', description: '全部可留空，布局层有兜底值。' },
);

/** Inline question/answer pairs, for the FAQPage block on an entity page. */
const faqItemsField = fields.array(
  fields.object({
    question: fields.text({ label: '问题' }),
    answer: fields.text({ label: '答案', multiline: true }),
  }),
  {
    label: '内嵌问答',
    description: '与「问答」集合的区别：这里的问题只服务本页，不会被其他页面复用。',
  },
);

/* -----------------------------------------------------------------------------
   Collections
   -------------------------------------------------------------------------- */

const plans = collection({
  label: '套餐',
  path: 'src/content/plans/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['name', 'series', 'tier'],
  schema: {
    slug: fields.slug({
      name: {
        label: '用于生成网址的标题',
        description: '只在新建条目时用来生成网址。网址一经发布不要修改，改名一律走 301。',
      },
    }),
    name: fields.text({ label: '套餐名称' }),
    series: enumSelect('系列', PLAN_SERIES, SERIES_LABELS, 'basic'),
    tier: enumSelect('档位', PLAN_TIERS, TIER_LABELS, 'mainstream'),
    status: enumSelect(
      '状态',
      PLAN_STATUSES,
      STATUS_LABELS,
      'available',
      '售罄或下架时不要删除页面，改状态并补充替代建议。',
    ),
    tagline: fields.text({
      label: '一句话卖点',
      description: '出现在标题下方，一句话说清这个套餐存在的理由。',
    }),
    summary: fields.text({
      label: '结论摘要（TL;DR）',
      description: '前 60 字必须给出结论。这一段同时服务读者和生成式引擎，不要铺垫。',
      multiline: true,
    }),
    bestFor: fields.array(fields.text({ label: '适合' }), { label: '适合谁' }),
    notFor: fields.array(fields.text({ label: '不适合' }), {
      label: '不适合谁',
      description: '必填项。只讲优点的推荐没有价值；退款会让佣金被扣回，劝退反而是增收。',
    }),

    specs: fields.object(
      {
        cpu: fields.text({ label: 'CPU 型号' }),
        cores: fields.integer({ label: 'CPU 核心数', validation: { min: 1 } }),
        memoryMB: fields.integer({ label: '内存（MB）', validation: { min: 1 } }),
        diskGB: fields.integer({ label: '硬盘（GB）', validation: { min: 1 } }),
        diskType: fields.text({ label: '硬盘类型', defaultValue: 'SSD' }),
        trafficTB: fields.number({ label: '月流量（TB）', validation: { min: 0 } }),
        bandwidthMbps: fields.integer({ label: '端口带宽（Mbps）', validation: { min: 1 } }),
        ipv4: fields.integer({ label: '独立 IPv4 数量', defaultValue: 1, validation: { min: 0 } }),
        ipv6: fields.checkbox({ label: '支持 IPv6', defaultValue: true }),
        virtualization: fields.text({ label: '虚拟化方式', defaultValue: 'KVM' }),
        raid: fields.text({
          label: '磁盘阵列',
          description: '留空则不显示。例如 RAID-10。',
          validation: { isRequired: false },
        }),
      },
      { label: '硬件参数', description: '逐项对照官网录入。官网改版后要重新核对。' },
    ),

    network: fields.object(
      {
        line: fields.text({
          label: '线路 slug',
          description: '必须与「线路」集合中的某个 slug 完全一致，否则线路页面不会关联。',
        }),
        datacenters: fields.array(fields.text({ label: '机房 slug' }), {
          label: '可用机房',
          description: '每行一个机房 slug，需与「机房」集合中的 slug 一致。',
        }),
        migratable: fields.checkbox({ label: '支持迁移机房', defaultValue: false }),
        migratableCount: fields.integer({
          label: '可选机房数量',
          description: '支持迁移时填写，用于「十几个机房免费切换」这类表述。',
          defaultValue: 0,
          validation: { min: 0 },
        }),
      },
      { label: '网络' },
    ),

    pricing: fields.object(
      {
        currency: fields.text({ label: '货币', defaultValue: 'USD' }),
        cycles: fields.array(
          fields.object({
            cycle: enumSelect('计费周期', BILLING_CYCLES, CYCLE_LABELS, 'annual'),
            price: fields.number({ label: '价格', validation: { min: 0 } }),
            listPrice: fields.number({
              label: '原价',
              description: '有折扣时填写，页面上会显示为划线价。留空则不显示。',
              validation: { isRequired: false, min: 0 },
            }),
            note: fields.text({
              label: '备注',
              description: '例如「折算约 $14.17/月」。',
              validation: { isRequired: false },
            }),
          }),
          { label: '计费周期与价格', description: '至少填写一个周期。' },
        ),
        couponCode: fields.text({
          label: '可用优惠码',
          description: '只在人工核实有效时填写。留空则不显示。',
          validation: { isRequired: false },
        }),
        couponDiscount: fields.text({
          label: '优惠幅度',
          validation: { isRequired: false },
        }),
        paymentMethods: fields.multiselect({
          label: '付款方式',
          options: PAYMENT_METHODS.map((value) => ({
            label: PAYMENT_LABELS[value] ?? value,
            value,
          })),
        }),
        priceCheckedAt: fields.date({
          label: '价格核对日期',
          description: '每次人工核对价格后更新。超过 30 天页面会提示，超过 60 天构建会告警。',
        }),
        refundDays: fields.integer({
          label: '退款天数',
          defaultValue: 30,
          validation: { min: 0 },
        }),
      },
      { label: '价格', description: '价格绝不写进正文，全部走这里。' },
    ),

    affiliate: fields.object(
      {
        pid: fields.text({
          label: '推广产品编号（pid）',
          description:
            '★ 上线前唯一必须人工核对的字段。从搬瓦工后台 Affiliates 页面逐个复制。留空或填 0 时链接会落到通用页面，不会跳错套餐。',
        }),
        verified: fields.checkbox({
          label: '已人工验证',
          description: '亲自打开生成的链接，确认落到正确的套餐购买页之后再勾选。',
          defaultValue: false,
        }),
        note: fields.text({ label: '备注', validation: { isRequired: false } }),
      },
      { label: '联盟推广' },
    ),

    scores: fields.object(
      {
        performance: fields.number({ label: '性能', validation: { min: 1, max: 5 } }),
        value: fields.number({ label: '性价比', validation: { min: 1, max: 5 } }),
        stability: fields.number({ label: '稳定性', validation: { min: 1, max: 5 } }),
        latencyCN: fields.number({ label: '国内延迟', validation: { min: 1, max: 5 } }),
      },
      {
        label: '编辑评分',
        description: '1–5 分，仅用于站内横向比较，不会作为评分类结构化数据提交。',
      },
    ),

    pros: fields.array(fields.text({ label: '优点' }), { label: '优点' }),
    cons: fields.array(fields.text({ label: '缺点' }), { label: '缺点与限制' }),

    content: fields.text({
      label: '详细说明',
      description: 'Markdown。可用 ## 标题、列表、表格、引用与代码块。',
      multiline: true,
    }),

    useCases: fields.array(fields.text({ label: '场景 slug' }), {
      label: '适用场景',
      description: '每行一个场景 slug，需与「场景」集合一致。用于选择器与场景页的推荐。',
    }),
    relatedPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '相关套餐' }),
    relatedTutorials: fields.array(fields.text({ label: '教程 slug' }), { label: '相关教程' }),

    faqs: faqItemsField,
    seo: seoField,
    featured: fields.checkbox({
      label: '在首页推荐',
      description: '首页推荐位优先读这里；一个都没勾选时回落到前几个套餐。',
      defaultValue: false,
    }),

    ...auditFields,
  },
});

const datacenters = collection({
  label: '机房',
  path: 'src/content/datacenters/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['name', 'code', 'country'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    name: fields.text({ label: '机房名称' }),
    code: fields.text({
      label: '机房代码',
      description: '搬瓦工内部的机房代号，例如 DC6、DC9、USCA_9。页面上以等宽标签展示。',
    }),
    country: fields.text({ label: '国家或地区', description: '中国香港等地区请写全称。' }),
    city: fields.text({ label: '城市' }),
    line: fields.text({ label: '线路 slug', description: '需与「线路」集合中的 slug 一致。' }),

    network: fields.object(
      {
        telecom: fields.text({ label: '中国电信', validation: { isRequired: false } }),
        unicom: fields.text({ label: '中国联通', validation: { isRequired: false } }),
        mobile: fields.text({ label: '中国移动', validation: { isRequired: false } }),
      },
      { label: '三网走向' },
    ),

    testIp: fields.text({
      label: '测试 IP',
      description: '★ 给出测试 IP 是最强的信任信号——读者可以自己复核，不必相信截图。',
      validation: { isRequired: false },
    }),
    testFileUrl: fields.text({
      label: '测试文件地址',
      validation: { isRequired: false },
    }),
    lookingGlass: fields.text({ label: 'Looking Glass', validation: { isRequired: false } }),

    latency: fields.array(
      fields.object({
        from: fields.text({ label: '测试点' }),
        min: fields.number({ label: '最小（ms）', validation: { min: 0 } }),
        avg: fields.number({ label: '平均（ms）', validation: { min: 0 } }),
        max: fields.number({ label: '最大（ms）', validation: { min: 0 } }),
        loss: fields.number({ label: '丢包率（%）', defaultValue: 0, validation: { min: 0 } }),
      }),
      {
        label: '实测延迟',
        description: '没有实测数据就留空——页面会显示「尚未实测」并给出测试 IP，不用估算值填充。',
      },
    ),
    latencyMeasuredAt: fields.date({
      label: '延迟采集日期',
      validation: { isRequired: false },
    }),
    latencyMethod: fields.text({
      label: '延迟测试方法',
      validation: { isRequired: false },
    }),

    summary: fields.text({ label: '结论摘要', multiline: true }),
    bestFor: fields.array(fields.text({ label: '适合' }), { label: '适合谁' }),
    notFor: fields.array(fields.text({ label: '不适合' }), { label: '不适合谁' }),
    pros: fields.array(fields.text({ label: '优点' }), { label: '优点' }),
    cons: fields.array(fields.text({ label: '缺点' }), { label: '缺点与限制' }),
    migratableTargets: fields.array(fields.text({ label: '机房 slug' }), {
      label: '可以迁移到',
    }),
    content: fields.text({ label: '详细说明', multiline: true }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const lines = collection({
  label: '线路',
  path: 'src/content/lines/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['name', 'abbr'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    name: fields.text({ label: '线路名称' }),
    abbr: fields.text({ label: '缩写' }),
    summary: fields.text({ label: '摘要', multiline: true }),
    definition: fields.text({
      label: '定义句',
      description:
        '★ 格式必须是「X 是指……」。这是全站最容易被生成式引擎原样引用的句式，所以单独成字段。',
      multiline: true,
    }),
    typicalLatency: fields.text({ label: '典型延迟', validation: { isRequired: false } }),
    typicalLoss: fields.text({ label: '典型丢包', validation: { isRequired: false } }),
    peakBehavior: fields.text({ label: '晚高峰表现', validation: { isRequired: false } }),
    pros: fields.array(fields.text({ label: '优点' }), { label: '优点' }),
    cons: fields.array(fields.text({ label: '缺点' }), { label: '缺点与限制' }),
    availableDatacenters: fields.array(fields.text({ label: '机房 slug' }), {
      label: '可用机房',
    }),
    comparedWith: fields.array(
      fields.object({
        slug: fields.text({
          label: '被混淆的线路 slug',
          description: '需与「线路」集合中的 slug 一致。',
        }),
        difference: fields.text({ label: '区别', multiline: true }),
      }),
      {
        label: '最常被混淆的线路',
        description: '把最容易搞混的那条写在这里，这是读者来到本页最常见的原因。',
      },
    ),
    verdict: fields.text({
      label: '值不值得付溢价',
      description: '直接回答，并写清在什么条件下不值得。',
      multiline: true,
    }),
    content: fields.text({ label: '详细说明', multiline: true }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const scenarios = collection({
  label: '场景',
  path: 'src/content/scenarios/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['name'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    name: fields.text({ label: '场景名称' }),
    icon: fields.text({ label: '图标名', defaultValue: 'server' }),
    question: fields.text({
      label: '这个场景对应的问题',
      description: '用第一人称写，会作为选择器的选项文案。',
    }),
    summary: fields.text({ label: '摘要', multiline: true }),
    painPoints: fields.array(fields.text({ label: '痛点' }), { label: '典型痛点' }),
    budgetHint: fields.text({ label: '常见预算', validation: { isRequired: false } }),
    technicalLevel: fields.text({ label: '技术水平', validation: { isRequired: false } }),
    recommendedPlans: fields.array(fields.text({ label: '套餐 slug' }), {
      label: '推荐套餐',
      description: '★ 按优先级排列，第一个是首选。顺序直接影响选择器的打分。',
    }),
    recommendedDatacenters: fields.array(fields.text({ label: '机房 slug' }), {
      label: '推荐机房',
    }),
    guide: fields.text({
      label: '对应指南 slug',
      validation: { isRequired: false },
    }),
    content: fields.text({ label: '详细说明', multiline: true }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const guides = collection({
  label: '选购指南',
  path: 'src/content/guides/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title', 'intent'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    intent: enumSelect('意图', GUIDE_INTENTS, GUIDE_INTENT_LABELS, 'beginner'),
    summary: fields.text({ label: '摘要', multiline: true }),
    verdict: fields.text({
      label: '结论',
      description: '★ 开头就给出答案，不要铺垫。生成式引擎引用的是这一句。',
      multiline: true,
    }),
    sections: fields.array(
      fields.object({
        heading: fields.text({ label: '小标题' }),
        body: fields.text({ label: '正文', multiline: true }),
      }),
      { label: '小节' },
    ),
    recommendedPlans: fields.array(fields.text({ label: '套餐 slug' }), {
      label: '推荐套餐',
      description: '★ 只推荐一到两个。推荐越多，等于没推荐。',
    }),
    checklist: fields.array(fields.text({ label: '检查项' }), { label: '购买前检查清单' }),
    relatedGuides: fields.array(fields.text({ label: '指南 slug' }), { label: '相关指南' }),
    relatedCompare: fields.array(fields.text({ label: '对比 slug' }), { label: '相关对比' }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const compare = collection({
  label: '对比',
  path: 'src/content/compare/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    summary: fields.text({ label: '摘要', multiline: true }),
    verdict: fields.text({
      label: '结论',
      description:
        '★ 必填。生成式引擎不会自己从表格里推出结论，但会原样引用你写好的结论。',
      multiline: true,
    }),
    left: fields.object(
      {
        type: enumSelect('类型', COMPARE_SUBJECT_TYPES, COMPARE_TYPE_LABELS, 'plan'),
        slug: fields.text({ label: 'slug', description: '对应集合中的 slug；服务商类型可留空。' }),
        label: fields.text({ label: '展示名称' }),
      },
      { label: '左侧对象' },
    ),
    right: fields.object(
      {
        type: enumSelect('类型', COMPARE_SUBJECT_TYPES, COMPARE_TYPE_LABELS, 'plan'),
        slug: fields.text({ label: 'slug' }),
        label: fields.text({ label: '展示名称' }),
      },
      { label: '右侧对象' },
    ),
    dimensions: fields.array(
      fields.object({
        label: fields.text({ label: '维度' }),
        left: fields.text({ label: '左侧', multiline: true }),
        right: fields.text({ label: '右侧', multiline: true }),
        winner: enumSelect('更优的一方', COMPARE_WINNERS, COMPARE_WINNER_LABELS, 'tie'),
        note: fields.text({
          label: '备注',
          description: '只有更优的一侧会显示备注，用来解释为什么。',
          validation: { isRequired: false },
        }),
      }),
      {
        label: '对比维度',
        description: '★ 必须是数据而不是 HTML 表格，否则无法生成结构化数据与 llms.txt。',
      },
    ),
    whenChooseLeft: fields.text({
      label: '什么时候选左侧',
      description: '结论的边界，比结论本身更有用。',
      multiline: true,
      validation: { isRequired: false },
    }),
    whenChooseRight: fields.text({
      label: '什么时候选右侧',
      multiline: true,
      validation: { isRequired: false },
    }),
    relatedPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '相关套餐' }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const tutorials = collection({
  label: '教程',
  path: 'src/content/tutorials/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title', 'category'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    category: enumSelect('分类', TUTORIAL_CATEGORIES, TUTORIAL_CATEGORY_LABELS, 'kiwivm'),
    difficulty: enumSelect('难度', DIFFICULTIES, DIFFICULTY_LABELS, 'easy'),
    timeMinutes: fields.integer({
      label: '预计耗时（分钟）',
      defaultValue: 10,
      validation: { min: 1 },
    }),
    summary: fields.text({ label: '摘要', multiline: true }),
    prerequisites: fields.array(fields.text({ label: '前置条件' }), { label: '开始之前' }),
    steps: fields.array(
      fields.object({
        title: fields.text({ label: '步骤标题' }),
        body: fields.text({ label: '步骤说明', description: 'Markdown，可用代码块。', multiline: true }),
        code: fields.text({
          label: '独立代码块',
          description: '留空则不显示。步骤说明里已经用代码块写过的，这里不用重复。',
          multiline: true,
          validation: { isRequired: false },
        }),
        note: fields.text({ label: '提示', multiline: true, validation: { isRequired: false } }),
        warning: fields.text({
          label: '警告',
          description: '★ 顺序错误会导致把自己锁在门外的操作，务必写在这里。',
          multiline: true,
          validation: { isRequired: false },
        }),
      }),
      {
        label: '操作步骤',
        description: '★ 必须是结构化步骤，这是生成 HowTo 结构化数据的依据。',
      },
    ),
    troubleshooting: fields.array(
      fields.object({
        symptom: fields.text({ label: '现象' }),
        cause: fields.text({ label: '原因' }),
        fix: fields.text({ label: '处理方式' }),
      }),
      {
        label: '故障排查',
        description: '「原因」一列不能省——只给操作不给原因，读者换个报错就又不会了。',
      },
    ),
    relatedTutorials: fields.array(fields.text({ label: '教程 slug' }), { label: '相关教程' }),
    relatedPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '相关套餐' }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const benchmarks = collection({
  label: '实测',
  path: 'src/content/benchmarks/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    summary: fields.text({ label: '摘要', multiline: true }),
    target: fields.object(
      {
        type: fields.select({
          label: '对象类型',
          options: [
            { label: '套餐', value: 'plan' },
            { label: '机房', value: 'datacenter' },
          ],
          defaultValue: 'datacenter',
        }),
        slug: fields.text({ label: '对象 slug' }),
        label: fields.text({ label: '展示名称' }),
      },
      { label: '测试对象' },
    ),
    testedAt: fields.date({ label: '采集日期' }),
    method: fields.text({
      label: '测试方法',
      description: '★ 必填。没有方法的数字不是证据，只是说法。',
      multiline: true,
    }),
    tool: fields.text({ label: '测试工具' }),
    sampleSize: fields.text({ label: '样本量', validation: { isRequired: false } }),
    timeWindow: fields.text({
      label: '测试时段',
      description: '例如「闲时 14:00–16:00，晚高峰 21:00–23:00」。',
      validation: { isRequired: false },
    }),
    metrics: fields.array(
      fields.object({
        name: fields.text({ label: '指标' }),
        value: fields.text({ label: '结果' }),
        unit: fields.text({ label: '单位', validation: { isRequired: false } }),
        baseline: fields.text({
          label: '参考基线',
          description: '★ 没有基线的数字读者无法判断好坏。',
          validation: { isRequired: false },
        }),
        verdict: fields.text({ label: '判断', validation: { isRequired: false } }),
      }),
      { label: '实测指标' },
    ),
    latencyTable: fields.array(
      fields.object({
        from: fields.text({ label: '测试点' }),
        min: fields.number({ label: '最小（ms）', validation: { min: 0 } }),
        avg: fields.number({ label: '平均（ms）', validation: { min: 0 } }),
        max: fields.number({ label: '最大（ms）', validation: { min: 0 } }),
        loss: fields.number({ label: '丢包率（%）', defaultValue: 0, validation: { min: 0 } }),
      }),
      { label: '延迟表' },
    ),
    routeTable: fields.array(
      fields.object({
        hop: fields.integer({ label: '跳数', validation: { min: 1 } }),
        asn: fields.text({ label: 'AS 号', validation: { isRequired: false } }),
        location: fields.text({ label: '位置' }),
        latency: fields.number({ label: '延迟（ms）', validation: { min: 0 } }),
      }),
      { label: '路由表' },
    ),
    conclusion: fields.text({ label: '结论', multiline: true, validation: { isRequired: false } }),
    rawUrl: fields.text({
      label: '原始数据地址',
      validation: { isRequired: false },
    }),
    relatedPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '相关套餐' }),
    seo: seoField,
    ...auditFields,
  },
});

const glossary = collection({
  label: '术语',
  path: 'src/content/glossary/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['term', 'termEn'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    term: fields.text({ label: '术语' }),
    termEn: fields.text({ label: '英文', validation: { isRequired: false } }),
    abbr: fields.text({ label: '缩写', validation: { isRequired: false } }),
    shortDef: fields.text({
      label: '一句话定义',
      description: '★ 格式必须是「X 是指……」。这是全站最可被引用的一句话。',
      multiline: true,
    }),
    fullDef: fields.text({ label: '展开说明', multiline: true }),
    related: fields.array(fields.text({ label: '术语 slug' }), { label: '相关术语' }),
    seeAlso: fields.array(fields.text({ label: '站内路径' }), {
      label: '相关页面',
      description: '每行一个站内路径，例如 /guides/beginner。',
    }),
    seo: seoField,
    ...auditFields,
  },
});

const deals = collection({
  label: '优惠',
  path: 'src/content/deals/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title', 'kind', 'status'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    kind: enumSelect('类型', DEAL_KINDS, DEAL_KIND_LABELS, 'coupon'),
    code: fields.text({
      label: '优惠码',
      description: '留空表示不是码类优惠。只在人工核实有效时填写。',
      validation: { isRequired: false },
    }),
    discount: fields.text({ label: '优惠幅度', description: '例如「全场 11%」或「30 天内全额退款」。' }),
    scope: fields.text({ label: '适用范围', validation: { isRequired: false } }),
    appliesToPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '适用套餐' }),
    appliesToRenewal: fields.checkbox({
      label: '适用于续费',
      description: '循环佣金下，能用于续费的优惠比首购优惠更有价值，会单独标注。',
      defaultValue: false,
    }),
    startsAt: fields.date({ label: '开始日期', validation: { isRequired: false } }),
    expiresAt: fields.date({
      label: '结束日期',
      description: '到期后页面会自动改状态为「已结束」，不需要手动维护。',
      validation: { isRequired: false },
    }),
    status: enumSelect('状态', DEAL_STATUSES, DEAL_STATUS_LABELS, 'active'),
    verifiedAt: fields.date({ label: '核实日期', description: '每次人工核实后更新。' }),
    source: fields.text({ label: '信息来源', validation: { isRequired: false } }),
    summary: fields.text({ label: '摘要', multiline: true }),
    content: fields.text({ label: '详细说明', multiline: true }),
    faqs: faqItemsField,
    seo: seoField,
    ...auditFields,
  },
});

const posts = collection({
  label: '文章',
  path: 'src/content/posts/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['title', 'category'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    title: fields.text({ label: '标题' }),
    summary: fields.text({ label: '摘要', multiline: true }),
    category: fields.text({ label: '分类', defaultValue: 'update' }),
    tags: fields.array(fields.text({ label: '标签' }), { label: '标签' }),
    author: fields.text({ label: '作者', defaultValue: '本站编辑部' }),
    content: fields.text({ label: '正文', multiline: true }),
    relatedPlans: fields.array(fields.text({ label: '套餐 slug' }), { label: '相关套餐' }),
    seo: seoField,
    ...auditFields,
  },
});

const faqs = collection({
  label: '问答',
  path: 'src/content/faqs/*',
  slugField: 'slug',
  format: { data: 'json' },
  columns: ['question', 'category'],
  schema: {
    slug: fields.slug({ name: { label: '用于生成网址的标题' } }),
    question: fields.text({ label: '问题' }),
    answer: fields.text({ label: '答案', multiline: true }),
    category: fields.text({
      label: '分类',
      description: '常用值：general、billing、network、usage。未知分类会排在最后而不是被丢弃。',
      defaultValue: 'general',
    }),
    related: fields.object(
      {
        plans: fields.array(fields.text({ label: '套餐 slug' }), { label: '关联套餐' }),
        datacenters: fields.array(fields.text({ label: '机房 slug' }), { label: '关联机房' }),
        lines: fields.array(fields.text({ label: '线路 slug' }), { label: '关联线路' }),
        tutorials: fields.array(fields.text({ label: '教程 slug' }), { label: '关联教程' }),
        glossary: fields.array(fields.text({ label: '术语 slug' }), { label: '关联术语' }),
        deals: fields.array(fields.text({ label: '优惠 slug' }), { label: '关联优惠' }),
      },
      {
        label: '挂到哪些实体上',
        description:
          '★ 一份问答池，渲染在多个页面。关联之后同一个答案不会在两处被写两遍然后逐渐跑偏。',
      },
    ),
    ...auditFields,
  },
});

/* -----------------------------------------------------------------------------
   Singletons
   -------------------------------------------------------------------------- */

const affiliate = singleton({
  label: '联盟设置',
  path: 'src/content/affiliate',
  format: { data: 'json' },
  schema: {
    enabled: fields.checkbox({ label: '启用联盟链接', defaultValue: true }),
    affId: fields.text({
      label: '联盟 ID（affId）',
      description: '★ 全站唯一出现 affId 的地方。换账号只改这一处。',
    }),
    baseUrl: fields.text({ label: '链接基础地址', defaultValue: 'https://bandwagonhost.com/aff.php' }),
    params: fields.array(fields.text({ label: '参数名' }), {
      label: '查询参数顺序',
      description: '按顺序拼接。默认 aff、pid。',
    }),
    rel: fields.text({
      label: 'rel 属性',
      defaultValue: 'sponsored nofollow noopener',
      description: 'Google 对联盟链接的要求，不要改成 dofollow。',
    }),
    trackClicks: fields.checkbox({
      label: '启用点击归因',
      description: '开启后链接走 /go/[plan]，由服务端记录点击，广告拦截器拦不掉。',
      defaultValue: true,
    }),
    disclosureShort: fields.text({
      label: '简短披露',
      description: '用于 CTA 附近和页脚的一行说明。',
      multiline: true,
    }),
    disclosureFull: fields.text({ label: '完整披露', multiline: true }),

    programFacts: fields.object(
      {
        commissionRate: fields.text({ label: '佣金比例', defaultValue: '22%' }),
        recurring: fields.checkbox({
          label: '循环佣金',
          description: '循环佣金意味着用户续费我们也继续分成，这决定了内容要覆盖「买后」。',
          defaultValue: true,
        }),
        cookieDays: fields.integer({
          label: 'Cookie 有效期（天）',
          description: '官方未公开时留空。留空时页面会按较短归因窗口设计 CTA 位置。',
          validation: { isRequired: false, min: 0 },
        }),
        refundDays: fields.integer({ label: '退款天数', defaultValue: 30, validation: { min: 0 } }),
        payoutMethods: fields.array(fields.text({ label: '结算方式' }), { label: '结算方式' }),
        payoutThreshold: fields.text({ label: '结算门槛', validation: { isRequired: false } }),
        notes: fields.text({ label: '补充说明', multiline: true, validation: { isRequired: false } }),
      },
      { label: '联盟计划事实' },
    ),
  },
});

const site = singleton({
  label: '站点设置',
  path: 'src/content/site',
  format: { data: 'json' },
  schema: {
    siteName: fields.text({ label: '站点名称' }),
    shortName: fields.text({ label: '简称' }),
    tagline: fields.text({ label: '一句话定位' }),
    description: fields.text({ label: '站点描述', multiline: true }),
    locale: fields.text({ label: 'locale', defaultValue: 'zh-CN' }),
    htmlLang: fields.text({ label: 'html lang', defaultValue: 'zh-CN' }),
    logo: fields.text({ label: 'Logo 路径', validation: { isRequired: false } }),
    defaultOgImage: fields.text({ label: '默认分享图路径', defaultValue: '/brand/og-default.svg' }),
    contact: fields.object(
      {
        email: fields.text({ label: '联系邮箱', validation: { isRequired: false } }),
        wechat: fields.text({ label: '微信', validation: { isRequired: false } }),
      },
      { label: '联系方式' },
    ),
    social: fields.array(fields.text({ label: '链接' }), { label: '社交链接' }),
    analytics: fields.object(
      {
        gaId: fields.text({
          label: 'GA4 衡量 ID',
          description: '留空则不加载统计脚本。隐私政策页会跟随这个设置变化。',
          validation: { isRequired: false },
        }),
        baidu: fields.text({ label: '百度统计 ID', validation: { isRequired: false } }),
      },
      { label: '访问统计' },
    ),
    publisher: fields.object(
      {
        name: fields.text({ label: '发布方名称' }),
        url: fields.text({ label: '发布方网址', validation: { isRequired: false } }),
      },
      { label: '发布方' },
    ),
  },
});

const home = singleton({
  label: '首页设置',
  path: 'src/content/home',
  format: { data: 'json' },
  schema: {
    hero: fields.object(
      {
        eyebrow: fields.text({ label: '眉题', validation: { isRequired: false } }),
        title: fields.text({ label: '主标题', validation: { isRequired: false } }),
        subtitle: fields.text({ label: '副标题', multiline: true, validation: { isRequired: false } }),
        primaryCta: fields.text({ label: '主按钮文案', validation: { isRequired: false } }),
        secondaryCta: fields.text({ label: '次按钮文案', validation: { isRequired: false } }),
      },
      { label: '首屏' },
    ),
    featuredPlans: fields.array(fields.text({ label: '套餐 slug' }), {
      label: '首页推荐套餐',
      description: '留空则回落到标记了「在首页推荐」的套餐。',
    }),
    featuredGuides: fields.array(fields.text({ label: '指南 slug' }), { label: '首页推荐指南' }),
    featuredTutorials: fields.array(fields.text({ label: '教程 slug' }), {
      label: '首页推荐教程',
    }),
    trustPoints: fields.array(
      fields.object({
        title: fields.text({ label: '标题' }),
        body: fields.text({ label: '说明', multiline: true }),
      }),
      { label: '信任点', description: '写站方真正能做到的事，做不到的不要写在这里。' },
    ),
    seo: seoField,
  },
});

const about = singleton({
  label: '关于页面',
  path: 'src/content/about',
  format: { data: 'json' },
  schema: {
    title: fields.text({ label: '标题' }),
    intro: fields.text({ label: '引言', multiline: true }),
    author: fields.object(
      {
        name: fields.text({ label: '作者名称' }),
        role: fields.text({ label: '角色', validation: { isRequired: false } }),
        bio: fields.text({ label: '简介', multiline: true, validation: { isRequired: false } }),
        avatar: fields.text({ label: '头像路径', validation: { isRequired: false } }),
      },
      { label: '作者' },
    ),
    methodology: fields.array(
      fields.object({
        title: fields.text({ label: '标题' }),
        body: fields.text({ label: '说明', multiline: true }),
      }),
      { label: '测评方法' },
    ),
    sections: fields.array(
      fields.object({
        heading: fields.text({ label: '小标题' }),
        body: fields.text({ label: '正文', multiline: true }),
      }),
      { label: '正文小节' },
    ),
    updatedAt: fields.date({ label: '最后更新日期' }),
  },
});

const disclosure = singleton({
  label: '联盟披露',
  path: 'src/content/disclosure',
  format: { data: 'json' },
  schema: {
    title: fields.text({ label: '标题' }),
    summary: fields.text({ label: '摘要', multiline: true }),
    body: fields.text({ label: '正文', multiline: true }),
    lastReviewedAt: fields.date({ label: '最后复核日期' }),
  },
});

/* -----------------------------------------------------------------------------
   Config
   -------------------------------------------------------------------------- */

export default config({
  storage: { kind: 'local' },

  ui: {
    brand: { name: '瓦工笔记' },
    navigation: {
      内容: ['plans', 'datacenters', 'lines', 'compare', 'guides', 'tutorials'],
      支撑: ['benchmarks', 'glossary', 'deals', 'posts', 'faqs', 'scenarios'],
      站点: ['site', 'home', 'about', 'disclosure', 'affiliate'],
    },
  },

  collections: {
    plans,
    datacenters,
    lines,
    compare,
    guides,
    tutorials,
    benchmarks,
    glossary,
    deals,
    posts,
    faqs,
    scenarios,
  },

  singletons: {
    site,
    home,
    about,
    disclosure,
    affiliate,
  },
});
