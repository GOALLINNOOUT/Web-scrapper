import type { SocialLinks } from '../types.js';

export const SOCIAL_PATTERNS = {
  twitter: /twitter\.com|x\.com/i,
  linkedin: /linkedin\.com/i,
  instagram: /instagram\.com/i,
  facebook: /facebook\.com/i,
  github: /github\.com/i,
  youtube: /youtube\.com|youtu\.be/i,
  tiktok: /tiktok\.com/i,
  reddit: /reddit\.com/i,
  pinterest: /pinterest\.com/i,
  snapchat: /snapchat\.com/i,
  telegram: /t\.me|telegram\.me|telegram\.org/i,
  whatsapp: /wa\.me|whatsapp\.com/i,
  discord: /discord\.gg|discord\.com/i,
  medium: /medium\.com/i,
  devto: /dev\.to/i,
  behance: /behance\.net/i,
  dribbble: /dribbble\.com/i,
  stackoverflow: /stackoverflow\.com/i,
  gitlab: /gitlab\.com/i,
  bitbucket: /bitbucket\.org/i,
  threads: /threads\.net/i,
  mastodon: /mastodon/i,
  bluesky: /bsky\.app/i,
  twitch: /twitch\.tv/i,
  vimeo: /vimeo\.com/i,
  substack: /substack\.com/i,
  quora: /quora\.com/i,
  wechat: /wechat\.com/i,
  weibo: /weibo\.com/i,
  line: /line\.me/i,
  kakaotalk: /kakao\.com/i,
  patreon: /patreon\.com/i,
  buymeacoffee: /buymeacoffee\.com/i,
  linktree: /linktr\.ee/i,
  calendly: /calendly\.com/i
} satisfies Record<keyof SocialLinks, RegExp>;

export const SOCIAL_KEYS = Object.keys(SOCIAL_PATTERNS) as (keyof SocialLinks)[];

export function emptySocial(): SocialLinks {
  return SOCIAL_KEYS.reduce((result, key) => {
    result[key] = [];
    return result;
  }, {} as SocialLinks);
}

export function extractSocialLinks(links: string[]): SocialLinks {
  const social = emptySocial();

  for (const link of links) {
    let parsed: URL;
    try {
      parsed = new URL(link);
    } catch {
      continue;
    }

    for (const [platform, pattern] of Object.entries(SOCIAL_PATTERNS) as [keyof SocialLinks, RegExp][]) {
      if (pattern.test(`${parsed.hostname}${parsed.pathname}`.replace(/^www\./, '')) && isLikelySocialProfile(parsed, platform)) {
        social[platform].push(canonicalSocialUrl(link, platform));
      }
    }
  }

  return SOCIAL_KEYS.reduce((result, key) => {
    result[key] = [...new Set(social[key])];
    return result;
  }, {} as SocialLinks);
}

function isLikelySocialProfile(url: URL, platform: keyof SocialLinks) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  const first = parts[0]?.toLowerCase() || '';

  if (platform === 'twitter') return ['twitter.com', 'x.com'].includes(host) && parts.length >= 1 && !['share', 'intent', 'home', 'search', 'hashtag', 'i'].includes(first);
  if (platform === 'linkedin') return host.endsWith('linkedin.com') && ['in', 'company', 'school', 'showcase'].includes(first) && parts.length >= 2;
  if (platform === 'facebook') return host.endsWith('facebook.com') && parts.length >= 1 && !['share', 'sharer', 'plugins', 'dialog'].includes(first);
  if (platform === 'youtube') return (host === 'youtu.be' && parts.length >= 1) || (host.endsWith('youtube.com') && (first.startsWith('@') || ['channel', 'c', 'user'].includes(first)));
  if (platform === 'github') return host === 'github.com' && parts.length >= 1 && !['topics', 'explore', 'features', 'marketplace', 'collections', 'pricing'].includes(first);
  if (platform === 'gitlab') return host === 'gitlab.com' && parts.length >= 1 && !['explore', 'help', 'users', 'dashboard'].includes(first);
  if (platform === 'reddit') return host.endsWith('reddit.com') && ['r', 'user', 'u'].includes(first) && parts.length >= 2;
  if (platform === 'pinterest') return host.endsWith('pinterest.com') && parts.length >= 1 && !['pin', 'search', 'ideas'].includes(first);
  if (platform === 'quora') return host.endsWith('quora.com') && ['profile'].includes(first) && parts.length >= 2;
  if (platform === 'medium') return host.endsWith('medium.com') && first.startsWith('@');
  if (platform === 'devto') return host === 'dev.to' && parts.length === 1;
  if (platform === 'stackoverflow') return host.endsWith('stackoverflow.com') && first === 'users' && parts.length >= 2;
  if (platform === 'telegram') return ['t.me', 'telegram.me'].includes(host) && parts.length >= 1;
  if (platform === 'discord') return ['discord.gg', 'discord.com'].includes(host) && parts.length >= 1;
  if (platform === 'whatsapp') return ['wa.me', 'whatsapp.com'].includes(host) && parts.length >= 1;
  if (platform === 'bluesky') return host === 'bsky.app' && first === 'profile' && parts.length >= 2;
  if (platform === 'mastodon') return parts.some((part) => part.startsWith('@')) || first === 'users';

  return parts.length >= 1;
}

export function countSocialLinks(social?: Partial<SocialLinks> | null) {
  const uniqueLinks = new Set(Object.values(social || {}).flat());
  return uniqueLinks.size;
}

function canonicalSocialUrl(link: string, platform: keyof SocialLinks) {
  const url = new URL(link);
  url.hash = '';
  url.search = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.protocol = 'https:';

  if (platform === 'twitter' && url.hostname === 'x.com') {
    url.hostname = 'twitter.com';
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}
