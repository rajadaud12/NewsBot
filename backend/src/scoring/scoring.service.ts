import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Prisma, TrendLifecycle } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { applyEvidenceConfidence, calculateMentionMomentum, calculateRateMetrics, clamp, computeTrendScore, lifecycleFor, ScoreAvailability, ScoreComponents, ScoreWeights, Thresholds } from './scoring.engine';
import { PipelineLogService } from '../pipeline/pipeline-log.service';
import { normalizeText, publisherOf } from '../common/utils/text';

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly pipeline: PipelineLogService) {}

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
    const mentionCount = trend.mentions.reduce((sum, mention) => sum + mention.count, 0);
    const rates = calculateRateMetrics(trend.events.map(({ event }) => event.metrics), mentionCount, lookbackMinutes);
    const mentionObservations = trend.mentions.flatMap((mention) => Array.from({ length: mention.count }, () => mention.observedAt));
    const mentionMomentum = calculateMentionMomentum(mentionObservations, lookbackMinutes);
    const observationSpanMinutes = mentionObservations.length > 1
      ? (Math.max(...mentionObservations.map((date) => date.getTime())) - Math.min(...mentionObservations.map((date) => date.getTime()))) / 60_000
      : 0;
    const effectiveObservationMinutes = Math.min(lookbackMinutes, Math.max(10, observationSpanMinutes + 5));
    rates.mentionsPerMin = mentionCount / effectiveObservationMinutes;
    const sampleConfidence = Math.min(1, mentionCount / 3);
    rates.acceleration = (rates.acceleration + mentionMomentum.acceleration * 10) * sampleConfidence;
    rates.growthRate = Math.max(rates.growthRate, mentionMomentum.growthRate);
    const recentEvents = trend.events.map(({ event }) => event).filter((event) => event.lastSeenAt >= since);
    const platforms = new Set(recentEvents.map((event) => event.platform));
    const sourceNames = new Set(trend.mentions.map((mention) => mention.sourceName));
    const publishers = new Set(recentEvents.map(publisherOf).filter(Boolean));
    const independentTitles = new Set(recentEvents.map((event) => normalizeText(event.title)).filter(Boolean));
    const meanSimilarity = trend.events.length
      ? trend.events.reduce((sum, event) => sum + event.similarity, 0) / trend.events.length
      : 0;
    const ageHours = Math.max(0, (Date.now() - trend.firstSeenAt.getTime()) / 3_600_000);
    const rawVelocity = rates.mentionsPerMin * 120 + rates.likesPerMin * 0.7 + rates.commentsPerMin * 1.5 + rates.repostsPerMin * 1.8 + rates.viewsPerMin * 0.03;
    const publisherSignal = publishers.size ? Math.log1p(publishers.size) / Math.log(8) * 45 : 0;
    const editorialSignal = independentTitles.size ? Math.log1p(independentTitles.size) / Math.log(6) * 35 : 0;

    // Dedicated virality scoring for TikTok & social trends:
    // Hashtags and audio sounds are viral cultural phenomena, not traditional newspaper articles.
    // They are scored on rank, video creations, view velocity, and leading indicator signals
    // so they easily reach the 55+ publication threshold without requiring multi-publisher news corroboration.
    const isTikTok = platforms.has('tiktok') || trend.category === Category.TIKTOK_SOUNDS;
    const isSocial = isTikTok || platforms.has('x') || trend.category === Category.MEMES || trend.category === Category.MEME_PHRASES;
    let socialViralitySignal = 0;
    if (isSocial) {
      const videoCounts = trend.events.map(({ event }) => Number((event.metadata as any)?.videoCount ?? (event.metrics as any)?.[0]?.mentionCount)).filter(Number.isFinite);
      const viewsList = trend.events.map(({ event }) => Number((event.metadata as any)?.views ?? (event.metadata as any)?.vv ?? (event.metrics as any)?.[0]?.views)).filter(Number.isFinite);
      const ranks = trend.events.map(({ event }) => Number((event.metadata as any)?.rank)).filter(Number.isFinite);
      const maxVideos = videoCounts.length ? Math.max(...videoCounts) : 0;
      const maxViews = viewsList.length ? Math.max(...viewsList) : 0;
      const bestRank = ranks.length ? Math.min(...ranks) : undefined;
      const hasLeadingIndicator = trend.events.some(({ event }) => Boolean((event.metadata as any)?.isLeadingIndicator));

      if (isTikTok) {
        // TikTok Creative Center baseline: Any featured trending hashtag/sound starts with solid baseline
        socialViralitySignal = 58;

        if (bestRank !== undefined) {
          if (bestRank <= 5) socialViralitySignal = Math.max(socialViralitySignal, 88 - bestRank * 2);
          else if (bestRank <= 20) socialViralitySignal = Math.max(socialViralitySignal, 78 - (bestRank - 5));
          else if (bestRank <= 50) socialViralitySignal = Math.max(socialViralitySignal, 66 - Math.round((bestRank - 20) * 0.3));
        }

        if (maxViews > 10_000_000) socialViralitySignal += 14;
        else if (maxViews > 1_000_000) socialViralitySignal += 10;
        else if (maxViews > 100_000) socialViralitySignal += 5;

        if (maxVideos > 50_000) socialViralitySignal += 14;
        else if (maxVideos > 10_000) socialViralitySignal += 10;
        else if (maxVideos > 1_000) socialViralitySignal += 5;

        if (hasLeadingIndicator) socialViralitySignal += 12;
      } else {
        // Other social discussions (e.g. viral X trends)
        if (bestRank !== undefined && bestRank <= 30) {
          socialViralitySignal += Math.max(30, 70 - bestRank * 2);
        }
        if (maxViews > 1_000_000) {
          socialViralitySignal += Math.min(25, Math.log10(maxViews / 100_000) * 10);
        }
        if (maxVideos > 2_000) {
          socialViralitySignal += Math.min(25, Math.log10(maxVideos / 1_000) * 12);
        }
      }
      socialViralitySignal = clamp(socialViralitySignal, 0, 100);
    }

    const corroborationSignal = clamp(
      Math.max(
        publisherSignal + editorialSignal + Math.max(0, sourceNames.size - 1) * 12 + Math.max(0, platforms.size - 1) * 20,
        socialViralitySignal,
      ),
    );

    const velocityVal = isSocial && socialViralitySignal >= 50
      ? Math.max(clamp(Math.log1p(rawVelocity) * 17), socialViralitySignal * 0.88)
      : clamp(Math.log1p(rawVelocity) * 17);

    const accelerationVal = isSocial && socialViralitySignal >= 50
      ? Math.max(clamp(Math.log1p((rates.acceleration + rates.growthRate * 10) * sampleConfidence) * 25), socialViralitySignal * 0.80)
      : clamp(Math.log1p((rates.acceleration + rates.growthRate * 10) * sampleConfidence) * 25);

    const engagementVal = isTikTok
      ? Math.max(
          rates.engagementRate > 0 ? clamp(rates.engagementRate * 500) : clamp(Math.log1p(rates.interactionVolume) * 18),
          clamp(socialViralitySignal * 0.75),
        )
      : rates.engagementRate > 0 ? clamp(rates.engagementRate * 500) : clamp(Math.log1p(rates.interactionVolume) * 18);

    const components: ScoreComponents = {
      velocity: velocityVal,
      acceleration: accelerationVal,
      engagement: engagementVal,
      crossPlatform: isTikTok ? clamp(socialViralitySignal) : clamp(corroborationSignal * (0.75 + meanSimilarity * 0.25)),
      novelty: clamp(100 - ageHours * 2.5),
      sourceStrength: isTikTok ? Math.max(this.sourceStrength([...sourceNames]), 85) : this.sourceStrength([...sourceNames]),
    };
    const availability: ScoreAvailability = { engagement: rates.hasEngagementData };
    const weights = this.config.get<ScoreWeights>('scoring.weights')!;
    const thresholds = this.config.get<Thresholds>('scoring.thresholds')!;
    const uncalibratedScore = computeTrendScore(components, weights, availability);
    const score = isSocial && socialViralitySignal >= 50 ? uncalibratedScore : applyEvidenceConfidence(uncalibratedScore, mentionCount);
    const evidenceConfidence = score / Math.max(uncalibratedScore, 1);
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
        platformCount: platforms.size, metrics: { viewsPerMin: rates.viewsPerMin, publisherCount: publishers.size, independentEvidenceCount: independentTitles.size, collectorCount: sourceNames.size, evidenceCount: recentEvents.length, meanSimilarity, availability, uncalibratedScore, evidenceConfidence } as Prisma.InputJsonValue,
      } });
      await tx.trend.update({ where: { id: trendId }, data: { currentScore: score, peakScore: Math.max(trend.peakScore, score), lifecycle } });
      return record;
    });
    if (trend.lifecycle !== lifecycle) {
      this.logger.log(`Trend ${trendId} ${trend.lifecycle} -> ${lifecycle} (${score})`);
      await this.prisma.systemLog.create({ data: { component: 'scoring', message: `Trend lifecycle changed from ${trend.lifecycle} to ${lifecycle}`, context: { trendId, score } } });
    }
    await this.pipeline.write({ stage: 'SCORING', status: 'COMPLETED', trendId, message: `Scored trend at ${Math.round(score)}/100 (${lifecycle})`, context: { score, uncalibratedScore, evidenceConfidence, lifecycle, previousLifecycle: trend.lifecycle, components, availability, publisherCount: publishers.size, independentEvidenceCount: independentTitles.size, platformCount: platforms.size, sourceCount: sourceNames.size } });
    return { ...scoreRecord, lifecycle, rates, platformCount: platforms.size, sourceCount: sourceNames.size, publisherCount: publishers.size };
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
