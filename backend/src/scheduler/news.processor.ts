import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AlertsService } from '../alerts/alerts.service';
import { ScoringService } from '../scoring/scoring.service';
import { SourcesService } from '../sources/sources.service';
import { EventsService } from '../events/events.service';

export const NEWS_QUEUE = 'news-intelligence';

@Processor(NEWS_QUEUE, { concurrency: 4 })
export class NewsProcessor extends WorkerHost {
  private readonly logger = new Logger(NewsProcessor.name);
  constructor(private readonly sources: SourcesService, private readonly scoring: ScoringService, private readonly alerts: AlertsService, private readonly events: EventsService) { super(); }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'collect': return this.sources.collect(String(job.data.source));
      case 'score': {
        const results = await this.scoring.scoreActive();
        for (const result of results) if (result.lifecycle === 'BREAKOUT') await this.alerts.processBreaking(result.trendId);
        return { scored: results.length };
      }
      case 'lifecycle': return { expired: await this.scoring.expireStale() };
      case 'digest': return { included: await this.alerts.publishDigest() };
      case 'daily-roundup': return { included: await this.alerts.publishDailyRoundup() };
      case 'reclassify': return this.events.reclassify();
      default: throw new Error(`Unknown job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  failed(job: Job | undefined, error: Error): void { this.logger.error(`Job ${job?.name ?? 'unknown'} failed: ${error.message}`); }
}
