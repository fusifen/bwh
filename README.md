# 瓦工笔记（stellar-shell）

搬瓦工（BandwagonHost）主机的中文内容站，通过联盟链接获取佣金。

**技术栈**：Astro 7（静态输出）+ Keystatic 0.6（本地存储后台）+ Tailwind 4（CSS-first）+ Cloudflare Workers。

---

## 快速开始

```bash
npm install
npm run dev          # http://localhost:4321，后台在 /keystatic
```

**上线前必须完成两件事**（`npm run verify` 会拦住你，直到做完）：

1. `src/content/affiliate.json` 的 `affId` 换成真实的搬瓦工推广 ID
2. 逐个核对 `src/content/plans/*.json` 的 `pid`，确认落到正确购买页后把 `verified` 设为 `true`

这两项无法自动验证 —— 脚本只能确认链接结构合法，不能确认它指向对的商品。

---

## 命令

| 命令 | 作用 |
| :--- | :--- |
| `npm run dev` | 开发服务器 + Keystatic 后台（Node 适配器） |
| `npm run build` | **构建 Cloudflare Workers 产物**（部署用这个） |
| `npm run build:node` | 构建 Node 产物（仅用于 `npm run preview`） |
| `npm run preview` | 本地预览 Node 产物（需先 `build:node`） |
| `npm run check` | 类型检查（`.astro` + TS） |
| `npm run verify` | 完整校验：类型 + 5 项内容检查 + 构建 + 产物审计 |
| `npm run verify:dev` | 同上，但允许占位 affId / 占位域名（开发期用） |
| `npm run smoke` | 路由冒烟测试（需 dev 或 preview 在跑） |
| `npm run check:admin` | 后台白屏诊断（需 dev 在跑） |
| `npm run admin:reset` | 清理 Vite 缓存，修后台白屏 |

单跑某一项检查：`npm run test:content`、`test:keystatic`、`test:affiliate`、`test:freshness`、`test:links`、`audit`。

---

## 部署

目标是 **Cloudflare Workers**（不是 Pages —— `@astrojs/cloudflare` 已移除 Pages 支持）。

```bash
npm run build -- --site=https://your-domain.example
npx wrangler deploy
```

**上线前先空跑一次**（不上传，只校验配置与产物，几秒钟）：

```bash
npx wrangler deploy --dry-run
```

仓库根**没有** `wrangler.json`，这是刻意的 —— Wrangler 通过构建生成的
`.wrangler/deploy/config.json` 找到 `dist/server/wrangler.json`，配置只有适配器一个来源。
所以必须先构建、再部署，顺序不能反。

产物结构：

```text
dist/client   整个静态站（页面、_assets、_headers、_redirects）
dist/server   Worker：entry.mjs + 自动生成的 wrangler.json
```

`wrangler.json` 是自动生成的，因为本项目没有声明任何绑定。`session: false` 是刻意设置的 —— Astro 默认开启会话，Cloudflare 适配器随之声明一个 `SESSION` KV 命名空间，而这个站没有用户、没有登录、没有服务端状态。

---

## 内容模型

**12 个集合**（每个一个目录，JSON 一个文件一条）：

| 集合 | 路径 | 作用 |
| :--- | :--- | :--- |
| `plans` | `/plans/{slug}` | 套餐详情，转化主战场 |
| `datacenters` | `/datacenters/{slug}` | 机房说明 |
| `lines` | `/lines/{slug}` | 线路说明，含 GEO 用的定义句 |
| `compare` | `/compare/{slug}` | 两个对象的对比 |
| `guides` | `/guides/{slug}` | 场景选购指南（支柱页） |
| `tutorials` | `/learn/{slug}` | 操作教程，结构化步骤 |
| `benchmarks` | `/benchmarks/{slug}` | 实测数据 |
| `glossary` | `/glossary/{slug}` | 术语，含反向链接 |
| `deals` | `/deals/{slug}` | 优惠条目 |
| `posts` | `/blog/{slug}` | 资讯 |
| `faqs` | `/faq` | 问答池，一个池子渲染到多处 |
| `scenarios` | 首页 / 选择器 | 场景分流 |

**5 个单例**：`site`、`home`、`about`、`disclosure`、`affiliate`。

---

## 代码地图

```text
src/lib/
  schemas.ts      内容契约（Zod），驱动构建期校验
  cms.ts          唯一数据入口 —— 页面永不直接 import JSON
  affiliate.ts    唯一生成推广链接的地方（零依赖）
  seo.ts          JSON-LD 构建器
  markdown.ts     零依赖 Markdown 渲染器
  format.ts       中文格式化（价格、流量、日期）
  freshness.ts    内容新鲜度判定
src/config/
  site.ts         站点级常量
  nav.ts          导航结构与搜索类型标签
src/components/   34 个组件（layout / sections / cards / ui / seo）
src/pages/        33 个页面与端点（30 个 .astro + 3 个数据端点）
scripts/          11 个脚本（8 项检查 + 2 个工具 + 1 个构建包装）
```

构建产出 69 个 HTML 页面（67 个可索引 + 2 个 noindex）。

**两条收口规则**，改代码时请守住：

- **数据只从 `cms.ts` 进**。页面里出现 `import ... from '../content/*.json'` 就是错的。
- **链接只从 `affiliate.ts` 出**。任何地方手写 `bandwagonhost.com/aff.php` 都是错的。

---

## 文档

- [`PLAN.md`](./PLAN.md) —— 架构与实现规划
- [`CONTENT-PLAN.md`](./CONTENT-PLAN.md) —— 内容规划
- [`KEYSTATIC-GUIDE.md`](./KEYSTATIC-GUIDE.md) —— 后台使用与双 schema 契约
- [`DEVELOPMENT-NOTES.md`](./DEVELOPMENT-NOTES.md) —— 踩过的坑与设计决策
