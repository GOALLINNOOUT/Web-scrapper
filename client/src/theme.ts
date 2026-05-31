export type ThemePreference = 'light' | 'dark' | 'system';

const storageKey = 'webintel-theme';
const transitionDurationMs = 720;

export function getStoredTheme(): ThemePreference {
  const value = localStorage.getItem(storageKey);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function storeTheme(theme: ThemePreference) {
  localStorage.setItem(storageKey, theme);
  applyTheme(theme, { animate: true });
}

export function applyTheme(theme: ThemePreference, options: { animate?: boolean } = {}) {
  const resolved = resolveTheme(theme);
  const previous = document.documentElement.dataset.theme;
  if (options.animate && previous && previous !== resolved) {
    animateThemeTransition(resolved);
  }
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.style.colorScheme = resolved;
}

export function resolveTheme(theme: ThemePreference) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function watchSystemTheme(onChange: () => void = () => undefined) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const listener = () => {
    const theme = getStoredTheme();
    if (theme === 'system') {
      applyTheme(theme, { animate: true });
      onChange();
    }
  };
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function animateThemeTransition(resolved: 'light' | 'dark') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const existing = document.querySelector('.theme-transition-wash');
  existing?.remove();

  const wash = document.createElement('div');
  wash.className = `theme-transition-wash theme-transition-wash-${resolved}`;
  wash.setAttribute('aria-hidden', 'true');
  document.body.appendChild(wash);
  window.setTimeout(() => wash.remove(), transitionDurationMs);
}
