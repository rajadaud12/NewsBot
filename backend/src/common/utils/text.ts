import { createHash } from 'node:crypto';
import { Category } from '@prisma/client';
import { CATEGORY_KEYWORDS } from '../constants/topics';

const STOP_WORDS = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'is', 'are', 'was', 'were', 'this', 'that', 'it', 'as', 'by', 'after', 'about', 'new']);

export const normalizeText = (value: string): string => value
  .normalize('NFKD')
  .toLowerCase()
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const tokenize = (value: string): string[] =>
  [...new Set(normalizeText(value).split(' ').filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];

export const extractKeywords = (value: string, limit = 12): string[] =>
  tokenize(value).sort((a, b) => b.length - a.length).slice(0, limit);

export const extractEntities = (value: string, limit = 10): string[] => {
  const matches = value.match(/\b(?:[A-Z][\p{L}\d'’-]+(?:\s+[A-Z][\p{L}\d'’-]+){0,3})\b/gu) ?? [];
  return [...new Set(matches.map((item) => item.trim()))].slice(0, limit);
};

export const inferCategory = (value: string, fallback: Category = Category.GENERAL): Category => {
  const text = normalizeText(value);
  let best: { category: Category; matches: number } = { category: fallback, matches: 0 };
  for (const [category, terms] of Object.entries(CATEGORY_KEYWORDS) as [Category, string[]][]) {
    const padded = ` ${text} `;
    const matches = terms.filter((term) => padded.includes(` ${normalizeText(term)} `)).length;
    if (matches > best.matches) best = { category, matches };
  }
  return best.category;
};

export const canonicalizeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach((key) => url.searchParams.delete(key));
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value.trim();
  }
};

export const fingerprint = (...values: Array<string | undefined>): string =>
  createHash('sha256').update(values.filter(Boolean).map((value) => normalizeText(value!)).join('|')).digest('hex');

export const jaccard = (left: string[], right: string[]): number => {
  const a = new Set(left);
  const b = new Set(right);
  if (!a.size && !b.size) return 1;
  const intersection = [...a].filter((item) => b.has(item)).length;
  return intersection / new Set([...a, ...b]).size;
};

export const levenshteinSimilarity = (left: string, right: string): number => {
  const a = normalizeText(left).slice(0, 300);
  const b = normalizeText(right).slice(0, 300);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
};

export const domainOf = (value: string): string => {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; }
};
