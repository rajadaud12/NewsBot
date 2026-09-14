import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';
import { fetchWithRetry } from '../common/utils/http';
import { PrismaService } from '../database/prisma.service';
import { validateRemoteImage } from '../common/utils/media';
import { PipelineLogService } from '../pipeline/pipeline-log.service';

export const escapeHtml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly pipeline: PipelineLogService) {}
  isConfigured(): boolean { return Boolean(this.config.get<string>('telegram.token') && this.config.get<string>('telegram.chatId')); }

  async publish(input: { trendId?: string; type: PublicationType; content: string; score?: number; lifecycle?: TrendLifecycle; mediaUrls?: string[] }): Promise<void> {
    const publication = await this.prisma.telegramPublication.create({ data: {
      trendId: input.trendId, type: input.type, content: input.content, scoreAtPublication: input.score,
      lifecycleAtPublication: input.lifecycle, status: PublicationStatus.PENDING,
    } });
    await this.pipeline.write({ stage: 'TELEGRAM', status: 'STARTED', trendId: input.trendId, publicationId: publication.id, message: `Queued ${input.type} Telegram publication`, context: { type: input.type, contentLength: input.content.length } });
    if (!this.isConfigured()) {
      await this.prisma.telegramPublication.update({ where: { id: publication.id }, data: { status: PublicationStatus.FAILED, error: 'Telegram credentials are not configured' } });
      await this.pipeline.write({ stage: 'TELEGRAM', status: 'FAILED', trendId: input.trendId, publicationId: publication.id, message: 'Telegram delivery blocked because credentials are not configured' });
      throw new Error('Telegram credentials are not configured');
    }
    try {
      const chunks = this.split(input.content);
      let firstMessageId: string | undefined;
      const sentMediaUrls: string[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const id = await this.sendMessage(chunks[index]);
        firstMessageId ??= id;
      }
      const candidates = [...new Set(input.mediaUrls ?? [])].slice(0, this.config.get<number>('telegram.maxImages', 3));
      for (const mediaUrl of candidates) {
        await this.pipeline.write({ stage: 'MEDIA', status: 'STARTED', trendId: input.trendId, publicationId: publication.id, message: 'Validating a candidate image before Telegram delivery', context: { mediaUrl } });
        const image = await validateRemoteImage(mediaUrl);
        if (!image) {
          await this.pipeline.write({ stage: 'MEDIA', status: 'REJECTED', trendId: input.trendId, publicationId: publication.id, message: 'Skipped an invalid or unavailable image', context: { mediaUrl } });
          continue;
        }
        await this.pipeline.write({ stage: 'MEDIA', status: 'PASSED', trendId: input.trendId, publicationId: publication.id, message: `Validated ${image.width}×${image.height} image`, context: { ...image } });
        try {
          await this.sendPhoto(image.url);
          sentMediaUrls.push(image.url);
          await this.pipeline.write({ stage: 'MEDIA', status: 'COMPLETED', trendId: input.trendId, publicationId: publication.id, message: 'Image sent to Telegram', context: { mediaUrl } });
        } catch (error) {
          await this.pipeline.write({ stage: 'MEDIA', status: 'FAILED', trendId: input.trendId, publicationId: publication.id, message: 'Telegram rejected the image; text delivery was kept', context: { mediaUrl, error: error instanceof Error ? error.message : String(error) } });
        }
      }
      await this.prisma.$transaction([
        this.prisma.telegramPublication.update({ where: { id: publication.id }, data: { status: PublicationStatus.SENT, telegramMessageId: firstMessageId, mediaUrls: sentMediaUrls, attempts: { increment: 1 }, publishedAt: new Date() } }),
        ...(input.trendId ? [this.prisma.trend.update({ where: { id: input.trendId }, data: { lastPublishedAt: new Date() } })] : []),
      ]);
      await this.pipeline.write({ stage: 'TELEGRAM', status: 'COMPLETED', trendId: input.trendId, publicationId: publication.id, message: `Sent ${input.type} publication to Telegram`, context: { telegramMessageId: firstMessageId, imageCandidates: candidates.length, imagesSent: sentMediaUrls.length } });
      this.logger.log(`Published ${input.type}${input.trendId ? ` for ${input.trendId}` : ''}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.telegramPublication.update({ where: { id: publication.id }, data: { status: PublicationStatus.FAILED, attempts: { increment: 1 }, error: message } });
      await this.pipeline.write({ stage: 'TELEGRAM', status: 'FAILED', trendId: input.trendId, publicationId: publication.id, message: `Telegram delivery failed for ${input.type}`, context: { error: message } });
      throw error;
    }
  }

  async sendMessage(text: string): Promise<string> {
    const token = this.config.get<string>('telegram.token')!;
    const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', retries: 4, timeoutMs: 15_000, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.config.get<string>('telegram.chatId'), text, parse_mode: this.config.get<string>('telegram.parseMode', 'HTML'), disable_web_page_preview: true }),
    });
    const body = await response.json() as any;
    if (!body.ok) throw new Error(`Telegram error: ${body.description ?? 'unknown failure'}`);
    return String(body.result.message_id);
  }

  async health(): Promise<{ status: 'ok' | 'error' | 'not_configured'; botUsername?: string; chatId?: string; error?: string }> {
    if (!this.isConfigured()) return { status: 'not_configured' };
    try {
      const token = this.config.get<string>('telegram.token')!;
      const [botResponse, chatResponse] = await Promise.all([
        fetchWithRetry(`https://api.telegram.org/bot${token}/getMe`, { timeoutMs: 10_000, retries: 1 }),
        fetchWithRetry(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(this.config.get<string>('telegram.chatId')!)}`, { timeoutMs: 10_000, retries: 1 }),
      ]);
      const bot = await botResponse.json() as any;
      const chat = await chatResponse.json() as any;
      if (!bot.ok || !chat.ok) throw new Error(bot.description ?? chat.description ?? 'Telegram verification failed');
      return { status: 'ok', botUsername: bot.result?.username, chatId: String(chat.result?.id ?? '') };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async sendPhoto(photo: string): Promise<string> {
    const token = this.config.get<string>('telegram.token')!;
    const response = await fetchWithRetry(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: 'POST', retries: 1, timeoutMs: 20_000, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.config.get<string>('telegram.chatId'), photo }),
    });
    const body = await response.json() as any;
    if (!body.ok) throw new Error(`Telegram image error: ${body.description ?? 'unknown failure'}`);
    return String(body.result.message_id);
  }

  private split(content: string): string[] {
    if (content.length <= 3900) return [content];
    const chunks: string[] = [];
    let current = '';
    for (const paragraph of content.split('\n\n')) {
      if (current && current.length + paragraph.length + 2 > 3900) { chunks.push(current); current = ''; }
      if (paragraph.length > 3900) {
        if (current) chunks.push(current);
        for (let i = 0; i < paragraph.length; i += 3900) chunks.push(paragraph.slice(i, i + 3900));
      } else current += `${current ? '\n\n' : ''}${paragraph}`;
    }
    if (current) chunks.push(current);
    return chunks;
  }
}
