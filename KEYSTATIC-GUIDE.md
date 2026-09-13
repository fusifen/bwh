# Keystatic 使用指南

本站的内容后台由 Keystatic 驱动，`storage.kind = 'local'` —— 表单直接读写 `src/content/` 下的 JSON 文件，内容随 Git 走，线上**不暴露后台**。

---

## 启动

```bash
npm run dev          # http://localhost:4321
```

后台地址：**http://localhost:4321/keystatic**

后台只在 dev 模式存在。构建产物里没有它，线上也没有任何攻击面 —— 这是选 `local` 存储而不是 GitHub 存储的主要理由：不需要 OAuth、不需要第三方回调、不需要给仓库写权限。

---

## 最重要的一件事：双 schema 契约

内容字段定义在**两个地方**，它们必须一致：

| 文件 | 作用 | 谁在用 |
| :--- | :--- | :--- |
| `src/lib/schemas.ts` | Zod schema | **构建**。页面渲染、类型检查、所有自检脚本 |
| `keystatic.config.ts` | 表单定义 | **后台**。你在浏览器里看到的输入框 |

**为什么危险**：构建只走 Zod 那条路，后台只走 Keystatic 那条路，两边不会互相报错。漂移的后果是静默的：

- 后台能写、Zod 不认识 → 字段被**静默剥离**，内容看起来保存了，页面不显示
- Zod 必需、后台不能写 → 每次保存都**构建失败**，但后台不会提醒你

两种都不会在 `npm run build` 里暴露出来。

**防线**：`npm run test:keystatic`

```bash
npm run test:keystatic
```

它比对两边的集合注册表、逐字段比对定义，并且要求 `storage.kind === 'local'`。改任何一个 schema 之后都要跑它。

**怎么改才安全**：枚举值不要在 `keystatic.config.ts` 里手写。它已经从 `schemas.ts` import 了所有枚举（`PLAN_SERIES`、`PLAN_TIERS`、`TUTORIAL_CATEGORIES` 等），下拉选项由这些常量生成 —— 这是唯一能保证两边不漂移的写法。加一个新枚举值时，只改 `schemas.ts`，后台会自动跟上。

---

## 内容工作流

1. `npm run dev`
2. 打开 `/keystatic`，选集合，编辑
3. 保存 → 文件立刻写到 `src/content/`，dev 热重载
4. 提交前跑 `npm run verify:dev`（或至少 `npm run test:content`）

**不要手工编辑 JSON 里那些后台没有的字段**，除非你同时改两边 —— 见上面的双 schema 契约。

---

## 字段约定

### 通用

| 字段 | 说明 |
| :--- | :--- |
| `slug` | URL 段。只能小写字母、数字、连字符（`test:content` 会校验）。改了 slug 等于换了 URL |
| `order` | 列表排序，数字小的在前 |
| `updatedAt` | **必填**。驱动新鲜度检查与 `/changelog` 页面 |
| `publishedAt` | 可选。仅资讯与指南使用 |
| `seo.title` / `seo.description` | 留空则用页面自己的标题与摘要 |

### 套餐（`plans`）

转化主战场，字段最多。几个需要特别说明的：

**`affiliate.pid`** —— 搬瓦工商品编号。**这是唯一决定「点击落到哪个商品」的字段。**

- 填 `"0"` 或留空 = 未填写，链接会回落到通用落地页（宁可转化低，也不跳到错的套餐）
- 填写后必须打开生成的链接确认落到正确购买页，然后把 `affiliate.verified` 设为 `true`
- `npm run test:affiliate` 会列出所有未验证的套餐

**`notFor`** —— 谁**不该**买这个套餐。这不是客套话，是收入设计：

> 搬瓦工新账号有 30 天全额退款，退款会**回吐佣金**。把一个不匹配的买家劝走，比让他买了再退更值钱。

写的时候要具体（「访问者主要在欧美，为 CN2 GIA 付的溢价买不到收益」），不要写「可能不适合所有人」这种废话。

**`summary`** —— 结论先行的一句话。它同时是页面摘要、搜索结果摘要和 `llms.txt` 的条目内容。

**`scores`** —— 编辑评分（1–5）。页面上明确标注这是编辑判断、不是用户评价，并且**不提交为结构化数据**（Google 禁止自评 `Review` 片段）。

### 指南（`guides`）

每个 `intent` 对应一个场景。`sections` 是小节数组，每节 `heading` + `body`（Markdown）。`verdict` 必须是一句能独立成立的结论 —— 它会被单独渲染在最前面，也是生成式引擎最爱引用的部分。

### 术语（`glossary`）

- `shortDef` —— **一句话定义**，必须写成「X 是指……」的形式。这是全站最容易被引用的字符串
- `fullDef` —— Markdown 展开说明
- `seeAlso` —— 站内路径数组，`test:links` 会逐个校验
- 反向链接是自动的：术语页会扫描套餐/线路/机房正文里是否出现 `/glossary/{slug}`

### 教程（`tutorials`）

`steps` 是**结构化**的，不是一坨 Markdown —— 它同时产出 `HowTo` 结构化数据和可见的步骤列表。`troubleshooting` 是三列表（现象/原因/处理）。

### 问答（`faqs`）

一个共享池子。`related` 决定这条问答出现在哪些实体页上（`plans` / `datacenters` / `lines` / `tutorials` / `glossary` / `deals` 各一个 slug 数组），所以同一个答案不会写两遍然后慢慢跑偏。

### 优惠（`deals`）

`status` 是**存储状态**，页面展示状态由日期重算 —— 过期条目会自动降级但仍然保留（有搜索价值）。`test:freshness` 会检查两者是否矛盾。

---

## 广告合规红线

本站的定位是「海外服务器 / 跨境建站 / 开发测试环境 / 学习 Linux」。**不要**出现下列词：

> 翻墙、梯子、科学上网、机场、V2EX 代理、V2Ray、Clash、Shadowsocks、SSR、突破封锁、解锁流媒体

写内容时如果发现某个用途描述绕不开这些词，说明这个用途不该写。

另外，**任何 CTA 附近必须有联盟披露**。组件已经内建（`AffiliateDisclosure`），手写 CTA 时别漏。

---

## 故障排查

### 后台白屏（页面空白，但返回 200）

最常见的原因：Vite 依赖预打包缓存被覆盖，模块返回 `504 Outdated Optimize Dep`，React 岛永远不会 hydrate。

```bash
npm run check:admin     # 先诊断
npm run admin:reset     # 清理缓存
npm run dev             # 重启
```

`astro.config.mjs` 已经把 dev 的 `cacheDir` 隔离到 `node_modules/.vite-dev`，所以正常情况下 dev 与 `build`/`check` 不会互相覆盖。如果你在跑 `astro check` 或构建时看到后台白屏，那是别的原因。

### 字段保存了但页面不显示

双 schema 漂移。跑 `npm run test:keystatic`。

### 保存后构建失败

也是漂移，方向相反：Zod 要求某个字段，但后台没有对应的输入框。跑 `npm run test:keystatic`，然后补上表单字段（或把 Zod 那边改成可选）。
