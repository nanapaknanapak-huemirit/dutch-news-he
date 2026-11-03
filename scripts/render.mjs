import { escapeHtml, normalizeSpace } from './lib/text.mjs';
import { editionDate, TIME_ZONE } from './lib/state.mjs';
import { formatDuration } from './lib/ffmpeg.mjs';

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
});

const timeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateTimeFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const SOURCE_PRIORITY = { npo: 0, nos: 1, at5: 2 };
const SOURCE_LABELS = { npo: 'NPO', nos: 'NOS', at5: 'AT5' };

function ageHours(iso) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / 3600000;
}

function formatItemTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const today = editionDate(new Date());
  const itemDay = editionDate(date);
  const time = timeFormatter.format(date);
  if (itemDay === today) return `היום, ${time}`;
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (itemDay === editionDate(yesterdayDate)) return `אתמול, ${time}`;
  return `${shortDateFormatter.format(date)}, ${time}`;
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const priority = (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9);
    if (priority !== 0) return priority;
    return (Date.parse(b.published || 0) || 0) - (Date.parse(a.published || 0) || 0);
  });
}

function renderCard(item, options = {}) {
  const source = item.source || 'nos';
  const prefix = options.prefix || '';
  const image = item.image
    ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="placeholder" aria-hidden="true">${escapeHtml(SOURCE_LABELS[source] || source)}</span>`;
  const isNew = item.isNew === true;
  const audioEntry = options.audio?.get(item.id);
  const listen = audioEntry
    ? `<button class="listen" type="button" data-audio="${escapeHtml(`${prefix}audio/items/${audioEntry.name}`)}" aria-pressed="false" aria-label="האזן לכתבה: ${escapeHtml(item.titleHe || item.titleNl)}"><span class="listen-icon" data-icon aria-hidden="true">▶</span><span data-label>האזן</span></button>`
    : '';
  return `
      <article class="card" data-source="${escapeHtml(source)}" data-new="${isNew}">
        <a class="card-media" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          ${image}
        </a>
        <div class="card-body">
          <div class="card-meta">
            <span class="src src-${escapeHtml(source)}">${escapeHtml(item.sourceLabel || SOURCE_LABELS[source] || source)}</span>
            <time datetime="${escapeHtml(item.published || '')}">${escapeHtml(formatItemTime(item.published))}</time>
            ${isNew ? '<span class="new">חדש</span>' : ''}
          </div>
          <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.titleHe || item.titleNl)}</a></h3>
          <p class="summary">${escapeHtml(item.summaryHe || item.summaryNl)}</p>
          <p class="original" lang="nl" dir="ltr">${escapeHtml(item.titleNl)}</p>
          <div class="card-actions">
            ${listen}
            <a class="source-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">למקור ↗</a>
          </div>
        </div>
      </article>`;
}

function renderStatus(status) {
  const updated = status.lastSuccess
    ? `<span class="status-ok">עודכן לאחרונה: ${escapeHtml(dateTimeFormatter.format(new Date(status.lastSuccess)))}</span>`
    : '<span class="status-warn">טרם בוצע עדכון</span>';
  const stale = ageHours(status.lastSuccess) > 36;
  const failed = Object.entries(status.sources || {})
    .filter(([, value]) => value && value.ok === false)
    .map(([key]) => SOURCE_LABELS[key] || key);
  const parts = [updated];
  if (stale) parts.push('<span class="status-warn">הנתונים בני יותר מ־36 שעות — ייתכן שהעדכון היומי לא רץ</span>');
  if (failed.length) parts.push(`<span class="status-warn">שגיאה במקורות: ${escapeHtml(failed.join(', '))}</span>`);
  const nextRun = status.nextRun
    ? `<span class="status-next">העדכון הבא: ${escapeHtml(dateTimeFormatter.format(new Date(status.nextRun)))}</span>`
    : '';
  return `<section class="status-bar">${parts.join('<span class="sep">·</span>')}${nextRun ? `<span class="sep">·</span>${nextRun}` : ''}</section>`;
}

function renderArchiveLinks(editions, prefix) {
  if (!editions.length) return '';
  const links = editions
    .slice(0, 8)
    .map(
      (edition) =>
        `<a href="${prefix}archive/${escapeHtml(edition)}.html">${escapeHtml(shortDateFormatter.format(new Date(`${edition}T12:00:00Z`)))}</a>`,
    )
    .join('');
  return `<section class="archive-strip"><h2>מהדורות אחרונות</h2><nav>${links}</nav></section>`;
}

function filterButtons(counts) {
  const entries = [
    ['all', 'הכל', counts.all],
    ['npo', 'NPO', counts.npo],
    ['nos', 'NOS', counts.nos],
    ['at5', 'AT5', counts.at5],
  ];
  return entries
    .map(
      ([key, label, count]) =>
        `<button type="button" class="filter${key === 'all' ? ' active' : ''}" data-filter="${key}">${label}<span>${count}</span></button>`,
    )
    .join('');
}

function renderAudioBar({ bulletin, newCount, prefix = '' }) {
  if (!bulletin?.name) return '';
  return `
  <section class="audio-bar" aria-label="האזנה למהדורה היומית">
    <div class="audio-copy">
      <p class="eyebrow">האזנה</p>
      <h2>מהדורת הבוקר</h2>
      <p>${escapeHtml(formatDuration(bulletin.duration))} דקות · ${newCount} עדכונים חדשים</p>
    </div>
    <div class="audio-actions">
      <audio id="bulletin-player" controls preload="metadata" src="${prefix}audio/${escapeHtml(bulletin.name)}"></audio>
      <button class="play-all" type="button" data-play-all><span aria-hidden="true">▶</span> האזן לכל העדכון</button>
    </div>
  </section>`;
}

function renderWhatsNew(items, prefix = '') {
  const fresh = items.filter((item) => item.isNew).slice(0, 5);
  if (!fresh.length) return '';
  const links = fresh
    .map(
      (item) =>
        `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.titleHe || item.titleNl)}</a></li>`,
    )
    .join('');
  return `
  <section class="whatsnew">
    <div class="whatsnew-head">
      <h2>מה חדש היום</h2>
      <a href="${prefix}updates.html">כל העדכונים</a>
    </div>
    <ol>${links}</ol>
  </section>`;
}

function renderQrPanel({ qrSvg, siteUrl, prefix = '' }) {
  if (!qrSvg || !siteUrl) return '';
  return `
  <section class="qr-panel" aria-label="פתיחה בטלפון">
    <div class="qr-copy">
      <p class="eyebrow">בטלפון</p>
      <h2>סרקו כדי לפתוח</h2>
      <p>סרקו את הקוד עם המצלמה. הטלפון והמחשב צריכים להיות מחוברים לאותה רשת Wi-Fi.</p>
      <code dir="ltr">${escapeHtml(siteUrl)}</code>
      <p class="qr-links"><a href="${prefix}podcast.xml">פודקאסט</a> · <a href="${prefix}updates.html">היסטוריית עדכונים</a></p>
    </div>
    <div class="qr-box">${qrSvg}</div>
  </section>`;
}

function layout({ title, prefix, body, archiveMode = false }) {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${prefix}style.css">
<link rel="alternate" type="application/atom+xml" title="חדשות הולנד" href="${prefix}feed.xml">
<link rel="alternate" type="application/rss+xml" title="פודקאסט חדשות הולנד" href="${prefix}podcast.xml">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${prefix}index.html">
      <span class="brand-mark">NL</span>
      <span class="brand-text"><strong>חדשות הולנד</strong><small>בעברית, כל בוקר</small></span>
    </a>
    <div class="header-date">${escapeHtml(dateFormatter.format(new Date()))}</div>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p>נבנה אוטומטית מהמקורות: NOS · NPO · AT5</p>
    <nav>
      <a href="${prefix}updates.html">עדכונים</a>
      <a href="${prefix}archive/index.html">ארכיון</a>
      <a href="${prefix}podcast.xml">פודקאסט</a>
      <a href="${prefix}feed.xml">RSS</a>
      ${archiveMode ? `<a href="${prefix}index.html">המהדורה היומית</a>` : ''}
    </nav>
  </div>
</footer>
<audio id="item-player" preload="none"></audio>
<script>
(() => {
  const filterButtons = document.querySelectorAll('[data-filter]');
  const filterCards = document.querySelectorAll('[data-source]');
  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const filter = button.dataset.filter;
      filterButtons.forEach((other) => other.classList.toggle('active', other === button));
      filterCards.forEach((card) => { card.hidden = filter !== 'all' && card.dataset.source !== filter; });
    });
  });

  const itemPlayer = document.getElementById('item-player');
  const bulletin = document.getElementById('bulletin-player');
  const listenButtons = [...document.querySelectorAll('[data-audio]')];
  let current = null;

  const setState = (button, playing) => {
    button.classList.toggle('playing', playing);
    button.setAttribute('aria-pressed', String(playing));
    const icon = button.querySelector('[data-icon]');
    const label = button.querySelector('[data-label]');
    if (icon) icon.textContent = playing ? '❚❚' : '▶';
    if (label) label.textContent = playing ? 'עצור' : 'האזן';
  };

  const playButton = (button) => {
    if (!itemPlayer) return;
    if (current === button && !itemPlayer.paused) {
      itemPlayer.pause();
      return;
    }
    if (current && current !== button) setState(current, false);
    if (bulletin) bulletin.pause();
    current = button;
    itemPlayer.src = button.dataset.audio;
    itemPlayer.play().catch(() => setState(button, false));
  };

  listenButtons.forEach((button) => button.addEventListener('click', () => playButton(button)));

  itemPlayer?.addEventListener('play', () => { if (current) setState(current, true); });
  itemPlayer?.addEventListener('pause', () => { if (current) setState(current, false); });
  itemPlayer?.addEventListener('ended', () => {
    if (current) setState(current, false);
    const visible = listenButtons.filter((button) => !button.closest('[hidden]'));
    const index = visible.indexOf(current);
    const next = visible[index + 1];
    if (next) playButton(next);
  });

  bulletin?.addEventListener('play', () => {
    itemPlayer?.pause();
    if (current) setState(current, false);
    current = null;
  });

  document.querySelector('[data-play-all]')?.addEventListener('click', () => {
    const visible = listenButtons.filter((button) => !button.closest('[hidden]'));
    if (visible.length) playButton(visible[0]);
  });
})();
</script>
</body>
</html>
`;
}

export function renderHome({ items, editions, edition, status, generatedAt, audio, qrSvg, siteUrl }) {
  const visible = sortItems(
    items.filter((item) => {
      if (item.isNew) return true;
      const published = Date.parse(item.published || 0);
      return published >= Date.now() - 72 * 60 * 60 * 1000;
    }),
  );
  const newCount = visible.filter((item) => item.isNew).length;
  const counts = { all: visible.length, npo: 0, nos: 0, at5: 0 };
  for (const item of visible) if (counts[item.source] !== undefined) counts[item.source] += 1;

  const cards = visible.map((item) => renderCard(item, { audio: audio?.itemAudio })).join('');
  const body = `
  ${renderStatus(status)}
  <section class="daily-head">
    <p class="eyebrow">מהדורה יומית</p>
    <h1>${escapeHtml(dateFormatter.format(new Date(`${edition}T12:00:00Z`)))}</h1>
    <p class="dek">${newCount ? `<strong>${newCount}</strong> פריטים חדשים במהדורה של היום` : 'אין פריטים חדשים במהדורה של היום — מוצגים הפריטים האחרונים'}</p>
    <p class="generated">נבנה ב־${escapeHtml(dateTimeFormatter.format(new Date(generatedAt)))}</p>
  </section>
  ${renderAudioBar({ bulletin: audio?.bulletin, newCount })}
  ${renderWhatsNew(visible)}
  <nav class="filters">${filterButtons(counts)}</nav>
  <section class="grid">
    ${cards || '<p class="empty">אין פריטים להצגה כרגע.</p>'}
  </section>
  ${renderQrPanel({ qrSvg, siteUrl })}
  ${renderArchiveLinks(editions, '')}
`;
  return layout({ title: `חדשות הולנד — ${dateFormatter.format(new Date(`${edition}T12:00:00Z`))}`, prefix: '', body });
}

export function renderArchive({ items, edition, editions, generatedAt }) {
  const sorted = sortItems(items.map((item) => ({ ...item, isNew: false })));
  const cards = sorted.map(renderCard).join('');
  const body = `
  <section class="daily-head archive-head">
    <p class="eyebrow">ארכיון</p>
    <h1>${escapeHtml(dateFormatter.format(new Date(`${edition}T12:00:00Z`)))}</h1>
    <p class="dek">${sorted.length} פריטים במהדורה זו</p>
    <p class="generated">נבנה ב־${escapeHtml(dateTimeFormatter.format(new Date(generatedAt)))}</p>
  </section>
  <section class="grid">${cards || '<p class="empty">אין פריטים במהדורה זו.</p>'}</section>
  ${renderArchiveLinks(editions, '../')}
`;
  return layout({
    title: `ארכיון — ${dateFormatter.format(new Date(`${edition}T12:00:00Z`))}`,
    prefix: '../',
    body,
    archiveMode: true,
  });
}

export function renderArchiveIndex({ editions }) {
  const rows = editions
    .map(
      (edition) => `<li><a href="${escapeHtml(edition)}.html">${escapeHtml(
        dateFormatter.format(new Date(`${edition}T12:00:00Z`)),
      )}</a></li>`,
    )
    .join('');
  const body = `
  <section class="daily-head">
    <p class="eyebrow">ארכיון</p>
    <h1>כל המהדורות</h1>
    <p class="dek">30 הימים האחרונים</p>
  </section>
  <ul class="archive-list">${rows || '<li>אין מהדורות שמורות.</li>'}</ul>
`;
  return layout({ title: 'ארכיון — חדשות הולנד', prefix: '../', body, archiveMode: true });
}

export function renderUpdates({ editionSummaries, runs, status, qrSvg, siteUrl, generatedAt }) {
  const editions = editionSummaries
    .slice(0, 30)
    .map((entry) => {
      const audio = entry.audio?.name
        ? `<audio controls preload="metadata" src="audio/${escapeHtml(entry.audio.name)}"></audio><span class="duration">${escapeHtml(formatDuration(entry.audio.duration))}</span>`
        : '<span class="muted">אין אודיו</span>';
      const headlines = (entry.headlines || [])
        .slice(0, 3)
        .map((headline) => `<li>${escapeHtml(headline)}</li>`)
        .join('');
      return `
      <li class="update-row${entry.edition === status.edition ? ' current' : ''}">
        <div class="update-date">
          <strong>${escapeHtml(dateFormatter.format(new Date(`${entry.edition}T12:00:00Z`)))}</strong>
          <span>${entry.itemCount} פריטים · ${entry.newCount} חדשים</span>
        </div>
        <ul class="update-headlines">${headlines || '<li class="muted">אין פריטים במהדורה זו</li>'}</ul>
        <div class="update-actions">${audio}<a href="archive/${escapeHtml(entry.edition)}.html">למהדורה</a></div>
      </li>`;
    })
    .join('');

  const runRows = runs
    .slice(0, 20)
    .map(
      (run) => `<li class="${run.errors ? 'run-warn' : ''}">
        <time datetime="${escapeHtml(run.at)}">${escapeHtml(dateTimeFormatter.format(new Date(run.at)))}</time>
        <span>מהדורה ${escapeHtml(run.edition || '—')}</span>
        <span>${Number(run.added) || 0} חדשים</span>
        <span>${run.errors ? `שגיאות: ${escapeHtml(run.errors)}` : 'תקין'}</span>
        ${run.audio ? `<span>${escapeHtml(formatDuration(run.audio.duration))} אודיו</span>` : ''}
      </li>`,
    )
    .join('');

  const body = `
  <section class="daily-head updates-head">
    <p class="eyebrow">עדכונים</p>
    <h1>היסטוריית המהדורות</h1>
    <p class="dek">המהדורות הכתובות והקוליות של 30 הימים האחרונים</p>
    <p class="generated">נבנה ב־${escapeHtml(dateTimeFormatter.format(new Date(generatedAt)))}</p>
  </section>
  ${renderStatus(status)}
  <section class="updates-block">
    <div class="updates-blockhead">
      <h2>מהדורות</h2>
      <div class="updates-links"><a href="podcast.xml">פודקאסט</a> · <a href="feed.xml">RSS</a> · <a href="archive/index.html">ארכיון</a></div>
    </div>
    <ol class="updates-list">${editions || '<li class="update-row"><span class="muted">אין מהדורות עדיין.</span></li>'}</ol>
  </section>
  <section class="updates-block">
    <h2>יומן ריצות</h2>
    <ul class="runs-list">${runRows || '<li class="muted">אין ריצות עדיין.</li>'}</ul>
  </section>
  ${renderQrPanel({ qrSvg, siteUrl })}
`;
  return layout({ title: 'עדכונים — חדשות הולנד', prefix: '', body });
}

export function renderNotFound() {
  return layout({
    title: 'לא נמצא',
    prefix: '../',
    body: '<section class="daily-head"><h1>הדף לא נמצא</h1><p class="dek"><a href="../index.html">חזרה למהדורה היומית</a></p></section>',
    archiveMode: true,
  });
}

export function normalizedText(value) {
  return normalizeSpace(value);
}
