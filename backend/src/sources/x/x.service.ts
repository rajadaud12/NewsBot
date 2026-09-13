import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Prisma } from '@prisma/client';
import { RawEventInput, TrendSource } from '../../common/types/source';
import { extractEntities, extractKeywords, inferCategory } from '../../common/utils/text';
import { fetchWithRetry } from '../../common/utils/http';
import { PrismaService } from '../../database/prisma.service';

interface XQueryPlan { index: number; query: string; sinceId?: string }
interface XQueryResult { index: number; query: string; newestId?: string; events: RawEventInput[] }
interface XCollectionResult { events: RawEventInput[]; failures: string[]; results: XQueryResult[] }
interface XOptimizationState {
  nextQueryIndex: number;
  sinceIds: Record<string, string>;
  utcDay: string;
  dailyPostsRead: number;
  dailyPostBudget: number;
  maxResults: number;
  queriesPerRun: number;
  lastRunAt: string;
  lastFetched: number;
  lastQueries: string[];
  lastSkippedReason: string | null;
}

@Injectable()
export class XSource implements TrendSource {
  readonly name = 'x';
  readonly type = 'X';
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}
  isEnabled(): boolean {
    const hasCredentials = Boolean(process.env.X_BEARER_TOKEN || (process.env.X_API_KEY && process.env.X_API_SECRET));
    return this.config.get<string[]>('enabledSources', []).includes(this.name) && hasCredentials && this.config.get<string[]>('queries.x', []).length > 0;
  }

  async collect(): Promise<RawEventInput[]> {
    if (!this.isEnabled()) return [];
    const queries = this.config.get<string[]>('queries.x', []);
    const configuration = await this.sourceConfiguration();
    const storedState = this.optimizationState(configuration);
    const previous = { ...storedState, sinceIds: await this.seedSinceIds(queries, storedState.sinceIds) };
    const today = new Date().toISOString().slice(0, 10);
    const dailyPostBudget = this.config.get<number>('collection.x.dailyPostBudget', 200);
    const maxResults = this.config.get<number>('collection.x.maxResults', 10);
    const queriesPerRun = Math.min(queries.length, this.config.get<number>('collection.x.queriesPerRun', 1));
    const databasePostsToday = await this.postsCollectedToday();
    const dailyPostsRead = previous.utcDay === today ? Math.max(previous.dailyPostsRead, databasePostsToday) : databasePostsToday;
    const remaining = Math.max(0, dailyPostBudget - dailyPostsRead);
    const allowedQueries = Math.min(queriesPerRun, Math.floor(remaining / maxResults));
    if (!dailyPostBudget || allowedQueries < 1) {
      await this.saveOptimization(configuration, {
        ...previous, utcDay: today, dailyPostsRead, dailyPostBudget, maxResults, queriesPerRun,
        lastRunAt: new Date().toISOString(), lastFetched: 0, lastQueries: [],
        lastSkippedReason: `Daily X post-read budget reached (${dailyPostsRead}/${dailyPostBudget}).`,
      });
      return [];
    }
    const startIndex = previous.nextQueryIndex % queries.length;
    const plan: XQueryPlan[] = Array.from({ length: allowedQueries }, (_, offset) => {
      const index = (startIndex + offset) % queries.length;
      return { index, query: queries[index], sinceId: previous.sinceIds[String(index)] };
    });
    const configuredToken = process.env.X_BEARER_TOKEN;
    let token = configuredToken || await this.appBearerToken();
    let collected = await this.collectWithToken(token, plan, maxResults);
    if (!collected.events.length && collected.failures.some((message) => message.includes('HTTP 401')) && process.env.X_API_KEY && process.env.X_API_SECRET) {
      token = await this.appBearerToken();
      collected = await this.collectWithToken(token, plan, maxResults);
    }
    if (!collected.events.length && collected.failures.length) {
      throw new Error(`X recent search failed: ${collected.failures.join(' | ')}`);
    }
    const events = [...new Map(collected.events.map((event) => [event.externalId, event])).values()];
    const sinceIds = { ...previous.sinceIds };
    for (const result of collected.results) if (result.newestId) sinceIds[String(result.index)] = result.newestId;
    await this.saveOptimization(configuration, {
      nextQueryIndex: (plan[plan.length - 1].index + 1) % queries.length,
      sinceIds, utcDay: today, dailyPostsRead: Math.min(dailyPostBudget, dailyPostsRead + events.length),
      dailyPostBudget, maxResults, queriesPerRun, lastRunAt: new Date().toISOString(),
      lastFetched: events.length, lastQueries: plan.map(({ query }) => query), lastSkippedReason: null,
    });
    return events;
  }

  private async collectWithToken(token: string, plan: XQueryPlan[], maxResults: number): Promise<XCollectionResult> {
    const batches = await Promise.allSettled(plan.map(async ({ index, query, sinceId }) => {
      const params = new URLSearchParams({ query: `${query} -is:retweet`, max_results: String(maxResults), 'tweet.fields': 'created_at,lang,public_metrics,entities,author_id', sort_order: 'recency' });
      if (sinceId) params.set('since_id', sinceId);
      const response = await fetchWithRetry(`https://api.x.com/2/tweets/search/recent?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json() as any;
      const events = (data.data ?? []).map((tweet: any) => ({
        externalId: tweet.id, title: String(tweet.text).slice(0, 180), content: tweet.text,
        author: tweet.author_id, url: `https://x.com/i/web/status/${tweet.id}`, publishedAt: tweet.created_at,
        language: tweet.lang, metrics: { likes: tweet.public_metrics?.like_count, comments: tweet.public_metrics?.reply_count, reposts: tweet.public_metrics?.retweet_count, quotes: tweet.public_metrics?.quote_count },
        metadata: { query }, payload: tweet,
      } satisfies RawEventInput));
      return { index, query, newestId: data.meta?.newest_id, events } satisfies XQueryResult;
    }));
    const results = batches.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    return {
      events: results.flatMap((result) => result.events), results,
      failures: batches.flatMap((result) => result.status === 'rejected' ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []),
    };
  }

  private async postsCollectedToday(): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.prisma.rawEvent.count({ where: { source: { name: this.name }, collectedAt: { gte: start } } });
  }

  private async seedSinceIds(queries: string[], stored: Record<string, string>): Promise<Record<string, string>> {
    if (queries.every((_, index) => stored[String(index)])) return stored;
    const events = await this.prisma.normalizedEvent.findMany({
      where: { platform: 'x' }, orderBy: { publishedAt: 'desc' }, take: 1_000,
      select: { externalId: true, metadata: true },
    });
    const sinceIds = { ...stored };
    for (const event of events) {
      const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata as Record<string, unknown>
        : {};
      const index = queries.indexOf(String(metadata.query ?? ''));
      if (index < 0) continue;
      const key = String(index);
      const current = sinceIds[key];
      if (!current || this.comparePostIds(event.externalId, current) > 0) sinceIds[key] = event.externalId;
    }
    return sinceIds;
  }

  private comparePostIds(left: string, right: string): number {
    try { return BigInt(left) > BigInt(right) ? 1 : BigInt(left) < BigInt(right) ? -1 : 0; }
    catch { return left.localeCompare(right); }
  }

  private async sourceConfiguration(): Promise<Record<string, unknown>> {
    const source = await this.prisma.source.findUnique({ where: { name: this.name }, select: { configuration: true } });
    return source?.configuration && typeof source.configuration === 'object' && !Array.isArray(source.configuration)
      ? source.configuration as Record<string, unknown>
      : {};
  }

  private optimizationState(configuration: Record<string, unknown>): XOptimizationState {
    const stored = configuration.xOptimization && typeof configuration.xOptimization === 'object' && !Array.isArray(configuration.xOptimization)
      ? configuration.xOptimization as Partial<XOptimizationState>
      : {};
    const sinceIds = stored.sinceIds && typeof stored.sinceIds === 'object' && !Array.isArray(stored.sinceIds)
      ? Object.fromEntries(Object.entries(stored.sinceIds).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
      : {};
    return {
      nextQueryIndex: Number(stored.nextQueryIndex ?? 0), sinceIds, utcDay: String(stored.utcDay ?? ''),
      dailyPostsRead: Number(stored.dailyPostsRead ?? 0), dailyPostBudget: Number(stored.dailyPostBudget ?? 0),
      maxResults: Number(stored.maxResults ?? 10), queriesPerRun: Number(stored.queriesPerRun ?? 1),
      lastRunAt: String(stored.lastRunAt ?? ''), lastFetched: Number(stored.lastFetched ?? 0),
      lastQueries: Array.isArray(stored.lastQueries) ? stored.lastQueries.filter((value): value is string => typeof value === 'string') : [],
      lastSkippedReason: typeof stored.lastSkippedReason === 'string' ? stored.lastSkippedReason : null,
    };
  }

  private async saveOptimization(configuration: Record<string, unknown>, state: XOptimizationState): Promise<void> {
    await this.prisma.source.update({
      where: { name: this.name },
      data: { configuration: { ...configuration, xOptimization: state } as unknown as Prisma.InputJsonValue },
    });
  }

  private async appBearerToken(): Promise<string> {
    const apiKey = process.env.X_API_KEY;
    const apiSecret = process.env.X_API_SECRET;
    if (!apiKey || !apiSecret) throw new Error('X_BEARER_TOKEN is invalid and X_API_KEY/X_API_SECRET are unavailable for fallback authentication');
    const encodedKey = encodeURIComponent(apiKey);
    const encodedSecret = encodeURIComponent(apiSecret);
    const response = await fetchWithRetry('https://api.x.com/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${encodedKey}:${encodedSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: 'grant_type=client_credentials',
    });
    const data = await response.json() as { access_token?: string };
    if (!data.access_token) throw new Error('X did not return an app bearer token');
    return data.access_token;
  }

  async normalize(event: RawEventInput) {
    const text = `${event.title ?? ''} ${event.content ?? ''}`;
    return {
      platform: 'x', externalId: event.externalId, title: event.title!, content: event.content,
      author: event.author, url: event.url!, mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()), language: event.language,
      category: event.category ?? inferCategory(text, Category.GENERAL), entities: event.entities ?? extractEntities(text),
      keywords: event.keywords ?? extractKeywords(text), metadata: event.metadata,
    };
  }
}
