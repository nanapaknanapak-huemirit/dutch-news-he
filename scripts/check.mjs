import fs from 'node:fs';
import path from 'node:path';
import { loadJson } from './lib/state.mjs';
import { loadTelegramConfig } from './notify.mjs';

const root = process.cwd();
const failures = [];
const warnings = [];

const status = loadJson(path.join(root, 'data', 'status.json'), null);
const store = loadJson(path.join(root, 'data', 'items.json'), null);
const indexFile = path.join(root, 'site', 'index.html');
const feedFile = path.join(root, 'site', 'feed.xml');
const updatesFile = path.join(root, 'site', 'updates.html');
const podcastFile = path.join(root, 'site', 'podcast.xml');
const qrFile = path.join(root, 'site', 'qr.svg');

if (!status) failures.push('data/status.json is missing');
if (!store?.items) failures.push('data/items.json is missing or empty');
if (!fs.existsSync(indexFile)) failures.push('site/index.html is missing');
if (!fs.existsSync(feedFile)) failures.push('site/feed.xml is missing');
if (!fs.existsSync(updatesFile)) failures.push('site/updates.html is missing');
if (!fs.existsSync(podcastFile)) failures.push('site/podcast.xml is missing');
if (!fs.existsSync(qrFile)) failures.push('site/qr.svg is missing');

if (status?.lastSuccess) {
  const ageHours = (Date.now() - Date.parse(status.lastSuccess)) / 3600000;
  if (ageHours > 36) warnings.push(`last successful update is ${ageHours.toFixed(1)} hours old`);
} else {
  failures.push('no successful update recorded');
}

for (const [key, source] of Object.entries(status?.sources || {})) {
  if (source.ok === false) warnings.push(`source ${key} failed: ${source.error || 'unknown error'}`);
}

const items = Object.values(store?.items || {});
const seenIds = new Set();
for (const item of items) {
  if (!item.id || seenIds.has(item.id)) failures.push(`duplicate or missing item id: ${item.id}`);
  seenIds.add(item.id);
  for (const field of ['titleHe', 'summaryHe', 'titleNl', 'summaryNl', 'url']) {
    if (!item[field] || !String(item[field]).trim()) failures.push(`item ${item.id} missing ${field}`);
  }
  if (!['npo', 'nos', 'at5'].includes(item.source)) failures.push(`item ${item.id} has unknown source`);
}

if (fs.existsSync(indexFile)) {
  const html = fs.readFileSync(indexFile, 'utf8');
  if (!html.includes('lang="he"') || !html.includes('dir="rtl"')) failures.push('index.html is not RTL Hebrew');
  if (/undefined|NaN/.test(html)) warnings.push('index.html contains "undefined" or "NaN"');
  if (!html.includes('class="card"')) warnings.push('index.html has no news cards');
}

if (fs.existsSync(feedFile)) {
  const feed = fs.readFileSync(feedFile, 'utf8');
  if (!feed.includes('<feed') || !feed.includes('</feed>')) failures.push('feed.xml is not a complete Atom feed');
  if (!feed.includes('<entry>')) warnings.push('feed.xml has no entries');
}


const siteDir = path.join(root, 'site');
const bulletin = status?.edition ? path.join(siteDir, 'audio', `edition-${status.edition}.mp3`) : null;
if (status?.audio?.bulletin) {
  if (!bulletin || !fs.existsSync(bulletin)) failures.push('daily audio bulletin is missing');
  else if (fs.statSync(bulletin).size < 1000) failures.push('daily audio bulletin is empty');
} else {
  warnings.push('no daily audio bulletin was generated for the current edition');
}

if (fs.existsSync(qrFile)) {
  const qr = fs.readFileSync(qrFile, 'utf8');
  if (!qr.includes('<svg')) failures.push('site/qr.svg is not an SVG image');
}

if (fs.existsSync(updatesFile)) {
  const html = fs.readFileSync(updatesFile, 'utf8');
  if (!html.includes('lang="he"') || !html.includes('dir="rtl"')) failures.push('updates.html is not RTL Hebrew');
  if (!html.includes('היסטוריית המהדורות')) warnings.push('updates.html has no edition history heading');
}

if (fs.existsSync(indexFile)) {
  const html = fs.readFileSync(indexFile, 'utf8');
  const sources = [...html.matchAll(/data-audio="([^"]+)"/g)].map((match) => match[1]);
  for (const source of sources) {
    if (/^https?:|^\/\//.test(source)) continue;
    const file = path.join(siteDir, source.replace(/^\.\//, ''));
    if (!fs.existsSync(file)) failures.push(`missing audio file referenced by index.html: ${source}`);
  }
  if (status?.audio?.items > 0 && sources.length === 0) warnings.push('index.html has no per-item audio buttons');
}

if (fs.existsSync(podcastFile)) {
  const podcast = fs.readFileSync(podcastFile, 'utf8');
  if (!podcast.includes('<rss') || !podcast.includes('</rss>')) failures.push('podcast.xml is not a complete RSS feed');
  const enclosures = [...podcast.matchAll(/<enclosure url="([^"]+)"/g)].map((match) => match[1]);
  for (const url of enclosures) {
    try {
      const relative = new URL(url).pathname.replace(/^\//, '');
      if (!fs.existsSync(path.join(siteDir, relative))) failures.push(`podcast enclosure is missing: ${relative}`);
    } catch {
      failures.push(`podcast enclosure is not a valid URL: ${url}`);
    }
  }
  if (status?.audio?.bulletin && !enclosures.length) warnings.push('podcast.xml has no episodes');
}

const runs = loadJson(path.join(root, 'data', 'runs.json'), null);
if (!runs?.runs?.length) warnings.push('data/runs.json has no run history');

if (!loadTelegramConfig().configured) {
  warnings.push('Telegram is not configured; run node scripts/setup-telegram.mjs to enable push');
}

console.log(`items: ${items.length}`);
console.log(`new in current edition: ${status?.counts?.new ?? 'unknown'}`);
console.log(`added in last run: ${status?.counts?.addedThisRun ?? 'unknown'}`);
console.log(`last success: ${status?.lastSuccess || 'never'}`);
console.log(`next run: ${status?.nextRun || 'unknown'}`);

for (const warning of warnings) console.warn(`warning: ${warning}`);
for (const failure of failures) console.error(`failure: ${failure}`);

if (failures.length) process.exit(1);
console.log('check passed');
