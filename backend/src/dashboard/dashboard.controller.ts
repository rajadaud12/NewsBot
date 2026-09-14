import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { DashboardService } from './dashboard.service';
import { OllamaService } from '../ai/ollama.service';
import { TelegramService } from '../telegram/telegram.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly prisma: PrismaService, private readonly scheduler: SchedulerService, private readonly config: ConfigService, private readonly ollama: OllamaService, private readonly telegram: TelegramService) {}
  @Get('dashboard') overview() { return this.dashboard.overview(); }
  @Get('health') async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    const [queue, ollama, telegram] = await Promise.all([this.scheduler.stats(), this.ollama.health(), this.telegram.health()]);
    return { status: 'ok', timestamp: new Date().toISOString(), database: 'ok', queue, ollama, telegram, latencyMs: Date.now() - started };
  }
  @Get('settings') settings() {
    return {
      enabledSources: this.config.get<string[]>('enabledSources'), scheduling: this.config.get('scheduling'),
      scoring: this.config.get('scoring'), clustering: this.config.get('clustering'),
      integrations: {
        ollama: { baseUrl: this.config.get('ollama.baseUrl'), model: this.config.get('ollama.model'), minimumConfidence: this.config.get('ollama.minimumConfidence') },
        telegram: { configured: Boolean(this.config.get('telegram.token') && this.config.get('telegram.chatId')), maxImages: this.config.get('telegram.maxImages'), deliveryMode: this.config.get('telegram.deliveryMode') },
        telegramConfigured: Boolean(this.config.get('telegram.token') && this.config.get('telegram.chatId')),
        xCostControls: this.config.get('collection.x'),
      },
    };
  }
  @Get('publications') publications() { return this.prisma.telegramPublication.findMany({ where: { content: { not: 'Included in digest' } }, orderBy: { createdAt: 'desc' }, take: 200, include: { trend: true } }); }
  @Get('activity') async activity(@Query('stage') stage?: string, @Query('status') status?: string, @Query('trendId') trendId?: string, @Query('take') takeValue?: string) {
    const take = Math.min(500, Math.max(1, Number.parseInt(takeValue ?? '200', 10) || 200));
    const logs = await this.prisma.systemLog.findMany({ where: { component: 'pipeline' }, orderBy: { createdAt: 'desc' }, take: 1_000 });
    const filtered = logs.filter((log) => {
      const context = log.context && typeof log.context === 'object' && !Array.isArray(log.context) ? log.context as Record<string, unknown> : {};
      return (!stage || context.stage === stage) && (!status || context.status === status) && (!trendId || context.trendId === trendId);
    });
    return { items: filtered.slice(0, take), total: filtered.length };
  }
}
