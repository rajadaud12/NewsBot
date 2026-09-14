import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { OllamaService } from '../ai/ollama.service';
import { PrismaService } from '../database/prisma.service';
import { escapeHtml, TelegramService } from '../telegram/telegram.service';
import { canPublishBreaking } from './publication-rules';
import { validateEvidence } from './news-validation';
import { PipelineLogService } from '../pipeline/pipeline-log.service';
import { verifyPublicHttpUrl } from '../common/utils/http';

const GROUPS: Record<Category, string> = {
  POLITICS: 'Politics', CRYPTO_PEOPLE: 'Crypto', TOKENIZED_COMPANIES: 'Companies', MEMES: 'Internet / Memes',
  MEME_PHRASES: 'Internet / Memes', INTERNET_DRAMA: 'Internet / Memes', REDDIT_TRENDS: 'Internet / Memes',
  VIRAL_PEOPLE: 'People', ODD_NEWS: 'Odd News', LOCAL_NEWS: 'Odd News', VIRAL_ANIMALS: 'Animals',
  TIKTOK_SOUNDS: 'TikTok', BRAND_STUNTS: 'Companies', MASCOTS: 'Internet / Memes', BREAKING_NEWS: 'Biggest Stories', GENERAL: 'Biggest Stories',
};

const CATEGORY_EMOJI: Record<Category, string> = {
  POLITICS: '🗳️', CRYPTO_PEOPLE: '🪙', TOKENIZED_COMPANIES: '📊', MEMES: '😂', MEME_PHRASES: '💬',
  INTERNET_DRAMA: '🍿', REDDIT_TRENDS: '👽', VIRAL_PEOPLE: '🌟', ODD_NEWS: '🛸', LOCAL_NEWS: '📍',
  VIRAL_ANIMALS: '🐾', TIKTOK_SOUNDS: '🎵', BRAND_STUNTS: '🎭', MASCOTS: '🧸', BREAKING_NEWS: '🚨', GENERAL: '📰',
};

interface VerifiedSource {
  label: string;
  url: string;
  publisher: string;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly ollama: OllamaService, private readonly telegram: TelegramService, private readonly pipeline: PipelineLogService) {}

  async processBreaking(trendId: string): Promise<boolean> {
    const trend = await this.prisma.trend.findUnique({ where: { id: trendId }, include: {
      scores: { orderBy: { calculatedAt: 'desc' }, take: 1 }, snapshots: { orderBy: { observedAt: 'desc' }, take: 1 },
      events: { include: { event: true } }, mentions: true, publications: { orderBy: { createdAt: 'desc' } },
    } });
    if (!trend || !trend.scores[0] || !trend.snapshots[0]) {
      await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId, message: 'Breaking-news candidate lacks a trend, score, or snapshot' });
      return false;
    }
    const score = trend.scores[0];
    const platforms = [...new Set(trend.events.map(({ event }) => event.platform))];
    const sourceCount = new Set(trend.mentions.map((mention) => mention.sourceName)).size;

    const isTikTok = platforms.includes('tiktok') || trend.category === Category.TIKTOK_SOUNDS;
    const isSocialViral = isTikTok || platforms.includes('x') || trend.category === Category.MEMES || trend.category === Category.MEME_PHRASES;
    const isLeadingIndicator = trend.events.some(({ event }) => Boolean((event.metadata as any)?.isLeadingIndicator)) || trend.category === Category.TIKTOK_SOUNDS;

    const evidenceValidation = validateEvidence(trend.events.map(({ event }) => event), sourceCount, {
      requireCorroboration: true,
      allowLeadingIndicator: isLeadingIndicator,
      allowSocialViral: isSocialViral,
    });

    const previousSent = trend.publications.find((pub) => pub.type === PublicationType.BREAKING && pub.status === PublicationStatus.SENT);
    const hoursSincePrev = previousSent ? (Date.now() - new Date(previousSent.createdAt).getTime()) / 3_600_000 : undefined;
    const eventsAddedSince = previousSent
      ? trend.events.filter(({ addedAt }) => new Date(addedAt).getTime() > new Date(previousSent.createdAt).getTime()).length
      : trend.events.length;
    const hasMajorProgress = Boolean(
      previousSent &&
      hoursSincePrev !== undefined &&
      hoursSincePrev >= 3 &&
      (eventsAddedSince >= 3 || (score.score >= 75 && (previousSent.scoreAtPublication ?? 0) < 60)),
    );

    const publicationThreshold = this.config.get<number>('publicationThreshold', 55);

    if (!canPublishBreaking(
      {
        score: score.score,
        velocity: score.velocity,
        acceleration: score.acceleration,
        sourceCount,
        platformCount: platforms.length,
        publisherCount: evidenceValidation.publisherCount,
        lifecycle: trend.lifecycle,
        publications: trend.publications,
        isLeadingIndicator,
        isSocialViral,
        hasMajorProgress,
        eventsCount: trend.events.length,
      },
      publicationThreshold,
    )) {
      await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId, message: 'Breaking-news candidate did not pass score, checklist deduplication, or progress rules', context: { score: score.score, threshold: publicationThreshold, sourceCount, platformCount: platforms.length, isSocialViral, isLeadingIndicator, hasMajorProgress } });
      return false;
    }

    if (!evidenceValidation.valid) {
      await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId, message: 'Breaking-news evidence validation failed', context: { ...evidenceValidation } });
      return false;
    }
    const verifiedSources = await this.verifiedSources(trend.events.map(({ event }) => event), trendId);
    if (!verifiedSources.length) {
      await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId, message: 'Breaking-news candidate has no reachable, public evidence link' });
      return false;
    }
    await this.pipeline.write({ stage: 'VALIDATION', status: 'PASSED', trendId, message: 'Breaking-news evidence and public links passed validation and are eligible for LLM review', context: { ...evidenceValidation, verifiedLinks: verifiedSources.length } });
    const analysis = await this.ollama.analyzeTrend(trendId);
    if (!this.aiApproved(analysis, isSocialViral)) {
      await this.pipeline.write({ stage: 'LLM', status: 'REJECTED', trendId, message: 'LLM result did not meet the confidence gate', context: { isNewsworthy: analysis.isNewsworthy, isMeme: (analysis as any).isMeme, confidence: analysis.confidence, minimumConfidence: this.minimumConfidence() } });
      return false;
    }

    const divider = '━━━━━━━━━━━━━━━━━━━━';
    let headerBadge: string;
    if (hasMajorProgress) {
      headerBadge = '🚨 <b>MAJOR DEVELOPMENT UPDATE</b>\n⚡ <b>Breaking Progress on Viral Story</b>';
    } else if (isLeadingIndicator) {
      headerBadge = '🚀 <b>LEADING INDICATOR DETECTED</b>\n🎵 <b>TikTok Audio Surge Preceding Cross-Platform Virality</b>';
    } else if (isSocialViral) {
      headerBadge = '🔥 <b>VIRAL BREAKOUT ALERT</b>\n✨ <b>Trending Worldwide on TikTok & Socials</b>';
    } else {
      headerBadge = '🔥 <b>BREAKING NEWS ALERT</b>\n⚡ <b>Major Story Gaining Rapid Traction</b>';
    }

    const metricsLines = this.buildMetricsLines(trend, score.velocity, platforms);
    const sources = this.sourceLines(verifiedSources);

    const content = [
      headerBadge,
      divider,
      `⚡ <b>${escapeHtml(analysis.headline)}</b>`,
      escapeHtml(analysis.summary),
      `🔍 <b>${hasMajorProgress ? 'Latest Progress / New Scandal' : 'Why It\'s Gaining Momentum'}</b>\n${escapeHtml(analysis.whyTrending)}`,
      `📊 <b>VIRAL METRICS & REACH</b>\n${metricsLines.join('\n')}`,
      divider,
      `🔗 <b>VERIFIED EVIDENCE & COVERAGE</b>\n${sources}`,
      '✅ <i>Links verified & active immediately before publication</i>',
    ].join('\n\n');

    await this.telegram.publish({ trendId, type: PublicationType.BREAKING, content, score: score.score, lifecycle: trend.lifecycle, mediaUrls: this.mediaUrls(trend.events.map(({ event }) => event)) });
    await this.prisma.alert.create({ data: { trendId, type: 'BREAKOUT', severity: 'INFO', title: analysis.headline, message: analysis.whyTrending } });
    return true;
  }

  async publishDigest(): Promise<number> {
    const since = new Date(Date.now() - 12 * 3_600_000);
    const trends = await this.prisma.trend.findMany({
      where: { currentScore: { gte: 45, lt: 85 }, lifecycle: TrendLifecycle.HOT,
        NOT: { publications: { some: { type: PublicationType.DIGEST, status: PublicationStatus.SENT, createdAt: { gte: since } } } } },
      orderBy: { currentScore: 'desc' }, take: 12, include: { events: { include: { event: true } }, mentions: true },
    });
    if (!trends.length) return 0;
    const sections = new Map<string, string[]>();
    const approved = [] as Array<{ trend: (typeof trends)[number]; headline: string; summary: string }>;
    for (const trend of trends) {
      const sourceCount = new Set(trend.mentions.map((mention) => mention.sourceName)).size;
      const isTikTok = trend.events.some(({ event }) => event.platform === 'tiktok') || trend.category === Category.TIKTOK_SOUNDS;
      const isSocialViral = isTikTok || trend.events.some(({ event }) => event.platform === 'x') || trend.category === Category.MEMES || trend.category === Category.MEME_PHRASES;
      const isLeadingIndicator = trend.events.some(({ event }) => Boolean((event.metadata as any)?.isLeadingIndicator)) || trend.category === Category.TIKTOK_SOUNDS;
      const validation = validateEvidence(trend.events.map(({ event }) => event), sourceCount, {
        requireCorroboration: true,
        allowLeadingIndicator: isLeadingIndicator,
        allowSocialViral: isSocialViral,
      });
      if (!validation.valid) {
        await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId: trend.id, message: 'Digest candidate failed evidence validation', context: { ...validation } });
        continue;
      }
      const verifiedSources = await this.verifiedSources(trend.events.map(({ event }) => event), trend.id);
      if (!verifiedSources.length) {
        await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId: trend.id, message: 'Digest candidate has no reachable, public evidence link' });
        continue;
      }
      await this.pipeline.write({ stage: 'VALIDATION', status: 'PASSED', trendId: trend.id, message: 'Digest evidence and public links passed validation and are eligible for LLM review', context: { ...validation, verifiedLinks: verifiedSources.length } });
      const analysis = await this.ollama.analyzeTrend(trend.id);
      if (!this.aiApproved(analysis, isSocialViral)) {
        await this.pipeline.write({ stage: 'LLM', status: 'REJECTED', trendId: trend.id, message: 'Digest candidate did not meet the final LLM confidence gate', context: { confidence: analysis.confidence, minimumConfidence: this.minimumConfidence() } });
        continue;
      }
      const group = GROUPS[trend.category];
      const sourceLinks = this.sourceLines(verifiedSources);
      const metricsSnippet = this.buildDigestSnippet(trend);
      const line = [
        `${CATEGORY_EMOJI[trend.category]} <b>${escapeHtml(analysis.headline)}</b>`,
        escapeHtml(analysis.summary),
        `⚡ <b>Status:</b> ${this.lifecycleEmoji(trend.lifecycle)} <b>${escapeHtml(trend.lifecycle)}</b>${metricsSnippet ? ` • ${metricsSnippet}` : ''}`,
        `🔗 ${sourceLinks}`,
      ].join('\n');
      sections.set(group, [...(sections.get(group) ?? []), line]);
      approved.push({ trend, headline: analysis.headline, summary: analysis.summary });
    }
    if (!sections.size) return 0;
    const divider = '━━━━━━━━━━━━━━━━━━━━';
    const content = [
      '🗞️ <b>THE VIRAL SIGNAL — MIDDAY DIGEST</b>',
      '<i>Verified stories and breakout trends gaining momentum right now</i>',
      divider,
      ...[...sections].map(([group, items]) => `<b>━━ ${escapeHtml(group).toUpperCase()} ━━</b>\n\n${items.join('\n\n')}`),
      divider,
      '✅ <i>Every link was verified reachable immediately before this edition was sent.</i>',
    ].join('\n\n');
    await this.telegram.publish({ type: PublicationType.DIGEST, content, mediaUrls: approved.flatMap(({ trend }) => this.mediaUrls(trend.events.map(({ event }) => event))) });
    await this.prisma.telegramPublication.createMany({ data: approved.map(({ trend }) => ({ trendId: trend.id, type: PublicationType.DIGEST, status: PublicationStatus.SENT, content: 'Included in digest', scoreAtPublication: trend.currentScore, lifecycleAtPublication: trend.lifecycle, publishedAt: new Date() })) });
    for (const { trend } of approved) await this.pipeline.write({ stage: 'TELEGRAM', status: 'COMPLETED', trendId: trend.id, message: 'Approved trend was included in the Telegram digest' });
    return approved.length;
  }

  async publishDailyRoundup(): Promise<number> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const trends = await this.prisma.trend.findMany({
      where: { lastSeenAt: { gte: since }, peakScore: { gte: 45 } },
      orderBy: { peakScore: 'desc' }, take: 16, include: { events: { include: { event: true } }, mentions: true, publications: { where: { type: PublicationType.BREAKING, status: PublicationStatus.SENT } } },
    });
    if (!trends.length) return 0;
    const sections = new Map<string, string[]>();
    const approved = [] as Array<(typeof trends)[number]>;
    for (const trend of trends) {
      const sourceCount = new Set(trend.mentions.map((mention) => mention.sourceName)).size;
      const isTikTok = trend.events.some(({ event }) => event.platform === 'tiktok') || trend.category === Category.TIKTOK_SOUNDS;
      const isSocialViral = isTikTok || trend.events.some(({ event }) => event.platform === 'x') || trend.category === Category.MEMES || trend.category === Category.MEME_PHRASES;
      const isLeadingIndicator = trend.events.some(({ event }) => Boolean((event.metadata as any)?.isLeadingIndicator)) || trend.category === Category.TIKTOK_SOUNDS;
      const validation = validateEvidence(trend.events.map(({ event }) => event), sourceCount, {
        requireCorroboration: true,
        allowLeadingIndicator: isLeadingIndicator,
        allowSocialViral: isSocialViral,
      });
      if (!validation.valid) {
        await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId: trend.id, message: 'Daily-roundup candidate failed evidence validation', context: { ...validation } });
        continue;
      }
      const verifiedSources = await this.verifiedSources(trend.events.map(({ event }) => event), trend.id);
      if (!verifiedSources.length) {
        await this.pipeline.write({ stage: 'VALIDATION', status: 'REJECTED', trendId: trend.id, message: 'Daily-roundup candidate has no reachable, public evidence link' });
        continue;
      }
      await this.pipeline.write({ stage: 'VALIDATION', status: 'PASSED', trendId: trend.id, message: 'Daily-roundup evidence and public links passed validation and are eligible for LLM review', context: { ...validation, verifiedLinks: verifiedSources.length } });
      const analysis = await this.ollama.analyzeTrend(trend.id);
      if (!this.aiApproved(analysis, isSocialViral)) {
        await this.pipeline.write({ stage: 'LLM', status: 'REJECTED', trendId: trend.id, message: 'Daily-roundup candidate did not meet the final LLM confidence gate', context: { confidence: analysis.confidence, minimumConfidence: this.minimumConfidence() } });
        continue;
      }
      const wasBreaking = trend.publications.length > 0;
      const context = wasBreaking ? `Update: ${analysis.whyTrending}` : analysis.summary;
      const group = GROUPS[trend.category];
      const sourceLinks = this.sourceLines(verifiedSources);
      const metricsSnippet = this.buildDigestSnippet(trend);
      const line = [
        `${CATEGORY_EMOJI[trend.category]} <b>${escapeHtml(analysis.headline)}</b>`,
        escapeHtml(context),
        `⚡ <b>Status:</b> ${this.lifecycleEmoji(trend.lifecycle)} <b>${escapeHtml(trend.lifecycle)}</b> • 🌟 <b>High Momentum</b>${metricsSnippet ? ` • ${metricsSnippet}` : ''}`,
        `🔗 ${sourceLinks}`,
      ].join('\n');
      sections.set(group, [...(sections.get(group) ?? []), line]);
      approved.push(trend);
    }
    if (!sections.size) return 0;
    const divider = '━━━━━━━━━━━━━━━━━━━━';
    const content = [
      '🌅 <b>DAILY VIRAL INTELLIGENCE ROUNDUP</b>',
      '<i>The strongest verified signals and cultural breakout moments from the last 24 hours</i>',
      divider,
      ...[...sections].map(([group, items]) => `<b>━━ ${escapeHtml(group).toUpperCase()} ━━</b>\n\n${items.join('\n\n')}`),
      divider,
      '✅ <i>Evidence links verified reachable before publication.</i>',
    ].join('\n\n');
    await this.telegram.publish({ type: PublicationType.DAILY_ROUNDUP, content, mediaUrls: approved.flatMap((trend) => this.mediaUrls(trend.events.map(({ event }) => event))) });
    for (const trend of approved) await this.pipeline.write({ stage: 'TELEGRAM', status: 'COMPLETED', trendId: trend.id, message: 'Approved trend was included in the Telegram daily roundup' });
    return approved.length;
  }

  private buildMetricsLines(trend: any, velocityVal: number, platforms: string[]): string[] {
    const category = trend.category as Category;
    const lines: string[] = [
      `• 🏷️ <b>Category:</b> ${CATEGORY_EMOJI[category]} <b>${escapeHtml(GROUPS[category])}</b>  •  ${this.lifecycleEmoji(trend.lifecycle)} <b>${escapeHtml(trend.lifecycle)}</b>`,
      `• ⚡ <b>Velocity:</b> <code>${escapeHtml(this.level(velocityVal))} Velocity</code> • 🔥 <b>Surging</b>`,
      `• 🌐 <b>Trending On:</b> ${platforms.map(escapeHtml).join(' • ')}`,
    ];

    const videoCounts = trend.events.map(({ event }: any) => Number((event.metadata as any)?.videoCount)).filter(Number.isFinite);
    const maxVideos = videoCounts.length ? Math.max(...videoCounts) : undefined;

    const videosPerDays = trend.events.map(({ event }: any) => Number((event.metadata as any)?.videosPerDay)).filter(Number.isFinite);
    const maxVideosPerDay = videosPerDays.length ? Math.max(...videosPerDays) : undefined;

    const viewsPerHours = trend.events.map(({ event }: any) => Number((event.metadata as any)?.viewsPerHour)).filter(Number.isFinite);
    const maxViewsPerHour = viewsPerHours.length ? Math.max(...viewsPerHours) : undefined;

    const totalViews = trend.events.map(({ event }: any) => Number((event.metadata as any)?.views || (event.metadata as any)?.vv)).filter(Number.isFinite);
    const maxTotalViews = totalViews.length ? Math.max(...totalViews) : undefined;

    if (maxVideos) {
      lines.push(`• 🎵 <b>Video Creations:</b> <code>${maxVideos.toLocaleString('en-US')} videos</code>${maxVideosPerDay ? ` <i>(+${maxVideosPerDay.toLocaleString('en-US')}/day surge 🚀)</i>` : ''}`);
    }
    if (maxTotalViews && maxTotalViews >= 1_000_000) {
      const formattedViews = maxTotalViews >= 1_000_000_000 ? `${(maxTotalViews / 1_000_000_000).toFixed(1)}B` : `${(maxTotalViews / 1_000_000).toFixed(1)}M`;
      lines.push(`• 👁️ <b>Total Views:</b> <code>${formattedViews} views</code>`);
    } else if (maxViewsPerHour) {
      lines.push(`• 👁️ <b>Pacing Velocity:</b> <code>~${Math.round(maxViewsPerHour).toLocaleString('en-US')} views/hr</code>`);
    }

    const allCreators: string[] = trend.events.flatMap(({ event }: any) => {
      const c = (event.metadata as any)?.topCreators;
      return Array.isArray(c) ? c : [];
    }).filter((c: unknown): c is string => typeof c === 'string' && Boolean(c));
    const uniqueCreators = [...new Set(allCreators)].slice(0, 3);
    if (uniqueCreators.length) {
      lines.push(`• 👑 <b>Top Creators:</b> ${uniqueCreators.map((c) => escapeHtml(c)).join(', ')}`);
    }

    return lines;
  }

  private buildDigestSnippet(trend: any): string | undefined {
    const videoCounts = trend.events.map(({ event }: any) => Number((event.metadata as any)?.videoCount)).filter(Number.isFinite);
    const maxVideos = videoCounts.length ? Math.max(...videoCounts) : undefined;
    const viewsPerHours = trend.events.map(({ event }: any) => Number((event.metadata as any)?.viewsPerHour)).filter(Number.isFinite);
    const maxViews = viewsPerHours.length ? Math.max(...viewsPerHours) : undefined;

    const snippets: string[] = [];
    if (maxVideos) snippets.push(`🎵 <code>${maxVideos.toLocaleString('en-US')} creations</code>`);
    if (maxViews) snippets.push(`👁️ <code>~${Math.round(maxViews).toLocaleString('en-US')} v/hr</code>`);
    return snippets.length ? snippets.join(' • ') : undefined;
  }

  private level(value: number): string { return value >= 80 ? 'Very High' : value >= 60 ? 'High' : value >= 40 ? 'Moderate' : 'Low'; }
  private lifecycleEmoji(lifecycle: TrendLifecycle): string {
    return { NEW: '🌱', MONITORING: '👀', RISING: '📈', HOT: '🔥', BREAKOUT: '🚨', DECLINING: '📉', EXPIRED: '🕰️' }[lifecycle];
  }
  private sourceLines(sources: VerifiedSource[]): string {
    return sources.map((source) => `• <b><a href="${escapeHtml(source.url)}">${escapeHtml(source.publisher)}</a></b> — <i>${escapeHtml(source.label)}</i>`).join('\n');
  }
  private async verifiedSources(events: any[], trendId: string): Promise<VerifiedSource[]> {
    const unique = [...new Map(events.map((event) => [event.canonicalUrl || event.url, event])).values()].slice(0, 8) as any[];
    await this.pipeline.write({ stage: 'VALIDATION', status: 'STARTED', trendId, message: `Checking ${unique.length} evidence link${unique.length === 1 ? '' : 's'} before publication` });
    const checked = await Promise.all(unique.map(async (event) => {
      const verified = await verifyPublicHttpUrl(String(event.url));
      if (!verified) return undefined;
      return { label: String(event.title), publisher: String(event.author || new URL(verified.finalUrl).hostname.replace(/^www\./, '')), url: verified.finalUrl } satisfies VerifiedSource;
    }));
    const sources = checked.filter((source): source is VerifiedSource => Boolean(source)).slice(0, 5);
    await this.pipeline.write({ stage: 'VALIDATION', status: sources.length ? 'PASSED' : 'REJECTED', trendId, message: sources.length ? `Verified ${sources.length} public evidence link${sources.length === 1 ? '' : 's'}` : 'No public evidence links passed the reachability check', context: { checked: unique.length, verified: sources.length } });
    return sources;
  }
  private minimumConfidence(): number { return this.config.get<number>('ollama.minimumConfidence', 0.7); }
  private aiApproved(analysis: { isNewsworthy: boolean; isMeme?: boolean; confidence: number }, isSocialViral = false): boolean {
    if (isSocialViral) {
      // Social viral phenomena (TikTok hashtags, sounds, meme trends) are cultural trends rather than traditional news.
      // They easily pass the LLM gate as long as the LLM successfully analyzed the trend with baseline confidence.
      return (analysis.confidence ?? 0) >= 0.4 || analysis.isNewsworthy || Boolean(analysis.isMeme);
    }
    return analysis.isNewsworthy && (analysis.confidence ?? 0) >= this.minimumConfidence();
  }
  private mediaUrls(events: Array<{ mediaUrl: string | null }>): string[] { return events.map((event) => event.mediaUrl).filter((url): url is string => Boolean(url)); }
}
