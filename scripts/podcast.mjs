import { escapeXml } from './lib/text.mjs';
import { TIME_ZONE } from './lib/state.mjs';

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function podcastDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function pubDate(edition) {
  const date = new Date(`${edition}T06:00:00Z`);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

export function renderPodcast({ editions, siteUrl, generatedAt }) {
  const base = siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`;
  const episodes = editions
    .filter((entry) => entry.audio?.name)
    .map((entry) => {
      const title = `מהדורת ${dateFormatter.format(new Date(`${entry.edition}T12:00:00Z`))}`;
      const headlines = (entry.headlines || []).slice(0, 6);
      const description = headlines.length
        ? `הכותרות הבולטות: ${headlines.join(' · ')}`
        : `מהדורת החדשות היומית בעברית, ${dateFormatter.format(new Date(`${entry.edition}T12:00:00Z`))}`;
      return `  <item>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(`${base}updates.html`)}</link>
    <guid isPermaLink="false">dutch-news-he-${escapeXml(entry.edition)}</guid>
    <pubDate>${escapeXml(pubDate(entry.edition))}</pubDate>
    <description>${escapeXml(description)}</description>
    <itunes:summary>${escapeXml(description)}</itunes:summary>
    <itunes:duration>${escapeXml(podcastDuration(entry.audio.duration))}</itunes:duration>
    <enclosure url="${escapeXml(`${base}audio/${entry.audio.name}`)}" length="${entry.audio.size}" type="audio/mpeg"/>
  </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>חדשות הולנד — פודקאסט יומי</title>
  <link>${escapeXml(base)}</link>
  <atom:link href="${escapeXml(`${base}podcast.xml`)}" rel="self" type="application/rss+xml"/>
  <description>מהדורת חדשות יומית בעברית מהולנד: NOS, NPO ו-AT5.</description>
  <language>he</language>
  <lastBuildDate>${escapeXml(new Date(generatedAt).toUTCString())}</lastBuildDate>
  <itunes:author>חדשות הולנד</itunes:author>
  <itunes:explicit>false</itunes:explicit>
  <itunes:category text="News"/>
${episodes}
</channel>
</rss>
`;
}
