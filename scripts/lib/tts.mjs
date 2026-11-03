import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeSpace, sha256 } from './text.mjs';

const GOOGLE_TTS = 'https://translate.google.com/translate_tts';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function splitForSpeech(value, maxChars = 170) {
  const clean = normalizeSpace(
    String(value ?? '')
      .replace(/https?:\/\/\S+/gi, ' ')
      .replace(/…/g, '.')
      .replace(/[·•]/g, ',')
      .replace(/[–—]/g, '-'),
  );
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks = [];
  let current = '';
  const units = clean.split(/(?<=[.!?;:])\s+/).filter(Boolean);

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const unit of units) {
    if (unit.length > maxChars) {
      push();
      let rest = unit;
      while (rest.length > maxChars) {
        let cut = rest.lastIndexOf(' ', maxChars);
        if (cut < maxChars * 0.5) cut = maxChars;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if (current.length + unit.length + 1 > maxChars) push();
    current = current ? `${current} ${unit}` : unit;
  }
  push();
  return chunks.filter(Boolean);
}

function ffmpegConvert(wavFile, mp3File) {
  const result = spawnSync(
    'ffmpeg',
    ['-y', '-hide_banner', '-loglevel', 'error', '-i', wavFile, '-ar', '24000', '-ac', '1', '-b:a', '64k', mp3File],
    { timeout: 60000 },
  );
  if (result.status !== 0 || !fs.existsSync(mp3File)) {
    throw new Error(`ffmpeg espeak conversion failed: ${String(result.stderr || '').slice(0, 200)}`);
  }
}

export class SpeechEngine {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir;
    this.delayMs = options.delayMs ?? 250;
    this.log = options.log ?? (() => {});
    this.stats = { google: 0, espeak: 0, cached: 0, failed: 0 };
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  async synthesiseText(text, onProgress) {
    const chunks = splitForSpeech(text);
    const files = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const file = await this.synthesiseChunk(chunks[index]);
      files.push(file);
      if (onProgress) onProgress(index + 1, chunks.length);
    }
    return { files, chunks };
  }

  async synthesiseChunk(text) {
    const clean = normalizeSpace(text);
    if (!clean) throw new Error('empty speech chunk');
    const file = path.join(this.cacheDir, `${sha256(clean)}.mp3`);
    if (fs.existsSync(file) && fs.statSync(file).size > 500) {
      this.stats.cached += 1;
      return file;
    }

    try {
      await this.googleChunk(clean, file);
      this.stats.google += 1;
    } catch (error) {
      this.log('warn', `Google TTS failed, using espeak: ${error.message}`);
      this.espeakChunk(clean, file);
      this.stats.espeak += 1;
    }
    await sleep(this.delayMs);
    return file;
  }

  async googleChunk(text, file) {
    const url = `${GOOGLE_TTS}?${new URLSearchParams({
      ie: 'UTF-8',
      client: 'tw-ob',
      tl: 'iw',
      q: text,
    })}`;

    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'user-agent': USER_AGENT,
            referer: 'https://translate.google.com/',
            'accept-language': 'he-IL,he;q=0.9',
          },
        });
        clearTimeout(timer);
        const type = response.headers.get('content-type') || '';
        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Google TTS HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`Google TTS HTTP ${response.status}`);
        if (type.includes('text/html')) throw new Error('Google TTS returned HTML');
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 500) throw new Error('Google TTS returned empty audio');
        fs.writeFileSync(`${file}.tmp`, buffer);
        fs.renameSync(`${file}.tmp`, file);
        return;
      } catch (error) {
        clearTimeout(timer);
        lastError = error;
        if (attempt < 3) await sleep(1200 * (attempt + 1));
      }
    }
    throw lastError;
  }

  espeakChunk(text, file) {
    const wav = `${file}.wav`;
    const result = spawnSync('espeak-ng', ['-v', 'he', '-s', '145', '-w', wav, text], {
      timeout: 60000,
    });
    if (result.error || result.status !== 0 || !fs.existsSync(wav)) {
      throw new Error(`espeak-ng failed: ${result.error?.message || String(result.stderr || '')}`);
    }
    try {
      ffmpegConvert(wav, `${file}.tmp.mp3`);
      fs.renameSync(`${file}.tmp.mp3`, file);
    } finally {
      fs.rmSync(wav, { force: true });
    }
  }
}
