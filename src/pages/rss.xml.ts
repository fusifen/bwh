/**
 * RSS feed.
 *
 * Carries the article-shaped content — guides, tutorials and posts — rather
 * than every collection. A feed that emits a new item every time a price is
 * re-checked trains subscribers to ignore it; a feed that emits the things
 * worth reading keeps its subscribers.
 */
import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getGuides, getPosts, getTutorials, SITE } from '../lib/cms';
import { markdownToPlainText } from '../lib/markdown';
import { SITE_ORIGIN } from '../config/site';

interface FeedItem {
  title: string;
  description: string;
  link: string;
  pubDate: Date;
  categories: string[];
}

/** Dates come from content as `YYYY-MM-DD`; feed readers want a real Date. */
function toDate(value: string | undefined): Date {
  if (!value) return new Date(0);
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export const GET: APIRoute = () => {
  const items: FeedItem[] = [
    ...getGuides().map((guide) => ({
      title: guide.title,
      description: guide.summary,
      link: `/guides/${guide.slug}`,
      pubDate: toDate(guide.publishedAt ?? guide.updatedAt),
      categories: ['选购指南'],
    })),
    ...getTutorials().map((tutorial) => ({
      title: tutorial.title,
      description: markdownToPlainText(tutorial.summary, 240),
      link: `/learn/${tutorial.slug}`,
      pubDate: toDate(tutorial.publishedAt ?? tutorial.updatedAt),
      categories: ['教程'],
    })),
    ...getPosts().map((post) => ({
      title: post.title,
      description: post.summary,
      link: `/blog/${post.slug}`,
      pubDate: toDate(post.publishedAt ?? post.updatedAt),
      categories: ['资讯', ...post.tags],
    })),
  ];

  // Newest first. Items with no usable date sort to the end rather than the top.
  items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: `${SITE.siteName} · ${SITE.tagline}`,
    description: SITE.description,
    site: SITE_ORIGIN,
    items: items.map((item) => ({
      title: item.title,
      description: item.description,
      link: item.link,
      pubDate: item.pubDate,
      categories: item.categories,
    })),
    customData: `<language>${SITE.htmlLang}</language>`,
    stylesheet: false,
  });
};
