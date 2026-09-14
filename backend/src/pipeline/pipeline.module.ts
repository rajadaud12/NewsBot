import { Global, Module } from '@nestjs/common';
import { PipelineLogService } from './pipeline-log.service';

@Global()
@Module({ providers: [PipelineLogService], exports: [PipelineLogService] })
export class PipelineModule {}
