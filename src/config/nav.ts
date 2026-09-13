/**
 * Navigation structure.
 *
 * The header carries six items and nothing else. This audience is technical and
 * reads on both desktop and phone; a deep dropdown menu is a worse trade than a
 * flat list plus in-page hub blocks. Everything not in the header lives in the
 * footer or is reached through cross-links, which also spreads internal link
 * equity more evenly than a menu that only ever points at six pages.
 */

export interface NavItem {
  label: string;
  href: string;
  /** Shown in the mobile menu as a one-line explanation. */
  description?: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: '套餐', href: '/plans', description: '全部套餐参数与价格对比' },
  { label: '机房', href: '/datacenters', description: '各机房线路构成与实测延迟' },
  { label: '线路', href: '/lines', description: 'CN2 GIA、CN2 GT 等线路的区别' },
  { label: '对比', href: '/compare', description: '套餐、机房与服务商横向对比' },
  { label: '选购指南', href: '/guides', description: '按使用场景给出推荐' },
  { label: '优惠', href: '/deals', description: '当前有效的优惠码与活动' },
];

export interface FooterGroup {
  title: string;
  items: NavItem[];
}

export const FOOTER_GROUPS: FooterGroup[] = [
  {
    title: '内容',
    items: [
      { label: '教程库', href: '/learn' },
      { label: '实测数据', href: '/benchmarks' },
      { label: '术语词典', href: '/glossary' },
      { label: '常见问题', href: '/faq' },
      { label: '资讯', href: '/blog' },
      { label: '套餐选择器', href: '/tools/chooser' },
    ],
  },
  {
    title: '关于',
    items: [
      { label: '关于本站', href: '/about' },
      { label: '联盟披露', href: '/disclosure' },
      { label: '隐私政策', href: '/privacy' },
      { label: '联系我们', href: '/contact' },
      { label: '更新日志', href: '/changelog' },
    ],
  },
];

/** Ordered list used by the search page's type filter. */
export const SEARCH_TYPE_LABELS: Record<string, string> = {
  plan: '套餐',
  datacenter: '机房',
  line: '线路',
  guide: '指南',
  tutorial: '教程',
  glossary: '术语',
  compare: '对比',
  benchmark: '实测',
  deal: '优惠',
  post: '资讯',
  faq: '问答',
};
