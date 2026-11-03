import { escapeXml } from './lib/text.mjs';

export function renderFeed({ items, generatedAt, edition }) {
  const sorted = [...items]
    .sort((a, b) => (Date.parse(b.published || 0) || 0) - (Date.parse(a.published || 0) || 0))
    .slice(0, 60);
  const updated = sorted[0]?.updatedAt || generatedAt;

  const entries = sorted
    .map((item) => {
      const title = item.titleHe || item.titleNl;
      const summary = item.summaryHe || item.summaryNl;
      const contentHtml = `<p>${escapeXml(summary)}</p><p><a href="${escapeXml(item.url)}">למקור</a></p>`;
      return `  <entry>
    <title>${escapeXml(title)}</title>
    <id>${escapeXml(item.url)}</id>
    <link rel="alternate" href="${escapeXml(item.url)}"/>
    <published>${escapeXml(item.published || generatedAt)}</published>
    <updated>${escapeXml(item.updatedAt || item.published || generatedAt)}</updated>
    <author><name>חדשות הולנד</name></author>
    <category term="${escapeXml(item.sourceLabel || item.source)}"/>
    <summary type="html">${escapeXml(contentHtml)}</summary>
  </entry>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="he">
  <id>urn:dutch-news-he:feed</id>
  <title>חדשות הולנד בעברית</title>
  <subtitle>סיכום יומי של חדשות מהולנד: NOS, NPO ו-AT5</subtitle>
  <updated>${escapeXml(updated)}</updated>
  <link rel="self" href="feed.xml"/>
  <link rel="alternate" href="index.html"/>
  <author><name>חדשות הולנד</name></author>
  <generator uri="https://opencode.ai">dutch-news-he</generator>
${entries}
</feed>
`;
}
