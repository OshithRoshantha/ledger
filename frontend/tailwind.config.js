/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        elevated: 'var(--elevated)',
        hairline: 'var(--hairline)',
        text: 'var(--text)',
        muted: 'var(--text-2)',
        positive: 'var(--positive)',
        negative: 'var(--negative)',
        warning: 'var(--warning)',
        brand: 'var(--brand)',
        'brand-soft': 'var(--brand-soft)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: { card: '20px', sheet: '24px' },
      fontSize: { hero: ['40px', { lineHeight: '44px', letterSpacing: '-0.02em' }] },
    },
  },
  plugins: [],
};
