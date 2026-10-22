// Pixi 棋盘：40 格地块卡 + 建筑贴图 + 棋子 + 中央区（底图 / Logo / 奖池 / 骰子）。
// 对外暴露 BoardView（fx/ 目录只通过这里的公开 API 操作画面，见 fx/README.md）。
import { Application, Container, Graphics, Rectangle, Sprite, Text, TextStyle, type Texture } from 'pixi.js';
import gsap from 'gsap';
import { calcRent, isOwnable, JAIL_CELL, type GameState, type Owned, type Player } from '@dafuweng/shared';
import { avatarCircleTex, cellIconKey, hasTex, tex } from '../assets';
import { cellOf, data } from '../store';
import { C, FONT_CN, FONT_NUM, GROUP_COLORS, hex, mix } from '../theme';
import { boardGeometry, BOARD_UNITS, tokenDiameter, tokenOffset, type CellGeom } from './layout';

export interface BoardLayers {
  /** 地块卡、中央区 */
  board: Container;
  /** 建筑贴图（按 y 排序） */
  buildings: Container;
  /** 棋子 */
  tokens: Container;
  /** 特效（棋盘本地坐标，跟随震动） */
  fx: Container;
  /** 屏幕坐标层（不随棋盘震动，坐标 = 视口 CSS 像素） */
  ui: Container;
}

interface CellView {
  root: Container; // 静态内容（被缓存为纹理）
  over: Container; // 交互 + 闪光 / 高亮（不缓存）
  base: Graphics; // 厚度 + 卡面 + 描边（随所有者重绘）
  strip: Graphics;
  icon: Sprite | null;
  name: Text;
  price: Text | null;
  badge: Container | null;
  mortgage: Graphics;
  roadblock: Sprite | null;
  hl: Graphics; // 目标高亮
  dim: Graphics; // 不可选降亮
  flash: Graphics; // 供特效使用的闪光层（默认透明）
}

export interface TokenView {
  root: Container; // 位置 = 棋子中心（棋盘本地坐标）
  body: Container; // 头像 + 环（缩放 / 弹跳作用在这里）
  ring: Graphics;
  avatar: Sprite;
  label: Container;
  shadow: Graphics;
}

const textStyleCache = new Map<string, TextStyle>();
function style(size: number, color: number, weight: '500' | '700' | '800' = '700', family = FONT_CN): TextStyle {
  const key = `${size}|${color}|${weight}|${family}`;
  let s = textStyleCache.get(key);
  if (!s) {
    s = new TextStyle({ fontFamily: family, fontSize: size, fill: color, fontWeight: weight, align: 'center', lineHeight: Math.round(size * 1.12) });
    textStyleCache.set(key, s);
  }
  return s;
}

export class BoardView {
  readonly app: Application;
  /** 棋盘根容器：位置 = 棋盘左上角（屏幕 CSS 像素），不缩放 */
  readonly root = new Container();
  /** 震动作用于 world（root 的唯一子容器） */
  readonly world = new Container();
  readonly layers: BoardLayers;
  /** 普通格短边像素 */
  u = 50;
  /** 棋盘边长像素 */
  size = 600;
  /** 是否使用手机短名模式 */
  compact = false;
  geoms: CellGeom[] = [];

  onCellTap: ((cellId: number) => void) | null = null;
  onTokenTap: ((playerId: string) => void) | null = null;
  /** 由 HUD 注入：玩家条上某玩家头像的屏幕坐标（金币飞向 HUD 用） */
  hudPointResolver: ((playerId: string) => { x: number; y: number } | null) | null = null;

  // ------- 画面模型（fx 可通过方法修改，sync 时以快照为准） -------
  private owned: Record<number, Owned> = {};
  private roadblocks = new Set<number>();
  private players: Player[] = [];
  private tokenCell = new Map<string, number>();
  private jailed = new Set<string>();
  private currentId = '';
  private modifiers = { rentFactor: 1, rentRounds: 0, upgradeFactor: 1, upgradeRounds: 0 };

  private cells: CellView[] = [];
  private buildings = new Map<number, Sprite>();
  private buildingLevel = new Map<number, number>();
  private tokens = new Map<string, TokenView>();
  private center = new Container();
  private staticLayer = new Container();
  private cellOverlay = new Container();
  private invalidateRaf = 0;
  private potText!: Text;
  private infoText!: Text;
  private diceText!: Text;
  private jailBars = new Graphics();
  private hlTweens: gsap.core.Tween[] = [];
  private highlightSet: Set<number> | null = null;
  private tokenHighlight: Set<string> | null = null;
  private potValue = 0;
  private infoValue = '';
  private diceValue = '';

  constructor(app: Application) {
    this.app = app;
    this.layers = {
      board: new Container(),
      buildings: new Container(),
      tokens: new Container(),
      fx: new Container(),
      ui: new Container(),
    };
    this.layers.buildings.sortableChildren = true;
    this.layers.tokens.sortableChildren = true;
    this.world.addChild(this.layers.board, this.layers.buildings, this.layers.tokens, this.layers.fx);
    this.root.addChild(this.world);
    app.stage.addChild(this.root, this.layers.ui);
  }

  private killTweens(): void {
    for (const v of this.cells) if (v.roadblock) gsap.killTweensOf(v.roadblock);
    for (const s of this.buildings.values()) {
      gsap.killTweensOf(s);
      gsap.killTweensOf(s.scale);
    }
    for (const t of this.tokens.values()) {
      gsap.killTweensOf(t.root.position);
      gsap.killTweensOf(t.root.scale);
      gsap.killTweensOf(t.body);
    }
  }

  destroy(): void {
    for (const t of this.hlTweens) t.kill();
    this.killTweens();
    this.app.stage.removeChild(this.root, this.layers.ui);
    this.root.destroy({ children: true });
    this.layers.ui.destroy({ children: true });
  }

  /* =============================== 布局 =============================== */

  /** 把棋盘放到屏幕 (x,y) 处、边长 size；重建全部图形 */
  layout(x: number, y: number, size: number): void {
    this.root.position.set(x, y);
    const u = size / BOARD_UNITS;
    const changed = Math.abs(u - this.u) > 0.01 || this.cells.length === 0;
    this.u = u;
    this.size = size;
    const compact = u < 46;
    if (!changed && compact === this.compact) return;
    this.compact = compact;
    this.geoms = boardGeometry(u, { spread: !compact });
    this.rebuild();
  }

  private rebuild(): void {
    for (const t of this.hlTweens) t.kill();
    this.hlTweens = [];
    this.killTweens();
    const b = this.layers.board;
    b.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.layers.buildings.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.buildings.clear();
    this.buildingLevel.clear();
    for (const t of this.tokens.values()) t.root.destroy({ children: true });
    this.tokens.clear();
    this.layers.tokens.removeChildren();

    // 静态层（卡面 / 文字 / 中央区）缓存成一张纹理，变化时 invalidate() 重绘；
    // 交互与闪光 / 高亮放在不缓存的 overlay 层
    this.staticLayer = new Container();
    this.cellOverlay = new Container();
    b.addChild(this.staticLayer, this.cellOverlay);
    this.buildCenter();
    this.cells = this.geoms.map((g) => this.buildCell(g));
    for (const c of this.cells) {
      this.staticLayer.addChild(c.root);
      this.cellOverlay.addChild(c.over);
    }
    this.staticLayer.cacheAsTexture({ resolution: this.app.renderer.resolution, antialias: true });
    this.jailBars = new Graphics();
    this.jailBars.zIndex = 900;
    this.layers.tokens.addChild(this.jailBars);
    // 恢复模型到画面
    for (let i = 0; i < 40; i++) this.refreshCell(i);
    for (const p of this.players) this.ensureToken(p);
    this.arrangeAll(false);
    if (this.highlightSet) this.highlightCells([...this.highlightSet]);
  }

  private buildCenter(): void {
    const u = this.u;
    const c = new Container();
    this.center = c;
    const inner = 1.5 * u + 0.12 * u;
    const innerSize = this.size - inner * 2;
    const bg = new Graphics().roundRect(inner, inner, innerSize, innerSize, 0.3 * u).fill({ color: C.bg2, alpha: 0.9 });
    c.addChild(bg);
    if (hasTex('boardBg')) {
      const s = new Sprite(tex('boardBg'));
      s.position.set(inner, inner);
      s.width = innerSize;
      s.height = innerSize;
      s.alpha = 0.85;
      c.addChild(s);
    }
    const mid = this.size / 2;
    if (hasTex('logo')) {
      const logo = new Sprite(tex('logo'));
      logo.anchor.set(0.5);
      const w = innerSize * 0.5;
      logo.width = w;
      logo.height = (w * logo.texture.height) / Math.max(1, logo.texture.width);
      logo.position.set(mid, mid - innerSize * 0.12);
      logo.alpha = 0.95;
      c.addChild(logo);
    }
    const big = Math.max(13, Math.round(u * 0.36));
    this.potText = new Text({ text: '', style: style(big, C.gold, '700', FONT_NUM) });
    this.potText.anchor.set(0.5);
    this.potText.position.set(mid, mid + innerSize * 0.08);
    this.infoText = new Text({ text: '', style: style(Math.max(10, Math.round(u * 0.22)), C.textDim, '500') });
    this.infoText.anchor.set(0.5);
    this.infoText.position.set(mid, mid + innerSize * 0.08 + big * 1.05);
    this.diceText = new Text({ text: '', style: style(Math.max(11, Math.round(u * 0.26)), C.text, '700', FONT_NUM) });
    this.diceText.anchor.set(0.5);
    this.diceText.position.set(mid, mid + innerSize * 0.27);
    c.addChild(this.potText, this.infoText, this.diceText);
    this.staticLayer.addChild(c);
    this.setPot(this.potValue);
    this.setInfo(this.infoValue);
    this.diceText.text = this.diceValue;
  }

  private buildCell(g: CellGeom): CellView {
    const u = this.u;
    const cell = cellOf(g.id);
    const root = new Container();
    const over = new Container();
    over.eventMode = 'static';
    over.cursor = 'pointer';
    over.hitArea = new Rectangle(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
    over.on('pointertap', () => this.onCellTap?.(g.id));
    const base = new Graphics();
    const strip = new Graphics();
    root.addChild(base, strip);

    // 图标（非地产）
    let icon: Sprite | null = null;
    const iconKey = cellIconKey(cell);
    // 手机左右两列横长格太矮：有价格的格子（算力 / 公用）不放图标，只留名字 + 价格
    const sideCompact = this.compact && !g.corner && (g.side === 'left' || g.side === 'right') && isOwnable(cell);
    if (iconKey && hasTex(iconKey) && !sideCompact) {
      icon = new Sprite(tex(iconKey));
      icon.anchor.set(0.5);
      const s = g.corner ? 0.82 * u : Math.min(this.compact ? 0.56 * u : 0.46 * u, g.textBox.w * 0.62, g.textBox.h * 0.6);
      icon.width = icon.height = s;
      root.addChild(icon);
    }
    // 名字：手机用短名；桌面长名（≥7 字符）也用短名，其余按宽度先缩字号再换行
    const label = this.compact ? cell.short || cell.name.slice(0, 3) : cell.name.length >= 7 && cell.short ? cell.short : cell.name;
    const box = g.textBox;
    const maxW = box.w - 4;
    const baseSize = g.corner ? (this.compact ? 10 : Math.min(15, u * 0.24)) : this.compact ? Math.min(11, u * 0.32) : Math.min(14, u * 0.235);
    const name = this.fitText(label, maxW, Math.max(8, baseSize), C.text, g.corner ? 2 : this.compact ? 1 : 2, this.compact || g.corner ? 0.85 : 0.7);
    root.addChild(name);
    // 价格 / 费用
    let price: Text | null = null;
    if (isOwnable(cell)) {
      price = new Text({ text: '', style: style(Math.max(8, Math.min(12, u * (this.compact ? 0.27 : 0.18))), C.gold, '700', FONT_NUM) });
      price.anchor.set(0.5);
      root.addChild(price);
    }
    // 竖向排布：图标 → 名字 → 价格，整体在文字区内按 textAlign 对齐
    const gap = Math.max(1, u * 0.04);
    const priceH = price ? Math.round((price.style.fontSize as number) * 1.15) : 0;
    // 放不下（如桌面左右两列的两行名 + 价格）时去掉图标，避免溢出到相邻格
    if (icon && !g.corner && icon.height + name.height + priceH + gap * (price ? 2 : 1) > box.h) {
      icon.destroy();
      icon = null;
    }
    const parts: { h: number; set: (y: number) => void }[] = [];
    const cx = box.x + box.w / 2;
    if (icon) parts.push({ h: icon.height, set: (y) => icon!.position.set(cx, y + icon!.height / 2) });
    name.anchor.set(0.5, 0);
    parts.push({ h: name.height, set: (y) => name.position.set(cx, y) });
    if (price) parts.push({ h: priceH, set: (y) => price!.position.set(cx, y + priceH / 2) });
    const total = parts.reduce((s, p) => s + p.h, 0) + gap * (parts.length - 1);
    const free = Math.max(0, box.h - total);
    let y = box.y + (g.textAlign === 'start' ? 0 : g.textAlign === 'end' ? free : free / 2);
    for (const p of parts) {
      p.set(y);
      y += p.h + gap;
    }

    const mortgage = new Graphics();
    const flash = new Graphics();
    const dim = new Graphics();
    const hl = new Graphics();
    root.addChild(mortgage);
    over.addChild(flash, dim, hl);
    dim.visible = false;
    hl.visible = false;
    return { root, over, base, strip, icon, name, price, badge: null, mortgage, roadblock: null, hl, dim, flash };
  }

  /** 生成一段不超过 maxW 宽的文字：先尝试单行（最多缩到 oneLineShrink），不行就两行，再不行继续缩字号 */
  private fitText(label: string, maxW: number, size: number, color: number, maxLines: number, oneLineShrink = 0.85): Text {
    const min = 7.5;
    const r = (n: number) => Math.round(n * 10) / 10;
    const t = new Text({ text: label, style: style(r(size), color, '800') });
    let s = size;
    while (t.width > maxW && s > Math.max(min, size * oneLineShrink)) {
      s -= 0.5;
      t.style = style(r(s), color, '800');
    }
    if (t.width <= maxW) return t;
    if (maxLines > 1 && label.length > 2) {
      const clean = label.replace(/\s+/g, ' ');
      const mid = Math.ceil(clean.length / 2);
      t.text = clean.slice(0, mid).trim() + '\n' + clean.slice(mid).trim();
      s = size;
    }
    t.style = style(r(s), color, '800');
    while (t.width > maxW && s > min) {
      s -= 0.5;
      t.style = style(r(s), color, '800');
    }
    return t;
  }

  /* =============================== 单格刷新 =============================== */

  private ownerColor(id: string | undefined): number {
    const p = this.players.find((x) => x.id === id);
    return hex(p?.color, C.primary);
  }

  /** 按画面模型重绘某格（所有者、抵押、费用、建筑、路障） */
  refreshCell(id: number): void {
    const v = this.cells[id];
    const g = this.geoms[id];
    if (!v || !g) return;
    const u = this.u;
    const cell = cellOf(id);
    const o = this.owned[id];
    const r = 0.12 * u;
    const groupColor = cell.group ? (GROUP_COLORS[cell.group] ?? hex(data().board.groups.find((x) => x.id === cell.group)?.color)) : null;
    const ownerC = o ? this.ownerColor(o.owner) : null;
    const { x, y, w, h } = g.rect;
    // 厚度 + 卡面
    const depthColor = mix(C.bg0, groupColor ?? C.violet, 0.4);
    let face: number = g.corner ? C.bg3 : C.bg2;
    if (ownerC !== null) face = mix(C.bg2, ownerC, 0.24);
    v.base.clear();
    v.base.roundRect(x + 1, y + 0.1 * u, w, h, r).fill({ color: 0x000000, alpha: 0.35 }); // 软阴影
    v.base.roundRect(x, y + 0.08 * u, w, h, r).fill(depthColor); // 2.5D 厚度
    v.base.roundRect(x, y, w, h, r).fill(face);
    // 顶部高光
    v.base.roundRect(x + 1, y + 1, w - 2, Math.min(h * 0.4, 0.3 * u), r).fill({ color: 0xffffff, alpha: 0.05 });
    if (ownerC !== null) {
      v.base.roundRect(x - 1, y - 1, w + 2, h + 2, r + 1).stroke({ width: Math.max(2, u * 0.05), color: ownerC, alpha: 0.95 });
      v.base.roundRect(x - 3, y - 3, w + 6, h + 6, r + 3).stroke({ width: 2, color: ownerC, alpha: 0.25 });
    } else {
      v.base.roundRect(x, y, w, h, r).stroke({ width: 1, color: g.corner ? C.primary : 0xa0c8ff, alpha: g.corner ? 0.35 : 0.22 });
    }
    // 颜色条
    v.strip.clear();
    if (g.strip && groupColor !== null) {
      const s = g.strip;
      const sc = o?.mortgaged ? 0x6e6e80 : groupColor;
      // 只把颜色条外侧两角做圆角：简单起见整体小圆角
      v.strip.roundRect(s.x, s.y, s.w, s.h, r * 0.7).fill(sc);
      if (g.side === 'bottom') v.strip.rect(s.x + 2, s.y + 1, s.w - 4, 1).fill({ color: 0xffffff, alpha: 0.6 });
    } else if (g.strip && (cell.type === 'compute' || cell.type === 'utility')) {
      const s = g.strip;
      v.strip.roundRect(s.x, s.y, s.w, s.h, r * 0.7).fill({ color: cell.type === 'compute' ? C.violet : C.info, alpha: 0.55 });
    }
    // 价格 / 当前费用
    if (v.price) {
      if (!o) {
        v.price.text = `${cell.price ?? 0}T`;
        v.price.style = style(v.price.style.fontSize as number, C.gold, '700', FONT_NUM);
      } else if (o.mortgaged) {
        v.price.text = '抵押中';
        v.price.style = style(v.price.style.fontSize as number, C.textMute, '700', FONT_CN);
      } else {
        let txt: string;
        if (cell.type === 'utility') {
          const both = Object.entries(this.owned).filter(([k, x]) => x.owner === o.owner && cellOf(Number(k)).type === 'utility').length >= 2;
          txt = `骰×${both ? 10 : 4}`;
        } else {
          txt = `${calcRent(data().board, this.owned, this.modifiers, id, 7)}T`;
        }
        v.price.text = txt;
        v.price.style = style(v.price.style.fontSize as number, C.textDim, '700', FONT_NUM);
      }
    }
    // 主人头像小圆章（桌面）
    if (v.badge) {
      v.badge.destroy({ children: true });
      v.badge = null;
    }
    if (o && !this.compact) {
      const p = this.players.find((pp) => pp.id === o.owner);
      if (p) {
        const d = Math.max(12, 0.26 * u);
        const badge = this.avatarCircle(p.characterId, d, ownerC!);
        badge.position.set(x + w - d * 0.45, y + h - d * 0.45);
        v.root.addChild(badge);
        v.badge = badge;
      }
    }
    // 抵押灰化 + 斜纹
    v.mortgage.clear();
    if (o?.mortgaged) {
      v.mortgage.roundRect(x, y, w, h, r).fill({ color: 0x2a2840, alpha: 0.55 });
      const step = Math.max(6, u * 0.18);
      for (let k = -h; k < w; k += step) {
        const x1 = Math.max(0, k), y1 = Math.max(0, -k);
        const len = Math.min(w - x1, h - y1);
        if (len > 0) v.mortgage.moveTo(x + x1, y + y1).lineTo(x + x1 + len, y + y1 + len);
      }
      v.mortgage.stroke({ width: 1, color: 0xa9a3d9, alpha: 0.35 });
    }
    // 路障
    if (this.roadblocks.has(id)) {
      if (!v.roadblock && hasTex('items/roadblock')) {
        const s = new Sprite(tex('items/roadblock'));
        s.anchor.set(0.5);
        s.width = s.height = Math.max(16, 0.6 * u);
        s.position.set(g.center.x, g.center.y - 0.15 * u);
        s.zIndex = 10;
        this.layers.buildings.addChild(s);
        s.label = 'roadblock';
        v.roadblock = s;
        gsap.to(s, { y: s.y - 2, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      }
    } else if (v.roadblock) {
      gsap.killTweensOf(v.roadblock);
      v.roadblock.destroy();
      v.roadblock = null;
    }
    // 建筑
    const wantLevel = o && cell.type === 'property' ? o.level : -1;
    this.applyBuilding(id, wantLevel);
    this.invalidate();
  }

  /** 静态层内容变化后调用：下一帧重绘缓存纹理（多次调用合并） */
  invalidate(): void {
    if (this.invalidateRaf) return;
    this.invalidateRaf = requestAnimationFrame(() => {
      this.invalidateRaf = 0;
      if (!this.staticLayer.destroyed) this.staticLayer.updateCacheTexture();
    });
  }

  private applyBuilding(id: number, level: number): void {
    const cur = this.buildingLevel.get(id) ?? -1;
    if (cur === level && (level < 0 || this.buildings.has(id))) {
      const s = this.buildings.get(id);
      if (s) s.tint = this.owned[id]?.mortgaged ? 0x777788 : 0xffffff;
      return;
    }
    const old = this.buildings.get(id);
    if (old) {
      gsap.killTweensOf(old);
      gsap.killTweensOf(old.scale);
      old.destroy();
      this.buildings.delete(id);
    }
    this.buildingLevel.set(id, level);
    if (level < 0) return;
    const texture = this.buildingTexture(id, level);
    if (!texture) return;
    const s = this.makeBuildingSprite(id, texture, level);
    this.layers.buildings.addChild(s);
    this.buildings.set(id, s);
  }

  /** 按颜色组定制的建筑纹理缓存：key = `${group}:${level}` */
  private groupBuildingTex = new Map<string, Texture>();

  /**
   * 返回某格某等级的建筑纹理。同一套 lv0~lv5 贴图，按地块所属颜色组做差异化：
   * 轻微向组色偏色 + 组色发光地台 + 组色小旗，让 8 个组的建筑一眼能分开。
   */
  private buildingTexture(id: number, level: number): Texture | null {
    const lv = Math.min(5, Math.max(0, level));
    const key = 'buildings/' + lv;
    if (!hasTex(key)) return null;
    const base = tex(key);
    const cell = cellOf(id);
    const groupColor = cell.group
      ? (GROUP_COLORS[cell.group] ?? hex(data().board.groups.find((x) => x.id === cell.group)?.color))
      : null;
    if (groupColor === null) return base;
    const cacheKey = `${cell.group}:${lv}`;
    const cached = this.groupBuildingTex.get(cacheKey);
    if (cached) return cached;
    try {
      const W = base.width, H = base.height;
      const wrap = new Container();
      // 地台光晕（在建筑脚下，anchor 0.84 处）
      const glow = new Graphics();
      const gy = 0.84 * H;
      glow.ellipse(W / 2, gy, 0.44 * W, 0.11 * H).fill({ color: groupColor, alpha: lv === 0 ? 0.28 : 0.42 });
      glow.ellipse(W / 2, gy, 0.3 * W, 0.07 * H).fill({ color: mix(groupColor, 0xffffff, 0.5), alpha: 0.35 });
      wrap.addChild(glow);
      // 建筑本体：lv0 空地不偏色，其余轻微染成组色
      const body = new Sprite(base);
      body.tint = lv === 0 ? 0xffffff : mix(0xffffff, groupColor, 0.3);
      wrap.addChild(body);
      // 组色小旗（lv1+）：左上角一根旗杆 + 三角旗
      if (lv >= 1) {
        const flag = new Graphics();
        const px = 0.14 * W, top = 0.08 * H, bottom = 0.34 * H;
        flag.moveTo(px, top).lineTo(px, bottom).stroke({ width: Math.max(2, 0.012 * W), color: 0xf2f0ff });
        flag.circle(px, top, Math.max(2, 0.016 * W)).fill(0xffc83d);
        flag.moveTo(px, top + 0.01 * H).lineTo(px + 0.16 * W, top + 0.06 * H).lineTo(px, top + 0.12 * H).closePath()
          .fill(groupColor).stroke({ width: Math.max(1.5, 0.008 * W), color: 0x1a1240 });
        wrap.addChild(flag);
      }
      const rt = this.app.renderer.generateTexture({ target: wrap, frame: new Rectangle(0, 0, W, H), resolution: 1 });
      wrap.destroy({ children: true });
      this.groupBuildingTex.set(cacheKey, rt);
      return rt;
    } catch {
      return base;
    }
  }

  private makeBuildingSprite(id: number, texture: Texture, level: number): Sprite {
    const g = this.geoms[id];
    const s = new Sprite(texture);
    s.anchor.set(0.5, 0.84);
    const size = g.buildingSize * (level >= 5 ? 1.2 : level === 0 ? 0.78 : 1);
    s.width = s.height = size;
    s.position.set(g.buildingAnchor.x, g.buildingAnchor.y);
    s.zIndex = g.buildingAnchor.y;
    s.alpha = level === 0 ? 0.85 : 1;
    s.tint = this.owned[id]?.mortgaged ? 0x777788 : 0xffffff;
    s.label = `building-${id}`;
    return s;
  }

  private avatarCircle(characterId: string, d: number, ringColor: number): Container {
    const c = new Container();
    const ring = new Graphics().circle(0, 0, d / 2 + 1.5).fill(ringColor);
    const sp = new Sprite(avatarCircleTex(characterId));
    sp.anchor.set(0.5);
    sp.width = sp.height = d - 1;
    c.addChild(ring, sp);
    return c;
  }

  /* =============================== 棋子 =============================== */

  private ensureToken(p: Player): TokenView {
    let t = this.tokens.get(p.id);
    if (t) return t;
    const u = this.u;
    const d = tokenDiameter(u, false);
    const color = hex(p.color, C.primary);
    const root = new Container();
    root.label = `token-${p.id}`;
    const shadow = new Graphics().ellipse(0, d * 0.48, d * 0.42, d * 0.13).fill({ color: 0x000000, alpha: 0.4 });
    const body = new Container();
    const ring = new Graphics();
    ring.circle(0, 0, d / 2 + 3.5).fill(color);
    ring.circle(0, 0, d / 2 + 1.5).fill(0xffffff);
    const avatar = new Sprite(avatarCircleTex(p.characterId));
    avatar.anchor.set(0.5);
    avatar.width = avatar.height = d;
    body.addChild(ring, avatar);
    // 序号角标（与玩家条序号一致，区分同色系棋子）
    const idx = this.players.findIndex((x) => x.id === p.id);
    if (idx >= 0) {
      const br = Math.max(6, d * 0.2);
      const badge = new Container();
      badge.label = 'token-index';
      badge.addChild(new Graphics().circle(0, 0, br).fill(color).stroke({ width: 1.5, color: 0xffffff }));
      const num = new Text({ text: String(idx + 1), style: style(Math.round(br * 1.35), 0xffffff, '800', FONT_NUM) });
      num.anchor.set(0.5);
      badge.addChild(num);
      badge.position.set(d * 0.4, d * 0.36);
      body.addChild(badge);
    }
    // 名字小标签
    const label = new Container();
    const fs = Math.max(9, Math.min(12, u * 0.2));
    const txt = new Text({ text: p.name.length > 5 ? p.name.slice(0, 5) + '…' : p.name, style: style(fs, 0xffffff, '700') });
    txt.anchor.set(0.5);
    const pad = 3;
    const bg = new Graphics()
      .roundRect(-txt.width / 2 - pad - 1, -txt.height / 2 - 1, txt.width + pad * 2 + 2, txt.height + 2, (txt.height + 2) / 2)
      .fill({ color, alpha: 0.92 })
      .stroke({ width: 1, color: C.outline, alpha: 0.8 });
    label.addChild(bg, txt);
    label.position.set(0, d / 2 + txt.height / 2 + 2);
    root.addChild(shadow, body, label);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.on('pointertap', (e) => {
      e.stopPropagation();
      if (this.onTokenTap) this.onTokenTap(p.id);
      else this.onCellTap?.(this.tokenCell.get(p.id) ?? 0);
    });
    t = { root, body, ring, avatar, label, shadow };
    this.tokens.set(p.id, t);
    this.layers.tokens.addChild(root);
    return t;
  }

  /** 某玩家棋子在其当前格的“静止位置”（考虑同格人数、监管） */
  tokenRestPosition(playerId: string): { x: number; y: number; scale: number } {
    const cellId = this.tokenCell.get(playerId) ?? 0;
    const g = this.geoms[cellId];
    const u = this.u;
    const jailed = this.jailed.has(playerId) && cellId === JAIL_CELL;
    const mates = this.players.filter(
      (p) => !p.bankrupt && (this.tokenCell.get(p.id) ?? 0) === cellId && (cellId !== JAIL_CELL || this.jailed.has(p.id) === jailed),
    );
    const idx = Math.max(0, mates.findIndex((p) => p.id === playerId));
    const n = Math.max(1, mates.length);
    const off = tokenOffset(g, idx, n, u * (cellId === JAIL_CELL ? 0.62 : 1));
    let cx = g.tokenCenter.x;
    let cy = g.tokenCenter.y;
    if (cellId === JAIL_CELL) {
      // 监管格：关押者在内框右上，路过者在外框左下
      if (jailed) {
        cx = g.rect.x + g.rect.w * 0.66;
        cy = g.rect.y + g.rect.h * 0.34;
      } else {
        cx = g.rect.x + g.rect.w * 0.32;
        cy = g.rect.y + g.rect.h * 0.7;
      }
    }
    const crowded = n > 1;
    const base = tokenDiameter(u, false);
    const scale = (crowded ? tokenDiameter(u, true) / base : 1) * (playerId === this.currentId ? 1.15 : 1);
    return { x: cx + off.x, y: cy + off.y, scale };
  }

  /** 重新排布所有棋子到静止位置 */
  arrangeAll(animate = true): void {
    for (const p of this.players) {
      const t = this.tokens.get(p.id);
      if (!t) continue;
      t.root.visible = !p.bankrupt;
      if (p.bankrupt) continue;
      this.placeToken(p.id, animate);
    }
    this.drawJailBars();
  }

  /** 把某棋子放到静止位置 */
  placeToken(playerId: string, animate = true): void {
    const t = this.tokens.get(playerId);
    if (!t) return;
    const pos = this.tokenRestPosition(playerId);
    const cellId = this.tokenCell.get(playerId) ?? 0;
    const mates = this.players.filter((p) => !p.bankrupt && (this.tokenCell.get(p.id) ?? 0) === cellId).length;
    t.label.visible = playerId === this.currentId || (mates <= 1 && !this.compact);
    // 名字标签朝棋盘外侧：顶边一排放到棋子上方，其余放下方（避免压住格子名）
    const g = this.geoms[cellId];
    const below = Math.abs(t.label.y);
    t.label.y = !this.compact && g && !g.corner && g.side === 'top' ? -below : below;
    t.root.zIndex = playerId === this.currentId ? 1000 : pos.y;
    gsap.killTweensOf(t.root.position);
    gsap.killTweensOf(t.root.scale);
    if (animate) {
      gsap.to(t.root.position, { x: pos.x, y: pos.y, duration: 0.25, ease: 'power2.out' });
      gsap.to(t.root.scale, { x: pos.scale, y: pos.scale, duration: 0.25, ease: 'power2.out' });
    } else {
      t.root.position.set(pos.x, pos.y);
      t.root.scale.set(pos.scale);
    }
  }

  private drawJailBars(): void {
    const g = this.geoms[JAIL_CELL];
    const bars = this.jailBars;
    bars.clear();
    if (!g) return;
    const anyJailed = this.players.some((p) => !p.bankrupt && this.jailed.has(p.id) && this.tokenCell.get(p.id) === JAIL_CELL);
    if (!anyJailed) return;
    const x0 = g.rect.x + g.rect.w * 0.4, y0 = g.rect.y + 2, w = g.rect.w * 0.58, hh = g.rect.h * 0.6;
    bars.roundRect(x0, y0, w, hh, 4).stroke({ width: 2, color: 0xc9c3ff, alpha: 0.9 });
    const n = 5;
    for (let i = 1; i < n; i++) bars.moveTo(x0 + (w * i) / n, y0).lineTo(x0 + (w * i) / n, y0 + hh);
    bars.stroke({ width: 2, color: 0xc9c3ff, alpha: 0.75 });
  }

  /* =============================== 同步 =============================== */

  /** 以服务端快照为准刷新全部画面 */
  sync(state: GameState): void {
    this.players = state.players;
    this.owned = JSON.parse(JSON.stringify(state.owned)) as Record<number, Owned>;
    this.roadblocks = new Set(state.roadblocks);
    this.modifiers = { ...state.modifiers };
    this.currentId = state.currentPlayerId;
    this.jailed = new Set(state.players.filter((p) => p.inJail).map((p) => p.id));
    for (const p of state.players) {
      this.tokenCell.set(p.id, p.pos);
      this.ensureToken(p);
    }
    for (let i = 0; i < 40; i++) this.refreshCell(i);
    this.arrangeAll(true);
    this.setPot(state.pot);
    const rounds = state.settings.maxRounds > 0 ? `第 ${state.round}/${state.settings.maxRounds} 轮` : `第 ${state.round} 轮`;
    const mods: string[] = [];
    if (state.modifiers.rentRounds > 0) mods.push(`调用费×${state.modifiers.rentFactor}`);
    if (state.modifiers.upgradeRounds > 0) mods.push(`升级费×${state.modifiers.upgradeFactor}`);
    this.setInfo([rounds, ...mods].join(' · '));
    if (state.dice) this.setDice(state.dice[0], state.dice[1]);
  }

  /** 初始化玩家列表（首个快照之前也可调用） */
  setPlayers(players: Player[]): void {
    this.players = players;
    for (const p of players) {
      if (!this.tokenCell.has(p.id)) this.tokenCell.set(p.id, p.pos);
      this.ensureToken(p);
    }
  }

  /* ====================== 供 fx / 事件队列调用的操作 ====================== */

  setOwner(cellId: number, ownerId: string | null): void {
    if (ownerId) this.owned[cellId] = { owner: ownerId, level: this.owned[cellId]?.level ?? 0, mortgaged: false };
    else delete this.owned[cellId];
    this.refreshCell(cellId);
    // 同组 / 同类费用可能变化
    for (let i = 0; i < 40; i++) if (i !== cellId && this.owned[i]) this.refreshCell(i);
  }

  setLevel(cellId: number, level: number): void {
    const o = this.owned[cellId];
    if (o) o.level = level;
    this.refreshCell(cellId);
  }

  setMortgaged(cellId: number, on: boolean): void {
    const o = this.owned[cellId];
    if (o) o.mortgaged = on;
    this.refreshCell(cellId);
  }

  addRoadblock(cellId: number): void {
    this.roadblocks.add(cellId);
    this.refreshCell(cellId);
  }

  removeRoadblock(cellId: number): void {
    this.roadblocks.delete(cellId);
    this.refreshCell(cellId);
  }

  /** 更新棋子所在格（不移动画面，配合 placeToken / arrangeAll） */
  setTokenCell(playerId: string, cellId: number, jailed?: boolean): void {
    const prev = this.tokenCell.get(playerId);
    this.tokenCell.set(playerId, cellId);
    if (jailed !== undefined) {
      if (jailed) this.jailed.add(playerId);
      else this.jailed.delete(playerId);
    }
    // 同格其他人重新排布
    for (const p of this.players) {
      if (p.id === playerId) continue;
      const c = this.tokenCell.get(p.id);
      if (c === cellId || c === prev) this.placeToken(p.id, true);
    }
    this.drawJailBars();
  }

  setJailed(playerId: string, jailed: boolean): void {
    if (jailed) this.jailed.add(playerId);
    else this.jailed.delete(playerId);
    this.arrangeAll(true);
  }

  setCurrent(playerId: string): void {
    this.currentId = playerId;
    this.arrangeAll(true);
  }

  setBankrupt(playerId: string): void {
    const p = this.players.find((x) => x.id === playerId);
    if (p) this.players = this.players.map((x) => (x.id === playerId ? { ...x, bankrupt: true } : x));
    const t = this.tokens.get(playerId);
    if (t) t.root.visible = false;
    this.arrangeAll(true);
  }

  setPot(n: number): void {
    this.potValue = n;
    if (this.potText) this.potText.text = `开源节奖池 ${n}T`;
    this.invalidate();
  }

  setInfo(text: string): void {
    this.infoValue = text;
    if (this.infoText) this.infoText.text = text;
    this.invalidate();
  }

  /** 中央小骰子读数（a=点数1，b=点数2，b=0 表示乌龟） */
  setDice(a: number, b: number, extra = ''): void {
    this.diceValue = b > 0 ? `点数 ${a} + ${b}${extra}` : `点数 ${a}${extra}`;
    if (this.diceText) this.diceText.text = this.diceValue;
    this.invalidate();
  }

  /* ====================== 目标选择高亮 ====================== */

  /** 高亮可选格子（其余降亮）；null 取消 */
  highlightCells(ids: number[] | null): void {
    for (const t of this.hlTweens.splice(0)) t.kill();
    this.highlightSet = ids ? new Set(ids) : null;
    this.cells.forEach((v, i) => {
      const g = this.geoms[i];
      v.hl.clear();
      v.dim.clear();
      v.hl.visible = false;
      v.dim.visible = false;
      v.hl.alpha = 1;
      if (!ids) return;
      if (this.highlightSet!.has(i)) {
        const r = 0.12 * this.u;
        v.hl.roundRect(g.rect.x - 2, g.rect.y - 2, g.rect.w + 4, g.rect.h + 4, r + 2).stroke({ width: 3, color: C.primary });
        v.hl.roundRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h, r).fill({ color: C.primary, alpha: 0.18 });
        v.hl.visible = true;
        this.hlTweens.push(gsap.to(v.hl, { alpha: 0.35, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }));
      } else {
        v.dim.roundRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h, 0.12 * this.u).fill({ color: 0x05020f, alpha: 0.5 });
        v.dim.visible = true;
      }
    });
  }

  /** 高亮可选玩家棋子；null 取消 */
  highlightTokens(ids: string[] | null): void {
    this.tokenHighlight = ids ? new Set(ids) : null;
    for (const [pid, t] of this.tokens) {
      gsap.killTweensOf(t.body);
      t.body.alpha = 1;
      if (!ids) continue;
      if (this.tokenHighlight!.has(pid)) {
        gsap.to(t.body, { alpha: 0.55, duration: 0.5, yoyo: true, repeat: -1 });
      } else t.body.alpha = 0.4;
    }
  }

  /* ====================== 只读查询（fx 使用） ====================== */

  /** 格子中心（棋盘本地坐标，= layers.fx 坐标） */
  cellCenter(id: number): { x: number; y: number } {
    const g = this.geoms[((id % 40) + 40) % 40];
    return { x: g.center.x, y: g.center.y };
  }

  /** 格子正文区中心（棋子站位基准） */
  cellTokenCenter(id: number): { x: number; y: number } {
    const g = this.geoms[((id % 40) + 40) % 40];
    return { ...g.tokenCenter };
  }

  cellRect(id: number): { x: number; y: number; w: number; h: number } {
    return { ...this.geoms[id].rect };
  }

  cellGeom(id: number): CellGeom {
    return this.geoms[id];
  }

  /** 格子静态容器（卡面、颜色条、文字；该层被缓存为纹理，改动后请调用 invalidate()；做动画请用 cellFlashLayer / cellOverlayContainer / layers.fx） */
  cellContainer(id: number): Container {
    return this.cells[id].root;
  }

  /** 格子的不缓存覆盖容器（交互区域 + 闪光 / 高亮层，可往里加动画子节点） */
  cellOverlayContainer(id: number): Container {
    return this.cells[id].over;
  }

  /** 格子的“闪光层” Graphics（默认空，fx 可自由绘制 / 清空） */
  cellFlashLayer(id: number): Graphics {
    return this.cells[id].flash;
  }

  /** 建筑精灵（无建筑时 null） */
  buildingSprite(id: number): Sprite | null {
    return this.buildings.get(id) ?? null;
  }

  /** 为某格某等级创建一个新的建筑精灵（未加入舞台），供特效做替换动画 */
  createBuildingSprite(id: number, level: number): Sprite | null {
    const texture = this.buildingTexture(id, level);
    if (!texture) return null;
    return this.makeBuildingSprite(id, texture, level);
  }

  /** 棋子根容器（position = 棋子中心，scale 由布局控制；做弹跳请改 tokenView().body） */
  tokenSprite(playerId: string): Container | null {
    return this.tokens.get(playerId)?.root ?? null;
  }

  tokenView(playerId: string): TokenView | null {
    return this.tokens.get(playerId) ?? null;
  }

  tokenCellOf(playerId: string): number {
    return this.tokenCell.get(playerId) ?? 0;
  }

  player(playerId: string): Player | undefined {
    return this.players.find((p) => p.id === playerId);
  }

  playerColor(playerId: string): number {
    return this.ownerColor(playerId);
  }

  ownerOf(cellId: number): string | null {
    return this.owned[cellId]?.owner ?? null;
  }

  levelOf(cellId: number): number {
    return this.owned[cellId]?.level ?? 0;
  }

  /** 棋盘中心（本地坐标） */
  boardCenter(): { x: number; y: number } {
    return { x: this.size / 2, y: this.size / 2 };
  }

  /** 棋盘本地坐标 → 视口 CSS 像素（HTML 覆盖层定位用） */
  worldToScreen(p: { x: number; y: number }): { x: number; y: number } {
    const g = this.world.toGlobal(p);
    return { x: g.x, y: g.y };
  }

  /** 视口 CSS 像素 → 棋盘本地坐标 */
  screenToWorld(p: { x: number; y: number }): { x: number; y: number } {
    const l = this.world.toLocal(p);
    return { x: l.x, y: l.y };
  }

  /** 玩家条头像的屏幕坐标（没有 HUD 时退回棋子位置） */
  hudPoint(playerId: string): { x: number; y: number } {
    const p = this.hudPointResolver?.(playerId);
    if (p) return p;
    const t = this.tokens.get(playerId);
    return t ? this.worldToScreen(t.root.position) : this.worldToScreen(this.boardCenter());
  }

  /** 棋盘在屏幕上的矩形 */
  screenRect(): { x: number; y: number; size: number } {
    return { x: this.root.x, y: this.root.y, size: this.size };
  }
}
