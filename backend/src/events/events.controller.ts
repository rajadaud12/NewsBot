import { Controller, Get, Param, Query } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Controller('events')
export class EventsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('platform') platform?: string, @Query('take') take = '50') {
    return this.prisma.normalizedEvent.findMany({
      where: platform ? { platform } : undefined, orderBy: { lastSeenAt: 'desc' },
      take: Math.min(200, Math.max(1, Number(take) || 50)), include: { metrics: { orderBy: { observedAt: 'desc' }, take: 2 } },
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.prisma.normalizedEvent.findUnique({ where: { id }, include: { rawEvent: true, metrics: { orderBy: { observedAt: 'desc' } }, trendEvents: { include: { trend: true } } } });
  }
}
