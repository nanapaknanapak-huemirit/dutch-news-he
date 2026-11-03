import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { escapeHtml, truncateAtWord } from './lib/text.mjs';
import { loadJson, saveJson } from './lib/state.mjs';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'dutch-news-he');
export const ENV_FILE = path.join(CONFIG_DIR, 'notify.env');

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function loadNotifyEnv() {
  return parseEnvFile(ENV_FILE);
}

export function loadTelegramConfig() {
  const file = parseEnvFile(ENV_FILE);
  const token = process.env.TELEGRAM_BOT_TOKEN || file.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || file.TELEGRAM_CHAT_ID || '';
  return { token, chatId, configured: Boolean(token && chatId) };
}

function buildMessage({ edition, newCount, headlines, siteUrl }) {
  const lines = [`חדשות הולנד — מהדורת ${edition}`, `${newCount} עדכונים חדשים`, ''];
  for (const title of headlines.slice(0, 5)) lines.push(`• ${title}`);
  const plain = truncateAtWord(lines.join('\n'), 800);
  return `${escapeHtml(plain)}\n\n<a href="${escapeHtml(siteUrl)}">פתחו את האתר</a>`;
}

async function telegramRequest(token, method, body, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && data.ok === true, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function notifyEdition({
  edition,
  newCount,
  headlines,
  audioPath,
  siteUrl,
  force = false,
  log,
  stateFile = path.join(process.cwd(), 'data', 'notify.json'),
}) {
  const config = loadTelegramConfig();
  if (!config.configured) {
    log?.('info', 'telegram not configured; skipping push');
    return { sent: false, reason: 'not-configured' };
  }

  const state = loadJson(stateFile, { version: 1, lastEdition: null, sentAt: null });
  if (!force && state.lastEdition === edition) {
    log?.('info', `telegram already sent for edition ${edition}; skipping`);
    return { sent: false, reason: 'already-sent' };
  }

  const caption = buildMessage({ edition, newCount, headlines, siteUrl });
  let sent = false;
  let error = null;

  if (audioPath && fs.existsSync(audioPath) && fs.statSync(audioPath).size > 1000) {
    try {
      const form = new FormData();
      form.append('chat_id', config.chatId);
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
      form.append('title', `חדשות הולנד — ${edition}`);
      form.append('performer', 'חדשות הולנד');
      form.append('audio', new Blob([fs.readFileSync(audioPath)], { type: 'audio/mpeg' }), path.basename(audioPath));
      const result = await telegramRequest(config.token, 'sendAudio', form);
      sent = result.ok;
      if (!sent) error = `sendAudio HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`;
    } catch (audioError) {
      error = `sendAudio failed: ${audioError.message}`;
    }
  }

  if (!sent) {
    try {
      const form = new FormData();
      form.append('chat_id', config.chatId);
      form.append('text', caption);
      form.append('parse_mode', 'HTML');
      form.append('disable_web_page_preview', 'false');
      const result = await telegramRequest(config.token, 'sendMessage', form);
      sent = result.ok;
      if (!sent) error = `${error ? `${error}; ` : ''}sendMessage HTTP ${result.status}: ${JSON.stringify(result.data).slice(0, 200)}`;
    } catch (messageError) {
      error = `${error ? `${error}; ` : ''}sendMessage failed: ${messageError.message}`;
    }
  }

  if (sent) {
    saveJson(stateFile, { version: 1, lastEdition: edition, sentAt: new Date().toISOString(), error: null });
    log?.('info', `telegram push sent for edition ${edition}`);
    return { sent: true };
  }

  saveJson(stateFile, { ...state, lastAttemptAt: new Date().toISOString(), error });
  log?.('warn', `telegram push failed: ${error}`);
  return { sent: false, reason: 'failed', error };
}
