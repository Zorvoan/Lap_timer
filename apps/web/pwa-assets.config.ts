import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates PNG app icons (Android, iOS home screen, favicon) from public/icon.svg.
// Run: npx pwa-assets-generator   (from apps/web)
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    // The icon has its own dark background and keeps its mark inside the maskable safe zone, so it
    // fills the whole tile rather than sitting small in the middle.
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: '#0b0c0e' } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: '#0b0c0e' } },
  },
  images: ['public/icon.svg'],
});
