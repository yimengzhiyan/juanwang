/** 素材 URL：仓库根 assets/ 由 Vite publicDir 托管，avatar/icon 字段（如 'characters/x.png'）直接拼 BASE_URL */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
