-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('GDELT', 'GOOGLE_NEWS', 'REDDIT', 'TIKTOK_CREATIVE_CENTER', 'TIKTOK_RESEARCH', 'X', 'RSS');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('COLLECTED', 'NORMALIZED', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "TrendLifecycle" AS ENUM ('NEW', 'MONITORING', 'RISING', 'HOT', 'BREAKOUT', 'DECLINING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('VIRAL_ANIMALS', 'ODD_NEWS', 'LOCAL_NEWS', 'VIRAL_PEOPLE', 'CRYPTO_PEOPLE', 'TOKENIZED_COMPANIES', 'POLITICS', 'MEMES', 'MEME_PHRASES', 'TIKTOK_SOUNDS', 'BRAND_STUNTS', 'MASCOTS', 'INTERNET_DRAMA', 'REDDIT_TRENDS', 'BREAKING_NEWS', 'GENERAL');

-- CreateEnum
CREATE TYPE "PublicationType" AS ENUM ('BREAKING', 'DIGEST', 'DAILY_ROUNDUP');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('BREAKOUT', 'SOURCE_FAILURE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configuration" JSONB,
    "lastCollectedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "Category",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "aliases" TEXT[],
    "metadata" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawEvent" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'COLLECTED',
    "error" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedEvent" (
    "id" TEXT NOT NULL,
    "rawEventId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "content" TEXT,
    "author" TEXT,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "mediaHash" TEXT,
    "perceptualHash" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "language" TEXT,
    "category" "Category" NOT NULL DEFAULT 'GENERAL',
    "entities" TEXT[],
    "keywords" TEXT[],
    "contentFingerprint" TEXT NOT NULL,
    "duplicateOfId" TEXT,
    "metadata" JSONB,

    CONSTRAINT "NormalizedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventMetric" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "reposts" BIGINT,
    "quotes" BIGINT,
    "redditScore" BIGINT,
    "redditComments" BIGINT,
    "mentionCount" BIGINT,
    "raw" JSONB,

    CONSTRAINT "EventMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trend" (
    "id" TEXT NOT NULL,
    "canonicalTitle" TEXT NOT NULL,
    "category" "Category" NOT NULL DEFAULT 'GENERAL',
    "lifecycle" "TrendLifecycle" NOT NULL DEFAULT 'NEW',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "peakScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currentScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPublishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendEvent" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendMention" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendScore" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "acceleration" DOUBLE PRECISION NOT NULL,
    "engagement" DOUBLE PRECISION NOT NULL,
    "crossPlatformSpread" DOUBLE PRECISION NOT NULL,
    "novelty" DOUBLE PRECISION NOT NULL,
    "sourceStrength" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendSnapshot" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "lifecycle" "TrendLifecycle" NOT NULL,
    "mentionsPerMin" DOUBLE PRECISION NOT NULL,
    "likesPerMin" DOUBLE PRECISION NOT NULL,
    "commentsPerMin" DOUBLE PRECISION NOT NULL,
    "repostsPerMin" DOUBLE PRECISION NOT NULL,
    "growthRate" DOUBLE PRECISION NOT NULL,
    "acceleration" DOUBLE PRECISION NOT NULL,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "platformCount" INTEGER NOT NULL,
    "metrics" JSONB,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "trendId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whyTrending" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "entities" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "isNewsworthy" BOOLEAN NOT NULL,
    "isMeme" BOOLEAN NOT NULL,
    "isDrama" BOOLEAN NOT NULL,
    "isPolitical" BOOLEAN NOT NULL,
    "isCrypto" BOOLEAN NOT NULL,
    "rawResponse" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramPublication" (
    "id" TEXT NOT NULL,
    "trendId" TEXT,
    "type" "PublicationType" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "telegramMessageId" TEXT,
    "content" TEXT NOT NULL,
    "scoreAtPublication" DOUBLE PRECISION,
    "lifecycleAtPublication" "TrendLifecycle",
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "trendId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "level" "Severity" NOT NULL DEFAULT 'INFO',
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_name_key" ON "Source"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Watchlist_name_key" ON "Watchlist"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_value_key" ON "WatchlistItem"("watchlistId", "value");

-- CreateIndex
CREATE INDEX "RawEvent_collectedAt_idx" ON "RawEvent"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawEvent_sourceId_externalId_key" ON "RawEvent"("sourceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedEvent_rawEventId_key" ON "NormalizedEvent"("rawEventId");

-- CreateIndex
CREATE INDEX "NormalizedEvent_contentFingerprint_idx" ON "NormalizedEvent"("contentFingerprint");

-- CreateIndex
CREATE INDEX "NormalizedEvent_canonicalUrl_idx" ON "NormalizedEvent"("canonicalUrl");

-- CreateIndex
CREATE INDEX "NormalizedEvent_publishedAt_idx" ON "NormalizedEvent"("publishedAt");

-- CreateIndex
CREATE INDEX "NormalizedEvent_mediaHash_idx" ON "NormalizedEvent"("mediaHash");

-- CreateIndex
CREATE INDEX "NormalizedEvent_perceptualHash_idx" ON "NormalizedEvent"("perceptualHash");

-- CreateIndex
CREATE INDEX "EventMetric_eventId_observedAt_idx" ON "EventMetric"("eventId", "observedAt");

-- CreateIndex
CREATE INDEX "Trend_lifecycle_currentScore_idx" ON "Trend"("lifecycle", "currentScore");

-- CreateIndex
CREATE INDEX "Trend_lastSeenAt_idx" ON "Trend"("lastSeenAt");

-- CreateIndex
CREATE INDEX "TrendEvent_eventId_idx" ON "TrendEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TrendEvent_trendId_eventId_key" ON "TrendEvent"("trendId", "eventId");

-- CreateIndex
CREATE INDEX "TrendMention_trendId_observedAt_idx" ON "TrendMention"("trendId", "observedAt");

-- CreateIndex
CREATE INDEX "TrendScore_trendId_calculatedAt_idx" ON "TrendScore"("trendId", "calculatedAt");

-- CreateIndex
CREATE INDEX "TrendSnapshot_trendId_observedAt_idx" ON "TrendSnapshot"("trendId", "observedAt");

-- CreateIndex
CREATE INDEX "AIAnalysis_trendId_createdAt_idx" ON "AIAnalysis"("trendId", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramPublication_trendId_type_createdAt_idx" ON "TelegramPublication"("trendId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_resolved_severity_createdAt_idx" ON "Alert"("resolved", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_component_createdAt_idx" ON "SystemLog"("component", "createdAt");

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawEvent" ADD CONSTRAINT "RawEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedEvent" ADD CONSTRAINT "NormalizedEvent_rawEventId_fkey" FOREIGN KEY ("rawEventId") REFERENCES "RawEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NormalizedEvent" ADD CONSTRAINT "NormalizedEvent_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "NormalizedEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventMetric" ADD CONSTRAINT "EventMetric_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NormalizedEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendEvent" ADD CONSTRAINT "TrendEvent_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendEvent" ADD CONSTRAINT "TrendEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "NormalizedEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendMention" ADD CONSTRAINT "TrendMention_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendScore" ADD CONSTRAINT "TrendScore_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramPublication" ADD CONSTRAINT "TelegramPublication_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_trendId_fkey" FOREIGN KEY ("trendId") REFERENCES "Trend"("id") ON DELETE SET NULL ON UPDATE CASCADE;
