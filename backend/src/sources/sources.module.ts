import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AuthModule } from '../auth/auth.module';
import { GdeltSource } from './gdelt/gdelt.service';
import { GoogleNewsSource } from './google-news/google-news.service';
import { RedditSource } from './reddit/reddit.service';
import { TikTokCreativeCenterSource } from './tiktok/tiktok.service';
import { TikTokResearchSource } from './tiktok/tiktok-research.service';
import { XSource } from './x/x.service';
import { SourceRegistry } from './source.registry';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  imports: [EventsModule, AuthModule], controllers: [SourcesController],
  providers: [GdeltSource, GoogleNewsSource, RedditSource, TikTokCreativeCenterSource, TikTokResearchSource, XSource, SourceRegistry, SourcesService],
  exports: [SourceRegistry, SourcesService, RedditSource],
})
export class SourcesModule {}
