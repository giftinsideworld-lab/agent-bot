#!/bin/bash
# install.sh — установка Telegram-бота Агента на чистый сервер Ubuntu.
#
# Запуск на сервере под root:
#   curl -fsSL https://raw.githubusercontent.com/giftinsideworld-lab/agent-bot/main/install.sh | bash -s -- <ТОКЕН_БОТА>
#
# Что делает:
#   1. Ставит базовые пакеты, Node.js (если нет), Claude Code CLI, VS Code CLI
#   2. Создаёт пользователя agent и рабочие папки
#   3. Отключает IPv6 (известная причина зависаний Node.js на части хостингов)
#   4. Скачивает код бота, ставит зависимости, регистрирует systemd-сервис
#   5. НЕ запускает бота — сначала нужно авторизовать Claude (инструкция в конце)
set -uo pipefail

BOT_TOKEN="${1:-}"
REPO_RAW="https://raw.githubusercontent.com/giftinsideworld-lab/agent-bot/main/bot"
AGENT_HOME="/home/agent"
BOT_DIR="$AGENT_HOME/.agent/bot"

log() { echo "[установка] $*"; }
fail() { echo "[ОШИБКА] $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Запускать под root"
[ -n "$BOT_TOKEN" ] || fail "Не указан токен бота. Получить: @BotFather в Telegram → /newbot"

log "1/7 Базовые пакеты"
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl git jq unzip rsync tmux >/dev/null 2>&1

log "2/7 Node.js"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null 2>&1
fi
command -v node >/dev/null 2>&1 || fail "Node.js не установился"
log "    Node.js $(node -v)"

log "3/7 Claude Code CLI"
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code >/dev/null 2>&1
fi
command -v claude >/dev/null 2>&1 || fail "Claude Code CLI не установился"
log "    $(claude --version 2>/dev/null || echo claude)"

log "4/7 VS Code CLI (для туннеля)"
if ! command -v code >/dev/null 2>&1; then
  curl -fsSL "https://code.visualstudio.com/sha/download?build=stable&os=cli-alpine-x64" -o /tmp/vscode.tar.gz \
    && tar -xzf /tmp/vscode.tar.gz -C /usr/local/bin/ && rm -f /tmp/vscode.tar.gz
fi

log "5/7 Пользователь agent и рабочие папки"
id agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent
mkdir -p "$AGENT_HOME/workspace/memory" "$AGENT_HOME/workspace/knowledge" \
         "$AGENT_HOME/projects" "$BOT_DIR" "$AGENT_HOME/.claude/skills"
CLAUDE_REAL=$(readlink -f "$(command -v claude)")
chmod -R a+rX "$(dirname "$CLAUDE_REAL")" 2>/dev/null
chmod -R a+rX "$(dirname "$(dirname "$CLAUDE_REAL")")" 2>/dev/null
sysctl -w net.ipv6.conf.all.disable_ipv6=1 >/dev/null 2>&1
sysctl -w net.ipv6.conf.default.disable_ipv6=1 >/dev/null 2>&1

log "6/7 Код бота"
FILES="index.js secrets-menu.js voice-helper.js package.json VERSION update-bot.sh agent-bot.service
lib/db.js lib/embeddings.js lib/memory-indexer.js lib/memory-search.js lib/claude-oauth.js lib/env-write.js
scripts/manage-schedule.js scripts/memory-search.js scripts/reindex.js
migrations/001_memory_index.sql"
for f in $FILES; do
  mkdir -p "$BOT_DIR/$(dirname "$f")"
  curl -fsSL "$REPO_RAW/$f" -o "$BOT_DIR/$f" || fail "Не скачался $f"
done
chmod +x "$BOT_DIR/update-bot.sh"
(cd "$BOT_DIR" && npm install --omit=dev >/dev/null 2>&1) || fail "Не установились зависимости"

printf 'BOT_TOKEN=%s\nAGENT_HOME=%s\n' "$BOT_TOKEN" "$AGENT_HOME" > "$AGENT_HOME/.agent/.env"
chmod 600 "$AGENT_HOME/.agent/.env"
chown -R agent:agent "$AGENT_HOME"

log "7/7 Системный сервис"
cp "$BOT_DIR/agent-bot.service" /etc/systemd/system/agent-bot.service
systemctl daemon-reload
systemctl enable agent-bot >/dev/null 2>&1

cat <<'FINAL'

═══════════════════════════════════════════════════════════════
  Установка завершена. Остался один шаг — он делается вручную.
═══════════════════════════════════════════════════════════════

Нужно авторизовать Claude под вашей подпиской. Программно это
сделать нельзя: интерфейс Claude принимает только живое нажатие
клавиши. Зато есть надёжный способ — через tmux.

На сервере выполните по очереди:

    sudo -u agent -H tmux new-session -d -s login -x 200 -y 50 claude
    sleep 12
    sudo -u agent -H tmux send-keys -t login Enter      # тема оформления
    sleep 6
    sudo -u agent -H tmux send-keys -t login Enter      # способ входа
    sleep 6
    sudo -u agent -H tmux capture-pane -t login -p | tail -20

В выводе появится ссылка вида https://claude.com/cai/oauth/...
Откройте её в браузере, нажмите Authorize, скопируйте код и отправьте:

    sudo -u agent -H tmux send-keys -t login -l "ВСТАВЬТЕ_КОД"
    sudo -u agent -H tmux send-keys -t login Enter
    sleep 15
    sudo -u agent -H tmux capture-pane -t login -p | tail -5

Должно появиться "Login successful". Затем:

    sudo -u agent -H tmux kill-server
    systemctl start agent-bot
    systemctl status agent-bot --no-pager

Готово. Напишите боту /start — первым, кто это сделает, он и
будет управляться, остальных он игнорирует.

FINAL
