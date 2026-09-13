import { Module } from '@nestjs/common';
import { ClusteringModule } from '../clustering/clustering.module';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({ imports: [ClusteringModule], controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
