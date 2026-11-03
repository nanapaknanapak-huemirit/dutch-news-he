import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { request } from '../lib/http.mjs';
import { firstSentences, htmlToText, normalizeSpace } from '../lib/text.mjs';
import { safeDate } from '../lib/state.mjs';

const FEED_URL = 'https://feeds.nos.nl/nosnieuwsalgemeen';

function pickText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return pickText(node[0]);
  if (typeof node === 'object') return String(node['#text'] ?? node['#cdata'] ?? '');
  return '';
}

function firstUrl(node) {
  if (!node) return '';
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = firstUrl(entry);
      if (found) return found;
    }
    return '';
  }
  if (typeof node === 'object') return node['@_url'] || node['@_href'] || '';
  return '';
}

function summaryFrom(description) {
  const html = pickText(description);
  if (!html) return '';
  const $ = cheerio.load(html);
  const paragraphs = $('p')
    .map((_, element) => normalizeSpace($(element).text()))
    .get()
    .filter((text) => text.length >= 30);
  const base = paragraphs.length ? paragraphs.slice(0, 2).join(' ') : htmlToText(html);
  return firstSentences(base, 460);
}

export async function fetchNos(sourceState = {}) {
  const headers = {};
  if (sourceState.etag) headers['if-none-match'] = sourceState.etag;
  if (sourceState.lastModified) headers['if-modified-since'] = sourceState.lastModified;

  const response = await request(FEED_URL, { headers, retries: 2, allowStatus: [304] });
  if (response.status === 304) {
    return {
      notModified: true,
      items: [],
      etag: sourceState.etag,
      lastModified: sourceState.lastModified,
    };
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });
  const document = parser.parse(xml);
  const channel = document?.rss?.channel;
  if (!channel) throw new Error('NOS RSS: missing channel');
  const rawItems = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];

  const items = [];
  for (const raw of rawItems) {
    const title = htmlToText(pickText(raw.title));
    const url = pickText(raw.link);
    if (!title || !url) continue;
    const summary = summaryFrom(raw.description);
    const published = safeDate(pickText(raw.pubDate));
    const image =
      firstUrl(raw.enclosure) ||
      firstUrl(raw['media:content']) ||
      firstUrl(raw['media:thumbnail']) ||
      '';
    items.push({
      id: url,
      source: 'nos',
      sourceLabel: 'NOS',
      titleNl: title,
      summaryNl: summary || title,
      url,
      image,
      published: (published || new Date()).toISOString(),
    });
  }

  return {
    items,
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}
