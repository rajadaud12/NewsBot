import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export type PipelineStage =
  | 'QUEUE'
  | 'COLLECTION'
  | 'NORMALIZATION'
  | 'CLUSTERING'
  | 'SCORING'
  | 'VALIDATION'
  | 'LLM'
  | 'MEDIA'
  | 'TELEGRAM';

export type PipelineStatus = 'QUEUED' | 'STARTED' | 'PASSED' | 'REJECTED' | 'SKIPPED' | 'FAILED' | 'COMPLETED';

@Injectable()
export class PipelineLogService {
  private readonly logger = new Logger(PipelineLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async write(input: {
    stage: PipelineStage;
    status: PipelineStatus;
    message: string;
    level?: Severity;
    trendId?: string;
    eventId?: string;
    source?: string;
    publicationId?: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.systemLog.create({
        data: {
          level: input.level ?? (input.status === 'FAILED' ? Severity.ERROR : input.status === 'REJECTED' ? Severity.WARNING : Severity.INFO),
          component: 'pipeline',
          message: input.message,
          context: {
            stage: input.stage,
            status: input.status,
            ...(input.trendId ? { trendId: input.trendId } : {}),
            ...(input.eventId ? { eventId: input.eventId } : {}),
            ...(input.source ? { source: input.source } : {}),
            ...(input.publicationId ? { publicationId: input.publicationId } : {}),
            ...(input.context ?? {}),
          } as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.error(`Could not persist pipeline log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
