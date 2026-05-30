import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import { normalizeCrawlConfig } from '../src/crawler/config.js';
import { extractEmails } from '../src/extractors/emails.js';
import { extractLinks } from '../src/extractors/links.js';
import { extractMetadata } from '../src/extractors/metadata.js';
import { extractSocialLinks } from '../src/extractors/social.js';
import { detectTechStack } from '../src/extractors/techStack.js';
import { isPrivateHost, isPrivateUrl } from '../src/middleware/ssrfProtection.js';
import { sanitizeDeep } from '../src/middleware/inputSanitizer.js';
import { isSameDomain, normalizeUrl } from '../src/utils/url.js';

test('normalizes URLs and rejects invalid schemes', () => {
  assert.equal(normalizeUrl('vercel.com'), 'https://vercel.com/');
  assert.equal(normalizeUrl('/about#team', 'https://example.com/'), 'https://example.com/about');
  assert.equal(normalizeUrl('https://example.com/docs/'), 'https://example.com/docs');
  assert.equal(normalizeUrl('mailto:test@example.com', 'https://example.com'), null);
  assert.equal(normalizeUrl('not-a-real-host'), null);
});

test('checks same-domain links', () => {
  assert.equal(isSameDomain('https://example.com/a', 'https://example.com'), true);
  assert.equal(isSameDomain('https://www.example.com/a', 'https://example.com'), true);
  assert.equal(isSameDomain('https://example.com/a', 'https://www.example.com'), true);
  assert.equal(isSameDomain('https://docs.example.com/a', 'https://example.com'), false);
});

test('extracts and deduplicates emails', () => {
  assert.deepEqual(extractEmails('Hi A@EXAMPLE.com and a@example.com'), ['a@example.com']);
});

test('filters asset and telemetry email-shaped false positives', () => {
  const html = `
    layers@2x.png
    app@2x.webp
    d1b12a8fbe424e4b956eb33cadd5b30d@o22594.ingest.us.sentry.io
    <a href="mailto:press@example.com">Press</a>
  `;

  assert.deepEqual(extractEmails(html), ['press@example.com']);
});

test('extracts emails from mailto and descriptive attributes', () => {
  const html = `
    <a href="mailto:favouradeyekun%40gmail.com" aria-label="Email" title="Send email to favouradeyekun@gmail.com"></a>
    <script>const contact = "hello\\u0040example.com";</script>
  `;

  assert.deepEqual(extractEmails(html), ['favouradeyekun@gmail.com', 'hello@example.com']);
});

test('extracts email from formatted mailto anchor markup', () => {
  const html = `
    <a
      href="mailto:bryanabisoye@gmail.com"
      className="font-medium text-slate-700 transition hover:text-teal-700"
    >
      bryanabisoye@gmail.com
    </a>
  `;

  assert.deepEqual(extractEmails(html), ['bryanabisoye@gmail.com']);
});

test('extracts links and metadata', () => {
  const $ = cheerio.load(`
    <html lang="en">
      <head>
        <title>Example</title>
        <meta name="description" content="Demo">
        <meta name="robots" content="index,follow">
        <meta name="keywords" content="alpha, beta">
        <meta name="theme-color" content="#ffffff">
        <meta name="twitter:card" content="summary_large_image">
        <meta property="og:title" content="OG Example">
        <meta property="og:type" content="article">
        <link rel="canonical" href="https://example.com">
        <link rel="manifest" href="/site.webmanifest">
        <link rel="alternate" hreflang="fr" href="/fr">
        <script type="application/ld+json">{"@type":"Article","headline":"Demo"}</script>
      </head>
      <body><a href="/about#x">About</a><a href="/background.webp">Image</a><area href="/map"></body>
    </html>
  `);

  assert.deepEqual(extractLinks($, 'https://example.com'), ['https://example.com/about', 'https://example.com/map']);
  const metadata = extractMetadata($, 'https://example.com');
  assert.equal(metadata.title, 'Example');
  assert.equal(metadata.ogTitle, 'OG Example');
  assert.equal(metadata.ogType, 'article');
  assert.equal(metadata.robots, 'index,follow');
  assert.deepEqual(metadata.keywords, ['alpha', 'beta']);
  assert.equal(metadata.manifest, 'https://example.com/site.webmanifest');
  assert.deepEqual(metadata.alternateLanguages, [{ hrefLang: 'fr', href: 'https://example.com/fr' }]);
  assert.deepEqual(metadata.jsonLdTypes, ['Article']);
});

test('filters non-page assets from crawl links', () => {
  const $ = cheerio.load(`
    <a href="/contact">Contact</a>
    <a href="/background.webp">Image</a>
    <a href="/_next/static/chunks/app.js">Chunk</a>
    <a href="/_next/static/media/font.woff2">Font</a>
  `);

  assert.deepEqual(extractLinks($, 'https://example.com'), ['https://example.com/contact']);
});

test('extracts optional page hint links', () => {
  const $ = cheerio.load(`
    <head>
      <link rel="alternate" href="/rss">
      <link rel="next" href="/page/2">
      <link rel="stylesheet" href="/styles.css">
    </head>
  `);

  assert.deepEqual(extractLinks($, 'https://example.com', { includeMetaLinks: true }), [
    'https://example.com/rss',
    'https://example.com/page/2'
  ]);
});

test('extracts contact and social hrefs from component-like markup', () => {
  const $ = cheerio.load(`
    <MuiLink href="mailto:favouradeyekun@gmail.com" title="Send email to favouradeyekun@gmail.com"></MuiLink>
    <MuiLink href="https://wa.me/2348022335287"></MuiLink>
    <MuiLink href="https://www.tiktok.com/@osunosogboperfumevendor?_t=ZM-8xnxkF8zy9m&_r=1"></MuiLink>
    <MuiLink href="https://x.com/starrjola?s=11&t=0Q8N-GU0qzui0gCYqwEkQg"></MuiLink>
    <MuiLink href="https://www.instagram.com/scentsation_by_jc?igsh=dmd6NjhhdXN4aWMz&utm_source=qr"></MuiLink>
  `);
  const html = $.html();
  const links = extractLinks($, 'https://example.com');
  const social = extractSocialLinks(links);

  assert.deepEqual(extractEmails(html), ['favouradeyekun@gmail.com']);
  assert.deepEqual(social.whatsapp, ['https://wa.me/2348022335287']);
  assert.deepEqual(social.tiktok, ['https://tiktok.com/@osunosogboperfumevendor']);
  assert.deepEqual(social.twitter, ['https://twitter.com/starrjola']);
  assert.deepEqual(social.instagram, ['https://instagram.com/scentsation_by_jc']);
});

test('groups social links', () => {
  const social = extractSocialLinks([
    'https://github.com/acme',
    'https://github.com/acme/?utm_source=site#top',
    'https://twitter.com/acme',
    'https://x.com/acme/'
  ]);

  assert.deepEqual(social.github, ['https://github.com/acme']);
  assert.deepEqual(social.twitter, ['https://twitter.com/acme']);
});

test('groups extended social and community links', () => {
  const social = extractSocialLinks([
    'https://www.tiktok.com/@acme?lang=en',
    'https://t.me/acme',
    'https://discord.gg/acme',
    'https://calendly.com/acme/demo',
    'https://bsky.app/profile/acme.example',
    'https://www.linkedin.com/company/acme/?trk=site'
  ]);

  assert.deepEqual(social.tiktok, ['https://tiktok.com/@acme']);
  assert.deepEqual(social.telegram, ['https://t.me/acme']);
  assert.deepEqual(social.discord, ['https://discord.gg/acme']);
  assert.deepEqual(social.calendly, ['https://calendly.com/acme/demo']);
  assert.deepEqual(social.bluesky, ['https://bsky.app/profile/acme.example']);
  assert.deepEqual(social.linkedin, ['https://linkedin.com/company/acme']);
});

test('ignores non-profile social platform article and topic URLs', () => {
  const social = extractSocialLinks([
    'https://ticimax.com/blog/pci-dss-nedir-neden-onemlidir',
    'https://web.archive.org/web/20240229225320/https://www.ticimax.com/blog/pci-dss-nedir-neden-onemlidir',
    'https://gitlab.com/explore/projects/topics/PCI-DSS',
    'https://quora.com/topic/PCI-DSS-1',
    'https://twitter.com/acme'
  ]);

  assert.deepEqual(social.twitter, ['https://twitter.com/acme']);
  assert.deepEqual(social.gitlab, []);
  assert.deepEqual(social.quora, []);
});

test('validates and clamps crawl config', () => {
  const config = normalizeCrawlConfig({
    seedUrl: 'https://example.com',
    maxPages: 5000,
    concurrency: 100,
    extract: { emails: false }
  });

  assert.equal(config.maxPages, 5000);
  assert.equal(config.concurrency, 10);
  assert.equal(config.discovery.sitemap, true);
  assert.equal(config.discovery.renderJavaScript, true);
  assert.equal(config.discovery.renderWhenStaticLinksBelow, 20);
  assert.equal(config.extract.emails, false);
  assert.equal(config.extract.links, true);
});

test('blocks private SSRF host targets', () => {
  assert.equal(isPrivateHost('127.0.0.1'), true);
  assert.equal(isPrivateHost('10.1.2.3'), true);
  assert.equal(isPrivateHost('192.168.1.3'), true);
  assert.equal(isPrivateHost('172.20.1.3'), true);
  assert.equal(isPrivateHost('169.254.169.254'), true);
  assert.equal(isPrivateHost('100.100.100.200'), true);
  assert.equal(isPrivateHost('::1'), true);
  assert.equal(isPrivateHost('2607:f8b0:4006:81a::200e'), false);
  assert.equal(isPrivateHost('example.com'), false);
});

test('blocks unsafe SSRF URL shapes', async () => {
  assert.equal(await isPrivateUrl('file:///etc/passwd'), true);
  assert.equal(await isPrivateUrl('https://example.com:444'), true);
  assert.equal(await isPrivateUrl('http://user:pass@example.com'), true);
});

test('sanitizes dangerous input keys and control characters', () => {
  assert.deepEqual(sanitizeDeep({
    ok: ' hello\u0000 ',
    $where: 'bad',
    nested: {
      '__proto__': { polluted: true },
      'a.b': 'bad',
      safe: 'yes'
    }
  }), {
    ok: 'hello',
    nested: {
      safe: 'yes'
    }
  });
});

test('detects common technology signatures', () => {
  const $ = cheerio.load(`
    <meta name="generator" content="WordPress 6">
    <script src="/_next/static/chunks/app.js"></script>
    <script src="https://js.stripe.com/v3"></script>
    <link rel="stylesheet" href="/_next/static/css/app.css">
    <div id="__next"></div>
  `);

  assert.deepEqual(detectTechStack($, { 'cf-ray': 'abc', 'x-vercel-id': 'iad1::abc' }, $.html()).sort(), [
    'Cloudflare',
    'Next.js',
    'Stripe',
    'Vercel',
    'WordPress'
  ].sort());
});

test('detects technology from DOM attributes, cookies, and header values', () => {
  const $ = cheerio.load(`
    <html data-wf-page="abc" data-wf-site="site">
      <body>
        <script>window.Shopify = { theme: {} }; window.dataLayer = [{ event: 'GTM-ABC123' }];</script>
        <div class="svelte-abc123" data-v-123abc></div>
      </body>
    </html>
  `);

  assert.deepEqual(detectTechStack($, {
    server: 'cloudflare',
    'set-cookie': '_shopify_s=1;',
    via: '1.1 abc.cloudfront.net (CloudFront)'
  }, $.html()).sort(), [
    'AWS CloudFront',
    'Cloudflare',
    'Google Tag Manager',
    'Shopify',
    'Svelte',
    'Vue.js',
    'Webflow'
  ].sort());
});
