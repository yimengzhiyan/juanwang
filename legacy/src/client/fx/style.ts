// 酷炫版特效的 HTML 覆盖层样式（只在 fx/ 内维护，运行时注入一次，前缀 fx2-，不依赖 style.css）。
const CSS = /* css */ `
.fx2-abs { position: absolute; left: 0; top: 0; }
.fx2-full { position: absolute; inset: 0; pointer-events: none; }

/* ============ 骰子 ============ */
.fx2-dice { position: absolute; width: 0; height: 0; }
.fx2-die { position: absolute; left: 0; top: 0; width: var(--die); height: var(--die); margin: calc(var(--die) / -2) 0 0 calc(var(--die) / -2); perspective: 520px; will-change: transform; }
.fx2-cube { position: absolute; inset: 0; transform-style: preserve-3d; }
.fx2-face { position: absolute; inset: 0; border-radius: 14%; backface-visibility: hidden; -webkit-backface-visibility: hidden;
  background: var(--face); border: 2px solid var(--edge);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.18), inset 0 calc(var(--die) * -0.12) calc(var(--die) * 0.18) rgba(0,0,0,.35), inset 0 calc(var(--die) * 0.06) calc(var(--die) * 0.1) rgba(255,255,255,.18), 0 0 calc(var(--die) * 0.2) var(--glow); }
.fx2-face::after { content: ''; position: absolute; inset: 6% 40% 55% 8%; border-radius: 50%; background: linear-gradient(135deg, rgba(255,255,255,.45), rgba(255,255,255,0)); }
.fx2-face i { position: absolute; width: 19%; height: 19%; margin: -9.5% 0 0 -9.5%; border-radius: 50%; background: var(--pip); box-shadow: 0 0 calc(var(--die) * 0.08) var(--pipglow), inset 0 -2px 2px rgba(0,0,0,.25); }
.fx2-dice-plate { position: absolute; left: 0; top: 0; width: calc(var(--die) * 6); height: calc(var(--die) * 4.4); margin: calc(var(--die) * -2.5) 0 0 calc(var(--die) * -3);
  background: radial-gradient(closest-side, rgba(8,4,26,.82) 0%, rgba(8,4,26,.6) 55%, rgba(8,4,26,0) 100%); }
.fx2-f1 { transform: translateZ(calc(var(--die) / 2)); }
.fx2-f6 { transform: rotateY(180deg) translateZ(calc(var(--die) / 2)); }
.fx2-f3 { transform: rotateY(90deg) translateZ(calc(var(--die) / 2)); }
.fx2-f4 { transform: rotateY(-90deg) translateZ(calc(var(--die) / 2)); }
.fx2-f2 { transform: rotateX(90deg) translateZ(calc(var(--die) / 2)); }
.fx2-f5 { transform: rotateX(-90deg) translateZ(calc(var(--die) / 2)); }
.fx2-skin-h100 { --face: linear-gradient(145deg, #59626E 0%, #2A3038 45%, #15181C 100%); --edge: #76B900; --glow: rgba(118,185,0,.55); --pip: radial-gradient(circle at 35% 35%, #E6FFB0, #9BF03A 45%, #4F8A00); --pipglow: #9BF03A; --core: #15181C; }
.fx2-skin-furnace { --face: radial-gradient(circle at 30% 25%, #FFD27A 0%, #FF8A3C 30%, #C2402A 65%, #5A1708 100%); --edge: #FFB547; --glow: rgba(255,120,40,.7); --pip: radial-gradient(circle at 35% 35%, #FFFFFF, #FFF0A0 45%, #FFB547); --pipglow: #FFE27A; --core: #5A1708; }
.fx2-skin-mahjong { --face: linear-gradient(150deg, #FFFFFF 0%, #F6F1E4 55%, #DCD5C2 100%); --edge: #2EAD6B; --glow: rgba(255,255,255,.45); --pip: radial-gradient(circle at 35% 35%, #FF7A9C, #E0245E 55%, #9A0F3A); --pipglow: rgba(224,36,94,.4); --core: #1E7A45; }
.fx2-skin-mahjong .fx2-f6 i, .fx2-skin-mahjong .fx2-f4 i { --pip: radial-gradient(circle at 35% 35%, #7BE8A8, #13A35B 55%, #0A5E33); --pipglow: rgba(19,163,91,.4); }
.fx2-skin-mahjong .fx2-f2 i, .fx2-skin-mahjong .fx2-f5 i { --pip: radial-gradient(circle at 35% 35%, #8FB2FF, #2B5BE0 55%, #142E85); --pipglow: rgba(43,91,224,.4); }
.fx2-skin-vram { --face: repeating-linear-gradient(0deg, rgba(34,229,255,.18) 0 1px, rgba(34,229,255,0) 1px 9px), repeating-linear-gradient(90deg, rgba(34,229,255,.18) 0 1px, rgba(34,229,255,0) 1px 9px), linear-gradient(145deg, #3446B8 0%, #1C2468 50%, #0C1036 100%); --edge: #22E5FF; --glow: rgba(34,229,255,.6); --pip: linear-gradient(135deg, #CFFBFF, #22E5FF 55%, #0EA5C6); --pipglow: #22E5FF; --core: #0C1036; }
.fx2-skin-vram .fx2-face i { border-radius: 18%; }
.fx2-turtle .fx2-face { --face: radial-gradient(circle at 50% 45%, #7BE8A8 0%, #2EAD6B 45%, #145C34 100%); --edge: #2EE59D; --glow: rgba(46,229,157,.6); --pip: radial-gradient(circle at 35% 35%, #fff, #E6FFE0); --pipglow: #fff; }
.fx2-dshadow { position: absolute; left: 0; top: 0; width: var(--die); height: calc(var(--die) * 0.32); margin: calc(var(--die) * -0.16) 0 0 calc(var(--die) / -2); border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.6), rgba(0,0,0,0)); }
.fx2-total { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); display: flex; align-items: baseline; gap: .12em; white-space: nowrap; font: 800 var(--fs)/1 var(--font-num); color: #fff;
  -webkit-text-stroke: calc(var(--fs) * 0.05) #1A1240; paint-order: stroke fill;
  text-shadow: 0 0 2px #22E5FF, 0 0 calc(var(--fs) * 0.25) #22E5FF, 0 0 calc(var(--fs) * 0.5) #FF3DCB; }
.fx2-total .eq { font-size: .55em; color: #FFE27A; text-shadow: 0 0 10px #FF9A3C; }
.fx2-total small { font: 800 calc(var(--fs) * 0.32)/1 var(--font-cn); color: #2EE59D; -webkit-text-stroke: 0; text-shadow: 0 0 8px #2EE59D; margin-left: .3em; }
.fx2-rocket { position: relative; display: inline-block; color: #FFE27A; text-shadow: 0 0 6px #FF5B1F, 0 0 18px #FF5B1F, 0 0 30px #FF3DCB; }
.fx2-rocket::before { content: ''; position: absolute; right: 70%; top: 18%; width: 2.6em; height: 64%; border-radius: 50%;
  background: linear-gradient(90deg, rgba(255,61,203,0) 0%, rgba(255,91,31,.55) 45%, rgba(255,200,61,.95) 85%, #fff 100%); filter: blur(4px); z-index: -1; animation: fx2-flicker .08s infinite alternate; transform-origin: right center; }
@keyframes fx2-flicker { from { transform: scaleX(1) scaleY(1); opacity: .9; } to { transform: scaleX(1.18) scaleY(.82); opacity: 1; } }
.fx2-turtleicon { position: absolute; left: 0; top: 0; width: calc(var(--die) * 1.15); height: calc(var(--die) * 1.15); margin: calc(var(--die) * -0.575) 0 0 calc(var(--die) * -0.575); filter: drop-shadow(0 0 10px rgba(46,229,157,.9)); }

/* ============ 横幅 ============ */
.fx2-banner-wrap { position: absolute; left: 0; right: 0; height: 0; display: flex; justify-content: center; align-items: center; }
.fx2-banner { position: relative; display: flex; flex-direction: column; align-items: center; padding: 10px 56px; transform: skewX(-12deg);
  background: linear-gradient(90deg, rgba(14,165,198,0) 0%, rgba(14,165,198,.92) 14%, rgba(139,92,246,.92) 86%, rgba(139,92,246,0) 100%);
  box-shadow: 0 0 0 0 transparent; white-space: nowrap; overflow: hidden; }
.fx2-banner::before, .fx2-banner::after { content: ''; position: absolute; left: 8%; right: 8%; height: 2px; background: linear-gradient(90deg, transparent, #fff, transparent); }
.fx2-banner::before { top: 0; } .fx2-banner::after { bottom: 0; }
.fx2-banner b { display: block; transform: skewX(12deg); font: 800 var(--bfs, 30px)/1.1 var(--font-num); font-family: var(--font-num), var(--font-cn); color: #fff; letter-spacing: 1px; text-shadow: 0 2px 0 rgba(0,0,0,.35), 0 0 16px rgba(255,255,255,.55); }
.fx2-banner small { display: block; transform: skewX(12deg); font: 700 14px/1.3 var(--font-cn); color: rgba(255,255,255,.92); }
.fx2-banner .shine { position: absolute; top: 0; bottom: 0; width: 30%; left: -40%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent); }
.fx2-banner--danger { background: linear-gradient(90deg, rgba(200,30,69,0) 0%, rgba(200,30,69,.94) 14%, rgba(61,90,254,.92) 86%, rgba(61,90,254,0) 100%); }
.fx2-banner--gold { background: linear-gradient(90deg, rgba(232,155,0,0) 0%, rgba(232,155,0,.96) 14%, #FFC83D 50%, rgba(232,155,0,.96) 86%, rgba(232,155,0,0) 100%); }
.fx2-banner--gold b { color: #FFFDF0; -webkit-text-stroke: 1.5px #7A4A00; paint-order: stroke fill; text-shadow: 0 3px 0 #9A6400, 0 0 18px rgba(255,255,255,.8); }
.fx2-banner--gold small { color: #3A2300; }
.fx2-banner--accent { background: linear-gradient(90deg, rgba(194,30,154,0) 0%, rgba(194,30,154,.94) 14%, rgba(255,61,203,.94) 86%, rgba(255,61,203,0) 100%); }
.fx2-banner--agi { padding: 14px 80px; }
.fx2-banner--agi b { --bfs: clamp(34px, 9vw, 64px); background: linear-gradient(180deg, #FFFFFF 0%, #FFF4C2 35%, #FFC83D 70%, #E89B00 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-stroke: 0; filter: drop-shadow(0 3px 0 #7A4A00) drop-shadow(0 0 14px rgba(255,200,61,.9)); text-shadow: none; }

/* ============ 通用 ============ */
.fx2-star { position: absolute; left: 0; top: 0; width: 26px; height: 26px; margin: -13px 0 0 -13px; background: url(/assets/fx/spark_gold.svg) center / contain no-repeat; will-change: transform, opacity; }
.fx2-star.w { background-image: url(/assets/fx/spark.svg); }
.fx2-dim { position: absolute; inset: 0; background: rgba(4,2,16,.3); }
.fx2-flash { position: absolute; inset: 0; background: #fff; mix-blend-mode: screen; }
.fx2-coin { position: absolute; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #FFF4C2 0%, #FFC83D 45%, #E08A00 100%); box-shadow: 0 0 0 2px #B86E00, 0 0 10px rgba(255,200,61,.9);
  font: 800 13px/22px var(--font-num); color: #8A5200; text-align: center; }
.fx2-hudring { position: absolute; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; border-radius: 50%; border: 3px solid var(--c, #2EE59D); box-shadow: 0 0 16px var(--c, #2EE59D), inset 0 0 12px var(--c, #2EE59D); }
.fx2-hudtext { position: absolute; left: 0; top: 0; transform: translate(-50%, -50%); font: 800 18px/1 var(--font-num); color: var(--c); -webkit-text-stroke: 3px #1A1240; paint-order: stroke fill; text-shadow: 0 0 10px var(--c); white-space: nowrap; }

/* ============ 卡牌 ============ */
.fx2-card-back { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: auto; cursor: pointer; perspective: 1100px;
  background: radial-gradient(circle at 50% 50%, rgba(10,6,30,.35) 0%, rgba(5,2,20,.72) 55%, rgba(2,1,10,.92) 100%); }
.fx2-card-back.blur { backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.fx2-card-rays { position: absolute; left: 50%; top: 50%; width: 160vmax; height: 160vmax; margin: -80vmax 0 0 -80vmax; opacity: .55;
  background: repeating-conic-gradient(from 0deg, var(--ray) 0 5deg, transparent 5deg 15deg);
  -webkit-mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.6) 25%, transparent 60%); mask: radial-gradient(circle, #000 0%, rgba(0,0,0,.6) 25%, transparent 60%); animation: fx2-spin 12s linear infinite; }
@keyframes fx2-spin { to { transform: rotate(360deg); } }
.fx2-card { position: relative; width: min(300px, 76vw); aspect-ratio: 5 / 7; transform-style: preserve-3d; }
.fx2-card-face { position: absolute; inset: 0; border-radius: 22px; backface-visibility: hidden; -webkit-backface-visibility: hidden; overflow: hidden; padding: 3px; }
.fx2-card-face::before { content: ''; position: absolute; left: 50%; top: 50%; width: 200%; height: 200%; margin: -100% 0 0 -100%; background: conic-gradient(from 0deg, var(--c1), var(--c2), #fff, var(--c1), var(--c2), var(--c1)); animation: fx2-spin 2.4s linear infinite; }
.fx2-card-inner { position: relative; width: 100%; height: 100%; border-radius: 19px; overflow: hidden; background: linear-gradient(170deg, #2A1F6E 0%, #1A1350 55%, #120C38 100%); }
.fx2-card-front { transform: rotateY(0deg); }
.fx2-card-rear { transform: rotateY(180deg); }
.fx2-card-rear .fx2-card-inner { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: radial-gradient(circle at 50% 42%, var(--c2) 0%, transparent 55%), repeating-linear-gradient(45deg, rgba(255,255,255,.05) 0 10px, transparent 10px 20px), linear-gradient(170deg, #2A1F6E, #120C38); }
.fx2-card-rear img { width: 44%; filter: drop-shadow(0 0 16px var(--c1)); }
.fx2-card-rear span { font: 800 32px/1 var(--font-cn); color: #fff; text-shadow: 0 0 14px var(--c1); letter-spacing: 6px; }
.fx2-card-front .fx2-card-inner { display: flex; flex-direction: column; align-items: center; padding: 16px 18px 14px; gap: 8px; text-align: center; }
.fx2-card-deck { align-self: stretch; padding: 5px; border-radius: 10px; font: 800 16px/1.2 var(--font-cn); letter-spacing: 4px; color: #fff; background: linear-gradient(90deg, var(--c1), var(--c2)); text-shadow: 0 1px 0 rgba(0,0,0,.3); }
.fx2-card-iconwrap { position: relative; width: 38%; aspect-ratio: 1; margin: 6px 0 2px; display: flex; align-items: center; justify-content: center; }
.fx2-card-iconwrap::before { content: ''; position: absolute; inset: -18%; border-radius: 50%; background: radial-gradient(closest-side, var(--c1), transparent); opacity: .55; animation: fx2-pulse 1s ease-in-out infinite alternate; }
.fx2-card-iconwrap img { position: relative; width: 100%; animation: fx2-pulse-img 1s ease-in-out infinite alternate; }
@keyframes fx2-pulse { from { transform: scale(.85); opacity: .35; } to { transform: scale(1.1); opacity: .8; } }
@keyframes fx2-pulse-img { from { filter: drop-shadow(0 0 4px var(--c1)); transform: scale(.97); } to { filter: drop-shadow(0 0 18px var(--c1)); transform: scale(1.04); } }
.fx2-card-title { font: 800 25px/1.2 var(--font-cn); color: #fff; text-shadow: 0 0 12px var(--c1); }
.fx2-card-title span { display: inline-block; }
.fx2-card-text { font: 500 15px/1.55 var(--font-cn); color: #D8D3FF; flex: 1; }
.fx2-card-hint { font: 500 12px/1 var(--font-cn); color: #8F88C9; }
.fx2-card--chance { --c1: #FF3DCB; --c2: #8B5CF6; --ray: rgba(255,61,203,.35); }
.fx2-card--fate { --c1: #FF5B1F; --c2: #FFB547; --ray: rgba(255,120,40,.35); }

/* ============ 监管 ============ */
.fx2-police { position: absolute; inset: 0; }
.fx2-police i { position: absolute; top: -10%; bottom: -10%; width: 55vw; opacity: 0; }
.fx2-police .l { left: -5vw; background: radial-gradient(55% 60% at 0% 50%, rgba(255,40,70,.85), rgba(255,40,70,0) 75%); }
.fx2-police .r { right: -5vw; background: radial-gradient(55% 60% at 100% 50%, rgba(61,90,254,.9), rgba(61,90,254,0) 75%); }
.fx2-police .t { left: 0; right: 0; top: 0; height: 6px; width: auto; bottom: auto; background: linear-gradient(90deg, #FF2846, #3D5AFE); opacity: 0; }

/* ============ 胜利 ============ */
.fx2-win { position: absolute; inset: 0; overflow: hidden; pointer-events: auto; }
.fx2-win-bg { position: absolute; inset: 0; background: radial-gradient(circle at 50% 42%, rgba(60,30,120,.55) 0%, rgba(5,2,20,.88) 70%); }
.fx2-win-rays { position: absolute; left: 50%; top: 40%; width: 170vmax; height: 170vmax; margin: -85vmax 0 0 -85vmax; background: repeating-conic-gradient(rgba(255,200,61,.22) 0 6deg, transparent 6deg 16deg); animation: fx2-spin 16s linear infinite;
  -webkit-mask: radial-gradient(circle, #000 0%, transparent 55%); mask: radial-gradient(circle, #000 0%, transparent 55%); }
.fx2-win-center { position: absolute; left: 50%; top: 40%; width: 0; height: 0; }
.fx2-win-halo { position: absolute; left: 0; top: 0; width: var(--av); height: var(--av); margin: calc(var(--av) * -0.5 - 14px) 0 0 calc(var(--av) * -0.5 - 14px); padding: 14px; box-sizing: content-box; border-radius: 50%;
  background: conic-gradient(#FF3DCB, #FFA94D, #FFE27A, #3DDC97, #22E5FF, #8B5CF6, #FF3DCB); animation: fx2-spin 3s linear infinite; filter: blur(6px); opacity: .9; }
.fx2-win-avatar { position: absolute; left: 0; top: 0; width: var(--av); height: var(--av); margin: calc(var(--av) * -0.5) 0 0 calc(var(--av) * -0.5); border-radius: 50%; border: 5px solid #FFC83D; box-sizing: border-box; background: #1E1650; object-fit: cover; box-shadow: 0 0 40px rgba(255,200,61,.85); }
.fx2-win-crown { position: absolute; left: 0; top: 0; width: calc(var(--av) * 0.62); margin: calc(var(--av) * -0.5 - var(--av) * 0.36) 0 0 calc(var(--av) * -0.31); filter: drop-shadow(0 0 14px rgba(255,200,61,.9)); transform-origin: 50% 100%; }
.fx2-win-text { position: absolute; left: 50%; top: calc(40% + var(--av) * 0.62); transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; white-space: nowrap; }
.fx2-win-neon { font: 800 clamp(48px, 13vw, 104px)/1 var(--font-num); letter-spacing: .08em; color: #FFF7FD;
  text-shadow: 0 0 4px #fff, 0 0 12px #FF3DCB, 0 0 26px #FF3DCB, 0 0 48px #FF3DCB, 0 0 80px #8B5CF6; -webkit-text-stroke: 1.5px #FF9AE6; }
.fx2-win-neon span { display: inline-block; }
.fx2-win-char { font: 800 clamp(18px, 4.6vw, 28px)/1.2 var(--font-cn); color: #FFE27A; text-shadow: 0 0 12px rgba(255,200,61,.8), 0 2px 0 #7A4A00; }
.fx2-win-name { font: 700 clamp(13px, 3.4vw, 17px)/1.2 var(--font-cn); color: #D8D3FF; }
.fx2-confetti { position: absolute; left: 0; top: 0; width: 10px; height: 16px; border-radius: 2px; will-change: transform; }
.fx2-confetti.rib { width: 6px; height: 26px; border-radius: 3px; }

/* ============ 调试面板（?fxdemo） ============ */
.fx2-demo { position: fixed; left: 6px; bottom: 6px; z-index: 5000; display: flex; flex-wrap: wrap; gap: 4px; max-width: min(250px, calc(100vw - 12px)); padding: 6px; border-radius: 10px; background: rgba(10,6,30,.82); border: 1px solid rgba(160,200,255,.3); pointer-events: auto; font: 600 11px/1 var(--font-cn); }
.fx2-demo button { padding: 5px 7px; border-radius: 6px; border: 1px solid rgba(34,229,255,.5); background: rgba(34,229,255,.12); color: #E8FCFF; cursor: pointer; font: inherit; }
.fx2-demo button:hover { background: rgba(34,229,255,.3); }
.fx2-demo .lab { flex-basis: 100%; color: #A9A3D9; font-size: 11px; padding: 2px; }
.fx2-demo.min button:not(.tog) { display: none; }
`;

let injected = false;
export function injectFxCss(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.dataset.fx = 'cool';
  s.textContent = CSS;
  document.head.append(s);
}
