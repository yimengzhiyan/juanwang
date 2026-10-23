#!/usr/bin/env bash
# 在服务器上常驻启动《卷王自走棋》，并用 Cloudflare 免费隧道暴露成公网 https 网址。
# 用法：scripts/public.sh start | stop | status | url | restart
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$HOME/juanwang-run"; mkdir -p "$RUN"
PORT="${PORT:-3000}"
CF="${CLOUDFLARED:-$HOME/bin/cloudflared}"
ENTRY="$ROOT/server/dist/index.js"

start_server() {
  if curl -sf "http://localhost:$PORT/healthz" >/dev/null; then echo "游戏服务已在运行"; return; fi
  [ -f "$ENTRY" ] || { echo "未找到构建产物，先执行 npm run build"; exit 1; }
  (cd "$ROOT" && PORT="$PORT" TRUST_PROXY=1 setsid -f nohup node "$ENTRY" >"$RUN/server.log" 2>&1 </dev/null; disown -a 2>/dev/null) || true
  for i in $(seq 1 20); do sleep 0.5; curl -sf "http://localhost:$PORT/healthz" >/dev/null && { echo "游戏服务已启动（端口 $PORT）"; return; }; done
  echo "游戏服务启动失败，日志：$RUN/server.log"; tail -20 "$RUN/server.log"; exit 1
}
start_tunnel() {
  if pgrep -f "[c]loudflared tunnel --url http://localhost:$PORT" >/dev/null; then url; return; fi
  : >"$RUN/tunnel.log"
  (setsid -f nohup "$CF" tunnel --url "http://localhost:$PORT" --no-autoupdate --protocol http2 >"$RUN/tunnel.log" 2>&1 </dev/null &)
  for i in $(seq 1 40); do sleep 0.5; u="$(url)"; [ -n "$u" ] && { echo "$u"; return; }; done
  echo "隧道启动超时，日志：$RUN/tunnel.log"; tail -20 "$RUN/tunnel.log"; exit 1
}
url() { grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$RUN/tunnel.log" 2>/dev/null | head -1; }
stop_all() { pkill -f "[c]loudflared tunnel --url http://localhost:$PORT"; pkill -f "server/dist/index.js"; echo "已停止"; }
case "${1:-start}" in
  start)
    start_server; U="$(start_tunnel | tail -1)"; echo "$U" >"$RUN/public_url.txt"
    echo; echo "========== 公网地址（手机 / 电脑直接打开） =========="; echo "$U"; echo ;;
  stop) stop_all ;;
  restart) stop_all; sleep 1; "$0" start ;;
  status) curl -sf "http://localhost:$PORT/healthz" >/dev/null && echo "游戏服务：运行中（端口 $PORT）" || echo "游戏服务：未运行"
          pgrep -f "[c]loudflared tunnel" >/dev/null && echo "隧道：运行中  $(url)" || echo "隧道：未运行" ;;
  url) url ;;
  *) echo "用法: $0 start|stop|restart|status|url" ;;
esac
