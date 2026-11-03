# חדשות הולנד בעברית

<div align="center">

![QR Code](qr_code.svg)

**📱 Scan to open the live site on your phone!**

[🔗 Live site](https://nanapaknanapak-huemirit.github.io/dutch-news-he/)

</div>

Daily digest of Dutch news, translated to Hebrew, with a spoken edition, a podcast feed, and phone access. Sources: NOS Nieuws, NOS Journaal (NPO 1 / NPO 2), and AT5 Amsterdam.

## How it works

1. NOS items come from the public NOS RSS feed.
2. AT5 items are scraped from the AT5 news listing and article pages.
3. The latest NOS Journaal broadcast is resolved through the NPO Start API. Its Dutch subtitle track (WebVTT) is downloaded and the opening headlines are used as the summary.
4. Headlines and summaries are translated Dutch to Hebrew with the free Google Translate endpoint, with MyMemory as a fallback.
5. A Hebrew speech engine (Google Translate TTS, with `espeak-ng` as an offline fallback) generates a daily bulletin and per-item audio. Audio is cached by content hash, so only new text is synthesized.
6. A static RTL Hebrew site is published atomically to `site/`, together with an Atom feed, a podcast feed, a daily-updates page, and a QR code for the configured site address.
7. If Telegram is configured, the bulletin MP3 and the top headlines are pushed to the configured chat once per edition.

## Commands

```bash
npm run update       # generate or update today's edition (includes audio)
npm run build:fast   # update without generating audio
npm run dry-run      # fetch and translate without publishing
npm run check        # validate the site, feeds, audio, QR, and status
npm run serve        # serve the site on http://localhost:8787 and the LAN
npm run telegram     # interactive Telegram bot setup
```

Manual systemd run:

```bash
systemctl --user start dutch-news-he.service   # build, then deploy after success
journalctl --user -u dutch-news-he -f
```

## Audio

- `site/audio/edition-YYYY-MM-DD.mp3` - the daily bulletin.
- `site/audio/items/<hash>.mp3` - per-story audio, played from the card buttons.
- `cache/tts/` - synthesized chunks (Google TTS limit is about 200 characters per request).
- `cache/audio/items/` - assembled per-story files.
- `cache/audio/editions/` - assembled daily bulletins, kept for the podcast.

The first full audio build takes a few minutes. Later runs reuse cached chunks and files. If Google TTS is rate-limited, `espeak-ng` is used for the affected chunk.

## Web and phone access

Public site: https://nanapaknanapak-huemirit.github.io/dutch-news-he/

`dutch-news-he-serve.service` also runs a small Node static server on port 8787 with HTTP Range support, so audio seeking works on the local network.

- Local: `http://localhost:8787/`
- LAN: `http://<LAN-IP>:8787/` (detected at build time)
- mDNS: `http://<hostname>.local:8787/` (when available)

`SITE_URL` in `~/.config/dutch-news-he/notify.env` is set to the public Pages URL. Every edition regenerates `site/qr.svg` and the inline QR panel for that URL, and the podcast enclosures and Telegram links use it too. The committed `qr_code.svg` at the top of this README is a static snapshot of the same public QR; regenerate it if the Pages URL changes.

The local mirror requires the phone and computer to be on the same Wi-Fi. The Pages site works from any network.

## Telegram push

```bash
node scripts/setup-telegram.mjs
```

1. Create a bot with `@BotFather` and copy its token.
2. Run the command above, paste the token, and send `/start` to the bot.
3. The helper detects the chat ID, sends a test message and the latest bulletin, and writes `~/.config/dutch-news-he/notify.env` with mode `600`.

The daily service loads that file through `EnvironmentFile=`. The push is sent once per edition; `--force-notify` overrides the deduplication.

## Daily schedule

`dutch-news-he.timer` runs every day at 07:00 Europe/Amsterdam with a randomized delay of up to five minutes and `Persistent=true` so a missed run is caught up after login. The build service has a 30-minute timeout to accommodate the first audio build. After a successful build, `dutch-news-he-deploy.service` force-pushes `site/` to the `gh-pages` branch, which GitHub Pages serves.

Check the schedule, server, and deploy:

```bash
systemctl --user list-timers | grep dutch-news
systemctl --user status dutch-news-he-serve.service
systemctl --user status dutch-news-he-deploy.service
```

Disable them:

```bash
systemctl --user disable --now dutch-news-he.timer
systemctl --user disable --now dutch-news-he-serve.service
```

The timer runs while the user is logged in. For updates while logged out:

```bash
loginctl enable-linger "$USER"
```

The public site is static and updates only while the host is online. If the host is off, the last deployed edition remains available.

Deployment details:

- Pages source: the `gh-pages` branch root.
- Deploy key: `~/.ssh/dutch-news-he-pages` with write access to this repository.
- `scripts/deploy-pages.sh` refuses to publish if the configured Pages URL is missing from `site/index.html`.
- Only `gh-pages` is force-pushed; `main` is never force-pushed.

## Files

- `data/items.json` - rolling store of items and translations
- `data/state.json` - incremental fetch state and ETags
- `data/status.json` - last attempt, last success, source health, audio status, next run
- `data/runs.json` - recent build history shown on the updates page
- `data/notify.json` - Telegram deduplication state
- `data/editions/` - one snapshot per daily edition
- `cache/translations.json` - translation cache keyed by text hash
- `cache/subtitles/` - downloaded NOS Journaal subtitles
- `cache/tts/`, `cache/audio/` - speech chunk and audio caches
- `site/` - published site, `feed.xml`, `podcast.xml`, `updates.html`, `qr.svg`, and `audio/`
- `qr_code.svg` - static README QR for the public site
- `scripts/deploy-pages.sh` - deploy `site/` to the `gh-pages` branch
- `logs/build.log` - update log

## Notes

- The NPO Start, AT5, Google TTS, and Telegram endpoints are unofficial. A failed source, audio chunk, or push does not break the rest of the edition.
- Google Translate and Google TTS are used without an API key. Caches keep repeat runs fast; MyMemory is used for translation if Google fails, and `espeak-ng` for speech.
- The podcast feed contains the daily bulletins only; enclosure URLs use `SITE_URL` (the public Pages URL).
- The site publishes short Hebrew summaries and links to the original Dutch item. Full articles are not republished.
