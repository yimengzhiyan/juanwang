// 素材 URL 与预加载：仓库根 assets/ 由 Vite publicDir 托管（URL = BASE_URL + 相对路径）。
// characters/ 与 units/：同名 .png 优先，.svg 回退（文件列表来自构建期虚拟模块，不做 404 探测）。
import list from 'virtual:asset-list';
import type { GameData, UnitDef } from '@juanwang/shared';

const files = new Set(list);

/** 相对素材根的路径 → URL */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}

/** 解析头像：同目录或 characters/、units/ 下的同名 png 优先，其次 svg，最后原值 */
export function resolveArt(path: string): string {
  const m = /^(characters|units)\/([^/.]+)\.(png|svg)$/.exec(path);
  if (!m) return path;
  const id = m[2];
  for (const cand of [`characters/${id}.png`, `units/${id}.png`, `${m[1]}/${id}.svg`, `characters/${id}.svg`, `units/${id}.svg`]) {
    if (files.has(cand)) return cand;
  }
  return path;
}

const avatarCache = new Map<string, string>();
export function avatarUrl(def: Pick<UnitDef, 'id' | 'avatar'>): string {
  let u = avatarCache.get(def.id);
  if (!u) {
    u = assetUrl(resolveArt(def.avatar));
    avatarCache.set(def.id, u);
  }
  return u;
}
export function isPhotoAvatar(def: Pick<UnitDef, 'id' | 'avatar'>): boolean {
  return avatarUrl(def).endsWith('.png');
}

export const ui = (name: string): string => assetUrl(`ui/${name}.svg`);
export const fxArt = (name: string): string => assetUrl(`fx/${name}.svg`);
/** 素材是否存在（构建期文件列表） */
export const hasAsset = (path: string): boolean => files.has(path.replace(/^\/+/, ''));
/** 任意相对路径头像（对手 / PVE）：characters、units 走 png 优先规则 */
export const artUrl = (path: string): string => assetUrl(resolveArt(path));

/** 预加载：头像、基建、UI、Logo、背景、字体。onProgress(0..1) */
export async function preload(data: GameData, onProgress: (p: number) => void): Promise<void> {
  const urls = new Set<string>();
  for (const u of data.units) urls.add(avatarUrl(u));
  for (const it of data.equips) urls.add(assetUrl(it.icon));
  for (const it of data.consumables) urls.add(assetUrl(it.icon));
  for (const f of list) if (/^(ui|fx|arenas|pve|opponents)\//.test(f)) urls.add(assetUrl(f));
  urls.add(assetUrl('logo.svg'));
  urls.add(assetUrl('bg_home.svg'));
  const jobs: Promise<unknown>[] = [...urls].map(
    (src) =>
      new Promise<void>((res) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = img.onerror = () => res();
        img.src = src;
      }),
  );
  jobs.push(
    (async () => {
      try {
        const ff = new FontFace('Fredoka', `url(${assetUrl('fonts/fredoka-latin.woff2')}) format('woff2')`, { weight: '400 700', display: 'swap' });
        document.fonts.add(await ff.load());
      } catch {
        /* 字体失败不阻塞 */
      }
    })(),
  );
  let done = 0;
  const total = jobs.length;
  onProgress(0);
  await Promise.all(jobs.map((j) => j.then(() => onProgress(++done / total))));
}
