/**
 * Content model definitions — the contract between the Astro front-end and the
 * content files Keystatic writes into `src/content/**`.
 *
 * These Zod schemas are the single source of truth. They are used to:
 *   1. Validate every content file at build time, so malformed content fails the
 *      build instead of shipping a blank section.
 *   2. Type every component, so `Plan.specs` etc. are fully inferred.
 *
 * `keystatic.config.ts` must declare exactly these fields. If the two drift,
 * `npm run test:keystatic` fails — that check is deliberate. A field the admin
 * can write but the site cannot read would otherwise ship as a blank section
 * with no error anywhere, because the build only walks the Zod path.
 */

import { z } from 'zod';

/* -----------------------------------------------------------------------------
   Primitives
   -------------------------------------------------------------------------- */

/** Image reference. Keystatic stores a URL string; `lib/cms` wraps it. */
export const MediaSchema = z.object({
  url: z.string(),
  alt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
export type Media = z.infer<typeof MediaSchema>;

/** A question/answer pair. Feeds FAQPage structured data and the FAQ hub. */
export const FaqItemSchema = z.object({
  question: z.string(),
  answer: z.string(),
});
export type FaqItem = z.infer<typeof FaqItemSchema>;

/**
 * Blank optional fields, normalised.
 *
 * Keystatic writes `null` (and occasionally `""`) for an optional field the
 * editor left empty. Both are falsy but neither is `undefined`, so a consumer
 * doing `seo?.title ?? fallback` would render an empty `<title>` instead of
 * falling back. Normalising at the schema boundary means every consumer can use
 * `??` and get the behaviour it expects.
 *
 * Two concrete helpers rather than one generic: the generic form needs a Zod
 * type-parameter constraint that differs between Zod versions, and a plain
 * signature is both clearer and version-proof.
 */
const blankText = (schema: z.ZodType<string | undefined>) =>
  z.preprocess((value) => (value === '' || value === null ? undefined : value), schema);

const blankList = (schema: z.ZodType<string[] | undefined>) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    schema,
  );

/** Per-page SEO overrides. Every field optional — the layout has fallbacks. */
export const SeoSchema = z.object({
  title: blankText(z.string().optional()),
  description: blankText(z.string().optional()),
  keywords: blankList(z.array(z.string()).optional()),
  noindex: z.boolean().optional(),
});
export type Seo = z.infer<typeof SeoSchema>;

/** A named key/value row — the most reused content unit after FeatureItem. */
export const MetricSchema = z.object({
  name: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  baseline: z.string().optional(),
  verdict: z.string().optional(),
});
export type Metric = z.infer<typeof MetricSchema>;

/** Every collection carries these so ordering and freshness are uniform. */
const AuditFields = {
  publishedAt: z.string().optional(),
  updatedAt: z.string(),
  order: z.number().default(0),
};

/* -----------------------------------------------------------------------------
   Enumerations
   -------------------------------------------------------------------------- */

export const PLAN_SERIES = [
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
  'limited',
] as const;

export const PLAN_TIERS = ['entry', 'mainstream', 'pro', 'enterprise'] as const;

export const PLAN_STATUSES = [
  'available',
  'out-of-stock',
  'discontinued',
  'limited',
] as const;

export const BILLING_CYCLES = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;

export const PAYMENT_METHODS = [
  'alipay',
  'paypal',
  'creditcard',
  'unionpay',
  'crypto',
] as const;

export const TUTORIAL_CATEGORIES = [
  'purchase',
  'kiwivm',
  'network',
  'os',
  'deploy',
  'security',
  'billing',
  'troubleshoot',
] as const;

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export const DEAL_KINDS = ['coupon', 'event', 'limited-stock'] as const;

export const DEAL_STATUSES = ['active', 'expired', 'upcoming'] as const;

export const GUIDE_INTENTS = [
  'beginner',
  'website',
  'cross-border',
  'developer',
  'team',
  'budget',
] as const;

export const COMPARE_SUBJECT_TYPES = [
  'plan',
  'datacenter',
  'line',
  'brand',
] as const;

export const COMPARE_WINNERS = ['left', 'right', 'tie'] as const;

export type PlanSeries = (typeof PLAN_SERIES)[number];
export type PlanTier = (typeof PLAN_TIERS)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];
export type DealKind = (typeof DEAL_KINDS)[number];
export type DealStatus = (typeof DEAL_STATUSES)[number];
export type GuideIntent = (typeof GUIDE_INTENTS)[number];
export type CompareSubjectType = (typeof COMPARE_SUBJECT_TYPES)[number];
export type CompareWinner = (typeof COMPARE_WINNERS)[number];

/* -----------------------------------------------------------------------------
   Plan — the conversion page
   -------------------------------------------------------------------------- */

export const PlanSpecsSchema = z.object({
  cpu: z.string(),
  cores: z.number(),
  memoryMB: z.number(),
  diskGB: z.number(),
  diskType: z.string().default('SSD'),
  trafficTB: z.number(),
  bandwidthMbps: z.number(),
  ipv4: z.number().default(1),
  ipv6: z.boolean().default(true),
  virtualization: z.string().default('KVM'),
  raid: z.string().optional(),
});
export type PlanSpecs = z.infer<typeof PlanSpecsSchema>;

export const PlanPricingCycleSchema = z.object({
  cycle: z.enum(BILLING_CYCLES),
  price: z.number(),
  /** Struck-through price when a discount applies. */
  listPrice: z.number().optional(),
  note: z.string().optional(),
});
export type PlanPricingCycle = z.infer<typeof PlanPricingCycleSchema>;

export const PlanPricingSchema = z.object({
  currency: z.string().default('USD'),
  cycles: z.array(PlanPricingCycleSchema).min(1),
  couponCode: z.string().optional(),
  couponDiscount: z.string().optional(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).default([]),
  /**
   * The date a human last confirmed these numbers against the vendor's
   * checkout page. Drives the on-page "checked N days ago" stamp and the
   * `test:freshness` gate — prices are the fastest-rotting content on the site.
   */
  priceCheckedAt: z.string(),
  refundDays: z.number().default(30),
});
export type PlanPricing = z.infer<typeof PlanPricingSchema>;

export const PlanNetworkSchema = z.object({
  /** Slug of a `lines` entry. */
  line: z.string(),
  /** Slugs of `datacenters` entries this plan can be deployed to. */
  datacenters: z.array(z.string()).default([]),
  /** Whether the plan can be relocated between datacenters from the panel. */
  migratable: z.boolean().default(false),
  migratableCount: z.number().default(0),
});
export type PlanNetwork = z.infer<typeof PlanNetworkSchema>;

export const PlanAffiliateSchema = z.object({
  /**
   * The vendor's product id for this plan. Required for the affiliate link to
   * land on the exact plan's purchase page — a generic homepage link loses a
   * meaningful share of clicks, and there is no way to recover them.
   *
   * Values must be copied from the vendor's affiliate dashboard. Format is
   * checked by `test:affiliate`; correctness can only be confirmed by a human.
   */
  pid: z.string(),
  /** Set true once someone has opened the generated link and seen the right plan. */
  verified: z.boolean().default(false),
  note: z.string().optional(),
});
export type PlanAffiliate = z.infer<typeof PlanAffiliateSchema>;

export const PlanScoresSchema = z.object({
  performance: z.number().min(1).max(5),
  value: z.number().min(1).max(5),
  stability: z.number().min(1).max(5),
  latencyCN: z.number().min(1).max(5),
});
export type PlanScores = z.infer<typeof PlanScoresSchema>;

export const PlanSchema = z.object({
  slug: z.string(),
  name: z.string(),
  series: z.enum(PLAN_SERIES),
  tier: z.enum(PLAN_TIERS),
  status: z.enum(PLAN_STATUSES).default('available'),
  tagline: z.string(),
  /** Conclusion-first summary. Serves the reader and the answer engines. */
  summary: z.string(),
  bestFor: z.array(z.string()).default([]),
  /**
   * Who should *not* buy this. Not a hedge — a 30-day refund claws the
   * commission back, so steering a mismatched buyer away is worth money.
   */
  notFor: z.array(z.string()).default([]),
  specs: PlanSpecsSchema,
  network: PlanNetworkSchema,
  pricing: PlanPricingSchema,
  affiliate: PlanAffiliateSchema,
  scores: PlanScoresSchema.optional(),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  content: z.string().default(''),
  /** Scenario slugs — drives the chooser and the "which fits me" blocks. */
  useCases: z.array(z.string()).default([]),
  relatedPlans: z.array(z.string()).default([]),
  relatedTutorials: z.array(z.string()).default([]),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  featured: z.boolean().default(false),
  ...AuditFields,
});
export type Plan = z.infer<typeof PlanSchema>;

/* -----------------------------------------------------------------------------
   Datacenter
   -------------------------------------------------------------------------- */

export const LatencyRowSchema = z.object({
  from: z.string(),
  min: z.number(),
  avg: z.number(),
  max: z.number(),
  loss: z.number().default(0),
});
export type LatencyRow = z.infer<typeof LatencyRowSchema>;

export const DatacenterSchema = z.object({
  slug: z.string(),
  name: z.string(),
  /** Vendor's internal code, e.g. DC6, DC9, USCA_9. Shown as a mono chip. */
  code: z.string(),
  country: z.string(),
  city: z.string(),
  line: z.string(),
  /** Which carrier traffic goes over which network, per operator. */
  network: z.object({
    telecom: z.string().default(''),
    unicom: z.string().default(''),
    mobile: z.string().default(''),
  }),
  /** Lets readers verify the claims themselves — the strongest trust signal. */
  testIp: z.string().default(''),
  testFileUrl: z.string().optional(),
  lookingGlass: z.string().optional(),
  latency: z.array(LatencyRowSchema).default([]),
  latencyMeasuredAt: z.string().optional(),
  latencyMethod: z.string().optional(),
  summary: z.string(),
  bestFor: z.array(z.string()).default([]),
  notFor: z.array(z.string()).default([]),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  migratableTargets: z.array(z.string()).default([]),
  content: z.string().default(''),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Datacenter = z.infer<typeof DatacenterSchema>;

/* -----------------------------------------------------------------------------
   Line
   -------------------------------------------------------------------------- */

export const LineSchema = z.object({
  slug: z.string(),
  name: z.string(),
  abbr: z.string(),
  summary: z.string(),
  /**
   * The standard definition sentence, phrased as "X 是指……". Answer engines
   * lift this pattern almost verbatim, which is why it gets its own field
   * rather than being buried in the body copy.
   */
  definition: z.string(),
  typicalLatency: z.string().default(''),
  typicalLoss: z.string().default(''),
  peakBehavior: z.string().default(''),
  pros: z.array(z.string()).default([]),
  cons: z.array(z.string()).default([]),
  availableDatacenters: z.array(z.string()).default([]),
  /** How this line differs from the ones it is most often confused with. */
  comparedWith: z
    .array(z.object({ slug: z.string(), difference: z.string() }))
    .default([]),
  /** Plain answer to "is it worth paying more for this?" */
  verdict: z.string().default(''),
  content: z.string().default(''),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Line = z.infer<typeof LineSchema>;

/* -----------------------------------------------------------------------------
   Scenario — feeds the chooser and the guides
   -------------------------------------------------------------------------- */

export const ScenarioSchema = z.object({
  slug: z.string(),
  name: z.string(),
  icon: z.string().default('server'),
  /** The question this scenario answers, shown as the chooser option label. */
  question: z.string(),
  summary: z.string(),
  painPoints: z.array(z.string()).default([]),
  budgetHint: z.string().default(''),
  technicalLevel: z.string().default(''),
  /** Ordered by preference — the first entry is the headline recommendation. */
  recommendedPlans: z.array(z.string()).default([]),
  recommendedDatacenters: z.array(z.string()).default([]),
  guide: z.string().optional(),
  content: z.string().default(''),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Scenario = z.infer<typeof ScenarioSchema>;

/* -----------------------------------------------------------------------------
   Guide — the pillar pages
   -------------------------------------------------------------------------- */

export const GuideSectionSchema = z.object({
  heading: z.string(),
  body: z.string(),
});
export type GuideSection = z.infer<typeof GuideSectionSchema>;

export const GuideSchema = z.object({
  slug: z.string(),
  title: z.string(),
  intent: z.enum(GUIDE_INTENTS),
  summary: z.string(),
  /** Conclusion-first block: the answer, before the argument. */
  verdict: z.string(),
  sections: z.array(GuideSectionSchema).default([]),
  /** Deliberately short. Five options is the same as no recommendation. */
  recommendedPlans: z.array(z.string()).default([]),
  checklist: z.array(z.string()).default([]),
  relatedGuides: z.array(z.string()).default([]),
  relatedCompare: z.array(z.string()).default([]),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Guide = z.infer<typeof GuideSchema>;

/* -----------------------------------------------------------------------------
   Compare
   -------------------------------------------------------------------------- */

export const CompareSubjectSchema = z.object({
  type: z.enum(COMPARE_SUBJECT_TYPES),
  slug: z.string(),
  label: z.string(),
});
export type CompareSubject = z.infer<typeof CompareSubjectSchema>;

export const CompareDimensionSchema = z.object({
  label: z.string(),
  left: z.string(),
  right: z.string(),
  winner: z.enum(COMPARE_WINNERS).default('tie'),
  note: z.string().optional(),
});
export type CompareDimension = z.infer<typeof CompareDimensionSchema>;

export const CompareSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  /**
   * The pick. Answer engines do not derive conclusions from a comparison
   * table — they quote one that has already been written. A page that refuses
   * to choose gets treated as reference material, not as a source.
   */
  verdict: z.string(),
  left: CompareSubjectSchema,
  right: CompareSubjectSchema,
  dimensions: z.array(CompareDimensionSchema).default([]),
  whenChooseLeft: z.string().default(''),
  whenChooseRight: z.string().default(''),
  relatedPlans: z.array(z.string()).default([]),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Compare = z.infer<typeof CompareSchema>;

/* -----------------------------------------------------------------------------
   Tutorial — the retention layer
   -------------------------------------------------------------------------- */

export const TutorialStepSchema = z.object({
  title: z.string(),
  body: z.string(),
  code: z.string().optional(),
  note: z.string().optional(),
  warning: z.string().optional(),
});
export type TutorialStep = z.infer<typeof TutorialStepSchema>;

export const TroubleshootItemSchema = z.object({
  symptom: z.string(),
  cause: z.string(),
  fix: z.string(),
});
export type TroubleshootItem = z.infer<typeof TroubleshootItemSchema>;

export const TutorialSchema = z.object({
  slug: z.string(),
  title: z.string(),
  category: z.enum(TUTORIAL_CATEGORIES),
  difficulty: z.enum(DIFFICULTIES).default('easy'),
  timeMinutes: z.number().default(10),
  summary: z.string(),
  prerequisites: z.array(z.string()).default([]),
  /** Structured, not free-form: this is what produces valid HowTo data. */
  steps: z.array(TutorialStepSchema).default([]),
  troubleshooting: z.array(TroubleshootItemSchema).default([]),
  relatedTutorials: z.array(z.string()).default([]),
  relatedPlans: z.array(z.string()).default([]),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Tutorial = z.infer<typeof TutorialSchema>;

/* -----------------------------------------------------------------------------
   Benchmark — the credibility layer
   -------------------------------------------------------------------------- */

export const RouteHopSchema = z.object({
  hop: z.number(),
  asn: z.string().default(''),
  location: z.string(),
  latency: z.number(),
});
export type RouteHop = z.infer<typeof RouteHopSchema>;

export const BenchmarkSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  target: z.object({
    type: z.enum(['plan', 'datacenter']),
    slug: z.string(),
    label: z.string(),
  }),
  testedAt: z.string(),
  /** Method must be stated, or the numbers are not evidence, just claims. */
  method: z.string(),
  tool: z.string(),
  sampleSize: z.string().default(''),
  timeWindow: z.string().default(''),
  metrics: z.array(MetricSchema).default([]),
  latencyTable: z.array(LatencyRowSchema).default([]),
  routeTable: z.array(RouteHopSchema).default([]),
  conclusion: z.string().default(''),
  rawUrl: z.string().optional(),
  relatedPlans: z.array(z.string()).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Benchmark = z.infer<typeof BenchmarkSchema>;

/* -----------------------------------------------------------------------------
   Glossary — the entity layer
   -------------------------------------------------------------------------- */

export const GlossarySchema = z.object({
  slug: z.string(),
  term: z.string(),
  termEn: z.string().optional(),
  abbr: z.string().optional(),
  /** One-sentence definition. The single most quotable string on the site. */
  shortDef: z.string(),
  fullDef: z.string().default(''),
  related: z.array(z.string()).default([]),
  seeAlso: z.array(z.string()).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Glossary = z.infer<typeof GlossarySchema>;

/* -----------------------------------------------------------------------------
   Deal
   -------------------------------------------------------------------------- */

export const DealSchema = z.object({
  slug: z.string(),
  title: z.string(),
  kind: z.enum(DEAL_KINDS),
  code: z.string().optional(),
  discount: z.string(),
  scope: z.string().default(''),
  appliesToPlans: z.array(z.string()).default([]),
  /** Recurring discounts are the interesting ones under a recurring commission. */
  appliesToRenewal: z.boolean().default(false),
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
  status: z.enum(DEAL_STATUSES).default('active'),
  verifiedAt: z.string(),
  source: z.string().optional(),
  summary: z.string(),
  content: z.string().default(''),
  faqs: z.array(FaqItemSchema).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Deal = z.infer<typeof DealSchema>;

/* -----------------------------------------------------------------------------
   Post
   -------------------------------------------------------------------------- */

export const PostSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string().default('update'),
  tags: z.array(z.string()).default([]),
  author: z.string().default('本站编辑部'),
  content: z.string().default(''),
  relatedPlans: z.array(z.string()).default([]),
  seo: SeoSchema.optional(),
  ...AuditFields,
});
export type Post = z.infer<typeof PostSchema>;

/* -----------------------------------------------------------------------------
   Faq — the shared question pool
   -------------------------------------------------------------------------- */

export const FaqSchema = z.object({
  slug: z.string(),
  question: z.string(),
  answer: z.string(),
  category: z.string().default('general'),
  /**
   * Which entities this question belongs to. One pool, rendered in many
   * places, so the same answer is never written twice and then allowed to
   * drift apart.
   *
   * `prefault` rather than `default`: Zod 4 types `default` against the inner
   * schema's *output*, which for an object whose fields all have defaults is the
   * fully-populated shape — so `.default({})` is a type error. `prefault` types
   * against the *input* instead and runs the value through the schema, so `{}`
   * is accepted and the inner defaults fill in the rest.
   */
  related: z
    .object({
      plans: z.array(z.string()).default([]),
      datacenters: z.array(z.string()).default([]),
      lines: z.array(z.string()).default([]),
      tutorials: z.array(z.string()).default([]),
      glossary: z.array(z.string()).default([]),
      deals: z.array(z.string()).default([]),
    })
    .prefault({}),
  ...AuditFields,
});
export type Faq = z.infer<typeof FaqSchema>;

/* -----------------------------------------------------------------------------
   Singletons
   -------------------------------------------------------------------------- */

export const AffiliateSchema = z.object({
  enabled: z.boolean().default(true),
  /** The affiliate id. The only place it appears in the whole codebase. */
  affId: z.string(),
  baseUrl: z.string().default('https://bandwagonhost.com/aff.php'),
  /** Parameters appended to every link, in order. */
  params: z.array(z.string()).default(['aff', 'pid']),
  /** Value of the `rel` attribute on every outbound affiliate link. */
  rel: z.string().default('sponsored nofollow noopener'),
  /** Route clicks through /go/[plan] for server-side attribution. */
  trackClicks: z.boolean().default(true),
  disclosureShort: z.string(),
  disclosureFull: z.string(),
  programFacts: z.object({
    commissionRate: z.string().default('22%'),
    recurring: z.boolean().default(true),
    cookieDays: z.number().optional(),
    refundDays: z.number().default(30),
    payoutMethods: z.array(z.string()).default([]),
    payoutThreshold: z.string().optional(),
    notes: z.string().optional(),
  }),
});
export type Affiliate = z.infer<typeof AffiliateSchema>;

export const SiteSchema = z.object({
  siteName: z.string(),
  shortName: z.string(),
  tagline: z.string(),
  description: z.string(),
  locale: z.string().default('zh-CN'),
  htmlLang: z.string().default('zh-CN'),
  logo: z.string().optional(),
  defaultOgImage: z.string().default('/brand/og-default.svg'),
  contact: z.object({
    email: z.string().default(''),
    wechat: z.string().optional(),
  }),
  social: z.array(z.string()).default([]),
  analytics: z.object({
    gaId: z.string().optional(),
    baidu: z.string().optional(),
  }),
  /** Shown in the footer and in Organization structured data. */
  publisher: z.object({
    name: z.string(),
    url: z.string().default(''),
  }),
});
export type SiteConfig = z.infer<typeof SiteSchema>;

export const HomeSchema = z.object({
  hero: z.object({
    eyebrow: z.string().default(''),
    title: z.string().default(''),
    subtitle: z.string().default(''),
    primaryCta: z.string().default(''),
    secondaryCta: z.string().default(''),
  }),
  featuredPlans: z.array(z.string()).default([]),
  featuredGuides: z.array(z.string()).default([]),
  featuredTutorials: z.array(z.string()).default([]),
  trustPoints: z
    .array(z.object({ title: z.string(), body: z.string() }))
    .default([]),
  seo: SeoSchema.optional(),
});
export type Home = z.infer<typeof HomeSchema>;

export const AboutSchema = z.object({
  title: z.string(),
  intro: z.string(),
  author: z.object({
    name: z.string(),
    role: z.string().default(''),
    bio: z.string().default(''),
    avatar: z.string().optional(),
  }),
  methodology: z.array(z.object({ title: z.string(), body: z.string() })).default([]),
  sections: z.array(GuideSectionSchema).default([]),
  updatedAt: z.string(),
});
export type About = z.infer<typeof AboutSchema>;

export const DisclosureSchema = z.object({
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  lastReviewedAt: z.string(),
});
export type Disclosure = z.infer<typeof DisclosureSchema>;

/* -----------------------------------------------------------------------------
   Registry — used by the build-time loader and by the tests
   -------------------------------------------------------------------------- */

export const COLLECTIONS = {
  plans: PlanSchema,
  datacenters: DatacenterSchema,
  lines: LineSchema,
  scenarios: ScenarioSchema,
  guides: GuideSchema,
  compare: CompareSchema,
  tutorials: TutorialSchema,
  benchmarks: BenchmarkSchema,
  glossary: GlossarySchema,
  deals: DealSchema,
  posts: PostSchema,
  faqs: FaqSchema,
} as const;

export const SINGLETONS = {
  affiliate: AffiliateSchema,
  site: SiteSchema,
  home: HomeSchema,
  about: AboutSchema,
  disclosure: DisclosureSchema,
} as const;

export type CollectionName = keyof typeof COLLECTIONS;
export type SingletonName = keyof typeof SINGLETONS;
