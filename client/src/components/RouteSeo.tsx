import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

const SITE_NAME = 'Web Intelligence Crawler';
const DEFAULT_IMAGE = '/preview.svg';

interface RouteSeoConfig {
  title: string;
  description: string;
  keywords: string;
}

const routeSeo: Array<{ match: (pathname: string) => boolean; config: RouteSeoConfig }> = [
  {
    match: (pathname) => pathname === '/',
    config: {
      title: 'Web Intelligence Crawler | Live Website Monitoring',
      description: 'Monitor websites, crawl pages, detect changes, and extract emails, links, metadata, SEO signals, and web intelligence from one dashboard.',
      keywords: 'web intelligence crawler, web crawler, website monitoring, change detection, metadata extraction, email discovery, link intelligence, SEO crawler'
    }
  },
  {
    match: (pathname) => pathname === '/crawls',
    config: {
      title: 'Crawl History | Web Intelligence Crawler',
      description: 'Review crawl jobs, statuses, discovered pages, extracted emails, social links, metadata, and crawl progress across monitored websites.',
      keywords: 'crawl history, crawl jobs, web crawler dashboard, website crawl reports, page discovery'
    }
  },
  {
    match: (pathname) => pathname.startsWith('/crawls/'),
    config: {
      title: 'Crawl Report | Web Intelligence Crawler',
      description: 'Inspect crawl results for a website, including pages found, metadata, emails, social profiles, links, change detection, and technology stack signals.',
      keywords: 'crawl report, website audit, extracted links, extracted emails, technology stack detection, metadata audit'
    }
  },
  {
    match: (pathname) => pathname === '/domains',
    config: {
      title: 'Domain Intelligence | Web Intelligence Crawler',
      description: 'Analyze domain profiles, technology stacks, WHOIS enrichment, discovery history, and intelligence gathered from crawled websites.',
      keywords: 'domain intelligence, domain profile, WHOIS lookup, technology stack, web intelligence'
    }
  },
  {
    match: (pathname) => pathname === '/data',
    config: {
      title: 'Extracted Web Data | Web Intelligence Crawler',
      description: 'Search and filter extracted website data, emails, links, metadata, social profiles, page content, and SEO audit evidence.',
      keywords: 'extracted web data, email discovery, link extraction, metadata extraction, SEO evidence, website data'
    }
  },
  {
    match: (pathname) => pathname === '/monitoring',
    config: {
      title: 'Change Monitoring | Web Intelligence Crawler',
      description: 'Track website changes, new emails, domain updates, crawl alerts, monitoring events, and live web intelligence notifications.',
      keywords: 'change monitoring, website alerts, change detection, web monitoring, crawl notifications'
    }
  },
  {
    match: (pathname) => pathname === '/settings',
    config: {
      title: 'Crawler Settings | Web Intelligence Crawler',
      description: 'Configure crawler preferences, workspace behavior, crawl defaults, monitoring options, and web intelligence settings.',
      keywords: 'crawler settings, web crawler configuration, crawl defaults, monitoring settings'
    }
  }
];

export function RouteSeo() {
  const location = useLocation();

  useLayoutEffect(() => {
    const seo = routeSeo.find((item) => item.match(location.pathname))?.config || routeSeo[0].config;
    const title = seo.title;
    const url = `${window.location.origin}${location.pathname}`;
    const imageUrl = new URL(DEFAULT_IMAGE, window.location.origin).toString();

    document.title = title;
    setMeta('name', 'description', seo.description);
    setMeta('name', 'keywords', seo.keywords);
    setMeta('name', 'application-name', SITE_NAME);
    setMeta('name', 'robots', 'index,follow');
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', seo.description);
    setMeta('name', 'twitter:image', imageUrl);
    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', seo.description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', imageUrl);
    setCanonical(url);
    setAlternateLanguage(url);
  }, [location.pathname]);

  return null;
}

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attribute}="${key}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'canonical';
    document.head.appendChild(element);
  }
  element.href = href;
}

function setAlternateLanguage(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="alternate"][hreflang="en"]');
  if (!element) {
    element = document.createElement('link');
    element.rel = 'alternate';
    element.hreflang = 'en';
    document.head.appendChild(element);
  }
  element.href = href;
}
