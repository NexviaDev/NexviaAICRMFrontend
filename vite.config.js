import { defineConfig, transformWithEsbuild, loadEnv } from 'vite';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

/** Vercel/Netlify 빌드마다 달라지는 ID — 클라이언트가 옛 PWA 캐시를 자동 정리 */
function resolveAppBuildId() {
  const fromEnv = String(
    process.env.VITE_APP_BUILD_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.COMMIT_REF ||
      ''
  ).trim();
  if (fromEnv) return fromEnv.slice(0, 40);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return String(Date.now());
  }
}
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_BUILD_VERSION_BOOTSTRAP_SNIPPET } from './src/lib/app-build-version.js';

const SRC_ROOT = path.resolve(__dirname, 'src');

/** dep-scan은 `src/foo.js` 상대 경로, transform은 절대 경로 — 둘 다 src 아래 .js 인지 판별 */
function isAppSrcJsModule(id) {
  const file = id.split('?')[0];
  if (!file.endsWith('.js')) return false;
  const normalized = file.replace(/\\/g, '/');
  if (normalized.includes('node_modules')) return false;
  if (normalized.startsWith('src/') || normalized.includes('/src/')) return true;
  try {
    const abs = path.isAbsolute(file) ? path.resolve(file) : path.resolve(__dirname, file);
    return abs.startsWith(SRC_ROOT + path.sep) || abs === SRC_ROOT;
  } catch {
    return false;
  }
}

// .js 파일 내 JSX — Vite dep-scan·import-analysis는 loader: js 기본 → jsx로 선변환
function jsxInJs() {
  return {
    name: 'jsx-in-js',
    enforce: 'pre',
    async transform(code, id) {
      if (!isAppSrcJsModule(id)) return null;
      if (!code.includes('<') || !code.includes('>')) return null;
      const file = id.split('?')[0];
      return transformWithEsbuild(code, file, {
        loader: 'jsx',
        jsx: 'automatic'
      });
    }
  };
}

function firebaseSwBuildEnv(env) {
  const apiUrl = String(env.VITE_API_URL || '').trim().replace(/\/$/, '');
  const apiBase = apiUrl ? `${apiUrl}/api` : '/api';
  const firebaseConfig = {
    apiKey: String(env.VITE_FIREBASE_WEB_API_KEY || '').trim(),
    authDomain: String(env.VITE_FIREBASE_WEB_AUTH_DOMAIN || '').trim(),
    projectId: String(env.VITE_FIREBASE_WEB_PROJECT_ID || '').trim(),
    storageBucket: String(env.VITE_FIREBASE_WEB_STORAGE_BUCKET || '').trim(),
    messagingSenderId: String(env.VITE_FIREBASE_WEB_MESSAGING_SENDER_ID || '').trim(),
    appId: String(env.VITE_FIREBASE_WEB_APP_ID || '').trim()
  };
  return { apiBase, firebaseConfig };
}

/** dev용 public SW — transform 단계에서 치환 */
function injectFirebaseServiceWorkerConfig(env) {
  const { apiBase, firebaseConfig } = firebaseSwBuildEnv(env);
  const inject = (code) =>
    code
      .replace(/__NEXVIA_PUSH_API_BASE__/g, apiBase)
      .replace(/__FIREBASE_CONFIG_JSON__/g, JSON.stringify(firebaseConfig));

  return {
    name: 'inject-firebase-sw-config',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/');
      if (!normalized.endsWith('/public/firebase-messaging-sw.js')) return null;
      return inject(code);
    }
  };
}

/** injectManifest 2차 번들 직후 치환 (미치환 시 SW evaluation failed) */
function replaceFirebaseConfigInSwRollup(env) {
  const { apiBase, firebaseConfig } = firebaseSwBuildEnv(env);
  return {
    name: 'replace-firebase-config-in-sw',
    renderChunk(code) {
      if (!code.includes('__FIREBASE_CONFIG_JSON__')) return null;
      return code
        .replace(/__NEXVIA_PUSH_API_BASE__/g, apiBase)
        .replace(/__FIREBASE_CONFIG_JSON__/g, JSON.stringify(firebaseConfig));
    },
    /** dist 파일 직접 쓰기 경로 대비 */
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.code && item.code.includes('__FIREBASE_CONFIG_JSON__')) {
          item.code = item.code
            .replace(/__NEXVIA_PUSH_API_BASE__/g, apiBase)
            .replace(/__FIREBASE_CONFIG_JSON__/g, JSON.stringify(firebaseConfig));
        }
      }
    }
  };
}

/** 배포마다 dist/version.json — 클라이언트가 네트워크로 최신 빌드 ID 조회 */
function emitAppVersionJson(appBuildId) {
  const source = JSON.stringify({ buildId: appBuildId, builtAt: new Date().toISOString() });

  return {
    name: 'emit-app-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source });
    }
  };
}

/** 옛 index.html·SW 캐시보다 먼저 /version.json 비교 (번들 JS 로드 전) */
function injectAppBuildVersionBootstrap() {
  const tag = `<script>${APP_BUILD_VERSION_BOOTSTRAP_SNIPPET}</script>`;
  return {
    name: 'inject-app-build-version-bootstrap',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (html.includes('nexvia_app_build_id')) return html;
        if (html.includes('<script type="module"')) {
          return html.replace('<script type="module"', `${tag}\n    <script type="module"`);
        }
        return html.replace('</head>', `    ${tag}\n  </head>`);
      }
    }
  };
}

/** PWA 서브빌드 이후 dist 파일 최종 치환 (rollup 훅이 빠진 경우 대비) */
function injectFirebaseServiceWorkerDist(env) {
  const { apiBase, firebaseConfig } = firebaseSwBuildEnv(env);
  const distSw = path.resolve(__dirname, 'dist/firebase-messaging-sw.js');

  return {
    name: 'inject-firebase-sw-dist',
    enforce: 'post',
    apply: 'build',
    buildEnd() {
      if (!fs.existsSync(distSw)) return;
      let code = fs.readFileSync(distSw, 'utf8');
      if (!code.includes('__FIREBASE_CONFIG_JSON__') && !code.includes('__NEXVIA_PUSH_API_BASE__')) return;
      code = code
        .replace(/__NEXVIA_PUSH_API_BASE__/g, apiBase)
        .replace(/__FIREBASE_CONFIG_JSON__/g, JSON.stringify(firebaseConfig));
      fs.writeFileSync(distSw, code);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appBuildId = resolveAppBuildId();
  return {
    define: {
      'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(appBuildId)
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') }
    },
    optimizeDeps: {
      // dev dep-scan: src 아래 .js 파일의 JSX 파싱 (loader 기본값 js 방지)
      esbuildOptions: {
        loader: { '.js': 'jsx' },
        jsx: 'automatic'
      }
    },
    plugins: [
      jsxInJs(),
      injectAppBuildVersionBootstrap(),
      injectFirebaseServiceWorkerConfig(env),
      injectFirebaseServiceWorkerDist(env),
      emitAppVersionJson(appBuildId),
      react({ include: /\.(jsx|js|tsx|ts)$/ }),
      VitePWA({
        /**
         * injectManifest: 단일 SW 파일명 firebase-messaging-sw.js (FCM 공식 경로)
         * → Application 탭에서 이 파일이 activated 여야 백그라운드 푸시 수신
         */
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'firebase-messaging-sw.js',
        registerType: 'autoUpdate',
        injectRegister: 'auto',
        includeAssets: ['nexvia-app-icon.png'],
        manifest: {
          id: '/',
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
          ],
          share_target: {
            action: '/map',
            method: 'GET',
            enctype: 'application/x-www-form-urlencoded',
            params: {
              title: 'title',
              text: 'text',
              url: 'url'
            }
          }
        },
        injectManifest: {
          /** index.html·version.json은 precache 제외 → 항상 네트워크에서 최신 shell 로드 */
          globPatterns: ['assets/**/*.{js,css,woff2}', '**/*.{ico,svg,png}', 'nexvia-app-icon.png'],
          globIgnores: ['**/landing/**', '**/index.html', '**/version.json'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          rollupOptions: {
            plugins: [replaceFirebaseConfigInSwRollup(env)]
          }
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
  };
});
