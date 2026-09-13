import { Injectable } from '@nestjs/common';
import { Category, TrendLifecycle } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class TrendsService {
  constructor(private readonly prisma: PrismaService) {}
  list(filters: { q?: string; category?: Category; platform?: string; source?: string; lifecycle?: TrendLifecycle; minScore?: number; hours?: number; take?: number }) {
    const eventFilter = filters.platform || filters.source ? { some: { event: {
      platform: filters.platform,
      rawEvent: filters.source ? { source: { name: filters.source } } : undefined,
    } } } : undefined;
    return this.prisma.trend.findMany({
      where: {
        category: filters.category, lifecycle: filters.lifecycle ?? { not: TrendLifecycle.EXPIRED }, currentScore: filters.minScore !== undefined ? { gte: filters.minScore } : undefined,
        lastSeenAt: filters.hours ? { gte: new Date(Date.now() - filters.hours * 3_600_000) } : undefined, events: eventFilter,
        OR: filters.q ? [
          { canonicalTitle: { contains: filters.q, mode: 'insensitive' } },
          { events: { some: { event: { title: { contains: filters.q, mode: 'insensitive' } } } } },
        ] : undefined,
      },
      orderBy: [{ currentScore: 'desc' }, { lastSeenAt: 'desc' }], take: Math.min(200, filters.take ?? 100),
      include: { events: { include: { event: { include: { rawEvent: { include: { source: true } } } } } }, scores: { orderBy: { calculatedAt: 'desc' }, take: 1 }, publications: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }
  detail(id: string) {
    return this.prisma.trend.findUnique({
      where: { id }, include: {
        events: { orderBy: { addedAt: 'desc' }, include: { event: { include: { metrics: { orderBy: { observedAt: 'asc' } } } } } },
        scores: { orderBy: { calculatedAt: 'asc' } }, snapshots: { orderBy: { observedAt: 'asc' } },
        analyses: { orderBy: { createdAt: 'desc' } }, publications: { orderBy: { createdAt: 'desc' } }, alerts: { orderBy: { createdAt: 'desc' } },
      },
    });
  }
}
