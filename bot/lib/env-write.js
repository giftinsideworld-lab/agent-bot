// Локальный safe_env_write для user-бота.
// Портировано из bash-helpers provisioner/bot.js:276-374 (ENV_WRITE_HELPERS).
//
// Отличия от bash-версии:
//  - не работает с chattr +i (наш .env не immutable)
//  - не использует python3 fallback (всё на Node fs)
//  - атомарность через writeFile в .tmp + rename
//
// Формат записи: KEY="VALUE" (двойные кавычки) — совместимо и с bash `source`,
// и с systemd EnvironmentFile.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, chmodSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

function escapeValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function ensureDir(file) {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readLines(file) {
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, "utf8");
  if (raw === "") return [];
  const lines = raw.split("\n");
  // если файл заканчивался \n, split даст пустой хвостовой элемент — убираем
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function atomicWrite(file, content) {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, content, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
    chmodSync(file, 0o600);
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
}

/**
 * Записать/обновить переменную KEY в .env файле атомарно.
 * Удаляет все существующие строки начинающиеся с `KEY=` и добавляет одну новую.
 *
 * @param {string} file - абсолютный путь к .env
 * @param {string} key  - имя переменной (без =)
 * @param {string} value - значение (будет обёрнуто в двойные кавычки с экранированием)
 * @returns {void} - бросает Error при невозможности записать
 */
export function safeEnvWrite(file, key, value) {
  if (!file || !key) throw new Error("safeEnvWrite: file and key required");
  ensureDir(file);
  const lines = readLines(file).filter((l) => !l.startsWith(`${key}=`));
  lines.push(`${key}="${escapeValue(value)}"`);
  atomicWrite(file, lines.join("\n") + "\n");
}

/**
 * Удалить все строки с переменной KEY из .env файла атомарно.
 * Если файла нет или ключа нет — no-op (без ошибки).
 *
 * @param {string} file - абсолютный путь к .env
 * @param {string} key  - имя переменной
 */
export function safeEnvRemove(file, key) {
  if (!file || !key) throw new Error("safeEnvRemove: file and key required");
  if (!existsSync(file)) return;
  const lines = readLines(file).filter((l) => !l.startsWith(`${key}=`));
  atomicWrite(file, lines.length === 0 ? "" : lines.join("\n") + "\n");
}

/**
 * Прочитать значение переменной из .env (последнее вхождение если несколько).
 * Раздевает двойные кавычки если они есть.
 *
 * @param {string} file
 * @param {string} key
 * @returns {string|null}
 */
export function safeEnvRead(file, key) {
  if (!existsSync(file)) return null;
  const lines = readLines(file);
  let val = null;
  for (const line of lines) {
    if (!line.startsWith(`${key}=`)) continue;
    let raw = line.slice(key.length + 1);
    if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    val = raw;
  }
  return val;
}
