import { DEFAULT_DISCOVERY_QUERIES, DEFAULT_X_QUERIES } from '../common/constants/topics';

const csv = (value: string | undefined, fallback: string[]): string[] =>
  (value ? value.split(',') : fallback).map((item) => item.trim()).filter(Boolean);

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolean = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());

export default () => ({
  port: number(process.env.BACKEND_PORT, 4000),
  database: {
    connectRetries: number(process.env.DATABASE_CONNECT_RETRIES, 15),
    connectRetryMs: number(process.env.DATABASE_CONNECT_RETRY_MS, 2_000),
  },
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  adminApiKey: process.env.ADMIN_API_KEY ?? '',
  enabledSources: csv(process.env.ENABLED_SOURCES, ['gdelt', 'google-news']),
  scheduling: {
    enabled: boolean(process.env.SCHEDULE_JOBS, true),
    gdeltMs: number(process.env.GDELT_INTERVAL_MS, 900_000),
    googleNewsMs: number(process.env.GOOGLE_NEWS_INTERVAL_MS, 900_000),
    redditMs: number(process.env.REDDIT_INTERVAL_MS, 180_000),
    tiktokMs: number(process.env.TIKTOK_INTERVAL_MS, 900_000),
    xMs: number(process.env.X_INTERVAL_MS, 900_000),
    scoringMs: number(process.env.SCORING_INTERVAL_MS, 60_000),
    lifecycleMs: number(process.env.LIFECYCLE_INTERVAL_MS, 300_000),
    digestMs: number(process.env.DIGEST_INTERVAL_MS, 10_800_000),
    dailyRoundupCron: process.env.DAILY_ROUNDUP_CRON ?? '0 9 * * *',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: number(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  queries: {
    gdelt: csv(process.env.GDELT_QUERIES, DEFAULT_DISCOVERY_QUERIES),
    googleNews: csv(process.env.GOOGLE_NEWS_QUERIES, DEFAULT_DISCOVERY_QUERIES),
    redditSubreddits: csv(process.env.REDDIT_SUBREDDITS, ['OutOfTheLoop', 'news', 'worldnews', 'CryptoCurrency', 'memes', 'animals']),
    x: csv(process.env.X_QUERIES, DEFAULT_X_QUERIES),
  },
  collection: {
    googleNewsLookbackHours: number(process.env.GOOGLE_NEWS_LOOKBACK_HOURS, 48),
    x: {
      maxResults: Math.min(100, Math.max(10, Math.floor(number(process.env.X_MAX_RESULTS, 10)))),
      queriesPerRun: Math.max(1, Math.floor(number(process.env.X_QUERIES_PER_RUN, 1))),
      dailyPostBudget: Math.max(0, Math.floor(number(process.env.X_DAILY_POST_BUDGET, 200))),
    },
  },
  scoring: {
    weights: {
      velocity: number(process.env.WEIGHT_VELOCITY, 0.25),
      acceleration: number(process.env.WEIGHT_ACCELERATION, 0.20),
      engagement: number(process.env.WEIGHT_ENGAGEMENT, 0.15),
      crossPlatform: number(process.env.WEIGHT_CROSS_PLATFORM, 0.20),
      novelty: number(process.env.WEIGHT_NOVELTY, 0.10),
      sourceStrength: number(process.env.WEIGHT_SOURCE_STRENGTH, 0.10),
    },
    thresholds: {
      monitoring: number(process.env.THRESHOLD_MONITORING, 25),
      rising: number(process.env.THRESHOLD_RISING, 40),
      hot: number(process.env.THRESHOLD_HOT, 55),
      breakout: number(process.env.THRESHOLD_BREAKOUT, 75),
    },
    metricLookbackMinutes: number(process.env.METRIC_LOOKBACK_MINUTES, 60),
    expiryHours: number(process.env.TREND_EXPIRY_HOURS, 48),
  },
  clustering: {
    threshold: number(process.env.CLUSTER_SIMILARITY_THRESHOLD, 0.42),
    lookbackHours: number(process.env.TREND_LOOKBACK_HOURS, 72),
  },
  publicationThreshold: number(process.env.PUBLICATION_THRESHOLD, 55),
  publicationScoreDelta: number(process.env.PUBLICATION_SCORE_DELTA, 5),
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'https://ollama.com',
    apiKey: process.env.OLLAMA_API_KEY ?? '',
    model: process.env.OLLAMA_MODEL ?? 'gemma4:31b',
    timeoutMs: number(process.env.OLLAMA_TIMEOUT_MS, 90_000),
    minimumConfidence: Math.min(1, Math.max(0, number(process.env.OLLAMA_MIN_CONFIDENCE, 0.7))),
  },
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    parseMode: process.env.TELEGRAM_PARSE_MODE ?? 'HTML',
    maxImages: Math.min(10, Math.max(0, Math.floor(number(process.env.TELEGRAM_MAX_IMAGES, 3)))),
    deliveryMode: ['continuous', 'periodic', 'hybrid'].includes(process.env.TELEGRAM_DELIVERY_MODE ?? '')
      ? process.env.TELEGRAM_DELIVERY_MODE
      : 'hybrid',
  },
});
