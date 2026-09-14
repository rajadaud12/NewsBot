import { Injectable } from '@nestjs/common';
import { Category, PublicationStatus, TrendLifecycle } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}
  async overview() {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [activeTrends, breakoutTrends, events24h, publications24h, topTrends, sourceHealth, groupedCategories] = await Promise.all([
      this.prisma.trend.count({ where: { lifecycle: { not: TrendLifecycle.EXPIRED } } }),
      this.prisma.trend.count({ where: { lifecycle: TrendLifecycle.BREAKOUT } }),
      this.prisma.normalizedEvent.count({ where: { firstSeenAt: { gte: since } } }),
      this.prisma.telegramPublication.count({ where: { status: PublicationStatus.SENT, telegramMessageId: { not: null }, publishedAt: { gte: since } } }),
      this.prisma.trend.findMany({ where: { lifecycle: { not: TrendLifecycle.EXPIRED } }, orderBy: { currentScore: 'desc' }, take: 10, include: { events: { include: { event: true } }, publications: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
      this.prisma.source.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.trend.groupBy({ by: ['category'], where: { lifecycle: { not: TrendLifecycle.EXPIRED } }, _count: { _all: true } }),
    ]);
    const categoryCounts = Object.fromEntries(Object.values(Category).map((category) => [category, groupedCategories.find((item) => item.category === category)?._count._all ?? 0]));
    return { counts: { activeTrends, breakoutTrends, events24h, publications24h }, topTrends, sourceHealth, categoryCounts };
  }
}
