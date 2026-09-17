/**
 * Voice Helper — интерактивная подсказка при первом голосовом без распознавалки
 *
 * Когда ученик впервые шлёт голосовое и ни Deepgram, ни Whisper не подключены —
 * вместо сухого «Не удалось распознать» показываем меню с двумя кнопками:
 *   ➕ Deepgram (рекомендуем) — ведёт в /settings пресет (5 минут, $200 кредитов)
 *   🔧 Установить Whisper       — короткая инструкция для VS Code Tunnel (бесплатно)
 *
 * Кнопка Deepgram использует существующий callback `env_quick_DEEPGRAM_API_KEY`
 * из secrets-menu.js — UX полностью переиспользуется (инструкция + удаление сообщения).
 *
 * Адаптировано из Agent Factory templates/bot/index.js (упрощённая версия:
 * без auto-install Whisper — у некоторых учеников нет sudo).
 */

import { InlineKeyboard } from "grammy";
import { execSync } from "node:child_process";

// Проверка — есть ли локальный whisper в PATH
export function hasWhisperInstalled() {
  try {
    execSync("which whisper", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Проверка — настроена ли хоть одна распознавалка
export function hasAnyTranscriber() {
  return !!process.env.DEEPGRAM_API_KEY || hasWhisperInstalled();
}

// Клавиатура с двумя кнопками для первого голосового без ключа
export function voiceFallbackKeyboard() {
  return new InlineKeyboard()
    .text("➕ Deepgram (рекомендуем)", "env_quick_DEEPGRAM_API_KEY").row()
    .text("🔧 Установить Whisper", "voice_install_whisper");
}

// Текст-приглашение к выбору
export const VOICE_FALLBACK_PROMPT =
  "🎤 Услышал голосовое, но распознавание ещё не настроено.\n\n" +
  "Выбери один из вариантов:\n\n" +
  "<b>Deepgram</b> — облачное распознавание, точное и быстрое. " +
  "$200 кредитов без карты при регистрации (~770 часов на русском).\n\n" +
  "<b>Whisper</b> — локальная установка на твой сервер. Бесплатно, " +
  "но в 3-5 раз медленнее и требует ~8 минут на установку.";

// Инструкция по установке Whisper через VS Code Tunnel
const WHISPER_INSTRUCTIONS =
  "🔧 <b>Установка Whisper</b> (~8 минут)\n\n" +
  "1. Открой VS Code на ноуте → Remote Explorer → Tunnels → твой сервер\n" +
  "2. В терминале сервера выполни одной строкой:\n\n" +
  "<code>sudo apt install -y ffmpeg && sudo -H pip install --break-system-packages openai-whisper</code>\n\n" +
  "3. Когда установка закончится — отправь мне голосовое снова. Подхвачу автоматически.\n\n" +
  "<i>Если sudo нет — спроси у провайдера VPS пароль root либо подключи Deepgram (быстрее).</i>";

export function registerVoiceHelpers(bot, isOwner) {
  bot.callbackQuery("voice_install_whisper", async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();

    try {
      await ctx.editMessageText(WHISPER_INSTRUCTIONS, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    } catch {
      await ctx.reply(WHISPER_INSTRUCTIONS, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  });
}
