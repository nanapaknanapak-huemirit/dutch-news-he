import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function ensureSilence(cacheDir, milliseconds = 350) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `silence-${milliseconds}.mp3`);
  if (fs.existsSync(file) && fs.statSync(file).size > 200) return file;
  const seconds = (milliseconds / 1000).toFixed(3);
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      seconds,
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      '64k',
      file,
    ],
    { timeout: 30000 },
  );
  if (result.status !== 0 || !fs.existsSync(file)) {
    throw new Error(`ffmpeg silence generation failed: ${String(result.stderr || '').slice(0, 200)}`);
  }
  return file;
}

export function concatAudio({ files, outPath, pauseMs = 350, cacheDir }) {
  const usable = files.filter((file) => file && fs.existsSync(file) && fs.statSync(file).size > 200);
  if (!usable.length) throw new Error('concatAudio: no usable input files');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const silence = usable.length > 1 ? ensureSilence(cacheDir, pauseMs) : null;

  const inputs = [];
  for (let index = 0; index < usable.length; index += 1) {
    inputs.push(usable[index]);
    if (silence && index < usable.length - 1) inputs.push(silence);
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const input of inputs) args.push('-i', input);
  const streams = inputs.map((_, index) => `[${index}:a]`).join('');
  const filter = `${streams}concat=n=${inputs.length}:v=0:a=1[cat];[cat]loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
  args.push(
    '-filter_complex',
    filter,
    '-map',
    '[out]',
    '-ar',
    '24000',
    '-ac',
    '1',
    '-b:a',
    '64k',
    outPath,
  );

  const result = spawnSync('ffmpeg', args, { timeout: 180000 });
  if (result.status !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`ffmpeg concat failed: ${String(result.stderr || '').slice(0, 300)}`);
  }
  const temporary = `${outPath}.tmp.mp3`;
  fs.renameSync(outPath, temporary);
  fs.renameSync(temporary, outPath);
  return outPath;
}

export function probeDuration(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { timeout: 20000, encoding: 'utf8' },
  );
  if (result.status !== 0) return 0;
  const value = Number.parseFloat(String(result.stdout).trim());
  return Number.isFinite(value) ? value : 0;
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
