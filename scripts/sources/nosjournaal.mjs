import fs from 'node:fs';
import path from 'node:path';
import { request, requestJson } from '../lib/http.mjs';
import { safeDate, TIME_ZONE } from '../lib/state.mjs';
import { vttHeadlineText } from '../lib/text.mjs';

const API_BASE = 'https://npo.nl/start/api/domain';
const PLAYER_ENDPOINT = 'https://prod.npoplayer.nl/stream-link';

const timeFormatter = new Intl.DateTimeFormat('nl-NL', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export async function fetchNosJournaal({ subtitleDir } = {}) {
  const best = await requestJson(`${API_BASE}/series-best-episode?seriesSlug=nos-journaal`, {
    retries: 2,
  });
  const program = best.data?.program;
  if (!program?.productId || !program?.slug) {
    throw new Error('NPO: could not resolve the latest NOS Journaal episode');
  }

  const detail = await requestJson(
    `${API_BASE}/program-detail?slug=${encodeURIComponent(program.slug)}`,
    { retries: 2 },
  );
  const published = safeDate(detail.data?.publishedDateTime) || new Date();
  const timeLabel = timeFormatter.format(published);

  const token = await requestJson(
    `${API_BASE}/player-token?productId=${encodeURIComponent(program.productId)}`,
    { retries: 2 },
  );
  const jwt = token.data?.jwt;
  if (!jwt) throw new Error('NPO: player token missing');

  const streamResponse = await request(PLAYER_ENDPOINT, {
    method: 'POST',
    retries: 2,
    headers: {
      authorization: jwt,
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://npo.nl',
      referer: 'https://npo.nl/',
    },
    body: JSON.stringify({
      profileName: 'hls',
      drmType: '',
      referrerUrl: `https://npo.nl/start/afspelen/${program.slug}`,
      ster: { identifier: 'npo-app-desktop', deviceType: 4, player: 'web' },
    }),
  });
  const stream = await streamResponse.json();
  const subtitles = stream?.assets?.subtitles || [];
  const dutch = subtitles.find((entry) => entry.iso === 'nl') || subtitles[0];
  if (!dutch?.location) throw new Error('NPO: no Dutch subtitles available');

  const vttResponse = await request(dutch.location, { retries: 2 });
  const vtt = await vttResponse.text();

  if (subtitleDir) {
    fs.mkdirSync(subtitleDir, { recursive: true });
    fs.writeFileSync(path.join(subtitleDir, `${program.productId}.vtt`), vtt, 'utf8');
  }

  const summaryNl = vttHeadlineText(vtt, 120, 1100);
  if (!summaryNl) throw new Error('NPO: subtitle transcript was empty');

  const url = `https://npo.nl/start/afspelen/${program.slug}`;
  const image = detail.data?.images?.[0]?.url || '';

  return {
    productId: program.productId,
    published: published.toISOString(),
    items: [
      {
        id: `npo:${program.productId}`,
        source: 'npo',
        sourceLabel: 'NPO',
        titleNl: `NOS Journaal ${timeLabel}`,
        titleHe: `מהדורת NOS Journaal · ${timeLabel}`,
        summaryNl,
        url,
        image,
        published: published.toISOString(),
        productId: program.productId,
        slug: program.slug,
      },
    ],
  };
}
