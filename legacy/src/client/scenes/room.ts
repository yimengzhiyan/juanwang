// 房间：大房间码 + 二维码、玩家列表、机器人、设置、换角色 / 骰子皮肤、开始游戏。
import QRCode from 'qrcode';
import type { RoomState } from '@dafuweng/shared';
import { assetUrl, avatarUrl } from '../assets';
import { net } from '../net';
import { charOf, data, prefs, store } from '../store';
import { clear, h, toast } from '../util';
import { PREF_CHAR, PREF_SKIN } from './lobby';

const MONEY_OPTS = [1000, 1500, 2000, 3000];
const ROUND_OPTS = [0, 20, 30, 50];
const TIMEOUT_OPTS = [0, 30, 45, 60, 90];

export class RoomScene {
  readonly el: HTMLElement;
  private room: RoomState | null = null;
  private qrFor = '';
  private qrImg = h('img.qr', { alt: '扫码加入' }) as HTMLImageElement;
  private body = h('div.room-body');
  private skinSynced = false;

  constructor() {
    this.el = h('div.scene.scene-room', null, this.body);
    document.body.append(this.el);
  }

  destroy(): void {
    this.el.remove();
  }

  joinUrl(code: string): string {
    return `${location.origin}${location.pathname}?room=${code}`;
  }

  update(room: RoomState): void {
    this.room = room;
    const me = room.players.find((p) => p.id === store.myId);
    // 把大厅里选的骰子皮肤同步到服务端（只做一次）
    if (me && !this.skinSynced) {
      this.skinSynced = true;
      const want = prefs.get(PREF_SKIN);
      if (want && me.diceSkin !== want) net.send({ t: 'setDiceSkin', diceSkin: want });
    }
    this.render();
  }

  private render(): void {
    const room = this.room;
    if (!room) return;
    const d = data();
    const isHost = room.hostId === store.myId;
    const me = room.players.find((p) => p.id === store.myId);
    const url = this.joinUrl(room.code);
    if (this.qrFor !== url) {
      this.qrFor = url;
      QRCode.toDataURL(url, { margin: 1, width: 360, color: { dark: '#1A1240', light: '#FFFFFF' } })
        .then((src) => (this.qrImg.src = src))
        .catch(() => {});
    }
    const scroll = this.el.scrollTop;
    clear(this.body);

    // 房间码 + 二维码
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('邀请链接已复制', 'success');
      } catch {
        toast(url);
      }
    };
    const local = /^(localhost|127\.)/.test(location.hostname);
    this.body.append(
      h(
        'section.room-head.glass.glass--neon',
        null,
        h('div.room-code-wrap', null, h('small', null, '房间码'), h('div.room-code', null, room.code), h('button.btn.btn--secondary.btn--sm', { type: 'button', onclick: copy }, '复制邀请链接')),
        h('div.qr-wrap', null, this.qrImg, h('small', null, local ? '手机请用电脑的局域网地址打开后扫码' : '手机扫码加入')),
      ),
    );

    // 玩家列表
    const list = h('div.room-players');
    for (const p of room.players) {
      const c = charOf(p.characterId);
      list.append(
        h(
          'div.rp.glass',
          { class: p.id === store.myId ? 'glass--active' : '', style: `--pc:${p.color}` },
          h('img.rp-av', { src: avatarUrl(p.characterId), alt: '' }),
          h('div.rp-main', null, h('b', null, p.name), h('small', null, c ? `${c.name} · ${c.title}` : '')),
          h(
            'div.rp-tags',
            null,
            p.isHost ? h('i.tag.tag--gold', null, '房主') : null,
            p.isBot ? h('i.tag', null, 'AI') : null,
            p.id === store.myId ? h('i.tag.tag--me', null, '我') : null,
            !p.connected && !p.isBot ? h('i.tag.tag--warn', null, '离线') : h('i.dot-online', { title: '在线' }),
          ),
          isHost && p.isBot ? h('button.btn.btn--danger.btn--sm', { type: 'button', onclick: () => net.send({ t: 'removeBot', playerId: p.id }) }, '移除') : null,
        ),
      );
    }
    const playersSec = h('section.room-sec', null, h('h3', null, `玩家 ${room.players.length}/${room.maxPlayers}`), list);
    if (isHost) {
      const add = h('button.btn.btn--secondary.btn--wide', { type: 'button', onclick: () => net.send({ t: 'addBot' }) }, '+ 添加机器人') as HTMLButtonElement;
      add.disabled = room.players.length >= room.maxPlayers;
      playersSec.append(add);
    }
    this.body.append(playersSec);

    // 设置
    const settings = h('section.room-sec.glass.room-settings', null, h('h3', null, '房间设置', isHost ? null : h('small', null, '（仅房主可改）')));
    const seg = (label: string, opts: number[], cur: number, fmt: (n: number) => string, key: 'startMoney' | 'maxRounds' | 'turnTimeoutSec') => {
      const row = h('div.seg-row', null, h('span.seg-label', null, label));
      const segs = h('div.seg');
      for (const v of opts) {
        const b = h('button.seg-btn', { type: 'button', class: v === cur ? 'active' : '', onclick: () => net.send({ t: 'updateSettings', settings: { [key]: v } }) }, fmt(v)) as HTMLButtonElement;
        b.disabled = !isHost;
        segs.append(b);
      }
      if (!opts.includes(cur)) segs.append(h('button.seg-btn.active', { type: 'button', disabled: true }, fmt(cur)));
      row.append(segs);
      settings.append(row);
    };
    seg('起始 Token', MONEY_OPTS, room.settings.startMoney, (n) => `${n}T`, 'startMoney');
    seg('轮数上限', ROUND_OPTS, room.settings.maxRounds, (n) => (n === 0 ? '不限' : `${n}轮`), 'maxRounds');
    seg('回合超时', TIMEOUT_OPTS, room.settings.turnTimeoutSec, (n) => (n === 0 ? '不限' : `${n}s`), 'turnTimeoutSec');
    this.body.append(settings);

    // 换角色
    const taken = new Set(room.players.filter((p) => p.id !== store.myId).map((p) => p.characterId));
    const chars = h('div.char-scroll.char-scroll--small');
    for (const c of d.characters) {
      const mine = me?.characterId === c.id;
      const b = h(
        'button.char-mini.glass',
        {
          type: 'button',
          class: (mine ? 'glass--active ' : '') + (taken.has(c.id) ? 'is-taken' : ''),
          style: `--pc:${c.color}`,
          onclick: () => {
            if (taken.has(c.id) || mine) return;
            prefs.set(PREF_CHAR, c.id);
            net.send({ t: 'setCharacter', characterId: c.id });
          },
        },
        h('img', { src: avatarUrl(c.id), alt: '' }),
        h('span', null, c.name),
      ) as HTMLButtonElement;
      if (taken.has(c.id)) b.disabled = true;
      chars.append(b);
    }
    const skins = h('div.skin-row.skin-row--small');
    for (const s of d.diceSkins) {
      skins.append(
        h(
          'button.skin.glass',
          {
            type: 'button',
            class: me?.diceSkin === s.id || (!me?.diceSkin && s.id === d.diceSkins[0]?.id) ? 'glass--active' : '',
            title: s.desc,
            onclick: () => {
              prefs.set(PREF_SKIN, s.id);
              net.send({ t: 'setDiceSkin', diceSkin: s.id });
            },
          },
          h('img', { src: assetUrl('dice/' + s.id), alt: '' }),
          h('span', null, s.name),
        ),
      );
    }
    this.body.append(h('section.room-sec', null, h('h3', null, '我的角色'), chars, h('h3', null, '骰子皮肤'), skins));

    // 底部操作
    const foot = h('section.room-foot.glass');
    foot.append(h('button.btn.btn--secondary', { type: 'button', onclick: () => net.send({ t: 'leaveRoom' }) }, '离开'));
    if (isHost) {
      const start = h('button.btn.btn--gold.btn--roll.btn--grow', { type: 'button', onclick: () => net.send({ t: 'startGame' }) }, room.players.length < room.minPlayers ? `至少 ${room.minPlayers} 人（可加机器人）` : '开始游戏') as HTMLButtonElement;
      start.disabled = room.players.length < room.minPlayers;
      foot.append(start);
    } else {
      foot.append(h('div.wait-host', null, h('i.spinner'), '等待房主开始…'));
    }
    this.body.append(foot);
    this.el.scrollTop = scroll;
  }
}

export { PREF_CHAR };
