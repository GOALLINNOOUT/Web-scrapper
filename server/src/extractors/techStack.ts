import type { CheerioAPI } from 'cheerio';

interface Signature {
  scripts?: Array<string | RegExp>;
  links?: Array<string | RegExp>;
  html?: Array<string | RegExp>;
  headers?: Array<string | RegExp>;
  cookies?: Array<string | RegExp>;
  meta?: Array<{ name?: string; property?: string; content: RegExp }>;
  selectors?: string[];
}

const SIGNATURES: Record<string, Signature> = {
  WordPress: {
    scripts: [/\/wp-content\//i, /\/wp-includes\//i],
    links: [/\/wp-content\//i],
    meta: [{ name: 'generator', content: /wordpress/i }],
    html: [/wp-json/i, /wp-emoji-release/i]
  },
  Shopify: {
    scripts: [/cdn\.shopify\.com/i, /shopifycdn\.net/i],
    html: [/Shopify\.theme/i, /ShopifyAnalytics/i],
    cookies: [/_shopify_/i, /cart_currency/i]
  },
  Webflow: {
    scripts: [/assets\.website-files\.com/i, /webflow\.js/i],
    html: [/data-wf-page/i, /data-wf-site/i],
    selectors: ['html[data-wf-page]', '[data-wf-site]']
  },
  Wix: {
    scripts: [/static\.parastorage\.com/i, /wixstatic\.com/i],
    html: [/wix-bi-session/i, /wixsite/i]
  },
  Squarespace: {
    scripts: [/static1\.squarespace\.com/i, /squarespace\.com\/universal/i],
    html: [/Static\.SQUARESPACE_CONTEXT/i]
  },
  Ghost: {
    meta: [{ name: 'generator', content: /ghost/i }],
    html: [/ghost\/api/i]
  },
  React: {
    scripts: [/react(?:\.production\.min|\.development)?\.js/i],
    html: [/data-reactroot/i, /__reactFiber/i, /__REACT_DEVTOOLS_GLOBAL_HOOK__/i, /react-dom/i]
  },
  'Next.js': {
    scripts: [/\/_next\/static\//i],
    links: [/\/_next\/static\//i],
    html: [/__NEXT_DATA__/i, /next-head-count/i]
  },
  'Nuxt.js': {
    scripts: [/\/_nuxt\//i],
    html: [/__NUXT__/i]
  },
  'Vue.js': {
    scripts: [/vue(?:\.runtime)?(?:\.min)?\.js/i],
    html: [/data-v-[a-f0-9]+/i, /__VUE__/i]
  },
  Angular: {
    scripts: [/angular(?:\.min)?\.js/i],
    html: [/ng-version/i, /_ngcontent-/i, /ng-app/i]
  },
  Svelte: {
    html: [/svelte-[a-z0-9]+/i, /data-svelte/i]
  },
  Vite: {
    scripts: [/\/@vite\/client/i, /\/src\/main\.[tj]sx?/i],
    html: [/type="module"[^>]+\/src\//i]
  },
  Gatsby: {
    scripts: [/webpack-runtime-/i, /app-[a-f0-9]+\.js/i],
    html: [/___gatsby/i, /gatsby-focus-wrapper/i]
  },
  'Google Analytics': {
    scripts: [/google-analytics\.com\/analytics\.js/i, /googletagmanager\.com\/gtag/i],
    html: [/gtag\(/i, /GoogleAnalyticsObject/i]
  },
  'Google Tag Manager': {
    scripts: [/googletagmanager\.com\/gtm\.js/i],
    html: [/GTM-[A-Z0-9]+/i]
  },
  Segment: {
    scripts: [/cdn\.segment\.com/i],
    html: [/analytics\.load\(/i]
  },
  Hotjar: {
    scripts: [/static\.hotjar\.com/i],
    html: [/hj\(/i]
  },
  HubSpot: {
    scripts: [/js\.hs-scripts\.com/i, /js\.hubspot\.com/i],
    html: [/hsforms/i, /_hsq/i]
  },
  Intercom: {
    scripts: [/widget\.intercom\.io/i],
    html: [/intercomSettings/i]
  },
  Zendesk: {
    scripts: [/static\.zdassets\.com/i, /zendesk\.com\/embeddable/i],
    html: [/zE\(/i]
  },
  Stripe: {
    scripts: [/js\.stripe\.com/i],
    html: [/Stripe\(/i]
  },
  PayPal: {
    scripts: [/paypal\.com\/sdk\/js/i]
  },
  Cloudflare: {
    headers: [/^cf-ray$/i, /^cf-cache-status$/i, /^server: cloudflare$/i],
    html: [/cdn-cgi\//i]
  },
  Fastly: {
    headers: [/^x-served-by$/i, /^x-cache:.*fastly/i, /^server: fastly$/i]
  },
  'AWS CloudFront': {
    headers: [/^x-amz-cf-id$/i, /^x-cache:.*cloudfront/i, /^via:.*cloudfront/i]
  },
  Vercel: {
    headers: [/^x-vercel-id$/i, /^server: Vercel$/i],
    html: [/_vercel/i]
  },
  Netlify: {
    headers: [/^x-nf-request-id$/i, /^server: Netlify$/i]
  }
};

export function detectTechStack($: CheerioAPI, headers: Record<string, unknown> = {}, html = '') {
  const scriptSrcs = $('script[src]').map((_index, element) => $(element).attr('src') || '').get();
  const linkHrefs = $('link[href], img[src], source[src]').map((_index, element) => $(element).attr('href') || $(element).attr('src') || '').get();
  const htmlStr = html || $.html();
  const headerEntries = Object.entries(headers).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return [key, ...values.map((item) => `${key}: ${String(item)}`)];
  });
  const cookieText = String(headers['set-cookie'] || headers['Set-Cookie'] || '');
  const detected = new Set<string>();

  for (const [name, signature] of Object.entries(SIGNATURES)) {
    if (matchesSignature($, signature, { scriptSrcs, linkHrefs, htmlStr, headerEntries, cookieText })) {
      detected.add(name);
    }
  }

  return [...detected].sort();
}

function matchesSignature(
  $: CheerioAPI,
  signature: Signature,
  input: { scriptSrcs: string[]; linkHrefs: string[]; htmlStr: string; headerEntries: string[]; cookieText: string }
) {
  if (matchesAny(input.scriptSrcs, signature.scripts)) return true;
  if (matchesAny(input.linkHrefs, signature.links)) return true;
  if (matchesAny([input.htmlStr], signature.html)) return true;
  if (matchesAny(input.headerEntries, signature.headers)) return true;
  if (matchesAny([input.cookieText], signature.cookies)) return true;
  if (signature.selectors?.some((selector) => $(selector).length > 0)) return true;
  if (signature.meta?.some((meta) => {
    const selector = meta.name ? `meta[name="${meta.name}"]` : `meta[property="${meta.property}"]`;
    return meta.content.test($(selector).attr('content') || '');
  })) return true;
  return false;
}

function matchesAny(values: string[], patterns?: Array<string | RegExp>) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => values.some((value) => typeof pattern === 'string'
    ? value.toLowerCase().includes(pattern.toLowerCase())
    : pattern.test(value)));
}
