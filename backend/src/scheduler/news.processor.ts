import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ScoringService } from '../scoring/scoring.service';
import { SourcesService } from '../sources/sources.service';
import { EventsService } from '../events/events.service';
import { PipelineLogService } from '../pipeline/pipeline-log.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';

export const NEWS_QUEUE = 'news-intelligence';
export const TELEGRAM_QUEUE = 'telegram-publications';

@Processor(NEWS_QUEUE, { concurrency: 4 })
export class NewsProcessor extends WorkerHost {
  private readonly logger = new Logger(NewsProcessor.name);
  constructor(
    private readonly sources: SourcesService,
    private readonly scoring: ScoringService,
    private readonly events: EventsService,
    private readonly pipeline: PipelineLogService,
    private readonly config: ConfigService,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
  ) { super(); }

  async process(job: Job): Promise<unknown> {
    await this.pipeline.write({ stage: 'QUEUE', status: 'STARTED', message: `Started ${job.name} job`, context: { jobId: job.id, jobName: job.name } });
    try {
      let result: unknown;
      switch (job.name) {
        case 'collect': result = await this.sources.collect(String(job.data.source)); break;
        case 'score': {
          const results = await this.scoring.scoreActive();
          const continuous = this.config.get<string>('telegram.deliveryMode', 'hybrid') !== 'periodic';
          const threshold = this.config.get<number>('publicationThreshold', 55);
          if (continuous) {
            for (const score of results) {
              if (score.score >= threshold) {
                const alertJob = await this.telegramQueue.add('publish-breaking', { trendId: score.trendId }, {
                  jobId: `breaking-${score.trendId}`, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true, removeOnFail: 200,
                });
                await this.pipeline.write({ stage: 'QUEUE', status: 'QUEUED', trendId: score.trendId, message: 'Queued breaking candidate for LLM verification and Telegram delivery', context: { jobId: alertJob.id, queue: TELEGRAM_QUEUE, score: score.score, lifecycle: score.lifecycle, threshold } });
              }
            }
          }
          result = { scored: results.length };
          break;
        }
        case 'lifecycle': result = { expired: await this.scoring.expireStale() }; break;
        case 'reclassify': result = await this.events.reclassify(); break;
        default: throw new Error(`Unknown job: ${job.name}`);
      }
      await this.pipeline.write({ stage: 'QUEUE', status: 'COMPLETED', message: `Completed ${job.name} job`, context: { jobId: job.id, jobName: job.name } });
      return result;
    } catch (error) {
      await this.pipeline.write({ stage: 'QUEUE', status: 'FAILED', message: `${job.name} job failed`, context: { jobId: job.id, jobName: job.name, error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  failed(job: Job | undefined, error: Error): void { this.logger.error(`Job ${job?.name ?? 'unknown'} failed: ${error.message}`); }
}
