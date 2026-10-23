// 战斗页：按 BattleEvent 顺序播放（1x / 2x / 跳过）。敌方一排居中在上、我方一排居中在下（都是前排在左），
// 两排之间隔约 1.5 张卡高；每次攻击双方前排离队冲向中间的"擂台线"相撞（我方向上、敌方向下），火花在接触点。
import gsap from 'gsap';
import {
  applyBattleResult, battleForState, offlineOpponent, tutorialEnemy,
  type BattleEvent, type BattleResult, type GameData, type Level, type RunState, type Side, type UnitInst, type UnitRef, type UnitSnap,
} from '@juanwang/shared';
import { app, markSeen, setRun, settings, type Scene } from '../store';
import { topbar, updateTopbar } from '../ui/team';
import { esc, plain, setCardStats, setShield, unitCard } from '../ui/cards';
import { showUnitDetail } from '../ui/modal';
import { center, edgeFlash, floatText, fullscreen, getFxLayer, reducedMotion, setTimeScale, skipWaits, toShell, wait } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';
import { api } from '../net';
import { ui } from '../assets';
import { showResult } from './result';

interface BU {
  uid: string;
  defId: string;
  side: Side;
  atk: number;
  hp: number;
  baseAtk: number;
  maxHp: number;
  level: Level;
  shield: number;
  el: HTMLElement; // 定位容器
  card: HTMLElement;
  alive: boolean;
}

const BOT_NAMES = ['AI 练习生', '调参实习生', '炼丹学徒', '卷王预备役', '开源小白', '算力搬砖工'];
const FAC_COLOR: Record<string, string> = { open: '#58C65C', closed: '#2F80ED', compute: '#FF8C42', folk: '#FF7EB6' };
const FAC_DARK: Record<string, string> = { open: '#3E9E44', closed: '#1F5FC0', compute: '#D9692A', folk: '#D85A92' };
const FAC_NAME: Record<string, string> = { open: '开源', closed: '闭源', compute: '算力', folk: '民间' };

/** 调试/自动化：当前战斗的控制 */
export const battleCtl = { skip: (): void => {}, speed: (_n: number): void => {}, playing: false };

export function battleScene(): Scene {
  const data = app.data;
  const el = document.createElement('div');
  const top = topbar();
  top.classList.add('topbar--battle');
  const speed = document.createElement('div');
  speed.className = 'speed';
  speed.innerHTML = `<button data-sp="1" class="on">1x</button><button data-sp="2">2x</button><button data-sp="skip">跳过</button>`;
  top.insertBefore(speed, top.querySelector('.hud-mute'));
  const net = top.querySelector('.net-tag');
  if (net) top.insertBefore(net, speed);
  const arena = document.createElement('div');
  arena.className = 'arena';
  arena.innerHTML = `
    <div class="side-label side-label--enemy"><span class="opp-name">匹配对手中…</span></div>
    <div class="field"><div class="ring-line"></div></div>
    <div class="vs"><span class="vs-l">V</span><span class="vs-r">S</span></div>
    <div class="side-label side-label--me"><span>${esc(settings.name)} 的队伍</span></div>
    <div class="banner-slot"></div>`;
  const field = arena.querySelector('.field') as HTMLElement;
  const vs = arena.querySelector('.vs') as HTMLElement;
  const bannerSlot = arena.querySelector('.banner-slot') as HTMLElement;
  const oppName = arena.querySelector('.opp-name') as HTMLElement;
  const log = document.createElement('div');
  log.className = 'blog';
  log.innerHTML = '<div class="blog-lines"></div><button class="blog-toggle" aria-label="展开战斗日志">展开</button>';
  const logLines = log.querySelector('.blog-lines') as HTMLElement;
  const logToggle = log.querySelector('.blog-toggle') as HTMLElement;
  log.onclick = () => {
    const open = log.classList.toggle('is-open');
    logToggle.textContent = open ? '收起' : '展开';
    if (!open) logLines.scrollTop = 0;
  };
  el.append(top, arena, log);

  const run0 = app.run!;
  updateTopbar(top, run0, false);

  const units = new Map<string, BU>();
  const order: Record<Side, string[]> = { me: [], enemy: [] };
  let skipping = false;
  let destroyed = false;
  let curSpeed = 1;
  let t0 = 0;

  const setSpeed = (n: number): void => {
    curSpeed = n;
    setTimeScale(n);
    speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sp === String(n)));
  };
  const skip = (): void => {
    if (skipping) return;
    skipping = true;
    skipWaits();
    gsap.globalTimeline.getChildren(true, true, false).forEach((t) => {
      if (t.isActive()) t.progress(1);
    });
    particles.clear();
    getFxLayer().innerHTML = '';
  };
  speed.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    if (!b) return;
    sfx.click();
    if (b.dataset.sp === 'skip') skip();
    else setSpeed(Number(b.dataset.sp));
  };
  battleCtl.skip = skip;
  battleCtl.speed = setSpeed;

  field.addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest('.ucard') as HTMLElement | null;
    if (!c) return;
    const u = units.get(c.dataset.uid ?? '');
    if (u) showUnitDetail(data, u.defId, { atk: u.atk, hp: u.hp, level: u.level });
  });

  // ───────────── 布局 ─────────────
  // 两排同宽卡片、各自水平居中；排间距 = 1.5 张卡高；擂台线在两排正中间。
  const ROW_GAP = 1.5;
  interface Geo { w: number; h: number; gap: number; x: (pos: number) => number; y: number; mid: number }
  function metrics(): { W: number; w: number; h: number; gap: number; yEnemy: number; yMe: number; mid: number } {
    const W = field.clientWidth;
    const H = field.clientHeight;
    const n = Math.max(5, order.me.length, order.enemy.length);
    const gap = 6;
    const pad = 8;
    let w = Math.min(84, (W - pad * 2 - gap * (n - 1)) / n);
    // 竖向放不下（矮屏）时按高度收缩：两排 + 1.5 卡高间距 + 上下标签
    const maxH = (H - 96) / (2 + ROW_GAP);
    if ((w * 104) / 84 > maxH) w = (maxH * 84) / 104;
    const h = (w * 104) / 84;
    const mid = Math.round(H * 0.5);
    return { W, w, h, gap, mid, yEnemy: mid - (ROW_GAP / 2) * h - h, yMe: mid + (ROW_GAP / 2) * h };
  }
  function geom(side: Side): Geo {
    const m = metrics();
    const cnt = Math.max(1, order[side].length);
    const x0 = (m.W - (cnt * m.w + (cnt - 1) * m.gap)) / 2;
    return { w: m.w, h: m.h, gap: m.gap, x: (p: number) => x0 + p * (m.w + m.gap), y: side === 'enemy' ? m.yEnemy : m.yMe, mid: m.mid };
  }
  const meLabel = arena.querySelector('.side-label--me') as HTMLElement;
  const enemyLabel = arena.querySelector('.side-label--enemy') as HTMLElement;
  const ringLine = field.querySelector('.ring-line') as HTMLElement;
  /** 标签 / 擂台线 / VS / 横幅 跟随两排位置 */
  function placeChrome(): void {
    const m = metrics();
    const top = field.offsetTop;
    enemyLabel.style.top = `${Math.max(2, top + m.yEnemy - 40)}px`;
    meLabel.style.top = `${top + m.yMe + m.h + 14}px`;
    ringLine.style.top = `${m.mid}px`;
    vs.style.top = `${top + m.mid}px`;
    bannerSlot.style.top = `${top + m.mid}px`;
    bigWordTop = top + m.mid;
  }
  let bigWordTop = 0;
  let lastW = 0;
  function layout(side: Side, dur = 0.25): void {
    const g = geom(side);
    placeChrome();
    // 召唤导致一方超过 5 人时卡片会整体缩小：另一方也要跟着重排，保证两排同尺寸
    if (Math.abs(g.w - lastW) > 0.5) {
      const first = lastW === 0;
      lastW = g.w;
      if (!first) layout(side === 'me' ? 'enemy' : 'me', dur);
    }
    order[side].forEach((uid, i) => {
      const u = units.get(uid);
      if (!u) return;
      u.el.style.width = `${g.w}px`;
      u.el.style.height = `${g.h}px`;
      if (dur > 0 && !skipping) gsap.to(u.el, { x: g.x(i), y: g.y, duration: dur, ease: 'power2.out' });
      else gsap.set(u.el, { x: g.x(i), y: g.y });
    });
  }
  const onResize = (): void => {
    layout('me', 0);
    layout('enemy', 0);
  };
  window.addEventListener('resize', onResize);
  function makeUnit(s: UnitSnap): BU | null {
    const def = data.unitsById[s.defId];
    if (!def) return null;
    const wrap = document.createElement('div');
    wrap.className = `bunit side-${s.side}`;
    const card = unitCard(def, { atk: s.atk, hp: s.hp, level: s.level, shield: s.shield }, { enemy: s.side === 'enemy', uid: s.uid });
    const bubble = document.createElement('div');
    bubble.className = 'say-bubble';
    wrap.append(card, bubble);
    field.appendChild(wrap);
    const u: BU = { uid: s.uid, defId: s.defId, side: s.side, atk: s.atk, hp: s.hp, baseAtk: s.atk, maxHp: s.hp, level: s.level, shield: s.shield, el: wrap, card, alive: true };
    units.set(s.uid, u);
    return u;
  }
  function refresh(u: BU): void {
    setCardStats(u.card, { atk: u.atk, hp: u.hp, level: u.level, shield: u.shield, atkBuffed: u.atk > u.baseAtk, hurt: u.hp < u.maxHp });
  }
  const U = (r: UnitRef): BU | undefined => units.get(r.uid);

  /** 技能/羁绊横幅：居中显示在两排之间的空白处（擂台线上），最多两行 */
  function banner(text: string, color: string, dark: string): void {
    const b = document.createElement('div');
    b.className = 'banner';
    b.style.background = color;
    b.style.boxShadow = `inset 0 -4px 0 ${dark}`;
    b.textContent = plain(text);
    bannerSlot.innerHTML = '';
    bannerSlot.appendChild(b);
    gsap
      .timeline({ onComplete: () => b.remove() })
      .fromTo(b, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: 'back.out(2.5)' })
      .to(b, { y: -10, opacity: 0, duration: 0.18, ease: 'power2.in' }, '+=0.5');
  }
  function addLog(text: string): void {
    const d = document.createElement('div');
    d.textContent = plain(text);
    logLines.prepend(d);
    while (logLines.children.length > 40) logLines.lastElementChild!.remove();
  }
  function say(u: BU, line: string): void {
    const b = u.el.querySelector('.say-bubble') as HTMLElement;
    b.textContent = line;
    // 气泡朝外（敌方向上、我方向下），不挡中间的擂台
    b.classList.toggle('below', u.side === 'me');
    // 气泡不超出战场左右边界
    const W = field.clientWidth;
    const ux = Number(gsap.getProperty(u.el, 'x')) || 0;
    const uw = u.el.offsetWidth;
    const bw = b.offsetWidth;
    const left = Math.max(4, Math.min(W - bw - 4, ux + uw / 2 - bw / 2));
    b.style.left = `${left - ux}px`;
    gsap.killTweensOf(b);
    gsap.timeline().fromTo(b, { scale: 0, opacity: 1 }, { scale: 1, duration: 0.2, ease: 'back.out(2.5)' }).to(b, { opacity: 0, duration: 0.25 }, '+=1.2');
  }
  function flashRing(u: BU, color = '#FFFFFF'): void {
    const r = document.createElement('div');
    r.className = 'flash-ring';
    r.style.borderColor = color;
    u.el.appendChild(r);
    gsap.timeline({ onComplete: () => r.remove() }).fromTo(r, { scale: 1, opacity: 1 }, { scale: 1.25, opacity: 0, duration: 0.3, ease: 'sine.out', repeat: 1 });
  }
  function hitFlash(u: BU): void {
    const f = u.card.querySelector('.uc-flash');
    if (f) gsap.fromTo(f, { opacity: 0.6 }, { opacity: 0, duration: 0.16 });
    // 用旋转抖动，避免和冲撞位移（x/y）互相覆盖
    if (!reducedMotion()) gsap.timeline().to(u.card, { rotation: 5, duration: 0.04 }).to(u.card, { rotation: -5, duration: 0.04 }).to(u.card, { rotation: 3, duration: 0.04 }).to(u.card, { rotation: 0, duration: 0.04 });
  }
  function fl(u: BU, text: string, color: string, dy = -10, size = 24): void {
    const [x, y] = center(u.card);
    floatText(x, y + dy, text, color, size);
  }
  const sgn = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

  // ───────────── 事件处理 ─────────────
  async function play(ev: BattleEvent): Promise<void> {
    if (ev.type !== 'say' && ev.type !== 'attack' && ev.type !== 'damage') addLog(ev.text);
    const fast = skipping;
    switch (ev.type) {
      case 'start': {
        for (const s of ev.me) makeUnit(s);
        for (const s of ev.enemy) makeUnit(s);
        order.me = ev.me.map((s) => s.uid);
        order.enemy = ev.enemy.map((s) => s.uid);
        markSeen([...ev.me, ...ev.enemy].map((s) => s.defId));
        layout('me', 0);
        layout('enemy', 0);
        if (fast) return;
        const H = field.clientHeight;
        order.me.forEach((uid, i) => gsap.from(units.get(uid)!.el, { y: `+=${H * 0.5}`, opacity: 0, duration: 0.35, delay: i * 0.04, ease: 'power3.out' }));
        order.enemy.forEach((uid, i) => gsap.from(units.get(uid)!.el, { y: `-=${H * 0.5}`, opacity: 0, duration: 0.35, delay: i * 0.04, ease: 'power3.out' }));
        sfx.vs();
        const l = vs.querySelector('.vs-l')!;
        const r = vs.querySelector('.vs-r')!;
        gsap.set(vs, { scale: 1.4, opacity: 1 });
        gsap.fromTo(l, { x: -160 }, { x: 0, duration: 0.3, ease: 'back.out(2)', delay: 0.15 });
        gsap.fromTo(r, { x: 160 }, { x: 0, duration: 0.3, ease: 'back.out(2)', delay: 0.15 });
        await wait(0.42);
        const [cx, cy] = center(vs);
        particles.burst(cx, cy, { count: 8, kind: 'dot', colors: ['#FFFFFF'], size: 8, dist: 60, life: 0.4 });
        particles.burst(cx, cy, { count: 4, kind: 'star', colors: ['#FFC53D'], size: 14, dist: 50, life: 0.45 });
        parkVs(0.25);
        await wait(0.25);
        return;
      }
      case 'move': {
        const side = ev.side;
        order[side] = ev.order.filter((uid) => units.get(uid)?.alive);
        layout(side, fast ? 0 : 0.3);
        if (!fast) await wait(0.3);
        return;
      }
      case 'synergy': {
        if (fast) return;
        const who = ev.side === 'me' ? '我方' : '敌方';
        banner(`${who}${FAC_NAME[ev.faction]}羁绊 ×${ev.count}：${ev.text}`, FAC_COLOR[ev.faction], FAC_DARK[ev.faction]);
        for (const uid of order[ev.side]) {
          const u = units.get(uid);
          if (u && data.unitsById[u.defId]?.faction === ev.faction) gsap.fromTo(u.card.querySelector('.uc-fac'), { y: 0 }, { y: -8, duration: 0.12, yoyo: true, repeat: 1 });
        }
        await wait(0.6);
        return;
      }
      case 'ability': {
        const u = U(ev.unit);
        if (fast || !u) return;
        const fac = data.unitsById[u.defId]?.faction ?? 'folk';
        sfx.ability();
        const icon = document.createElement('div');
        icon.className = 'skill-icon';
        icon.innerHTML = `<img src="${ui(`faction_${fac}`)}" alt="">`;
        u.el.appendChild(icon);
        gsap.timeline({ onComplete: () => icon.remove() }).fromTo(icon, { scale: 0, y: 0 }, { scale: 1, y: -8, duration: 0.18, ease: 'back.out(3)' }).to(icon, { opacity: 0, duration: 0.2 }, '+=0.35');
        banner(ev.text, FAC_COLOR[fac], FAC_DARK[fac]);
        for (const t of ev.targets) {
          const tu = U(t);
          if (tu) flashRing(tu);
        }
        await wait(0.45);
        return;
      }
      case 'attack': {
        const a = U(ev.me);
        const b = U(ev.enemy);
        if (fast || !a || !b) return;
        // 双方前排离队，冲到擂台线相撞：我方向上、敌方向下，水平方向在两人中点会合
        const m = metrics();
        const ax = Number(gsap.getProperty(a.el, 'x')) || 0;
        const ay = Number(gsap.getProperty(a.el, 'y')) || 0;
        const bx = Number(gsap.getProperty(b.el, 'x')) || 0;
        const by = Number(gsap.getProperty(b.el, 'y')) || 0;
        const mx = (ax + bx) / 2;
        const aTo = { x: mx - ax, y: m.mid - ay };
        const bTo = { x: mx - bx, y: m.mid - m.h - by };
        gsap.killTweensOf([a.card, b.card], 'x,y,scaleX,scaleY');
        gsap.set(a.card, { transformOrigin: '50% 0%' });
        gsap.set(b.card, { transformOrigin: '50% 100%' });
        gsap.set([a.el, b.el], { zIndex: 5 });
        const tl = gsap.timeline();
        tl.to(a.card, { ...aTo, duration: 0.16, ease: 'power2.in' }, 0)
          .to(b.card, { ...bTo, duration: 0.16, ease: 'power2.in' }, 0)
          .add(() => {
            sfx.hit();
            const fr = field.getBoundingClientRect();
            const px = fr.left + mx + m.w / 2;
            const py = fr.top + m.mid;
            particles.burst(px, py, { count: 8, kind: 'star', colors: ['#FFC53D', '#FFFFFF'], size: 12, dist: 38, life: 0.28 });
            particles.burst(px, py, { count: 5, kind: 'dot', colors: ['#FFFFFF'], size: 7, dist: 26, life: 0.22 });
          }, 0.16)
          .to([a.card, b.card], { scaleX: 1.1, scaleY: 0.86, duration: 0.05, ease: 'power1.out' }, 0.16)
          .to([a.card, b.card], { scaleX: 1, scaleY: 1, duration: 0.08, ease: 'power1.out' }, 0.21)
          .to([a.card, b.card], { x: 0, y: 0, duration: 0.2, ease: 'power2.out' }, 0.3)
          .set([a.el, b.el], { zIndex: 'auto' });
        if (ev.me.hits > 1 || ev.enemy.hits > 1) {
          if (ev.me.hits > 1) fl(a, `×${ev.me.hits}`, '#FF8C42', 40, 20);
          if (ev.enemy.hits > 1) fl(b, `×${ev.enemy.hits}`, '#FF8C42', -40, 20);
        }
        await wait(0.2);
        return;
      }
      case 'damage': {
        const u = U(ev.unit);
        if (!u) return;
        u.hp = ev.hp;
        u.shield = ev.shield;
        if (fast) return;
        refresh(u);
        if (ev.blocked > 0) {
          const [x, y] = center(u.card);
          particles.burst(x, y, { count: 6, kind: 'square', colors: ['#7FD6FF', '#FFFFFF'], size: 8, dist: 40, life: 0.35 });
          fl(u, `-${ev.blocked}`, '#2F80ED', 10, 18);
        }
        if (ev.amount > 0) {
          fl(u, `-${ev.amount}`, '#F25757', -14, 28);
          hitFlash(u);
          if (ev.kind === 'ability') sfx.hit();
        }
        await wait(ev.kind === 'ability' ? 0.2 : 0.08);
        return;
      }
      case 'heal': {
        const u = U(ev.unit);
        if (!u) return;
        u.hp = ev.hp;
        u.maxHp = Math.max(u.maxHp, ev.hp);
        if (fast) return;
        refresh(u);
        fl(u, `+${ev.amount}`, '#58C65C');
        await wait(0.15);
        return;
      }
      case 'buff': {
        const u = U(ev.unit);
        if (!u) return;
        u.atk = ev.newAtk;
        u.hp = ev.newHp;
        if (ev.hp > 0) u.maxHp += ev.hp;
        if (ev.atk < 0) u.baseAtk = Math.min(u.baseAtk, u.atk);
        if (fast) return;
        refresh(u);
        const txt = ev.atk && ev.hp ? `${sgn(ev.atk)}/${sgn(ev.hp)}` : ev.atk ? `${sgn(ev.atk)} 攻` : `${sgn(ev.hp)} 血`;
        fl(u, txt, ev.atk < 0 || ev.hp < 0 ? '#F25757' : ev.atk && !ev.hp ? '#FF8C42' : '#58C65C', -10, 20);
        flashRing(u, '#FFC53D');
        await wait(0.12);
        return;
      }
      case 'shield': {
        const u = U(ev.unit);
        if (!u) return;
        u.shield = ev.total;
        if (fast) return;
        setShield(u.card, u.shield);
        fl(u, `+${ev.amount} 盾`, '#2F80ED', -10, 20);
        flashRing(u, '#7FD6FF');
        await wait(0.12);
        return;
      }
      case 'faint': {
        const u = U(ev.unit);
        if (!u) return;
        u.alive = false;
        order[u.side] = order[u.side].filter((x) => x !== u.uid);
        if (fast) {
          u.el.remove();
          return;
        }
        sfx.faint();
        shatter(u);
        await wait(0.2);
        layout(u.side, 0.2);
        await wait(0.15);
        return;
      }
      case 'summon': {
        const s = ev.unit;
        const u = makeUnit(s);
        if (!u) return;
        const arr = order[s.side].filter((x) => x !== s.uid);
        arr.splice(Math.min(s.pos, arr.length), 0, s.uid);
        order[s.side] = arr;
        markSeen([s.defId]);
        const g = geom(s.side);
        gsap.set(u.el, { x: g.x(Math.min(s.pos, arr.length - 1)), y: g.y });
        layout(s.side, fast ? 0 : 0.25);
        if (fast) return;
        gsap.fromTo(u.card, { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' });
        await wait(0.3);
        return;
      }
      case 'multiAttack': {
        const u = U(ev.unit);
        if (fast || !u) return;
        fl(u, `连击 ×${ev.hits}`, '#FF8C42', -30, 20);
        await wait(0.15);
        return;
      }
      case 'bonus': {
        const u = U(ev.unit);
        if (fast || !u || ev.side !== 'me') return;
        const t = ev.kind === 'gold' ? `下回合 +${ev.amount} 算力` : ev.kind === 'reroll' ? `+${ev.amount} 免费刷新` : `下回合降价 ${ev.amount}`;
        fl(u, t, '#E0A21E', -30, 18);
        await wait(0.15);
        return;
      }
      case 'say': {
        const u = U(ev.unit);
        if (fast || !u) return;
        say(u, ev.line);
        await wait(0.05);
        return;
      }
      case 'end':
        return;
    }
  }

  /** VS 标志开场后缩小，停到擂台线右端 */
  function parkVs(dur: number): void {
    const W = field.clientWidth;
    const props = { scale: 0.45, x: W / 2 - 30, opacity: 1 };
    if (dur > 0) gsap.to(vs, { ...props, duration: dur, delay: 0.1, ease: 'power2.inOut' });
    else gsap.set(vs, props);
  }

  function shatter(u: BU): void {
    const card = u.card;
    card.classList.add('is-dead');
    const r = card.getBoundingClientRect();
    const [lx, ly] = toShell(r.left, r.top);
    const clips = ['inset(0 50% 50% 0)', 'inset(0 0 50% 50%)', 'inset(50% 50% 0 0)', 'inset(50% 0 0 50%)'];
    const dirs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    const layer = getFxLayer();
    gsap.to(card, { scale: 0.95, duration: 0.1 });
    gsap.delayedCall(0.1, () => {
      clips.forEach((c, i) => {
        const p = card.cloneNode(true) as HTMLElement;
        p.classList.add('shard');
        Object.assign(p.style, { left: `${lx}px`, top: `${ly}px`, width: `${r.width}px`, height: `${r.height}px`, clipPath: c });
        layer.appendChild(p);
        const d = 20 + Math.random() * 20;
        gsap.to(p, {
          x: dirs[i][0] * d,
          y: dirs[i][1] * d + 30,
          rotate: (Math.random() - 0.5) * 60,
          opacity: 0,
          duration: 0.4,
          ease: 'power1.in',
          onComplete: () => p.remove(),
        });
      });
      u.el.style.visibility = 'hidden';
      gsap.delayedCall(1.5, () => u.el.remove());
    });
  }

  // ───────────── 结束演出 ─────────────
  async function endShow(result: BattleResult, before: RunState, after: RunState): Promise<void> {
    gsap.to(vs, { opacity: 0, scale: 0.3, duration: 0.2 });
    const big = document.createElement('div');
    big.className = `big-word big-word--${result.winner}`;
    big.textContent = result.winner === 'me' ? '胜利！' : result.winner === 'enemy' ? '失败' : '平局';
    big.style.top = `${bigWordTop - 28}px`;
    arena.appendChild(big);
    gsap.fromTo(big, { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' });
    if (result.winner === 'me') {
      sfx.win();
      const shell = arena.getBoundingClientRect();
      fullscreen(() => {
        particles.confetti(shell.left + 10, shell.bottom - 10, reducedMotion() ? 4 : 18, -Math.PI / 2 + 0.45, 0.6, 800);
        particles.confetti(shell.right - 10, shell.bottom - 10, reducedMotion() ? 4 : 18, -Math.PI / 2 - 0.45, 0.6, 800);
        return gsap.delayedCall(1.2, () => {});
      });
      await wait(0.4);
      const fire = document.createElement('img');
      fire.src = ui('fire');
      fire.className = 'fly-icon';
      const [cx, cy] = center(big);
      const target = top.querySelector('[data-hud=trophies]') as HTMLElement;
      const [tx, ty] = center(target);
      const [lx, ly] = toShell(cx, cy);
      const [ltx, lty] = toShell(tx, ty);
      Object.assign(fire.style, { left: `${lx - 24}px`, top: `${ly - 24}px` });
      getFxLayer().appendChild(fire);
      await new Promise<void>((res) =>
        gsap
          .timeline({ onComplete: res })
          .to(fire, { x: ltx - lx, duration: 0.5, ease: 'power2.inOut' }, 0)
          .to(fire, { y: lty - ly, duration: 0.5, ease: 'power2.in' }, 0)
          .to(fire, { scale: 0.5, duration: 0.5 }, 0),
      );
      fire.remove();
      updateTopbar(top, after, false);
      gsap.fromTo(target, { scale: 1.4 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
      await wait(0.3);
    } else if (result.winner === 'enemy') {
      sfx.lose();
      const lost = before.lives - after.lives;
      const heart = top.querySelector('[data-hud=lives]') as HTMLElement;
      for (let i = 0; i < lost; i++) {
        heartBreak(heart, i * 0.15);
      }
      edgeFlash();
      await wait(0.35);
      updateTopbar(top, after, false);
      await wait(0.45);
    } else {
      await wait(0.9);
    }
  }
  function heartBreak(anchor: HTMLElement, delay: number): void {
    const r = anchor.querySelector('img')!.getBoundingClientRect();
    const [lx, ly] = toShell(r.left, r.top);
    const layer = getFxLayer();
    ['inset(0 50% 0 0)', 'inset(0 0 0 50%)'].forEach((clip, i) => {
      const h = document.createElement('img');
      h.src = ui('lives');
      h.className = 'heart-half';
      Object.assign(h.style, { left: `${lx}px`, top: `${ly}px`, width: `${r.width}px`, height: `${r.height}px`, clipPath: clip });
      layer.appendChild(h);
      gsap
        .timeline({ delay, onComplete: () => h.remove() })
        .to(h, { scale: 1.3, duration: 0.2, ease: 'back.out' })
        .to(h, { x: i ? 14 : -14, y: 40, rotate: i ? 25 : -25, opacity: 0, duration: 0.3, ease: 'power2.in' });
    });
  }

  // ───────────── 主流程 ─────────────
  async function main(): Promise<void> {
    await new Promise((r) => requestAnimationFrame(r));
    if (destroyed) return;
    const s = app.run!;
    const tutorial = !!s.tutorial;
    let enemy: UnitInst[] | null = tutorial ? tutorialEnemy(s, data) : null;
    let opp = { name: BOT_NAMES[(s.turn + s.seed.length) % BOT_NAMES.length], real: false };
    if (!enemy && !tutorial) {
      const team = s.team.filter(Boolean) as UnitInst[];
      const room = settings.room || undefined;
      if (team.length) void api.snapshot({ name: settings.name, room, turn: s.turn, trophies: s.trophies, team, seed: s.seed.slice(0, 64) });
      const res = await api.opponent({ turn: s.turn, trophies: s.trophies, room, name: settings.name, seed: s.seed.slice(0, 64) });
      if (destroyed) return;
      if (res?.team?.length) {
        enemy = res.team;
        opp = { name: res.name || '神秘玩家', real: true };
      }
    }
    if (!enemy) enemy = offlineOpponent(s, data);
    app.opponent = opp;
    oppName.innerHTML = `回合 ${s.turn} · ${opp.real ? `<b>${esc(opp.name)}</b> 的队伍` : `对手：${esc(opp.name)}`}`;
    const result = battleForState(s, enemy, data);
    battleCtl.playing = true;
    t0 = performance.now();
    for (const ev of result.events) {
      if (destroyed) return;
      if (!skipping && curSpeed === 1 && performance.now() - t0 > 20000) setSpeed(2);
      await play(ev);
    }
    if (skipping) {
      // 跳过：直接按模型重排
      for (const u of units.values()) {
        if (!u.alive) u.el.remove();
        else refresh(u);
      }
      layout('me', 0);
      layout('enemy', 0);
      parkVs(0);
      skipping = false;
    }
    setSpeed(1);
    battleCtl.playing = false;
    let after = applyBattleResult(s, result, data);
    const last = after.history.length - 1;
    if (last >= 0) after = { ...after, history: after.history.map((h, i) => (i === last ? { ...h, opponent: opp.real ? opp.name : 'bot' } : h)) };
    await endShow(result, s, after);
    if (destroyed) return;
    setRun(after);
    showResult(el, { result, before: s, after, opp });
  }

  void main();

  return {
    el,
    destroy: () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      skipWaits();
      setTimeScale(1);
      particles.clear();
      battleCtl.playing = false;
      battleCtl.skip = () => {};
    },
  };
}
