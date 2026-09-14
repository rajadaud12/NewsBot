import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Trend } from '@prisma/client';
import { z } from 'zod';
import { fetchWithRetry } from '../common/utils/http';
import { PrismaService } from '../database/prisma.service';
import { PipelineLogService } from '../pipeline/pipeline-log.service';
import { publisherOf } from '../common/utils/text';

export const AnalysisSchema = z.object({
  headline: z.string().min(3).max(240),
  summary: z.string().min(10).max(1600),
  whyTrending: z.string().min(5).max(800),
  category: z.string().min(2).max(80),
  entities: z.array(z.string()).max(25),
  confidence: z.number().min(0).max(1),
  isNewsworthy: z.boolean(),
  isMeme: z.boolean(),
  isDrama: z.boolean(),
  isPolitical: z.boolean(),
  isCrypto: z.boolean(),
});
export type AIAnalysisResult = z.infer<typeof AnalysisSchema>;

export function parseOllamaJson(content: string): AIAnalysisResult {
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Ollama returned no JSON object');
  return AnalysisSchema.parse(JSON.parse(cleaned.slice(start, end + 1)));
}

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly pipeline: PipelineLogService) {}

  async analyzeTrend(trendId: string): Promise<AIAnalysisResult> {
    const trend = await this.prisma.trend.findUnique({
      where: { id: trendId },
      include: {
        events: { orderBy: { addedAt: 'desc' }, take: 12, include: { event: { include: { rawEvent: { include: { source: true } } } } } },
        scores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
        snapshots: { orderBy: { observedAt: 'desc' }, take: 1 },
        mentions: { orderBy: { observedAt: 'desc' }, take: 100 },
      },
    });
    if (!trend) throw new Error(`Trend ${trendId} not found`);
    const model = this.config.get<string>('ollama.model', 'gemma4:31b');
    try {
      await this.pipeline.write({ stage: 'LLM', status: 'STARTED', trendId, message: `Sending validated ${trend.lifecycle} trend to ${model}`, context: { model, lifecycle: trend.lifecycle, score: trend.currentScore, evidenceCount: trend.events.length } });
      const result = await this.generate(trend, model);
      await this.prisma.aIAnalysis.create({ data: { trendId, model, ...result, rawResponse: result as Prisma.InputJsonValue } });
      const isSocial = trend.events.some(({ event }) => event.platform === 'tiktok' || event.platform === 'x') || String(trend.category) === 'TIKTOK_SOUNDS' || String(trend.category) === 'MEMES';
      const approved = result.isNewsworthy || (isSocial && (result.isMeme || result.confidence >= 0.4));
      await this.pipeline.write({ stage: 'LLM', status: approved ? 'PASSED' : 'REJECTED', trendId, message: approved ? `LLM approved: ${result.headline}` : `LLM rejected trend as not newsworthy: ${result.headline}`, context: { model, confidence: result.confidence, category: result.category, isNewsworthy: result.isNewsworthy, isMeme: result.isMeme } });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.aIAnalysis.create({ data: {
        trendId, model, headline: trend.canonicalTitle, summary: '', whyTrending: '', category: String(trend.category),
        entities: [], confidence: 0, isNewsworthy: false, isMeme: false, isDrama: false, isPolitical: false, isCrypto: false, error: message,
      } });
      this.logger.error(`Ollama analysis failed for ${trendId}: ${message}`);
      await this.pipeline.write({ stage: 'LLM', status: 'FAILED', trendId, message: 'LLM analysis failed', context: { model, error: message } });
      throw error;
    }
  }

  async health(): Promise<{ status: 'ok' | 'error'; model: string; modelAvailable?: boolean; error?: string }> {
    const model = this.config.get<string>('ollama.model', 'gemma4:31b');
    try {
      const response = await fetchWithRetry(`${this.baseUrl()}/api/tags`, { headers: this.headers(), timeoutMs: 15_000, retries: 1 });
      const body = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      const names = (body.models ?? []).flatMap((item) => [item.name, item.model]).filter(Boolean) as string[];
      return { status: 'ok', model, modelAvailable: names.some((name) => name === model || name.replace(':cloud', '-cloud') === model) };
    } catch (error) {
      return { status: 'error', model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async generate(trend: Trend & { events: Array<{ event: any }>; scores: any[]; snapshots: any[]; mentions: any[] }, model: string): Promise<AIAnalysisResult> {
    const evidence = trend.events.map(({ event }, index) => ({
      sourceNumber: index + 1, title: event.title, content: event.content?.slice(0, 1000), author: event.author,
      publisher: publisherOf(event), collector: event.rawEvent?.source?.name, platform: event.platform,
      url: event.url, publishedAt: event.publishedAt, entities: event.entities,
    }));
    const latestScore = trend.scores[0];
    const latestSnapshot = trend.snapshots[0];
    const signalContext = {
      lifecycle: trend.lifecycle,
      lifecycleMeaning: { NEW: 'weak/early signal', MONITORING: 'worth watching', RISING: 'gaining momentum', HOT: 'strong trend for digest review', BREAKOUT: 'urgent alert candidate', DECLINING: 'losing momentum', EXPIRED: 'stale' }[trend.lifecycle],
      score: trend.currentScore,
      components: latestScore ? { velocity: latestScore.velocity, acceleration: latestScore.acceleration, engagement: latestScore.engagement, crossPlatformSpread: latestScore.crossPlatformSpread, novelty: latestScore.novelty, sourceStrength: latestScore.sourceStrength } : null,
      rates: latestSnapshot ? { mentionsPerMin: latestSnapshot.mentionsPerMin, likesPerMin: latestSnapshot.likesPerMin, commentsPerMin: latestSnapshot.commentsPerMin, repostsPerMin: latestSnapshot.repostsPerMin, growthRate: latestSnapshot.growthRate, platformCount: latestSnapshot.platformCount, metadata: latestSnapshot.metrics } : null,
    };
    const isTikTok = trend.events.some(({ event }) => event.platform === 'tiktok') || String(trend.category) === 'TIKTOK_SOUNDS';
    const isSocial = isTikTok || trend.events.some(({ event }) => event.platform === 'x') || String(trend.category) === 'MEMES';
    const socialGuidance = isSocial
      ? ' NOTE FOR SOCIAL & TIKTOK TRENDS: This candidate is a viral social or cultural phenomenon (TikTok hashtag, audio sound, or viral meme). While not traditional newspaper reporting, it is a real viral trend. Summarize what the trend or audio represents, how creators use it, and why it is surging. Set isMeme=true or isNewsworthy=true, and maintain confidence based on trend evidence.'
      : '';
    const prompt = `You are a careful news editor performing the final verification gate for a viral-news alert. Analyze only the supplied evidence. Distinguish independently corroborated facts from duplicated/syndicated claims and speculation. Never invent names, quotes, causal explanations, metrics, or events. If sources conflict, explicitly say so. The deterministic lifecycle and score describe trend strength only; they do not prove factual truth. Treat NEW, MONITORING, RISING, HOT, BREAKOUT, DECLINING, and EXPIRED as pipeline statuses and preserve that context in your reasoning. Set isNewsworthy=false when the evidence is vague, clickbait, promotional, stale, mismatched, or cannot support a concrete factual summary.${socialGuidance} Return only one JSON object with exactly these keys: headline, summary, whyTrending, category, entities, confidence (0-1), isNewsworthy, isMeme, isDrama, isPolitical, isCrypto. The summary must be 2-4 concise sentences with explicit attribution. The whyTrending field must describe the observed publisher, platform, or engagement signal without guessing motives.\n\nTrend signal context (do not alter):\n${JSON.stringify(signalContext)}\nEvidence:\n${JSON.stringify(evidence)}`;
    const response = await fetchWithRetry(`${this.baseUrl()}/api/chat`, {
      method: 'POST', timeoutMs: this.config.get<number>('ollama.timeoutMs', 90_000), retries: 2,
      headers: this.headers(),
      body: JSON.stringify({ model, stream: false, options: { temperature: 0.1 }, messages: [{ role: 'user', content: prompt }] }),
    });
    const body = await response.json() as any;
    return parseOllamaJson(String(body?.message?.content ?? body?.response ?? ''));
  }

  private baseUrl(): string {
    return this.config.get<string>('ollama.baseUrl', 'https://ollama.com')
      .replace(/\/$/, '')
      .replace(/\/api\/(?:chat|generate)$/, '')
      .replace(/\/api$/, '');
  }
  private headers(): Record<string, string> {
    const apiKey = this.config.get<string>('ollama.apiKey', '');
    return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }
}
