import { NormalizedEvent } from '@prisma/client';
import { normalizeText, publisherOf, tokenize } from '../common/utils/text';

const NON_NEWS_PATTERN = /\b(?:price today|market\s?cap|charts? and fundamentals|page \d+|presale|top \d+ .{0,30} to (?:watch|buy)|convert .{1,80} to (?:us dollar|usd|cad|bdt|eur|gbp))\b/i;

export interface EvidenceValidation {
  valid: boolean;
  reasons: string[];
  evidenceCount: number;
  sourceCount: number;
  platformCount: number;
  publisherCount: number;
  independentEvidenceCount: number;
}

export function validateEvidence(
  events: NormalizedEvent[],
  sourceCount: number,
  options: { requireCorroboration?: boolean; maxAgeHours?: number; allowLeadingIndicator?: boolean; allowSocialViral?: boolean } = {},
): EvidenceValidation {
  const reasons: string[] = [];
  const maxAgeHours = options.maxAgeHours ?? 72;
  const now = Date.now();
  const bypassCorroboration = Boolean(options.allowLeadingIndicator || options.allowSocialViral);
  const usable = events.filter((event) => {
    const publishedTime = event.publishedAt ? new Date(event.publishedAt).getTime() : now;
    const ageHours = (now - publishedTime) / 3_600_000;
    return (event.title ?? '').trim().length >= 2
      && /^https?:\/\//i.test(event.url)
      && ageHours >= -1
      && ageHours <= maxAgeHours;
  });
  const platforms = new Set(usable.map((event) => event.platform));
  const publishers = new Set(usable.map(publisherOf).filter(Boolean));
  const independentEvidence = new Set(usable.map((event) => normalizeText(event.title)).filter(Boolean));
  const nonNewsItems = usable.filter((event) => NON_NEWS_PATTERN.test(event.title));

  if (!usable.length) reasons.push('No recent evidence item has both a usable title and HTTP source URL.');
  if (![...usable].some((event) => !event.duplicateOfId)) reasons.push('All available evidence is marked as duplicate.');
  if (!bypassCorroboration && usable.length && nonNewsItems.length / usable.length >= 0.5) {
    reasons.push('Most evidence appears to be an evergreen price, conversion, list, or promotional page rather than a news event.');
  }
  if (!bypassCorroboration && usable.length && usable.every((event) => tokenize(event.title).length < 2)) {
    reasons.push('The evidence titles are too vague to identify a concrete news event.');
  }
  if (options.requireCorroboration && !bypassCorroboration && independentEvidence.size < 2) {
    reasons.push('The story does not yet have two independently worded evidence reports.');
  } else if (options.requireCorroboration && !bypassCorroboration && sourceCount < 2 && platforms.size < 2 && publishers.size < 2) {
    reasons.push('The story does not yet span two publishers, collectors, or platforms.');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    evidenceCount: usable.length,
    sourceCount,
    platformCount: platforms.size,
    publisherCount: publishers.size,
    independentEvidenceCount: independentEvidence.size,
  };
}
