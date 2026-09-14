import { PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { canPublishBreaking } from '../src/alerts/publication-rules';

describe('Telegram publication rules & today deduplication checklist', () => {
  const base = {
    score: 60,
    velocity: 50,
    acceleration: 40,
    sourceCount: 2,
    platformCount: 2,
    lifecycle: TrendLifecycle.HOT,
    publications: [],
  };

  it('allows publication when score reaches 55+ with momentum', () => {
    expect(canPublishBreaking(base, 55)).toBe(true);
    expect(canPublishBreaking({ ...base, score: 54 }, 55)).toBe(false);
  });

  it('rejects traditional news without multi-source or multi-publisher corroboration', () => {
    expect(canPublishBreaking({ ...base, sourceCount: 1, platformCount: 1, publisherCount: 1 }, 55)).toBe(false);
  });

  it('allows viral TikTok hashtags, sounds, and social trends directly at 55+ without multi-publisher requirement', () => {
    const tikTokCandidate = {
      score: 58,
      velocity: 30,
      acceleration: 25,
      sourceCount: 1,
      platformCount: 1,
      publisherCount: 1,
      lifecycle: TrendLifecycle.HOT,
      publications: [],
      isSocialViral: true,
    };
    expect(canPublishBreaking(tikTokCandidate, 55)).toBe(true);

    const soundCandidate = {
      score: 56,
      velocity: 25,
      acceleration: 20,
      sourceCount: 1,
      platformCount: 1,
      publisherCount: 1,
      lifecycle: TrendLifecycle.HOT,
      publications: [],
      isLeadingIndicator: true,
    };
    expect(canPublishBreaking(soundCandidate, 55)).toBe(true);
  });

  it('suppresses repeating today\'s published news on minor score fluctuations (checklist deduplication)', () => {
    const sentRecently = {
      type: PublicationType.BREAKING,
      status: PublicationStatus.SENT,
      scoreAtPublication: 58,
      lifecycleAtPublication: TrendLifecycle.HOT,
      createdAt: new Date(Date.now() - 2 * 3_600_000), // 2 hours ago
    };

    // Even if score increased from 58 to 68, do not re-send without major progress
    expect(canPublishBreaking({ ...base, score: 68, publications: [sentRecently] }, 55)).toBe(false);
  });

  it('allows re-sending today\'s news when genuine major progress or new scandal occurs after cooldown', () => {
    const sent4HoursAgo = {
      type: PublicationType.BREAKING,
      status: PublicationStatus.SENT,
      scoreAtPublication: 58,
      lifecycleAtPublication: TrendLifecycle.HOT,
      createdAt: new Date(Date.now() - 4 * 3_600_000), // 4 hours ago
    };

    // Resend allowed when hasMajorProgress is true and cooldown >= 3 hours
    expect(canPublishBreaking({
      ...base,
      score: 75,
      publications: [sent4HoursAgo],
      hasMajorProgress: true,
    }, 55)).toBe(true);
  });
});
