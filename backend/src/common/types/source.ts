import { Category } from '@prisma/client';

export interface RawEventInput {
  externalId: string;
  title?: string;
  content?: string;
  author?: string;
  url?: string;
  mediaUrl?: string;
  publishedAt?: string | Date;
  language?: string;
  category?: Category;
  entities?: string[];
  keywords?: string[];
  metrics?: MetricInput;
  metadata?: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export interface NormalizedEventInput {
  platform: string;
  externalId: string;
  title: string;
  content?: string;
  author?: string;
  url: string;
  mediaUrl?: string;
  publishedAt: Date;
  language?: string;
  category: Category;
  entities: string[];
  keywords: string[];
  metadata?: Record<string, unknown>;
}

export interface MetricInput {
  externalId?: string;
  observedAt?: Date;
  views?: bigint | number;
  likes?: bigint | number;
  comments?: bigint | number;
  shares?: bigint | number;
  reposts?: bigint | number;
  quotes?: bigint | number;
  redditScore?: bigint | number;
  redditComments?: bigint | number;
  mentionCount?: bigint | number;
  raw?: Record<string, unknown>;
}

export interface TrendSource {
  readonly name: string;
  readonly type: string;
  isEnabled(): boolean;
  collect(): Promise<RawEventInput[]>;
  normalize(event: RawEventInput): Promise<NormalizedEventInput>;
}

export interface MetricsProvider {
  collectMetrics(eventIds: string[]): Promise<MetricInput[]>;
}

export interface CollectionResult {
  source: string;
  fetched: number;
  normalized: number;
  duplicates: number;
  clustered: number;
  errors: number;
}
