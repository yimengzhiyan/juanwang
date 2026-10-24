#!/usr/bin/env bash
# 守护：每 20 秒检查游戏服务，挂了就拉起（不动隧道，地址不变）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; RUN="$HOME/juanwang-run"; PORT="${PORT:-3000}"
while true; do
  if ! curl -sf "http://localhost:$PORT/healthz" >/dev/null; then
    echo "$(date '+%F %T') 服务无响应，重启" >>"$RUN/watchdog.log"
    pkill -f "[n]ode $ROOT/server/dist/index.js" 2>/dev/null; pkill -f "[n]ode server/dist/index.js" 2>/dev/null; sleep 1
    (cd "$ROOT" && PORT="$PORT" TRUST_PROXY=1 setsid -f nohup node "$ROOT/server/dist/index.js" >>"$RUN/server.log" 2>&1 </dev/null)
  fi
  if ! pgrep -f "[c]loudflared tunnel" >/dev/null; then echo "$(date '+%F %T') 隧道进程不在！需人工处理" >>"$RUN/watchdog.log"; fi
  sleep 20
done
