#!/bin/bash
# Обновление бота из этого репозитория.
# Отличие от исходной версии: синтаксис проверяется ДО замены, делается
# резервная копия, при неудачном старте выполняется автоматический откат.
set -uo pipefail

REPO_RAW="https://raw.githubusercontent.com/giftinsideworld-lab/agent-bot/main/bot"
BOT_DIR="/home/agent/.agent/bot"
BACKUP_DIR="/home/agent/.agent/bot-backup"
TMP=$(mktemp -d)

FILES="index.js secrets-menu.js voice-helper.js package.json VERSION update-bot.sh agent-bot.service
lib/db.js lib/embeddings.js lib/memory-indexer.js lib/memory-search.js lib/claude-oauth.js lib/env-write.js
scripts/manage-schedule.js scripts/memory-search.js scripts/reindex.js
migrations/001_memory_index.sql"

echo "=== Обновление бота ==="

for f in $FILES; do
  mkdir -p "$TMP/$(dirname "$f")"
  if ! curl -fsSL "$REPO_RAW/$f" -o "$TMP/$f"; then
    echo "[ОШИБКА] Не скачался $f — обновление отменено, бот не тронут"
    exit 1
  fi
done

if ! node --check "$TMP/index.js"; then
  echo "[ОШИБКА] В новой версии ошибка синтаксиса — обновление отменено, бот не тронут"
  exit 1
fi

OLD_VER=$(cat "$BOT_DIR/VERSION" 2>/dev/null || echo "неизвестна")
NEW_VER=$(cat "$TMP/VERSION" 2>/dev/null || echo "неизвестна")
echo "Версия: $OLD_VER → $NEW_VER"

[ -d "$BACKUP_DIR" ] && find "$BACKUP_DIR" -mindepth 1 -delete
mkdir -p "$BACKUP_DIR"
cp -a "$BOT_DIR/." "$BACKUP_DIR/"
echo "Резервная копия: $BACKUP_DIR"

cp -a "$TMP/." "$BOT_DIR/"
chmod +x "$BOT_DIR/update-bot.sh"

if ! diff -q "$BACKUP_DIR/package.json" "$BOT_DIR/package.json" >/dev/null 2>&1; then
  echo "Обновляю зависимости..."
  (cd "$BOT_DIR" && npm install --omit=dev >/dev/null 2>&1) || echo "[ВНИМАНИЕ] npm install завершился с ошибкой"
fi

chown -R agent:agent "$BOT_DIR"

systemctl restart agent-bot
sleep 6

if systemctl is-active --quiet agent-bot; then
  echo "=== Готово. Бот работает, версия $NEW_VER ==="
else
  echo "[ОШИБКА] Бот не поднялся — откатываюсь на предыдущую версию"
  cp -a "$BACKUP_DIR/." "$BOT_DIR/"
  chown -R agent:agent "$BOT_DIR"
  systemctl restart agent-bot
  echo "=== Откат выполнен, версия $OLD_VER ==="
  exit 1
fi
