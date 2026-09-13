/**
 * robots.txt.
 *
 * Generated rather than static so the sitemap URL cannot drift from the
 * configured origin — a robots file pointing at the wrong host is a silent way
 * to lose an entire site's indexing.
 *
 * The AI crawlers are listed explicitly and allowed. This site's GEO strategy
 * depends on being quotable by answer engines, and several of them (GPTBot,
 * ClaudeBot, PerplexityBot) respect an explicit `Allow` that a wildcard rule
 * does not guarantee. Being cited is the goal, not a side effect.
 *
 * `/go/` is disallowed for crawlers: it is a redirect with no content, and
 * letting it into the index would put an empty result between a reader and the
 * page they searched for.
 */
import type { APIRoute } from 'astro';
import { SITE_ORIGIN } from '../config/site';

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'Amazonbot',
  'meta-externalagent',
];

const DISALLOWED = ['/keystatic', '/go/', '/search', '/api/'];

export const GET: APIRoute = () => {
  const lines: string[] = [
    '# 本站允许搜索引擎与生成式引擎抓取全部公开内容。',
    '# /go/ 是联盟跳转路径，无正文，不进入索引。',
    '',
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED.map((path) => `Disallow: ${path}`),
    '',
    '# 生成式引擎：显式允许，便于内容被引用。',
    ...AI_CRAWLERS.flatMap((agent) => [
      `User-agent: ${agent}`,
      'Allow: /',
      ...DISALLOWED.map((path) => `Disallow: ${path}`),
      '',
    ]),
    `Sitemap: ${SITE_ORIGIN}/sitemap-index.xml`,
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
