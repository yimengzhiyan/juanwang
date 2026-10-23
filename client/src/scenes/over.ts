// 结局页：登顶（奖杯 + 彩纸雨 + 最强单位）或出局（灰色 + 排名）；统计；再来一局 / 再战同一局 / 分享。
import gsap from 'gsap';
import { WIN_TROPHIES, type RunState, type UnitInst } from '@juanwang/shared';
import { app, go, newSeed, settings, startRun, type Scene } from '../store';
import { assetUrl } from '../assets';
import { esc, miniAvatar, unitCard } from '../ui/cards';
import { showUnitDetail } from '../ui/modal';
import { toast } from '../ui/toast';
import { api } from '../net';
import { fullscreen, reducedMotion } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';

export function bestUnit(s: RunState): UnitInst | null {
  const list = s.team.filter(Boolean) as UnitInst[];
  if (!list.length) return null;
  const score = (u: UnitInst): number => u.atk + u.hp + u.level * 3;
  return list.reduce((a, b) => (score(b) > score(a) ? b : a));
}

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

export function overScene(): Scene {
  const data = app.data;
  const s = app.run!;
  const won = !!s.won;
  const best = bestUnit(s);
  const el = document.createElement('div');
  el.classList.add(won ? 'is-won' : 'is-lost');
  const reason = s.endReason === 'turnLimit' ? `回合用尽，最终 ${s.trophies} 个热搜` : won ? '拿满 10 个热搜，登顶 AI 圈！' : '信心归零，出局了';
  el.innerHTML = `
    <div class="over-rays"></div>
    <div class="over-head">
      ${won ? `<img class="over-trophy" src="${assetUrl('fx/crown.svg')}" alt="">` : ''}
      <div class="over-title">${won ? '登顶！' : s.endReason === 'turnLimit' ? '时间到' : '信心归零'}</div>
      <div class="over-sub">${esc(reason)}</div>
    </div>
    <div class="over-body panel">
      <div class="over-best"><div class="over-best-card"></div><div class="over-best-label">本局最强</div></div>
      <div class="over-stats">
        <div><small>热搜</small><b>${s.trophies}/${WIN_TROPHIES}</b></div>
        <div><small>回合</small><b>${s.turn}</b></div>
        <div><small>胜 / 负</small><b>${s.history.filter((h) => h.winner === 'me').length} / ${s.history.filter((h) => h.winner === 'enemy').length}</b></div>
        <div class="over-rank"><small>全服排名</small><b>…</b></div>
      </div>
      <div class="over-team">最终阵容 ${(s.team.filter(Boolean) as UnitInst[]).map((u) => miniAvatar(data, u.defId)).join('')}</div>
      <div class="over-seed">种子 <code>${esc(s.seed)}</code></div>
    </div>
    <div class="over-btns">
      <button class="btn btn--go btn--xl over-again">再来一局</button>
      <div class="over-row">
        <button class="btn btn--blue over-same">再战同一局</button>
        <button class="btn btn--gold over-share">分享</button>
      </div>
      <button class="btn btn--white btn--sm over-home">回首页</button>
    </div>`;
  const bestBox = el.querySelector('.over-best-card') as HTMLElement;
  if (best && data.unitsById[best.defId]) {
    const c = unitCard(data.unitsById[best.defId], { atk: best.atk, hp: best.hp, level: best.level, xp: best.xp });
    c.onclick = () => showUnitDetail(data, best.defId, best);
    bestBox.appendChild(c);
  } else (el.querySelector('.over-best') as HTMLElement).style.display = 'none';

  const rankEl = el.querySelector('.over-rank b') as HTMLElement;
  const isTut = !!s.tutorial;
  if (isTut) rankEl.textContent = '引导局';
  else if (app.uploaded) rankEl.textContent = app.lastRank ? `#${app.lastRank}` : '离线';
  else {
    app.uploaded = true;
    void api
      .result({
        name: settings.name,
        room: settings.room || undefined,
        trophies: s.trophies,
        turns: s.turn,
        won,
        seed: s.seed.slice(0, 64),
        bestUnit: best?.defId,
      })
      .then((r) => {
        app.lastRank = r?.rank ?? null;
        rankEl.textContent = r ? `#${r.rank}` : '离线';
        if (r?.best) toast('刷新个人最佳！', 'good');
      });
  }

  const again = el.querySelector('.over-again') as HTMLElement;
  again.onclick = () => {
    sfx.click();
    startRun(newSeed(), 'normal');
    go('game');
  };
  (el.querySelector('.over-same') as HTMLElement).onclick = () => {
    sfx.click();
    startRun(s.seed, isTut ? 'tutorial' : app.mode === 'tutorial' ? 'normal' : app.mode);
    go('game');
  };
  (el.querySelector('.over-share') as HTMLElement).onclick = async () => {
    sfx.click();
    const link = shareLink(s.seed);
    const text = `我在《卷王自走棋》${won ? '登顶了' : `拿了 ${s.trophies} 个热搜`}！同一局来比比：${link}`;
    if (await copyText(text)) {
      toast('链接已复制，发给朋友打同一局', 'good');
      return;
    }
    // 复制失败（非 https / 权限被拒）：降级显示链接文本，方便长按手动复制
    let box = el.querySelector('.over-link') as HTMLElement | null;
    if (!box) {
      box = document.createElement('div');
      box.className = 'over-link';
      box.innerHTML = `<small>自动复制失败，长按下面的链接手动复制：</small><input readonly aria-label="分享链接">`;
      el.querySelector('.over-btns')!.insertBefore(box, el.querySelector('.over-home'));
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
    sfx.win();
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
    sfx.lose();
    tl.fromTo(el.querySelector('.over-title'), { y: -200, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'bounce.out' });
  }
  tl.fromTo(el.querySelector('.over-body'), { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, 0.5);
  const row = el.querySelector('.over-btns') as HTMLElement;
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
