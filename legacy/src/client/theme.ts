// 配色常量（与 style.css 的 CSS 变量同值，供 Pixi 使用）。见 docs/ART.md 第 1 节。
export const C = {
  bg0: 0x0b0820,
  bg1: 0x140f35,
  bg2: 0x1e1650,
  bg3: 0x2a1f6e,
  primary: 0x22e5ff,
  primaryDeep: 0x0ea5c6,
  accent: 0xff3dcb,
  violet: 0x8b5cf6,
  gold: 0xffc83d,
  goldLight: 0xffe27a,
  success: 0x2ee59d,
  danger: 0xff4d6d,
  warning: 0xffb547,
  info: 0x5ec8ff,
  text: 0xf2f0ff,
  textDim: 0xa9a3d9,
  textMute: 0x6e68a3,
  outline: 0x1a1240,
} as const;

export const GROUP_COLORS: Record<string, number> = {
  brown: 0xc98a5a,
  lightblue: 0x5fd4ff,
  pink: 0xff7ac6,
  orange: 0xffa94d,
  red: 0xff5470,
  yellow: 0xffd93d,
  green: 0x3ddc97,
  darkblue: 0x5b6cff,
};

export const FONT_NUM = '"Fredoka", "PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei", "Noto Sans SC", sans-serif';
export const FONT_CN = '"PingFang SC", "HarmonyOS Sans SC", "MiSans", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif';

/** '#RRGGBB' → 0xRRGGBB */
export function hex(color: string | undefined, fallback = 0x888888): number {
  if (!color) return fallback;
  const n = parseInt(color.replace('#', ''), 16);
  return Number.isFinite(n) ? n : fallback;
}

/** 两色线性混合（t=0 → a，t=1 → b） */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function cssColor(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}
