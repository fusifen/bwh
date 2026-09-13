/**
 * A small, dependency-free Markdown renderer.
 *
 * Scope is deliberately narrow: exactly the subset the CMS editor produces —
 * headings, paragraphs, lists, tables, blockquotes, fenced code, horizontal
 * rules, and inline emphasis / code / links. It is not a general-purpose
 * CommonMark implementation and should not be treated as one.
 *
 * Two reasons it lives here rather than behind a library:
 *   1. Public pages ship zero third-party JavaScript, and a parser that runs at
 *      build time only needs to be correct, not fast.
 *   2. It also returns a table of contents, which the article and tutorial
 *      layouts need. A library would give us HTML and then require a second
 *      pass over the DOM to rebuild the outline.
 *
 * Output is escaped before inline formatting is applied, so authored content
 * cannot inject markup. The CMS is trusted, but a renderer that silently allows
 * raw HTML is a footgun the moment content is ever pasted from elsewhere.
 */

export interface TocEntry {
  id: string;
  text: string;
  /** Original heading level (2 = `##`, 3 = `###`). */
  level: number;
}

export interface RenderResult {
  html: string;
  toc: TocEntry[];
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => ESCAPES[ch] ?? ch);
}

/**
 * Build an anchor id from heading text.
 *
 * CJK characters are kept as-is: they are valid in HTML ids and in URL
 * fragments, and transliterating them would make anchors unguessable.
 */
export function slugifyHeading(text: string): string {
  const base = text
    .replace(/`/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[!-/:-@[-`{-~。，、；：？！""''（）《》【】…—·]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'section';
}

/** Strip inline markup so heading text can be reused as plain text. */
export function stripMarkdown(value: string): string {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const external = /^https?:\/\//i.test(href);
    const attrs = external ? ' target="_blank" rel="noopener"' : '';
    return `<a href="${href}"${attrs}>${label}</a>`;
  });
  return out;
}

export function renderMarkdown(source: string): RenderResult {
  const lines = (source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const toc: TocEntry[] = [];

  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let table: string[][] | null = null;
  let quote: string[] = [];
  let inCode = false;
  let code: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const items = list.items.map((item) => `<li>${inline(item)}</li>`).join('');
    out.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  };

  const flushTable = () => {
    if (!table || table.length === 0) return;
    const [head, ...body] = table;
    const thead = `<thead><tr>${head
      .map((cell) => `<th scope="col">${inline(cell)}</th>`)
      .join('')}</tr></thead>`;
    const tbody = `<tbody>${body
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`,
      )
      .join('')}</tbody>`;
    out.push(
      `<div class="table-scroll"><table>${thead}${tbody}</table></div>`,
    );
    table = null;
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    out.push(
      `<blockquote>${quote.map((line) => `<p>${inline(line)}</p>`).join('')}</blockquote>`,
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw;

    /* Fenced code */
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      if (inCode) {
        out.push(
          `<pre class="code-block"><code>${escapeHtml(code.join('\n'))}</code></pre>`,
        );
        code = [];
        inCode = false;
      } else {
        flushAll();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    /* Blank line */
    if (line.trim() === '') {
      flushAll();
      continue;
    }

    /* Heading */
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      flushAll();
      const level = heading[1].length;
      const text = heading[2].trim();
      // The page already owns the h1, so headings shift down one level.
      const tag = `h${Math.min(level + 1, 6)}`;
      const id = slugifyHeading(stripMarkdown(text));
      if (level >= 2 && level <= 4) {
        toc.push({ id, text: stripMarkdown(text), level });
      }
      out.push(`<${tag} id="${id}">${inline(text)}</${tag}>`);
      continue;
    }

    /* Table */
    if (line.trim().startsWith('|')) {
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim());
      // Separator row (|---|---|) only carries alignment, which we don't use.
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      flushParagraph();
      flushList();
      flushQuote();
      table = table ?? [];
      table.push(cells);
      continue;
    }
    flushTable();

    /* Blockquote */
    if (line.trim().startsWith('>')) {
      flushParagraph();
      flushList();
      quote.push(line.trim().replace(/^>\s?/, ''));
      continue;
    }
    flushQuote();

    /* Lists */
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushParagraph();
      const type: 'ul' | 'ol' = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ul ? ul[1] : ol![1]).trim());
      continue;
    }
    flushList();

    /* Horizontal rule */
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push('<hr />');
      continue;
    }

    paragraph.push(line.trim());
  }

  flushAll();
  if (inCode && code.length > 0) {
    out.push(`<pre class="code-block"><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  }

  return { html: out.join('\n'), toc };
}

/**
 * Render Markdown to plain text — used for meta descriptions and for the
 * machine-readable `llms.txt` summary, where tags would be noise.
 */
export function markdownToPlainText(source: string, maxLength = 0): string {
  const text = (source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\|.*\|$/gm, (row) =>
      row
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => !/^:?-{2,}:?$/.test(cell))
        .join(' '),
    )
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (maxLength > 0 && text.length > maxLength) {
    return `${text.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return text;
}
