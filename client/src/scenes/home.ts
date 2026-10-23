// 首页：Logo、开始一局、每日挑战、好友房、图鉴、排行榜、新手引导、昵称。
import gsap from 'gsap';
import { app, goRun, newSeed, saveSettings, settings, startRun, type Scene } from '../store';
import { updateDock } from '../ui/lobby';
import { assetUrl, avatarUrl } from '../assets';
import { openModal } from '../ui/modal';
import { openCodex } from '../ui/codex';
import { openLeaderboard } from '../ui/leaderboard';
import { toast } from '../ui/toast';
import { api, isOnline, onOnlineChange, todayCN } from '../net';
import { sfx, setMuted } from '../fx/sound';
import { MUTED_SVG, SOUND_SVG } from '../ui/team';
import { esc } from '../ui/cards';

export function homeScene(): Scene {
  const data = app.data;
  const el = document.createElement('div');
  updateDock(null);
  const resumable = app.run && app.run.phase !== 'over' && app.run.phase !== 'battle';
  const featured = ['gpt_chan', 'claude_chan', 'deepseek_chan', 'qwen_chan', 'huang'].map((id) => data.unitsById[id]).filter(Boolean);
  el.innerHTML = `
    <div class="home-top">
      <span class="net-tag">离线模式</span>
      <button class="hud-mute" aria-label="静音"></button>
    </div>
    <img class="home-logo" src="${assetUrl('logo.svg')}" alt="卷王自走棋">
    <div class="home-tagline">8 人淘汰赛 · 流派羁绊 · 装备 · 活到最后就是卷王</div>
    <div class="home-heroes">${featured.map((d, i) => `<img style="--i:${i}" src="${avatarUrl(d)}" alt="">`).join('')}</div>
    <div class="home-name panel"><label>昵称</label><input maxlength="12" value="${esc(settings.name)}" aria-label="昵称"><span class="home-room"></span></div>
    <div class="home-btns">
      ${resumable ? '<button class="btn btn--blue btn--wide h-resume">继续当前对局</button>' : ''}
      <button class="btn btn--go btn--xl btn--wide h-start">开始一局</button>
      <button class="btn btn--gold btn--wide h-daily">每日挑战</button>
      <div class="home-grid">
        <button class="btn btn--purple h-room">好友房</button>
        <button class="btn btn--blue h-lb">排行榜</button>
        <button class="btn btn--white h-codex">图鉴</button>
        <button class="btn btn--white h-tut">新手引导</button>
      </div>
    </div>`;
  const input = el.querySelector('.home-name input') as HTMLInputElement;
  input.onchange = input.onblur = () => {
    const v = input.value.trim().slice(0, 12);
    settings.name = v || settings.name;
    input.value = settings.name;
    saveSettings();
  };
  const roomTag = el.querySelector('.home-room') as HTMLElement;
  const syncRoom = (): void => {
    roomTag.textContent = settings.room ? `房间 ${settings.room}` : '';
    roomTag.style.display = settings.room ? '' : 'none';
  };
  syncRoom();
  const mute = el.querySelector('.hud-mute') as HTMLElement;
  const syncMute = (): void => {
    mute.innerHTML = settings.muted ? MUTED_SVG : SOUND_SVG;
  };
  syncMute();
  mute.onclick = () => {
    setMuted(!settings.muted);
    syncMute();
  };
  const syncNet = (): void => {
    el.classList.toggle('is-offline', !isOnline());
  };
  syncNet();
  const offNet = onOnlineChange(syncNet);


  const on = (sel: string, fn: () => void): void => {
    const b = el.querySelector(sel) as HTMLElement | null;
    if (b)
      b.onclick = () => {
        sfx.click();
        fn();
      };
  };
  on('.h-resume', () => goRun());
  on('.h-start', () => {
    startRun(newSeed(), 'normal');
    goRun();
  });
  on('.h-daily', async () => {
    const res = await api.daily();
    const seed = res?.seed ?? `daily-${todayCN()}`;
    startRun(seed, 'daily');
    toast(`今日挑战 ${seed.replace('daily-', '')}：所有人同一张开局`, 'info', 2200);
    goRun();
  });
  on('.h-tut', () => {
    startRun('tutorial', 'tutorial');
    goRun();
  });
  on('.h-codex', () => openCodex(data));
  on('.h-lb', () => openLeaderboard(data));
  on('.h-room', () => openRoom(syncRoom));

  gsap.from(el.querySelector('.home-logo'), { scale: 0.6, opacity: 0, duration: 0.6, ease: 'back.out(2)' });
  gsap.from(el.querySelectorAll('.home-btns .btn'), { y: 30, opacity: 0, duration: 0.35, stagger: 0.05, delay: 0.15, ease: 'back.out(2)' });
  gsap.from(el.querySelectorAll('.home-heroes img'), { y: 40, opacity: 0, duration: 0.4, stagger: 0.06, delay: 0.2, ease: 'back.out(2)' });
  return {
    el,
    destroy: () => {
      offNet();
    },
  };
}

function openRoom(onChange: () => void): void {
  const body = document.createElement('div');
  body.className = 'room';
  body.innerHTML = `
    <p>和朋友输入同一个房间码：上传与匹配优先在房间内进行，榜单可切到"好友房"。</p>
    <input class="room-input" maxlength="8" placeholder="4 位房间码" value="${esc(settings.room)}" autocapitalize="characters">
    <div class="room-btns">
      <button class="btn btn--white btn--sm room-gen">随机生成</button>
      <button class="btn btn--go btn--sm room-join">加入</button>
    </div>
    ${settings.room ? '<button class="btn btn--danger btn--sm room-leave">退出房间</button>' : ''}`;
  const m = openModal({ title: '好友房', body });
  const input = body.querySelector('.room-input') as HTMLInputElement;
  input.oninput = () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  };
  (body.querySelector('.room-gen') as HTMLElement).onclick = () => {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    input.value = Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  };
  (body.querySelector('.room-join') as HTMLElement).onclick = () => {
    const v = input.value.trim();
    if (v.length < 4) {
      toast('房间码要 4~8 位字母或数字');
      return;
    }
    settings.room = v;
    saveSettings();
    onChange();
    toast(`已加入房间 ${v}`, 'good');
    m.close();
  };
  const leave = body.querySelector('.room-leave') as HTMLElement | null;
  if (leave)
    leave.onclick = () => {
      settings.room = '';
      saveSettings();
      onChange();
      toast('已退出房间', 'info');
      m.close();
    };
}
