import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SourcesModule } from './sources/sources.module';
import { EventsModule } from './events/events.module';
import { TrendsModule } from './trends/trends.module';
import { ScoringModule } from './scoring/scoring.module';
import { AiModule } from './ai/ai.module';
import { TelegramModule } from './telegram/telegram.module';
import { AlertsModule } from './alerts/alerts.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WatchlistsModule } from './watchlists/watchlists.module';
import { AppBootstrap } from './app.bootstrap';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], envFilePath: ['../.env', '.env'] }),
    BullModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ connection: {
      host: config.get<string>('redis.host', 'localhost'), port: config.get<number>('redis.port', 6379),
      password: config.get<string>('redis.password') || undefined,
    } }) }),
    DatabaseModule, AuthModule, UsersModule, SourcesModule, EventsModule, TrendsModule, ScoringModule,
    AiModule, TelegramModule, AlertsModule, WatchlistsModule, SchedulerModule, DashboardModule,
  ],
  providers: [AppBootstrap],
})
export class AppModule {}
