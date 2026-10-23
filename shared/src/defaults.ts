// 内置默认内容（DESIGN 12.3 / 12.4 / 12.5 / 12.7）：shared/data 里缺对应文件、或某条数据的效果写法引擎读不懂时，
// 校验器按 id 回退到这里（并在 GameData.warnings 里提醒）。内容同事的数据优先。
import type { ArenaDef, ConsumableDef, EquipDef, OpponentPreset, PveDef, PveRewardSpec } from './types';

export const DEFAULT_EQUIPS: EquipDef[] = [
  // 武器
  { id: 'gpu_h100', name: '显卡', slot: 'weapon', price: 3, icon: 'items/gpu_h100.svg',
    desc: '+3 攻', goldDesc: '+6 攻，攻击时无视护盾',
    effect: { atk: 3 }, goldEffect: { atk: 6, ignoreShield: true } },
  { id: 'quantize', name: '量化', slot: 'weapon', price: 2, icon: 'items/quantize.svg',
    desc: '+3 攻 -1 血', goldDesc: '+6 攻 -1 血，攻击附带 1 点溅射',
    effect: { atk: 3, hp: -1 }, goldEffect: { atk: 6, hp: -1, splash: 1 } },
  { id: 'launch_event', name: '发布会', slot: 'weapon', price: 3, icon: 'items/launch_event.svg',
    desc: '攻击时 30% 概率额外攻击 1 次', goldDesc: '攻击时 60% 概率额外攻击 1 次',
    effect: { extraAttackChance: 0.3 }, goldEffect: { extraAttackChance: 0.6 } },
  { id: 'trending', name: '热搜', slot: 'weapon', price: 3, icon: 'items/trending.svg',
    desc: '攻击目标改为血最少的敌人', goldDesc: '攻击血最少的敌人，且 +2 攻',
    effect: { retarget: 'lowestHpEnemy' }, goldEffect: { retarget: 'lowestHpEnemy', atk: 2 } },
  // 防具
  { id: 'dataset', name: '数据集', slot: 'armor', price: 2, icon: 'items/dataset.svg',
    desc: '+1/+3', goldDesc: '+2/+6',
    effect: { atk: 1, hp: 3 }, goldEffect: { atk: 2, hp: 6 } },
  { id: 'firewall', name: '防火墙', slot: 'armor', price: 3, icon: 'items/firewall.svg',
    desc: '开战获得 4 护盾', goldDesc: '开战获得 8 护盾，碎盾反弹 2',
    effect: { startShield: 4 }, goldEffect: { startShield: 8, shieldReflect: 2 } },
  { id: 'alignment', name: '对齐', slot: 'armor', price: 3, icon: 'items/alignment.svg',
    desc: '-1 攻 +5 血，受到 ≤1 的伤害时免疫', goldDesc: '-1 攻 +10 血，受到 ≤1 的伤害时免疫',
    effect: { atk: -1, hp: 5, immuneBelow: 1 }, goldEffect: { atk: -1, hp: 10, immuneBelow: 1 } },
  { id: 'jumpbox', name: '跳板机', slot: 'armor', price: 3, icon: 'items/jumpbox.svg',
    desc: '阵亡时在最后排以 1 血复活一次', goldDesc: '阵亡时在最后排以一半血复活一次',
    effect: { revive: { hp: 1, to: 'back' } }, goldEffect: { revive: { ratio: 0.5, to: 'back' } } },
  // 饰品
  { id: 'rlhf', name: 'RLHF', slot: 'trinket', price: 3, icon: 'items/rlhf.svg',
    desc: '每回合结束永久 +1/+1', goldDesc: '每回合结束永久 +2/+2',
    effect: { growAtk: 1, growHp: 1 }, goldEffect: { growAtk: 2, growHp: 2 } },
  { id: 'distill', name: '蒸馏', slot: 'trinket', price: 3, icon: 'items/distill.svg',
    desc: '开战时复制相邻友军中较高的攻击', goldDesc: '开战时复制相邻友军中较高的攻击和血量',
    effect: { copyNeighbor: ['atk'] }, goldEffect: { copyNeighbor: ['atk', 'hp'] } },
  { id: 'finetune', name: '微调', slot: 'trinket', price: 4, icon: 'items/finetune.svg',
    desc: '技能触发时额外触发 1 次', goldDesc: '技能触发时额外触发 2 次',
    effect: { abilityRepeat: 1 }, goldEffect: { abilityRepeat: 2 } },
  { id: 'funding_round', name: '融资', slot: 'trinket', price: 3, icon: 'items/funding_round.svg',
    desc: '被出售时 +3 算力，每回合 +1 算力', goldDesc: '被出售时 +3 算力，每回合 +2 算力',
    effect: { sellGold: 3, turnGold: 1 }, goldEffect: { sellGold: 3, turnGold: 2 } },
];

export const DEFAULT_CONSUMABLES: ConsumableDef[] = [
  { id: 'coffee', name: '咖啡', desc: '本回合免费刷新 ×3', price: 1, targetKind: 'team', effect: { type: 'freeRerolls', amount: 3 }, icon: 'items/coffee.svg' },
  { id: 'press', name: '新闻稿', desc: '随机一个单位 +1 等级', price: 3, targetKind: 'team', effect: { type: 'levelUpRandom' }, icon: 'items/press.svg' },
  { id: 'pivot', name: '转型', desc: '选一个单位变成同阶随机单位（保留额外属性与装备）', price: 1, targetKind: 'unit', effect: { type: 'transform' }, icon: 'items/pivot.svg' },
];

export const DEFAULT_ARENAS: ArenaDef[] = [
  { id: 'open_summit', name: '开源大会', desc: '开源单位价格 -1', hint: 'open', rules: { factionPriceMod: { faction: 'open', amount: -1 } } },
  { id: 'gpu_drought', name: 'GPU 荒', desc: '战斗开始时双方全体 +1 攻 -1 血', hint: 'compute', rules: { battleBuff: { atk: 1, hp: -1 } } },
  { id: 'funding_winter', name: '融资寒冬', desc: '每回合 +2 算力，商店少 1 格', hint: 'trader', rules: { goldPerTurn: 2, unitSlotsMod: -1 } },
  { id: 'reroll_party', name: '刷新狂欢', desc: '刷新免费，购买单位与装备 +1 价', hint: 'engineer', rules: { rerollFree: true, unitPriceMod: 1, equipPriceMod: 1 } },
  { id: 'seat_one_aura', name: '1 号位光环', desc: '每次刷新，最前排单位永久 +1/+1（每回合最多 5 次）', hint: 'closed', rules: { rerollFrontBuff: { atk: 1, hp: 1 }, rerollFrontCap: 5 } },
  { id: 'equip_expo', name: '装备展', desc: '商店多 1 个装备格', hint: 'compute', rules: { equipSlotsMod: 1 } },
  { id: 'folk_era', name: '人海时代', desc: '召唤物 +1/+1', hint: 'folk', rules: { summonBuff: { atk: 1, hp: 1 } } },
  { id: 'institute', name: '研究院', desc: '研究员价格 -1', hint: 'researcher', rules: { rolePriceMod: { role: 'researcher', amount: -1 } } },
  { id: 'spring_gala', name: '春晚舞台', desc: '偶像羁绊人数 +1', hint: 'idol', rules: { synergyBonus: [{ key: 'idol', amount: 1 }] } },
  { id: 'safety_act', name: '安全法案', desc: '开战时闭源单位各得 2 护盾', hint: 'closed', rules: { startShield: { amount: 2, filter: { faction: 'closed' } } } },
];

export const DEFAULT_OPPONENTS: OpponentPreset[] = [
  { id: 'opp_huang', name: '老黄的显卡军团', avatar: 'characters/huang.png', archetype: { faction: 'compute' }, equips: ['gpu_h100', 'quantize', 'launch_event'], desc: '一卡顶一队' },
  { id: 'opp_zuck', name: '小扎的羊驼农场', avatar: 'characters/zuck.png', archetype: { faction: 'open' }, equips: ['dataset', 'rlhf'], desc: '人人为我' },
  { id: 'opp_botnet', name: '水军总部', avatar: 'units/botnet.svg', archetype: { faction: 'folk' }, equips: ['jumpbox', 'dataset'], desc: '人海战术' },
  { id: 'opp_dario', name: '达里奥的安全护栏', avatar: 'characters/dario.png', archetype: { faction: 'closed' }, equips: ['firewall', 'alignment'], desc: '铜墙铁壁' },
  { id: 'opp_ilya', name: '伊利亚的研究院', avatar: 'characters/ilya.png', archetype: { role: 'researcher' }, equips: ['finetune', 'distill'], desc: '技能双发' },
  { id: 'opp_altman', name: '奥特曼的融资局', avatar: 'characters/altman.png', archetype: { role: 'trader' }, equips: ['funding_round', 'gpu_h100'], desc: '钱生钱' },
  { id: 'opp_idol', name: '模型娘偶像团', avatar: 'characters/gpt_chan.png', archetype: { role: 'idol' }, equips: ['trending', 'dataset'], desc: '应援不停' },
  { id: 'opp_vibe', name: 'Vibe Coder 夜班组', avatar: 'units/vibe_coder.svg', archetype: { role: 'engineer' }, equips: ['rlhf', 'launch_event'], desc: '进化狂魔' },
];

export const DEFAULT_PVE_POOL: PveRewardSpec[] = [
  { type: 'unit', tierBonus: 1, desc: '高一阶的随机单位' },
  { type: 'goldEquip', desc: '随机一件金色装备' },
  { type: 'gold', amount: 6, desc: '立即 +6 算力' },
];

export const DEFAULT_PVE: PveDef[] = [
  {
    id: 'pve_halluc', turn: 4, name: '幻觉大军来袭', desc: '6 个 2/2 幻觉，阵亡时分裂成 1/1',
    units: Array.from({ length: 6 }, () => ({ defId: 'pve_halluc' })),
    rewards: { pick: 3, pool: DEFAULT_PVE_POOL },
    defs: [
      { id: 'pve_halluc', name: '幻觉', tier: 1, faction: 'folk', atk: 2, hp: 2, avatar: 'units/token_halluc.svg', token: true,
        ability: { trigger: 'faint', effect: 'summon', target: 'self', unitId: 'pve_halluc_mini', perLevel: false, desc: '阵亡时：分裂成一个 1/1 小幻觉' } },
      { id: 'pve_halluc_mini', name: '小幻觉', tier: 1, faction: 'folk', atk: 1, hp: 1, avatar: 'units/token_halluc.svg', token: true },
    ],
  },
  {
    id: 'pve_gpu_army', turn: 9, name: '老黄的显卡军团', desc: 'Boss 老黄 8/20 + 4 张 0/6 显卡；老黄每次攻击对全体造成 1 伤害',
    rewards: { pick: 3, pool: DEFAULT_PVE_POOL },
    units: [{ defId: 'pve_gpu' }, { defId: 'pve_gpu' }, { defId: 'pve_boss_huang' }, { defId: 'pve_gpu' }, { defId: 'pve_gpu' }],
    defs: [
      { id: 'pve_boss_huang', name: '老黄（Boss）', tier: 6, faction: 'compute', atk: 8, hp: 20, avatar: 'characters/huang.png', token: true,
        ability: { trigger: 'beforeAttack', effect: 'damage', target: 'allEnemies', amount: 1, perLevel: false, desc: '每次攻击前：对敌方全体造成 1 伤害' } },
      { id: 'pve_gpu', name: '显卡', tier: 1, faction: 'compute', atk: 0, hp: 6, avatar: 'units/token_gpu.svg', token: true },
    ],
  },
];
