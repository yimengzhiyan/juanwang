// 校验 shared/data/*.json（内容同事改完数据后运行：npm run validate-data）
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataError, generateBotTeam, newRun, validateData } from '../shared/src/index';

const dir = process.argv[2] ?? fileURLToPath(new URL('../shared/data/', import.meta.url));
const read = (n: string) => {
  const f = join(dir, `${n}.json`);
  if (!existsSync(f)) {
    console.log(`  - 缺少 ${n}.json`);
    return undefined;
  }
  return JSON.parse(readFileSync(f, 'utf8')) as unknown;
};
console.log(`校验 ${dir}`);
try {
  const data = validateData({ units: read('units'), items: read('items'), headlines: read('headlines'), surprises: read('surprises'), tutorial: read('tutorial') });
  const shop = data.units.filter((u) => !u.token);
  console.log(`✔ 通过：单位 ${data.units.length}（商店 ${shop.length}）、基建 ${data.items.length}、头条 ${data.headlines.length}、突发 ${data.surprises.length}、引导 ${data.tutorial ? '有' : '无'}`);
  for (let t = 1; t <= 6; t++) console.log(`  T${t}: ${data.shopUnitsByTier[t].map((u) => u.id).join(', ') || '（空）'}`);
  newRun('check', data);
  if (data.tutorial) newRun('check', data, { tutorial: true });
  generateBotTeam(20, 5, data, 'check');
  console.log('✔ 开局 / 引导局 / 机器人 冒烟通过');
} catch (e) {
  if (e instanceof DataError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}
