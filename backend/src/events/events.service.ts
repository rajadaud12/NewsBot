import { Injectable, Logger } from '@nestjs/common';
import { Category, EventStatus, Prisma, SourceType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ClusteringService } from '../clustering/clustering.service';
import { MetricInput, RawEventInput, TrendSource } from '../common/types/source';
import { canonicalizeUrl, fingerprint, inferCategory, normalizeText } from '../common/utils/text';
import { hammingDistance, hashRemoteImage } from '../common/utils/media';

export type IngestStatus = 'normalized' | 'duplicate' | 'seen';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  constructor(private readonly prisma: PrismaService, private readonly clustering: ClusteringService) {}

  async ingest(provider: TrendSource, input: RawEventInput): Promise<{ status: IngestStatus; clustered: boolean }> {
    const source = await this.prisma.source.upsert({
      where: { name: provider.name },
      update: { type: provider.type as SourceType, enabled: provider.isEnabled() },
      create: { name: provider.name, type: provider.type as SourceType, enabled: provider.isEnabled() },
    });
    const existingRaw = await this.prisma.rawEvent.findUnique({ where: { sourceId_externalId: { sourceId: source.id, externalId: input.externalId } }, include: { normalized: true } });
    if (existingRaw?.normalized) {
      await this.prisma.rawEvent.update({ where: { id: existingRaw.id }, data: { lastSeenAt: new Date(), payload: input.payload as Prisma.InputJsonValue } });
      await this.prisma.normalizedEvent.update({ where: { id: existingRaw.normalized.id }, data: { lastSeenAt: new Date() } });
      if (input.metrics) await this.recordMetric(existingRaw.normalized.id, input.metrics);
      return { status: 'seen', clustered: false };
    }

    const raw = existingRaw ?? await this.prisma.rawEvent.create({ data: {
      sourceId: source.id, externalId: input.externalId, payload: input.payload as Prisma.InputJsonValue,
      firstSeenAt: new Date(), lastSeenAt: new Date(), status: EventStatus.COLLECTED,
    } });
    try {
      const normalized = await provider.normalize(input);
      const canonicalUrl = canonicalizeUrl(normalized.url);
      const contentFingerprint = fingerprint(normalized.title, normalized.content);
      const hashes = await hashRemoteImage(normalized.mediaUrl);
      let duplicate = await this.prisma.normalizedEvent.findFirst({ where: { OR: [{ contentFingerprint }, { canonicalUrl }] }, orderBy: { firstSeenAt: 'asc' } });
      if (!duplicate && hashes.mediaHash) duplicate = await this.prisma.normalizedEvent.findFirst({ where: { mediaHash: hashes.mediaHash }, orderBy: { firstSeenAt: 'asc' } });
      if (!duplicate && hashes.perceptualHash) {
        const mediaCandidates = await this.prisma.normalizedEvent.findMany({ where: { perceptualHash: { not: null } }, orderBy: { firstSeenAt: 'desc' }, take: 500 });
        duplicate = mediaCandidates.find((candidate) => candidate.perceptualHash && hammingDistance(hashes.perceptualHash!, candidate.perceptualHash) <= 8) ?? null;
      }
      const event = await this.prisma.normalizedEvent.create({ data: {
        rawEventId: raw.id, platform: normalized.platform, externalId: normalized.externalId,
        title: normalized.title, normalizedTitle: normalizeText(normalized.title), content: normalized.content,
        author: normalized.author, url: normalized.url, canonicalUrl, mediaUrl: normalized.mediaUrl,
        mediaHash: hashes.mediaHash, perceptualHash: hashes.perceptualHash,
        publishedAt: normalized.publishedAt, language: normalized.language, category: normalized.category,
        entities: normalized.entities, keywords: normalized.keywords, contentFingerprint,
        duplicateOfId: duplicate?.id, metadata: normalized.metadata as Prisma.InputJsonValue | undefined,
      } });
      await this.prisma.rawEvent.update({ where: { id: raw.id }, data: { status: duplicate ? EventStatus.DUPLICATE : EventStatus.NORMALIZED } });
      if (input.metrics) await this.recordMetric(event.id, input.metrics);
      const clustered = await this.clustering.assign(event, provider.name);
      return { status: duplicate ? 'duplicate' : 'normalized', clustered: Boolean(clustered.trendId) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.rawEvent.update({ where: { id: raw.id }, data: { status: EventStatus.FAILED, error: message } });
      this.logger.error(`Failed to normalize ${provider.name}:${input.externalId}: ${message}`);
      throw error;
    }
  }

  async recordMetric(eventId: string, metric: MetricInput): Promise<void> {
    const integer = (value: bigint | number | undefined): bigint | undefined => value === undefined ? undefined : BigInt(Math.max(0, Math.trunc(Number(value))));
    await this.prisma.eventMetric.create({ data: {
      eventId, observedAt: metric.observedAt ?? new Date(), views: integer(metric.views), likes: integer(metric.likes),
      comments: integer(metric.comments), shares: integer(metric.shares), reposts: integer(metric.reposts),
      quotes: integer(metric.quotes), redditScore: integer(metric.redditScore), redditComments: integer(metric.redditComments),
      mentionCount: integer(metric.mentionCount), raw: metric.raw as Prisma.InputJsonValue | undefined,
    } });
  }

  async reclassify(): Promise<{ eventsUpdated: number; trendsUpdated: number; trendsExpired: number }> {
    const events = await this.prisma.normalizedEvent.findMany({
      select: { id: true, title: true, content: true, category: true, metadata: true },
    });
    let eventsUpdated = 0;
    for (const event of events) {
      const metadata = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
        ? event.metadata as Record<string, unknown>
        : {};
      const query = typeof metadata.query === 'string' ? metadata.query : '';
      const fallback = event.category === Category.REDDIT_TRENDS ? Category.REDDIT_TRENDS : Category.GENERAL;
      const category = inferCategory(`${event.title} ${event.content ?? ''} ${query}`, fallback);
      if (category !== event.category) {
        await this.prisma.normalizedEvent.update({ where: { id: event.id }, data: { category } });
        eventsUpdated += 1;
      }
    }

    const trends = await this.prisma.trend.findMany({ include: { events: { include: { event: { select: { category: true, publishedAt: true } } } } } });
    let trendsUpdated = 0;
    let trendsExpired = 0;
    const staleBefore = Date.now() - 72 * 3_600_000;
    for (const trend of trends) {
      const counts = new Map<Category, number>();
      for (const { event } of trend.events) counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((left, right) => {
        if (left[0] === Category.GENERAL && right[0] !== Category.GENERAL) return 1;
        if (right[0] === Category.GENERAL && left[0] !== Category.GENERAL) return -1;
        return right[1] - left[1];
      });
      const category = ranked[0]?.[0] ?? trend.category;
      const latestPublishedAt = Math.max(0, ...trend.events.map(({ event }) => event.publishedAt.getTime()));
      const shouldExpire = latestPublishedAt > 0 && latestPublishedAt < staleBefore;
      if (category !== trend.category || (shouldExpire && trend.lifecycle !== 'EXPIRED')) {
        await this.prisma.trend.update({ where: { id: trend.id }, data: { category, lifecycle: shouldExpire ? 'EXPIRED' : undefined } });
        trendsUpdated += 1;
        if (shouldExpire && trend.lifecycle !== 'EXPIRED') trendsExpired += 1;
      }
    }
    return { eventsUpdated, trendsUpdated, trendsExpired };
  }
}
