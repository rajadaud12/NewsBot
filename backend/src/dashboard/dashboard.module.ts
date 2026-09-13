import { Module } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AiModule } from '../ai/ai.module';

@Module({ imports: [SchedulerModule, AiModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
