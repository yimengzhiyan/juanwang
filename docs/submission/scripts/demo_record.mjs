// 录制参赛演示视频：首页 → 赛场 → 拖拽买单位/装备 → 1x 开战 → 结算 → 头条 → 再打一场 → 羁绊/图鉴 → 注入终局状态 → 吃鸡
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const URL = process.env.URL || 'http://localhost:3100';
const OUTDIR = process.argv[2];
const END = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SEED = process.env.SEED || 'demo159';
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
await ctx.addInitScript(() => {
  try { localStorage.setItem('jw.name', JSON.stringify('参赛者')); localStorage.setItem('jw.tutorialDone', 'true'); } catch {}
  // 视频里显示一个手指光标（无头浏览器录屏没有鼠标指针）
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid rgba(40,60,90,.85);box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;transition:transform .12s,background .12s;transform:translate(-100px,-100px)';
    document.body.appendChild(c);
    let x = -100, y = -100, down = false;
    const upd = () => { c.style.transform = `translate(${x}px,${y}px) scale(${down ? 0.75 : 1})`; c.style.background = down ? 'rgba(255,214,90,.8)' : 'rgba(255,255,255,.55)'; };
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; upd(); }, true);
    addEventListener('pointerdown', (e) => { x = e.clientX; y = e.clientY; down = true; upd(); }, true);
    addEventListener('pointerup', () => { down = false; upd(); }, true);
  });
});
const t0 = Date.now();
const page = await ctx.newPage();
// Playwright 自带 recordVideo 只按 CSS 像素录（390×844），这里改用 CDP screencast 抓 2 倍设备像素帧
mkdirSync(OUTDIR + '/frames', { recursive: true });
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', (f) => {
  const n = frames.length;
  const file = `${OUTDIR}/frames/${String(n).padStart(6, '0')}.jpg`;
  writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file, ts: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 780, maxHeight: 1688, everyNthFrame: 1 });
const marks = {};
const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log('mark', k, marks[k]); };
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const sleep = (ms) => page.waitForTimeout(ms);
const S = () => page.evaluate(() => window.__jw.state);
let cx = 195, cy = 700;
async function moveTo(x, y, steps = 18) { await page.mouse.move(x, y, { steps }); cx = x; cy = y; }
async function center(sel) { const el = await page.$(sel); await el.scrollIntoViewIfNeeded(); const b = await el.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function tap(sel, pause = 900) { const [x, y] = await center(sel); await moveTo(x, y); await sleep(350); await page.mouse.down(); await sleep(90); await page.mouse.up(); await sleep(pause); }
async function drag(srcSel, dstSel, pause = 1200) {
  const [ax, ay] = await center(srcSel); const [bx, by] = await center(dstSel);
  await moveTo(ax, ay); await sleep(450);
  await page.mouse.down(); await sleep(250);
  await page.mouse.move(ax + 8, ay - 12, { steps: 4 });
  await page.mouse.move(bx, by, { steps: 40 }); cx = bx; cy = by;
  await sleep(350);
  await page.mouse.up();
  await sleep(pause);
  if (await page.isVisible('.c-ok')) { await tap('.c-ok', 800); }
}
const unitIdx = (s) => s.shop.map((x, i) => [x, i]).filter(([x]) => x.kind === 'unit' && x.price <= s.gold).map(([, i]) => i);
const emptySlot = (s) => s.team.findIndex((u) => !u);

await page.goto(URL + '/?debug');
await page.waitForSelector('.scene--home', { timeout: 30000 });
mark('home');
// 首页「开始一局」→ 用固定种子（保证首战有技能慢放、能打赢）
await page.evaluate((seed) => {
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.h-start')) { e.stopImmediatePropagation(); e.preventDefault(); window.__jw.start(seed, 'normal'); }
  }, true);
}, SEED);
await moveTo(195, 600, 10);
await sleep(2800);
await tap('.h-start', 0);
await page.waitForSelector('.scene--arena');
mark('arena');
await sleep(1800);
await tap('.ar-card >> nth=1', 1500);
await tap('.ar-go', 0);
await page.waitForSelector('.scene--game');
mark('shop1');
await sleep(1800);
// 买两个单位：拖到前排 0、1
let s = await S();
await drag(`[data-src="shop:${unitIdx(s)[0]}"]`, '.tslot[data-index="0"]');
s = await S();
await drag(`[data-src="shop:${unitIdx(s)[0]}"]`, '.tslot[data-index="1"]');
s = await S();
// 装备拖到第一个单位
const eq = s.shop.findIndex((x) => x.kind === 'equip' && x.price <= s.gold);
await drag(`[data-src="equip:${eq}"]`, '.tslot[data-index="0"]', 1500);
s = await S();
console.log('team1', JSON.stringify(s.team.map((u) => u && [u.defId, Object.values(u.equips || {}).map((q) => q?.defId)])), 'gold', s.gold);
// 点一下装了装备的单位看看详情
await tap('.tslot[data-index="0"]', 2200);
await page.mouse.click(195, 160); await sleep(600);
mark('fight1');
await tap('.act-fight', 0);
await page.waitForSelector('.scene--battle');
await moveTo(360, 820, 10);
await page.waitForSelector('.result-go', { timeout: 90000 });
mark('result1');
console.log('big1', await page.evaluate(() => window.__jw.bigShown), 'winner', (await S()).history.at(-1)?.winner);
await sleep(4200);
await tap('.result-go', 0);
// 头条
await page.waitForSelector('.np-opt', { timeout: 15000 });
mark('headline');
await sleep(2600);
await moveTo(...(await center('.np-opt >> nth=1')), 14); await sleep(900);
await tap('.np-opt >> nth=0', 1500);
await page.waitForSelector('.scene--game');
if (await page.isVisible('.pve-mask')) await tap('.pve-mask', 700);
mark('shop2');
await sleep(1000);
s = await S();
for (let k = 0; k < 2; k++) {
  s = await S();
  const u = unitIdx(s); const e = emptySlot(s);
  if (!u.length || e < 0) break;
  await drag(`[data-src="shop:${u[0]}"]`, `.tslot[data-index="${e}"]`);
}
s = await S();
const eq2 = s.shop.findIndex((x) => x.kind === 'equip' && x.price <= s.gold);
if (eq2 >= 0) {
  const def = await page.evaluate((id) => window.__jw.data.equipsById[id], s.shop[eq2].defId);
  const tgt = s.team.findIndex((u) => u && !u.equips?.[def.slot]);
  if (tgt >= 0) await drag(`[data-src="equip:${eq2}"]`, `.tslot[data-index="${tgt}"]`);
}
// 羁绊面板
mark('synergy');
await tap('.sp-toggle', 2800);
await tap('.sp-toggle', 700);
// 图鉴（阵营页）
mark('codex');
await tap('.hud-codex', 2200);
await page.mouse.move(195, 600);
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 120); await sleep(220); }
await sleep(1000);
await tap('.modal-x', 900);
mark('fight2');
await tap('.act-fight', 0);
await page.waitForSelector('.scene--battle');
await moveTo(360, 820, 10);
await page.waitForSelector('.result-go', { timeout: 90000 });
mark('result2');
await sleep(3000);
await tap('.result-go', 0);
await sleep(600);
// 快进到终局：注入第 14 回合（只剩 1 名对手）的真实对局状态
await page.waitForSelector('.scene--game, .np-opt', { timeout: 15000 });
await sleep(500);
await page.evaluate((st) => { window.__jw.setRun(st); window.__jw.go('game'); }, END);
await page.waitForSelector('.scene--game');
mark('endshop');
await sleep(3200);
await tap('.act-fight', 0);
await page.waitForSelector('.scene--battle');
await sleep(1500);
await tap('[data-sp="2"]', 0);
await moveTo(360, 820, 10);
await page.waitForSelector('.result-go', { timeout: 90000 });
mark('result3');
await sleep(2800);
await tap('.result-go', 0);
await page.waitForSelector('.scene--over', { timeout: 15000 });
mark('over');
await sleep(5000);
await moveTo(195, 600, 8);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 90); await sleep(260); }
await sleep(2500);
mark('end');
console.log('rank', await page.textContent('.over-title'));
console.log('ERRORS', JSON.stringify(errors));
await cdp.send('Page.stopScreencast');
await sleep(300);
// ffmpeg concat 清单（可变帧率，按时间戳给每帧时长）
let list = '';
for (let i = 0; i < frames.length; i++) {
  const d = i + 1 < frames.length ? frames[i + 1].ts - frames[i].ts : 0.5;
  list += `file '${frames[i].file}'\nduration ${Math.max(0.001, d).toFixed(4)}\n`;
}
list += `file '${frames.at(-1).file}'\n`;
writeFileSync(OUTDIR + '/frames.txt', list);
writeFileSync(OUTDIR + '/marks.json', JSON.stringify({ ...marks, firstFrameTs: frames[0]?.ts, nframes: frames.length }));
console.log('frames', frames.length);
await ctx.close();
await browser.close();
