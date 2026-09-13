import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TrendLifecycle } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { calculateMentionMomentum, calculateRateMetrics, clamp, computeTrendScore, lifecycleFor, ScoreComponents, ScoreWeights, Thresholds } from './scoring.engine';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async scoreTrend(trendId: string) {
    const lookbackMinutes = this.config.get<number>('scoring.metricLookbackMinutes', 60);
    const since = new Date(Date.now() - lookbackMinutes * 60_000);
    const trend = await this.prisma.trend.findUnique({
      where: { id: trendId },
      include: {
        events: { include: { event: { include: { metrics: { where: { observedAt: { gte: since } }, orderBy: { observedAt: 'asc' } } } } } },
        mentions: { where: { observedAt: { gte: since } } }, scores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
      },
    });
    if (!trend) throw new Error(`Trend ${trendId} not found`);
    const rates = calculateRateMetrics(trend.events.map(({ event }) => event.metrics), trend.mentions.reduce((sum, mention) => sum + mention.count, 0), lookbackMinutes);
    const mentionObservations = trend.mentions.flatMap((mention) => Array.from({ length: mention.count }, () => mention.observedAt));
    const mentionMomentum = calculateMentionMomentum(mentionObservations, lookbackMinutes);
    rates.mentionsPerMin = mentionMomentum.mentionsPerMin;
    rates.acceleration += mentionMomentum.acceleration * 10;
    rates.growthRate = Math.max(rates.growthRate, mentionMomentum.growthRate);
    const platforms = new Set(trend.events.map(({ event }) => event.platform));
    const sourceNames = new Set(trend.mentions.map((mention) => mention.sourceName));
    const ageHours = Math.max(0, (Date.now() - trend.firstSeenAt.getTime()) / 3_600_000);
    const rawVelocity = rates.mentionsPerMin * 120 + rates.likesPerMin * 0.7 + rates.commentsPerMin * 1.5 + rates.repostsPerMin * 1.8 + rates.viewsPerMin * 0.03;
    const components: ScoreComponents = {
      velocity: clamp(Math.log1p(rawVelocity) * 17),
      acceleration: clamp(Math.log1p(rates.acceleration + rates.growthRate * 10) * 25),
      engagement: clamp(rates.engagementRate * 500),
      crossPlatform: clamp(Math.min(25, trend.events.length * 4) + Math.max(0, sourceNames.size - 1) * 20 + Math.max(0, platforms.size - 1) * 25),
      novelty: clamp(100 - ageHours * 3 - Math.max(0, trend.events.length - 1) * 1.5),
      sourceStrength: this.sourceStrength([...sourceNames]),
    };
    const weights = this.config.get<ScoreWeights>('scoring.weights')!;
    const thresholds = this.config.get<Thresholds>('scoring.thresholds')!;
    const score = computeTrendScore(components, weights);
    const hoursSinceLastSeen = Math.max(0, (Date.now() - trend.lastSeenAt.getTime()) / 3_600_000);
    const lifecycle = lifecycleFor(score, trend.lifecycle, hoursSinceLastSeen, thresholds, this.config.get<number>('scoring.expiryHours', 48));
    const scoreRecord = await this.prisma.$transaction(async (tx) => {
      const record = await tx.trendScore.create({ data: {
        trendId, score, velocity: components.velocity, acceleration: components.acceleration,
        engagement: components.engagement, crossPlatformSpread: components.crossPlatform,
        novelty: components.novelty, sourceStrength: components.sourceStrength,
      } });
      await tx.trendSnapshot.create({ data: {
        trendId, score, lifecycle, mentionsPerMin: rates.mentionsPerMin, likesPerMin: rates.likesPerMin,
        commentsPerMin: rates.commentsPerMin, repostsPerMin: rates.repostsPerMin,
        growthRate: rates.growthRate, acceleration: rates.acceleration, engagementRate: rates.engagementRate,
        platformCount: platforms.size, metrics: { viewsPerMin: rates.viewsPerMin } as Prisma.InputJsonValue,
      } });
      await tx.trend.update({ where: { id: trendId }, data: { currentScore: score, peakScore: Math.max(trend.peakScore, score), lifecycle } });
      return record;
    });
    if (trend.lifecycle !== lifecycle) {
      this.logger.log(`Trend ${trendId} ${trend.lifecycle} -> ${lifecycle} (${score})`);
      await this.prisma.systemLog.create({ data: { component: 'scoring', message: `Trend lifecycle changed from ${trend.lifecycle} to ${lifecycle}`, context: { trendId, score } } });
    }
    return { ...scoreRecord, lifecycle, rates, platformCount: platforms.size, sourceCount: sourceNames.size };
  }

  async scoreActive(): Promise<Array<{ trendId: string; score: number; lifecycle: TrendLifecycle }>> {
    const trends = await this.prisma.trend.findMany({ where: { lifecycle: { not: TrendLifecycle.EXPIRED } }, select: { id: true } });
    const results = [];
    for (const trend of trends) {
      try {
        const result = await this.scoreTrend(trend.id);
        results.push({ trendId: trend.id, score: result.score, lifecycle: result.lifecycle });
      } catch (error) { this.logger.error(`Scoring ${trend.id} failed: ${error instanceof Error ? error.message : error}`); }
    }
    return results;
  }

  async expireStale(): Promise<number> {
    const cutoff = new Date(Date.now() - this.config.get<number>('scoring.expiryHours', 48) * 3_600_000);
    const result = await this.prisma.trend.updateMany({ where: { lastSeenAt: { lt: cutoff }, lifecycle: { not: TrendLifecycle.EXPIRED } }, data: { lifecycle: TrendLifecycle.EXPIRED } });
    return result.count;
  }

  private sourceStrength(sources: string[]): number {
    const scores: Record<string, number> = { gdelt: 80, 'google-news': 75, reddit: 60, tiktok: 55, x: 55 };
    if (!sources.length) return 0;
    return clamp(sources.reduce((sum, source) => sum + (scores[source] ?? 45), 0) / sources.length + Math.max(0, sources.length - 1) * 5);
  }
}
