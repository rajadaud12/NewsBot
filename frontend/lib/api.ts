const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export async function api<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_URL}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch { return fallback; }
}

export const formatTime = (value?: string): string => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export const humanize = (value?: string): string => value ? value.toLowerCase().replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : '—';
export const telegramPlainText = (value: string): string => value
  .replace(/<br\s*\/?\s*>/gi, '\n')
  .replace(/<\/p>/gi, '\n\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
