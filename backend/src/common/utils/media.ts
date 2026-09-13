import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { fetchWithRetry } from './http';

export interface MediaHashes { mediaHash?: string; perceptualHash?: string }

export async function hashRemoteImage(url?: string): Promise<MediaHashes> {
  if (!url) return {};
  try {
    const response = await fetchWithRetry(url, { timeoutMs: 10_000, retries: 1 });
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > 15 * 1024 * 1024) return {};
    const mediaHash = createHash('sha256').update(buffer).digest('hex');
    const pixels = await sharp(buffer).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
    let bits = '';
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? '1' : '0';
    }
    const perceptualHash = BigInt(`0b${bits}`).toString(16).padStart(16, '0');
    return { mediaHash, perceptualHash };
  } catch {
    return {};
  }
}

export const hammingDistance = (left: string, right: string): number => {
  try {
    let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let count = 0;
    while (value) { count += Number(value & 1n); value >>= 1n; }
    return count;
  } catch { return Number.MAX_SAFE_INTEGER; }
};
