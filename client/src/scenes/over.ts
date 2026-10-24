// 结局页（ART 9.9）：名次大字（第 N 名 / 吃鸡！）、本局流派、成就（首次达成盖章）、MVP、最终阵容（带装备）、
// 8 人排名表、新图鉴；再来一局（2s 弹出）/ 再战同一局 / 分享 / 回首页；上传结果。
import gsap from 'gsap';
import {
  ACHIEVEMENTS, START_HP, computeSynergies, effectiveStats, stateBonus,
  type RunState, type UnitInst,
} from '@juanwang/shared';
import { app, go, goRun, newSeed, recordAchievements, settings, startRun, type Scene } from '../store';
import { artUrl, assetUrl } from '../assets';
import { archetypeKey, esc, miniAvatar, synIcon, synName, tierShield, unitCard } from '../ui/cards';
import { showUnitDetail } from '../ui/modal';
import { toast } from '../ui/toast';
import { updateDock } from '../ui/lobby';
import { api } from '../net';
import { fullscreen, reducedMotion } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';

export function shareLink(seed: string): string {
  return `${location.origin}${location.pathname}?seed=${encodeURIComponent(seed)}`;
}

/** 复制到剪贴板：优先 Clipboard API，退回 execCommand；都失败返回 false */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 退回旧方法 */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

interface RankRow {
  place: number;
  name: string;
  avatar: string | null;
  arch: string | null;
  me: boolean;
  hp: number;
}

/** 8 人最终排名：已知名次直接用，其余按热度高→低填空位 */
export function finalRanking(s: RunState): RankRow[] {
  const rows: (Omit<RankRow, 'place'> & { place?: number })[] = [
    { name: settings.name || '你', avatar: null, arch: s.end?.archetype && s.end.archetype !== 'mixed' ? s.end.archetype : null, me: true, hp: s.hp, place: s.end?.rank },
    ...s.opponents.map((o) => ({ name: o.name, avatar: o.avatar || null, arch: archetypeKey(o.archetype), me: false, hp: o.hp, place: o.alive ? undefined : o.place })),
  ];
  const used = new Set(rows.map((r) => r.place).filter((p): p is number => !!p));
  const free = [...rows].filter((r) => !r.place).sort((a, b) => b.hp - a.hp);
  let p = 1;
  for (const r of free) {
    while (used.has(p)) p++;
    r.place = p;
    used.add(p);
  }
  return (rows as RankRow[]).sort((a, b) => a.place - b.place);
}

export function overScene(): Scene {
  const data = app.data;
  const s = app.run!;
  updateDock(null);
  const end = s.end;
  const rank = end?.rank ?? 8;
  const won = !!end?.won || rank === 1;
  const isTut = !!s.tutorial;
  const team = s.team.filter((u): u is UnitInst => !!u);
  const best = end?.bestUnit ? team.find((u) => u.defId === end.bestUnit) ?? null : null;
  const el = document.createElement('div');
  el.classList.add(won ? 'is-won' : rank <= 4 ? 'is-top' : 'is-lost');
  const ach = end?.achievements ?? [];
  if (!app.freshAch) app.freshAch = isTut ? [] : recordAchievements(ach);
  const fresh = new Set(app.freshAch);
  const syns = computeSynergies(s.team, data, stateBonus(s, data));
  const domKey = end?.archetype && end.archetype !== 'mixed' ? end.archetype : null;
  const dom = domKey ? syns.find((x) => x.key === domKey) : undefined;
  const reasonText = end?.reason === 'champion' ? '活到最后，你就是卷王！' : end?.reason === 'turnLimit' ? `回合用尽，按热度排名` : '热度归零，出局了';
  const rankCls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : rank === 3 ? 'r3' : 'rx';
  const newSeen = [...new Set(app.newSeen)].filter((id) => data.unitsById[id]);
  el.innerHTML = `
    <div class="over-rays"></div>
    <div class="over-head">
      ${won ? `<img class="over-trophy" src="${assetUrl('fx/crown.svg')}" alt="">` : ''}
      <div class="over-title ${rankCls}">${won ? '吃鸡！' : `第 ${rank} 名`}</div>
      <div class="over-sub">${esc(reasonText)} · 存活 ${end?.turns ?? s.turn} 回合 · 8 人房</div>
    </div>
    <div class="over-body panel">
      <div class="over-arch">
        <span class="oa-badge">${domKey ? `<img class="oa-ico" src="${synIcon(domKey)}" alt="">${tierShield(dom?.tier ?? 1, 'oa-tier')}` : '<span class="oa-mixed">杂</span>'}</span>
        <div class="oa-text"><small>本局流派</small><b>${esc(end?.archetypeName ?? (domKey ? `${synName(domKey)}流` : '杂牌军'))}</b>${dom ? `<span>${esc(dom.name)} ×${dom.count}：${esc(dom.descs[dom.tier - 1] ?? '')}</span>` : '<span>没有点亮羁绊，下局试试凑同阵营/同职业</span>'}</div>
      </div>
      ${ach.length ? `<div class="over-ach">${ach.map((id) => `<span class="ach${fresh.has(id) ? ' is-fresh' : ''}">${esc(ACHIEVEMENTS[id] ?? id)}${fresh.has(id) ? '<b class="ach-stamp">首次</b>' : ''}</span>`).join('')}</div>` : ''}
      <div class="over-mid">
        <div class="over-best"><div class="over-best-card"></div><div class="over-best-label">MVP</div></div>
        <div class="over-stats">
          <div><small>热度</small><b>${Math.max(0, s.hp)}/${START_HP}</b></div>
          <div><small>胜 / 负</small><b>${s.stats.wins} / ${s.stats.losses}</b></div>
          <div><small>PVE</small><b>${s.stats.pveWins} 胜</b></div>
          <div class="over-rank"><small>全服榜</small><b>…</b></div>
        </div>
      </div>
      <div class="over-sec-title">最终阵容</div>
      <div class="over-team"></div>
      ${newSeen.length ? `<div class="over-new">新图鉴 +${newSeen.length} ${newSeen.slice(0, 8).map((id) => miniAvatar(data, id)).join('')}</div>` : ''}
      <div class="over-sec-title">8 人房排名</div>
      <div class="over-ranks">${finalRanking(s)
        .map(
          (r) => `<div class="or-row${r.me ? ' is-me' : ''}"><span class="or-place p${r.place}">${r.place}</span>${r.me ? '<span class="lb-ava lb-ava--me sm">你</span>' : r.avatar ? `<span class="lb-ava sm"><img src="${artUrl(r.avatar)}" alt=""></span>` : `<span class="lb-ava lb-ava--txt sm">${esc(Array.from(r.name)[0] ?? '?')}</span>`}<span class="or-name">${esc(r.me ? `${r.name}（你）` : r.name)}</span>${r.arch ? `<img class="or-arch" src="${synIcon(r.arch)}" alt="">` : ''}</div>`,
        )
        .join('')}</div>
      <div class="over-seed">种子 <code>${esc(s.seed)}</code></div>
    </div>
    <div class="over-btns2">
      <div class="over-row">
        <button class="btn btn--blue over-same">再战同一局</button>
        <button class="btn btn--gold over-share">分享</button>
      </div>
      <button class="btn btn--white btn--sm over-home">回首页</button>
    </div>
    <div class="over-btns">
      <button class="btn btn--go btn--xl over-again">再来一局</button>
    </div>`;
  const bestBox = el.querySelector('.over-best-card') as HTMLElement;
  if (best && data.unitsById[best.defId]) {
    const st = effectiveStats(best, data, s.team);
    const c = unitCard(data.unitsById[best.defId], { atk: st.atk, hp: st.hp, level: best.level, xp: best.xp, equips: best.equips });
    c.onclick = () => showUnitDetail(data, best.defId, best, { stats: st });
    bestBox.appendChild(c);
  } else (el.querySelector('.over-best') as HTMLElement).style.display = 'none';
  const teamEl = el.querySelector('.over-team') as HTMLElement;
  for (const u of team) {
    const d = data.unitsById[u.defId];
    if (!d) continue;
    const st = effectiveStats(u, data, s.team);
    const w = document.createElement('div');
    w.className = 'over-tcard';
    const c = unitCard(d, { atk: st.atk, hp: st.hp, level: u.level, xp: u.xp, equips: u.equips });
    c.onclick = () => showUnitDetail(data, u.defId, u, { stats: st });
    w.appendChild(c);
    teamEl.appendChild(w);
  }

  const rankEl = el.querySelector('.over-rank b') as HTMLElement;
  if (isTut) rankEl.textContent = '引导局';
  else if (app.uploaded) rankEl.textContent = app.lastRank ? `#${app.lastRank}` : '离线';
  else {
    app.uploaded = true;
    void api
      .result({
        name: settings.name,
        room: settings.room || undefined,
        rank: Math.max(1, Math.min(8, rank)),
        turns: Math.max(1, Math.min(20, end?.turns ?? s.turn)),
        hp: Math.max(0, Math.min(20, s.hp)),
        archetype: end?.archetype,
        seed: s.seed.slice(0, 64),
        bestUnit: end?.bestUnit,
      })
      .then((r) => {
        app.lastRank = r?.position ?? null;
        rankEl.textContent = r ? `#${r.position}` : '离线';
        if (r?.best) toast('刷新个人最佳！', 'good');
      });
  }

  const again = el.querySelector('.over-again') as HTMLElement;
  again.onclick = () => {
    sfx.click();
    startRun(newSeed(), 'normal');
    goRun();
  };
  (el.querySelector('.over-same') as HTMLElement).onclick = () => {
    sfx.click();
    startRun(s.seed, isTut ? 'tutorial' : app.mode === 'tutorial' ? 'normal' : app.mode);
    goRun();
  };
  (el.querySelector('.over-share') as HTMLElement).onclick = async () => {
    sfx.click();
    const link = shareLink(s.seed);
    const text = `我在《卷王自走棋》8 人房${won ? '吃鸡了' : `拿了第 ${rank} 名`}（${end?.archetypeName ?? '杂牌军'}）！同一局来比比：${link}`;
    if (await copyText(text)) {
      toast('链接已复制，发给朋友打同一局', 'good');
      return;
    }
    let box = el.querySelector('.over-link') as HTMLElement | null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'over-link';
      box.innerHTML = `<small>自动复制失败，长按下面的链接手动复制：</small><input readonly aria-label="分享链接">`;
      el.querySelector('.over-btns2')!.insertBefore(box, el.querySelector('.over-home'));
    }
    const input = box.querySelector('input') as HTMLInputElement;
    input.value = link;
    input.onfocus = () => input.select();
    input.focus();
    input.select();
    gsap.fromTo(box, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
  };
  (el.querySelector('.over-home') as HTMLElement).onclick = () => {
    sfx.click();
    go('home');
  };

  // 动效
  const tl = gsap.timeline();
  if (won) {
    sfx.champion();
    tl.fromTo(el.querySelector('.over-trophy'), { scale: 0, y: 120 }, { scale: 1, y: 0, duration: 0.8, ease: 'elastic.out(1,0.6)' })
      .fromTo(el.querySelector('.over-title'), { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(2.5)' }, 0.3);
    gsap.to(el.querySelector('.over-rays'), { rotate: 360, duration: 12, repeat: -1, ease: 'none' });
    if (!reducedMotion()) {
      fullscreen(() =>
        gsap.to({}, {
          duration: 0.1,
          repeat: 26,
          delay: 0.4,
          onRepeat: () => {
            if (particles.count < 60) particles.rain(3);
          },
        }),
      );
    }
  } else {
    if (rank <= 4) sfx.win();
    else sfx.lose();
    tl.fromTo(el.querySelector('.over-title'), { y: -200, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'bounce.out' });
  }
  tl.fromTo(el.querySelector('.over-body'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, 0.5);
  gsap.fromTo(el.querySelectorAll('.ach-stamp'), { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, stagger: 0.12, delay: 1.1, ease: 'power4.out' });
  const row = el.querySelector('.over-btns2') as HTMLElement;
  gsap.set(again, { scale: 0 });
  gsap.set(row.querySelectorAll('.over-row, .over-home'), { opacity: 0 });
  gsap.to(again, { scale: 1, duration: 0.45, delay: 2, ease: 'back.out(3)' });
  gsap.to(row.querySelectorAll('.over-row, .over-home'), { opacity: 1, duration: 0.3, delay: 2.2 });
  const bounce = gsap.timeline({ repeat: -1, repeatDelay: 1.25, delay: 3 }).to(again, { y: -8, duration: 0.15, ease: 'power2.out' }).to(again, { y: 0, duration: 0.2, ease: 'bounce.out' });
  return {
    el,
    destroy: () => {
      bounce.kill();
      gsap.killTweensOf(el.querySelector('.over-rays'));
      particles.clear();
    },
  };
}
