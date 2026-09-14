import { TrendLifecycle } from '@prisma/client';

export interface ScoreComponents {
  velocity: number;
  acceleration: number;
  engagement: number;
  crossPlatform: number;
  novelty: number;
  sourceStrength: number;
}

export interface ScoreWeights {
  velocity: number;
  acceleration: number;
  engagement: number;
  crossPlatform: number;
  novelty: number;
  sourceStrength: number;
}

export type ScoreAvailability = Partial<Record<keyof ScoreComponents, boolean>>;

export interface Thresholds { monitoring: number; rising: number; hot: number; breakout: number }

export const clamp = (value: number, min = 0, max = 100): number => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

export function computeTrendScore(components: ScoreComponents, weights: ScoreWeights, availability: ScoreAvailability = {}): number {
  const enabled = (key: keyof ScoreComponents): boolean => availability[key] !== false;
  const keys = Object.keys(components) as Array<keyof ScoreComponents>;
  const totalWeight = keys.reduce((sum, key) => sum + (enabled(key) ? Math.max(0, weights[key]) : 0), 0) || 1;
  const weighted = keys.reduce((sum, key) => sum + (enabled(key) ? components[key] * weights[key] : 0), 0);
  return Math.round(clamp(weighted / totalWeight) * 100) / 100;
}

export function applyEvidenceConfidence(score: number, evidenceCount: number): number {
  const confidence = 0.75 + Math.min(1, Math.max(0, evidenceCount - 1) / 2) * 0.25;
  return Math.round(clamp(score * confidence) * 100) / 100;
}

export function lifecycleFor(score: number, previous: TrendLifecycle, hoursSinceLastSeen: number, thresholds: Thresholds, expiryHours: number): TrendLifecycle {
  if (hoursSinceLastSeen >= expiryHours) return TrendLifecycle.EXPIRED;
  if (score >= thresholds.breakout) return TrendLifecycle.BREAKOUT;
  if (score >= thresholds.hot) return TrendLifecycle.HOT;
  if (score >= thresholds.rising) return TrendLifecycle.RISING;
  if (score >= thresholds.monitoring) return TrendLifecycle.MONITORING;
  if (([TrendLifecycle.RISING, TrendLifecycle.HOT, TrendLifecycle.BREAKOUT] as TrendLifecycle[]).includes(previous)) return TrendLifecycle.DECLINING;
  return TrendLifecycle.NEW;
}

export interface MetricPoint {
  observedAt: Date;
  views?: bigint | number | null;
  likes?: bigint | number | null;
  comments?: bigint | number | null;
  reposts?: bigint | number | null;
  redditScore?: bigint | number | null;
  redditComments?: bigint | number | null;
  mentionCount?: bigint | number | null;
}

export interface RateMetrics {
  viewsPerMin: number; likesPerMin: number; commentsPerMin: number; repostsPerMin: number;
  mentionsPerMin: number; growthRate: number; acceleration: number; engagementRate: number;
  interactionVolume: number; hasEngagementData: boolean;
}

export function calculateMentionMomentum(observedAt: Date[], windowMinutes: number, now = new Date()): { mentionsPerMin: number; acceleration: number; growthRate: number } {
  const half = Math.max(1, windowMinutes / 2);
  const boundary = now.getTime() - half * 60_000;
  const recent = observedAt.filter((date) => date.getTime() >= boundary).length / half;
  const prior = observedAt.filter((date) => date.getTime() < boundary).length / half;
  return {
    mentionsPerMin: observedAt.length / Math.max(1, windowMinutes),
    acceleration: Math.max(0, recent - prior),
    growthRate: prior > 0 ? Math.max(0, (recent - prior) / prior) : recent > 0 ? 1 : 0,
  };
}

const value = (point: MetricPoint, key: keyof MetricPoint): number => Number(point[key] ?? 0);

export function calculateRateMetrics(series: MetricPoint[][], mentionCount: number, mentionWindowMinutes: number): RateMetrics {
  const totals = { viewsPerMin: 0, likesPerMin: 0, commentsPerMin: 0, repostsPerMin: 0, growthRate: 0, acceleration: 0, engagementRate: 0 };
  let comparable = 0;
  let latestViews = 0;
  let latestEngagements = 0;
  let hasEngagementData = false;
  for (const points of series) {
    if (!points.length) continue;
    const latest = points[points.length - 1];
    hasEngagementData ||= ['views', 'likes', 'comments', 'reposts', 'redditScore', 'redditComments']
      .some((key) => latest[key as keyof MetricPoint] !== null && latest[key as keyof MetricPoint] !== undefined);
    latestViews += value(latest, 'views');
    latestEngagements += value(latest, 'likes') + value(latest, 'comments') + value(latest, 'reposts') + value(latest, 'redditScore') + value(latest, 'redditComments');
    if (points.length < 2) continue;
    comparable += 1;
    const previous = points[points.length - 2];
    const minutes = Math.max(1 / 60, (latest.observedAt.getTime() - previous.observedAt.getTime()) / 60_000);
    const rate = (key: keyof MetricPoint) => Math.max(0, value(latest, key) - value(previous, key)) / minutes;
    totals.viewsPerMin += rate('views');
    totals.likesPerMin += rate('likes') + rate('redditScore');
    totals.commentsPerMin += rate('comments') + rate('redditComments');
    totals.repostsPerMin += rate('reposts');
    const oldBase = value(previous, 'views') + value(previous, 'likes') + value(previous, 'redditScore') + value(previous, 'mentionCount');
    const newBase = value(latest, 'views') + value(latest, 'likes') + value(latest, 'redditScore') + value(latest, 'mentionCount');
    totals.growthRate += oldBase > 0 ? Math.max(0, (newBase - oldBase) / oldBase) : 0;
    if (points.length >= 3) {
      const prior = points[points.length - 3];
      const priorMinutes = Math.max(1 / 60, (previous.observedAt.getTime() - prior.observedAt.getTime()) / 60_000);
      const currentRate = (newBase - oldBase) / minutes;
      const priorBase = value(prior, 'views') + value(prior, 'likes') + value(prior, 'redditScore') + value(prior, 'mentionCount');
      const priorRate = (oldBase - priorBase) / priorMinutes;
      totals.acceleration += Math.max(0, currentRate - priorRate);
    }
  }
  return {
    viewsPerMin: totals.viewsPerMin,
    likesPerMin: totals.likesPerMin,
    commentsPerMin: totals.commentsPerMin,
    repostsPerMin: totals.repostsPerMin,
    mentionsPerMin: mentionCount / Math.max(1, mentionWindowMinutes),
    growthRate: comparable ? totals.growthRate / comparable : 0,
    acceleration: comparable ? totals.acceleration / comparable : 0,
    engagementRate: latestViews > 0 ? latestEngagements / latestViews : 0,
    interactionVolume: latestEngagements,
    hasEngagementData,
  };
}
