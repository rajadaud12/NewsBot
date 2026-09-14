import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AlertsService } from '../alerts/alerts.service';
import { PipelineLogService } from '../pipeline/pipeline-log.service';
import { TELEGRAM_QUEUE } from './news.processor';

@Processor(TELEGRAM_QUEUE, { concurrency: 1, limiter: { max: 1, duration: 2500 } })
export class TelegramProcessor extends WorkerHost {
  private readonly logger = new Logger(TelegramProcessor.name);

  constructor(private readonly alerts: AlertsService, private readonly pipeline: PipelineLogService) { super(); }

  async process(job: Job): Promise<unknown> {
    const trendId = typeof job.data?.trendId === 'string' ? job.data.trendId : undefined;
    await this.pipeline.write({ stage: 'QUEUE', status: 'STARTED', trendId, message: `Started ${job.name} Telegram-queue job`, context: { jobId: job.id, queue: TELEGRAM_QUEUE } });
    try {
      let result: unknown;
      switch (job.name) {
        case 'publish-breaking': {
          const sent = await this.alerts.processBreaking(String(job.data.trendId));
          result = { sent };
          // When a message is sent to Telegram, brief pause so messages are dispatched sequentially one by one
          if (sent) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
          break;
        }
        case 'digest': result = { included: await this.alerts.publishDigest() }; break;
        case 'daily-roundup': result = { included: await this.alerts.publishDailyRoundup() }; break;
        default: throw new Error(`Unknown Telegram job: ${job.name}`);
      }
      await this.pipeline.write({ stage: 'QUEUE', status: 'COMPLETED', trendId, message: `Completed ${job.name} Telegram-queue job`, context: { jobId: job.id, queue: TELEGRAM_QUEUE, result } });
      return result;
    } catch (error) {
      await this.pipeline.write({ stage: 'QUEUE', status: 'FAILED', trendId, message: `${job.name} Telegram-queue job failed`, context: { jobId: job.id, queue: TELEGRAM_QUEUE, error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  failed(job: Job | undefined, error: Error): void { this.logger.error(`Telegram job ${job?.name ?? 'unknown'} failed: ${error.message}`); }
}
