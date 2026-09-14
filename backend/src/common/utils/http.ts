import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

const transient = (status: number): boolean => status === 408 || status === 429 || status >= 500;
class NonRetryableHttpError extends Error {}

export async function fetchWithRetry(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 15_000, retries = 3, ...request } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { ...request, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || response.status === 304) return response;
      if (!transient(response.status) || attempt === retries) {
        const ErrorType = transient(response.status) ? Error : NonRetryableHttpError;
        throw new ErrorType(`HTTP ${response.status} ${response.statusText}: ${(await response.text()).slice(0, 500)}`);
      }
      let retryAfter = Number(response.headers.get('retry-after'));
      if (response.status === 429 && !Number.isFinite(retryAfter)) {
        try { retryAfter = Number((await response.clone().json() as any)?.parameters?.retry_after); } catch { /* use exponential fallback */ }
      }
      await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 500 * (2 ** attempt)));
    } catch (error) {
      lastError = error;
      if (error instanceof NonRetryableHttpError) throw error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

export interface VerifiedHttpUrl {
  originalUrl: string;
  finalUrl: string;
  status: number;
}

const verificationCache = new Map<string, { expiresAt: number; result?: VerifiedHttpUrl }>();

function isPrivateAddress(address: string): boolean {
  if (address === '::1' || address === '::' || address.toLowerCase().startsWith('fe80:') || address.toLowerCase().startsWith('fc') || address.toLowerCase().startsWith('fd')) return true;
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224;
}

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) URLs are allowed');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('Private hosts are not allowed');
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private IP addresses are not allowed');
  } else {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Host did not resolve exclusively to public addresses');
  }
  return url;
}

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

/** Resolves a news link without trusting redirects to private networks. The small
 * in-memory cache prevents every Telegram edition from re-checking the same URL. */
export async function verifyPublicHttpUrl(value: string, timeoutMs = 8_000): Promise<VerifiedHttpUrl | undefined> {
  const cached = verificationCache.get(value);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const originalUrl = value;
  let current = value;
  const headers = {
    'User-Agent': BROWSER_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const url = await assertPublicUrl(current);
      let response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers });
      if (response.status === 403 || response.status === 405 || response.status === 400) {
        response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers });
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect did not include a destination');
        current = new URL(location, url).toString();
        continue;
      }
      if (response.status >= 200 && response.status < 300) {
        const result = { originalUrl, finalUrl: current, status: response.status };
        verificationCache.set(value, { expiresAt: Date.now() + 3_600_000, result });
        return result;
      }
      break;
    }
  } catch {
    // A failed reachability check simply removes the link from an outgoing alert.
  }
  verificationCache.set(value, { expiresAt: Date.now() + 300_000 });
  return undefined;
}
