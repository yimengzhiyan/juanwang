import { defineConfig, type Plugin } from 'vite';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// 素材：仓库根 assets/ 作为 publicDir，URL 形如 /characters/gpt_chan.png（= '/' + UnitDef.avatar）。
// 构建产物的 JS/CSS 放在 /_app/ 下，避免与素材目录重名。

const ASSET_ROOT = fileURLToPath(new URL('../assets', import.meta.url));

/** 虚拟模块 virtual:asset-list：列出 assets/ 下实际存在的文件（用于"同名 png 优先、svg 回退"，避免 404 探测） */
function assetList(): Plugin {
  const id = 'virtual:asset-list';
  const rid = '\0' + id;
  const scan = (dir: string, out: string[]): string[] => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) scan(p, out);
      else out.push(relative(ASSET_ROOT, p).split('\\').join('/'));
    }
    return out;
  };
  return {
    name: 'juanwang-asset-list',
    resolveId(x) {
      return x === id ? rid : undefined;
    },
    load(x) {
      if (x !== rid) return undefined;
      return `export default ${JSON.stringify(scan(ASSET_ROOT, []).sort())};`;
    },
  };
}

export default defineConfig({
  publicDir: '../assets',
  plugins: [assetList()],
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
