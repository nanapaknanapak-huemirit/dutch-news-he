# חדשות הולנד בעברית

Daily digest of Dutch news, translated to Hebrew, with a spoken edition, a podcast feed, and phone access over the local network. Sources: NOS Nieuws, NOS Journaal (NPO 1 / NPO 2), and AT5 Amsterdam.

## How it works

1. NOS items come from the public NOS RSS feed.
2. AT5 items are scraped from the AT5 news listing and article pages.
3. The latest NOS Journaal broadcast is resolved through the NPO Start API. Its Dutch subtitle track (WebVTT) is downloaded and the opening headlines are used as the summary.
4. Headlines and summaries are translated Dutch to Hebrew with the free Google Translate endpoint, with MyMemory as a fallback.
5. A Hebrew speech engine (Google Translate TTS, with `espeak-ng` as an offline fallback) generates a daily bulletin and per-item audio. Audio is cached by content hash, so only new text is synthesized.
6. A static RTL Hebrew site is published atomically to `site/`, together with an Atom feed, a podcast feed, a daily-updates page, and a QR code for the local server.
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
systemctl --user start dutch-news-he.service
journalctl --user -u dutch-news-he -f
```

## Audio

- `site/audio/edition-YYYY-MM-DD.mp3` - the daily bulletin.
- `site/audio/items/<hash>.mp3` - per-story audio, played from the card buttons.
- `cache/tts/` - synthesized chunks (Google TTS limit is about 200 characters per request).
- `cache/audio/items/` - assembled per-story files.
- `cache/audio/editions/` - assembled daily bulletins, kept for the podcast.

The first full audio build takes a few minutes. Later runs reuse cached chunks and files. If Google TTS is rate-limited, `espeak-ng` is used for the affected chunk.

## Phone access and QR

`dutch-news-he-serve.service` runs a small Node static server on port 8787 with HTTP Range support, so audio seeking works.

- Local: `http://localhost:8787/`
- LAN: `http://<LAN-IP>:8787/` (detected at build time)
- mDNS fallback: `http://<hostname>.local:8787/`

Every edition regenerates `site/qr.svg` and the inline QR panel using the current LAN address. The phone must be on the same Wi-Fi network. Override the address with `SITE_URL` in `~/.config/dutch-news-he/notify.env`.

## Telegram push

```bash
node scripts/setup-telegram.mjs
```

1. Create a bot with `@BotFather` and copy its token.
2. Run the command above, paste the token, and send `/start` to the bot.
3. The helper detects the chat ID, sends a test message and the latest bulletin, and writes `~/.config/dutch-news-he/notify.env` with mode `600`.

The daily service loads that file through `EnvironmentFile=`. The push is sent once per edition; `--force-notify` overrides the deduplication.

## Daily schedule

`dutch-news-he.timer` runs every day at 07:00 Europe/Amsterdam with a randomized delay of up to five minutes and `Persistent=true` so a missed run is caught up after login. The build service has a 30-minute timeout to accommodate the first audio build.

Check the schedule and the server:

```bash
systemctl --user list-timers | grep dutch-news
systemctl --user status dutch-news-he-serve.service
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
- `logs/build.log` - update log

## Notes

- The NPO Start, AT5, Google TTS, and Telegram endpoints are unofficial. A failed source, audio chunk, or push does not break the rest of the edition.
- Google Translate and Google TTS are used without an API key. Caches keep repeat runs fast; MyMemory is used for translation if Google fails, and `espeak-ng` for speech.
- The podcast feed contains the daily bulletins only, with enclosure URLs pointing to the LAN address; podcast apps on the phone must be on the same network.
- The site publishes short Hebrew summaries and links to the original Dutch item. Full articles are not republished.
