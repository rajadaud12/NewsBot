import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category } from '@prisma/client';
import { RawEventInput, TrendSource } from '../../common/types/source';
import { extractKeywords } from '../../common/utils/text';
import { fetchWithRetry } from '../../common/utils/http';

@Injectable()
export class TikTokCreativeCenterSource implements TrendSource {
  readonly name = 'tiktok';
  readonly type = 'TIKTOK_CREATIVE_CENTER';
  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return this.config.get<string[]>('enabledSources', []).includes(this.name) && Boolean(process.env.TIKTOK_CREATIVE_CENTER_FEED_URL);
  }

  async collect(): Promise<RawEventInput[]> {
    const feedUrl = process.env.TIKTOK_CREATIVE_CENTER_FEED_URL;
    if (!feedUrl) return [];
    const response = await fetchWithRetry(feedUrl, { timeoutMs: 20_000 });
    const body = await response.json() as any;
    const items = Array.isArray(body) ? body : body.items ?? body.data ?? [];
    return items.map((item: any, index: number) => {
      const kind = String(item.type ?? item.kind ?? 'hashtag').toLowerCase();
      const title = String(item.title ?? item.name ?? item.hashtag ?? item.soundName ?? item.creatorName ?? 'TikTok trend');
      return {
        externalId: String(item.id ?? item.externalId ?? `${kind}:${title}:${index}`), title,
        content: item.description, author: item.creatorName ?? item.author,
        url: item.url ?? item.shareUrl ?? 'https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en',
        mediaUrl: item.coverUrl, publishedAt: item.publishedAt ? new Date(item.publishedAt) : new Date(),
        category: kind === 'sound' ? Category.TIKTOK_SOUNDS : Category.MEMES,
        metrics: { views: item.views, likes: item.likes, comments: item.comments, shares: item.shares, mentionCount: item.videoCount },
        metadata: { kind, rank: item.rank, region: item.region, videoCount: item.videoCount }, payload: item,
      } satisfies RawEventInput;
    });
  }

  async normalize(event: RawEventInput) {
    return {
      platform: 'tiktok', externalId: event.externalId, title: event.title!, content: event.content,
      author: event.author, url: event.url!, mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()), language: event.language,
      category: event.category ?? Category.MEMES, entities: event.entities ?? [],
      keywords: event.keywords ?? extractKeywords(`${event.title} ${event.content ?? ''}`), metadata: event.metadata,
    };
  }
}
