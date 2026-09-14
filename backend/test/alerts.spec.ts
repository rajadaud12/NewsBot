import { Category, PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { AlertsService } from '../src/alerts/alerts.service';

describe('AlertsService engaging message formatting', () => {
  let alertsService: AlertsService;
  let publishedContent: string | undefined;

  const mockPrisma: any = {
    trend: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    telegramPublication: {
      create: jest.fn(),
      createMany: jest.fn(),
    },
    alert: {
      create: jest.fn(),
    },
  };

  const mockConfig: any = {
    get: jest.fn((key: string, def: any) => def),
  };

  const mockOllama: any = {
    analyzeTrend: jest.fn().mockResolvedValue({
      headline: 'Viral Audio Remix Takes Over Social Platforms',
      summary: 'A surging TikTok sound transitioned into mainstream humor and culture.',
      whyTrending: 'Video creation pace reached 48,000 creations in under 24 hours.',
      isNewsworthy: true,
      confidence: 0.95,
    }),
  };

  const mockTelegram: any = {
    publish: jest.fn(async (input: any) => {
      publishedContent = input.content;
    }),
  };

  const mockPipeline: any = {
    write: jest.fn(),
  };

  beforeEach(() => {
    publishedContent = undefined;
    alertsService = new AlertsService(mockPrisma, mockConfig, mockOllama, mockTelegram, mockPipeline);
  });

  it('formats engaging message with LEADING INDICATOR badge and verified link for TikTok sound surges', async () => {
    const trendId = 'trend-sound-1';
    const mockTrend = {
      id: trendId,
      category: Category.TIKTOK_SOUNDS,
      lifecycle: TrendLifecycle.BREAKOUT,
      scores: [{ score: 88, velocity: 85, acceleration: 75 }],
      snapshots: [{ observedAt: new Date() }],
      events: [
        {
          event: {
            id: 'evt-1',
            platform: 'tiktok',
            title: 'Viral Audio Remix',
            url: 'https://www.tiktok.com/music/viral-audio-remix',
            author: 'TikTok Music',
            publishedAt: new Date(),
            metadata: {
              kind: 'sound',
              videoCount: 52_400,
              videosPerDay: 48_000,
              viewsPerHour: 142_500,
              isLeadingIndicator: true,
              topCreators: ['@creator1 (1.2M)', '@creator2 (450K)'],
            },
          },
        },
      ],
      mentions: [{ sourceName: 'tiktok', count: 5 }],
      publications: [],
    };

    mockPrisma.trend.findUnique.mockResolvedValue(mockTrend);

    // Mock verifiedSources by mocking verifyPublicHttpUrl indirectly or stubbing verifiedSources
    jest.spyOn<any, any>(alertsService, 'verifiedSources').mockResolvedValue([
      {
        publisher: 'TikTok',
        label: 'Viral Audio Remix',
        url: 'https://www.tiktok.com/music/viral-audio-remix',
      },
    ]);

    const published = await alertsService.processBreaking(trendId);
    expect(published).toBe(true);
    expect(mockTelegram.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: PublicationType.BREAKING,
        score: 88,
      }),
    );

    expect(publishedContent).toBeDefined();
    // High-engagement formatting assertions
    expect(publishedContent).toContain('🚀 <b>LEADING INDICATOR DETECTED</b>');
    expect(publishedContent).toContain('🎵 <b>TikTok Audio Surge Preceding Cross-Platform Virality</b>');
    expect(publishedContent).toContain('━━━━━━━━━━━━━━━━━━━━');
    expect(publishedContent).toContain('⚡ <b>Viral Audio Remix Takes Over Social Platforms</b>');
    expect(publishedContent).toContain('📊 <b>VIRAL METRICS & REACH</b>');
    expect(publishedContent).toContain('<code>52,400 videos</code>');
    expect(publishedContent).toContain('+48,000/day surge 🚀');
    expect(publishedContent).toContain('~142,500 views/hr');
    expect(publishedContent).toContain('👑 <b>Top Creators:</b> @creator1 (1.2M), @creator2 (450K)');
    expect(publishedContent).toContain('🔗 <b>VERIFIED EVIDENCE & COVERAGE</b>');
    expect(publishedContent).toContain('• <b><a href="https://www.tiktok.com/music/viral-audio-remix">TikTok</a></b> — <i>Viral Audio Remix</i>');
    expect(publishedContent).toContain('✅ <i>Links verified & active immediately before publication</i>');
  });

  it('formats engaging standard breakout with verified reporting when corroborated across sources', async () => {
    const trendId = 'trend-breakout-1';
    const mockTrend = {
      id: trendId,
      category: Category.MEMES,
      lifecycle: TrendLifecycle.BREAKOUT,
      scores: [{ score: 92, velocity: 80, acceleration: 65 }],
      snapshots: [{ observedAt: new Date() }],
      events: [
        {
          event: {
            id: 'evt-1',
            platform: 'tiktok',
            title: '#breakoutmeme trending globally',
            url: 'https://www.tiktok.com/tag/breakoutmeme',
            author: 'TikTok',
            publishedAt: new Date(),
            metadata: { kind: 'hashtag', videoCount: 120_000 },
          },
        },
        {
          event: {
            id: 'evt-2',
            platform: 'news',
            title: 'New internet meme culture trend analyzed by media',
            url: 'https://theverge.com/article-meme',
            author: 'The Verge',
            publishedAt: new Date(),
            metadata: {},
          },
        },
      ],
      mentions: [{ sourceName: 'tiktok', count: 3 }, { sourceName: 'google-news', count: 2 }],
      publications: [],
    };

    mockPrisma.trend.findUnique.mockResolvedValue(mockTrend);

    jest.spyOn<any, any>(alertsService, 'verifiedSources').mockResolvedValue([
      { publisher: 'TikTok', label: '#breakoutmeme trending globally', url: 'https://www.tiktok.com/tag/breakoutmeme' },
      { publisher: 'The Verge', label: 'New internet meme culture trend analyzed by media', url: 'https://theverge.com/article-meme' },
    ]);

    const published = await alertsService.processBreaking(trendId);
    expect(published).toBe(true);
    expect(publishedContent).toContain('🔥 <b>VIRAL BREAKOUT ALERT</b>');
    expect(publishedContent).toContain('━━━━━━━━━━━━━━━━━━━━');
    expect(publishedContent).toContain('• <b><a href="https://theverge.com/article-meme">The Verge</a></b>');
    expect(publishedContent).toContain('• <b><a href="https://www.tiktok.com/tag/breakoutmeme">TikTok</a></b>');

    // Strict requirement: score must NOT be mentioned anywhere in the Telegram message
    expect(publishedContent).not.toMatch(/\/100/);
    expect(publishedContent).not.toMatch(/\bScore\b/i);
  });

  it('suppresses repeating today\'s news when score fluctuates without major progress', async () => {
    const trendId = 'trend-repeat-check';
    const mockTrend = {
      id: trendId,
      category: Category.MEMES,
      lifecycle: TrendLifecycle.BREAKOUT,
      scores: [{ score: 85, velocity: 75, acceleration: 60 }],
      snapshots: [{ observedAt: new Date() }],
      events: [
        {
          addedAt: new Date(Date.now() - 3 * 3_600_000),
          event: { id: 'evt-1', platform: 'tiktok', title: 'Viral Meme', url: 'https://www.tiktok.com/tag/viral', author: 'TikTok', publishedAt: new Date() },
        },
      ],
      mentions: [{ sourceName: 'tiktok', count: 5 }],
      publications: [
        {
          type: PublicationType.BREAKING,
          status: PublicationStatus.SENT,
          scoreAtPublication: 70,
          lifecycleAtPublication: TrendLifecycle.BREAKOUT,
          createdAt: new Date(Date.now() - 2 * 3_600_000), // 2 hours ago
        },
      ],
    };

    mockPrisma.trend.findUnique.mockResolvedValue(mockTrend);
    const published = await alertsService.processBreaking(trendId);
    expect(published).toBe(false);
  });

  it('allows resending with MAJOR DEVELOPMENT UPDATE when new scandal/progress occurs', async () => {
    const trendId = 'trend-progress-check';
    const publishedAtTime = new Date(Date.now() - 4 * 3_600_000); // 4 hours ago
    const mockTrend = {
      id: trendId,
      category: Category.MEMES,
      lifecycle: TrendLifecycle.BREAKOUT,
      scores: [{ score: 85, velocity: 75, acceleration: 60 }],
      snapshots: [{ observedAt: new Date() }],
      events: [
        { addedAt: new Date(Date.now() - 5 * 3_600_000), event: { id: 'evt-1', platform: 'tiktok', title: 'Story Part 1', url: 'https://www.tiktok.com/tag/story1', author: 'TikTok', publishedAt: new Date() } },
        { addedAt: new Date(Date.now() - 1 * 3_600_000), event: { id: 'evt-2', platform: 'news', title: 'New Scandal Breaks', url: 'https://news.com/scandal', author: 'News', publishedAt: new Date() } },
        { addedAt: new Date(Date.now() - 1 * 3_600_000), event: { id: 'evt-3', platform: 'x', title: 'Scandal Viral Reaction', url: 'https://x.com/post1', author: 'X', publishedAt: new Date() } },
        { addedAt: new Date(Date.now() - 1 * 3_600_000), event: { id: 'evt-4', platform: 'tiktok', title: 'Creators React to Scandal', url: 'https://www.tiktok.com/tag/story-update', author: 'TikTok', publishedAt: new Date() } },
      ],
      mentions: [{ sourceName: 'tiktok', count: 10 }],
      publications: [
        {
          type: PublicationType.BREAKING,
          status: PublicationStatus.SENT,
          scoreAtPublication: 58,
          lifecycleAtPublication: TrendLifecycle.HOT,
          createdAt: publishedAtTime,
        },
      ],
    };

    mockPrisma.trend.findUnique.mockResolvedValue(mockTrend);
    jest.spyOn<any, any>(alertsService, 'verifiedSources').mockResolvedValue([
      { publisher: 'News', label: 'New Scandal Breaks', url: 'https://news.com/scandal' },
    ]);

    const published = await alertsService.processBreaking(trendId);
    expect(published).toBe(true);
    expect(publishedContent).toContain('🚨 <b>MAJOR DEVELOPMENT UPDATE</b>');
    expect(publishedContent).toContain('⚡ <b>Breaking Progress on Viral Story</b>');
    expect(publishedContent).not.toMatch(/\/100/);
    expect(publishedContent).not.toMatch(/\bScore\b/i);
  });
});
