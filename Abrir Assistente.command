#!/bin/bash
# Duplo clique no Finder: sobe o assistente em segundo plano e abre o navegador.
# A janela do Terminal fecha sozinha — o app continua rodando sem ficar à vista.
cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"

ROOT="$(pwd)"
mkdir -p "$ROOT/data"
LOG="$ROOT/data/assistente.log"
PIDFILE="$ROOT/data/assistente.pid"
PORT=3210
URL="http://127.0.0.1:${PORT}"

notify() {
  osascript -e "display notification \"$1\" with title \"Assistente de e-mail\"" 2>/dev/null || true
}

alert() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with icon stop" 2>/dev/null || true
}

close_terminal() {
  # Fecha esta janela sem perguntar; o processo do servidor já está detached.
  osascript <<'APPLESCRIPT' >/dev/null 2>&1 || true
tell application "Terminal"
  set wlist to every window whose name contains "Abrir Assistente"
  repeat with w in wlist
    try
      close w saving no
    end try
  end repeat
end tell
APPLESCRIPT
}

already_up() {
  curl -sf -o /dev/null --max-time 1 "$URL/" 2>/dev/null
}

if already_up; then
  open "$URL"
  notify "Já estava aberto — navegador atualizado. Se você atualizou o código (git pull), use Encerrar Assistente e abra de novo."
  close_terminal
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  alert "Node.js não está instalado. Instale a versão LTS em nodejs.org e tente de novo."
  open "https://nodejs.org"
  close_terminal
  exit 1
fi

MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$MAJOR" -lt 20 ]; then
  alert "Node.js $MAJOR é antigo demais. Precisa da versão 20 ou superior (LTS)."
  open "https://nodejs.org"
  close_terminal
  exit 1
fi

if [ ! -f "$ROOT/.env" ] && [ -f "$ROOT/.env.example" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

notify "Abrindo o assistente… (na 1ª vez pode levar 1–2 min)"

# Setup + servidor em background (log em data/assistente.log)
(
  set -e
  cd "$ROOT"
  echo "==== $(date -Iseconds) start ====" >>"$LOG"
  npm install >>"$LOG" 2>&1
  npm run build >>"$LOG" 2>&1
  # Detach do Terminal: nohup + setsid-like via background subshell
  nohup npm start >>"$LOG" 2>&1 &
  echo $! >"$PIDFILE"
) &

# Espera o HTTP responder (até ~3 min na 1ª instalação)
ok=0
for _ in $(seq 1 180); do
  if already_up; then ok=1; break; fi
  sleep 1
done

if [ "$ok" -eq 1 ]; then
  open "$URL"
  notify "Pronto — abra a aba do navegador."
else
  alert "Não consegui subir a tempo. Veja data/assistente.log ou peça ajuda com o CLAUDE.md."
  open -R "$LOG" 2>/dev/null || true
fi

close_terminal
exit 0
