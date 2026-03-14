import { defineConfig } from 'vite';
import path from 'path';
import react from '@vitejs/plugin-react';
import * as esbuild from 'esbuild';

// .js 파일 내 JSX를 빌드 전에 변환 (import analysis가 파싱하기 전에 실행)
function jsxInJs() {
  return {
    name: 'jsx-in-js',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.js') || id.includes('node_modules') || !id.replace(/\\/g, '/').includes('/src/')) return null;
      if (!code.includes('<') || !code.includes('>')) return null;
      try {
        const result = esbuild.transformSync(code, {
          loader: 'jsx',
          jsx: 'automatic',
          format: 'esm'
        });
        return { code: result.code };
      } catch {
        return null;
      }
    }
  };
}

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') }
  },
  plugins: [
    jsxInJs(),
    react({ include: /\.(jsx|js|tsx|ts)$/ })
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
