import { ConfigService } from '@nestjs/config';
import { Category } from '@prisma/client';
import { GoogleNewsSource } from '../src/sources/google-news/google-news.service';
import { XSource } from '../src/sources/x/x.service';
import { PrismaService } from '../src/database/prisma.service';

describe('source normalization', () => {
  it('normalizes a Google News event without fabricating fields', async () => {
    const source = new GoogleNewsSource(new ConfigService(), {} as PrismaService);
    const event = await source.normalize({
      externalId: 'story-1', title: 'Viral cat takes over city hall - Example News', content: 'Officials confirmed the unusual visit.',
      author: 'Example News', url: 'https://example.com/story', publishedAt: '2026-01-01T00:00:00Z', payload: {},
    });
    expect(event.title).toBe('Viral cat takes over city hall');
    expect(event.category).toBe(Category.VIRAL_ANIMALS);
    expect(event.url).toBe('https://example.com/story');
  });
});

describe('X credit controls', () => {
  it('does not call X when fewer than the minimum request size remains in the daily budget', async () => {
    const previousBearer = process.env.X_BEARER_TOKEN;
    process.env.X_BEARER_TOKEN = 'test-bearer';
    const values: Record<string, unknown> = {
      enabledSources: ['x'], 'queries.x': ['viral animal lang:en'],
      'collection.x.dailyPostBudget': 200, 'collection.x.maxResults': 10, 'collection.x.queriesPerRun': 1,
    };
    const config = { get: (key: string, fallback: unknown) => values[key] ?? fallback } as ConfigService;
    const prisma = {
      source: { findUnique: jest.fn().mockResolvedValue({ configuration: null }), update: jest.fn().mockResolvedValue({}) },
      rawEvent: { count: jest.fn().mockResolvedValue(199) },
      normalizedEvent: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const fetchSpy = jest.spyOn(global, 'fetch');
    try {
      await expect(new XSource(config, prisma).collect()).resolves.toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((prisma.source.update as jest.Mock).mock.calls[0][0].data.configuration.xOptimization.lastSkippedReason).toContain('199/200');
    } finally {
      fetchSpy.mockRestore();
      if (previousBearer === undefined) delete process.env.X_BEARER_TOKEN;
      else process.env.X_BEARER_TOKEN = previousBearer;
    }
  });
});
