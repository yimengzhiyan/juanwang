// 新手引导：气泡 + 允许/高亮规则。步骤来自 tutorialStep(state, data)，文案来自 tutorial.json。
// 2.0 顺序：buy → fight → equip → merge → synergy → (fight) → headline → (fight) → done。
import gsap from 'gsap';
import type { GameData, TutorialStepId } from '@juanwang/shared';
import { avatarUrl } from '../assets';
import { esc } from './cards';

export type Kind =
  | 'shopUnit' | 'shopEquip' | 'shopCons' | 'team' | 'reroll' | 'freeze' | 'sell' | 'fight' | 'upgrade'
  | 'infoBuy' | 'infoUse' | 'infoSell';
const ALL: Kind[] = ['shopUnit', 'shopEquip', 'shopCons', 'team', 'reroll', 'freeze', 'sell', 'fight', 'upgrade', 'infoBuy', 'infoUse', 'infoSell'];

export function allowedKinds(step: TutorialStepId | null): Set<Kind> {
  switch (step) {
    case 'buy':
    case 'buyAgain':
    case 'synergy':
      return new Set(['shopUnit', 'team', 'infoBuy']);
    case 'merge':
      return new Set(['shopUnit', 'team', 'infoBuy', 'reroll']);
    case 'fight':
      return new Set(['fight', 'shopUnit', 'team', 'infoBuy']);
    case 'equip':
    case 'item':
      return new Set(['shopEquip', 'team', 'infoBuy']);
    case 'freezeSell':
      return new Set(['shopUnit', 'shopEquip', 'freeze', 'team', 'sell', 'infoSell', 'infoBuy']);
    case 'headline':
      return new Set();
    default:
      return new Set(ALL);
  }
}

export interface Bubble {
  el: HTMLElement;
  set: (step: TutorialStepId | null, text: string, sub?: string) => void;
}

/** 气泡上显示的 7 步 */
const ORDER: TutorialStepId[] = ['buy', 'fight', 'equip', 'merge', 'synergy', 'headline', 'done'];

export function tutorialBubble(data: GameData, onSkip: () => void, onDone: () => void): Bubble {
  const el = document.createElement('div');
  el.className = 'tut';
  const guide = data.unitsById.gpt_chan ?? data.units[0];
  el.innerHTML = `
    <img class="tut-ava" src="${avatarUrl(guide)}" alt="">
    <div class="tut-box"><div class="tut-text"></div><div class="tut-sub"></div>
      <div class="tut-row"><span class="tut-step"></span><button class="tut-skip">跳过引导</button><button class="btn btn--go tut-done">开始卷！</button></div>
    </div>`;
  (el.querySelector('.tut-skip') as HTMLElement).onclick = onSkip;
  (el.querySelector('.tut-done') as HTMLElement).onclick = onDone;
  let last = '';
  return {
    el,
    set(step, text, sub = '') {
      el.style.display = step ? '' : 'none';
      if (!step) return;
      el.dataset.step = step;
      (el.querySelector('.tut-text') as HTMLElement).innerHTML = esc(text);
      (el.querySelector('.tut-sub') as HTMLElement).innerHTML = esc(sub);
      const i = ORDER.indexOf(step);
      (el.querySelector('.tut-step') as HTMLElement).textContent = step === 'done' ? '完成' : `第 ${i < 0 ? 1 : i + 1}/${ORDER.length} 步`;
      el.classList.toggle('is-done', step === 'done');
      const key = step + text;
      if (key !== last) {
        last = key;
        gsap.fromTo(el.querySelector('.tut-box'), { scale: 0.85 }, { scale: 1, duration: 0.35, ease: 'back.out(2.5)' });
      }
    },
  };
}

export function stepText(data: GameData, step: TutorialStepId): string {
  const s = data.tutorial?.steps[step];
  return typeof s === 'string' ? s : (s?.text ?? '');
}
