import type { ContentSummary } from '../extractors/content.js';
import type { Metadata, SocialLinks } from '../types.js';
import type { PageClassification } from './classifier.js';

export function scorePage(input: {
  metadata: Metadata;
  content: ContentSummary;
  emails: string[];
  social: SocialLinks;
  classification: PageClassification;
}) {
  let score = 0;
  const metadataFields = ['title', 'description', 'canonical', 'ogTitle', 'ogDescription', 'ogImage'] as const;
  score += Math.round((metadataFields.filter((key) => Boolean(input.metadata[key])).length / metadataFields.length) * 20);
  score += Math.min(20, Math.round(input.content.wordCount / 40));
  score += Math.min(15, input.content.headings.length * 3);
  score += input.emails.length > 0 ? 20 : 0;
  score += Object.values(input.social).some((values) => values.length > 0) ? 15 : 0;
  score += Math.round(input.classification.confidence * 10);
  return Math.max(0, Math.min(100, score));
}
