import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AlertsModule } from '../alerts/alerts.module';
import { AuthModule } from '../auth/auth.module';
import { ScoringModule } from '../scoring/scoring.module';
import { SourcesModule } from '../sources/sources.module';
import { EventsModule } from '../events/events.module';
import { NewsProcessor, NEWS_QUEUE, TELEGRAM_QUEUE } from './news.processor';
import { TelegramProcessor } from './telegram.processor';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [BullModule.registerQueue({ name: NEWS_QUEUE }, { name: TELEGRAM_QUEUE }), SourcesModule, EventsModule, ScoringModule, AlertsModule, AuthModule],
  controllers: [SchedulerController], providers: [SchedulerService, NewsProcessor, TelegramProcessor], exports: [SchedulerService],
})
export class SchedulerModule {}
