import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { OllamaService } from '../ai/ollama.service';
import { PrismaService } from '../database/prisma.service';
import { escapeHtml, TelegramService } from '../telegram/telegram.service';
import { canPublishBreaking } from './publication-rules';

const GROUPS: Record<Category, string> = {
  POLITICS: 'Politics', CRYPTO_PEOPLE: 'Crypto', TOKENIZED_COMPANIES: 'Companies', MEMES: 'Internet / Memes',
  MEME_PHRASES: 'Internet / Memes', INTERNET_DRAMA: 'Internet / Memes', REDDIT_TRENDS: 'Internet / Memes',
  VIRAL_PEOPLE: 'People', ODD_NEWS: 'Odd News', LOCAL_NEWS: 'Odd News', VIRAL_ANIMALS: 'Animals',
  TIKTOK_SOUNDS: 'TikTok', BRAND_STUNTS: 'Companies', MASCOTS: 'Internet / Memes', BREAKING_NEWS: 'Biggest Stories', GENERAL: 'Biggest Stories',
};

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly ollama: OllamaService, private readonly telegram: TelegramService) {}

  async processBreaking(trendId: string): Promise<boolean> {
    const trend = await this.prisma.trend.findUnique({ where: { id: trendId }, include: {
      scores: { orderBy: { calculatedAt: 'desc' }, take: 1 }, snapshots: { orderBy: { observedAt: 'desc' }, take: 1 },
      events: { include: { event: true } }, mentions: true, publications: { orderBy: { createdAt: 'desc' } },
    } });
    if (!trend || !trend.scores[0] || !trend.snapshots[0]) return false;
    const score = trend.scores[0];
    const platforms = [...new Set(trend.events.map(({ event }) => event.platform))];
    const sourceCount = new Set(trend.mentions.map((mention) => mention.sourceName)).size;
    if (!canPublishBreaking({ score: score.score, velocity: score.velocity, acceleration: score.acceleration, sourceCount, platformCount: platforms.length, lifecycle: trend.lifecycle, publications: trend.publications }, this.config.get<number>('scoring.thresholds.breakout', 85), this.config.get<number>('publicationScoreDelta', 5))) return false;
    const analysis = await this.ollama.analyzeTrend(trendId);
    if (!analysis.isNewsworthy) return false;
    const sources = this.sourceLines(trend.events.map(({ event }) => event));
    const content = `🚨 <b>BREAKING</b>\n\n<b>${escapeHtml(analysis.headline)}</b>\n\n${escapeHtml(analysis.summary)}\n\n<b>Why it is trending:</b>\n${escapeHtml(analysis.whyTrending)}\n\n📈 <b>Trend Score:</b> ${Math.round(score.score)}/100\n🔥 <b>Velocity:</b> ${this.level(score.velocity)}\n🌐 <b>Platforms:</b> ${platforms.map(escapeHtml).join(' • ')}\n\n<b>Sources:</b>\n${sources}`;
    await this.telegram.publish({ trendId, type: PublicationType.BREAKING, content, score: score.score, lifecycle: trend.lifecycle });
    await this.prisma.alert.create({ data: { trendId, type: 'BREAKOUT', severity: 'INFO', title: analysis.headline, message: analysis.whyTrending } });
    return true;
  }

  async publishDigest(): Promise<number> {
    const since = new Date(Date.now() - 12 * 3_600_000);
    const trends = await this.prisma.trend.findMany({
      where: { currentScore: { gte: this.config.get<number>('scoring.thresholds.hot', 70), lt: this.config.get<number>('scoring.thresholds.breakout', 85) }, lifecycle: TrendLifecycle.HOT,
        NOT: { publications: { some: { type: PublicationType.DIGEST, status: PublicationStatus.SENT, createdAt: { gte: since } } } } },
      orderBy: { currentScore: 'desc' }, take: 12, include: { events: { include: { event: true } } },
    });
    if (!trends.length) return 0;
    const sections = new Map<string, string[]>();
    for (const trend of trends) {
      const analysis = await this.ollama.analyzeTrend(trend.id);
      if (!analysis.isNewsworthy) continue;
      const group = GROUPS[trend.category];
      const line = `<b>${escapeHtml(analysis.headline)}</b> — ${escapeHtml(analysis.summary)}\nScore: ${Math.round(trend.currentScore)}/100`;
      sections.set(group, [...(sections.get(group) ?? []), line]);
    }
    if (!sections.size) return 0;
    const content = [`<b>VIRAL NEWS DIGEST</b>`, ...[...sections].map(([group, items]) => `<b>${escapeHtml(group)}</b>\n\n${items.join('\n\n')}`)].join('\n\n');
    await this.telegram.publish({ type: PublicationType.DIGEST, content });
    await this.prisma.telegramPublication.createMany({ data: trends.map((trend) => ({ trendId: trend.id, type: PublicationType.DIGEST, status: PublicationStatus.SENT, content: 'Included in digest', scoreAtPublication: trend.currentScore, lifecycleAtPublication: trend.lifecycle, publishedAt: new Date() })) });
    return trends.length;
  }

  async publishDailyRoundup(): Promise<number> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const trends = await this.prisma.trend.findMany({
      where: { lastSeenAt: { gte: since }, peakScore: { gte: this.config.get<number>('scoring.thresholds.rising', 50) } },
      orderBy: { peakScore: 'desc' }, take: 16, include: { events: { include: { event: true } }, publications: { where: { type: PublicationType.BREAKING, status: PublicationStatus.SENT } } },
    });
    if (!trends.length) return 0;
    const sections = new Map<string, string[]>();
    for (const trend of trends) {
      const analysis = await this.ollama.analyzeTrend(trend.id);
      if (!analysis.isNewsworthy) continue;
      const wasBreaking = trend.publications.length > 0;
      const context = wasBreaking ? `Update: ${analysis.whyTrending}` : analysis.summary;
      const group = GROUPS[trend.category];
      sections.set(group, [...(sections.get(group) ?? []), `<b>${escapeHtml(analysis.headline)}</b> — ${escapeHtml(context)}\nPeak score: ${Math.round(trend.peakScore)}/100`]);
    }
    if (!sections.size) return 0;
    const content = [`<b>DAILY VIRAL NEWS ROUNDUP</b>`, ...[...sections].map(([group, items]) => `<b>${escapeHtml(group)}</b>\n\n${items.join('\n\n')}`)].join('\n\n');
    await this.telegram.publish({ type: PublicationType.DAILY_ROUNDUP, content });
    return trends.length;
  }

  private level(value: number): string { return value >= 80 ? 'Very High' : value >= 60 ? 'High' : value >= 40 ? 'Moderate' : 'Low'; }
  private sourceLines(events: any[]): string {
    return [...new Map(events.map((event) => [event.canonicalUrl, event])).values()].slice(0, 5)
      .map((event: any) => `• <a href="${escapeHtml(event.url)}">${escapeHtml(event.author || event.title)}</a>`).join('\n');
  }
}
