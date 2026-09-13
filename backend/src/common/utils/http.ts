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
      if (response.ok) return response;
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
