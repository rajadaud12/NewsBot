import { PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { canPublishBreaking } from '../src/alerts/publication-rules';

describe('Telegram publication rules', () => {
  const base = { score: 91, velocity: 80, acceleration: 60, sourceCount: 2, platformCount: 2, lifecycle: TrendLifecycle.BREAKOUT, publications: [] };
  it('allows a strong multi-signal breakout', () => expect(canPublishBreaking(base)).toBe(true));
  it('rejects single-source and weak-momentum candidates', () => {
    expect(canPublishBreaking({ ...base, sourceCount: 1, platformCount: 1 })).toBe(false);
    expect(canPublishBreaking({ ...base, velocity: 20, acceleration: 20 })).toBe(false);
  });
  it('suppresses repeats without a meaningful score transition', () => {
    const prior = { type: PublicationType.BREAKING, status: PublicationStatus.SENT, scoreAtPublication: 90, lifecycleAtPublication: TrendLifecycle.BREAKOUT, createdAt: new Date() };
    expect(canPublishBreaking({ ...base, score: 92, publications: [prior] }, 85, 5)).toBe(false);
    expect(canPublishBreaking({ ...base, score: 96, publications: [prior] }, 85, 5)).toBe(true);
  });
});
