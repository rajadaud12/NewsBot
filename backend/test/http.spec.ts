import { verifyPublicHttpUrl } from '../src/common/utils/http';

describe('public URL verification', () => {
  it.each([
    'http://127.0.0.1/private',
    'http://10.1.2.3/private',
    'http://192.168.1.2/private',
    'http://localhost/private',
  ])('rejects private destinations: %s', async (url) => {
    await expect(verifyPublicHttpUrl(url)).resolves.toBeUndefined();
  });
});
