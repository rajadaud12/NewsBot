import { Category } from '@prisma/client';
import {
  compactMetric,
  creativeCenterItemToEvent,
  extractDehydratedState,
  formatTopCreator,
  TikTokCreativeCenterSource,
} from '../src/sources/tiktok/tiktok.service';

describe('TikTok Creative Center normalization', () => {
  it('parses compact public metrics', () => {
    expect(compactMetric('2.5K')).toBe(2_500);
    expect(compactMetric('1.25M Posts')).toBe(1_250_000);
    expect(compactMetric('232.8M Views')).toBe(232_800_000);
    expect(compactMetric('not available')).toBeUndefined();
  });

  it('formats top creator handles, nicknames, and follower counts', () => {
    expect(formatTopCreator('PlainCreator')).toBe('PlainCreator');
    expect(formatTopCreator({ handleName: 'queenuxty53', nickname: 'VictoriaAndersen', followedCnt: '25308' }))
      .toBe('@queenuxty53 (VictoriaAndersen • 25.3K)');
    expect(formatTopCreator({ handleName: 'creator2', nickname: 'creator2', followedCnt: 1_200_000 }))
      .toBe('@creator2 (1.2M)');
  });

  it('turns a sound observation into an immutable metric-ready event', () => {
    const event = creativeCenterItemToEvent({
      id: 'sound-42',
      kind: 'sound',
      soundName: 'A Very Viral Sound',
      artistName: 'Example Artist',
      rank: 2,
      rankChange: 8,
      videoCount: '50K',
      views: '4.2M',
      topCreators: ['Creator One', 'Creator Two'],
      url: 'https://ads.tiktok.com/business/creativecenter/song/a-very-viral-sound-42/pc/en',
    }, 0, new Date('2026-09-14T00:00:00Z'));

    expect(event.category).toBe(Category.TIKTOK_SOUNDS);
    expect(event.metrics?.mentionCount).toBe(50_000);
    expect(event.metrics?.views).toBe(4_200_000);
    expect(event.metadata).toMatchObject({
      kind: 'sound',
      rank: 2,
      videoCount: 50_000,
      topCreators: ['Creator One', 'Creator Two'],
    });
  });

  it('extracts dehydrated SSR query state from Creative Center page HTML', () => {
    const mockHtml = `
      <!DOCTYPE html><html><head></head><body>
      <script>
      {
        "loaderData": {
          "creativeCenter/trends/(tab)/page": {
            "dehydratedState": {
              "queries": [
                {
                  "queryKey": ["trendsFilter"],
                  "state": { "data": { "country": ["US"] } }
                },
                {
                  "queryKey": ["hashtagList"],
                  "state": {
                    "data": {
                      "pages": [
                        {
                          "data": [
                            {
                              "hashtagID": "12345",
                              "hashtagName": "breakoutmeme",
                              "publishCnt": "52400",
                              "vv": "120500000",
                              "rankIndex": "1",
                              "topCreators": [
                                { "handleName": "trendsetter", "nickname": "Trend Setter", "followedCnt": "500000" }
                              ],
                              "popularityCurve": [{ "timestamp": "1789171200", "value": 100 }]
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      }
      </script>
      </body></html>
    `;

    const items = extractDehydratedState(mockHtml, 'US');
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('breakoutmeme');
    expect(items[0].kind).toBe('hashtag');
    expect(items[0].videoCount).toBe('52400');
    expect(items[0].views).toBe('120500000');
    expect(items[0].rank).toBe(1);
    expect(items[0].url).toBe('https://www.tiktok.com/tag/breakoutmeme');
    expect(items[0].topCreators).toContain('@trendsetter (Trend Setter • 500.0K)');
  });

  it('identifies sound velocity surge as a leading indicator before cross-platform spread', async () => {
    const mockConfig: any = {
      get: (key: string, def: any) => def,
    };
    const mockPrisma: any = {
      rawEvent: {
        findMany: async () => [
          {
            externalId: 'sound:viral-audio',
            normalized: {
              metrics: [
                {
                  mentionCount: BigInt(2_000), // was 2,000 video creations
                  views: BigInt(500_000),
                  observedAt: new Date(Date.now() - 24 * 3_600_000), // 24 hours ago
                },
              ],
            },
          },
        ],
      },
      source: { findUnique: async () => null, updateMany: async () => {} },
    };

    const source = new TikTokCreativeCenterSource(mockConfig, mockPrisma);

    const rawEvent = creativeCenterItemToEvent({
      id: 'sound:viral-audio',
      kind: 'sound',
      soundName: 'Viral Audio Remix',
      videoCount: 50_000, // jumped to 50,000 videos in 24 hours!
      views: 15_000_000,
      topCreators: ['@creator1', '@creator2'],
    }, 0);

    const scored = await source.addRates([rawEvent]);
    expect(scored.length).toBe(1);

    const metrics = scored[0].metrics?.raw as any;
    expect(metrics.videosPerDay).toBeGreaterThan(40_000);
    expect(metrics.isLeadingIndicator).toBe(true);
    expect(metrics.leadingIndicatorReason).toContain('Audio surged');
    expect(scored[0].metadata).toHaveProperty('isLeadingIndicator', true);
  });

  it('does not accept a non-TikTok link supplied by a feed item', () => {
    const event = creativeCenterItemToEvent({ kind: 'hashtag', hashtag: 'safe-trend', url: 'https://example.invalid/redirect' }, 0);
    expect(event.url).toContain('ads.tiktok.com/business/creativecenter');
  });
});
