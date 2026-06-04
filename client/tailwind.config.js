/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111110',
        muted: '#636360',
        admin: {
          base: 'var(--admin-bg-base)',
          surface: 'var(--admin-bg-surface)',
          elevated: 'var(--admin-bg-elevated)',
          border: 'var(--admin-border)',
          primary: 'var(--accent-primary)',
          warning: 'var(--accent-warning)',
          critical: 'var(--accent-critical)',
          success: 'var(--accent-success)',
          info: 'var(--accent-info)'
        },
        brand: {
          50: '#f0f5ff',
          100: '#ebf2ff',
          200: '#bfdbfe',
          300: '#93c5fd',
          500: '#0a6eff',
          600: '#0a6eff',
          700: '#0058d4',
          800: '#0646a8'
        }
      },
      boxShadow: {
        panel: '0 1px 4px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        float: '0 16px 48px rgba(0,0,0,0.12), 0 8px 16px rgba(0,0,0,0.06)',
        admin: '0 18px 42px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.04) inset'
      },
      fontFamily: {
        admin: ['IBM Plex Sans', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
};
