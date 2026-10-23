// 开局赛场三选一（ART 9.7）：3 张竖卡（插画 cover + 名字 + 规则一句话 + 推荐流派徽），点选后"就它了"进入第 1 回合。
import gsap from 'gsap';
import { DEFAULT_ARENAS, type ArenaDef } from '@juanwang/shared';
import { app, act, go, type Scene } from '../store';
import { artUrl, assetUrl, hasAsset } from '../assets';
import { esc, synIcon, synName } from '../ui/cards';
import { toast } from '../ui/toast';
import { sfx } from '../fx/sound';
import { reducedMotion } from '../fx/anims';
import { updateDock } from '../ui/lobby';

/** 赛场推荐流派：数据 hint → 规则里的阵营/职业 → 内置默认的 hint */
export function arenaHints(a: ArenaDef): string[] {
  const out = new Set<string>();
  const r = a.rules ?? {};
  if (a.hint) out.add(a.hint);
  if (r.factionPriceMod) out.add(r.factionPriceMod.faction);
  if (r.rolePriceMod) out.add(r.rolePriceMod.role);
  for (const b of r.synergyBonus ?? []) out.add(b.key);
  if (r.startShield?.filter?.faction) out.add(r.startShield.filter.faction);
  if (r.startShield?.filter?.role) out.add(r.startShield.filter.role);
  if (r.summonBuff) out.add('folk');
  if (!out.size) {
    const d = DEFAULT_ARENAS.find((x) => x.id === a.id)?.hint;
    if (d) out.add(d);
  }
  return [...out].filter((k) => synName(k) !== k).slice(0, 2);
}

/** "规则：风味" → [规则, 风味] */
export function arenaText(a: ArenaDef): [string, string] {
  const i = a.desc.search(/[：:]/);
  return i > 0 ? [a.desc.slice(0, i), a.desc.slice(i + 1)] : [a.desc, ''];
}

export function arenaArt(a: ArenaDef): string | null {
  const p = a.icon && hasAsset(a.icon) ? a.icon : `arenas/${a.id}.svg`;
  return hasAsset(p) ? assetUrl(p) : null;
}

export function arenaScene(): Scene {
  const data = app.data;
  const s = app.run!;
  updateDock(null);
  const el = document.createElement('div');
  const opts = (s.arenaOptions ?? []).map((id) => data.arenasById[id]).filter(Boolean);
  el.innerHTML = `
    <div class="ar-head">
      <div class="ar-title">选择本局赛场</div>
      <div class="ar-sub">整局生效的全局规则，会推你走某条流派</div>
    </div>
    <div class="ar-cards"></div>
    <div class="ar-opps"><small>本局 7 名对手</small><div class="ar-opp-list">${s.opponents
      .map((o) => `<span class="lb-ava sm" title="${esc(o.name)}">${o.avatar ? `<img src="${artUrl(o.avatar)}" alt="">` : esc(Array.from(o.name)[0] ?? '?')}</span>`)
      .join('')}</div></div>
    <button class="btn btn--go btn--xl ar-go" disabled>就它了</button>`;
  const cards = el.querySelector('.ar-cards') as HTMLElement;
  const goBtn = el.querySelector('.ar-go') as HTMLButtonElement;
  let pick = -1;
  opts.forEach((a, i) => {
    const c = document.createElement('button');
    c.className = 'ar-card panel';
    c.dataset.idx = String(i);
    const art = arenaArt(a);
    const [rule, flavor] = arenaText(a);
    const hints = arenaHints(a);
    c.innerHTML = `
      <div class="ar-art">${art ? `<img src="${art}" alt="">` : ''}</div>
      <div class="ar-body">
        <b class="ar-name">${esc(a.name)}</b>
        <span class="ar-rule">${esc(rule)}</span>
        ${flavor ? `<small class="ar-flavor">${esc(flavor)}</small>` : ''}
        <span class="ar-hints">${hints.map((k) => `<span class="ar-hint"><img src="${synIcon(k)}" alt="">${esc(synName(k))}</span>`).join('')}</span>
      </div>`;
    c.onclick = () => {
      sfx.click();
      pick = i;
      cards.querySelectorAll('.ar-card').forEach((n, j) => n.classList.toggle('is-picked', j === i));
      goBtn.disabled = false;
      goBtn.textContent = `就它了：${a.name}`;
      gsap.fromTo(c, { scale: 0.96 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' });
    };
    cards.appendChild(c);
  });
  goBtn.onclick = () => {
    if (pick < 0) {
      toast('先点一张赛场卡', 'info');
      return;
    }
    sfx.click();
    const n = act({ type: 'chooseArena', index: pick });
    if (n.error) {
      toast(n.error);
      return;
    }
    go('game');
  };
  if (!reducedMotion()) {
    gsap.from(el.querySelector('.ar-title'), { y: -30, opacity: 0, duration: 0.35, ease: 'back.out(2)' });
    gsap.fromTo(cards.children, { y: 40, rotateY: 90, opacity: 0 }, { y: 0, rotateY: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: 'back.out(1.6)', delay: 0.1 });
  }
  return { el };
}
