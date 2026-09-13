import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { DashboardService } from './dashboard.service';
import { OllamaService } from '../ai/ollama.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService, private readonly prisma: PrismaService, private readonly scheduler: SchedulerService, private readonly config: ConfigService, private readonly ollama: OllamaService) {}
  @Get('dashboard') overview() { return this.dashboard.overview(); }
  @Get('health') async health() {
    const started = Date.now();
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', timestamp: new Date().toISOString(), database: 'ok', queue: await this.scheduler.stats(), ollama: await this.ollama.health(), latencyMs: Date.now() - started };
  }
  @Get('settings') settings() {
    return {
      enabledSources: this.config.get<string[]>('enabledSources'), scheduling: this.config.get('scheduling'),
      scoring: this.config.get('scoring'), clustering: this.config.get('clustering'),
      integrations: {
        ollama: { baseUrl: this.config.get('ollama.baseUrl'), model: this.config.get('ollama.model') },
        telegramConfigured: Boolean(this.config.get('telegram.token') && this.config.get('telegram.chatId')),
        xCostControls: this.config.get('collection.x'),
      },
    };
  }
  @Get('publications') publications() { return this.prisma.telegramPublication.findMany({ orderBy: { createdAt: 'desc' }, take: 200, include: { trend: true } }); }
}
