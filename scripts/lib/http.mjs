import { setTimeout as sleep } from 'node:timers/promises';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 DutchNewsHE/1.0';

export async function request(url, options = {}) {
  const {
    headers = {},
    timeout = 30000,
    retries = 3,
    method = 'GET',
    body,
    allowStatus = [],
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'nl-NL,nl;q=0.9,en;q=0.5',
          ...headers,
        },
      });
      clearTimeout(timer);
      if (response.status >= 500 && attempt < retries) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (!response.ok && !allowStatus.includes(response.status)) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} ${response.statusText} ${text.slice(0, 200)}`);
      }
      return response;
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < retries) await sleep(700 * (attempt + 1));
    }
  }
  throw lastError;
}

export async function requestJson(url, options = {}) {
  const response = await request(url, {
    ...options,
    headers: { accept: 'application/json', ...(options.headers || {}) },
  });
  if (response.status === 304) return { notModified: true, response };
  return { data: await response.json(), response };
}
