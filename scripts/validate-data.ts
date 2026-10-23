// 校验 shared/data/*.json（内容同事改完数据后运行：npm run validate-data [目录]）
import { DataError, botPlayTurn, generateArchetypeTeam, newRun, runTurnOffline, shopAction, validateData } from '../shared/src/index';
import { readRaw } from './load-data';

const { raw, missing } = readRaw(process.argv[2]);
console.log('校验内容数据');
for (const m of missing) console.log(`  - 缺少 ${m}`);
try {
  const data = validateData(raw);
  const shop = data.units.filter((u) => !u.token);
  console.log(`✔ 通过：单位 ${data.units.length}（商店 ${shop.length}）、装备 ${data.equips.length}、消耗品 ${data.consumables.length}、赛场 ${data.arenas.length}、对手 ${data.opponents.length}、PVE ${data.pve.length}、头条 ${data.headlines.length}、突发 ${data.surprises.length}、引导 ${data.tutorial ? '有' : '无'}`);
  for (let t = 1; t <= 6; t++) console.log(`  T${t}: ${data.shopUnitsByTier[t].map((u) => `${u.id}(${u.faction}${u.role ? '/' + u.role : ''})`).join(', ') || '（空）'}`);
  for (const w of data.warnings) console.log(`  ⚠ ${w}`);
  // 冒烟：开局 → 选赛场 → 机器人打完一整局；引导局；每条流派的机器人
  let s = shopAction(newRun('check', data), { type: 'chooseArena', index: 0 }, data);
  for (let k = 0; k < 25 && s.phase !== 'over'; k++) {
    s = botPlayTurn(s, data, { archetype: { faction: 'open' } });
    s = runTurnOffline(s, data).state;
    if (s.error) throw new Error(s.error);
  }
  if (data.tutorial) newRun('check', data, { tutorial: true });
  for (const o of data.opponents) generateArchetypeTeam(o, 12, 'check', data);
  console.log(`✔ 冒烟通过：整局第 ${s.end?.rank} 名（${s.end?.archetypeName}，${s.turn} 回合）、引导局、${data.opponents.length} 个对手机器人`);
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
