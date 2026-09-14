import { hammingDistance, validateRemoteImage } from '../src/common/utils/media';

describe('perceptual media hashes', () => {
  it('measures bit-level distance', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });
});

describe('Telegram image validation', () => {
  it('rejects missing and insecure image URLs without a network request', async () => {
    await expect(validateRemoteImage()).resolves.toBeUndefined();
    await expect(validateRemoteImage('http://example.com/image.jpg')).resolves.toBeUndefined();
  });
});
