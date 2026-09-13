import { Controller, Get, Param, Query } from '@nestjs/common';
import { Category, TrendLifecycle } from '@prisma/client';
import { TrendsService } from './trends.service';

@Controller('trends')
export class TrendsController {
  constructor(private readonly trends: TrendsService) {}
  @Get() list(@Query('q') q?: string, @Query('category') category?: Category, @Query('platform') platform?: string, @Query('source') source?: string, @Query('lifecycle') lifecycle?: TrendLifecycle, @Query('minScore') minScore?: string, @Query('hours') hours?: string, @Query('take') take?: string) {
    const validCategory = category && Object.values(Category).includes(category) ? category : undefined;
    const validLifecycle = lifecycle && Object.values(TrendLifecycle).includes(lifecycle) ? lifecycle : undefined;
    return this.trends.list({ q, category: validCategory, platform, source, lifecycle: validLifecycle, minScore: minScore ? Number(minScore) : undefined, hours: hours ? Number(hours) : undefined, take: take ? Number(take) : undefined });
  }
  @Get(':id') detail(@Param('id') id: string) { return this.trends.detail(id); }
}
