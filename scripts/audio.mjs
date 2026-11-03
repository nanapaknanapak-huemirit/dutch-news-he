import fs from 'node:fs';
import path from 'node:path';
import { SpeechEngine } from './lib/tts.mjs';
import { concatAudio, probeDuration } from './lib/ffmpeg.mjs';
import { firstSentences, normalizeSpace, sha256 } from './lib/text.mjs';
import { loadJson, saveJson, TIME_ZONE } from './lib/state.mjs';

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function itemSpeechText(item) {
  const title = normalizeSpace(item.titleHe || item.titleNl);
  const summary = normalizeSpace(item.summaryHe || item.summaryNl);
  return [title, summary].filter(Boolean).join('. ');
}

export function bulletinSpeechText({ items, edition, newCount }) {
  const dateLabel = dateFormatter.format(new Date(`${edition}T12:00:00Z`));
  const parts = [];
  if (newCount > 0) {
    parts.push(`חדשות הולנד, מהדורת ${dateLabel}. ${newCount} עדכונים חדשים.`);
  } else {
    parts.push(`חדשות הולנד, מהדורת ${dateLabel}. אלו הכותרות הבולטות.`);
  }
  for (const item of items) {
    const title = normalizeSpace(item.titleHe || item.titleNl);
    const summary = firstSentences(item.summaryHe || item.summaryNl, 240);
    if (title) parts.push(`${title}. ${summary}`);
  }
  parts.push('זהו סוף המהדורה. לחדשות נוספות, בקרו באתר חדשות הולנד.');
  return parts.filter(Boolean).join('\n');
}

export async function generateAudio({
  items,
  bulletinItems,
  edition,
  newCount,
  cacheDir,
  log,
  onProgress,
}) {
  const ttsDir = path.join(cacheDir, 'tts');
  const itemsDir = path.join(cacheDir, 'audio', 'items');
  const editionsDir = path.join(cacheDir, 'audio', 'editions');
  const indexFile = path.join(editionsDir, 'index.json');
  fs.mkdirSync(itemsDir, { recursive: true });
  fs.mkdirSync(editionsDir, { recursive: true });

  const engine = new SpeechEngine({ cacheDir: ttsDir, log });
  const index = loadJson(indexFile, { version: 1, editions: {} });
  if (!index.editions) index.editions = {};

  const itemAudio = new Map();
  let done = 0;
  for (const item of items) {
    const text = itemSpeechText(item);
    if (!text) continue;
    const hash = sha256(text);
    const file = path.join(itemsDir, `${hash}.mp3`);
    if (!fs.existsSync(file) || fs.statSync(file).size < 500) {
      try {
        const { files } = await engine.synthesiseText(text);
        concatAudio({ files, outPath: file, pauseMs: 300, cacheDir: ttsDir });
      } catch (error) {
        log('warn', `audio failed for ${item.id}: ${error.message}`);
        onProgress?.(++done, items.length);
        continue;
      }
    }
    itemAudio.set(item.id, { file, name: `${hash}.mp3` });
    onProgress?.(++done, items.length);
  }

  let bulletin = null;
  const bulletinText = bulletinSpeechText({ items: bulletinItems, edition, newCount });
  const bulletinHash = sha256(bulletinText);
  const bulletinFile = path.join(editionsDir, `${edition}.mp3`);
  const existing = index.editions[edition];
  const reusable =
    existing?.hash === bulletinHash &&
    fs.existsSync(bulletinFile) &&
    fs.statSync(bulletinFile).size > 1000;

  if (!reusable) {
    try {
      log('info', `synthesising daily bulletin (${bulletinItems.length} stories)`);
      const { files } = await engine.synthesiseText(bulletinText);
      concatAudio({ files, outPath: bulletinFile, pauseMs: 500, cacheDir: ttsDir });
      index.editions[edition] = {
        hash: bulletinHash,
        duration: probeDuration(bulletinFile),
        size: fs.statSync(bulletinFile).size,
        generatedAt: new Date().toISOString(),
      };
      saveJson(indexFile, index);
    } catch (error) {
      log('error', `daily bulletin failed: ${error.message}`);
    }
  }

  if (fs.existsSync(bulletinFile) && fs.statSync(bulletinFile).size > 1000) {
    const metadata = index.editions[edition] || {};
    const duration = metadata.duration || probeDuration(bulletinFile);
    if (!metadata.duration) {
      index.editions[edition] = {
        ...metadata,
        hash: bulletinHash,
        duration,
        size: fs.statSync(bulletinFile).size,
        generatedAt: metadata.generatedAt || new Date().toISOString(),
      };
      saveJson(indexFile, index);
    }
    bulletin = {
      file: bulletinFile,
      name: `edition-${edition}.mp3`,
      duration,
      size: fs.statSync(bulletinFile).size,
    };
  }

  return { itemAudio, bulletin, index, stats: engine.stats };
}
