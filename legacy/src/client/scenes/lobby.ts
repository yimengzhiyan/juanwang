// 大厅：Logo、昵称、角色卡片（横向滑动）、骰子皮肤、创建房间 / 输入房间码加入。
import { assetUrl, avatarUrl } from '../assets';
import { net } from '../net';
import { data, prefs } from '../store';
import { h, toast } from '../util';

export const PREF_NAME = 'dafuweng.name';
export const PREF_CHAR = 'dafuweng.character';
export const PREF_SKIN = 'dafuweng.diceSkin';

/** 规则速览（精简自 docs/RULES.md） */
const RULES = [
  '2~6 人（可加机器人），每人起始 1500T（Token），轮流掷两颗 GPU 骰子前进，经过融资轮 +200T。',
  '走到无主的基建 / 算力中心 / 电力数据站可以买下；别人踩到就要付 API 调用费。',
  '踩到自己的基建可升级 v1→v4→旗舰 AGI，费用越来越高；每回合掷骰前还能远程升级 1 次。',
  '集齐同色组空地费用翻倍；算力中心持有越多收得越狠，电力 / 数据按骰子点数收费。',
  '热搜 / 突发卡：发钱、扣钱、送道具，或引发价格战、泡沫破裂等全场事件。',
  '7 种道具（路障、DDoS 导弹、火箭、限流乌龟、护盾、跳板机、豁免卡）在自己回合掷骰前使用。',
  '掷出双骰再掷一次，连续 3 次进监管审查；付 50T / 用豁免卡 / 掷出双骰即可出来。',
  '缺钱可抵押基建（半价）；付不起就破产。只剩一人或到达轮数上限时按身价排名。',
];

export function roomFromUrl(): string {
  const q = new URLSearchParams(location.search).get('room') ?? '';
  return q.trim().toUpperCase().slice(0, 4);
}

export class LobbyScene {
  readonly el: HTMLElement;
  private charId: string;
  private skin: string;

  constructor() {
    const d = data();
    this.charId = prefs.get(PREF_CHAR) ?? d.characters[Math.floor(Math.random() * d.characters.length)]?.id ?? '';
    if (!d.characters.some((c) => c.id === this.charId)) this.charId = d.characters[0]?.id ?? '';
    this.skin = prefs.get(PREF_SKIN) ?? d.diceSkins[0]?.id ?? 'h100';

    const nameInput = h('input.input', { type: 'text', maxlength: 12, placeholder: '你的昵称', value: prefs.get(PREF_NAME) ?? '', autocomplete: 'nickname' }) as HTMLInputElement;
    const codeInput = h('input.input.input--code', { type: 'text', maxlength: 4, placeholder: '房间码', value: roomFromUrl(), autocapitalize: 'characters', autocomplete: 'off' }) as HTMLInputElement;
    codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '')));

    const cards = h('div.char-scroll');
    for (const c of d.characters) {
      const card = h(
        'button.char-card.glass',
        { type: 'button', 'data-id': c.id, style: `--pc:${c.color}`, onclick: () => select(c.id) },
        h('div.char-av', null, h('img', { src: avatarUrl(c.id), alt: c.name, loading: 'lazy' })),
        h('div.char-name', null, c.name),
        h('div.char-title', null, c.title),
        h('div.char-flavor', null, c.flavor),
      );
      cards.append(card);
    }
    const select = (id: string) => {
      this.charId = id;
      prefs.set(PREF_CHAR, id);
      for (const el of cards.querySelectorAll<HTMLElement>('.char-card')) el.classList.toggle('glass--active', el.dataset.id === id);
    };
    select(this.charId);

    const skins = h('div.skin-row');
    const selectSkin = (id: string) => {
      this.skin = id;
      prefs.set(PREF_SKIN, id);
      for (const el of skins.querySelectorAll<HTMLElement>('.skin')) el.classList.toggle('glass--active', el.dataset.id === id);
    };
    for (const s of d.diceSkins) {
      skins.append(
        h('button.skin.glass', { type: 'button', 'data-id': s.id, title: s.desc, onclick: () => selectSkin(s.id) }, h('img', { src: assetUrl('dice/' + s.id), alt: '' }), h('span', null, s.name)),
      );
    }
    selectSkin(this.skin);

    const getName = () => {
      const n = nameInput.value.trim();
      if (!n) {
        nameInput.focus();
        nameInput.classList.add('shake');
        setTimeout(() => nameInput.classList.remove('shake'), 400);
        toast('先起个昵称吧', 'error');
        return null;
      }
      prefs.set(PREF_NAME, n);
      return n;
    };
    const create = () => {
      const name = getName();
      if (!name) return;
      if (!net.send({ t: 'createRoom', name, characterId: this.charId })) toast('正在连接服务器…', 'error');
    };
    const join = () => {
      const name = getName();
      if (!name) return;
      const code = codeInput.value.trim().toUpperCase();
      if (code.length !== 4) {
        codeInput.focus();
        toast('请输入 4 位房间码', 'error');
        return;
      }
      if (!net.send({ t: 'joinRoom', code, name, characterId: this.charId })) toast('正在连接服务器…', 'error');
    };
    codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && join());

    const fromUrl = roomFromUrl();
    const rules = h(
      'details.lobby-rules.glass',
      null,
      h('summary', null, '规则速览 · 如何联机'),
      h(
        'ol.rules-list',
        null,
        ...RULES.map((r) => h('li', null, r)),
      ),
      h('p.rules-net', null, h('b', null, '如何联机：'), '同一 Wi-Fi 下，电脑开服后手机扫房间页的二维码即可加入；也可以在这里输入房主给的 4 位房间码。'),
    );
    this.el = h(
      'div.scene.scene-lobby',
      null,
      h('img.lobby-logo', { src: assetUrl('logo') || '/assets/logo.svg', alt: '大玩家' }),
      h('p.lobby-tag', null, 'AI 圈大富翁 · 掷骰子买算力，把对手卷到破产'),
      h('section.lobby-card.glass', null, h('label.lbl', null, '昵称'), nameInput),
      h('section.lobby-sec', null, h('label.lbl', null, '选择角色', h('small', null, '左右滑动')), cards),
      h('section.lobby-sec', null, h('label.lbl', null, 'GPU 骰子皮肤'), skins),
      h(
        'section.lobby-actions.glass',
        null,
        fromUrl ? null : h('button.btn.btn--primary.btn--wide', { type: 'button', onclick: create }, '创建房间'),
        h('div.join-row', null, codeInput, h('button.btn', { type: 'button', class: fromUrl ? 'btn--primary' : 'btn--secondary', onclick: join }, '加入房间')),
        fromUrl ? h('button.btn.btn--secondary.btn--wide', { type: 'button', onclick: create }, '我要自己开房') : null,
      ),
      rules,
    );
    document.body.append(this.el);
    requestAnimationFrame(() => cards.querySelector('.glass--active')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  }

  get diceSkin(): string {
    return this.skin;
  }

  destroy(): void {
    this.el.remove();
  }
}
