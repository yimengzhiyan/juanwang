// 素材加载：读取 /assets/manifest.json，按清单预加载为 Pixi 纹理；png 优先、svg 回退。
// 判断 png 是否存在：优先用构建时/开发时生成的 /assets/files.json（零 404），
// 拿不到清单时再对 png 发 HEAD 请求检查 content-type。
import { Assets, Texture } from 'pixi.js';

interface Manifest {
  basePath: string;
  characters: Record<string, string>;
  buildings: Record<string, string>;
  cells: Record<string, string>;
  items: Record<string, string>;
  dice: Record<string, string>;
  logo: string;
  boardBg: string;
}

/** key 形如 'characters/altman'、'buildings/3'、'cells/start'、'items/missile'、'dice/h100'、'logo'、'boardBg' */
const urls = new Map<string, string>();
const textures = new Map<string, Texture>();
let base = '/assets/';

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function headIsImage(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
  } catch {
    return false;
  }
}

/** 预加载全部素材。onProgress(0..1) */
export async function loadAssets(onProgress: (p: number) => void): Promise<void> {
  const manifest = await fetchJson<Manifest>('/assets/manifest.json');
  if (!manifest) throw new Error('无法读取 /assets/manifest.json');
  base = manifest.basePath || '/assets/';
  const list = await fetchJson<{ files: string[] }>(base + 'files.json');
  const existing = list ? new Set(list.files) : null;

  const entries: [string, string][] = [];
  const add = (prefix: string, rec: Record<string, string>) => {
    for (const [k, v] of Object.entries(rec)) entries.push([`${prefix}/${k}`, v]);
  };
  add('characters', manifest.characters);
  add('buildings', manifest.buildings);
  add('cells', manifest.cells);
  add('items', manifest.items);
  add('dice', manifest.dice);
  entries.push(['logo', manifest.logo], ['boardBg', manifest.boardBg]);

  // png 优先（只对可能有 png 的类别检查：characters / buildings / dice / logo / boardBg）
  const pngCandidates = (key: string) => key.startsWith('characters/') || key.startsWith('buildings/') || key.startsWith('dice/') || key === 'logo' || key === 'boardBg';
  await Promise.all(
    entries.map(async ([key, rel]) => {
      let chosen = rel;
      if (pngCandidates(key) && rel.endsWith('.svg')) {
        const png = rel.replace(/\.svg$/, '.png');
        const has = existing ? existing.has(png) : await headIsImage(base + png);
        if (has) chosen = png;
      }
      urls.set(key, base + chosen);
    }),
  );

  let done = 0;
  const total = entries.length;
  onProgress(0);
  await Promise.all(
    entries.map(async ([key]) => {
      const url = urls.get(key)!;
      try {
        const isSvg = url.endsWith('.svg');
        // svg 以 2 倍分辨率栅格化，保证高 DPI 屏清晰
        const tex = (await Assets.load(isSvg ? { src: url, data: { resolution: key.startsWith('characters/') ? 1 : 2 } } : url)) as Texture;
        textures.set(key, tex);
      } catch (e) {
        console.warn('[assets] 加载失败', url, e);
      }
      done += 1;
      onProgress(done / total);
    }),
  );
}

/** 取纹理（不存在返回 Texture.EMPTY） */
export function tex(key: string): Texture {
  return textures.get(key) ?? Texture.EMPTY;
}

export function hasTex(key: string): boolean {
  return textures.has(key);
}

/** HTML <img> 用的地址 */
export function assetUrl(key: string): string {
  return urls.get(key) ?? '';
}

export const avatarUrl = (characterId: string) => assetUrl('characters/' + characterId);
export const itemUrl = (itemId: string) => assetUrl('items/' + itemId);
export const avatarTex = (characterId: string) => tex('characters/' + characterId);

const circleCache = new Map<string, Texture>();
/**
 * 圆形裁切后的头像纹理（256px，用 2D canvas 预先裁好），避免运行时每帧做 stencil 遮罩。
 */
export function avatarCircleTex(characterId: string): Texture {
  const hit = circleCache.get(characterId);
  if (hit) return hit;
  const src = tex('characters/' + characterId);
  const res = (src.source as unknown as { resource?: CanvasImageSource }).resource;
  if (!res || src === Texture.EMPTY) return src;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  if (!g) return src;
  g.beginPath();
  g.arc(N / 2, N / 2, N / 2, 0, Math.PI * 2);
  g.closePath();
  g.clip();
  try {
    g.drawImage(res, 0, 0, N, N);
  } catch {
    return src;
  }
  const t = Texture.from(c);
  circleCache.set(characterId, t);
  return t;
}

/** 格子图标 key（DESIGN 9.3：icon 为空按类型取；公用 12/28 号分别取 power/data） */
export function cellIconKey(cell: { id: number; type: string; icon?: string }): string | null {
  if (cell.icon) {
    const k = 'cells/' + cell.icon.replace(/^cells\//, '').replace(/\.(svg|png)$/, '');
    if (textures.has(k)) return k;
  }
  if (cell.type === 'property') return null;
  if (cell.type === 'utility') return cell.id === 28 ? 'cells/utility_data' : 'cells/utility_power';
  return 'cells/' + cell.type;
}
