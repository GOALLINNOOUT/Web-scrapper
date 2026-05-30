export interface PageClassification {
  pageType: string;
  confidence: number;
}

const RULES: Array<[RegExp, string, number]> = [
  [/\/contact|contact-us|support/i, 'contact', 0.92],
  [/\/blog|\/article|\/news|\/posts/i, 'article', 0.82],
  [/\/pricing|\/plans/i, 'pricing', 0.9],
  [/\/careers|\/jobs|\/hiring/i, 'jobs', 0.9],
  [/\/about|company/i, 'about', 0.78],
  [/\/product|\/solutions|\/features/i, 'product', 0.74]
];

export function classifyPage(url: string, title = ''): PageClassification {
  const haystack = `${url} ${title}`;
  for (const [pattern, pageType, confidence] of RULES) {
    if (pattern.test(haystack)) return { pageType, confidence };
  }
  return { pageType: 'general', confidence: 0.45 };
}
