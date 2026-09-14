import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AiModule } from '../ai/ai.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({ imports: [SchedulerModule, AiModule, TelegramModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
