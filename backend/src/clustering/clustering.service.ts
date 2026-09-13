import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NormalizedEvent } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { domainOf, jaccard, levenshteinSimilarity, tokenize } from '../common/utils/text';

export interface ClusterComparable {
  title: string;
  url: string;
  keywords: string[];
  entities: string[];
}

export function clusterSimilarity(left: ClusterComparable, right: ClusterComparable): number {
  const tokenScore = jaccard(tokenize(left.title), tokenize(right.title));
  const keywordScore = jaccard(left.keywords, right.keywords);
  const entityScore = left.entities.length && right.entities.length ? jaccard(left.entities.map((x) => x.toLowerCase()), right.entities.map((x) => x.toLowerCase())) : 0;
  const fuzzyScore = levenshteinSimilarity(left.title, right.title);
  const domainScore = domainOf(left.url) && domainOf(left.url) === domainOf(right.url) ? 1 : 0;
  return tokenScore * 0.32 + keywordScore * 0.23 + entityScore * 0.20 + fuzzyScore * 0.20 + domainScore * 0.05;
}

@Injectable()
export class ClusteringService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async assign(event: NormalizedEvent, sourceName: string): Promise<{ trendId: string; created: boolean; similarity: number }> {
    const since = new Date(Date.now() - this.config.get<number>('clustering.lookbackHours', 72) * 3_600_000);
    const candidates = await this.prisma.trend.findMany({
      where: { lastSeenAt: { gte: since }, lifecycle: { not: 'EXPIRED' } },
      orderBy: { lastSeenAt: 'desc' }, take: 250,
      include: { events: { orderBy: { addedAt: 'desc' }, take: 8, include: { event: true } } },
    });
    let best: { id: string; score: number } | undefined;
    for (const trend of candidates) {
      const score = Math.max(0, ...trend.events.map(({ event: member }) => clusterSimilarity(
        { title: event.title, url: event.canonicalUrl, keywords: event.keywords, entities: event.entities },
        { title: member.title, url: member.canonicalUrl, keywords: member.keywords, entities: member.entities },
      )));
      if (!best || score > best.score) best = { id: trend.id, score };
    }
    const threshold = this.config.get<number>('clustering.threshold', 0.42);
    const created = !best || best.score < threshold;
    const trend = created
      ? await this.prisma.trend.create({ data: { canonicalTitle: event.title, category: event.category, firstSeenAt: event.firstSeenAt, lastSeenAt: event.lastSeenAt } })
      : await this.prisma.trend.update({ data: { lastSeenAt: event.lastSeenAt }, where: { id: best!.id } });
    const similarity = created ? 1 : best!.score;
    await this.prisma.$transaction([
      this.prisma.trendEvent.upsert({ where: { trendId_eventId: { trendId: trend.id, eventId: event.id } }, update: { similarity }, create: { trendId: trend.id, eventId: event.id, similarity } }),
      this.prisma.trendMention.create({ data: { trendId: trend.id, platform: event.platform, sourceName, count: 1, observedAt: event.lastSeenAt } }),
    ]);
    return { trendId: trend.id, created, similarity };
  }
}
