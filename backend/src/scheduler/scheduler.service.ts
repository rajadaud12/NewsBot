import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { SourceRegistry } from '../sources/source.registry';
import { NEWS_QUEUE } from './news.processor';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerService.name);
  constructor(@InjectQueue(NEWS_QUEUE) private readonly queue: Queue, private readonly config: ConfigService, private readonly registry: SourceRegistry) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get<boolean>('scheduling.enabled', true)) return;
    const intervals: Record<string, number> = {
      gdelt: this.config.get<number>('scheduling.gdeltMs', 900_000),
      'google-news': this.config.get<number>('scheduling.googleNewsMs', 900_000),
      reddit: this.config.get<number>('scheduling.redditMs', 180_000),
      tiktok: this.config.get<number>('scheduling.tiktokMs', 1_800_000),
      x: this.config.get<number>('scheduling.xMs', 900_000),
    };
    for (const provider of this.registry.enabled()) {
      await this.queue.add('collect', { source: provider.name }, { jobId: `collect-${provider.name}`, repeat: { every: intervals[provider.name] ?? 900_000 }, attempts: 4, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 500 });
    }
    await this.queue.add('score', {}, { jobId: 'score-trends', repeat: { every: this.config.get<number>('scheduling.scoringMs', 60_000) }, attempts: 3, backoff: { type: 'exponential', delay: 3_000 }, removeOnComplete: 100 });
    await this.queue.add('lifecycle', {}, { jobId: 'trend-lifecycle', repeat: { every: this.config.get<number>('scheduling.lifecycleMs', 300_000) }, removeOnComplete: 100 });
    await this.queue.add('digest', {}, { jobId: 'topic-digest', repeat: { every: this.config.get<number>('scheduling.digestMs', 10_800_000) }, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100 });
    await this.queue.add('daily-roundup', {}, { jobId: 'daily-roundup', repeat: { pattern: this.config.get<string>('scheduling.dailyRoundupCron', '0 9 * * *') }, attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100 });
    this.logger.log(`Scheduled ${this.registry.enabled().length} collectors plus scoring, lifecycle, digest and roundup jobs`);
  }

  async run(name: string, data: Record<string, unknown> = {}): Promise<{ jobId?: string }> {
    const job = await this.queue.add(name, data, { attempts: 3, backoff: { type: 'exponential', delay: 3_000 } });
    return { jobId: job.id };
  }
  async stats() {
    const [waiting, active, delayed, failed, completed] = await Promise.all(['waiting', 'active', 'delayed', 'failed', 'completed'].map((status) => this.queue.getJobCountByTypes(status as any)));
    return { waiting, active, delayed, failed, completed };
  }
}
