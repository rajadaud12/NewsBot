import { hammingDistance } from '../src/common/utils/media';

describe('perceptual media hashes', () => {
  it('measures bit-level distance', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });
});
