// 隐藏页自动打一局（每回合 +5 算力辅助），保存吃鸡前最后一个商店阶段的 RunState
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2];
const seeds = process.argv.slice(3);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => { localStorage.setItem('jw.name', JSON.stringify('参赛者')); localStorage.setItem('jw.tutorialDone', 'true'); localStorage.setItem('jw.muted', 'true'); });
const page = await ctx.newPage();
await page.goto('http://localhost:3100/?debug');
await page.waitForSelector('.scene--home', { timeout: 30000 });
const S = () => page.evaluate(() => window.__jw.state);
const D = (a) => page.evaluate((x) => { const r = window.__jw.dispatch(x); return { error: r?.error, phase: r?.phase }; }, a);
for (const seed of seeds) {
  await page.evaluate((s) => { window.__jw.start(s, 'normal'); window.__jw.dispatch({ type: 'chooseArena', index: 1 }); }, seed);
  await page.waitForSelector('.scene--game');
  const snaps = [];
  for (let g = 0; g < 30; g++) {
    let s = await S();
    if (s.phase === 'headline') { await page.waitForSelector('.np-opt'); await page.click('.np-opt >> nth=0'); await page.waitForTimeout(300); }
    if (await page.isVisible('.pve-mask')) { await page.click('.pve-mask'); await page.waitForTimeout(300); }
    await page.evaluate(() => { const s = window.__jw.state; if (s.turn > 2) window.__jw.setRun({ ...s, gold: s.gold + 5 }); });
    for (let k = 0; k < 20; k++) {
      s = await S();
      const team = s.team.filter(Boolean);
      if (s.turn >= 3 && s.gold >= 7 && s.shopLevel < 2 && k === 0) { const r = await D({ type: 'upgradeShop' }); if (!r.error) continue; }
      const dupe = s.shop.findIndex((x) => x.kind === 'unit' && x.price <= s.gold && team.some((u) => u.defId === x.defId && u.level < 3));
      const unitSlot = dupe >= 0 ? dupe : s.shop.findIndex((x) => x.kind === 'unit' && x.price <= s.gold && team.length < 5);
      if (unitSlot >= 0) { const r = await D({ type: 'buy', slot: unitSlot }); if (!r.error) continue; }
      const eqSlot = s.shop.findIndex((x) => x.kind === 'equip' && x.price <= s.gold);
      if (eqSlot >= 0 && team.length) {
        const def = await page.evaluate((id) => window.__jw.data.equipsById[id], s.shop[eqSlot].defId);
        const target = s.team.findIndex((u) => u && (!u.equips?.[def.slot] || (u.equips[def.slot].defId === def.id && !u.equips[def.slot].gold)));
        if (target >= 0) { const r = await D({ type: 'equip', slot: eqSlot, unitIndex: target }); if (!r.error) continue; }
      }
      if (team.length >= 5 && s.turn > 4 && s.gold >= 3 && k < 4) {
        const up = s.shop.findIndex((x) => x.kind === 'unit' && x.price <= s.gold + 2);
        if (up >= 0) {
          const weakest = s.team.reduce((b, u, i) => (u && (b < 0 || u.atk + u.hp < s.team[b].atk + s.team[b].hp) ? i : b), -1);
          await D({ type: 'sell', index: weakest }); continue;
        }
      }
      if (s.gold >= 1 && k < 14) { await D({ type: 'reroll' }); continue; }
      break;
    }
    s = await S();
    snaps.push(JSON.parse(JSON.stringify(s)));
    await page.click('.act-fight');
    await page.waitForSelector('.scene--battle');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__jw.skip());
    await page.waitForSelector('.result-go', { timeout: 60000 });
    await page.waitForTimeout(300);
    s = await S();
    if (s.pending) { await page.waitForSelector('.modal--reward'); await page.click('.pr-card >> nth=0'); await page.waitForTimeout(400); }
    await page.click('.result-go');
    await page.waitForTimeout(400);
    if (await page.isVisible('.scene--over')) break;
    await page.waitForSelector('.scene--game');
  }
  const fin = await S();
  console.log(seed, 'turn', fin.turn, 'end', JSON.stringify(fin.end), 'alive', fin.opponents.filter((o) => o.alive).length);
  if (fin.end?.won) {
    const last = snaps.at(-1);
    writeFileSync(OUT, JSON.stringify(last));
    console.log('saved pre-final state turn', last.turn, 'opps alive', last.opponents.filter((o) => o.alive).map((o) => o.name + ':' + o.hp).join(','));
    break;
  }
  await page.evaluate(() => window.__jw.go('home'));
}
await browser.close();
