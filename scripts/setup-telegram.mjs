import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CONFIG_DIR, ENV_FILE } from './notify.mjs';
import { detectSiteUrl } from './qr.mjs';

function askHidden(prompt) {
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      stdout.write(prompt);
      stdin.setEncoding('utf8');
      stdin.once('data', (value) => resolve(String(value).trim()));
      stdin.resume();
    });
  }
  return new Promise((resolve) => {
    stdout.write(prompt);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdin.off('data', onData);
    };
    const onData = (chunk) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value.replace(/\x1b\[20[01]~/g, '').trim());
          return;
        }
        if (char === '\u0003') {
          cleanup();
          stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function api(token, method, params, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = params
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) }
      : { method: 'GET' };
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      ...init,
      signal: controller.signal,
    });
    return await response.json().catch(() => ({ ok: false, description: `HTTP ${response.status}` }));
  } catch (error) {
    return { ok: false, description: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function fail(message) {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

function latestBulletin(root) {
  const dir = path.join(root, 'site', 'audio');
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^edition-\d{4}-\d{2}-\d{2}\.mp3$/.test(name))
    .sort();
  return files.length ? path.join(dir, files[files.length - 1]) : null;
}

async function pollChatId(token) {
  stdout.write('Open Telegram, send any message to your bot, then wait');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    stdout.write('.');
    const result = await api(token, 'getUpdates', null);
    if (result.ok && Array.isArray(result.result)) {
      const messages = result.result
        .map((update) => update.message || update.channel_post || update.edited_message)
        .filter(Boolean);
      if (messages.length) {
        const last = messages[messages.length - 1];
        stdout.write('\n');
        return String(last.chat.id);
      }
    }
    if (result.description && /webhook/i.test(result.description)) {
      throw new Error('The bot has a webhook configured; remove it with deleteWebhook and try again');
    }
    await sleep(3000);
  }
  throw new Error('No message received. Send /start to the bot and run this script again.');
}

async function main() {
  const root = process.cwd();
  console.log('Telegram setup for the daily Dutch news edition\n');

  if (fs.existsSync(ENV_FILE) && !process.argv.includes('--force')) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = (await rl.question('A configuration already exists. Overwrite it? [y/N] ')).trim();
    rl.close();
    if (!/^y(es)?$/i.test(answer)) {
      console.log('Keeping the existing configuration.');
      return;
    }
  }

  console.log('Create a bot with @BotFather in Telegram, then paste its token.');
  const token = await askHidden('Bot token (hidden): ');
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) fail('That does not look like a Telegram bot token.');

  const me = await api(token, 'getMe');
  if (!me.ok) fail(`Telegram rejected the token: ${me.description || 'unknown error'}`);
  console.log(`Connected to @${me.result.username}`);

  const chatId = await pollChatId(token);
  console.log(`Chat ID: ${chatId}`);

  const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const existingSiteUrl = existing.match(/^SITE_URL=(.+)$/m)?.[1]?.trim();
  const detectedSiteUrl = detectSiteUrl();
  const siteUrl = existingSiteUrl || detectedSiteUrl;
  const test = await api(token, 'sendMessage', {
    chat_id: chatId,
    text: `✅ חדשות הולנד מחובר\nהאתר: ${siteUrl}\nהדחיפה היומית תישלח לאחר כל מהדורה מוצלחת.`,
    parse_mode: 'HTML',
  });
  if (!test.ok) fail(`Could not send a test message: ${test.description || 'unknown error'}`);
  console.log('Test message sent.');

  const bulletin = latestBulletin(root);
  if (bulletin) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', '🎧 דוגמה למהדורה הקולית');
    form.append('audio', new Blob([fs.readFileSync(bulletin)], { type: 'audio/mpeg' }), path.basename(bulletin));
    const audio = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
      method: 'POST',
      body: form,
    }).then((response) => response.json());
    if (audio.ok) console.log('Sample audio sent.');
    else console.log(`Sample audio was not sent: ${audio.description || 'unknown error'}`);
  }

  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(CONFIG_DIR, 0o700);
  const content = [
    '# Generated by scripts/setup-telegram.mjs',
    `TELEGRAM_BOT_TOKEN=${token}`,
    `TELEGRAM_CHAT_ID=${chatId}`,
    existingSiteUrl ? '# Preserved from the existing configuration:' : '# Uncomment to override the auto-detected LAN address:',
    existingSiteUrl ? `SITE_URL=${existingSiteUrl}` : `# SITE_URL=${detectedSiteUrl}`,
    '',
  ].join('\n');
  fs.writeFileSync(ENV_FILE, content, { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);

  console.log(`\nSaved ${ENV_FILE}`);
  console.log('Daily Telegram push is enabled. The next successful build will send the edition.');
}

main().catch((error) => fail(error.message));
