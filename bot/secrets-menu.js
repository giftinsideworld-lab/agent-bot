/**
 * Secrets Menu — безопасное управление переменными окружения через Telegram
 *
 * Экспортируется как ESM-модуль и подключается из bot/index.js.
 *
 * Что даёт:
 *   - Команда /settings → меню «🔑 Переменные окружения»
 *   - 6 готовых пресетов с пошаговыми инструкциями (Deepgram, GitHub, Vercel,
 *     OpenRouter, Notion, OpenAI)
 *   - Custom-ключи через «✏️ Добавить свою»
 *   - Маскировка значений (показываются только последние 4 символа)
 *   - bot.api.deleteMessage для сообщений с секретами — не остаются в истории Telegram
 *   - Защита системных ключей (BOT_TOKEN, OWNER_ID, AGENT_HOME) от удаления через бот
 *   - Хранение в ~/.agent/.env (один файл, формат KEY=value)
 *
 * Адаптировано из Agent Factory templates/bot/index.js.
 * License: MIT (как и сам jarvis-architect).
 */

import { InlineKeyboard } from "grammy";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const AGENT_HOME = process.env.AGENT_HOME || "/home/agent";
const DATA_DIR = join(AGENT_HOME, ".agent");
const ENV_FILE = join(DATA_DIR, ".env");

// Системные ключи — нельзя удалять / редактировать через бот
const SYSTEM_ENV_KEYS = new Set([
  "BOT_TOKEN",
  "OWNER_ID",
  "AGENT_HOME",
]);

// Сервисы-пресеты с человеческими названиями
const ENV_SERVICES = [
  { key: "DEEPGRAM_API_KEY", label: "Deepgram (голосовые)" },
  { key: "GITHUB", label: "GitHub (репозитории)", group: "github" },
  { key: "VERCEL", label: "Vercel (деплой сайтов)", group: "vercel" },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter (доп модели)" },
  { key: "NOTION_API_KEY", label: "Notion (база знаний)" },
  { key: "OPENAI_API_KEY", label: "OpenAI (TTS, картинки)" },
];

const ENV_GROUP_KEYS = {
  github: ["GITHUB_TOKEN"],
  vercel: ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
};

// Инструкции «где взять ключ» — показываются перед запросом значения
const ENV_INSTRUCTIONS = {
  DEEPGRAM_API_KEY:
    `<b>Deepgram — голосовые сообщения</b>\n\n` +
    `Отправляешь голосовое — Агент расшифровывает и отвечает.\n\n` +
    `<a href="https://console.deepgram.com/api-keys">Открой страницу</a> → Create API Key\n\n` +
    `При регистрации $200 бесплатных кредитов без карты — хватает на сотни часов.`,

  GITHUB_TOKEN_FINE:
    `<b>GitHub — Fine-grained Token (рекомендуем)</b>\n\n` +
    `Доступ только к выбранным репозиториям.\n\n` +
    `<a href="https://github.com/settings/tokens?type=beta">Открой страницу</a> → Generate new token\n\n` +
    `Token name: <code>Agent</code>\n` +
    `Expiration: 90 дней\n` +
    `Repository access — <b>Only select repositories</b> — выбери нужные\n\n` +
    `Repository permissions:\n` +
    `<b>Contents</b>: Read and Write\n` +
    `<b>Pull requests</b>: Read and Write\n\n` +
    `Жми Generate token, скопируй (начинается с <code>github_pat_</code>) и пришли сюда.`,

  GITHUB_TOKEN_CLASSIC:
    `<b>GitHub — Classic Token</b>\n\n` +
    `Доступ ко ВСЕМ репозиториям. Проще, но менее безопасно.\n\n` +
    `<a href="https://github.com/settings/tokens/new">Открой страницу</a>\n\n` +
    `Note: <code>Agent</code>, Expiration: 90 дней\n` +
    `Scopes: <b>repo</b> (первый чекбокс)\n\n` +
    `Жми Generate token, скопируй (начинается с <code>ghp_</code>) и пришли сюда.`,

  GITHUB_TOKEN:
    `<b>GitHub — токен доступа</b>\n\n` +
    `Пришли новый токен (Fine-grained или Classic).`,

  VERCEL_TOKEN:
    `<b>Vercel — токен</b>\n\n` +
    `Доступ к Vercel API и CLI для деплоя сайтов.\n\n` +
    `<a href="https://vercel.com/account/tokens">Открой страницу</a> → Create Token\n\n` +
    `Если хочешь ограничить Агента одним проектом — добавь Project ID отдельной кнопкой.`,

  VERCEL_PROJECT_ID:
    `<b>Vercel — Project ID</b>\n\n` +
    `Если указан — Агент деплоит ТОЛЬКО в этот проект.\n\n` +
    `Где взять: vercel.com → Проект → Settings → General → Project ID\n\n` +
    `Формат: <code>prj_xxxxxxxxxxxxxxxx</code>`,

  OPENROUTER_API_KEY:
    `<b>OpenRouter — альтернативные модели</b>\n\n` +
    `Один ключ = доступ к сотням моделей: GPT, Gemini, DeepSeek, Llama.\n\n` +
    `<a href="https://openrouter.ai/keys">Открой страницу</a> → Create Key\n\n` +
    `Оплата по факту использования.`,

  NOTION_API_KEY:
    `<b>Notion — база знаний</b>\n\n` +
    `Агент сможет читать и записывать в твою базу Notion.\n\n` +
    `<a href="https://www.notion.so/profile/integrations">Открой страницу</a> → New integration\n\n` +
    `Type: Internal, дай нужные права. После — расшарь нужные страницы на эту интеграцию.\n\n` +
    `Ключ начинается с <code>secret_</code> или <code>ntn_</code>.`,

  OPENAI_API_KEY:
    `<b>OpenAI — TTS, картинки, GPT</b>\n\n` +
    `Для генерации голосовых ответов (TTS), картинок (DALL-E) и доступа к GPT.\n\n` +
    `<a href="https://platform.openai.com/api-keys">Открой страницу</a> → Create new secret key\n\n` +
    `Ключ начинается с <code>sk-</code>.`,
};

// Что сказать после успешного добавления — показывает выгоду в одну строку
const ENV_SUCCESS_MESSAGES = {
  DEEPGRAM_API_KEY: "🎤 Голосовые теперь распознаются точнее. Запиши голосовое — попробуй.",
  GITHUB_TOKEN: "🐙 GitHub подключён — могу делать push, pull, создавать репо и PR.",
  VERCEL_TOKEN: "▲ Vercel подключён — могу деплоить твои сайты в один клик.",
  VERCEL_PROJECT_ID: "▲ Project ID сохранён — деплой будет идти только в этот проект.",
  OPENROUTER_API_KEY: "🧠 OpenRouter подключён — попроси «используй gpt-4o» или другую модель.",
  NOTION_API_KEY: "📚 Notion подключён — могу читать и записывать в твою базу.",
  OPENAI_API_KEY: "🎨 OpenAI подключён — доступны TTS, картинки и GPT-модели.",
};

// ─── ENV FILE I/O ────────────────────────────────────────────────────────────

export function loadEnvVars() {
  if (!existsSync(ENV_FILE)) return {};
  const vars = {};
  const content = readFileSync(ENV_FILE, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function saveEnvVar(key, value) {
  const vars = loadEnvVars();
  vars[key] = value;
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(ENV_FILE, content + "\n", { mode: 0o600 });
  process.env[key] = value;
}

function deleteEnvVar(key) {
  const vars = loadEnvVars();
  delete vars[key];
  const content = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(ENV_FILE, content + "\n", { mode: 0o600 });
  delete process.env[key];
}

// ─── KEYBOARD BUILDERS ──────────────────────────────────────────────────────

function envKeyboard() {
  const vars = loadEnvVars();
  const kb = new InlineKeyboard();

  for (const svc of ENV_SERVICES) {
    let connected;
    if (svc.group && ENV_GROUP_KEYS[svc.group]) {
      connected = ENV_GROUP_KEYS[svc.group].some((k) => vars[k] || process.env[k]);
    } else {
      connected = !!(vars[svc.key] || process.env[svc.key]);
    }
    const emoji = connected ? "☑️" : "➕";
    const cb = svc.group ? `env_group_${svc.group}` : `env_quick_${svc.key}`;
    kb.text(`${emoji} ${svc.label}`, cb).row();
  }

  // Кастомные ключи (вне пресетов и системных)
  const presetKeys = new Set();
  for (const svc of ENV_SERVICES) {
    if (svc.group && ENV_GROUP_KEYS[svc.group]) {
      for (const k of ENV_GROUP_KEYS[svc.group]) presetKeys.add(k);
    } else {
      presetKeys.add(svc.key);
    }
  }
  const customKeys = Object.keys(vars).filter(
    (k) => !SYSTEM_ENV_KEYS.has(k) && !presetKeys.has(k)
  );
  for (const key of customKeys) {
    kb.text(`🗑 ${key}`, `env_del_${key}`).row();
  }

  kb.text("✏️ Добавить свою", "env_add_custom").row();
  kb.text("✖ Закрыть", "env_close");
  return kb;
}

function envGroupKeyboard(group) {
  const vars = loadEnvVars();
  const keys = ENV_GROUP_KEYS[group] || [];
  const kb = new InlineKeyboard();
  for (const key of keys) {
    const has = !!(vars[key] || process.env[key]);
    const shortLabel = key.replace(/^(VERCEL_|GITHUB_|SUPABASE_)/, "");
    if (has) {
      kb.text(`${shortLabel} ☑️`, `env_del_${key}`).row();
    } else {
      kb.text(`➕ ${shortLabel}`, `env_quick_${key}`).row();
    }
  }
  kb.text("← Назад", "settings_env");
  return kb;
}

function envGithubChoiceKeyboard() {
  const vars = loadEnvVars();
  const has = !!(vars.GITHUB_TOKEN || process.env.GITHUB_TOKEN);
  const kb = new InlineKeyboard();
  if (has) {
    kb.text("Заменить токен", "env_quick_GITHUB_TOKEN").row();
    kb.text("Удалить токен", "env_del_GITHUB_TOKEN").row();
  } else {
    kb.text("➕ Fine-grained (рекомендуем)", "env_quick_GITHUB_TOKEN_FINE").row();
    kb.text("➕ Classic", "env_quick_GITHUB_TOKEN_CLASSIC").row();
  }
  kb.text("← Назад", "settings_env");
  return kb;
}

// ─── PENDING INPUT (после нажатия кнопки бот ждёт значение) ──────────────────

const pendingInput = new Map(); // userId → { type: "env_quick", key } | { type: "env_add" }

// Вызывается из bot.on("message:text") ДО основного callClaude.
// Возвращает true, если сообщение было перехвачено как ввод секрета (тогда не передаём в Claude).
export async function handlePendingInput(ctx) {
  const userId = String(ctx.from?.id || "");
  if (!pendingInput.has(userId)) return false;

  const pending = pendingInput.get(userId);
  pendingInput.delete(userId);

  const text = ctx.message.text?.trim() || "";
  const userMessageId = ctx.message.message_id;

  // СРАЗУ удаляем сообщение пользователя — чтобы секрет не остался в истории Telegram
  try {
    await ctx.api.deleteMessage(ctx.chat.id, userMessageId);
  } catch (e) {
    console.warn("[secrets-menu] couldn't delete user message:", e.message);
  }

  if (pending.type === "env_quick") {
    let key = pending.key;
    // Спецслучаи GitHub: преобразуем виртуальные ключи в реальный GITHUB_TOKEN
    if (key === "GITHUB_TOKEN_FINE" || key === "GITHUB_TOKEN_CLASSIC") {
      key = "GITHUB_TOKEN";
    }

    if (SYSTEM_ENV_KEYS.has(key)) {
      await ctx.reply("❌ Этот ключ системный, через бот менять нельзя.");
      return true;
    }

    saveEnvVar(key, text);
    const success = ENV_SUCCESS_MESSAGES[key] || `✅ ${key} сохранён.`;
    await ctx.reply(`${success}\n\n<i>Сообщение с ключом удалено из чата.</i>`, {
      parse_mode: "HTML",
    });
    return true;
  }

  if (pending.type === "env_add") {
    const m = text.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (!m) {
      await ctx.reply(
        "❌ Не понял формат. Нужно <code>KEY=value</code>, где KEY — большие буквы и подчёркивания.\n\n" +
        "Например: <code>NOTION_API_KEY=secret_xxx</code>",
        { parse_mode: "HTML" }
      );
      return true;
    }

    const key = m[1];
    const value = m[2].trim();

    if (SYSTEM_ENV_KEYS.has(key)) {
      await ctx.reply("❌ Этот ключ системный, через бот менять нельзя.");
      return true;
    }

    saveEnvVar(key, value);
    await ctx.reply(
      `✅ <code>${key}</code> сохранён.\n\n<i>Сообщение с ключом удалено из чата.</i>`,
      { parse_mode: "HTML" }
    );
    return true;
  }

  return false;
}

// ─── HANDLERS REGISTRATION ──────────────────────────────────────────────────

/**
 * Регистрирует команды и callback-обработчики меню секретов.
 * Вызывается из bot/index.js один раз при инициализации.
 *
 * @param {Bot} bot — инстанс grammy Bot
 * @param {(ctx) => boolean} isOwner — функция-проверка владельца
 * @param {Keyboard} mainKeyboard — основная persistent-клавиатура (для ответов после действий)
 */
export function registerSecretsHandlers(bot, isOwner) {
  // NOTE: /settings command is now in index.js (full settings menu).
  // This module only registers env-related callbacks.

  // settings_env — открытие меню env (из settings callback)
  bot.callbackQuery("settings_env", async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      await ctx.editMessageText(
        "<b>🔑 Переменные окружения</b>\n\nПодключи сервисы — Агент станет мощнее:",
        { parse_mode: "HTML", reply_markup: envKeyboard() }
      );
    } catch {
      await ctx.reply("<b>🔑 Переменные окружения</b>", {
        parse_mode: "HTML",
        reply_markup: envKeyboard(),
      });
    }
  });

  // env_close — закрыть меню
  bot.callbackQuery("env_close", async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      await ctx.deleteMessage();
    } catch {}
  });

  // env_group_<name> — открыть подменю группы (Vercel, GitHub, Supabase)
  bot.callbackQuery(/^env_group_(.+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const group = ctx.match[1];

    // Спецслучай GitHub: показываем выбор Fine-grained/Classic
    if (group === "github") {
      await ctx.editMessageText(
        "<b>🐙 GitHub</b>\n\nВыбери тип токена:",
        { parse_mode: "HTML", reply_markup: envGithubChoiceKeyboard() }
      );
      return;
    }

    const labelMap = { vercel: "▲ Vercel", supabase: "🗄️ Supabase" };
    const title = labelMap[group] || group;
    await ctx.editMessageText(
      `<b>${title}</b>\n\nДобавь нужные ключи:`,
      { parse_mode: "HTML", reply_markup: envGroupKeyboard(group) }
    );
  });

  // env_quick_<KEY> — запросить ввод значения для конкретного ключа
  bot.callbackQuery(/^env_quick_(.+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const key = ctx.match[1];
    const userId = String(ctx.from.id);

    pendingInput.set(userId, { type: "env_quick", key });

    const instruction = ENV_INSTRUCTIONS[key]
      || `<b>${key}</b>\n\nПришли значение в следующем сообщении.`;

    try {
      await ctx.editMessageText(
        instruction + "\n\n<i>⚠️ Пришли значение следующим сообщением. " +
        "Я его сразу удалю из чата, чтобы секрет нигде не остался.</i>",
        {
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
          reply_markup: new InlineKeyboard().text("✖ Отмена", "env_cancel"),
        }
      );
    } catch {
      await ctx.reply(instruction, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  });

  // env_add_custom — режим добавления своей переменной
  bot.callbackQuery("env_add_custom", async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const userId = String(ctx.from.id);
    pendingInput.set(userId, { type: "env_add" });

    try {
      await ctx.editMessageText(
        "Пришли переменную в формате:\n<code>KEY=value</code>\n\n" +
        "Например:\n<code>STRIPE_API_KEY=sk_test_xxx</code>\n\n" +
        "<i>⚠️ Я сразу удалю твоё сообщение, чтобы секрет не остался в чате.</i>",
        {
          parse_mode: "HTML",
          reply_markup: new InlineKeyboard().text("✖ Отмена", "env_cancel"),
        }
      );
    } catch {
      await ctx.reply("Пришли в формате <code>KEY=value</code>", { parse_mode: "HTML" });
    }
  });

  // env_cancel — отмена режима ввода
  bot.callbackQuery("env_cancel", async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery("Отменено");
    const userId = String(ctx.from.id);
    pendingInput.delete(userId);
    try {
      await ctx.editMessageText("<b>🔑 Переменные окружения</b>", {
        parse_mode: "HTML",
        reply_markup: envKeyboard(),
      });
    } catch {}
  });

  // env_del_<KEY> — удалить ключ
  bot.callbackQuery(/^env_del_(.+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const key = ctx.match[1];

    if (SYSTEM_ENV_KEYS.has(key)) {
      await ctx.answerCallbackQuery("Системный ключ — нельзя удалить");
      return;
    }

    deleteEnvVar(key);
    await ctx.answerCallbackQuery(`${key} удалён`);
    try {
      await ctx.editMessageText(
        `<b>🔑 Переменные окружения</b>\n\n<i>${key} удалён.</i>`,
        { parse_mode: "HTML", reply_markup: envKeyboard() }
      );
    } catch {}
  });
}
