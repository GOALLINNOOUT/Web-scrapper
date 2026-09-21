import type { CheerioAPI } from 'cheerio';

export interface ContentSummary {
  text: string;
  headings: string[];
  paragraphs: string[];
  wordCount: number;
}

const CONTENT_ROOT_SELECTORS = [
  'main',
  'article',
  '[role="main"]',
  '[data-testid*="description" i]',
  '[data-testid*="job" i]',
  '[class*="job-description" i]',
  '[class*="job-detail" i]',
  '[class*="job-content" i]',
  '[class*="posting" i]',
  '[class*="description" i]'
].join(',');

const NOISE_SELECTORS = 'script, style, noscript, svg, nav, header, footer, [aria-hidden="true"], [hidden]';

export function extractContent($: CheerioAPI, visibleText = ''): ContentSummary {
  $(NOISE_SELECTORS).remove();

  const headings = uniqueText($('h1,h2,h3,h4,[role="heading"]')
    .map((_index, element) => $(element).text()).get())
    .slice(0, 30);

  const paragraphs = uniqueText($(CONTENT_ROOT_SELECTORS)
    .find('p, li, [role="listitem"]')
    .add('main p, article p, [role="main"] p, body p, li')
    .map((_index, element) => $(element).text()).get())
    .filter((value) => value.length > 20)
    .slice(0, 30);

  const visibleLines = uniqueText(visibleText.split(/\r?\n/))
    .filter((value) => value.length > 20)
    .slice(0, 60);
  const fallbackParagraphs = paragraphs.length > 0 ? paragraphs : visibleLines.slice(0, 30);
  const contentParts = uniqueText([...headings, ...fallbackParagraphs]);
  const text = normalizeText(contentParts.join('\n') || visibleText);
  const wordCount = text ? text.split(/\s+/).length : 0;

  return {
    text: text.slice(0, 8_000),
    headings,
    paragraphs: fallbackParagraphs,
    wordCount
  };
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
