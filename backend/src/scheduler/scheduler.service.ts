import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { SourceRegistry } from '../sources/source.registry';
import { NEWS_QUEUE, TELEGRAM_QUEUE } from './news.processor';
import { PipelineLogService } from '../pipeline/pipeline-log.service';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);
  constructor(
    @InjectQueue(NEWS_QUEUE) private readonly queue: Queue,
    @InjectQueue(TELEGRAM_QUEUE) private readonly telegramQueue: Queue,
    private readonly config: ConfigService,
    private readonly registry: SourceRegistry,
    private readonly pipeline: PipelineLogService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get<boolean>('scheduling.enabled', true)) return;
    const intervals: Record<string, number> = {
      gdelt: this.config.get<number>('scheduling.gdeltMs', 900_000),
      'google-news': this.config.get<number>('scheduling.googleNewsMs', 900_000),
      reddit: this.config.get<number>('scheduling.redditMs', 180_000),
      tiktok: this.config.get<number>('scheduling.tiktokMs', 900_000),
      x: this.config.get<number>('scheduling.xMs', 900_000),
    };
    for (const provider of this.registry.enabled()) {
      await this.queue.add('collect', { source: provider.name }, { jobId: `collect-${provider.name}`, repeat: { every: intervals[provider.name] ?? 900_000 }, attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 500 });
    }
    await this.queue.add('score', {}, { jobId: 'score-trends', repeat: { every: this.config.get<number>('scheduling.scoringMs', 60_000) }, attempts: 3, backoff: { type: 'exponential', delay: 3_000 }, removeOnComplete: 100 });
    await this.queue.add('lifecycle', {}, { jobId: 'trend-lifecycle', repeat: { every: this.config.get<number>('scheduling.lifecycleMs', 300_000) }, removeOnComplete: 100 });
    if (this.config.get<string>('telegram.deliveryMode', 'hybrid') !== 'continuous') {
      await this.telegramQueue.add('digest', {}, { jobId: 'topic-digest', repeat: { every: this.config.get<number>('scheduling.digestMs', 10_800_000) }, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100 });
      await this.telegramQueue.add('daily-roundup', {}, { jobId: 'daily-roundup', repeat: { pattern: this.config.get<string>('scheduling.dailyRoundupCron', '0 9 * * *') }, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100 });
    }
    this.logger.log(`Scheduled ${this.registry.enabled().length} collectors plus scoring, lifecycle, digest and roundup jobs`);
  }

  async run(name: string, data: Record<string, unknown> = {}): Promise<{ jobId?: string }> {
    const target = ['publish-breaking', 'digest', 'daily-roundup'].includes(name) ? this.telegramQueue : this.queue;
    const job = await target.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 3_000 } });
    await this.pipeline.write({ stage: 'QUEUE', status: 'QUEUED', message: `Queued ${name} job`, context: { jobId: job.id, jobName: name, queue: target.name } });
    return { jobId: job.id };
  }
  async stats() {
    const counts = async (queue: Queue) => {
      const [waiting, active, delayed, failed, completed] = await Promise.all(['waiting', 'active', 'delayed', 'failed', 'completed'].map((status) => queue.getJobCountByTypes(status as any)));
      return { waiting, active, delayed, failed, completed };
    };
    const [news, telegram] = await Promise.all([counts(this.queue), counts(this.telegramQueue)]);
    return { waiting: news.waiting + telegram.waiting, active: news.active + telegram.active, delayed: news.delayed + telegram.delayed, failed: news.failed + telegram.failed, completed: news.completed + telegram.completed, news, telegram, deliveryMode: this.config.get<string>('telegram.deliveryMode', 'hybrid') };
  }
}
