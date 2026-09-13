import { Injectable } from '@nestjs/common';
import { TrendSource } from '../common/types/source';
import { GdeltSource } from './gdelt/gdelt.service';
import { GoogleNewsSource } from './google-news/google-news.service';
import { RedditSource } from './reddit/reddit.service';
import { TikTokCreativeCenterSource } from './tiktok/tiktok.service';
import { TikTokResearchSource } from './tiktok/tiktok-research.service';
import { XSource } from './x/x.service';

@Injectable()
export class SourceRegistry {
  readonly providers: TrendSource[];
  constructor(gdelt: GdeltSource, googleNews: GoogleNewsSource, reddit: RedditSource, tiktok: TikTokCreativeCenterSource, research: TikTokResearchSource, x: XSource) {
    this.providers = [gdelt, googleNews, reddit, tiktok, research, x];
  }
  get(name: string): TrendSource | undefined { return this.providers.find((provider) => provider.name === name); }
  enabled(): TrendSource[] { return this.providers.filter((provider) => provider.isEnabled()); }
}
