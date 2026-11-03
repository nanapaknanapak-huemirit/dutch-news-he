import * as cheerio from 'cheerio';
import { request } from '../lib/http.mjs';
import { firstSentences, htmlToText, normalizeSpace } from '../lib/text.mjs';
import { safeDate } from '../lib/state.mjs';

const LISTING_URL = 'https://www.at5.nl/nieuws';
const BASE_URL = 'https://www.at5.nl';
const MAX_NEW_PER_RUN = 14;
const SKIP_PATTERNS = [
  /\/het-at5-nieuws/i,
  /\/at5-nieuws-van/i,
  /\/at5-nieuws-/i,
  /\/(video|liveblog)\//i,
];
const NOISE = /(Hulp bij lezen|Facebook|Whatsapp|LinkedIn|NextDoor|Lees ook|Meer nieuws|Volg AT5|Cookie|Nieuwsbrief)/i;

function metaContent($, name) {
  return normalizeSpace(
    $(`meta[property="${name}"], meta[name="${name}"]`).first().attr('content') || '',
  );
}

function cleanParagraph(value) {
  let text = normalizeSpace(value);
  text = text.replace(/^.*?Door:\s*AT5\s*/i, '');
  text = text.replace(/^Hulp bij lezen.*?NextDoor\s*/i, '');
  text = text.replace(/^Lees ook.*$/i, '');
  return text.trim();
}

function extractArticle(html, url) {
  const $ = cheerio.load(html);
  const title = metaContent($, 'og:title').replace(/\s*-\s*AT5\s*$/i, '') ||
    normalizeSpace($('title').text().replace(/\s*-\s*AT5\s*$/i, ''));
  const description = metaContent($, 'og:description');
  const image = metaContent($, 'og:image');
  const published = safeDate(
    metaContent($, 'article:published_time') ||
      metaContent($, 'datePublished') ||
      $('time[datetime]').first().attr('datetime'),
  );

  const paragraphs = [];
  $('p').each((_, element) => {
    const text = cleanParagraph($(element).text());
    if (text.length < 50) return;
    if (NOISE.test(text)) return;
    if (/^\d{1,2}\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+\d{4}/i.test(text)) {
      return;
    }
    if (text.length > 900) return;
    paragraphs.push(text);
  });

  const descriptionUsable =
    description &&
    description !== title &&
    description.length >= 50 &&
    !NOISE.test(description);

  const base = descriptionUsable ? description : paragraphs.slice(0, 2).join(' ');
  const summary = firstSentences(base, 520);

  if (!title || !summary || summary === title) return null;

  return {
    id: url,
    source: 'at5',
    sourceLabel: 'AT5',
    titleNl: title,
    summaryNl: summary,
    url,
    image,
    published: (published || new Date()).toISOString(),
  };
}

async function fetchArticle(url) {
  const response = await request(url, { retries: 2, timeout: 25000 });
  const html = await response.text();
  return extractArticle(html, url);
}

function extractListingUrls(html) {
  const $ = cheerio.load(html);
  const urls = new Set();
  $('a[href*="/artikelen/"]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    let pathname;
    try {
      pathname = new URL(href, BASE_URL).pathname;
    } catch {
      return;
    }
    if (!/^\/artikelen\/\d+\//.test(pathname)) return;
    if (SKIP_PATTERNS.some((pattern) => pattern.test(pathname))) return;
    urls.add(`${BASE_URL}${pathname}`);
  });
  return [...urls];
}

export async function fetchAt5(sourceState = {}) {
  const headers = {};
  if (sourceState.etag) headers['if-none-match'] = sourceState.etag;
  if (sourceState.lastModified) headers['if-modified-since'] = sourceState.lastModified;

  const response = await request(LISTING_URL, { headers, retries: 2, allowStatus: [304] });
  const now = new Date().toISOString();

  if (response.status === 304) {
    return {
      notModified: true,
      items: [],
      errors: [],
      etag: sourceState.etag,
      lastModified: sourceState.lastModified,
      seenUpdates: {},
    };
  }

  const html = await response.text();
  const listingUrls = extractListingUrls(html);
  const seen = sourceState.seen || {};
  const seenUpdates = {};

  for (const url of listingUrls) {
    const existing = seen[url];
    if (!existing) continue;
    seenUpdates[url] = {
      hash: existing.hash || null,
      lastSeen: now,
    };
  }

  const fresh = listingUrls.filter((url) => !seen[url]).slice(0, MAX_NEW_PER_RUN);
  const items = [];
  const errors = [];
  let index = 0;

  const worker = async () => {
    while (index < fresh.length) {
      const current = fresh[index];
      index += 1;
      try {
        const item = await fetchArticle(current);
        if (item) items.push(item);
      } catch (error) {
        errors.push({ url: current, message: error.message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, fresh.length) }, worker));

  return {
    items,
    errors,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
    seenUpdates,
    listingCount: listingUrls.length,
  };
}
