import { Category } from '@prisma/client';

export const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  VIRAL_ANIMALS: ['viral animal', 'viral animals', 'named animal', 'famous pet', 'zoo animal', 'animal', 'animals', 'pet', 'pets', 'dog', 'dogs', 'cat', 'cats', 'wildlife'],
  ODD_NEWS: ['odd news', 'weird news', 'bizarre', 'florida man', 'strange', 'unusual', 'mystery'],
  LOCAL_NEWS: ['local news', 'local story', 'town', 'county', 'community news'],
  VIRAL_PEOPLE: ['viral person', 'viral people', 'internet character', 'internet personality', 'creator', 'influencer', 'streamer'],
  CRYPTO_PEOPLE: ['crypto founder', 'crypto influencer', 'crypto kol', 'crypto ceo', 'exchange founder', 'exchange executive'],
  TOKENIZED_COMPANIES: ['tokenized stock', 'tokenized stocks', 'xstock', 'xstocks', 'tokenized equity'],
  POLITICS: ['political gaffe', 'political meme', 'politics', 'president', 'senator', 'parliament', 'election', 'minister', 'candidate', 'campaign'],
  MEMES: ['meme format', 'meme', 'memes', 'viral joke'],
  MEME_PHRASES: ['viral phrase', 'catchphrase', 'meme phrase', 'slang'],
  TIKTOK_SOUNDS: ['tiktok sound', 'tiktok sounds', 'viral sound', 'audio trend'],
  BRAND_STUNTS: ['brand stunt', 'brand stunts', 'campaign stunt', 'publicity stunt'],
  MASCOTS: ['brand mascot', 'mascot', 'mascots'],
  INTERNET_DRAMA: ['internet drama', 'online drama', 'controversy', 'feud', 'backlash'],
  REDDIT_TRENDS: ['reddit', 'subreddit', 'outoftheloop'],
  BREAKING_NEWS: ['breaking', 'developing', 'just in'],
  GENERAL: [],
};

export const DEFAULT_DISCOVERY_QUERIES = [
  'viral animal', 'named animal', 'Florida man', 'odd local news',
  'viral internet personality', 'internet character', 'crypto founder drama', 'crypto KOL',
  'exchange executive drama', 'tokenized stock', 'political gaffe', 'political meme',
  'meme format', 'viral phrase', 'TikTok sound', 'brand stunt', 'brand mascot', 'internet drama',
];

export const DEFAULT_X_QUERIES = [
  '(viral animal OR zoo mascot OR famous pet OR florida man OR bizarre local news) lang:en',
  '(viral creator OR internet personality OR crypto founder OR crypto KOL OR exchange executive) lang:en',
  '(political gaffe OR political meme OR meme format OR viral phrase OR tiktok sound) lang:en',
  '(brand stunt OR brand mascot OR internet drama OR tokenized stock) lang:en',
];
