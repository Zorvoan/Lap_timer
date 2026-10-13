import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Generates PNG app icons (Android, iOS home screen, favicon) from public/icon.svg.
// Run: npx pwa-assets-generator   (from apps/web)
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0b0c0e' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0b0c0e' } },
  },
  images: ['public/icon.svg'],
});
