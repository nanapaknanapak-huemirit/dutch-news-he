import { setTimeout as sleep } from 'node:timers/promises';
import { loadJson, saveJson } from './lib/state.mjs';
import { normalizeSpace, sha256, splitForTranslation } from './lib/text.mjs';

const GOOGLE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get';

export class Translator {
  constructor(options = {}) {
    this.cacheFile = options.cacheFile;
    this.delayMs = options.delayMs ?? 350;
    this.maxChars = options.maxChars ?? 1600;
    this.cache = loadJson(this.cacheFile, () => ({ version: 1, entries: {} }));
    if (!this.cache.entries) this.cache.entries = {};
    this.stats = { hits: 0, calls: 0, fallbacks: 0, errors: 0 };
    this.dirty = false;
    this.pending = 0;
  }

  async translate(value) {
    const text = normalizeSpace(value);
    if (!text) return '';
    const chunks = splitForTranslation(text, this.maxChars);
    const translated = [];
    for (const chunk of chunks) translated.push(await this.translateChunk(chunk));
    return normalizeSpace(translated.join(' '));
  }

  async translateChunk(chunk) {
    const key = sha256(`nl|iw|${chunk}`);
    const cached = this.cache.entries[key];
    if (cached?.he) {
      this.stats.hits += 1;
      return cached.he;
    }

    let he;
    try {
      he = await this.callGoogle(chunk);
    } catch {
      this.stats.fallbacks += 1;
      he = await this.callMyMemory(chunk);
    }

    this.cache.entries[key] = { he, at: new Date().toISOString() };
    this.dirty = true;
    this.stats.calls += 1;
    this.pending += 1;
    if (this.pending % 10 === 0) this.save();
    await sleep(this.delayMs);
    return he;
  }

  async callGoogle(text) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(GOOGLE_ENDPOINT, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'user-agent': 'Mozilla/5.0 DutchNewsHE/1.0',
        },
        body: new URLSearchParams({
          client: 'gtx',
          sl: 'nl',
          tl: 'iw',
          dt: 't',
          q: text,
        }),
      });
      if (!response.ok) throw new Error(`Google translate HTTP ${response.status}`);
      const data = await response.json();
      const parts = Array.isArray(data?.[0]) ? data[0] : [];
      const translated = normalizeSpace(parts.map((part) => part?.[0] || '').join(''));
      if (!translated) throw new Error('Google translate returned no text');
      return translated;
    } finally {
      clearTimeout(timer);
    }
  }

  async callMyMemory(text) {
    const chunks = splitForTranslation(text, 420);
    const out = [];
    for (const chunk of chunks) {
      const url = `${MYMEMORY_ENDPOINT}?${new URLSearchParams({
        q: chunk,
        langpair: 'nl|he',
      })}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'user-agent': 'Mozilla/5.0 DutchNewsHE/1.0' },
        });
        if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
        const data = await response.json();
        const translated = normalizeSpace(data?.responseData?.translatedText || '');
        if (!translated || /MYMEMORY WARNING/i.test(translated)) {
          throw new Error('MyMemory returned no usable text');
        }
        out.push(translated);
      } finally {
        clearTimeout(timer);
      }
      await sleep(this.delayMs);
    }
    return normalizeSpace(out.join(' '));
  }

  save() {
    if (!this.dirty) return;
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    for (const [key, entry] of Object.entries(this.cache.entries)) {
      if (entry?.at && Date.parse(entry.at) < cutoff) delete this.cache.entries[key];
    }
    saveJson(this.cacheFile, this.cache);
    this.dirty = false;
  }
}
