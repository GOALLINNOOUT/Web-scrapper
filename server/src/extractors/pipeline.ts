import * as cheerio from 'cheerio';
import { extractContent } from './content.js';
import { extractEmails } from './emails.js';
import { extractLinks } from './links.js';
import { extractMetadata } from './metadata.js';
import { extractSocialLinks } from './social.js';
import { detectTechStack } from './techStack.js';
import { classifyPage } from '../intelligence/classifier.js';
import { scorePage } from '../intelligence/scorer.js';
import { hashContent } from '../utils/hash.js';

export async function runExtractorPipeline(html: string, url: string, headers: Record<string, unknown> = {}, options: { includeMetaLinks?: boolean } = {}) {
  const $ = cheerio.load(html || '');
  const links = extractLinks($, url, { includeMetaLinks: options.includeMetaLinks ?? true });
  const [emails, metadata, content, techStack] = await Promise.all([
    Promise.resolve(extractEmails(html || '', $)),
    Promise.resolve(extractMetadata($, url)),
    Promise.resolve(extractContent($)),
    Promise.resolve(detectTechStack($, headers, html || ''))
  ]);
  const social = extractSocialLinks(links);
  const classification = classifyPage(url, metadata.title);
  const score = scorePage({ metadata, content, emails, social, classification });

  return {
    links,
    emails,
    metadata,
    social,
    content,
    techStack,
    classification,
    score,
    contentHash: hashContent(content.text || '')
  };
}
