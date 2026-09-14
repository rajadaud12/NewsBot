import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Severity, SourceType } from '@prisma/client';
import { CollectionResult } from '../common/types/source';
import { PrismaService } from '../database/prisma.service';
import { EventsService } from '../events/events.service';
import { SourceRegistry } from './source.registry';
import { PipelineLogService } from '../pipeline/pipeline-log.service';

@Injectable()
export class SourcesService {
  private readonly logger = new Logger(SourcesService.name);
  constructor(private readonly registry: SourceRegistry, private readonly events: EventsService, private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly pipeline: PipelineLogService) {}

  async initialize(): Promise<void> {
    for (const provider of this.registry.providers) {
      await this.prisma.source.upsert({
        where: { name: provider.name }, update: { type: provider.type as SourceType, enabled: provider.isEnabled() },
        create: { name: provider.name, type: provider.type as SourceType, enabled: provider.isEnabled() },
      });
    }
  }

  async collect(name: string): Promise<CollectionResult> {
    const provider = this.registry.get(name);
    if (!provider) throw new Error(`Unknown source: ${name}`);
    const result: CollectionResult = { source: name, fetched: 0, normalized: 0, duplicates: 0, clustered: 0, errors: 0 };
    const source = await this.prisma.source.upsert({
      where: { name }, update: { enabled: provider.isEnabled(), lastCollectedAt: new Date() },
      create: { name, type: provider.type as SourceType, enabled: provider.isEnabled(), lastCollectedAt: new Date() },
    });
    if (!provider.isEnabled()) {
      await this.pipeline.write({ stage: 'COLLECTION', status: 'SKIPPED', source: name, message: `${name} collection skipped because the source is disabled` });
      return result;
    }
    await this.pipeline.write({ stage: 'COLLECTION', status: 'STARTED', source: name, message: `Started collecting news from ${name}` });
    try {
      const events = await provider.collect();
      result.fetched = events.length;
      for (const event of events) {
        try {
          const ingested = await this.events.ingest(provider, event);
          if (ingested.status === 'normalized') result.normalized += 1;
          if (ingested.status === 'duplicate') result.duplicates += 1;
          if (ingested.clustered) result.clustered += 1;
        } catch { result.errors += 1; }
      }
      await this.prisma.source.update({ where: { id: source.id }, data: { lastSuccessAt: new Date(), lastError: null } });
      await this.log(Severity.INFO, 'collector', `Collected ${name}`, result as unknown as Prisma.InputJsonValue);
      await this.pipeline.write({ stage: 'COLLECTION', status: 'COMPLETED', source: name, message: `Completed ${name} collection`, context: { ...result } });
      this.logger.log(`${name}: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.source.update({ where: { id: source.id }, data: { lastErrorAt: new Date(), lastError: message } });
      await this.log(Severity.ERROR, 'collector', `${name} collection failed`, { error: message });
      await this.pipeline.write({ stage: 'COLLECTION', status: 'FAILED', source: name, message: `${name} collection failed`, context: { error: message } });
      await this.prisma.alert.create({ data: { type: 'SOURCE_FAILURE', severity: Severity.ERROR, title: `${name} collector failed`, message } });
      throw error;
    }
  }

  async collectAll(): Promise<CollectionResult[]> {
    return Promise.all(this.registry.enabled().map((provider) => this.collect(provider.name)));
  }

  async list() {
    const [sources, logs] = await Promise.all([
      this.prisma.source.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { rawEvents: true } } } }),
      this.prisma.systemLog.findMany({ where: { component: 'collector' }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    return sources.map((source) => {
      const provider = this.registry.get(source.name);
      const latest = logs.find((log) => log.message === `Collected ${source.name}` || log.message === `${source.name} collection failed`);
      return {
        ...source,
        enabled: provider?.isEnabled() ?? source.enabled,
        configurationIssue: this.configurationIssue(source.name),
        rawEventCount: source._count.rawEvents,
        lastResult: latest?.context,
      };
    });
  }

  private configurationIssue(name: string): string | undefined {
    const configured = this.config.get<string[]>('enabledSources', []);
    if (name === 'tiktok-research') return 'TikTok Research API is intentionally unavailable until approved access is configured.';
    if (!configured.includes(name)) return `Add ${name} to ENABLED_SOURCES to activate this collector.`;
    if (name === 'reddit' && !process.env.REDDIT_ACCESS_TOKEN && !(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET)) return 'Add Reddit OAuth credentials.';
    if (name === 'tiktok' && process.env.TIKTOK_COLLECTION_MODE === 'feed' && !process.env.TIKTOK_CREATIVE_CENTER_FEED_URL) return 'Feed mode requires an approved TikTok Creative Center JSON feed URL.';
    if (name === 'tiktok' && (process.env.TIKTOK_COLLECTION_MODE ?? 'browser') === 'browser' && !process.env.TIKTOK_BROWSER_EXECUTABLE_PATH && !process.env.TIKTOK_BROWSER_CHANNEL) return 'Browser mode requires Chrome; set TIKTOK_BROWSER_CHANNEL or TIKTOK_BROWSER_EXECUTABLE_PATH.';
    if (name === 'x' && !process.env.X_BEARER_TOKEN && !(process.env.X_API_KEY && process.env.X_API_SECRET)) return 'Add an X bearer token or API key and secret.';
    return undefined;
  }

  private async log(level: Severity, component: string, message: string, context?: Prisma.InputJsonValue): Promise<void> {
    await this.prisma.systemLog.create({ data: { level, component, message, context } });
  }
}
