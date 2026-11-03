import fs from 'node:fs';
import path from 'node:path';

export const TIME_ZONE = 'Europe/Amsterdam';
export const EDITION_HOUR = 7;

export function defaultState() {
  return {
    version: 1,
    lastAttempt: null,
    lastSuccess: null,
    lastEdition: null,
    sources: {
      nos: { etag: null, lastModified: null, seen: {} },
      at5: { etag: null, lastModified: null, seen: {} },
      npo: { productId: null, published: null, edition: null },
    },
  };
}

export function defaultItems() {
  return { version: 1, items: {} };
}

export function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

export function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
}

export function zonedParts(date, timeZone = TIME_ZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts;
}

function timeZoneOffset(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

function localToUtc(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let result = guess - timeZoneOffset(new Date(guess), timeZone);
  result = guess - timeZoneOffset(new Date(result), timeZone);
  return new Date(result);
}

export function editionDate(date = new Date(), timeZone = TIME_ZONE) {
  const parts = zonedParts(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function nextDailyRun(now = new Date(), hour = EDITION_HOUR, timeZone = TIME_ZONE) {
  const parts = zonedParts(now, timeZone);
  const todayAtHour = localToUtc(parts.year, parts.month, parts.day, hour, 0, timeZone);
  if (todayAtHour.getTime() > now.getTime()) return todayAtHour;
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1, 12, 0, 0));
  const nextParts = zonedParts(next, timeZone);
  return localToUtc(nextParts.year, nextParts.month, nextParts.day, hour, 0, timeZone);
}

export function pruneSeen(seen, cutoffMs) {
  const result = {};
  for (const [key, value] of Object.entries(seen || {})) {
    const lastSeen = value?.lastSeen ? Date.parse(value.lastSeen) : 0;
    if (lastSeen >= cutoffMs) result[key] = value;
  }
  return result;
}

export function pruneItems(items, cutoffMs) {
  const result = {};
  for (const [key, item] of Object.entries(items || {})) {
    const timestamp = Date.parse(item.published || item.updatedAt || item.firstSeenAt || 0);
    const seen = Date.parse(item.lastSeenAt || 0);
    if (Math.max(timestamp || 0, seen || 0) >= cutoffMs) result[key] = item;
  }
  return result;
}

export function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') return new Date(value < 1e12 ? value * 1000 : value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
