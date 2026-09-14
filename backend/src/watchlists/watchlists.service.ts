import { Injectable } from '@nestjs/common';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

const DEFAULTS: Array<{ name: string; description: string; category: Category; items: string[] }> = [
  { name: 'Named viral animals', description: 'Named pets, zoo animals, mascots and wildlife becoming internet characters', category: Category.VIRAL_ANIMALS, items: [
    'named viral animal', 'viral zoo baby', 'famous rescue animal', 'viral pet name', 'zoo animal celebrity', 'viral cat name',
    'viral dog name', 'aquarium animal viral', 'wildlife camera celebrity', 'escaped zoo animal', 'animal mascot viral', 'beloved local animal',
  ] },
  { name: 'Odd and escaping-local news', description: 'Florida Man, bizarre stories and local stories spreading beyond their origin', category: Category.ODD_NEWS, items: [
    'Florida man', 'bizarre police report', 'strange local news', 'unusual rescue story', 'small town mystery', 'odd court case',
    'unexpected local discovery', 'escaped animal local news', 'weird crime story', 'unusual public warning', 'local story goes viral',
    'bizarre government notice', 'strange traffic incident', 'unusual emergency call', 'odd human interest story',
  ] },
  { name: 'Viral internet personalities', description: 'Creators, viral people and emerging internet characters', category: Category.VIRAL_PEOPLE, items: [
    'breakout internet creator', 'viral TikTok creator', 'new internet personality', 'overnight viral person', 'viral street interview',
    'breakout streamer', 'viral podcast guest', 'unexpected internet celebrity', 'creator controversy', 'viral reaction creator',
    'new meme character', 'social media breakout star',
  ] },
  { name: 'Political figures', description: 'Candidates, gaffes and memes emerging from politics', category: Category.POLITICS, items: [
    'candidate gaffe', 'campaign meme', 'political clip goes viral', 'debate moment viral', 'politician hot mic', 'campaign stunt',
    'political catchphrase', 'election meme', 'parliament viral moment', 'rally clip viral', 'political impersonation meme', 'candidate internet backlash',
  ] },
  { name: 'Crypto personalities', description: 'Founders, KOLs, exchange executives and their drama', category: Category.CRYPTO_PEOPLE, items: [
    'Vitalik Buterin', 'Changpeng Zhao', 'CZ Binance', 'Brian Armstrong', 'Jesse Powell', 'Arthur Hayes', 'Justin Sun',
    'Michael Saylor', 'Anatoly Yakovenko', 'Charles Hoskinson', 'Cameron Winklevoss', 'Tyler Winklevoss', 'Balaji Srinivasan',
    'crypto founder drama', 'crypto KOL controversy', 'exchange executive news',
  ] },
  { name: 'Major companies', description: 'Companies likely to drive breaking or viral stories', category: Category.GENERAL, items: [
    'Apple viral news', 'Tesla viral news', 'Nvidia viral news', 'Microsoft viral news', 'Amazon viral news', 'Google viral news',
    'Meta viral news', 'OpenAI viral news', 'Coinbase viral news', 'Robinhood viral news', 'GameStop viral news', 'AMC viral news',
    'Netflix viral news', 'Disney viral news', 'Nike viral campaign', 'Wendy mascot', 'Duolingo mascot', 'Reddit viral news',
  ] },
  { name: 'Tokenized-stock companies', description: 'Companies commonly represented in supported tokenized-equity products; confirm against the operator portfolio', category: Category.TOKENIZED_COMPANIES, items: [
    'Apple tokenized stock', 'Tesla tokenized stock', 'Nvidia tokenized stock', 'Microsoft tokenized stock', 'Amazon tokenized stock',
    'Meta tokenized stock', 'Alphabet tokenized stock', 'Coinbase tokenized stock', 'Robinhood tokenized stock', 'GameStop tokenized stock',
    'MicroStrategy tokenized stock', 'AMD tokenized stock', 'Intel tokenized stock', 'Netflix tokenized stock', 'xStocks news',
  ] },
  { name: 'Meme formats, phrases and sounds', description: 'Meme formats, catchphrases and rising TikTok sounds', category: Category.MEMES, items: [
    'meme format', 'viral phrase', 'TikTok sound', 'breakout TikTok song', 'original sound trend', 'sped up sound trend', 'TikTok audio remix',
    'viral catchphrase', 'reaction image template', 'new meme template', 'dance sound challenge', 'lip sync sound trend',
    'TikTok sound video count', 'sound trend crosses platforms', 'viral slang phrase', 'CapCut template trend',
  ] },
  { name: 'Brand stunts, mascots and drama', description: 'Brand stunts, mascots, feuds, backlash and internet drama', category: Category.BRAND_STUNTS, items: [
    'brand stunt', 'brand mascot', 'internet drama', 'viral brand campaign', 'brand social media feud', 'mascot controversy',
    'rebrand backlash', 'corporate account goes viral', 'brand apology viral', 'fast food mascot', 'sports mascot viral',
    'brand meme campaign', 'publicity stunt backlash', 'unexpected brand collaboration', 'brand launch internet reaction',
  ] },
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
