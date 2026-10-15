/** @type {import('tailwindcss').Config} */
export default {
  // Touch screens replay hover styles on tap and leave them stuck; only real pointers get hover.
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      screens: {
        // The desktop layout (sidebar, side-by-side panes) needs width and height: a phone turned
        // sideways is wide but short and keeps the phone layout.
        md: { raw: '(min-width: 768px) and (min-height: 560px)' },
        // Phones whose visible screen is short (iPhone mini / SE with the tab bar): tighter spacing.
        short: { raw: '(max-height: 760px)' },
        // A phone turned sideways: driving screens use two columns.
        land: { raw: '(orientation: landscape) and (max-height: 559px)' },
      },
      colors: {
        bg: 'rgb(var(--c-bg) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        fg: 'rgb(var(--c-fg) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        gain: 'rgb(var(--c-gain) / <alpha-value>)',
        loss: 'rgb(var(--c-loss) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Archivo', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
