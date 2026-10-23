// PVE 回合（ART 9.6）：开店前"怪物来袭"条幅 → 收成顶栏下小横条；战后三选一奖励弹窗。
import gsap from 'gsap';
import type { GameData, PveDef, PveRewardOption } from '@juanwang/shared';
import { artUrl, assetUrl, hasAsset, ui } from '../assets';
import { equipCard, esc, unitCard } from './cards';
import { openModal, type ModalHandle } from './modal';
import { reducedMotion } from '../fx/anims';
import { sfx } from '../fx/sound';

/** 条幅插画：pve/<名>.svg（按 id 关键词对应），否则用 avatar */
export function pveArt(pv: PveDef): string | null {
  const byId = /halluc/.test(pv.id) ? 'pve/hallucination_horde.svg' : /huang|gpu/.test(pv.id) ? 'pve/gpu_legion.svg' : `pve/${pv.id}.svg`;
  if (hasAsset(byId)) return assetUrl(byId);
  return pv.avatar ? artUrl(pv.avatar) : null;
}
const isHorde = (pv: PveDef): boolean => /halluc/.test(pv.id);

/** 常驻小横条（顶栏下 36px） */
export function pveStrip(pv: PveDef): HTMLElement {
  const el = document.createElement('div');
  el.className = `pve-strip${isHorde(pv) ? ' is-horde' : ''}`;
  el.innerHTML = `<b>${esc(pv.name.replace(/来袭$/, ''))}</b><span>PVE 回合 · 不扣热度 · 赢了三选一</span>`;
  return el;
}

/** 大条幅：从上方甩入，停 1.2s 后上滑收起（点一下立即收起） */
export function pveBanner(host: HTMLElement, pv: PveDef, turn: number): Promise<void> {
  const mask = document.createElement('div');
  mask.className = 'pve-mask';
  const art = pveArt(pv);
  mask.innerHTML = `
    <div class="pve-banner">
      ${art && art.includes('/pve/') ? `<img class="pve-art" src="${art}" alt="${esc(pv.name)}">` : `<div class="pve-art pve-art--text">${art ? `<img src="${art}" alt="">` : ''}<b>${esc(pv.name)}</b></div>`}
      <div class="pve-sub">第 ${turn} 回合 · 不扣热度 · 赢了三选一奖励</div>
      <div class="pve-desc">${esc(pv.desc)}</div>
      ${pv.tip ? `<div class="pve-tip"><b>攻略</b>${esc(pv.tip)}</div>` : ''}
    </div>`;
  host.appendChild(mask);
  sfx.headline();
  const card = mask.querySelector('.pve-banner') as HTMLElement;
  return new Promise((resolve) => {
    let done = false;
    const close = (): void => {
      if (done) return;
      done = true;
      gsap.to(card, { yPercent: -140, duration: 0.3, ease: 'power2.in' });
      gsap.to(mask, { opacity: 0, duration: 0.3, delay: 0.1, onComplete: () => { mask.remove(); resolve(); } });
    };
    mask.onclick = close;
    if (reducedMotion()) gsap.fromTo(card, { opacity: 0 }, { opacity: 1, duration: 0.15 });
    else gsap.fromTo(card, { yPercent: -120, rotate: -6 }, { yPercent: 0, rotate: -1, duration: 0.5, ease: 'back.out(1.6)' });
    gsap.delayedCall(2.4, close);
  });
}

/** 战后三选一：单位 / 金色装备 / 算力 */
export function pveRewardModal(data: GameData, pv: PveDef | undefined, options: PveRewardOption[], onPick: (i: number) => void): ModalHandle {
  const body = document.createElement('div');
  body.className = 'pve-reward';
  body.innerHTML = `<div class="pr-head">${pv ? `击败「${esc(pv.name.replace(/来袭$/, ''))}」！` : '打赢了！'}选一个奖励</div><div class="pr-cards"></div><p class="pr-note">单位和装备会放进下回合商店（免费、已冻结）</p>`;
  const cards = body.querySelector('.pr-cards') as HTMLElement;
  let chosen = false;
  const m = openModal({ title: '三选一奖励', body, cls: 'modal--reward', dismissable: false, closeButton: false });
  options.forEach((o, i) => {
    const c = document.createElement('button');
    c.className = `pr-card pr-card--${o.type}`;
    c.dataset.idx = String(i);
    const vis = document.createElement('div');
    vis.className = 'pr-vis';
    let title = o.text;
    let sub = '';
    if (o.type === 'unit') {
      const d = data.unitsById[o.defId];
      if (d) {
        vis.appendChild(unitCard(d, { atk: d.atk, hp: d.hp, level: 1 }));
        title = d.name;
        sub = `T${d.tier} 单位 · 免费`;
      }
    } else if (o.type === 'equip') {
      const d = data.equipsById[o.defId];
      if (d) {
        vis.appendChild(equipCard(d, true));
        title = `金色${d.name}`;
        sub = d.goldDesc.replace(/^金：/, '');
      }
    } else {
      vis.innerHTML = `<div class="pr-gold"><img src="${ui('gold')}" alt=""><b>+${o.amount}</b></div>`;
      title = `+${o.amount} 算力`;
      sub = '下回合开始到账';
    }
    c.appendChild(vis);
    c.insertAdjacentHTML('beforeend', `<b class="pr-title">${esc(title)}</b><small class="pr-sub">${esc(sub)}</small>`);
    c.onclick = () => {
      if (chosen) return;
      chosen = true;
      sfx.buy();
      gsap.timeline({ onComplete: () => { m.close(); onPick(i); } })
        .to(c, { scale: 1.08, duration: 0.12, ease: 'power2.out' })
        .to(c, { scale: 1, duration: 0.15 })
        .to([...cards.children].filter((x) => x !== c), { opacity: 0.3, duration: 0.15 }, 0);
    };
    cards.appendChild(c);
  });
  if (!reducedMotion()) gsap.fromTo(cards.children, { y: 40, rotateY: 90, opacity: 0 }, { y: 0, rotateY: 0, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'back.out(1.6)', delay: 0.1 });
  return m;
}
