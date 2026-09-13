# 搬瓦工 Aff 内容站 · 架构与实现规划

> 目标：用 Astro + Keystatic + Cloudflare 做一个搬瓦工（BandwagonHost）联盟推广内容站。
> 核心指标不是"访问量"，而是**有效订单数 × 客单价 × 留存年限**。
>
> 这份文档只写决策和做法，不写使用说明。内容层面的规划见 [CONTENT-PLAN.md](./CONTENT-PLAN.md)。
> 实际开发中踩到的坑与最终取舍见 [DEVELOPMENT-NOTES.md](./DEVELOPMENT-NOTES.md)。

> [!IMPORTANT]
> **实现阶段对本文档的修正**
>
> 本文档成稿于动手之前。以下三处在实际实现时被证实不成立，已按事实修正，**阅读下文时请以这里为准**：
>
> 1. **部署目标是 Cloudflare Workers，不是 Pages。**
>    `@astrojs/cloudflare` 已移除 Pages 支持（官方文档："The Astro Cloudflare adapter no longer supports deployment on Cloudflare Pages"）。
>    部署命令是 `npx wrangler deploy`。产物为 `dist/client`（静态资源）+ `dist/server`（Worker：`entry.mjs` + 自动生成的 `wrangler.json`）。
>    **「构建输出目录必须填 `dist/client`，填错整站 404」这个坑随之消失** —— Workers 没有这个设置项。
>
> 2. **适配器有两个，按命令分工，而不是只有一个 Cloudflare 适配器。**
>    `adapter` 无法按 Astro 命令切换（`defineConfig` 是恒等函数，不接受函数式配置）。
>    最终 `astro.config.mjs` 用 Node 适配器（供 `dev`/`check`/`preview`），`astro.config.cloudflare.mjs` 用 Cloudflare 适配器（供构建）。
>    原因有二：Keystatic 的本地存储后台需要文件系统，而适配器在 dev 下把站点跑在 `workerd` 上（没有文件系统）；
>    并且实测该模式下 `/plans`、`/blog`、`/learn`、`/disclosure`、`/go/*` 稳定返回 404。
>
> 3. **需要显式设置 `session: false`。**
>    Astro 7 默认开启会话，Cloudflare 适配器随之声明一个 `SESSION` KV 命名空间绑定 —— 本站没有用户、登录或服务端状态，不关掉就会在首次部署时凭空 provision 一个 KV。


---

## 一页速览

| 项 | 决定 |
| :--- | :--- |
| 框架 | Astro 7.x，`output: 'static'` |
| 适配器 | 两个：Node（`dev`/`check`/`preview`）+ Cloudflare（构建，`imageService: 'compile'`）。见文首修正 2 |
| 后台 | Keystatic 0.6.9，`storage.kind = 'local'`，内容落 JSON |
| 样式 | Tailwind 4，经 `@tailwindcss/vite` 接入（**不是** Astro integration） |
| 部署 | Cloudflare **Workers**，`npx wrangler deploy`。见文首修正 1 |
| 会话 | `session: false`（避免无用的 KV 绑定）。见文首修正 3 |
| 语言 | 第一阶段中文单语；英文只做核心转化页，**不做全量镜像** |
| 动态能力 | `/go/[plan]` 302 跳转追踪 + `/api/*`，走 `prerender = false` |
| 数据入口 | `src/lib/cms.ts` 唯一收口，页面永不直读 JSON |
| 内容契约 | `src/lib/schemas.ts`（Zod）与 `keystatic.config.ts` 两份，靠 `test:keystatic` 守着 |
| 公开页 JS | 目标 0 外部脚本（选择器/复制/TOC 全内联，约 2 KB） |
| 站内数据 | 套餐 / 机房 / 线路 / 教程 / 实测 / 术语 / 对比 / 优惠 / 指南 / 文章 / FAQ / 场景 = 12 个集合 + 5 个单例 |

---

## 一、先搞清楚生意：搬瓦工 Aff 的三个经济学推论

技术方案要为商业模式服务。搬瓦工联盟计划的机制直接决定了内容该长什么样。

**已核实的事实**

| 项 | 值 |
| :--- | :--- |
| 佣金比例 | **22%**，按实际付款金额计（税前） |
| 是否循环 | **是**。用户续费也继续给 22% |
| 推广链接 | `bandwagonhost.com/aff.php?aff=<你的ID>`，可加 `&pid=<套餐ID>` 直达该套餐购买页 |
| 追踪条件 | **只认通过公开网页的点击**。私发消息给别人不算 |
| 自购 | 同 IP 自己下单不计佣金 |
| 提现 | 门槛低，PayPal 打款或转账户余额；一般 2–3 天到账 |
| Cookie 有效期 | **官方未公开**（第三方目录站标注 Unknown）——按"短窗口"设计，不要指望长期归因 |
| 退款政策 | 新账号 **30 天内可全额退款** |

### 推论 1：循环佣金 → 内容必须覆盖"买后"

22% 是循环的。一个 $49.99/年 的套餐，用户续 5 年就是约 $250 的总流水、约 $55 佣金。
所以**留存比首单更值钱**。这意味着站点不能只有"买前转化页"，
必须有一整层**使用层内容**（KiwiVM、重装、迁移机房、快照、续费）——
它们不直接带转化，但：
1. 抢低竞争长尾词，是自然流量入口；
2. 降低用户因"不会用"而退款/不续费的概率；
3. 是内链枢纽，把权重喂给套餐页。

> 竞品（大量 aff 站）几乎只做"套餐介绍 + 优惠码"，使用层是空的。**这是本站的护城河。**

### 推论 2：30 天退款 = 佣金回吐 → "劝退内容"反而增收

用户退款，佣金大概率被扣回。所以：
- 每个套餐必须有 `notFor`（不适合谁）字段，并渲染成"买之前先确认这 3 件事"；
- 需要一篇《什么情况下不要买搬瓦工》——诚实劝退；
- 搬瓦工**禁止**的用途（群发邮件、滥用 CPU、挖矿、开放代理）必须写清楚。

直觉上这是"把客户往外推"，实际是**提高净佣金**：错配的用户 30 天内退款，你白干还伤信任；
被正确劝退的用户会记住这个站，下次买对的时候回来。

### 推论 3：Cookie 窗口未知 → 转化动作要贴着决策点

不要假设用户"过两天还会回来"。设计上：
- 每个决策点附近（对比表行尾、结论框、FAQ 之后）都要有 CTA；
- 链接必须带 `pid` 直达具体套餐购买页，而不是笼统的首页 —— 每多一步跳转就掉一批人；
- 优惠码组件 = 复制码 + 同时给出直达链接，两步并一步。

---

## 二、用户画像与意图分层

### 五类访客

| 画像 | 特征 | 在意什么 | 对应内容层 |
| :--- | :--- | :--- | :--- |
| **A 新手学习者** | 没买过 VPS，想学 Linux / 有个自己的服务器 | 便宜、别踩坑、有人教 | 入门指南、术语词典、安装教程 |
| **B 独立开发者 / 站长** | 要跑博客、WordPress、小应用、API | 稳定、带宽、延迟、能不能迁机房 | 套餐对比、机房实测、部署教程 |
| **C 跨境 / 外贸从业者** | 独立站、落地页、邮件、多环境 | 线路质量、付款方式、企业合规 | 场景落地页、线路对比、企业套餐 |
| **D 已有用户（留存层）** | 已经买了，来查续费 / 优惠码 / 教程 | 省钱、解决问题 | 优惠码、KiwiVM 教程、续费攻略 |
| **E 比价者** | 在搬瓦工和其他家之间犹豫 | 客观数据、结论 | 竞品对比、实测数据、决策树 |

**D 类被严重低估**：他们搜索意图最明确、竞争最低，而且直接决定循环佣金。

### 意图四层 → 页面类型映射

```
认知层  "搬瓦工是什么 / CN2 GIA 是什么"      → 术语页、知识科普
  ↓
比较层  "搬瓦工哪个套餐好 / DC6 还是 DC9"    → 对比页、机房页、套餐页
  ↓
决策层  "搬瓦工优惠码 / 怎么买 / 怎么退款"    → 优惠页、购买教程、FAQ
  ↓
使用层  "KiwiVM 重装系统 / 怎么迁机房"       → 教程库、实测数据
```

漏斗越往下转化越高，但**认知层和比较层贡献 80% 的自然流量**，
使用层贡献留存与低竞争长尾。三层都要有，比例大致 **4 : 3 : 3**。

### 一个必须绕开的陷阱

搬瓦工相关搜索里流量最大的一块是"网络访问类"需求。**不要碰。**

- 合规风险：这类内容在中国境内属于敏感方向；
- SEO 风险：百度对这类站点会整体降权，会连带压死你正经的套餐页；
- 商业风险：这类流量转化后容易触发退款/滥用，佣金不稳。

**做法**：全站禁用词表（见 CONTENT-PLAN 第七节），把内容定位收在
"海外服务器 / 跨境建站 / 开发测试环境 / 学习 Linux"这些合规表述上。
不写任何规避网络管理的内容，也不写第三方代理工具教程。

---

## 三、信息架构

### URL 地图

```
/                                   首页：价值主张 + 场景分流 + 主力套餐
/plans/                             套餐总览（可筛选对比表）
  /plans/[slug]/                    套餐详情（转化主战场）
/datacenters/                       机房总览（延迟对照）
  /datacenters/[slug]/
/lines/                             线路总览（CN2 GIA / GT / 9929 / CMIN2…）
  /lines/[slug]/
/compare/                           对比中心
  /compare/[slug]/                  套餐互比、机房互比、跨商家对比
/guides/                            选购指南（场景化支柱页）
  /guides/[slug]/                   新手 / 建站 / 跨境 / 团队 / 预算
/learn/                             教程库（使用层 + 留存）
  /learn/[slug]/                    含 HowTo 结构化数据
/benchmarks/                        实测数据
  /benchmarks/[slug]/               延迟、路由、IO、带宽
/deals/                             优惠与活动（时效性强，转化最高）
  /deals/[slug]/
/glossary/                          术语词典（认知层入口 + 内链枢纽）
  /glossary/[slug]/
/blog/  /blog/[slug]/               资讯与活动解读
/faq/                               全站常见问题
/tools/chooser/                     套餐选择器（交互式，转化利器）
/about/                             关于本站 + 测评方法（E-E-A-T）
/disclosure/                        联盟披露（合规必需）
/privacy/  /contact/  /changelog/   常规
/search/                            站内搜索（noindex）
/go/[plan]                          302 跳转 + 点击归因（prerender = false）
/404
rss.xml  sitemap-index.xml  robots.txt  llms.txt  llms-full.txt
```

**URL 设计的四条规矩**
1. 用扁平语义路径，不用 `/category/sub/sub/` 三级以上。
2. `slug` 即网址，**发布后永不修改**。改名一律 301。
3. 有排名但已下架的套餐**不删页面**，改 `status` 为 `out-of-stock` 并推荐替代品。
4. `/go/` 与 `/search` 必须 `noindex`，不进 sitemap。

### 导航结构

主导航只放 6 项，其余进页脚与枢纽页：

`套餐` · `机房线路` · `选购指南` · `优惠活动` · `教程` · `实测数据`

**理由**：技术用户讨厌深菜单。二级结构靠页内枢纽区块（"相关套餐 / 相关机房 / 相关教程"）承担，
而不是靠多级下拉。

---

## 四、内容模型（Keystatic 集合设计）

内容模型是这个项目最值钱的部分。设计原则：**能变的东西全部数据化，不能变的东西才写正文。**

### 12 个集合

| 集合 | 目录 | 生成页面 | 关键设计 |
| :--- | :--- | :--- | :--- |
| `plans` | `src/content/plans/` | `/plans/[slug]` | ★ 价格、参数、pid 全结构化 |
| `datacenters` | `src/content/datacenters/` | `/datacenters/[slug]` | 实测延迟 + 测试 IP 独立字段 |
| `lines` | `src/content/lines/` | `/lines/[slug]` | 定义句字段，GEO 引用源 |
| `scenarios` | `src/content/scenarios/` | 无独立页（喂选择器与指南） | 决定推荐顺序 |
| `guides` | `src/content/guides/` | `/guides/[slug]` | 支柱长文 |
| `compare` | `src/content/compare/` | `/compare/[slug]` | ★ 对比维度结构化，不是 HTML 表格 |
| `tutorials` | `src/content/tutorials/` | `/learn/[slug]` | ★ 步骤结构化 → HowTo |
| `benchmarks` | `src/content/benchmarks/` | `/benchmarks/[slug]` | 指标 + 方法 + 时间 |
| `glossary` | `src/content/glossary/` | `/glossary/[slug]` | 一句话定义 → DefinedTerm |
| `deals` | `src/content/deals/` | `/deals/[slug]` | ★ 有效期自动判定状态 |
| `posts` | `src/content/posts/` | `/blog/[slug]` | 资讯 |
| `faqs` | `src/content/faqs/` | `/faq` + 各处内嵌 | 可挂到任意实体上 |

### 5 个单例

| 单例 | 管什么 |
| :--- | :--- |
| `site` | 站名、域名、Logo、联系方式、分析 ID、社交链接 |
| **`affiliate`** | ★ **affId、链接模板、披露文案、追踪开关** |
| `home` | 首页各区块文案（全字段可选，留空回落 `config/home.ts`） |
| `about` | 关于本站、作者、测评方法说明 |
| `disclosure` | 联盟披露全文 |

### `affiliate` 单例为什么是核心

**所有推广链接只在一个地方生成。**

```
src/content/affiliate.json
  └─ affId: "123456"
  └─ baseUrl: "https://bandwagonhost.com/aff.php"
  └─ 各套餐 pid 存在 plans/*.json 的 affiliate.pid

src/lib/affiliate.ts  ← 唯一构建链接的模块
  buildAffUrl(plan) → https://bandwagonhost.com/aff.php?aff=123456&pid=44
```

好处：
- 换 aff 账号只改一处，全站生效；
- `test:affiliate` 可以遍历所有套餐验证链接合法（**aff 链接写错 = 白干，必须有自动化检查**）；
- 想接多账号 / 多站点分流时，只改这一个模块。

⚠️ `pid` 需要人工从搬瓦工后台的 Affiliates 页面逐个复制（每个套餐的推广链接里带着 pid）。
这是**上线前唯一必须人工核对的字段**，`test:affiliate` 会兜住格式，但值对不对只能人对。

### `plans` 字段清单（核心集合）

```
标识      slug / name / nameEn / brandSeries / tier / status / order
内容      tagline / summary(TL;DR) / content(markdown)
适配      bestFor[] / notFor[] / useCases[](→scenarios)
硬件      specs{ cpu, cores, memoryMB, diskGB, diskType, trafficTB,
                 bandwidthMbps, ipv4, ipv6, virtualization, raid }
网络      network{ line(→lines), datacenters[](→datacenters),
                 migratable, migratableCount }
价格      pricing{ currency, cycles[]{ cycle, price, listPrice, note },
                 couponCode, couponDiscount, paymentMethods[],
                 priceCheckedAt, refundDays }        ← ★ 时效治理靠它
联盟      affiliate{ pid, verified }                 ← ★ 唯一需人工核对
评价      scores{ performance, value, stability, latencyCN }  ← 仅展示，不进 schema.org
优缺点    pros[] / cons[]
关联      relatedPlans[] / relatedTutorials[] / faqs[]
SEO       seo{ title, description, keywords } / updatedAt / publishedAt / featured
```

**三条设计规矩**

1. **价格绝不硬编码在页面里**。价格是最高频变动字段，全部走 `plans/*.json`。
   页面永远 `getPlan(slug).pricing.cycles`，改价格不需要动代码。
2. **每个价格字段都带 `priceCheckedAt`**。构建时算距今多少天：
   - ≤ 30 天 → 显示"价格已于 X 天前核对"
   - 31–60 天 → 显示"价格可能已变动，请以官网为准"
   - \> 60 天 → 构建警告 + 页面顶部黄条 `test:freshness` 会拦住发布
3. **`scores` 只做站内展示，绝不输出为 `AggregateRating`**。
   Google 明确禁止为自己的产品生成自评富媒体摘要，伪造评分既违规也毁信任。

### `compare` 集合：对比表必须是数据，不是 HTML

```
dimensions[]: { label, left, right, winner: 'left'|'right'|'tie', note }
verdict:      明确结论（GEO 关键：AI 引用有结论的页面）
whenChooseLeft / whenChooseRight
```

渲染时由组件生成 `<table>`。这样同一份数据可以：
- 渲染成网页对比表；
- 生成 `ItemList` 结构化数据；
- 生成 `/llms.txt` 里的对比摘要；
- 未来做成图片/表格卡片。

如果写成富文本里的 HTML 表格，以上四条全部做不到。

---

## 五、技术架构

### 目录结构

```
stellar-shell/
├─ astro.config.mjs
├─ keystatic.config.ts            ← 后台表单定义（与 schemas.ts 必须一致）
├─ package.json
├─ functions/                     ← 可选，见下文"为什么不用它"
├─ public/
│  ├─ _headers  _redirects  robots.txt
│  ├─ llms.txt                    ← 由脚本生成，不手写
│  ├─ brand/  fonts/  images/
├─ scripts/                       ← 全部自检与生成脚本
├─ src/
│  ├─ config/        site.ts  home.ts  nav.ts
│  ├─ content/       12 个集合目录 + 5 个单例 JSON
│  ├─ layouts/       BaseLayout.astro
│  ├─ components/
│  │  ├─ layout/     Header Footer Breadcrumbs Toc StickyCta
│  │  ├─ seo/        SeoHead JsonLd
│  │  ├─ cards/      PlanCard DatacenterCard TutorialCard DealCard …
│  │  ├─ sections/   PlanCompareTable PricingTable SpecTable ScenarioChooser
│  │  │              LatencyTable ProsCons FaqAccordion VerdictBox
│  │  │              UpdateStamp AffiliateDisclosure CtaBand RelatedGrid
│  │  └─ ui/         Button Badge Tag Callout CopyButton Tabs FilterBar Icon
│  ├─ lib/           ★ cms.ts  schemas.ts  affiliate.ts  seo.ts
│  │                 format.ts  freshness.ts  search.ts
│  ├─ pages/         见第三节 URL 地图
│  └─ styles/        global.css
└─ dist/client/      ← Cloudflare Pages 的输出目录
```

### 数据流

```
Keystatic 后台（本地 /keystatic）
        ↓ 写入
src/content/**/*.json
        ↓ 构建时 Zod 校验（不合法直接 fail build）
src/lib/cms.ts          ← 页面唯一入口，只暴露 getXxx()
        ↓
src/pages/**/*.astro    ← 页面永远不直接 import JSON
        ↓
dist/client/**/*.html
        ↓
Cloudflare Pages
```

**`cms.ts` 收口是最高杠杆的决定**（参考项目的原话）。
在本项目里它还有一个额外作用：**价格和链接的唯一出口**。
页面拿不到原始 JSON，就只能通过 `getPlan()` 拿已经处理好价格格式、
链接、新鲜度标记的对象。想改价格展示规则，只改一个地方。

### 关键决策与理由

#### 1. 动态路由用 Astro 路由 + `prerender = false`，不用根目录 `functions/`

参考项目把 `/api/inquiry` 放在仓库根 `functions/`（Pages 自动映射）。
本项目**不这么做**，改用 Astro 路由：

```ts
// src/pages/go/[plan].ts
export const prerender = false;
export async function GET({ params, request }) { /* 记录 + 302 */ }
```

**理由**：根目录 `functions/` 在 `npm run dev` 里**完全不生效**，
本地没法测跳转逻辑，只能靠部署后验证。Astro 路由在 dev 里直接可跑，
并且 node / cloudflare 两种适配器下行为一致。

（参考项目在 `functions/` 里放 AI 检索，是因为那个逻辑依赖 esbuild 打包环境、
必须绕开 Vite；本项目没有这个约束，所以选更省事的方案。）

#### 2. `/go/[plan]` 追踪层

```
用户点「查看当前价格」 → /go/cn2-gia-e-1gb
                          ↓
              302 → https://bandwagonhost.com/aff.php?aff=xxx&pid=44
                          ↓
              同时记录 { plan, ts, referer, country } 到日志
```

- 响应头带 `X-Robots-Tag: noindex, nofollow`，绝不进索引；
- 为什么值得多一跳：**服务器端点击日志**。GA4 会被广告拦截器吃掉，
  而 aff 点击是你唯一真正关心的数字，必须有服务端记录。
- 落地：Phase 1 打 `console.log`（Pages 实时日志可见）+ GA4 出站事件；
  Phase 2 接 Cloudflare Analytics Engine 或 KV 做持久化统计。

**同时保留直链兜底**：如果用户禁用了 JS 或跳转失败，页面上的链接
`href` 直接指向 aff 地址，并带 `rel="sponsored nofollow noopener" target="_blank"`。
（`sponsored` 是 Google 对联盟链接的明确要求，不加可能被判为链接作弊。）

#### 3. 第一阶段不做全量 i18n

参考项目踩过的最大技术债是"中英两套近乎重复的页面文件，改一处要改两边"。
本项目第一阶段**中文单语**，但预留英文能力：

- 集合里保留 `nameEn` / `titleEn` 等可选字段（不填不渲染）；
- `astro.config.mjs` 的 `site` 与 `SeoHead` 支持 `hreflang`；
- 需要英文时**只翻译核心 30 页**（首页、套餐总览、主力套餐、指南、对比），
  其余用 `noindex` 排除，**不做 `/en/` 全量镜像**。

#### 4. 交互全部渐进增强，公开页保持 0 外部脚本

需要交互的四件事，全部用内联 vanilla JS 实现（合计目标 < 2 KB）：

| 交互 | 实现 | 无 JS 时的降级 |
| :--- | :--- | :--- |
| 套餐选择器 | 内联 JS 改 DOM | 直接渲染成"场景 → 推荐套餐"的静态表格 |
| 优惠码复制 | `navigator.clipboard` | 显示完整优惠码文本，可手选 |
| 对比表筛选 | 内联 JS 显隐行 | 全表可见 |
| TOC 滚动高亮 | IntersectionObserver | 静态锚点列表 |

**理由**：参考项目的公开页做到了 0 外部脚本，Core Web Vitals 全绿。
技术用户对"打开就卡"的站零容忍。Keystatic 后台那 3 MB 的 React 岛
只挂在 `/keystatic`，绝不能漏进公开页。

#### 5. Keystatic 用 local 模式，接受"本地编辑 + git push"

`storage.kind = 'local'` 意味着后台只在 `npm run dev` 时可用，
线上没有 `/keystatic` 入口，也**没有攻击面**。

代价：改内容必须在本机做，然后 `git add/commit/push`。
这是参考项目用户最高频的踩坑点——**后台保存 ≠ 提交**，保存只改工作区文件。

**升级路径**：如果后面想用手机改价格，切 Keystatic 的 GitHub 模式
（需要 GitHub App + OAuth + `KEYSTATIC_SECRET`，且 `/api/keystatic` 要以
`prerender = false` 形式运行）。架构上不冲突，但**不要一开始就上**——
多一层认证就多一类故障。

#### 6. 必须记住的三个环境事实（来自参考项目实测）

| 事实 | 后果 |
| :--- | :--- |
| 输出目录是 **`dist/client`** 而不是 `dist` | Cloudflare 默认填 `dist` → **整站 404**。上线最大坑 |
| 本地构建必须 `NODE_OPTIONS= npm run build` | safe-delete shim 经 `NODE_OPTIONS` 注入，会在清空 outDir 时死锁，构建卡死几十分钟 |
| dev 与 build 必须隔离 Vite 缓存目录 | 否则 Keystatic 白屏（`504 Outdated Optimize Dep`），排查成本极高 |

第三点靠 `astro.config.mjs` 里一行解决：

```js
vite: { cacheDir: process.env.npm_lifecycle_event === 'dev' ? 'node_modules/.vite-dev' : undefined }
```

---

## 六、UI / UX 设计

### 设计定位

用户是技术人群。他们要的是**信息密度 + 可信度**，不是营销感。

- 视觉：数据优先、表格清晰、留白克制、层级靠字重和分隔线而不是大色块；
- 语气：平铺直叙，给结论也给依据，不用感叹号，不用"超值""史上最低"；
- 信任元素比装饰元素重要：更新时间、数据来源、实测方法、退款提示、联盟披露。

**默认浅色**（长文与表格在浅色下更易读），提供深色模式切换并记住偏好。
参数与价格数字统一用 `font-variant-numeric: tabular-nums` + 等宽字体，
保证纵向对齐——这一条对表格站是刚需。

### 关键组件（决定成败的七个）

| 组件 | 作用 | 设计要点 |
| :--- | :--- | :--- |
| **PlanCompareTable** | 决策核心 | 首列 sticky；差异行高亮；每行末尾带 CTA；窄屏改卡片堆叠而非横向滚动 |
| **PricingTable** | 价格呈现 | 同时显示 原价 / 现价 / **折算月价** / 续费价；明确标注"税前、以结账页为准" |
| **ScenarioChooser** | 转化利器 | 3 步问答（用途 / 预算 / 技术程度）→ 推荐 1–2 个套餐，给出推荐理由 |
| **LatencyTable** | 可信度 | 实测延迟 + 测试方法 + 测试时间；配测试 IP 和测试文件链接 |
| **VerdictBox** | 结论先行 | 每页顶部 TL;DR，3–5 条；同时服务读者和 AI 引擎 |
| **UpdateStamp** | 时效信任 | "价格最后核对于 YYYY-MM-DD"；超期自动变黄条 |
| **AffiliateDisclosure** | 合规 | 简洁明确，放正文上方而非藏页脚 |

其余组件：Hero / SpecTable / ProsCons / FaqAccordion / CtaBand / RelatedGrid /
CopyButton / FilterBar / TOC / StickyCta / TrustBar。

### 移动端

中文 VPS 相关内容有大量手机流量。移动端策略：

- 对比表**改卡片堆叠**，每张卡片只显示该场景最关键的 4 个字段，其余折叠；
- CTA 底部吸附条（滚动过首屏后出现，不遮挡内容）；
- 表格横向滚动只在"完整参数表"里保留，决策表不用。

### 性能预算

| 指标 | 预算 |
| :--- | :--- |
| 首屏 HTML（gzip） | < 30 KB |
| 关键 CSS（gzip） | < 20 KB |
| 公开页外部 JS | 0 个 |
| 内联 JS | < 2 KB |
| LCP | < 1.5 s（4G） |
| 图片 | 构建期转 AVIF + WebP，显式宽高，非首屏 `loading="lazy"` |

### 无障碍

表格必须有 `<caption>` 和 `scope`；对比度 ≥ 4.5:1；焦点环可见；
选择器结果用 `aria-live` 播报。这些同时也是 SEO 加分项（语义化 HTML）。

---

## 七、SEO 方案

### 结构化数据矩阵

| 页面 | JSON-LD |
| :--- | :--- |
| 全站 | `Organization` + `WebSite`(带 SearchAction) |
| 套餐详情 | `Product` + `Offer` + `BreadcrumbList` + `FAQPage` |
| 机房 / 线路 / 术语 | `DefinedTerm` 或 `Place` + `BreadcrumbList` |
| 教程 | `HowTo` + `BreadcrumbList` + `FAQPage` |
| 对比页 | `ItemList` + `FAQPage` |
| 实测页 | `Dataset` + `Article` |
| 文章 | `Article` + `BreadcrumbList` |

**明确不用**：`AggregateRating` / `Review`（自评违规）、伪造的 `availability`、
没有依据的 `award`。

### 内链枢纽

四个枢纽页承载大部分权重传递：

```
/lines/cn2-gia/  ←── 被 plans / datacenters / compare / glossary / guides 引用
/plans/          ←── 所有 guides 的默认落点
/guides/beginner/←── 首页主 CTA 目标
/deals/          ←── 全局导航常驻 + 每个套餐页 CTA 附近
```

**三角互链**：术语页 ↔ 线路页 ↔ 套餐页。用户在任意一角进入，都能走到另外两角。
每个套餐页固定链接到：2 个机房 + 1 条线路 + 2 篇教程 + 1 个对比 + 2 个相关套餐。

锚文本用真实关键词（"CN2 GIA 与 CN2 GT 的区别"），不用"点击这里"。

### 时效性治理

这个品类的关键词高度依赖时效（价格、优惠码、活动）。做法：

- `plans.pricing.priceCheckedAt` 驱动页面上的核对时间戳；
- Title 在**确实更新过**的情况下带年月：`搬瓦工 CN2 GIA-E 套餐价格与参数（2026 年 9 月核对）`；
  没更新就不加，避免变成日期垃圾；
- `deals.expiresAt` 到期后页面**保留**，状态改为"已过期"并给出当前有效活动；
- 每次价格复核更新 `updatedAt`，`sitemap` 的 `lastmod` 跟着走。

### 中文搜索的额外动作

- 提交百度资源平台 + **主动推送 API**（可在构建后跑一次脚本推送新增 URL）；
- Bing Webmaster 同样提交（Bing 对这类内容的收录速度比百度快，且是 ChatGPT 检索的底层）；
- 百度收录慢是常态，不要因为"百度没收录"就改技术方案；
- **敏感词规避**是百度不降权的前提，见 CONTENT-PLAN 第七节。

---

## 八、GEO 方案（生成式引擎优化）

用户越来越直接问 AI"搬瓦工哪个套餐适合建站"。目标是让 AI 引用**你**。

AI 引用内容的偏好很明确：**有结论、有数据、有日期、能验证、结构清晰。**
对照设计：

| 做法 | 具体实现 |
| :--- | :--- |
| **结论先行** | 每页顶部 `VerdictBox`，前 60 字内给出明确答案，不铺垫 |
| **可验证数据** | 每个数字标注来源与测试时间（工具、样本量、时间段） |
| **结构化事实** | 参数用真 `<table>`，不用图片；对比用数据字段生成，AI 可解析 |
| **实体一致** | 全文统一使用「搬瓦工」「BandwagonHost」「BWH」「IT7 Networks」，帮助实体消歧 |
| **定义句** | 术语页首句就是标准定义句，格式「X 是指……」，AI 最爱抓这个句式 |
| **明确日期** | 页面显示"最后更新"，`Article.dateModified` 一致 |
| **开放抓取** | robots 显式 Allow GPTBot / ClaudeBot / PerplexityBot / OAI-SearchBot / Google-Extended / Bytespider / Baiduspider |
| **llms.txt** | 站点总览 + 事实表 + 引用指引，**由脚本从内容生成**，不手写（手写必然腐坏） |
| **llms-full.txt** | 关键页正文拼接，供长上下文引擎一次读完 |

### 两个反直觉的要点

1. **给 AI 一个答案，不要给一堆选项。**
   对比页必须写 `verdict`。AI 不会自己从五个维度里推出结论，
   但会原样引用你已经写好的结论。没结论的页面 AI 只当资料，不当来源。

2. **对 AI 不要用促销话术。**
   "史上最低价""闭眼入"这类文本会降低被引用概率——
   生成式引擎倾向于引用中性、事实性的表述。
   优惠信息照实写（"当前可叠加的优惠码为 X，有效期至 Y"），
   但不要包装成广告词。

---

## 九、转化与追踪

### 三条转化路径

```
路径 1（短，高意图）
  搜"搬瓦工优惠码" → /deals/ → 套餐页 → /go → 下单

路径 2（中，主流）
  搜"搬瓦工怎么样 / 哪个套餐好" → /guides/beginner/ → 选择器 → 套餐页 → /go

路径 3（长，留存）
  搜"KiwiVM 重装系统" → 教程页 → 侧栏"当前套餐与续费优惠" → /go（续费）
```

每条路径都要有明确 CTA 落点。CTA 文案避免"立即购买"，用
**"查看该套餐当前价格"**——它承诺的是信息而不是交易，点击率更高，
也不会让读者产生被推销的抵触。

### 埋点事件

| 事件 | 触发 | 用途 |
| :--- | :--- | :--- |
| `plan_view` | 套餐页浏览 | 哪些套餐有人看 |
| `compare_interact` | 操作对比表/筛选 | 决策关注点 |
| `chooser_complete` | 选择器出结果 | 场景分布 |
| `coupon_copy` | 复制优惠码 | 优惠页效果 |
| `aff_click` | 点击推广链接（GA4 出站 + 服务端日志） | **核心指标** |
| `price_stale_view` | 看到过期价格提示 | 内容腐坏程度 |

`aff_click` 是唯一真正要盯的数字。GA4 出站事件会丢，服务端日志不会——
这就是 `/go/[plan]` 存在的理由。

---

## 十、部署与发布

### Cloudflare Pages 配置

| 项 | 值 |
| :--- | :--- |
| Framework preset | Astro |
| Build command | `ADAPTER=cloudflare npm run build` |
| **Build output directory** | **`dist/client`** ← 填错整站 404 |
| Node version | 环境变量 `NODE_VERSION=22` |
| 环境变量 | `ADAPTER=cloudflare`、`SITE_URL=https://你的域名` |
| 生产分支 | `main` |

### 本地命令

```bash
npm run dev                      # 开发（含 /keystatic 后台）
NODE_OPTIONS= npm run build      # 本地构建 —— 必须带这个前缀，否则卡死
npm run verify                   # 全量自检
```

### 发布流程（Keystatic 保存 ≠ 提交）

```bash
git status --short && git diff     # 先看改了什么
git add -A
git commit -m "更新 XX 套餐价格"
git push origin main               # 本机已配 github 代理，不用带参数
```

推完 Cloudflare 约 1–2 分钟自动重建。

> 本机 `~/.gitconfig` 已配 `http.https://github.com.proxy = http://127.0.0.1:10809`
> （v2rayN 的 HTTP 端口）。v2rayN 没开时 push 会失败，属正常。

---

## 十一、自检体系

参考项目最值钱的经验之一：**每次修完 bug 就固化成可重跑的检查。**

| 命令 | 作用 | 基线 |
| :--- | :--- | :--- |
| `npm run verify` | check + 全部内容测试 + build + audit | 全绿 |
| `npm run check` | `astro check` 类型检查 | 0 errors |
| `npm run test:content` | slug 唯一、必填非空、关联 slug 有效 | — |
| `npm run test:keystatic` | **Zod schema 与后台表单字段一致性** | 全绿 |
| **`npm run test:affiliate`** | ★ 每个套餐能生成合法 aff URL（affId 存在、pid 格式合法、URL 可解析） | 全绿 |
| **`npm run test:freshness`** | ★ 价格/优惠码新鲜度，超期告警 | 0 超期 |
| `npm run test:links` | 站内链接目标存在，无死链 | 0 死链 |
| `npm run audit` | 产物检查：每页有 canonical/description/JSON-LD，`/keystatic` 与 `/go` 未泄漏进 sitemap | 全绿 |
| `npm run smoke` | 路由冒烟（需 dev server） | 全 200 |
| `npm run check:admin` | Keystatic 白屏诊断（需 dev server） | 全绿 |
| `npm run admin:reset` | 清 Vite / Astro 缓存 | — |
| `npm run gen:llms` | 从内容生成 `llms.txt` / `llms-full.txt` | — |

### 两个本项目特有的检查

**`test:affiliate`** —— 联盟链接是这个站唯一的收入通道。
affId 写错、pid 抄错、参数名拼错，页面看起来一切正常，但一分钱都不会进账。
所以必须有自动化检查把"格式类错误"挡在构建期，人工只负责核对"值对不对"。

**`test:freshness`** —— 价格和优惠码是这个品类的核心价值，也是最容易腐坏的部分。
过期价格会直接导致读者流失和信任崩塌。让脚本而不是记忆来提醒复核。

> 容易记混：`test:keystatic` 查的是**字段定义一致性**（`schemas.ts` vs `keystatic.config.ts`），
> `test:content` 查的是**内容本身**（slug、必填、关联）。改字段跑前者，改内容跑后者。

**为什么 `test:keystatic` 不可或缺**：两份 schema 漂移时，后台会报
"field not found"或静默丢字段，而 `npm run build` 完全察觉不到——
因为构建走的是 Zod 那条路。这个测试本该一开始就写。

---

## 十二、分期实施

| 阶段 | 内容 | 产出 |
| :--- | :--- | :--- |
| **P0 地基** | 项目骨架、`astro.config`、Tailwind、`schemas.ts`、`cms.ts`、`affiliate.ts`、`BaseLayout`、`SeoHead`、`robots`/`_headers`/`_redirects`、Cloudflare Pages 空站上线 | 线上能打开一个空首页，CWV 全绿 |
| **P1 数据骨架** | `plans` / `datacenters` / `lines` 三集合 + 总览页 + 详情页 + `PlanCompareTable` + `PricingTable` + `test:content` / `test:keystatic` / `test:affiliate` | 套餐体系可用，链接可验证 |
| **P2 决策层** | `guides` / `compare` / `deals` + `ScenarioChooser` + `/go/[plan]` + 首页 + `affiliate` 单例 | 三条转化路径打通 |
| **P3 留存与长尾** | `tutorials` / `benchmarks` / `glossary` + 站内搜索 + TOC + `test:freshness` / `test:links` | 护城河层建成 |
| **P4 增长** | `posts` / `faqs` + RSS + `llms.txt` 生成脚本 + GA4 事件 + 百度主动推送 | 可被搜索与 AI 引用 |
| **P5 内容填充** | 10 个主力套餐、6 个机房、3 条线路、5 篇指南、15 篇教程、20 条术语 | 可发布状态 |
| **P6 可选** | AI 问答（构建期冻结语料）、英文核心页、Keystatic GitHub 模式 | 按需 |

**P5 是真正的瓶颈**。技术骨架大约 5–7 个工作日能跑通，
但内容填充是持续工作——**没有内容的站，架构再好也是零。**

---

## 十三、风险与合规

| 风险 | 应对 |
| :--- | :--- |
| **联盟披露** | 每页显著位置声明"本站含联盟链接，你通过链接购买我们会获得佣金，价格不变"。这既是 FTC / 广告法要求，也提升信任 |
| **敏感内容** | 全站禁用词表，不写网络访问规避类内容（见 CONTENT-PLAN 第七节） |
| **价格错误** | 全部标"税前美元价，以官网结账页为准"；`priceCheckedAt` + `test:freshness` 兜底 |
| **绝对化用语** | 不用"最好/第一/唯一/最便宜"，广告法风险 + 降低 AI 引用概率 |
| **数据可信度** | 实测页必须写清方法、工具、时间、样本量；不编造测试结果 |
| **后台安全** | local 模式下线上无 `/keystatic`，无攻击面；切 GitHub 模式时必须配 `KEYSTATIC_SECRET` |
| **页面删除** | 有排名的页面永不直接删，改状态或 301 |
| **竞品镜像** | 不复制其他站内容；搬瓦工官方参数可引用但需标注来源 |

---

## 十四、待确认的决策点

实施前需要你确认这几件事：

1. **项目根目录**：用现有的 `D:\Bwh\stellar-shell`（已是干净的 Astro 工程，只需补依赖），
   还是在 `D:\Bwh\` 下新建目录？另外 `stellar-shell` 这个名字要不要改？
2. **域名**：定了吗？影响 `site` 配置、canonical、sitemap、llms.txt。
3. **aff 账号**：已经有 affId 了吗？没有的话要先去搬瓦工后台申请（需要先注册账号）。
4. **单语确认**：同意第一阶段只做中文、不做 `/en/` 全量镜像吗？
5. **主题**：浅色默认 + 深色可切换，可以吗？
6. **发布方式**：接受"本地 Keystatic 编辑 → git push"吗？
   （不接受的话要上 GitHub 模式，成本高一档）
7. **`/go/` 追踪**：要不要这一层？要的话多一个动态路由，但能拿到服务端点击数据。
