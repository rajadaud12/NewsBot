import { Injectable } from '@nestjs/common';
import { RawEventInput, TrendSource } from '../../common/types/source';

/** Contract-only provider for the credentialed TikTok Research API. It is intentionally
 * disabled until the user supplies approved API access; no scraping or fake data is used. */
@Injectable()
export class TikTokResearchSource implements TrendSource {
  readonly name = 'tiktok-research';
  readonly type = 'TIKTOK_RESEARCH';
  isEnabled(): boolean { return false; }
  async collect(): Promise<RawEventInput[]> { return []; }
  async normalize(): Promise<never> { throw new Error('TikTok Research API access is not configured'); }
}
