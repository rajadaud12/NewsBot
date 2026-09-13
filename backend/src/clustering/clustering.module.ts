import { Module } from '@nestjs/common';
import { ClusteringService } from './clustering.service';

@Module({ providers: [ClusteringService], exports: [ClusteringService] })
export class ClusteringModule {}
