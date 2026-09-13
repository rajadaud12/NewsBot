import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category } from '@prisma/client';
import { MetricsProvider, MetricInput, RawEventInput, TrendSource } from '../../common/types/source';
import { extractEntities, extractKeywords, inferCategory } from '../../common/utils/text';
import { fetchWithRetry } from '../../common/utils/http';

interface RedditPost {
  id: string; name: string; title: string; selftext?: string; author?: string; permalink: string;
  url?: string; thumbnail?: string; created_utc: number; subreddit: string; score?: number;
  num_comments?: number; post_hint?: string;
}

@Injectable()
export class RedditSource implements TrendSource, MetricsProvider {
  readonly name = 'reddit';
  readonly type = 'REDDIT';
  private accessToken = process.env.REDDIT_ACCESS_TOKEN ?? '';
  private accessTokenExpiresAt = 0;
  private observed = new Map<string, RedditPost>();

  constructor(private readonly config: ConfigService) {}
  isEnabled(): boolean {
    return this.config.get<string[]>('enabledSources', []).includes(this.name)
      && Boolean(this.accessToken || (process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET));
  }

  async collect(): Promise<RawEventInput[]> {
    const token = await this.token();
    const subreddits = this.config.get<string[]>('queries.redditSubreddits', []);
    const paths = ['/r/all/rising?limit=100', '/r/all/new?limit=50', ...subreddits.flatMap((sub) => [`/r/${sub}/rising?limit=50`, `/r/${sub}/new?limit=50`])];
    const results = await Promise.allSettled(paths.map(async (path) => {
      const response = await fetchWithRetry(`https://oauth.reddit.com${path}`, { headers: this.headers(token), timeoutMs: 15_000 });
      const data = await response.json() as any;
      return (data?.data?.children ?? []).map((child: any) => child.data as RedditPost);
    }));
    const posts = [...new Map(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []).map((post) => [post.id, post])).values()];
    posts.forEach((post) => this.observed.set(post.id, post));
    return posts.map((post) => this.toRaw(post));
  }

  async normalize(event: RawEventInput) {
    const title = event.title || 'Untitled Reddit post';
    const subreddit = String(event.metadata?.subreddit ?? '');
    return {
      platform: 'reddit', externalId: event.externalId, title, content: event.content,
      author: event.author, url: event.url!, mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()), language: event.language ?? 'en',
      category: subreddit.toLowerCase() === 'outoftheloop' ? Category.REDDIT_TRENDS : inferCategory(`${title} ${event.content ?? ''}`, Category.REDDIT_TRENDS),
      entities: event.entities ?? extractEntities(title), keywords: event.keywords ?? extractKeywords(`${title} ${event.content ?? ''}`),
      metadata: { ...event.metadata, isTrendLead: subreddit.toLowerCase() === 'outoftheloop' },
    };
  }

  async collectMetrics(eventIds: string[]): Promise<MetricInput[]> {
    return eventIds.flatMap((externalId) => {
      const post = this.observed.get(externalId);
      return post ? [{ externalId, observedAt: new Date(), redditScore: post.score, redditComments: post.num_comments, comments: post.num_comments, raw: { subreddit: post.subreddit } }] : [];
    });
  }

  async getTopComments(externalId: string, limit = 5): Promise<string[]> {
    if (!this.isEnabled()) return [];
    const response = await fetchWithRetry(`https://oauth.reddit.com/comments/${encodeURIComponent(externalId)}?sort=top&limit=${limit}`, { headers: this.headers(await this.token()) });
    const data = await response.json() as any[];
    return (data?.[1]?.data?.children ?? []).map((child: any) => child.data?.body).filter(Boolean).slice(0, limit);
  }

  private toRaw(post: RedditPost): RawEventInput {
    const redditUrl = `https://www.reddit.com${post.permalink}`;
    const mediaUrl = post.post_hint === 'image' ? post.url : undefined;
    return {
      externalId: post.id, title: post.title, content: post.selftext, author: post.author,
      url: redditUrl, mediaUrl, publishedAt: new Date(post.created_utc * 1000),
      metrics: { redditScore: post.score, redditComments: post.num_comments, comments: post.num_comments },
      metadata: { subreddit: post.subreddit, outboundUrl: post.url }, payload: post as unknown as Record<string, unknown>,
    };
  }

  private headers(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}`, 'User-Agent': process.env.REDDIT_USER_AGENT ?? 'viral-news-intelligence/1.0' };
  }

  private async token(): Promise<string> {
    if (this.accessToken && (process.env.REDDIT_ACCESS_TOKEN || Date.now() < this.accessTokenExpiresAt)) return this.accessToken;
    const clientId = process.env.REDDIT_CLIENT_ID;
    const secret = process.env.REDDIT_CLIENT_SECRET;
    if (!clientId || !secret) throw new Error('Reddit credentials are not configured');
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const response = await fetchWithRetry('https://www.reddit.com/api/v1/access_token', {
      method: 'POST', body, headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`, 'User-Agent': process.env.REDDIT_USER_AGENT ?? 'viral-news-intelligence/1.0' },
    });
    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(60, data.expires_in - 60) * 1000;
    return this.accessToken;
  }
}
