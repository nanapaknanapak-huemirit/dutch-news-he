import os from 'node:os';
import QRCode from 'qrcode';

export const DEFAULT_PORT = 8787;

function rank(address) {
  if (/^192\.168\./.test(address)) return 0;
  if (/^10\./.test(address)) return 1;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
  return 3;
}

export function detectLanAddress() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    if (/^(lo|docker|veth|virbr|podman|br-|tap|tun)/.test(name)) continue;
    for (const entry of addresses || []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      candidates.push(entry.address);
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => rank(a) - rank(b));
  return candidates[0];
}

export function detectSiteUrl(port = Number(process.env.PORT) || DEFAULT_PORT) {
  if (process.env.SITE_URL) {
    const value = process.env.SITE_URL.trim();
    return value.endsWith('/') ? value : `${value}/`;
  }
  const address = detectLanAddress();
  if (address) return `http://${address}:${port}/`;
  const host = os.hostname().replace(/\.local$/i, '');
  return `http://${host}.local:${port}/`;
}

export async function renderQrSvg(url) {
  return QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 200,
    errorCorrectionLevel: 'M',
    color: { dark: '#1c1a17', light: '#ffffff' },
  });
}
