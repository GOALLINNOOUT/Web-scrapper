export type CrawlStatus = 'queued' | 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

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
  respectRobots?: boolean;
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

export interface CrawlJob {
  _id: string;
  deviceId: string;
  seedUrl: string;
  status: CrawlStatus;
  config: CrawlConfig;
  pagesCrawled: number;
  emailsFound: number;
  socialLinksFound: number;
  requestedStop: boolean;
  requestedPause: boolean;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageMetadata {
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

export interface CrawlPage {
  _id: string;
  deviceId: string;
  crawlId: string;
  url: string;
  domain?: string;
  depth: number;
  metadata?: PageMetadata;
  links: string[];
  emails: string[];
  social: SocialLinks;
  techStack?: string[];
  content?: {
    text: string;
    headings: string[];
    paragraphs: string[];
    wordCount: number;
  };
  classification?: {
    pageType: string;
    confidence: number;
  };
  score?: number;
  crawledAt: string;
  contentHash: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CrawlSummary {
  crawlId: string;
  pagesCrawled: number;
  emails: string[];
  emailOccurrences: Array<{ value: string; pageUrl: string }>;
  socials: Array<{ platform: keyof SocialLinks | string; links: string[] }>;
  socialOccurrences: Array<{ platform: keyof SocialLinks | string; value: string; pageUrl: string }>;
  techStack: string[];
  counts: {
    uniqueEmails: number;
    uniqueSocialProfiles: number;
    uniqueTech: number;
    loadedPages: number;
    rawEmailOccurrences: number;
    rawSocialOccurrences: number;
  };
}

export interface DataFilters {
  q?: string;
  domain?: string;
  hasEmails?: boolean;
  hasSocial?: boolean;
  classification?: string;
  techStack?: string;
  minScore?: number;
  limit?: number;
  cursor?: string | null;
}

export interface MetadataPreview {
  url: string;
  metadata: PageMetadata;
  links: string[];
  emails: string[];
  social: SocialLinks;
  images: string[];
  fetchedAt: string;
}

export interface DomainProfile {
  _id: string;
  deviceId: string;
  domain: string;
  totalPages: number;
  emails: string[];
  socials: Partial<SocialLinks>;
  contentCategories?: Record<string, number>;
  avgScore: number;
  techStack?: string[];
  whois?: {
    registrar?: string;
    creationDate?: string;
    expiryDate?: string;
    updatedDate?: string;
    registrantCountry?: string;
    nameServers?: string[];
    error?: string;
    refreshedAt?: string;
  };
  dns?: {
    mxRecords?: Array<{ exchange?: string; priority?: number }>;
    aRecords?: string[];
    txtRecords?: string[][];
    mailProviderGuess?: string;
    error?: string;
    refreshedAt?: string;
  };
  lastCrawledAt?: string;
}

export interface AlertEvent {
  _id: string;
  type: 'new_email' | 'page_changed' | 'new_domain' | 'crawl_failed' | 'change_detected' | 'webhook_failed';
  severity?: 'low' | 'medium' | 'high';
  domain?: string;
  crawlId?: string;
  pageUrl?: string;
  message: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface MonitoringPageConfig {
  url: string;
  label: string;
  reason: string;
  score: number;
  enabled: boolean;
  signals: string[];
  lastCheckedAt?: string | null;
}

export interface MonitoringProfile {
  _id: string;
  deviceId: string;
  domain: string;
  seedUrl: string;
  monitoringType: 'competitive_intelligence' | 'lead_discovery' | 'seo_monitoring' | 'infrastructure_monitoring' | 'custom';
  monitoredPages: MonitoringPageConfig[];
  recommendedPages: MonitoringPageConfig[];
  schedule: '12h' | 'daily' | 'weekly' | 'monthly';
  sensitivity: 'low' | 'medium' | 'high';
  enabled: boolean;
  lastCheckedAt?: string | null;
  lastChangeAt?: string | null;
  discoveryCrawlId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeEvent {
  _id: string;
  domain: string;
  url?: string;
  eventType: 'content_changed' | 'heading_changed' | 'metadata_changed' | 'new_page' | 'removed_page' | 'new_email' | 'removed_email' | 'social_changed' | 'tech_stack_changed' | 'whois_changed' | 'dns_changed' | 'price_changed' | 'score_changed';
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  diff?: Record<string, unknown>;
  severity: 'low' | 'medium' | 'high';
  reason?: string;
  crawlId?: string | null;
  readAt?: string | null;
  detectedAt: string;
}

export interface MonitoringSummary {
  activeCrawls: CrawlJob[];
  recentAlerts: AlertEvent[];
  domains: DomainProfile[];
  profiles: MonitoringProfile[];
  changeFeed: ChangeEvent[];
  counts: {
    changesToday: number;
    newPages: number;
    newEmails: number;
    dnsChanges: number;
    unread: number;
  };
  health: {
    activeCrawls: number;
    monitoredDomains: number;
    failedCrawls24h: number;
  };
}

export interface WorkspaceSettings {
  account: { name: string; email: string; profileImage: string };
  workspace: { name: string; logo: string };
  notifications: {
    inApp: 'all' | 'important' | 'disabled';
    email: 'instant' | 'daily' | 'weekly' | 'disabled';
    events: {
      pricingChanges: boolean;
      emailDiscoveries: boolean;
      dnsChanges: boolean;
      whoisChanges: boolean;
      techStackChanges: boolean;
      newPages: boolean;
    };
  };
  crawling: {
    defaultDepth: number;
    maxPages: number;
    respectRobots: boolean;
    crawlDelaySeconds: number;
    userAgentMode: 'default' | 'custom';
    customUserAgent: string;
  };
  monitoring: {
    preset: MonitoringProfile['monitoringType'];
    defaultFrequency: 'daily' | 'weekly' | 'monthly';
    autoMonitorImportantPages: boolean;
    sensitivity: 'low' | 'medium' | 'high';
  };
  dataRetention: {
    retentionDays: 30 | 90 | 180 | 365;
    autoDelete: boolean;
    exportFormat: 'csv' | 'json';
  };
  integrations: {
    webhookUrl: string;
    webhookSecret: string;
    webhookEvents: string[];
  };
  appearance: {
    theme: 'light' | 'dark' | 'system';
    density: 'comfortable' | 'compact';
  };
}
