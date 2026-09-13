import { Injectable } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const DEFAULTS: Array<{ name: string; description: string; category: Category; items: string[] }> = [
  { name: 'Named viral animals', description: 'Named pets, zoo animals, mascots and wildlife becoming internet characters', category: Category.VIRAL_ANIMALS, items: [] },
  { name: 'Odd and escaping-local news', description: 'Florida Man, bizarre stories and local stories spreading beyond their origin', category: Category.ODD_NEWS, items: ['Florida man'] },
  { name: 'Viral internet personalities', description: 'Creators, viral people and emerging internet characters', category: Category.VIRAL_PEOPLE, items: [] },
  { name: 'Political figures', description: 'Candidates, gaffes and memes emerging from politics', category: Category.POLITICS, items: [] },
  { name: 'Crypto personalities', description: 'Founders, KOLs, exchange executives and their drama', category: Category.CRYPTO_PEOPLE, items: [] },
  { name: 'Major companies', description: 'Companies likely to drive breaking or viral stories', category: Category.GENERAL, items: [] },
  { name: 'Tokenized-stock companies', description: 'Companies with supported tokenized equities', category: Category.TOKENIZED_COMPANIES, items: [] },
  { name: 'Meme formats, phrases and sounds', description: 'Meme formats, catchphrases and rising TikTok sounds', category: Category.MEMES, items: ['meme format', 'viral phrase', 'TikTok sound'] },
  { name: 'Brand stunts, mascots and drama', description: 'Brand stunts, mascots, feuds, backlash and internet drama', category: Category.BRAND_STUNTS, items: ['brand stunt', 'brand mascot', 'internet drama'] },
];

@Injectable()
export class WatchlistsService {
  constructor(private readonly prisma: PrismaService) {}
  async seed(): Promise<void> {
    for (const list of DEFAULTS) {
      const watchlist = await this.prisma.watchlist.upsert({
        where: { name: list.name }, update: { description: list.description, category: list.category },
        create: { name: list.name, description: list.description, category: list.category },
      });
      await this.prisma.watchlistItem.createMany({
        data: list.items.map((value) => ({ watchlistId: watchlist.id, value, aliases: [] })),
        skipDuplicates: true,
      });
    }
  }
  list() { return this.prisma.watchlist.findMany({ include: { items: { orderBy: { value: 'asc' } } }, orderBy: { name: 'asc' } }); }
  create(data: { name: string; description?: string; category?: Category }) { return this.prisma.watchlist.create({ data }); }
  addItem(watchlistId: string, data: { value: string; aliases?: string[]; metadata?: Prisma.InputJsonValue }) {
    return this.prisma.watchlistItem.create({ data: { watchlistId, value: data.value, aliases: data.aliases ?? [], metadata: data.metadata } });
  }
  removeItem(id: string) { return this.prisma.watchlistItem.delete({ where: { id } }); }
}
