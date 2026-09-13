import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category } from '@prisma/client';
import { RawEventInput, TrendSource } from '../../common/types/source';
import { extractEntities, extractKeywords, inferCategory } from '../../common/utils/text';
import { fetchWithRetry } from '../../common/utils/http';
import { PrismaService } from '../../database/prisma.service';

interface GdeltArticle {
  url: string;
  url_mobile?: string;
  title: string;
  seendate?: string;
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

@Injectable()
export class GdeltSource implements TrendSource {
  readonly name = 'gdelt';
  readonly type = 'GDELT';
  private readonly logger = new Logger(GdeltSource.name);

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  isEnabled(): boolean { return this.config.get<string[]>('enabledSources', []).includes(this.name); }

  async collect(): Promise<RawEventInput[]> {
    const watchlistItems = await this.prisma.watchlistItem.findMany({ where: { enabled: true, watchlist: { enabled: true } }, select: { value: true }, take: 50 });
    const terms = [...new Set([...this.config.get<string[]>('queries.gdelt', []), ...watchlistItems.map((item) => item.value)])];
    const queries = this.compoundQueries(terms);
    const events: RawEventInput[] = [];
    const failures: string[] = [];
    let previousStartedAt = 0;
    for (const query of queries) {
      const waitMs = Math.max(0, 5_250 - (Date.now() - previousStartedAt));
      if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
      previousStartedAt = Date.now();
      try { events.push(...await this.fetchQuery(query)); }
      catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    if (!events.length && failures.length) throw new Error(`GDELT collection failed: ${failures.join(' | ')}`);
    if (failures.length) this.logger.warn(`GDELT completed with ${failures.length}/${queries.length} query batches rejected: ${failures.join(' | ')}`);
    return this.unique(events);
  }

  private async fetchQuery(query: string): Promise<RawEventInput[]> {
    const params = new URLSearchParams({ query, mode: 'ArtList', format: 'json', maxrecords: '100', sort: 'DateDesc', timespan: '24h' });
    const response = await fetchWithRetry(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, { timeoutMs: 30_000, retries: 0 });
    const body = await response.text();
    let data: { articles?: GdeltArticle[] };
    try { data = JSON.parse(body) as { articles?: GdeltArticle[] }; }
    catch { throw new Error(`GDELT returned a non-JSON response: ${body.slice(0, 300)}`); }
    return (data.articles ?? []).map((article) => ({
      externalId: article.url,
      title: article.title,
      url: article.url,
      mediaUrl: article.socialimage,
      publishedAt: this.parseDate(article.seendate),
      language: article.language,
      category: inferCategory(article.title, Category.GENERAL),
      metadata: { query, domain: article.domain, sourceCountry: article.sourcecountry },
      payload: article as unknown as Record<string, unknown>,
    } satisfies RawEventInput));
  }

  async normalize(event: RawEventInput) {
    const title = event.title?.trim() || 'Untitled GDELT event';
    return {
      platform: 'news', externalId: event.externalId, title, content: event.content,
      author: event.author, url: event.url!, mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()), language: event.language,
      category: event.category ?? inferCategory(`${title} ${event.content ?? ''}`, Category.GENERAL),
      entities: event.entities ?? extractEntities(title),
      keywords: event.keywords ?? extractKeywords(`${title} ${event.content ?? ''}`), metadata: event.metadata,
    };
  }

  private parseDate(value?: string): Date {
    if (!value) return new Date();
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return match ? new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`) : new Date(value);
  }

  private unique(events: RawEventInput[]): RawEventInput[] {
    return [...new Map(events.map((event) => [event.externalId, event])).values()];
  }

  private compoundQueries(terms: string[]): string[] {
    const queries: string[] = [];
    let selected: string[] = [];
    for (const term of terms.slice(0, 36)) {
      const cleaned = term.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleaned || cleaned.split(' ').length < 2) continue;
      const candidate = [...selected, `"${cleaned}"`];
      if (`(${candidate.join(' OR ')})`.length > 180) {
        if (selected.length) queries.push(`(${selected.join(' OR ')})`);
        selected = [];
      }
      selected.push(`"${cleaned}"`);
    }
    if (selected.length) queries.push(`(${selected.join(' OR ')})`);
    return queries.slice(0, 4);
  }
}
