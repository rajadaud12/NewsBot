import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: { colors: { ink: '#111827', muted: '#6b7280', accent: '#f97316' } } },
  plugins: [],
} satisfies Config;
