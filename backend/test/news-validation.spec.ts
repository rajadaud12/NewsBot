import { Category } from '@prisma/client';
import { validateEvidence } from '../src/alerts/news-validation';

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1', rawEventId: 'raw-1', platform: 'news', externalId: 'external-1', title: 'A supported news report',
  normalizedTitle: 'a supported news report', content: null, author: null, url: 'https://example.com/report',
  canonicalUrl: 'https://example.com/report', mediaUrl: null, mediaHash: null, perceptualHash: null,
  publishedAt: new Date(), firstSeenAt: new Date(), lastSeenAt: new Date(), language: 'en', category: Category.GENERAL,
  entities: [], keywords: [], contentFingerprint: 'hash', duplicateOfId: null, metadata: null, ...overrides,
});

describe('news evidence validation', () => {
  it('passes recent, corroborated evidence', () => {
    const result = validateEvidence([event(), event({ id: 'event-2', title: 'Council confirms approval of the new public park', canonicalUrl: 'https://other.example/report' })] as any, 2, { requireCorroboration: true });
    expect(result.valid).toBe(true);
  });

  it('rejects stale or uncorroborated evidence', () => {
    const stale = validateEvidence([event({ publishedAt: new Date(Date.now() - 96 * 3_600_000) })] as any, 1, { requireCorroboration: true });
    expect(stale.valid).toBe(false);
    expect(stale.reasons.length).toBeGreaterThan(0);
  });
  it('rejects static price and conversion pages before spending an LLM call', () => {
    const result = validateEvidence([
      event({ title: 'Convert Example Tokenized Stock to US dollar', canonicalUrl: 'https://one.example/convert' }),
      event({ id: 'event-2', title: 'Example Tokenized Stock price today and marketcap', canonicalUrl: 'https://two.example/price' }),
    ] as any, 2, { requireCorroboration: true });
    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toContain('evergreen');
  });
});
