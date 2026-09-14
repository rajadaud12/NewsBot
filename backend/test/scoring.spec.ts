import { TrendLifecycle } from '@prisma/client';
import { applyEvidenceConfidence, calculateMentionMomentum, calculateRateMetrics, computeTrendScore, lifecycleFor } from '../src/scoring/scoring.engine';

const weights = { velocity: 0.25, acceleration: 0.20, engagement: 0.15, crossPlatform: 0.20, novelty: 0.10, sourceStrength: 0.10 };
const thresholds = { monitoring: 25, rising: 45, hot: 65, breakout: 80 };

describe('velocity, acceleration and scoring', () => {
  it('calculates rates from immutable observations', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    const rates = calculateRateMetrics([[
      { observedAt: base, views: 100, likes: 10, comments: 2, reposts: 1 },
      { observedAt: new Date(base.getTime() + 60_000), views: 200, likes: 30, comments: 7, reposts: 4 },
      { observedAt: new Date(base.getTime() + 120_000), views: 400, likes: 80, comments: 18, reposts: 12 },
    ]], 12, 60);
    expect(rates.viewsPerMin).toBe(200);
    expect(rates.likesPerMin).toBe(50);
    expect(rates.commentsPerMin).toBe(11);
    expect(rates.acceleration).toBeGreaterThan(0);
  });
  it('applies the configured weights', () => {
    expect(computeTrendScore({ velocity: 100, acceleration: 100, engagement: 100, crossPlatform: 100, novelty: 100, sourceStrength: 100 }, weights)).toBe(100);
    expect(computeTrendScore({ velocity: 0, acceleration: 0, engagement: 0, crossPlatform: 0, novelty: 0, sourceStrength: 0 }, weights)).toBe(0);
  });
  it('does not punish a trend for telemetry a source cannot provide', () => {
    const components = { velocity: 80, acceleration: 80, engagement: 0, crossPlatform: 80, novelty: 80, sourceStrength: 80 };
    expect(computeTrendScore(components, weights, { engagement: false })).toBe(80);
    expect(computeTrendScore(components, weights)).toBe(68);
  });
  it('requires more than one evidence item for full score confidence', () => {
    expect(applyEvidenceConfidence(80, 1)).toBe(60);
    expect(applyEvidenceConfidence(80, 2)).toBe(70);
    expect(applyEvidenceConfidence(80, 3)).toBe(80);
  });
  it('detects acceleration when mentions concentrate in the recent half-window', () => {
    const now = new Date('2026-01-01T01:00:00Z');
    const observations = [55, 54, 53, 52, 51].map((minutes) => new Date(now.getTime() - (60 - minutes) * 60_000));
    const momentum = calculateMentionMomentum(observations, 60, now);
    expect(momentum.acceleration).toBeGreaterThan(0);
    expect(momentum.growthRate).toBe(1);
  });
  it('moves through lifecycle thresholds and expires stale trends', () => {
    expect(lifecycleFor(90, TrendLifecycle.HOT, 1, thresholds, 48)).toBe(TrendLifecycle.BREAKOUT);
    expect(lifecycleFor(20, TrendLifecycle.HOT, 4, thresholds, 48)).toBe(TrendLifecycle.DECLINING);
    expect(lifecycleFor(90, TrendLifecycle.BREAKOUT, 50, thresholds, 48)).toBe(TrendLifecycle.EXPIRED);
  });
});
