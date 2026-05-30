export interface ExtractConfig {
  links: boolean;
  emails: boolean;
  metadata: boolean;
  social: boolean;
  content?: boolean;
}

export interface CrawlConfig {
  seedUrl: string;
  maxPages: number;
  maxDepth: number;
  sameDomainOnly: boolean;
  concurrency: number;
  discovery: DiscoveryConfig;
  extract: ExtractConfig;
  schedule?: 'none' | 'daily' | 'weekly';
}

export interface DiscoveryConfig {
  sitemap: boolean;
  renderJavaScript: boolean;
  renderWhenStaticLinksBelow: number;
  includeMetaLinks: boolean;
}

export interface Metadata {
  title?: string;
  description?: string;
  canonical?: string;
  language?: string;
  viewport?: string;
  robots?: string;
  author?: string;
  publisher?: string;
  generator?: string;
  applicationName?: string;
  keywords?: string[];
  themeColor?: string;
  favicon?: string;
  manifest?: string;
  ampUrl?: string;
  alternateLanguages?: Array<{ hrefLang: string; href: string }>;
  ogUrl?: string;
  ogType?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  siteName?: string;
  twitterCard?: string;
  twitterSite?: string;
  twitterCreator?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  jsonLdTypes?: string[];
}

export interface SocialLinks {
  twitter: string[];
  linkedin: string[];
  instagram: string[];
  facebook: string[];
  github: string[];
  youtube: string[];
  tiktok: string[];
  reddit: string[];
  pinterest: string[];
  snapchat: string[];
  telegram: string[];
  whatsapp: string[];
  discord: string[];
  medium: string[];
  devto: string[];
  behance: string[];
  dribbble: string[];
  stackoverflow: string[];
  gitlab: string[];
  bitbucket: string[];
  threads: string[];
  mastodon: string[];
  bluesky: string[];
  twitch: string[];
  vimeo: string[];
  substack: string[];
  quora: string[];
  wechat: string[];
  weibo: string[];
  line: string[];
  kakaotalk: string[];
  patreon: string[];
  buymeacoffee: string[];
  linktree: string[];
  calendly: string[];
}

export interface QueueItem {
  url: string;
  depth: number;
  parentUrl?: string | null;
  discoveredFrom?: string | null;
}
