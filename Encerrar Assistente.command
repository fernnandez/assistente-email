#!/bin/bash
# Duplo clique para parar o assistente que está em segundo plano.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

ROOT="$(pwd)"
PIDFILE="$ROOT/data/assistente.pid"
PORT=3210

notify() {
  osascript -e "display notification \"$1\" with title \"Assistente de e-mail\"" 2>/dev/null || true
}

# Mata quem estiver na porta 3210 (servidor Node)
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  lsof -ti:"$PORT" | xargs kill 2>/dev/null || true
  sleep 0.4
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
fi

# PID gravado pelo Abrir (às vezes é o shell do npm — a porta já cuida do Node)
if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  rm -f "$PIDFILE"
fi

notify "Assistente encerrado."

osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "Terminal"
  set wlist to every window whose name contains "Encerrar Assistente"
  repeat with w in wlist
    try
      close w saving no
    end try
  end repeat
end tell
APPLESCRIPT
exit 0
