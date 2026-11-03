import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fetchNos } from './sources/nos.mjs';
import { fetchAt5 } from './sources/at5.mjs';
import { fetchNosJournaal } from './sources/nosjournaal.mjs';
import { Translator } from './translate.mjs';
import { renderArchive, renderArchiveIndex, renderHome, renderUpdates } from './render.mjs';
import { renderFeed } from './feed.mjs';
import { generateAudio } from './audio.mjs';
import { renderPodcast } from './podcast.mjs';
import { detectSiteUrl, renderQrSvg } from './qr.mjs';
import { loadNotifyEnv, notifyEdition } from './notify.mjs';
import {
  defaultItems,
  defaultState,
  editionDate,
  loadJson,
  nextDailyRun,
  pruneItems,
  pruneSeen,
  saveJson,
} from './lib/state.mjs';
import { sha256 } from './lib/text.mjs';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const editionsDir = path.join(dataDir, 'editions');
const stateFile = path.join(dataDir, 'state.json');
const itemsFile = path.join(dataDir, 'items.json');
const statusFile = path.join(dataDir, 'status.json');
const runsFile = path.join(dataDir, 'runs.json');
const cacheDir = path.join(root, 'cache');
const siteDir = path.join(root, 'site');
const tmpDir = path.join(root, 'site.tmp');
const oldDir = path.join(root, 'site.old');
const logFile = path.join(root, 'logs', 'build.log');
const lockDir = path.join(dataDir, '.lock');
const styleFile = path.join(root, 'assets', 'style.css');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const noAudio = args.includes('--no-audio');
const noNotify = args.includes('--no-notify');
const forceNotify = args.includes('--force-notify');

function log(level, message) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  const output = level === 'error' ? console.error : console.log;
  output(line);
}

let lockAcquired = false;

function acquireLock() {
  fs.mkdirSync(dataDir, { recursive: true });
  try {
    fs.mkdirSync(lockDir);
  } catch {
    const stats = fs.statSync(lockDir);
    if (Date.now() - stats.mtimeMs > 30 * 60 * 1000) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      fs.mkdirSync(lockDir);
    } else {
      throw new Error('Another update is already running');
    }
  }
  fs.writeFileSync(path.join(lockDir, 'pid'), String(process.pid));
  lockAcquired = true;
}

function releaseLock() {
  if (!lockAcquired) return;
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function listEditions() {
  if (!fs.existsSync(editionsDir)) return [];
  return fs
    .readdirSync(editionsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ''))
    .sort()
    .reverse();
}

function pruneEditions() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const file of fs.readdirSync(editionsDir)) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(file)) continue;
    const edition = file.replace(/\.json$/, '');
    if (new Date(`${edition}T12:00:00Z`) < cutoff) {
      fs.rmSync(path.join(editionsDir, file), { force: true });
    }
  }
}

function notify(title, body) {
  if (dryRun) return;
  if (!process.env.DBUS_SESSION_BUS_ADDRESS) return;
  const result = spawnSync('notify-send', ['--app-name=חדשות הולנד', title, body], {
    timeout: 5000,
  });
  if (result.error) log('warn', `notify-send failed: ${result.error.message}`);
}

function pruneAudioCache() {
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
  for (const dir of [path.join(cacheDir, 'tts'), path.join(cacheDir, 'audio', 'items')]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.mp3')) continue;
      const file = path.join(dir, name);
      try {
        if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
      } catch {
        continue;
      }
    }
  }
  const editionsCache = path.join(cacheDir, 'audio', 'editions');
  const editionsCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  if (fs.existsSync(editionsCache)) {
    for (const name of fs.readdirSync(editionsCache)) {
      if (!name.endsWith('.mp3')) continue;
      const file = path.join(editionsCache, name);
      try {
        if (fs.statSync(file).mtimeMs < editionsCutoff) fs.rmSync(file, { force: true });
      } catch {
        continue;
      }
    }
  }
}

async function runSource(name, fetcher) {
  const started = Date.now();
  try {
    const data = await fetcher();
    return { name, ok: true, data, durationMs: Date.now() - started };
  } catch (error) {
    log('error', `${name}: ${error.message}`);
    return { name, ok: false, error: error.message, durationMs: Date.now() - started };
  }
}

async function main() {
  acquireLock();
  const now = new Date();
  const nowIso = now.toISOString();
  const edition = editionDate(now);
  const windowStart = stateWindow();

  const state = loadJson(stateFile, defaultState);
  const store = loadJson(itemsFile, defaultItems);
  if (!store.items) store.items = {};

  const translator = new Translator({ cacheFile: path.join(cacheDir, 'translations.json') });
  const errors = [];

  const nosState = force
    ? { ...state.sources.nos, etag: null, lastModified: null }
    : state.sources.nos;
  const at5State = { seen: state.sources.at5.seen };

  const hasNpoItem = Object.values(store.items).some(
    (item) => item.source === 'npo' && item.productId && item.productId === state.sources.npo?.productId,
  );
  const npoCurrentForEdition = state.sources.npo?.edition === edition;
  const shouldFetchNpo = force || !npoCurrentForEdition || !hasNpoItem;

  const tasks = [
    runSource('nos', () => fetchNos(nosState)),
    runSource('at5', () => fetchAt5(at5State)),
  ];
  if (shouldFetchNpo) {
    tasks.push(runSource('npo', () => fetchNosJournaal({ subtitleDir: path.join(cacheDir, 'subtitles') })));
  }

  const results = await Promise.all(tasks);
  const byName = Object.fromEntries(results.map((result) => [result.name, result]));

  if (!shouldFetchNpo) {
    byName.npo = { name: 'npo', ok: true, skipped: true, data: { items: [] }, durationMs: 0 };
  }

  const fetched = [];
  for (const result of results) {
    if (result.ok && Array.isArray(result.data?.items)) fetched.push(...result.data.items);
    if (!result.ok) errors.push({ source: result.name, message: result.error });
  }

  for (const articleError of byName.at5?.data?.errors || []) {
    log('warn', `at5 article failed: ${articleError.url} ${articleError.message}`);
  }

  if (byName.nos?.ok) {
    if (byName.nos.data?.etag) state.sources.nos.etag = byName.nos.data.etag;
    if (byName.nos.data?.lastModified) state.sources.nos.lastModified = byName.nos.data.lastModified;
  }
  if (byName.at5?.ok) {
    if (byName.at5.data?.etag) state.sources.at5.etag = byName.at5.data.etag;
    if (byName.at5.data?.lastModified) state.sources.at5.lastModified = byName.at5.data.lastModified;
    const updates = byName.at5.data?.seenUpdates || {};
    for (const [url, value] of Object.entries(updates)) {
      const existing = state.sources.at5.seen[url] || {};
      state.sources.at5.seen[url] = {
        hash: value.hash || existing.hash || null,
        lastSeen: value.lastSeen || nowIso,
      };
    }
  }

  let newCount = 0;
  let translatedCount = 0;

  for (const raw of fetched) {
    const existing = store.items[raw.id];
    const hash = sha256(`${raw.titleNl}\n${raw.summaryNl}`);
    const isNewItem = !existing;

    let titleHe;
    let summaryHe;
    if (existing && existing.hash === hash && existing.titleHe && existing.summaryHe) {
      titleHe = existing.titleHe;
      summaryHe = existing.summaryHe;
    } else {
      try {
        titleHe = raw.titleHe || (await translator.translate(raw.titleNl));
        summaryHe = await translator.translate(raw.summaryNl);
        translatedCount += 1;
      } catch (error) {
        log('error', `translate failed for ${raw.url}: ${error.message}`);
        errors.push({ source: raw.source, message: `translation failed: ${error.message}` });
        if (!existing) continue;
        titleHe = existing.titleHe;
        summaryHe = existing.summaryHe;
      }
    }

    const item = {
      ...(existing || {}),
      id: raw.id,
      source: raw.source,
      sourceLabel: raw.sourceLabel,
      titleNl: raw.titleNl,
      titleHe,
      summaryNl: raw.summaryNl,
      summaryHe,
      url: raw.url,
      image: raw.image || existing?.image || '',
      published: raw.published || existing?.published || nowIso,
      firstSeenEdition: existing?.firstSeenEdition || edition,
      lastSeenEdition: edition,
      lastSeenAt: nowIso,
      updatedAt: existing && existing.hash === hash ? existing.updatedAt : nowIso,
      hash,
    };
    if (raw.productId) {
      item.productId = raw.productId;
      item.slug = raw.slug;
    }
    store.items[raw.id] = item;
    if (raw.source === 'at5') {
      state.sources.at5.seen[raw.id] = { hash, lastSeen: nowIso };
    }
    if (isNewItem) newCount += 1;
  }

  if (byName.npo?.ok && byName.npo.data?.items?.length) {
    const npoItem = byName.npo.data.items[0];
    if (store.items[npoItem.id]) {
      state.sources.npo = {
        productId: byName.npo.data.productId,
        published: byName.npo.data.published,
        edition,
      };
    }
  }

  const itemCutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
  store.items = pruneItems(store.items, itemCutoff);
  const at5Stored = new Set(
    Object.values(store.items)
      .filter((item) => item.source === 'at5')
      .map((item) => item.id),
  );
  state.sources.at5.seen = Object.fromEntries(
    Object.entries(state.sources.at5.seen || {}).filter(([url]) => at5Stored.has(url)),
  );
  for (const key of ['nos', 'at5']) {
    state.sources[key].seen = pruneSeen(state.sources[key].seen, itemCutoff);
  }

  const allItems = Object.values(store.items).map((item) => ({
    ...item,
    isNew: item.firstSeenEdition === edition,
  }));

  const attempted = ['nos', 'at5', 'npo'];
  const allFailed = attempted.every((name) => byName[name] && byName[name].ok === false);

  state.lastAttempt = nowIso;

  const status = {
    edition,
    generatedAt: nowIso,
    lastAttempt: nowIso,
    lastSuccess: state.lastSuccess,
    nextRun: nextDailyRun(new Date()).toISOString(),
    windowStart,
    counts: {
      total: allItems.length,
      new: allItems.filter((item) => item.firstSeenEdition === edition).length,
      addedThisRun: newCount,
      translated: translatedCount,
      bySource: allItems.reduce(
        (accumulator, item) => {
          accumulator[item.source] = (accumulator[item.source] || 0) + 1;
          return accumulator;
        },
        { npo: 0, nos: 0, at5: 0 },
      ),
    },
    sources: Object.fromEntries(
      attempted.map((name) => {
        const result = byName[name];
        return [
          name,
          {
            ok: result?.ok !== false,
            skipped: result?.skipped || false,
            count: result?.data?.items?.length || 0,
            durationMs: result?.durationMs || 0,
            error: result?.error || null,
          },
        ];
      }),
    ),
    warnings: errors.map((error) => `${error.source}: ${error.message}`),
  };

  if (allFailed && !dryRun) {
    state.lastAttempt = nowIso;
    saveJson(stateFile, state);
    saveJson(statusFile, status);
    log('error', 'All sources failed; keeping the previous edition');
    notify('עדכון חדשות הולנד נכשל', 'כל המקורות נכשלו. האתר הקודם נשמר.');
    process.exitCode = 1;
    return;
  }

  const editionItems = allItems
    .filter((item) => item.firstSeenEdition === edition)
    .sort((a, b) => (Date.parse(b.published || 0) || 0) - (Date.parse(a.published || 0) || 0));

  if (dryRun) {
    log(
      'info',
      `dry-run edition=${edition} fetched=${fetched.length} new=${newCount} translated=${translatedCount} errors=${errors.length}`,
    );
    translator.save();
    return;
  }

  fs.mkdirSync(editionsDir, { recursive: true });
  saveJson(path.join(editionsDir, `${edition}.json`), {
    edition,
    generatedAt: nowIso,
    windowStart,
    counts: { items: editionItems.length, new: editionItems.length, translated: translatedCount },
    items: editionItems,
  });

  pruneEditions();
  const editions = listEditions();

  const notifyEnv = loadNotifyEnv();
  if (!process.env.SITE_URL && notifyEnv.SITE_URL) process.env.SITE_URL = notifyEnv.SITE_URL;
  const siteUrl = detectSiteUrl();
  let qrSvg = '';
  try {
    qrSvg = await renderQrSvg(siteUrl);
  } catch (error) {
    log('warn', `qr generation failed: ${error.message}`);
  }

  const visibleItems = allItems.filter((item) => {
    if (item.isNew) return true;
    return (Date.parse(item.published || 0) || 0) >= Date.now() - 72 * 60 * 60 * 1000;
  });
  const editionNewCount = editionItems.length;
  const priority = { npo: 0, nos: 1, at5: 2 };
  const bulletinPool = editionItems.length ? editionItems : visibleItems;
  const bulletinItems = [...bulletinPool]
    .sort(
      (a, b) =>
        (priority[a.source] ?? 9) - (priority[b.source] ?? 9) ||
        (Date.parse(b.published || 0) || 0) - (Date.parse(a.published || 0) || 0),
    )
    .slice(0, 8);

  let audio = null;
  if (!noAudio) {
    try {
      audio = await generateAudio({
        items: visibleItems,
        bulletinItems,
        edition,
        newCount: editionNewCount,
        cacheDir,
        log,
        onProgress: (done, total) => {
          if (done === total || done % 5 === 0) log('info', `audio ${done}/${total}`);
        },
      });
      log(
        'info',
        `audio ready items=${audio.itemAudio.size}/${visibleItems.length} bulletin=${audio.bulletin ? 'yes' : 'no'} google=${audio.stats.google} espeak=${audio.stats.espeak} cached=${audio.stats.cached}`,
      );
      if (audio.itemAudio.size < visibleItems.length) {
        const warning = `audio: ${visibleItems.length - audio.itemAudio.size} items without audio`;
        status.warnings.push(warning);
        errors.push({ source: 'audio', message: warning });
      }
    } catch (error) {
      log('error', `audio pipeline failed: ${error.message}`);
      errors.push({ source: 'audio', message: error.message });
      status.warnings.push(`audio: ${error.message}`);
    }
  }

  status.audio = {
    bulletin: Boolean(audio?.bulletin),
    duration: audio?.bulletin?.duration || 0,
    size: audio?.bulletin?.size || 0,
    items: audio?.itemAudio?.size || 0,
    engine: audio?.stats || null,
  };
  status.siteUrl = siteUrl;

  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmpDir, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'audio', 'items'), { recursive: true });

  const copiedItems = new Set();
  for (const entry of audio?.itemAudio?.values() || []) {
    if (copiedItems.has(entry.name)) continue;
    fs.copyFileSync(entry.file, path.join(tmpDir, 'audio', 'items', entry.name));
    copiedItems.add(entry.name);
  }

  for (const editionName of editions) {
    const cachedBulletin = path.join(cacheDir, 'audio', 'editions', `${editionName}.mp3`);
    if (fs.existsSync(cachedBulletin)) {
      fs.copyFileSync(cachedBulletin, path.join(tmpDir, 'audio', `edition-${editionName}.mp3`));
    }
  }

  const audioIndex = loadJson(path.join(cacheDir, 'audio', 'editions', 'index.json'), {
    version: 1,
    editions: {},
  });
  const editionAudio = {};
  for (const editionName of editions) {
    const file = path.join(tmpDir, 'audio', `edition-${editionName}.mp3`);
    if (!fs.existsSync(file)) continue;
    const metadata = audioIndex.editions?.[editionName] || {};
    editionAudio[editionName] = {
      name: `edition-${editionName}.mp3`,
      duration: metadata.duration || 0,
      size: metadata.size || fs.statSync(file).size,
    };
  }

  const editionData = new Map();
  const editionSummaries = [];
  for (const editionName of editions) {
    const data = loadJson(path.join(editionsDir, `${editionName}.json`), null);
    if (!data?.items) continue;
    editionData.set(editionName, data);
    const headlines = [...data.items]
      .sort(
        (a, b) =>
          (priority[a.source] ?? 9) - (priority[b.source] ?? 9) ||
          (Date.parse(b.published || 0) || 0) - (Date.parse(a.published || 0) || 0),
      )
      .slice(0, 5)
      .map((item) => item.titleHe || item.titleNl);
    editionSummaries.push({
      edition: editionName,
      itemCount: data.items.length,
      newCount: data.counts?.new || 0,
      headlines,
      audio: editionAudio[editionName] || null,
    });
  }

  const runsStore = loadJson(runsFile, { version: 1, runs: [] });
  const runRecord = {
    at: nowIso,
    edition,
    added: newCount,
    editionCount: editionItems.length,
    total: allItems.length,
    translated: translatedCount,
    errors: errors.map((error) => error.source).join(', '),
    audio: editionAudio[edition] || null,
    siteUrl,
  };
  const runs = [runRecord, ...(runsStore.runs || [])].slice(0, 60);

  const renderedStatus = { ...status, lastSuccess: nowIso };
  fs.writeFileSync(
    path.join(tmpDir, 'index.html'),
    renderHome({ items: allItems, editions, edition, status: renderedStatus, generatedAt: nowIso, audio, qrSvg, siteUrl }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'feed.xml'),
    renderFeed({ items: allItems, generatedAt: nowIso, edition }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'updates.html'),
    renderUpdates({ editionSummaries, runs, status: renderedStatus, qrSvg, siteUrl, generatedAt: nowIso }),
    'utf8',
  );
  fs.writeFileSync(
    path.join(tmpDir, 'podcast.xml'),
    renderPodcast({ editions: editionSummaries, siteUrl, generatedAt: nowIso }),
    'utf8',
  );
  if (qrSvg) fs.writeFileSync(path.join(tmpDir, 'qr.svg'), qrSvg, 'utf8');
  fs.writeFileSync(path.join(tmpDir, 'archive', 'index.html'), renderArchiveIndex({ editions }), 'utf8');

  for (const archiveEdition of editions) {
    const data = editionData.get(archiveEdition);
    if (!data?.items) continue;
    fs.writeFileSync(
      path.join(tmpDir, 'archive', `${archiveEdition}.html`),
      renderArchive({
        items: data.items,
        edition: archiveEdition,
        editions,
        generatedAt: data.generatedAt || nowIso,
      }),
      'utf8',
    );
  }

  fs.copyFileSync(styleFile, path.join(tmpDir, 'style.css'));

  fs.rmSync(oldDir, { recursive: true, force: true });
  if (fs.existsSync(siteDir)) fs.renameSync(siteDir, oldDir);
  fs.renameSync(tmpDir, siteDir);
  fs.rmSync(oldDir, { recursive: true, force: true });

  state.lastSuccess = nowIso;
  state.lastEdition = edition;
  saveJson(stateFile, state);
  saveJson(itemsFile, store);

  status.lastSuccess = nowIso;
  saveJson(statusFile, status);
  saveJson(runsFile, { version: 1, runs });
  pruneAudioCache();
  translator.save();

  log(
    'info',
    `published edition=${edition} total=${allItems.length} new=${newCount} translated=${translatedCount} errors=${errors.length} audio=${audio?.bulletin ? 'yes' : 'no'}`,
  );

  const errorSources = attempted.filter((name) => byName[name]?.ok === false);
  if (errorSources.length) {
    notify(
      'עדכון חדשות הולנד',
      `${editionNewCount} פריטים חדשים · פורסם עם שגיאות: ${errorSources.join(', ')}`,
    );
  } else {
    notify(
      'עדכון חדשות הולנד',
      `${editionNewCount} פריטים חדשים · ${audio?.bulletin ? 'כולל אודיו · ' : ''}${edition}`,
    );
  }

  if (!noNotify) {
    const bulletinName = editionAudio[edition]?.name;
    await notifyEdition({
      edition,
      newCount: editionNewCount,
      headlines: bulletinItems.map((item) => item.titleHe || item.titleNl),
      audioPath: bulletinName ? path.join(siteDir, 'audio', bulletinName) : null,
      siteUrl,
      force: forceNotify,
      log,
    });
  }
}

function stateWindow() {
  const state = loadJson(stateFile, defaultState);
  if (state.lastSuccess && Date.parse(state.lastSuccess)) return state.lastSuccess;
  return new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
}

main()
  .catch((error) => {
    log('error', error.stack || error.message);
    notify('עדכון חדשות הולנד נכשל', error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    releaseLock();
  });
