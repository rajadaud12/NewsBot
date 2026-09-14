# Viral News Intelligence → Telegram

A production-oriented, free-first pipeline that collects internet/news signals, preserves time-series observations, clusters related events, scores trend momentum deterministically, asks Ollama Cloud to write evidence-bound summaries, and publishes only meaningful transitions to Telegram.

Phase 4 sources (Wikipedia pageviews, Google Trends, 4chan, Polymarket, YouTube trending, DexScreener, and pump.fun) are intentionally not implemented.

## What is implemented

- Real GDELT DOC API and Google News RSS collectors (no credentials required).
- Reddit OAuth collector for `/r/all/rising`, `/r/all/new`, configured subreddit `rising`/`new`, top comments, and immutable score/comment observations.
- Conservative TikTok Creative Center collection for public hashtag, sound, and creator pages, plus an approved JSON feed/provider adapter.
- Optional X recent-search provider, fully disabled when no bearer token or queries are configured.
- Rate-compliant GDELT query batching (one in-flight request at a time) with provider errors surfaced instead of silently recorded as empty successes.
- Exact SHA-256 and perceptual dHash media duplicate detection.
- Deterministic token/entity/keyword/fuzzy/domain clustering with an embedding-ready boundary.
- Immutable event metrics, velocity, acceleration, growth, engagement, cross-platform spread, novelty, source-strength scoring, and lifecycle transitions.
- Evidence-only Ollama structured analysis with schema validation and failure logging.
- Telegram retry/rate-limit handling, HTML escaping, publication logs, breakout anti-spam gates, 3-hour digests, and daily roundups.
- NestJS health/API endpoints, BullMQ schedules, PostgreSQL/Prisma persistence, and a Next.js/Tailwind operations dashboard.

## Requirements

- Node.js 20+
- Docker Desktop with Docker Compose
- An Ollama Cloud account and API key
- A Telegram bot and destination channel/chat for publishing

## Installation

```bash
cp .env.example .env
npm install
npm run setup
```

`npm run setup` starts Docker Desktop on macOS when needed, waits for PostgreSQL and Redis to become healthy, generates Prisma Client, and applies committed migrations.

## Ollama Cloud setup

Create an API key at `https://ollama.com/settings/keys`, then configure direct cloud access:

```env
OLLAMA_BASE_URL=https://ollama.com
OLLAMA_API_KEY=your_key
OLLAMA_MODEL=gemma4:31b
OLLAMA_MIN_CONFIDENCE=0.70
```

The direct Ollama Cloud API uses `gemma4:31b`. The `gemma4:31b-cloud` spelling is used when routing through a local Ollama installation instead.

## Telegram setup

1. Create a bot with BotFather.
2. Add the bot to the target channel as an administrator, or start a private chat with it.
3. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `.env`.
4. Optionally set `TELEGRAM_MAX_IMAGES` (default `3`). Candidate images are fetched, decoded, size-checked, and sent only when valid.
5. Set `TELEGRAM_DELIVERY_MODE=hybrid` for immediate breakout alerts plus periodic digest/roundup delivery. Use `continuous` for breakout alerts only or `periodic` for digest/roundup delivery only.

Only candidates that pass deterministic evidence validation and have at least one reachable public evidence link are sent to Ollama. Telegram delivery additionally requires the LLM to mark the item newsworthy with at least `OLLAMA_MIN_CONFIDENCE`. Every collection, normalization, clustering, scoring, link check, validation, LLM, media, and Telegram transition is stored in `SystemLog` and displayed in the frontend under **Live Pipeline**.

No Telegram message is sent when there is nothing useful to report. Breakouts require a score of at least 80, strong velocity or acceleration, independently worded evidence, and multiple publisher/collector/platform signals. Repeat alerts require a meaningful score/state transition. Missing engagement telemetry is excluded from score normalization, while sparse single-item evidence receives a confidence penalty. Telegram jobs run on the dedicated `telegram-publications` BullMQ queue with retries and exponential backoff.

## Run

Start everything together:

```bash
npm run dev:all
```

Or use separate terminals:

```bash
npm run start:dev
```

```bash
npm run worker
```

```bash
npm run dev
```

The API is at `http://localhost:4000/api`, health is at `http://localhost:4000/api/health`, and the dashboard is at `http://localhost:3000/dashboard`. Exact Telegram message previews and delivery statuses are at `http://localhost:3000/publications`.

The API process and worker both contain BullMQ consumers so either process can safely execute jobs. For a dedicated production worker, run the built `worker:start` script and set `SCHEDULE_JOBS=false` on API replicas that should not register schedules.

## Database and Prisma

PostgreSQL and Redis run from `infra/docker-compose.yml` (the root Compose file includes it). The default local connection is already represented in `.env.example`.

Run Prisma commands from the repository root so the root `.env` is loaded:

```bash
node scripts/prisma.mjs studio
npm run prisma:migrate
```

Metric observations are append-only. Recollection updates `lastSeenAt` but never overwrites historical `EventMetric` or `TrendSnapshot` rows.

## Configuration

Copy `.env.example`; it documents every runtime setting. Key groups:

- `ENABLED_SOURCES` and per-source collection intervals.
- Query lists: `GDELT_QUERIES`, `GOOGLE_NEWS_QUERIES`, `REDDIT_SUBREDDITS`, `X_QUERIES`.
- Six scoring weights and four lifecycle/publication thresholds.
- Ollama endpoint/model and Telegram credentials.
- `ADMIN_API_KEY`, which protects manual job and watchlist/source mutations when set.

Missing provider credentials disable only that provider. GDELT and Google News work without credentials. Reddit requires a client ID/secret (or supplied access token); X requires a bearer token and non-empty query list. TikTok Research remains an explicitly disabled provider boundary until approved credentials are available.

### TikTok Creative Center

TikTok does not publish a supported public-content ingestion API for Creative Center. Browser mode therefore reads only the public, visible trend pages using an ordinary headless Chrome session. It does not rotate proxies, spoof browser fingerprints, solve challenges, or call private endpoints. The collector makes the hashtag, sound, and creator requests sequentially, waits at least one hour between runs (plus jitter), and enters a six-hour circuit-breaker after a 403/429. This protects the host IP by stopping when TikTok declines automated access rather than attempting to bypass it.

```env
ENABLED_SOURCES=gdelt,google-news,tiktok
TIKTOK_COLLECTION_MODE=browser
TIKTOK_CREATIVE_CENTER_URL=https://ads.tiktok.com/business/creativecenter
TIKTOK_BROWSER_CHANNEL=chrome
TIKTOK_REGION=US
TIKTOK_PERIOD_DAYS=7
TIKTOK_MIN_INTERVAL_MS=3600000
TIKTOK_JITTER_MS=600000
TIKTOK_BLOCK_BACKOFF_MS=21600000
```

If public browser access is restricted on the deployment IP, use an approved Creative Center export or provider (for example, an operator-owned Apify dataset export) and set `TIKTOK_CREATIVE_CENTER_FEED_URL` to its JSON URL. The feed can contain `items` or `data.items`; each item may identify a `hashtag`, `soundName`, or `creatorName` and include `views`, `videoCount`, `rank`, `topCreators`, and source URLs. When the same item is observed again, the pipeline stores another immutable metric point and derives views/hour and videos/hour. Never put a provider token directly into a URL committed to source control.

The default queries cover named viral animals, odd/escaping-local news, internet characters, crypto personalities, tokenized-stock companies, politics/gaffes, memes/phrases/TikTok sounds, and brand stunts/mascots/drama. Google News adds a `when:` constraint and rejects results older than `GOOGLE_NEWS_LOOKBACK_HOURS` (48 by default).

For X, create or regenerate the app Bearer Token in the X Developer Console and set `X_BEARER_TOKEN`. `X_API_KEY` and `X_API_SECRET` are only an app-auth fallback. The Sources page displays the actual HTTP authentication/plan error without exposing any secret.

Environment values are loaded when the backend starts. Restart the backend after replacing any provider credential; a successful collection automatically clears the source's stored error.

### X credit controls

X collection is deliberately budgeted because X bills successful reads per Post. The defaults reduce the previous maximum from four queries × 50 Posts to one rotating query × 10 Posts per cycle, remember a durable `since_id` cursor for every query, and stop making requests when the UTC-day cap is reached:

```env
X_INTERVAL_MS=900000
X_MAX_RESULTS=10
X_QUERIES_PER_RUN=1
X_DAILY_POST_BUDGET=200
```

At a 15-minute interval, each of the four topic queries runs once per hour. Set `X_DAILY_POST_BUDGET=50` for a stricter cap, or remove `x` from `ENABLED_SOURCES` to spend zero X credits. Restart the backend after changing these values. The Sources and Settings pages display the active controls and current daily count.

To force a source run or repair categories after changing classification rules:

```bash
curl -X POST http://localhost:4000/api/sources/gdelt/collect
curl -X POST http://localhost:4000/api/sources/tiktok/collect
curl -X POST http://localhost:4000/api/sources/x/collect
curl -X POST http://localhost:4000/api/jobs/reclassify
```

If `ADMIN_API_KEY` is configured, add `-H "X-Admin-Api-Key: your_admin_key"` to those requests.

## Watchlists

Initial database-backed watchlist groups are seeded on startup with more than one hundred focused tags. Google News interleaves categories and rotates through the larger list under a bounded per-run query budget, so adding coverage does not create an unbounded request burst. Manage them through:

- `GET /api/watchlists`
- `POST /api/watchlists`
- `POST /api/watchlists/:id/items`
- `DELETE /api/watchlists/items/:id`

When `ADMIN_API_KEY` is set, send it as `X-Admin-Api-Key` for mutations. Query feeds can also be bootstrapped through their comma-separated environment variables.

## Adding a source

1. Implement `TrendSource` from `backend/src/common/types/source.ts`.
2. Implement `MetricsProvider` too if the platform exposes time-series counters.
3. Register the provider in `SourcesModule` and `SourceRegistry`.
4. Add its interval to `SchedulerService` and its name to `ENABLED_SOURCES`.

Collectors return real raw payloads, normalize them behind a common boundary, and fail independently. Do not return mock production data.

## Tests

```bash
npm test
```

The database integration test is opt-in so unit tests do not destroy a development database:

```bash
TEST_DATABASE_URL=postgresql://newsbot:newsbot@localhost:5432/newsbot_test?schema=public npm run test:integration -w backend
```

## Production notes

- Put PostgreSQL/Redis credentials and API secrets in a secret manager, not source control.
- Set a strong `ADMIN_API_KEY`, restrict dashboard/API ingress, and run API/worker replicas separately.
- Use `npm run build` and `npm run worker:start -w backend` for built workers.
- Configure database backups and BullMQ monitoring before unattended operation.
- Telegram, Reddit, TikTok, and X require external account/API approval; the application cannot provision those credentials automatically.
