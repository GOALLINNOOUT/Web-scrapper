import type { CheerioAPI } from 'cheerio';

export interface ContentSummary {
  text: string;
  headings: string[];
  paragraphs: string[];
  wordCount: number;
}

export function extractContent($: CheerioAPI): ContentSummary {
  $('script, style, noscript, svg').remove();
  const headings = $('h1,h2,h3').map((_index, element) => $(element).text().trim()).get().filter(Boolean).slice(0, 30);
  const paragraphs = $('main p, article p, body p').map((_index, element) => $(element).text().trim()).get().filter((value) => value.length > 20).slice(0, 30);
  const text = [...headings, ...paragraphs].join('\n').replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    text: text.slice(0, 8_000),
    headings,
    paragraphs,
    wordCount
  };
}
