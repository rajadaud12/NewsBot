import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { XMLParser } from 'fast-xml-parser';
import { Category } from '@prisma/client';
import { RawEventInput, TrendSource } from '../../common/types/source';
import { extractEntities, extractKeywords, inferCategory } from '../../common/utils/text';
import { fetchWithRetry } from '../../common/utils/http';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class GoogleNewsSource implements TrendSource {
  readonly name = 'google-news';
  readonly type = 'GOOGLE_NEWS';
  private readonly parser = new XMLParser({ ignoreAttributes: false });
  private watchlistCursor = 0;

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}
  isEnabled(): boolean { return this.config.get<string[]>('enabledSources', []).includes(this.name); }

  async collect(): Promise<RawEventInput[]> {
    const configured = this.config.get<string[]>('queries.googleNews', []);
    const maxQueries = Math.min(50, Math.max(configured.length, Number(process.env.GOOGLE_NEWS_MAX_QUERIES_PER_RUN) || 36));
    const watchlists = await this.prisma.watchlist.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
      select: { items: { where: { enabled: true }, orderBy: { value: 'asc' }, select: { value: true } } },
    });
    const interleaved: string[] = [];
    const longest = Math.max(0, ...watchlists.map((list) => list.items.length));
    for (let itemIndex = 0; itemIndex < longest; itemIndex += 1) {
      for (const list of watchlists) if (list.items[itemIndex]) interleaved.push(list.items[itemIndex].value);
    }
    const availableSlots = Math.max(0, maxQueries - configured.length);
    const rotating = Array.from({ length: Math.min(availableSlots, interleaved.length) }, (_, index) => interleaved[(this.watchlistCursor + index) % interleaved.length]);
    if (interleaved.length) this.watchlistCursor = (this.watchlistCursor + rotating.length) % interleaved.length;
    const queries = [...new Set([...configured, ...rotating])].slice(0, maxQueries);
    const lookbackHours = this.config.get<number>('collection.googleNewsLookbackHours', 48);
    const cutoff = Date.now() - lookbackHours * 3_600_000;
    const settled = await Promise.allSettled(queries.map(async (query) => {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${Math.max(1, Math.ceil(lookbackHours / 24))}d`)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetchWithRetry(url, { timeoutMs: 15_000 });
      const parsed = this.parser.parse(await response.text());
      const items = parsed?.rss?.channel?.item ?? [];
      return (Array.isArray(items) ? items : [items]).filter((item: any) => !item.pubDate || new Date(item.pubDate).getTime() >= cutoff).map((item: any) => {
        const title = String(item.title ?? '');
        const content = String(item.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return {
          externalId: String(item.guid?.['#text'] ?? item.guid ?? item.link), title, content,
          author: String(item.source?.['#text'] ?? item.source ?? ''),
          url: String(item.link),
          publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
          category: inferCategory(`${title} ${content} ${query}`, Category.GENERAL),
          metadata: { query, publisherUrl: item.source?.['@_url'] },
          payload: item as Record<string, unknown>,
        } satisfies RawEventInput;
      });
    }));
    return [...new Map(settled.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((event) => [event.externalId, event])).values()];
  }

  async normalize(event: RawEventInput) {
    const title = (event.title || 'Untitled Google News event').replace(/\s+-\s+[^-]+$/, '').trim();
    return {
      platform: 'news', externalId: event.externalId, title, content: event.content,
      author: event.author, url: event.url!, mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()), language: event.language ?? 'en',
      category: event.category ?? inferCategory(`${title} ${event.content ?? ''}`, Category.GENERAL),
      entities: event.entities ?? extractEntities(title),
      keywords: event.keywords ?? extractKeywords(`${title} ${event.content ?? ''}`), metadata: event.metadata,
    };
  }
}
