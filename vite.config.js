import { defineConfig, transformWithEsbuild } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// .js 파일 내 JSX — 확장자가 .js라 Vite/rollup이 loader를 js로 두면 실패하므로 loader: 'jsx'로 명시
function jsxInJs() {
  return {
    name: 'jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.js') || id.includes('node_modules') || !id.replace(/\\/g, '/').includes('/src/')) return null;
      if (!code.includes('<') || !code.includes('>')) return null;
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic'
      });
    }
  };
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  plugins: [
    jsxInJs(),
    react({ include: /\.(jsx|js|tsx|ts)$/ }),
    VitePWA({
      /**
       * autoUpdate: 새 빌드의 SW가 감지되면 skipWaiting 후 탭을 자동 새로고침해 최신 JS/CSS 적용 (배포 직후 수동 새로고침·로그아웃 불필요).
       * 단, 작성 중인 폼은 새로고침으로 날아갈 수 있음 → prompt로 되돌리려면 vite.config만 변경.
       */
      registerType: 'autoUpdate',
      includeAssets: ['nexvia-app-icon.png'],
      manifest: {
        name: '넥스비아 CRM',
        short_name: 'Nexvia CRM',
        description: 'Nexvia AI CRM',
        theme_color: '#5b7c99',
        background_color: '#f0f4f8',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        lang: 'ko',
        icons: [
          {
            src: '/nexvia-app-icon.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/nexvia-app-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png,woff2}'],
        /** 새 SW 활성화 직후 클라이언트에 즉시 적용, 오래된 프리캐시 정리 */
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
});
