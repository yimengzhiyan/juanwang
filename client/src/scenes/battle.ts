// 战斗页：按 BattleEvent 顺序播放（1x / 2x / 跳过）。敌方一排居中在上、我方一排居中在下（都是前排在左）。
// 2.0 交替开火（ART 9.5）：行动单位前冲 0.12s → 命中火花 + 伤害数字 → 0.15s 回位，下一次行动在 0.35s 开始。
// 护盾蓝环 + 碎盾碎片、反弹橙色回弹数字、偷取/爆炸/复活/连杀专属小动画、装备格闪光；技能慢放 0.6s + 中央大字技能名。
import gsap from 'gsap';
import {
  applyBattleResult, battleForState, computeSynergies, dominantSynergy, injectHumanOpponents, pveForTurn,
  type BattleEvent, type BattleResult, type EquipSlot, type Level, type RunState, type Side, type UnitEquips, type UnitInst, type UnitRef, type UnitSnap,
} from '@juanwang/shared';
import { arenaHudChip } from '../ui/arenaChip';
import { app, markSeen, setRun, settings, type Scene } from '../store';
import { setHpChip, topbar, updateTopbar } from '../ui/team';
import { esc, plain, setCardStats, setShield, skillName, skillShort, SYN_COLOR, SYN_DARK, synIconHtml, tierShield, unitCard } from '../ui/cards';
import { showUnitDetail } from '../ui/modal';
import { lobbyView, updateDock } from '../ui/lobby';
import { pveStrip } from '../ui/pve';
import { center, edgeFlash, floatText, fullscreen, getFxLayer, reducedMotion, screenShake, setTimeScale, skipWaits, toShell, wait } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';
import { api, isOnline } from '../net';
import { artUrl, avatarUrl, fxArt, isPhotoAvatar, ui } from '../assets';
import { showResult, type UnitInfo } from './result';

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
  equips: UnitEquips;
  el: HTMLElement; // 定位容器
  card: HTMLElement;
  alive: boolean;
  gone?: gsap.core.Tween;
}

/** 演出上更"大"的技能效果：触发时慢放 + 大字 */
const DRAMATIC = new Set(['steal', 'explode', 'doubleStats', 'revive', 'chain', 'destroy', 'copyStats', 'multiAttack']);
/** 一场最多几次大字慢放（避免拖节奏） */
const MAX_BIG = 6;

/** 调试/自动化：当前战斗的控制 */
export const battleCtl = { skip: (): void => {}, speed: (_n: number): void => {}, playing: false, bigShown: 0 };

export function battleScene(): Scene {
  const data = app.data;
  const run0 = app.run!;
  const el = document.createElement('div');
  const top = topbar();
  top.classList.add('topbar--battle');
  const speed = document.createElement('div');
  speed.className = 'speed';
  speed.innerHTML = `<button data-sp="1" class="on">1x</button><button data-sp="2">2x</button><button data-sp="skip">跳过</button>`;
  top.insertBefore(speed, top.querySelector('.hud-mute'));
  const lobby = lobbyView(data, 'strip');
  const pv = run0.matchup?.kind === 'pve' ? pveForTurn(run0.turn, data) : undefined;
  const arena = document.createElement('div');
  arena.className = 'arena';
  arena.innerHTML = `
    <div class="side-label side-label--enemy"><span class="opp-name">匹配对手中…</span></div>
    <div class="side-syn side-syn--enemy"></div>
    <div class="side-syn side-syn--me"></div>
    <div class="field"><div class="ring-line"></div></div>
    <div class="vs"><span class="vs-l">V</span><span class="vs-r">S</span></div>
    <div class="side-label side-label--me"><span>${esc(settings.name)} 的队伍</span></div>
    <div class="banner-slot"></div>
    <div class="big-skill-slot"></div>`;
  const field = arena.querySelector('.field') as HTMLElement;
  const vs = arena.querySelector('.vs') as HTMLElement;
  const bannerSlot = arena.querySelector('.banner-slot') as HTMLElement;
  const bigSlot = arena.querySelector('.big-skill-slot') as HTMLElement;
  const oppName = arena.querySelector('.opp-name') as HTMLElement;
  const arChip = arenaHudChip(data, run0);
  if (arChip) oppName.after(arChip);
  const log = document.createElement('div');
  log.className = 'blog';
  log.innerHTML = '<div class="blog-head">战斗日志</div><div class="blog-lines"></div>';
  const logLines = log.querySelector('.blog-lines') as HTMLElement;
  el.append(top);
  if (pv) el.append(pveStrip(pv));
  el.append(lobby.el, arena, log);
  if (run0.tutorial) lobby.el.style.display = 'none';
  else {
    lobby.update(run0);
    updateDock(run0);
  }
  updateTopbar(top, run0, false);

  const units = new Map<string, BU>();
  const order: Record<Side, string[]> = { me: [], enemy: [] };
  let skipping = false;
  let destroyed = false;
  let curSpeed = 1;
  let t0 = 0;
  /** 上一次攻击的回位动画（下一次行动前等它结束） */
  let pendingReturn: Promise<void> | null = null;
  let lastAction = -1;
  const streak = new Map<string, number>();
  const seenAbility = new Set<string>();
  const seenProc = new Set<string>();
  let bigCount = 0;
  let bigQueue: Promise<void> = Promise.resolve();
  battleCtl.bigShown = 0;

  const setSpeed = (n: number): void => {
    curSpeed = n;
    setTimeScale(n);
    speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sp === String(n)));
  };
  const skip = (): void => {
    if (skipping) return;
    skipping = true;
    setTimeScale(curSpeed);
    skipWaits();
    gsap.globalTimeline.getChildren(true, true, false).forEach((t) => {
      if (t.isActive()) t.progress(1);
    });
    particles.clear();
    getFxLayer().innerHTML = '';
    bigSlot.innerHTML = '';
    arena.classList.remove('is-big');
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
    if (u) showUnitDetail(data, u.defId, { atk: u.atk, hp: u.hp, level: u.level, equips: u.equips, shield: u.shield });
  });

  // ───────────── 布局 ─────────────
  // 自上而下：敌方名牌 + 羁绊（HEAD）→ 敌方一排 → 中间带（大字技能/横幅/VS，MID）→ 我方一排 → 我方名牌 + 羁绊（FOOT）；
  // 擂台高度由 JS 算好，下方剩余空间全部给常显战斗日志。
  const HEAD = 66;
  const FOOT = 72;
  const MID_MIN = 100;
  const MID_MAX = 124;
  const LOG_MIN = 80;
  const LOG_MAX = 300;
  interface Geo { w: number; h: number; gap: number; x: (pos: number) => number; y: number; mid: number }
  let geo = { W: 0, w: 0, h: 0, gap: 6, yEnemy: 0, yMe: 0, mid: 0, n: 0 };
  function sizeArena(): void {
    const W = arena.clientWidth;
    const n = Math.max(5, order.me.length, order.enemy.length);
    const gap = n > 5 ? 4 : 6;
    const pad = 8;
    const avail = el.clientHeight - arena.offsetTop - 8;
    let w = Math.min(W > 440 ? 80 : 72, (W - pad * 2 - gap * (n - 1)) / n);
    w = Math.max(34, Math.min(w, (avail - LOG_MIN - HEAD - FOOT - MID_MIN) / 3));
    const h = w * 1.5;
    const cmin = HEAD + FOOT + MID_MIN + 2 * h;
    const logH = Math.max(LOG_MIN, Math.min(LOG_MAX, avail - cmin));
    const mid = MID_MIN + Math.max(0, Math.min(MID_MAX - MID_MIN, avail - logH - cmin));
    arena.style.height = `${Math.round(HEAD + FOOT + mid + 2 * h)}px`;
    geo = { W, w, h, gap, n, yEnemy: HEAD, yMe: HEAD + h + mid, mid: Math.round(HEAD + h + mid / 2) };
  }
  function metrics(): typeof geo {
    const n = Math.max(5, order.me.length, order.enemy.length);
    if (!geo.W || n !== geo.n || arena.clientWidth !== geo.W) sizeArena();
    return geo;
  }
  function geom(side: Side): Geo {
    const m = metrics();
    const cnt = Math.max(1, order[side].length);
    const x0 = (m.W - (cnt * m.w + (cnt - 1) * m.gap)) / 2;
    return { w: m.w, h: m.h, gap: m.gap, x: (p: number) => x0 + p * (m.w + m.gap), y: side === 'enemy' ? m.yEnemy : m.yMe, mid: m.mid };
  }
  const meLabel = arena.querySelector('.side-label--me') as HTMLElement;
  const enemyLabel = arena.querySelector('.side-label--enemy') as HTMLElement;
  const meSyn = arena.querySelector('.side-syn--me') as HTMLElement;
  const enemySyn = arena.querySelector('.side-syn--enemy') as HTMLElement;
  const ringLine = field.querySelector('.ring-line') as HTMLElement;
  let bigWordTop = 0;
  function placeChrome(): void {
    const m = metrics();
    enemyLabel.style.top = '4px';
    enemySyn.style.top = '36px';
    meLabel.style.top = `${m.yMe + m.h + 14}px`;
    meSyn.style.top = `${m.yMe + m.h + 46}px`;
    ringLine.style.top = `${m.mid}px`;
    vs.style.top = `${m.mid}px`;
    bannerSlot.style.top = `${m.mid}px`;
    bigSlot.style.top = `${m.mid}px`;
    bigWordTop = m.mid;
  }
  /** 羁绊点亮时在该方名牌下加一枚小徽章 */
  function addSideSyn(side: Side, key: string, name: string, count: number, tier: number): void {
    const row = side === 'me' ? meSyn : enemySyn;
    row.querySelector(`[data-key="${key}"]`)?.remove();
    const c = document.createElement('span');
    c.className = 'ss-chip';
    c.dataset.key = key;
    c.style.setProperty('--sc', SYN_COLOR[key] ?? '#9B6BFF');
    c.innerHTML = `${synIconHtml(key)}${esc(name)}×${count}${tierShield(tier)}`;
    row.appendChild(c);
    if (!skipping) gsap.fromTo(c, { scale: 0 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' });
  }
  let lastW = 0;
  function layout(side: Side, dur = 0.25): void {
    const g = geom(side);
    placeChrome();
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
    geo.W = 0;
    layout('me', 0);
    layout('enemy', 0);
  };
  window.addEventListener('resize', onResize);
  function makeUnit(s: UnitSnap): BU | null {
    const def = data.unitsById[s.defId];
    if (!def) return null;
    const wrap = document.createElement('div');
    wrap.className = `bunit side-${s.side}`;
    const card = unitCard(def, { atk: s.atk, hp: s.hp, level: s.level, shield: s.shield, equips: s.equips }, { enemy: s.side === 'enemy', uid: s.uid });
    const bubble = document.createElement('div');
    bubble.className = 'say-bubble';
    const mark = document.createElement('i');
    mark.className = 'act-mark';
    wrap.append(card, bubble, mark);
    field.appendChild(wrap);
    const u: BU = { uid: s.uid, defId: s.defId, side: s.side, atk: s.atk, hp: s.hp, baseAtk: s.atk, maxHp: s.hp, level: s.level, shield: s.shield, equips: s.equips ?? {}, el: wrap, card, alive: true };
    units.set(s.uid, u);
    return u;
  }
  function refresh(u: BU): void {
    setCardStats(u.card, { atk: u.atk, hp: u.hp, level: u.level, shield: u.shield, atkBuffed: u.atk > u.baseAtk, hurt: u.hp < u.maxHp });
  }
  const U = (r: UnitRef): BU | undefined => units.get(r.uid);
  const posOf = (u: BU): [number, number] => [Number(gsap.getProperty(u.el, 'x')) || 0, Number(gsap.getProperty(u.el, 'y')) || 0];

  // ───────────── 小部件 ─────────────
  /** 技能/羁绊横幅：擂台线上居中，最多两行；tier>0 时按档位描边（铜/银/金） */
  function banner(text: string, color: string, dark: string, tier = 0, hold = 0.5): void {
    const b = document.createElement('div');
    b.className = `banner${tier ? ` banner--t${Math.min(3, tier)}` : ''}`;
    b.style.background = color;
    b.style.setProperty('--dark', dark);
    b.innerHTML = `${tier ? `<img src="${ui(`tier_${Math.min(3, tier)}`)}" alt="">` : ''}<span>${esc(plain(text))}</span>`;
    bannerSlot.innerHTML = '';
    bannerSlot.appendChild(b);
    gsap
      .timeline({ onComplete: () => b.remove() })
      .fromTo(b, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: 'back.out(2.5)' })
      .to(b, { y: -10, opacity: 0, duration: 0.18, ease: 'power2.in' }, `+=${hold}`);
  }
  function addLog(text: string, ev?: BattleEvent): void {
    const d = document.createElement('div');
    if (ev) d.innerHTML = logHtml(ev);
    else d.textContent = plain(text);
    logLines.prepend(d);
    while (logLines.children.length > 40) logLines.lastElementChild!.remove();
  }
  /** 日志行：敌方单位名字前加"敌方·"并标红（同名单位互杀时也分得清） */
  function logHtml(ev: BattleEvent): string {
    const text = plain(ev.text);
    const e = ev as { unit?: UnitRef; killer?: UnitRef; source?: UnitRef; target?: UnitRef; side?: Side };
    if (ev.type === 'synergyTier') return ev.side === 'enemy' ? `<span class="lg-en">敌方</span> ${esc(text)}` : esc(text);
    const refs = [e.unit, e.killer ?? e.source ?? e.target].filter((r): r is UnitRef => !!r && !!r.defId && !!r.side);
    let out = '';
    let pos = 0;
    for (const r of refs) {
      const name = data.unitsById[r.defId]?.name;
      if (!name) continue;
      const i = text.indexOf(name, pos);
      if (i < 0) continue;
      out += esc(text.slice(pos, i));
      out += r.side === 'enemy' ? `<span class="lg-en">敌方·${esc(name)}</span>` : `<span class="lg-me">${esc(name)}</span>`;
      pos = i + name.length;
    }
    return out + esc(text.slice(pos));
  }
  function say(u: BU, line: string): void {
    const b = u.el.querySelector('.say-bubble') as HTMLElement;
    b.textContent = line;
    b.classList.toggle('below', u.side === 'enemy');
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
    if (!reducedMotion()) gsap.timeline().to(u.card, { rotation: 5, duration: 0.04 }).to(u.card, { rotation: -5, duration: 0.04 }).to(u.card, { rotation: 3, duration: 0.04 }).to(u.card, { rotation: 0, duration: 0.04 });
  }
  function fl(u: BU, text: string, color: string, dy = -10, size = 28): void {
    const [x, y] = center(u.card);
    floatText(x, y + dy, text, color, size);
  }
  const sgn = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

  /** 单色特效剪影（fx/*.svg 用 mask 染色，背后一层深棕描边） */
  function fxSil(name: string, color: string, cx: number, cy: number, size: number): HTMLElement {
    const [lx, ly] = toShell(cx, cy);
    const w = document.createElement('div');
    w.className = 'fx-sil';
    Object.assign(w.style, { left: `${lx - size / 2}px`, top: `${ly - size / 2}px`, width: `${size}px`, height: `${size}px` });
    const url = `url(${fxArt(name)})`;
    w.innerHTML = `<i class="fx-sil-o"></i><i class="fx-sil-c"></i>`;
    w.querySelectorAll('i').forEach((i) => {
      (i as HTMLElement).style.maskImage = url;
      (i as HTMLElement).style.webkitMaskImage = url;
    });
    (w.querySelector('.fx-sil-c') as HTMLElement).style.background = color;
    getFxLayer().appendChild(w);
    return w;
  }

  /** 中央大字技能名 + 施法头像，慢放 0.6s（同一时刻只放一个，排队） */
  function bigSkill(u: BU | undefined, defId: string, name: string, color: string): Promise<void> {
    const job = bigQueue.then(async () => {
      if (skipping || destroyed) return;
      bigCount++;
      battleCtl.bigShown++;
      const def = data.unitsById[defId];
      const b = document.createElement('div');
      b.className = 'big-skill';
      b.style.setProperty('--sc', color);
      b.innerHTML = `${def ? `<span class="bs-ava"><img class="${isPhotoAvatar(def) ? 'is-photo' : ''}" src="${avatarUrl(def)}" alt=""></span>` : ''}<span class="bs-text"><b>${esc(name)}</b>${def ? `<small>${esc(def.name)}<em>${esc(skillShort(def))}</em></small>` : ''}</span>`;
      bigSlot.innerHTML = '';
      bigSlot.appendChild(b);
      sfx.bigSkill();
      if (u) flashRing(u, color);
      arena.classList.add('is-big');
      gsap
        .timeline({ onComplete: () => { b.remove(); if (!bigSlot.children.length) arena.classList.remove('is-big'); } })
        .fromTo(b, { scale: 0, opacity: 1 }, { scale: 1, duration: 0.22, ease: 'back.out(2)' })
        .to(b, { y: -24, opacity: 0, duration: 0.25, ease: 'power1.in' }, '+=0.5');
      setTimeScale(curSpeed * 0.5);
      await wait(0.3);
      if (!skipping) setTimeScale(curSpeed);
    });
    bigQueue = job;
    return job;
  }

  function streakTag(u: BU, n: number): void {
    const [x, y] = center(u.card);
    const r = u.card.getBoundingClientRect();
    const [lx, ly] = toShell(x, y - r.height / 2 - 8);
    const t = document.createElement('div');
    t.className = 'streak-tag';
    t.textContent = `连杀 ×${n}`;
    Object.assign(t.style, { left: `${lx}px`, top: `${ly}px` });
    getFxLayer().appendChild(t);
    gsap
      .timeline({ onComplete: () => t.remove() })
      .fromTo(t, { scale: 0, xPercent: -50, yPercent: -50 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' })
      .to(t, { y: -20, opacity: 0, duration: 0.3 }, '+=0.5');
  }

  // ───────────── 事件处理 ─────────────
  async function play(ev: BattleEvent): Promise<void> {
    if (ev.type !== 'say' && ev.type !== 'attack' && ev.type !== 'damage' && ev.type !== 'equipProc') addLog(ev.text, ev);
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
        order[ev.side] = ev.order.filter((uid) => units.get(uid)?.alive);
        layout(ev.side, fast ? 0 : 0.3);
        if (!fast) await wait(0.3);
        return;
      }
      case 'arena': {
        if (fast) return;
        banner(`赛场「${ev.name}」：${ev.text}`, '#9B6BFF', '#7A4FE0');
        await wait(0.35);
        return;
      }
      case 'synergyTier': {
        if (ev.line) {
          const lu = U(ev.line.unit);
          if (lu && !fast) say(lu, ev.line.line);
        }
        addSideSyn(ev.side, ev.key, ev.name, ev.count, ev.tier);
        if (fast) return;
        const who = ev.side === 'me' ? '' : '敌方 ';
        banner(`${who}${ev.text}`, SYN_COLOR[ev.key] ?? '#9B6BFF', SYN_DARK[ev.key] ?? '#7A4FE0', ev.tier, ev.side === 'me' ? 0.35 : 0.2);
        for (const uid of order[ev.side]) {
          const u = units.get(uid);
          const d = u ? data.unitsById[u.defId] : undefined;
          if (!u || !d || (d.faction !== ev.key && d.role !== ev.key)) continue;
          const ico = u.card.querySelector(ev.kind === 'faction' ? '.uc-fac' : '.uc-role');
          if (ico) gsap.fromTo(ico, { y: 0 }, { y: -8, duration: 0.12, yoyo: true, repeat: 1 });
        }
        await wait(ev.side === 'me' ? 0.42 : 0.26);
        return;
      }
      case 'ability': {
        const u = U(ev.unit);
        if (fast) return;
        const def = data.unitsById[ev.unit.defId];
        const key = def?.faction ?? 'folk';
        if (ev.repeat > 1 && u) fl(u, `技能 ×${ev.repeat}`, '#9B6BFF', -34, 18);
        // 大字慢放：戏剧化效果，或我方（非召唤物）单位本场第一次放技能
        const first = !seenAbility.has(ev.unit.defId);
        seenAbility.add(ev.unit.defId);
        const showBig = DRAMATIC.has(ev.effect) || (first && ev.trigger !== 'synergy' && ev.unit.side === 'me' && !def?.token);
        if (ev.repeat === 1 && bigCount < MAX_BIG && showBig) {
          for (const t of ev.targets) {
            const tu = U(t);
            if (tu) flashRing(tu);
          }
          await bigSkill(u, ev.unit.defId, skillName(def, ev.effect), SYN_COLOR[key]);
          return;
        }
        sfx.ability();
        if (u) {
          const icon = document.createElement('div');
          icon.className = 'skill-icon';
          icon.innerHTML = `${synIconHtml(key)}`;
          u.el.appendChild(icon);
          gsap.timeline({ onComplete: () => icon.remove() }).fromTo(icon, { scale: 0, y: 0 }, { scale: 1, y: -8, duration: 0.18, ease: 'back.out(3)' }).to(icon, { opacity: 0, duration: 0.2 }, '+=0.3');
        }
        banner(ev.text, SYN_COLOR[key], SYN_DARK[key], 0, 0.3);
        for (const t of ev.targets) {
          const tu = U(t);
          if (tu) flashRing(tu);
        }
        await wait(0.09);
        return;
      }
      case 'attack': {
        const a = U(ev.unit);
        const b = U(ev.target);
        if (ev.action !== lastAction) {
          lastAction = ev.action;
          streak.clear();
        }
        if (fast || !a || !b) return;
        if (pendingReturn) await pendingReturn;
        const [ax, ay] = posOf(a);
        const [bx, by] = posOf(b);
        const k = 0.62;
        const to = { x: (bx - ax) * k, y: (by - ay) * k };
        gsap.killTweensOf(a.card, 'x,y,scaleX,scaleY');
        gsap.set(a.el, { zIndex: 6 });
        a.el.classList.add('is-acting');
        if (ev.hits > 1 && ev.hit === 1) fl(a, `×${ev.hits}`, '#FF8C42', 40, 20);
        await new Promise<void>((res) => gsap.to(a.card, { ...to, scaleX: 0.9, scaleY: 1.12, duration: 0.12, ease: 'power2.in', onComplete: res }));
        if (destroyed) return;
        sfx.hit();
        const fr = field.getBoundingClientRect();
        const m = metrics();
        const px = fr.left + bx + m.w / 2 - (bx - ax) * 0.18;
        const py = fr.top + by + m.h / 2 - (by - ay) * 0.3;
        particles.burst(px, py, { count: 6, kind: 'star', colors: ['#FFC53D', '#FFFFFF'], size: 12, dist: 36, life: 0.26 });
        pendingReturn = new Promise<void>((res) =>
          gsap.timeline({ onComplete: () => { a.el.classList.remove('is-acting'); gsap.set(a.el, { zIndex: 'auto' }); res(); } })
            .to(a.card, { scaleX: 1.08, scaleY: 0.92, duration: 0.05 })
            .to(a.card, { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: 0.15, ease: 'power2.out' }, 0.08),
        );
        return;
      }
      case 'damage': {
        const u = U(ev.unit);
        if (!u) return;
        u.hp = ev.hp;
        u.shield = ev.shield;
        if (fast) return;
        refresh(u);
        if (ev.immune) {
          fl(u, '免疫', '#7FD6FF', -14, 20);
          flashRing(u, '#7FD6FF');
        }
        if (ev.blocked > 0) {
          sfx.block();
          flashRing(u, '#7FD6FF');
          if (!ev.shieldBroken) fl(u, `盾 -${ev.blocked}`, '#2F80ED', 12, 16);
        }
        if (ev.shieldBroken) shieldShatter(u);
        if (ev.amount > 0) {
          if (ev.kind === 'reflect') {
            const src = ev.source ? U(ev.source) : undefined;
            sfx.reflect();
            if (src) flyNumber(src, u, `-${ev.amount}`, '#FF8C42');
            else fl(u, `-${ev.amount}`, '#FF8C42', -14, 34);
            hitFlash(u);
            await wait(0.18);
            return;
          }
          const size = ev.kind === 'splash' ? 28 : ev.kind === 'explode' ? 32 : 40;
          fl(u, `-${ev.amount}`, '#F25757', -14, size);
          hitFlash(u);
          if (ev.kind === 'ability') sfx.hit();
        }
        await wait(ev.kind === 'ability' ? 0.12 : ev.kind === 'attack' ? 0.04 : 0);
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
        await wait(0.04);
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
        if (ev.permanent && ev.atk >= 0 && ev.hp >= 0) {
          // 战斗内永久成长（羁绊 4 档 / 技能）：金色「永久 +1」浮字，赛后写回队伍
          fl(u, `永久 ${txt}`, '#FFC53D', -14, 22);
          flashRing(u, '#FFC53D');
          await wait(0.04);
          return;
        }
        fl(u, txt, ev.atk < 0 || ev.hp < 0 ? '#F25757' : ev.atk && !ev.hp ? '#FF8C42' : '#58C65C', -10, 20);
        flashRing(u, '#FFC53D');
        await wait(0.02);
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
        await wait(0.03);
        return;
      }
      case 'faint': {
        const u = U(ev.unit);
        if (!u) return;
        u.alive = false;
        order[u.side] = order[u.side].filter((x) => x !== u.uid);
        if (ev.killer) {
          const n = (streak.get(ev.killer.uid) ?? 0) + 1;
          streak.set(ev.killer.uid, n);
          const ku = U(ev.killer);
          if (n >= 2 && ku && !fast) streakTag(ku, n);
        }
        if (fast) {
          u.el.style.visibility = 'hidden';
          return;
        }
        if (ev.benched) {
          fl(u, '下场', '#97A6B8', -10, 20);
          gsap.to(u.el, { opacity: 0, y: '-=20', duration: 0.25, onComplete: () => { if (!u.alive) u.el.style.visibility = 'hidden'; gsap.set(u.el, { opacity: 1 }); } });
        } else {
          sfx.faint();
          shatter(u);
        }
        await wait(0.1);
        layout(u.side, 0.2);
        await wait(0.05);
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
        gsap.fromTo(u.card, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2.5)' });
        await wait(0.08);
        return;
      }
      case 'multiAttack': {
        const u = U(ev.unit);
        if (fast || !u) return;
        fl(u, `连击 ×${ev.hits}`, '#FF8C42', -30, 20);
        await wait(0.08);
        return;
      }
      case 'bonus': {
        const u = U(ev.unit);
        if (fast || !u || ev.side !== 'me') return;
        const t = ev.kind === 'gold' ? `下回合 +${ev.amount} 算力` : ev.kind === 'reroll' ? `+${ev.amount} 免费刷新` : `下回合降价 ${ev.amount}`;
        fl(u, t, '#E0A21E', -30, 18);
        await wait(0.1);
        return;
      }
      case 'say': {
        const u = U(ev.unit);
        if (fast || !u || !u.alive) return;
        say(u, ev.line);
        return;
      }
      case 'steal': {
        const u = U(ev.unit);
        if (!u) return;
        order[ev.unit.side] = order[ev.unit.side].filter((x) => x !== u.uid);
        u.side = ev.to.side;
        const arr = order[u.side].filter((x) => x !== u.uid);
        arr.splice(Math.min(ev.to.pos, arr.length), 0, u.uid);
        order[u.side] = arr;
        u.card.classList.toggle('is-enemy', u.side === 'enemy');
        u.el.classList.toggle('side-me', u.side === 'me');
        u.el.classList.toggle('side-enemy', u.side === 'enemy');
        if (fast) {
          layout('me', 0);
          layout('enemy', 0);
          return;
        }
        sfx.steal();
        const src = U(ev.source);
        const [tx, ty] = center(u.card);
        const [sx, sy] = src ? center(src.card) : [tx, ty + 120];
        const hand = fxSil('steal_hand', '#9B6BFF', sx, sy, 64);
        gsap.timeline({ onComplete: () => hand.remove() })
          .fromTo(hand, { scale: 0.4, rotate: sy > ty ? 0 : 180 }, { x: tx - sx, y: ty - sy, scale: 1, duration: 0.2, ease: 'power2.out' })
          .to(hand, { x: 0, y: 0, opacity: 0, duration: 0.3, ease: 'power2.in' });
        await wait(0.18);
        const g = geom(u.side);
        const idx = order[u.side].indexOf(u.uid);
        const [, uy] = posOf(u);
        const nx = g.x(idx);
        gsap.set(u.el, { zIndex: 7 });
        gsap.timeline({ onComplete: () => { gsap.set(u.el, { zIndex: 'auto' }); } })
          .to(u.el, { x: nx, duration: 0.4, ease: 'power2.inOut' }, 0)
          .to(u.el, { y: Math.min(uy, g.y) - 60, duration: 0.2, ease: 'power2.out' }, 0)
          .to(u.el, { y: g.y, duration: 0.2, ease: 'power2.in' }, 0.2);
        layout(ev.unit.side, 0.3);
        await wait(0.42);
        layout(u.side, 0.2);
        return;
      }
      case 'explode': {
        const u = U(ev.unit);
        if (fast) return;
        sfx.explode();
        if (u) {
          const [x, y] = center(u.card);
          const boom = fxSil('boom', '#FF8C42', x, y, 96);
          gsap.timeline({ onComplete: () => boom.remove() }).fromTo(boom, { scale: 0, rotate: -20 }, { scale: 1.3, rotate: 0, duration: 0.2, ease: 'back.out(2)' }).to(boom, { opacity: 0, scale: 1.5, duration: 0.2 });
          particles.burst(x, y, { count: 8, kind: 'square', colors: ['#FF8C42', '#FFC53D', '#FFFFFF'], size: 9, dist: 70, life: 0.35 });
        }
        if (!reducedMotion()) {
          screenShake();
          for (const t of ev.targets) {
            const tu = U(t);
            if (tu) gsap.fromTo(tu.card, { x: -5 }, { x: 0, duration: 0.25, ease: 'elastic.out(1,0.3)' });
          }
        }
        await wait(0.22);
        return;
      }
      case 'revive': {
        const s = ev.unit;
        let u = units.get(s.uid);
        if (u) {
          u.gone?.kill();
          u.gone = undefined;
          u.alive = true;
          u.side = s.side;
          u.atk = s.atk;
          u.hp = s.hp;
          u.maxHp = Math.max(u.maxHp, s.hp);
          u.shield = s.shield;
          u.el.style.visibility = 'visible';
          gsap.set(u.card, { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 });
          refresh(u);
        } else u = makeUnit(s) ?? undefined;
        if (!u) return;
        const arr = order[s.side].filter((x) => x !== s.uid);
        arr.splice(Math.min(s.pos, arr.length), 0, s.uid);
        order[s.side] = arr;
        layout(s.side, fast ? 0 : 0.25);
        if (fast) {
          u.card.classList.remove('is-dead');
          return;
        }
        sfx.revive();
        await wait(0.2);
        const [x, y] = center(u.card);
        const r = u.card.getBoundingClientRect();
        const wl = fxSil('revive_wing', '#FFC53D', x - r.width * 0.45, y, r.width * 0.9);
        const wr = fxSil('revive_wing', '#FFC53D', x + r.width * 0.45, y, r.width * 0.9);
        wr.style.transform = 'scaleX(-1)';
        gsap.timeline({ onComplete: () => { wl.remove(); wr.remove(); } })
          .fromTo([wl, wr], { scaleY: 0.2, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' })
          .to([wl, wr], { opacity: 0, y: -16, duration: 0.25 }, '+=0.15');
        u.card.classList.remove('is-dead');
        fl(u, ev.via === 'equip' ? '跳板机复活！' : '复活！', '#E0A21E', -20, 22);
        await wait(0.3);
        return;
      }
      case 'chain': {
        const u = U(ev.unit);
        if (fast || !u) return;
        sfx.chain();
        const [x, y] = center(u.card);
        const r = u.card.getBoundingClientRect();
        const bolt = fxSil('chain_bolt', '#FFC53D', x, y - r.height * 0.55, 44);
        gsap.timeline({ onComplete: () => bolt.remove() }).fromTo(bolt, { scale: 0 }, { scale: 1.1, duration: 0.12, ease: 'back.out(3)' }).to(bolt, { opacity: 0, duration: 0.12, repeat: 1, yoyo: true }).to(bolt, { opacity: 0, duration: 0.1 });
        await wait(0.1);
        return;
      }
      case 'equipProc': {
        const u = U(ev.unit);
        if (fast || !u) return;
        procFx(u, ev.slot, ev.equipId, ev.gold);
        return;
      }
      case 'end':
        return;
      default:
        return;
    }
  }

  function procFx(u: BU, slot: EquipSlot, equipId: string, gold: boolean): void {
    const c = u.card.querySelector(`.uc-eq[data-slot="${slot}"]`) as HTMLElement | null;
    if (c) {
      gsap.fromTo(c, { scale: 1 }, { scale: 1.5, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out' });
      const [x, y] = center(c);
      particles.burst(x, y, { count: 2, kind: 'star', colors: ['#FFC53D'], size: 10, dist: 18, life: 0.3 });
    }
    const key = `${u.uid}:${equipId}`;
    if (seenProc.has(key)) return;
    seenProc.add(key);
    const d = data.equipsById[equipId];
    if (d) fl(u, `${gold ? '金·' : ''}${d.name}`, '#E0A21E', 26, 15);
  }

  /** 碎盾：shield_shard 从受击卡中心放大并分成两半 */
  function shieldShatter(u: BU): void {
    sfx.shieldBreak();
    const [x, y] = center(u.card);
    const parts = [fxSil('shield_shard', '#7FD6FF', x, y, 56), fxSil('shield_shard', '#7FD6FF', x, y, 56)];
    parts[0].style.clipPath = 'inset(0 50% 0 0)';
    parts[1].style.clipPath = 'inset(0 0 0 50%)';
    gsap.timeline({ onComplete: () => parts.forEach((p) => p.remove()) })
      .fromTo(parts, { scale: 0.6 }, { scale: 1.2, duration: 0.12, ease: 'back.out(2)' })
      .to(parts[0], { x: -22, rotate: -25, opacity: 0, duration: 0.25, ease: 'power2.in' })
      .to(parts[1], { x: 22, rotate: 25, opacity: 0, duration: 0.25, ease: 'power2.in' }, '<');
    fl(u, '碎盾！', '#2F80ED', 14, 16);
  }

  /** 反弹数字：从护盾持有者飞回攻击者 */
  function flyNumber(from: BU, to: BU, text: string, color: string): void {
    const [fx, fy] = toShell(...center(from.card));
    const [tx, ty] = toShell(...center(to.card));
    const n = document.createElement('div');
    n.className = 'float-text';
    n.textContent = text;
    n.style.color = color;
    n.style.fontSize = '34px';
    n.style.left = `${fx}px`;
    n.style.top = `${fy}px`;
    getFxLayer().appendChild(n);
    gsap.timeline({ onComplete: () => n.remove() })
      .set(n, { xPercent: -50, yPercent: -50 })
      .to(n, { x: tx - fx, duration: 0.3, ease: 'power1.inOut' }, 0)
      .to(n, { y: Math.min(0, ty - fy) - 30, duration: 0.15, ease: 'power2.out' }, 0)
      .to(n, { y: ty - fy, duration: 0.15, ease: 'power2.in' }, 0.15)
      .to(n, { scale: 1.3, duration: 0.08 }, 0.3)
      .to(n, { opacity: 0, y: `-=20`, duration: 0.3 }, 0.4);
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
      if (u.alive) return;
      clips.forEach((c, i) => {
        const p = card.cloneNode(true) as HTMLElement;
        p.classList.add('shard');
        Object.assign(p.style, { left: `${lx}px`, top: `${ly}px`, width: `${r.width}px`, height: `${r.height}px`, clipPath: c });
        layer.appendChild(p);
        const d = 20 + Math.random() * 20;
        gsap.to(p, { x: dirs[i][0] * d, y: dirs[i][1] * d + 30, rotate: (Math.random() - 0.5) * 60, opacity: 0, duration: 0.4, ease: 'power1.in', onComplete: () => p.remove() });
      });
      u.el.style.visibility = 'hidden';
      u.gone = gsap.delayedCall(2.5, () => {
        if (!u.alive) u.el.remove();
      });
    });
  }

  // ───────────── 结束演出 ─────────────
  function oppTaunt(s: RunState, winner: BattleResult['winner']): string | null {
    if (s.matchup?.kind !== 'pvp' || winner === 'draw') return null;
    const o = s.opponents.find((x) => x.id === s.matchup!.opponentId);
    const p = o?.presetId ? data.opponents.find((x) => x.id === o.presetId) : undefined;
    return (winner === 'enemy' ? p?.taunt?.victory : p?.taunt?.defeated) ?? null;
  }

  async function endShow(result: BattleResult, before: RunState, after: RunState): Promise<void> {
    gsap.to(vs, { opacity: 0, scale: 0.3, duration: 0.2 });
    const pve = before.matchup?.kind === 'pve';
    const big = document.createElement('div');
    big.className = `big-word big-word--${result.winner}`;
    big.textContent = result.winner === 'me' ? (pve ? '击退！' : '胜利！') : result.winner === 'enemy' ? (pve ? '没打过' : '惜败') : '平局';
    big.style.top = `${bigWordTop - 28}px`;
    arena.appendChild(big);
    gsap.fromTo(big, { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' });
    // 对手台词冒泡
    const taunt = oppTaunt(before, result.winner);
    if (taunt) {
      const t = document.createElement('div');
      t.className = 'taunt-bubble';
      const o = before.opponents.find((x) => x.id === before.matchup?.opponentId);
      t.innerHTML = `${o?.avatar ? `<span class="lb-ava sm"><img src="${artUrl(o.avatar)}" alt=""></span>` : ''}<span>${esc(taunt)}</span>`;
      enemyLabel.appendChild(t);
      gsap.fromTo(t, { scale: 0, opacity: 1 }, { scale: 1, duration: 0.25, ease: 'back.out(2.5)', delay: 0.2 });
    }
    const myLoss = after.lastEvents.find((e) => e.type === 'hpLoss' && e.who === 'me');
    const oppLoss = before.matchup ? after.lastEvents.find((e) => e.type === 'hpLoss' && e.who === before.matchup!.opponentId) : undefined;
    if (result.winner === 'me') {
      sfx.win();
      const r = arena.getBoundingClientRect();
      fullscreen(() => {
        particles.confetti(r.left + 10, r.bottom - 10, reducedMotion() ? 4 : 18, -Math.PI / 2 + 0.45, 0.6, 800);
        particles.confetti(r.right - 10, r.bottom - 10, reducedMotion() ? 4 : 18, -Math.PI / 2 - 0.45, 0.6, 800);
        return gsap.delayedCall(1.2, () => {});
      });
      await wait(0.5);
      if (oppLoss && oppLoss.type === 'hpLoss') {
        const [x, y] = center(enemyLabel);
        floatText(x, y + 26, `${oppLoss.name} 热度 -${oppLoss.amount}`, '#F25757', 22, 20);
      }
    } else if (result.winner === 'enemy') {
      sfx.lose();
      edgeFlash();
      await wait(0.3);
    } else await wait(0.5);
    if (myLoss && myLoss.type === 'hpLoss') {
      sfx.hpLoss();
      const chip = top.querySelector('[data-hud=hp]') as HTMLElement;
      const bar = chip.querySelector('.hud-hpbar i') as HTMLElement;
      const w0 = bar.style.width;
      setHpChip(top, after.hp);
      gsap.fromTo(bar, { width: w0 }, { width: bar.style.width, duration: 0.4, ease: 'power2.out' });
      gsap.fromTo(chip, { x: -4 }, { x: 0, duration: 0.3, ease: 'elastic.out(1,0.3)' });
      const [x, y] = center(chip);
      floatText(x, y + 24, `-${myLoss.amount}`, '#F25757', 28, 24);
    }
    if (!before.tutorial) {
      lobby.update(after);
      updateDock(after);
    }
    await wait(0.4);
  }

  // ───────────── 联机：上传快照 + 注入真人对手（失败静默） ─────────────
  async function syncOnline(s: RunState): Promise<RunState> {
    if (s.tutorial || !s.matchup) return s;
    const team = s.team.filter((u): u is UnitInst => !!u);
    const room = settings.room || undefined;
    const seed = s.seed.slice(0, 64);
    const arch = dominantSynergy(computeSynergies(s.team, data))?.key ?? 'mixed';
    if (team.length) void api.snapshot({ name: settings.name, room, turn: s.turn, hp: Math.max(0, Math.min(20, s.hp)), archetype: arch, team, seed });
    if (!isOnline()) return s;
    const res = await Promise.race([
      api.opponents({ turn: s.turn, room, name: settings.name, seed, limit: 7 }),
      new Promise<null>((r) => setTimeout(() => r(null), 1800)),
    ]);
    const snaps = (res?.opponents ?? []).filter((o) => o?.team?.length);
    if (!snaps.length) return s;
    try {
      return injectHumanOpponents(s, snaps.map((o) => ({ name: o.name, team: o.team, hp: o.hp })), data);
    } catch (e) {
      console.warn('[net] inject failed', e);
      return s;
    }
  }

  // ───────────── 主流程 ─────────────
  async function main(): Promise<void> {
    await new Promise((r) => requestAnimationFrame(r));
    if (destroyed) return;
    let s = app.run!;
    const synced = await syncOnline(s);
    if (destroyed) return;
    if (synced !== s) {
      s = synced;
      setRun(s);
      if (!s.tutorial) {
        lobby.update(s);
        updateDock(s);
      }
    }
    const mu = s.matchup;
    oppName.innerHTML = mu
      ? mu.kind === 'pve'
        ? `回合 ${s.turn} · <b>${esc(mu.name)}</b>`
        : `回合 ${s.turn} · ${mu.isHuman ? '真人 ' : ''}<b>${esc(mu.name)}</b>`
      : `回合 ${s.turn}`;
    const result = battleForState(s, data);
    battleCtl.playing = true;
    t0 = performance.now();
    for (const ev of result.events) {
      if (destroyed) return;
      // 1x 下超过 14s 自动切 2x（ART 7.1：一场目标 8~15s）
      if (!skipping && curSpeed === 1 && performance.now() - t0 > 14000) setSpeed(2);
      await play(ev);
    }
    if (pendingReturn) await pendingReturn;
    if (skipping) {
      for (const u of units.values()) {
        if (!u.alive) u.el.remove();
        else {
          u.card.classList.remove('is-dead');
          refresh(u);
        }
      }
      layout('me', 0);
      layout('enemy', 0);
      parkVs(0);
      skipping = false;
    }
    setSpeed(1);
    battleCtl.playing = false;
    const after = applyBattleResult(s, result, data);
    await endShow(result, s, after);
    if (destroyed) return;
    setRun(after);
    const info = new Map<string, UnitInfo>();
    for (const u of units.values()) info.set(u.uid, { defId: u.defId, level: u.level, side: u.side });
    showResult(el, { result, before: s, after, units: info, lobby });
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
