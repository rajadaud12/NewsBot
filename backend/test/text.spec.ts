import { Category } from '@prisma/client';
import { canonicalizeUrl, fingerprint, inferCategory, normalizeText } from '../src/common/utils/text';

describe('normalization and deduplication', () => {
  it('normalizes punctuation and case', () => expect(normalizeText('  Viral—CAT!!!  ')).toBe('viral cat'));
  it('removes tracking parameters from canonical URLs', () => expect(canonicalizeUrl('https://example.com/story?utm_source=x&id=4#top')).toBe('https://example.com/story?id=4'));
  it('produces the same fingerprint for superficial title changes', () => expect(fingerprint('Breaking: A Cat!', 'Went Viral')).toBe(fingerprint('breaking a cat', 'went viral')));
  it('matches category terms on word boundaries', () => {
    expect(inferCategory('Competition launches a new STUNT team')).toBe(Category.GENERAL);
    expect(inferCategory('Named cat becomes a viral animal')).toBe(Category.VIRAL_ANIMALS);
  });
});
