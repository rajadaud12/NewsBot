import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Trend } from '@prisma/client';
import { z } from 'zod';
import { fetchWithRetry } from '../common/utils/http';
import { PrismaService } from '../database/prisma.service';

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
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async analyzeTrend(trendId: string): Promise<AIAnalysisResult> {
    const trend = await this.prisma.trend.findUnique({
      where: { id: trendId },
      include: { events: { orderBy: { addedAt: 'desc' }, take: 12, include: { event: true } }, scores: { orderBy: { calculatedAt: 'desc' }, take: 1 } },
    });
    if (!trend) throw new Error(`Trend ${trendId} not found`);
    const model = this.config.get<string>('ollama.model', 'gemma4:31b');
    try {
      const result = await this.generate(trend, model);
      await this.prisma.aIAnalysis.create({ data: { trendId, model, ...result, rawResponse: result as Prisma.InputJsonValue } });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.aIAnalysis.create({ data: {
        trendId, model, headline: trend.canonicalTitle, summary: '', whyTrending: '', category: String(trend.category),
        entities: [], confidence: 0, isNewsworthy: false, isMeme: false, isDrama: false, isPolitical: false, isCrypto: false, error: message,
      } });
      this.logger.error(`Ollama analysis failed for ${trendId}: ${message}`);
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

  private async generate(trend: Trend & { events: Array<{ event: any }>; scores: any[] }, model: string): Promise<AIAnalysisResult> {
    const evidence = trend.events.map(({ event }, index) => ({
      sourceNumber: index + 1, title: event.title, content: event.content?.slice(0, 1000), author: event.author,
      platform: event.platform, url: event.url, publishedAt: event.publishedAt, entities: event.entities,
    }));
    const prompt = `You are a careful news editor. Analyze only the evidence below. Distinguish confirmed facts from claims or speculation. Never invent names, quotes, causal explanations, metrics, or events. If sources conflict, say so. Return only one JSON object with exactly these keys: headline, summary, whyTrending, category, entities, confidence (0-1), isNewsworthy, isMeme, isDrama, isPolitical, isCrypto. The summary must be 2-4 concise sentences and attribution should be explicit. The whyTrending field must explain the observed cross-source or engagement signal, not guess motives.\n\nDeterministic score (do not alter): ${trend.currentScore}\nEvidence:\n${JSON.stringify(evidence)}`;
    const response = await fetchWithRetry(`${this.baseUrl()}/api/chat`, {
      method: 'POST', timeoutMs: this.config.get<number>('ollama.timeoutMs', 90_000), retries: 2,
      headers: this.headers(),
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.1 }, messages: [{ role: 'user', content: prompt }] }),
    });
    const body = await response.json() as any;
    return parseOllamaJson(String(body?.message?.content ?? body?.response ?? ''));
  }

  private baseUrl(): string { return this.config.get<string>('ollama.baseUrl', 'https://ollama.com').replace(/\/$/, ''); }
  private headers(): Record<string, string> {
    const apiKey = this.config.get<string>('ollama.apiKey', '');
    return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
  }
}
