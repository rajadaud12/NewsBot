import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { SourcesService } from './sources/sources.service';
import { WatchlistsService } from './watchlists/watchlists.service';

@Injectable()
export class AppBootstrap implements OnApplicationBootstrap {
  constructor(private readonly sources: SourcesService, private readonly watchlists: WatchlistsService) {}
  async onApplicationBootstrap(): Promise<void> { await this.sources.initialize(); await this.watchlists.seed(); }
}
