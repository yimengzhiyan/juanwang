// 最小壳：下一阶段由客户端同事替换。这里只验证 shared 引擎可以被 Vite 打包、素材 URL 可用。
import { MAX_TURNS, WIN_TROPHIES, maxTierForTurn } from '@juanwang/shared';
import { assetUrl } from './assets';

const app = document.getElementById('app')!;
app.innerHTML = `
  <main style="font-family: system-ui, sans-serif; max-width: 520px; margin: 40px auto; text-align: center; color: #1F2A44">
    <h1>卷王自走棋</h1>
    <p>引擎已就绪：拿满 ${WIN_TROPHIES} 个热搜登顶，最多 ${MAX_TURNS} 回合，回合 11 解锁 T${maxTierForTurn(11)}。</p>
    <img src="${assetUrl('characters/gpt_chan.png')}" alt="" width="96" height="96" />
  </main>`;
