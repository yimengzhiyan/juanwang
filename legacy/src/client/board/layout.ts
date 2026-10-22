// 棋盘几何与页面自适应。
// 棋盘 = 12u × 12u：角格 1.5u，普通格 1u × 1.5u（左右两列横长 1.5u × 1u）。0 号在右下角，顺时针。
// 颜色条始终朝棋盘中心；建筑立在格子朝中心一侧的“建筑带”（内圈 0.9u）上。

export type Side = 'bottom' | 'left' | 'top' | 'right';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CellGeom {
  id: number;
  side: Side; // 角格按其所在“起始”边：0 bottom、10 left、20 top、30 right
  corner: boolean;
  rect: Rect; // 棋盘本地坐标（px）
  center: { x: number; y: number };
  /** 颜色条区域（只对 property 有意义；角格为 null） */
  strip: Rect | null;
  /** 正文区（去掉颜色条后的区域） */
  body: Rect;
  /** 建筑贴图底部中心锚点 */
  buildingAnchor: { x: number; y: number };
  /** 建筑默认宽度 */
  buildingSize: number;
  /** 棋子站位中心（手机：正文区中心；桌面普通格：偏向远离颜色条的外侧，避免盖住格子名） */
  tokenCenter: { x: number; y: number };
  /** 文字区（图标 / 名字 / 价格竖排放在这里）及其竖直对齐方式 */
  textBox: Rect;
  textAlign: 'center' | 'start' | 'end';
}

export interface GeometryOptions {
  /** 桌面（非紧凑）布局：文字靠颜色条、棋子靠外侧 */
  spread?: boolean;
}

export const BOARD_UNITS = 12;
export const CORNER_U = 1.5;
export const STRIP_U = 0.3;
export const GAP_U = 0.06;

/** 计算 40 格几何。u = 普通格短边像素 */
export function boardGeometry(u: number, opts: GeometryOptions = {}): CellGeom[] {
  const out: CellGeom[] = [];
  const C = CORNER_U * u;
  const S = BOARD_UNITS * u;
  const g = GAP_U * u * 0.5;
  for (let id = 0; id < 40; id++) {
    let rect: Rect;
    let side: Side;
    const corner = id % 10 === 0;
    if (id === 0) {
      rect = { x: S - C, y: S - C, w: C, h: C };
      side = 'bottom';
    } else if (id < 10) {
      rect = { x: S - C - id * u, y: S - C, w: u, h: C };
      side = 'bottom';
    } else if (id === 10) {
      rect = { x: 0, y: S - C, w: C, h: C };
      side = 'left';
    } else if (id < 20) {
      rect = { x: 0, y: S - C - (id - 10) * u, w: C, h: u };
      side = 'left';
    } else if (id === 20) {
      rect = { x: 0, y: 0, w: C, h: C };
      side = 'top';
    } else if (id < 30) {
      rect = { x: C + (id - 21) * u, y: 0, w: u, h: C };
      side = 'top';
    } else if (id === 30) {
      rect = { x: S - C, y: 0, w: C, h: C };
      side = 'right';
    } else {
      rect = { x: S - C, y: C + (id - 31) * u, w: C, h: u };
      side = 'right';
    }
    // 格间距
    rect = { x: rect.x + g, y: rect.y + g, w: rect.w - 2 * g, h: rect.h - 2 * g };
    const st = STRIP_U * u;
    let strip: Rect | null = null;
    let body: Rect = rect;
    if (!corner) {
      if (side === 'bottom') {
        strip = { x: rect.x, y: rect.y, w: rect.w, h: st };
        body = { x: rect.x, y: rect.y + st, w: rect.w, h: rect.h - st };
      } else if (side === 'top') {
        strip = { x: rect.x, y: rect.y + rect.h - st, w: rect.w, h: st };
        body = { x: rect.x, y: rect.y, w: rect.w, h: rect.h - st };
      } else if (side === 'left') {
        strip = { x: rect.x + rect.w - st, y: rect.y, w: st, h: rect.h };
        body = { x: rect.x, y: rect.y, w: rect.w - st, h: rect.h };
      } else {
        strip = { x: rect.x, y: rect.y, w: st, h: rect.h };
        body = { x: rect.x + st, y: rect.y, w: rect.w - st, h: rect.h };
      }
    }
    // 建筑锚点：立在格子朝中心的内圈建筑带上（底部中心）
    const bs = 0.86 * u;
    let anchor: { x: number; y: number };
    switch (side) {
      case 'bottom':
        anchor = { x: rect.x + rect.w / 2, y: rect.y + st * 0.9 };
        break;
      case 'top':
        anchor = { x: rect.x + rect.w / 2, y: rect.y + rect.h + 0.78 * u };
        break;
      case 'left':
        anchor = { x: rect.x + rect.w + 0.46 * u, y: rect.y + rect.h * 0.92 };
        break;
      default:
        anchor = { x: rect.x - 0.46 * u, y: rect.y + rect.h * 0.92 };
    }
    // 棋子站位与文字区
    let tokenCenter = { x: body.x + body.w / 2, y: body.y + body.h / 2 };
    let textBox: Rect = body;
    let textAlign: CellGeom['textAlign'] = 'center';
    if (opts.spread && !corner) {
      const pad = 0.05 * u;
      switch (side) {
        case 'bottom': // 颜色条在上：文字顶对齐，棋子站在下沿
          textBox = { x: body.x, y: body.y + pad, w: body.w, h: body.h - pad };
          textAlign = 'start';
          tokenCenter = { x: tokenCenter.x, y: rect.y + rect.h - 0.24 * u };
          break;
        case 'top': // 颜色条在下：文字底对齐，棋子站在上沿
          textBox = { x: body.x, y: body.y, w: body.w, h: body.h - pad };
          textAlign = 'end';
          tokenCenter = { x: tokenCenter.x, y: rect.y + 0.24 * u };
          break;
        case 'left': // 颜色条在右：文字靠右，棋子站在左沿（略探出棋盘）
          textBox = { x: body.x + 0.3 * u, y: body.y, w: body.w - 0.3 * u, h: body.h };
          tokenCenter = { x: rect.x + 0.1 * u, y: tokenCenter.y };
          break;
        default: // right：颜色条在左：文字靠左，棋子站在右沿
          textBox = { x: body.x, y: body.y, w: body.w - 0.3 * u, h: body.h };
          tokenCenter = { x: rect.x + rect.w - 0.1 * u, y: tokenCenter.y };
      }
    }
    out.push({
      id,
      side,
      corner,
      rect,
      center: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
      strip,
      body,
      buildingAnchor: anchor,
      buildingSize: bs,
      tokenCenter,
      textBox,
      textAlign,
    });
  }
  return out;
}

/** 同格多人偏移表（ART.md 4.3），单位 u，y 向下 */
const OFFSETS: [number, number][][] = [
  [[0, 0]],
  [[-0.2, 0], [0.2, 0]],
  [[0, -0.16], [-0.22, 0.12], [0.22, 0.12]],
  [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.16], [0.2, 0.16]],
  [[-0.24, -0.16], [0.24, -0.16], [0, 0], [-0.24, 0.18], [0.24, 0.18]],
  [[-0.26, -0.14], [0, -0.14], [0.26, -0.14], [-0.26, 0.16], [0, 0.16], [0.26, 0.16]],
];

/** 第 index 个人（共 count 人）在格子里的偏移（px） */
export function tokenOffset(geom: CellGeom, index: number, count: number, u: number): { x: number; y: number } {
  const table = OFFSETS[Math.max(0, Math.min(OFFSETS.length, count) - 1)];
  const [ox, oy] = table[Math.min(index, table.length - 1)];
  let x = ox, y = oy;
  if (!geom.corner && (geom.side === 'left' || geom.side === 'right')) [x, y] = [oy * 1.2, ox * 0.9]; // 横长格对调
  const k = geom.corner ? 1.4 : 1;
  return { x: x * u * k, y: y * u * k };
}

/** 棋子直径（单人 0.42u / 多人 0.34u），手机上略放大保证可见 */
export function tokenDiameter(u: number, crowded: boolean): number {
  const base = (crowded ? 0.36 : 0.46) * u;
  return Math.max(base, crowded ? 13 : 16);
}

/* ---------------------------- 页面布局 ---------------------------- */

export type LayoutMode = 'desktop' | 'tablet' | 'mobile' | 'landscapePhone';

export function layoutMode(w = window.innerWidth, h = window.innerHeight): LayoutMode {
  if (h < 520 && w > h) return 'landscapePhone';
  if (w < 760 || h > w * 1.15) return 'mobile';
  if (w < 1100) return 'tablet';
  return 'desktop';
}

/** 在 slot 矩形内放置正方形棋盘（居中），返回 {x,y,size} */
export function fitBoard(slot: DOMRect | Rect, margin = 4): { x: number; y: number; size: number } {
  const w = 'width' in slot ? slot.width : slot.w;
  const hh = 'height' in slot ? slot.height : slot.h;
  const x0 = 'left' in slot ? slot.left : slot.x;
  const y0 = 'top' in slot ? slot.top : slot.y;
  const size = Math.max(120, Math.floor(Math.min(w, hh) - margin * 2));
  return { x: Math.round(x0 + (w - size) / 2), y: Math.round(y0 + (hh - size) / 2), size };
}
