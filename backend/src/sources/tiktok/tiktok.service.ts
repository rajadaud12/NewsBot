import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Prisma } from '@prisma/client';
import type { Browser, Page } from 'playwright-core';
import { chromium } from 'playwright-core';
import { RawEventInput, TrendSource } from '../../common/types/source';
import { fetchWithRetry } from '../../common/utils/http';
import { extractKeywords } from '../../common/utils/text';
import { PrismaService } from '../../database/prisma.service';

export type TikTokKind = 'hashtag' | 'sound' | 'creator';

export interface TopCreatorInfo {
  handleName?: string;
  nickname?: string;
  followedCnt?: number | string;
  avatarURL?: string;
  creatorRank?: number | string;
  [key: string]: unknown;
}

export interface CreativeCenterItem {
  id?: string | number;
  externalId?: string;
  type?: string;
  kind?: string;
  title?: string;
  name?: string;
  hashtag?: string;
  hashtagName?: string;
  soundName?: string;
  songName?: string;
  creatorName?: string;
  artistName?: string;
  author?: string;
  description?: string;
  url?: string;
  shareUrl?: string;
  coverUrl?: string;
  imageUrl?: string;
  publishedAt?: string;
  rank?: number;
  rankChange?: number;
  region?: string;
  views?: number | string;
  likes?: number | string;
  comments?: number | string;
  shares?: number | string;
  videoCount?: number | string;
  postCount?: number | string;
  publishCnt?: number | string;
  followerCount?: number | string;
  topCreators?: Array<string | TopCreatorInfo>;
  popularityCurve?: Array<{ timestamp: string | number; value: number }>;
  isLeadingIndicator?: boolean;
  leadingIndicatorReason?: string;
  [key: string]: unknown;
}

export interface CollectorState {
  nextAllowedAt?: string;
  blockedUntil?: string;
  etag?: string;
  lastModified?: string;
  lastMode?: string;
  lastItemCount?: number;
  lastAttemptAt?: string;
}

export const CREATIVE_CENTER_ROOT = 'https://ads.tiktok.com/business/creativecenter';
const BLOCKED_STATUS = new Set([403, 429]);

const ROTATING_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

const envNumber = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export function compactMetric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;
  if (typeof value !== 'string') return undefined;
  const match = value.replace(/,/g, '').trim().match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return undefined;
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

export function formatTopCreator(creator: string | TopCreatorInfo): string {
  if (typeof creator === 'string') return creator.trim();
  if (!creator || typeof creator !== 'object') return '';
  const handle = creator.handleName ? `@${creator.handleName.replace(/^@/, '')}` : '';
  const nick = creator.nickname ? creator.nickname.trim() : '';
  const followers = compactMetric(creator.followedCnt);
  const followerStr = followers !== undefined ? (followers >= 1_000_000 ? `${(followers / 1_000_000).toFixed(1)}M` : followers >= 1_000 ? `${(followers / 1_000).toFixed(1)}K` : `${followers}`) : '';
  if (handle && nick && nick.toLowerCase() !== handle.slice(1).toLowerCase()) {
    return `${handle} (${nick}${followerStr ? ` • ${followerStr}` : ''})`;
  }
  if (handle && followerStr) return `${handle} (${followerStr})`;
  return handle || nick || '';
}

export function safeCreativeCenterUrl(value: unknown, fallback: string): string {
  try {
    const candidate = typeof value === 'string' && value.trim() ? value : fallback;
    if (!candidate) return '';
    const url = new URL(candidate, CREATIVE_CENTER_ROOT);
    return url.protocol === 'https:' && (url.hostname === 'ads.tiktok.com' || url.hostname.endsWith('.tiktok.com')) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function itemTitle(item: CreativeCenterItem, kind: TikTokKind): string {
  const value = item.title ?? item.name ?? item.hashtag ?? item.hashtagName ?? item.soundName ?? item.songName ?? item.creatorName;
  const cleaned = String(value ?? 'TikTok trend').replace(/^#/, '').trim();
  return kind === 'hashtag' ? `#${cleaned}` : cleaned;
}

export function extractDehydratedState(html: string, region = 'US'): CreativeCenterItem[] {
  const results: CreativeCenterItem[] = [];
  const scriptBlocks = html.split(/<\/?script[^>]*>/i);
  for (const block of scriptBlocks) {
    if (!block.includes('loaderData') && !block.includes('dehydratedState')) continue;
    try {
      const parsed = JSON.parse(block.trim());
      const queries = parsed?.loaderData?.['creativeCenter/trends/(tab)/page']?.dehydratedState?.queries
        ?? parsed?.dehydratedState?.queries
        ?? [];

      for (const query of queries) {
        const pages = query?.state?.data?.pages ?? [query?.state?.data];
        for (const page of pages) {
          const items = Array.isArray(page?.data) ? page.data : Array.isArray(page) ? page : [];
          for (const item of items) {
            if (item && typeof item === 'object') {
              if (item.hashtagName || item.hashtagID) {
                const creators = Array.isArray(item.topCreators) ? item.topCreators.map(formatTopCreator).filter(Boolean) : [];
                results.push({
                  id: item.hashtagID ? `hashtag:${item.hashtagID}` : undefined,
                  kind: 'hashtag',
                  hashtagName: item.hashtagName,
                  name: item.hashtagName,
                  rank: Number(item.rankIndex) || undefined,
                  videoCount: item.publishCnt,
                  views: item.vv,
                  topCreators: creators,
                  popularityCurve: Array.isArray(item.popularityCurve) ? item.popularityCurve : undefined,
                  region,
                  url: `https://www.tiktok.com/tag/${encodeURIComponent(String(item.hashtagName).replace(/^#/, ''))}`,
                  shareUrl: `https://ads.tiktok.com/creative/creativeCenter/trends/hashtag?region=${region}&period=7`,
                });
              } else if (item.soundName || item.songName || item.musicName) {
                const sound = item.soundName || item.songName || item.musicName;
                const creators = Array.isArray(item.topCreators) ? item.topCreators.map(formatTopCreator).filter(Boolean) : [];
                results.push({
                  id: item.musicID ? `sound:${item.musicID}` : undefined,
                  kind: 'sound',
                  soundName: sound,
                  name: sound,
                  artistName: item.authorName || item.artistName,
                  rank: Number(item.rankIndex) || undefined,
                  videoCount: item.publishCnt || item.videoCount,
                  views: item.playCount || item.views,
                  topCreators: creators,
                  region,
                  url: `https://www.tiktok.com/music/${encodeURIComponent(String(sound).toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`,
                  shareUrl: `https://ads.tiktok.com/creative/creativeCenter/trends/music?region=${region}&period=7`,
                });
              }
            }
          }
        }
      }
    } catch {
      // Non-JSON script blocks are expected and skipped
    }
  }
  return results;
}

export function creativeCenterItemToEvent(item: CreativeCenterItem, index: number, observedAt = new Date()): RawEventInput {
  const rawKind = String(item.type ?? item.kind ?? (item.soundName || item.songName ? 'sound' : item.creatorName ? 'creator' : 'hashtag')).toLowerCase();
  const kind: TikTokKind = rawKind.includes('sound') || rawKind.includes('song') || rawKind.includes('music') ? 'sound' : rawKind.includes('creator') ? 'creator' : 'hashtag';
  const title = itemTitle(item, kind);
  const slug = title.replace(/^#/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || String(index);
  const fallback = kind === 'sound'
    ? `${CREATIVE_CENTER_ROOT}/inspiration/popular/music/pc/en`
    : kind === 'creator'
      ? `${CREATIVE_CENTER_ROOT}/inspiration/popular/creator/pc/en`
      : `${CREATIVE_CENTER_ROOT}/inspiration/popular/hashtag/pc/en`;
  const videoCount = compactMetric(item.videoCount ?? item.postCount ?? item.publishCnt);
  const views = compactMetric(item.views ?? item.vv);
  const author = String(item.artistName ?? item.creatorName ?? item.author ?? '').trim() || undefined;
  const topCreators = Array.isArray(item.topCreators)
    ? item.topCreators.map(formatTopCreator).filter(Boolean).slice(0, 10)
    : [];

  const verifiedUrl = item.url && (item.url.startsWith('https://www.tiktok.com/') || item.url.startsWith('https://ads.tiktok.com/'))
    ? item.url
    : safeCreativeCenterUrl(item.shareUrl ?? item.url, fallback);

  return {
    externalId: String(item.id ?? item.externalId ?? `${kind}:${slug}`),
    title,
    content: item.description ?? `${kind === 'sound' ? '🎵 TikTok Sound' : kind === 'creator' ? '🌟 Creator' : '#️⃣ Hashtag'} ranked${item.rank ? ` #${item.rank}` : ''} on TikTok Creative Center${videoCount !== undefined ? ` with ${videoCount.toLocaleString('en-US')} video creations` : ''}${views !== undefined ? ` and ${views.toLocaleString('en-US')} views` : ''}.`,
    author,
    url: verifiedUrl,
    mediaUrl: safeCreativeCenterUrl(item.coverUrl ?? item.imageUrl, '') || undefined,
    publishedAt: item.publishedAt ? new Date(item.publishedAt) : observedAt,
    category: kind === 'sound' ? Category.TIKTOK_SOUNDS : kind === 'creator' ? Category.VIRAL_PEOPLE : Category.MEMES,
    metrics: {
      views,
      likes: compactMetric(item.likes),
      comments: compactMetric(item.comments),
      shares: compactMetric(item.shares),
      mentionCount: videoCount,
      raw: {
        kind,
        rank: item.rank,
        rankChange: item.rankChange,
        followerCount: compactMetric(item.followerCount),
        topCreators,
        popularityCurve: item.popularityCurve,
        isLeadingIndicator: Boolean(item.isLeadingIndicator),
        leadingIndicatorReason: item.leadingIndicatorReason,
      },
    },
    metadata: {
      kind,
      rank: item.rank,
      rankChange: item.rankChange,
      region: item.region,
      videoCount,
      followerCount: compactMetric(item.followerCount),
      topCreators,
      popularityCurve: item.popularityCurve,
      isLeadingIndicator: Boolean(item.isLeadingIndicator),
      leadingIndicatorReason: item.leadingIndicatorReason,
      observedAt: observedAt.toISOString(),
      source: 'TikTok Creative Center',
    },
    payload: item,
  };
}

@Injectable()
export class TikTokCreativeCenterSource implements TrendSource {
  readonly name = 'tiktok';
  readonly type = 'TIKTOK_CREATIVE_CENTER';
  private readonly logger = new Logger(TikTokCreativeCenterSource.name);
  private inFlight?: Promise<RawEventInput[]>;

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  isEnabled(): boolean {
    return this.config.get<string[]>('enabledSources', []).includes(this.name);
  }

  async collect(): Promise<RawEventInput[]> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.collectOnce().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async collectOnce(): Promise<RawEventInput[]> {
    const state = await this.readState();
    const now = Date.now();
    const blockedUntil = Date.parse(state.blockedUntil ?? '');
    const nextAllowedAt = Date.parse(state.nextAllowedAt ?? '');
    if (Number.isFinite(blockedUntil) && blockedUntil > now) {
      this.logger.warn(`TikTok collection is in respectful backoff until ${new Date(blockedUntil).toISOString()}`);
      return [];
    }
    if (Number.isFinite(nextAllowedAt) && nextAllowedAt > now) return [];

    const mode = process.env.TIKTOK_CREATIVE_CENTER_FEED_URL
      ? 'feed'
      : process.env.APIFY_API_TOKEN
        ? 'apify'
        : (process.env.TIKTOK_COLLECTION_MODE ?? 'ssr');

    await this.writeState({ lastAttemptAt: new Date().toISOString(), lastMode: mode });

    try {
      let items: RawEventInput[] = [];
      if (mode === 'feed') {
        items = await this.collectFeed(state);
      } else if (mode === 'apify') {
        items = await this.collectApify(state);
      } else if (mode === 'browser') {
        items = await this.collectBrowser();
      } else {
        // Default: fast & clean direct SSR extraction, falling back to Playwright if needed
        items = await this.collectSsr(state);
        if (!items.length) {
          this.logger.log('Direct SSR returned no items; attempting Playwright fallback');
          items = await this.collectBrowser().catch((err) => {
            this.logger.warn(`Playwright fallback failed: ${err instanceof Error ? err.message : err}`);
            return [];
          });
        }
      }

      const minInterval = Math.max(600_000, envNumber('TIKTOK_MIN_INTERVAL_MS', 900_000));
      const jitter = Math.floor(Math.random() * Math.max(1, envNumber('TIKTOK_JITTER_MS', 60_000)));
      await this.writeState({
        nextAllowedAt: new Date(Date.now() + minInterval + jitter).toISOString(),
        blockedUntil: undefined,
        lastItemCount: items.length,
        lastMode: mode,
      });

      return this.addRates(items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP (403|429)|ERR_HTTP_RESPONSE_CODE_FAILURE|blocked/i.test(message)) {
        const backoff = Math.max(3_600_000, envNumber('TIKTOK_BLOCK_BACKOFF_MS', 21_600_000));
        await this.writeState({ blockedUntil: new Date(Date.now() + backoff).toISOString(), lastMode: mode });
        throw new Error(`TikTok Creative Center rate limit / backoff triggered; collection paused for ${Math.round(backoff / 3_600_000)} hours.`);
      }
      throw error;
    }
  }

  /**
   * Primary extraction mode: Direct HTTP GET with authentic browser headers,
   * parsing the complete embedded Next.js SSR dehydrated state.
   * This does not invoke headless Chrome and avoids bot-detection triggers.
   */
  async collectSsr(state: CollectorState): Promise<RawEventInput[]> {
    const rawRoot = (process.env.TIKTOK_CREATIVE_CENTER_URL ?? CREATIVE_CENTER_ROOT).replace(/\/$/, '');
    const origin = new URL(rawRoot).origin;
    const region = (process.env.TIKTOK_REGION ?? 'US').replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 2) || 'US';
    const requestedPeriod = envNumber('TIKTOK_PERIOD_DAYS', 7);
    const period = [7, 30, 120].includes(requestedPeriod) ? requestedPeriod : 7;
    const userAgent = ROTATING_USER_AGENTS[Math.floor(Math.random() * ROTATING_USER_AGENTS.length)];

    const targetUrls = [
      `${origin}/creative/creativeCenter/trends/hashtag?region=${region}&period=${period}`,
      `${origin}/creative/creativeCenter/trends/video?region=${region}&period=${period}`,
      `${rawRoot}/inspiration/popular/hashtag/pc/en?countryCode=${region}&period=${period}`,
    ];

    const observedAt = new Date();
    const items: CreativeCenterItem[] = [];

    for (const url of targetUrls) {
      try {
        const response = await fetchWithRetry(url, {
          timeoutMs: envNumber('TIKTOK_PAGE_TIMEOUT_MS', 25_000),
          retries: 1,
          headers: {
            'User-Agent': userAgent,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            ...(state.etag ? { 'If-None-Match': state.etag } : {}),
            ...(state.lastModified ? { 'If-Modified-Since': state.lastModified } : {}),
          },
        });

        if (response.status === 304) continue;
        if (BLOCKED_STATUS.has(response.status)) throw new Error(`HTTP ${response.status} from TikTok Creative Center`);
        if (!response.ok) continue;

        const html = await response.text();
        const extracted = extractDehydratedState(html, region);
        items.push(...extracted);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (BLOCKED_STATUS.has(Number(msg.match(/HTTP (\d+)/)?.[1]))) throw error;
        this.logger.warn(`Direct SSR fetch failed for ${url}: ${msg}`);
      }
    }

    const unique = [...new Map(items.map((it) => [it.name?.toLowerCase(), it])).values()].slice(0, this.maxItems() * 2);
    return unique.map((item, index) => creativeCenterItemToEvent(item, index, observedAt));
  }

  /**
   * Apify integration mode: If APIFY_API_TOKEN is provided, invoke an Apify TikTok actor
   * or retrieve dataset items using Apify's residential proxy infrastructure.
   */
  async collectApify(_state: CollectorState): Promise<RawEventInput[]> {
    const token = process.env.APIFY_API_TOKEN;
    if (!token) throw new Error('APIFY_API_TOKEN is required for Apify collection mode');
    const actorId = process.env.APIFY_TIKTOK_ACTOR_ID ?? 'clockworks~tiktok-sound-scraper';
    const url = `https://api.apify.com/v2/acts/${actorId}/runs/last/dataset/items?token=${encodeURIComponent(token)}&limit=${this.maxItems() * 2}`;

    const response = await fetchWithRetry(url, {
      timeoutMs: 30_000,
      retries: 1,
      headers: { Accept: 'application/json' },
    });

    if (BLOCKED_STATUS.has(response.status)) throw new Error(`HTTP ${response.status} from Apify`);
    if (!response.ok) throw new Error(`Apify request failed with HTTP ${response.status}`);

    const data = await response.json() as any;
    const list = Array.isArray(data) ? data : data?.items ?? [];
    const observedAt = new Date();

    return list.slice(0, this.maxItems() * 2).map((raw: any, index: number) => {
      const item: CreativeCenterItem = {
        id: raw.id ?? raw.musicId ?? raw.videoId,
        kind: raw.musicName || raw.soundName ? 'sound' : 'hashtag',
        soundName: raw.musicName ?? raw.soundName,
        hashtagName: raw.hashtagName ?? raw.title,
        artistName: raw.authorMeta?.name ?? raw.artistName,
        videoCount: raw.videoCount ?? raw.playCount,
        views: raw.diggCount ?? raw.playCount ?? raw.views,
        topCreators: raw.topCreators ?? (raw.authorMeta?.name ? [raw.authorMeta.name] : []),
        url: raw.webVideoUrl ?? raw.musicUrl,
      };
      return creativeCenterItemToEvent(item, index, observedAt);
    });
  }

  private async collectFeed(state: CollectorState): Promise<RawEventInput[]> {
    const response = await fetchWithRetry(process.env.TIKTOK_CREATIVE_CENTER_FEED_URL!, {
      timeoutMs: 25_000,
      retries: 1,
      headers: {
        Accept: 'application/json',
        ...(state.etag ? { 'If-None-Match': state.etag } : {}),
        ...(state.lastModified ? { 'If-Modified-Since': state.lastModified } : {}),
      },
    });
    if (response.status === 304) return [];
    await this.writeState({ etag: response.headers.get('etag') ?? state.etag, lastModified: response.headers.get('last-modified') ?? state.lastModified });
    const body = await response.json() as any;
    const nested = body?.items ?? body?.data?.items ?? body?.data?.list ?? body?.data ?? body;
    const items = Array.isArray(nested) ? nested : [];
    const observedAt = new Date();
    return items.slice(0, this.maxItems() * 3).map((item: CreativeCenterItem, index: number) => creativeCenterItemToEvent(item, index, observedAt));
  }

  /**
   * Stealth Playwright collection mode with anti-detection evasions and optional proxy support.
   */
  async collectBrowser(): Promise<RawEventInput[]> {
    let browser: Browser | undefined;
    const proxyServer = process.env.TIKTOK_PROXY_URL || process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-dev-shm-usage',
        ],
        ...(process.env.TIKTOK_BROWSER_EXECUTABLE_PATH
          ? { executablePath: process.env.TIKTOK_BROWSER_EXECUTABLE_PATH }
          : { channel: process.env.TIKTOK_BROWSER_CHANNEL ?? 'chrome' }),
        ...(proxyServer ? { proxy: { server: proxyServer } } : {}),
      });

      const userAgent = ROTATING_USER_AGENTS[Math.floor(Math.random() * ROTATING_USER_AGENTS.length)];
      const context = await browser.newContext({
        userAgent,
        viewport: { width: 1440, height: 900 },
        locale: 'en-US',
      });

      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      await page.route(/\.(?:woff2?|mp4|webm|avi)(?:\?|$)/i, (route) => route.abort());

      const result: RawEventInput[] = [];
      const region = (process.env.TIKTOK_REGION ?? 'US').replace(/[^A-Z]/gi, '').toUpperCase().slice(0, 2) || 'US';
      const requestedPeriod = envNumber('TIKTOK_PERIOD_DAYS', 7);
      const period = [7, 30, 120].includes(requestedPeriod) ? requestedPeriod : 7;
      const root = (process.env.TIKTOK_CREATIVE_CENTER_URL ?? CREATIVE_CENTER_ROOT).replace(/\/$/, '');

      const targets = [
        `${root}/creative/creativeCenter/trends/hashtag?region=${region}&period=${period}`,
        `${root}/creative/creativeCenter/trends/video?region=${region}&period=${period}`,
      ];

      for (const [index, url] of targets.entries()) {
        if (index) await new Promise((resolve) => setTimeout(resolve, Math.max(1_500, envNumber('TIKTOK_PAGE_DELAY_MS', 2_500))));
        const pageItems = await this.collectPublicPage(page, url, region);
        result.push(...pageItems);
      }

      await context.close();
      return [...new Map(result.map((event) => [event.externalId, event])).values()];
    } finally {
      await browser?.close();
    }
  }

  private async collectPublicPage(page: Page, url: string, region: string): Promise<RawEventInput[]> {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: envNumber('TIKTOK_PAGE_TIMEOUT_MS', 45_000),
    });

    if (response && BLOCKED_STATUS.has(response.status())) throw new Error(`HTTP ${response.status()} from TikTok Creative Center`);
    await page.waitForTimeout(Math.min(6_000, envNumber('TIKTOK_RENDER_WAIT_MS', 5_000)));

    // First attempt: extract from embedded Next.js SSR script state
    const scriptItems = await page.evaluate(({ itemRegion }) => {
      const results: any[] = [];
      for (const s of Array.from(document.querySelectorAll('script'))) {
        const text = s.textContent || '';
        if (!text.includes('loaderData') && !text.includes('dehydratedState')) continue;
        try {
          const parsed = JSON.parse(text.trim());
          const queries = parsed?.loaderData?.['creativeCenter/trends/(tab)/page']?.dehydratedState?.queries ?? [];
          for (const q of queries) {
            const pages = q?.state?.data?.pages ?? [q?.state?.data];
            for (const p of pages) {
              const list = Array.isArray(p?.data) ? p.data : [];
              for (const it of list) {
                if (it.hashtagName || it.hashtagID) {
                  results.push({
                    kind: 'hashtag',
                    name: it.hashtagName,
                    rank: Number(it.rankIndex) || undefined,
                    videoCount: it.publishCnt,
                    views: it.vv,
                    topCreators: Array.isArray(it.topCreators) ? it.topCreators.map((c: any) => c.handleName ? `@${c.handleName}` : '').filter(Boolean) : [],
                    popularityCurve: it.popularityCurve,
                    region: itemRegion,
                    url: `https://www.tiktok.com/tag/${encodeURIComponent(String(it.hashtagName).replace(/^#/, ''))}`,
                  });
                }
              }
            }
          }
        } catch {}
      }
      return results;
    }, { itemRegion: region });

    if (scriptItems.length > 0) {
      const observedAt = new Date();
      return scriptItems.slice(0, this.maxItems()).map((item, idx) => creativeCenterItemToEvent(item, idx, observedAt));
    }

    // Fallback attempt: extract from rendered DOM elements
    const domItems = await page.evaluate(({ itemRegion, limit }) => {
      const results: any[] = [];
      const hashtagSpans = Array.from(document.querySelectorAll('*'))
        .filter((el) => el.children.length === 0 && (el.textContent || '').trim().startsWith('#'))
        .slice(0, limit);

      for (const span of hashtagSpans) {
        const hashtagName = (span.textContent || '').trim();
        if (!hashtagName || hashtagName.length < 2) continue;
        let container: HTMLElement | null = span.parentElement;
        for (let depth = 0; container?.parentElement && depth < 4; depth += 1) container = container.parentElement;
        const text = container?.innerText || '';
        const postsMatch = text.match(/([\d.,]+\s*[KMB]?)\s*Posts?/i);
        const viewsMatch = text.match(/([\d.,]+\s*[KMB]?)\s*Views?/i);
        const rankMatch = text.match(/^\s*(\d{1,3})\b/);

        results.push({
          kind: 'hashtag',
          name: hashtagName,
          rank: rankMatch ? Number(rankMatch[1]) : undefined,
          videoCount: postsMatch ? postsMatch[1] : undefined,
          views: viewsMatch ? viewsMatch[1] : undefined,
          region: itemRegion,
          url: `https://www.tiktok.com/tag/${encodeURIComponent(hashtagName.replace(/^#/, ''))}`,
        });
      }
      return results;
    }, { itemRegion: region, limit: this.maxItems() });

    const observedAt = new Date();
    return domItems.map((item, idx) => creativeCenterItemToEvent(item, idx, observedAt));
  }

  /**
   * Sound & Hashtag velocity rate calculations:
   * Calculates viewsPerHour on hashtags, videoCount growth on sounds (videosPerHour / videosPerDay),
   * and flags leading indicator audio trends before they spread cross-platform.
   */
  async addRates(events: RawEventInput[]): Promise<RawEventInput[]> {
    if (!events.length) return events;
    const previous = await this.prisma.rawEvent.findMany({
      where: { externalId: { in: events.map((event) => event.externalId) }, source: { name: this.name } },
      select: { externalId: true, normalized: { select: { metrics: { orderBy: { observedAt: 'desc' }, take: 1 } } } },
    });
    const byId = new Map(previous.map((raw) => [raw.externalId, raw.normalized?.metrics[0]]));

    return events.map((event) => {
      const prior = byId.get(event.externalId);
      const observedAt = event.metrics?.observedAt ?? new Date();
      const hours = prior ? Math.max(1 / 60, (observedAt.getTime() - prior.observedAt.getTime()) / 3_600_000) : undefined;
      const rate = (current: bigint | number | undefined, old: bigint | null | undefined): number | undefined => {
        if (current === undefined || old === null || old === undefined || hours === undefined) return undefined;
        return Math.max(0, (Number(current) - Number(old)) / hours);
      };

      const viewsPerHour = rate(event.metrics?.views, prior?.views);
      const videosPerHour = rate(event.metrics?.mentionCount, prior?.mentionCount);
      const videosPerDay = videosPerHour !== undefined ? Math.round(videosPerHour * 24) : undefined;

      const currentVideoCount = Number(event.metrics?.mentionCount ?? 0);
      const priorVideoCount = prior?.mentionCount !== null && prior?.mentionCount !== undefined ? Number(prior.mentionCount) : undefined;

      // Leading Indicator Detection:
      // Sounds surging in video creations (e.g. accelerating from 2k towards 50k videos/day)
      // signal a meme before it goes cross-platform to X, Reddit, and news.
      const isSound = event.category === Category.TIKTOK_SOUNDS || (event.metadata as any)?.kind === 'sound';
      let isLeadingIndicator = false;
      let leadingIndicatorReason: string | undefined;

      if (isSound) {
        if (videosPerDay !== undefined && videosPerDay >= 2_500) {
          isLeadingIndicator = true;
          leadingIndicatorReason = `Audio surged +${videosPerDay.toLocaleString()}/day (${currentVideoCount.toLocaleString()} total creations). Leading indicator before cross-platform spread.`;
        } else if (priorVideoCount !== undefined && priorVideoCount < 10_000 && currentVideoCount >= 25_000) {
          isLeadingIndicator = true;
          leadingIndicatorReason = `Sound accelerated from ${priorVideoCount.toLocaleString()} to ${currentVideoCount.toLocaleString()} videos. Rapid cross-platform expansion precursor.`;
        } else if (currentVideoCount >= 30_000) {
          isLeadingIndicator = true;
          leadingIndicatorReason = `High-volume sound with ${currentVideoCount.toLocaleString()} video creations. Strong viral catalyst.`;
        }
      }

      return {
        ...event,
        metrics: event.metrics
          ? {
              ...event.metrics,
              observedAt,
              raw: {
                ...(event.metrics.raw ?? {}),
                viewsPerHour,
                videosPerHour,
                videosPerDay,
                isLeadingIndicator,
                leadingIndicatorReason,
              },
            }
          : undefined,
        metadata: {
          ...(event.metadata ?? {}),
          viewsPerHour,
          videosPerHour,
          videosPerDay,
          isLeadingIndicator,
          leadingIndicatorReason,
        },
      };
    });
  }

  private maxItems(): number {
    return Math.min(50, Math.max(5, Math.floor(envNumber('TIKTOK_MAX_ITEMS_PER_TYPE', 20))));
  }

  private async readState(): Promise<CollectorState> {
    const source = await this.prisma.source.findUnique({ where: { name: this.name }, select: { configuration: true } });
    return source?.configuration && typeof source.configuration === 'object' && !Array.isArray(source.configuration)
      ? (source.configuration as CollectorState)
      : {};
  }

  private async writeState(patch: Partial<CollectorState>): Promise<void> {
    const current = await this.readState();
    const next = { ...current, ...patch } as Record<string, unknown>;
    for (const [key, value] of Object.entries(next)) if (value === undefined) delete next[key];
    await this.prisma.source.updateMany({ where: { name: this.name }, data: { configuration: next as Prisma.InputJsonValue } });
  }

  async normalize(event: RawEventInput) {
    return {
      platform: 'tiktok',
      externalId: event.externalId,
      title: event.title!,
      content: event.content,
      author: event.author,
      url: event.url!,
      mediaUrl: event.mediaUrl,
      publishedAt: new Date(event.publishedAt ?? Date.now()),
      language: event.language ?? 'en',
      category: event.category ?? Category.MEMES,
      entities: event.entities ?? [],
      keywords: event.keywords ?? extractKeywords(`${event.title} ${event.content ?? ''}`),
      metadata: event.metadata,
    };
  }
}
