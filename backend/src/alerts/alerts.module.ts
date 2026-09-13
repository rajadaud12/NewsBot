import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AlertsService } from './alerts.service';

@Module({ imports: [AiModule, TelegramModule], providers: [AlertsService], exports: [AlertsService] })
export class AlertsModule {}
