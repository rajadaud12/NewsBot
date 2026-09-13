import { Module } from '@nestjs/common';
import { WatchlistsController } from './watchlists.controller';
import { WatchlistsService } from './watchlists.service';
import { AuthModule } from '../auth/auth.module';

@Module({ imports: [AuthModule], controllers: [WatchlistsController], providers: [WatchlistsService], exports: [WatchlistsService] })
export class WatchlistsModule {}
