import { createHash } from 'node:crypto';

export const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');

export const normalizeSpace = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export function truncateAtWord(value, max) {
  const text = normalizeSpace(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\-–]$/, '')}…`;
}

export function firstSentences(value, maxChars) {
  const text = normalizeSpace(value);
  if (text.length <= maxChars) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let out = '';
  for (const sentence of sentences) {
    if ((out + sentence).length > maxChars) break;
    out += sentence;
  }
  return out.trim() || truncateAtWord(text, maxChars);
}

export function splitForTranslation(value, maxChars = 1600) {
  const text = normalizeSpace(value);
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const units = text
    .split(/(?<=[.!?;:])\s+|\n+/)
    .map((unit) => unit.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';
  for (const unit of units) {
    if (unit.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      let rest = unit;
      while (rest.length > maxChars) {
        const cut = rest.lastIndexOf(' ', maxChars);
        const at = cut > maxChars * 0.5 ? cut : maxChars;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) current = rest;
      continue;
    }
    if (current.length + unit.length + 1 > maxChars) {
      chunks.push(current);
      current = unit;
    } else {
      current = current ? `${current} ${unit}` : unit;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function htmlToText(html) {
  return normalizeSpace(
    String(html ?? '')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))),
  );
}

export function parseVttCues(vtt) {
  const lines = String(vtt ?? '').replace(/\r/g, '').split('\n');
  const cues = [];
  let timing = null;
  let buffer = [];

  const flush = () => {
    if (!timing || !buffer.length) {
      buffer = [];
      timing = null;
      return;
    }
    const text = normalizeSpace(
      buffer
        .join(' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' '),
    );
    if (text && !/^\d{3,}$/.test(text)) {
      const previous = cues[cues.length - 1];
      if (!previous || previous.text !== text) cues.push({ start: timing.start, text });
    }
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^WEBVTT/.test(line) || /^(NOTE|STYLE|REGION)\b/.test(line)) {
      flush();
      continue;
    }
    const match = line.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->/);
    if (match) {
      flush();
      timing = {
        start: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000,
      };
      continue;
    }
    if (/^\d+$/.test(line) && !buffer.length) continue;
    if (timing) buffer.push(line);
  }
  flush();
  return cues;
}

function cleanVttText(value) {
  return normalizeSpace(
    String(value ?? '')
      .replace(/LIVEPROGRAMMA,?\s*ONDERTITELING KAN ACHTERLOPEN/gi, ' ')
      .replace(/ONDERTITELING KAN ACHTERLOPEN/gi, ' ')
      .replace(/LIVEPROGRAMMA/gi, ' '),
  );
}

export function vttToText(vtt) {
  return cleanVttText(parseVttCues(vtt).map((cue) => cue.text).join(' '));
}

export function vttHeadlineText(vtt, maxSeconds = 120, maxChars = 1100) {
  const cues = parseVttCues(vtt).filter((cue) => cue.start <= maxSeconds);
  const text = cleanVttText(cues.map((cue) => cue.text).join(' '));
  return firstSentences(text, maxChars);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeXml(value) {
  return escapeHtml(value).replace(/&#39;/g, '&#39;');
}
