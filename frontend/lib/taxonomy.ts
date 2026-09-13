export const CATEGORY_OPTIONS = [
  ['VIRAL_ANIMALS', 'Viral Animals'],
  ['ODD_NEWS', 'Odd News'],
  ['LOCAL_NEWS', 'Escaping Local News'],
  ['VIRAL_PEOPLE', 'Viral People & Internet Characters'],
  ['CRYPTO_PEOPLE', 'Crypto-Famous People'],
  ['TOKENIZED_COMPANIES', 'Tokenized-Stock Companies'],
  ['POLITICS', 'Politics, Gaffes & Memes'],
  ['MEMES', 'Meme Formats'],
  ['MEME_PHRASES', 'Meme Phrases'],
  ['TIKTOK_SOUNDS', 'TikTok Sounds'],
  ['BRAND_STUNTS', 'Brand Stunts'],
  ['MASCOTS', 'Mascots'],
  ['INTERNET_DRAMA', 'Internet Drama'],
  ['REDDIT_TRENDS', 'Reddit Leads'],
  ['BREAKING_NEWS', 'Breaking News'],
  ['GENERAL', 'Other / Unclassified'],
] as const;

export const LIFECYCLE_OPTIONS = ['NEW', 'MONITORING', 'RISING', 'HOT', 'BREAKOUT', 'DECLINING', 'EXPIRED'] as const;

export const TOPIC_GROUPS = [
  { title: 'Viral animals', description: 'Named pets, zoo animals, mascots and wildlife', categories: ['VIRAL_ANIMALS'] },
  { title: 'Odd & escaping-local news', description: 'Florida Man, bizarre local stories and stories spreading beyond one region', categories: ['ODD_NEWS', 'LOCAL_NEWS'] },
  { title: 'Viral people', description: 'Creators and new internet characters', categories: ['VIRAL_PEOPLE'] },
  { title: 'Crypto-famous people', description: 'Founders, KOLs, exchange executives and drama', categories: ['CRYPTO_PEOPLE'] },
  { title: 'Tokenized-stock companies', description: 'News and spikes for the maintained company watchlist', categories: ['TOKENIZED_COMPANIES'] },
  { title: 'Politics', description: 'Candidates, gaffes and political memes', categories: ['POLITICS'] },
  { title: 'Memes, phrases & sounds', description: 'Meme formats, catchphrases and TikTok sounds', categories: ['MEMES', 'MEME_PHRASES', 'TIKTOK_SOUNDS'] },
  { title: 'Brands, mascots & drama', description: 'Brand stunts, mascots, feuds and internet drama', categories: ['BRAND_STUNTS', 'MASCOTS', 'INTERNET_DRAMA'] },
] as const;
