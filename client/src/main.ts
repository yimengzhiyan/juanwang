// 最小壳：下一阶段由客户端同事替换。这里只验证 shared 引擎 + 内容数据可以被 Vite 打包、素材 URL 可用。
import { MAX_TURNS, WIN_TROPHIES, newRun } from '@juanwang/shared';
import { assetUrl } from './assets';
import { getGameData } from './gameData';

const app = document.getElementById('app')!;
let info: string;
try {
  const data = getGameData();
  const run = newRun('shell', data);
  info = `数据已加载：${data.units.length} 个单位、${data.items.length} 个基建、${data.headlines.length} 张头条；首回合商店 ${run.shop.length} 格。`;
} catch (e) {
  info = `内容数据未就绪：${(e as Error).message}`;
}
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 520px; margin: 40px auto; text-align: center; color: #1F2A44">
    <h1>卷王自走棋</h1>
    <p>拿满 ${WIN_TROPHIES} 个热搜登顶，最多 ${MAX_TURNS} 回合。</p>
    <p style="white-space: pre-wrap">${info}</p>
    <img src="${assetUrl('characters/gpt_chan.png')}" alt="" width="96" height="96" />
  </main>`;
