import { NewsProcessor, TELEGRAM_QUEUE } from '../src/scheduler/news.processor';
import { TelegramProcessor } from '../src/scheduler/telegram.processor';
import { TrendLifecycle } from '@prisma/client';

describe('Scheduler and Telegram Processor continuous delivery', () => {
  it('queues trends for Telegram delivery whenever score reaches 55+ (threshold)', async () => {
    const mockSources: any = { collect: jest.fn() };
    const mockScoring: any = {
      scoreActive: jest.fn().mockResolvedValue([
        { trendId: 'trend-58', score: 58, lifecycle: TrendLifecycle.HOT },
        { trendId: 'trend-42', score: 42, lifecycle: TrendLifecycle.RISING },
        { trendId: 'trend-82', score: 82, lifecycle: TrendLifecycle.BREAKOUT },
      ]),
      expireStale: jest.fn(),
    };
    const mockEvents: any = { reclassify: jest.fn() };
    const mockPipeline: any = { write: jest.fn() };
    const mockConfig: any = {
      get: jest.fn((key: string, def: any) => {
        if (key === 'telegram.deliveryMode') return 'continuous';
        if (key === 'publicationThreshold') return 55;
        return def;
      }),
    };
    const mockTelegramQueue: any = {
      add: jest.fn().mockResolvedValue({ id: 'job-123' }),
    };

    const newsProcessor = new NewsProcessor(
      mockSources,
      mockScoring,
      mockEvents,
      mockPipeline,
      mockConfig,
      mockTelegramQueue,
    );

    const mockJob: any = { id: 'job-score', name: 'score', data: {} };
    await newsProcessor.process(mockJob);

    // trend-58 and trend-82 should be queued; trend-42 should NOT be queued
    expect(mockTelegramQueue.add).toHaveBeenCalledTimes(2);
    expect(mockTelegramQueue.add).toHaveBeenCalledWith(
      'publish-breaking',
      { trendId: 'trend-58' },
      expect.objectContaining({ jobId: 'breaking-trend-58' }),
    );
    expect(mockTelegramQueue.add).toHaveBeenCalledWith(
      'publish-breaking',
      { trendId: 'trend-82' },
      expect.objectContaining({ jobId: 'breaking-trend-82' }),
    );
  });

  it('TelegramProcessor processes breaking jobs one by one with sequential pacing', async () => {
    const mockAlerts: any = {
      processBreaking: jest.fn().mockResolvedValue(true),
      publishDigest: jest.fn(),
      publishDailyRoundup: jest.fn(),
    };
    const mockPipeline: any = { write: jest.fn() };

    const telegramProcessor = new TelegramProcessor(mockAlerts, mockPipeline);

    const start = Date.now();
    const result = await telegramProcessor.process({
      name: 'publish-breaking',
      data: { trendId: 'trend-58' },
    } as any);

    const elapsed = Date.now() - start;
    expect(result).toEqual({ sent: true });
    expect(mockAlerts.processBreaking).toHaveBeenCalledWith('trend-58');
    // Verifies the 2-second sequential pacing delay
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  });
});
