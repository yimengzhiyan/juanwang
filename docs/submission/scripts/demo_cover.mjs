// 封面 1280×720：左 Logo + 标语，右手机商店截图
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [OUT, SHOT] = process.argv.slice(2);
const URL = process.env.URL || 'http://localhost:3100';
const img = 'data:image/png;base64,' + readFileSync(SHOT).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Fredoka;src:url(${URL}/fonts/fredoka-latin.woff2) format('woff2');}
*{box-sizing:border-box;margin:0}
body{width:1280px;height:720px;overflow:hidden;font-family:Fredoka,'Noto Sans CJK SC','Noto Sans SC',sans-serif;
 background:linear-gradient(160deg,#4FC3F7 0%,#A9E3FB 45%,#FFF8E7 85%);position:relative}
.grass{position:absolute;left:-80px;right:-80px;bottom:-260px;height:380px;border-radius:50%;background:#58C65C;box-shadow:inset 0 14px 0 #7AD67D}
.left{position:absolute;left:90px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center;gap:34px}
.logo{width:560px;filter:drop-shadow(0 8px 0 rgba(59,42,26,.15))}
.tag{font-size:29px;white-space:nowrap;font-weight:700;color:#1F2A44;background:#fff;border:3px solid #3B2A1A;border-radius:999px;padding:14px 30px;align-self:flex-start;box-shadow:0 6px 0 rgba(59,42,26,.18)}
.tag b{color:#2F80ED}
.sub{font-size:22px;color:#5A6785;padding-left:8px;font-weight:600}
.phone{position:absolute;right:110px;top:40px;width:296px;height:640px;border-radius:40px;overflow:hidden;border:6px solid #1F2A44;
 box-shadow:0 30px 60px rgba(31,42,68,.35),0 10px 0 rgba(59,42,26,.18);transform:rotate(3deg);background:#fff}
.phone img{width:100%;height:100%;object-fit:cover;object-position:top}
</style></head><body><div class="grass"></div>
<div class="left"><img class="logo" src="${URL}/logo.svg"><div class="tag">AI 圈自走棋 · <b>买单位</b> · <b>排兵布阵</b> · <b>自动互撞</b></div><div class="sub">8 人淘汰赛 · 流派羁绊 · 装备 · 活到最后就是卷王</div></div>
<div class="phone"><img src="${img}"></div></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(URL + '/manifest.json');
await page.setContent(html, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({ path: OUT });
await browser.close();
