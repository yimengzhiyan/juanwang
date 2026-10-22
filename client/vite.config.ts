import { defineConfig } from 'vite';

// 素材：仓库根 assets/ 作为 publicDir，URL 形如 /characters/gpt_chan.png（= '/' + UnitDef.avatar）。
// 构建产物的 JS/CSS 放在 /_app/ 下，避免与素材目录重名。
export default defineConfig({
  publicDir: '../assets',
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/healthz': 'http://localhost:3000' },
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    assetsDir: '_app',
    emptyOutDir: true,
    target: 'es2022',
  },
});
