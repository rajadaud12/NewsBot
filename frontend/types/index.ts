export interface CollectionResult { fetched?: number; normalized?: number; duplicates?: number; clustered?: number; errors?: number }
export interface XOptimizationState { dailyPostsRead: number; dailyPostBudget: number; maxResults: number; queriesPerRun: number; lastFetched: number; lastRunAt: string; lastSkippedReason?: string | null }
export interface Source { id: string; name: string; type: string; enabled: boolean; lastCollectedAt?: string; lastSuccessAt?: string; lastError?: string; configurationIssue?: string; rawEventCount?: number; lastResult?: CollectionResult; configuration?: { xOptimization?: XOptimizationState } }
export interface Event { id: string; platform: string; title: string; url: string; author?: string; publishedAt: string; category: string; rawEvent?: { source?: { name: string } } }
export interface Publication { id: string; type: string; status: string; createdAt: string; publishedAt?: string; content: string; scoreAtPublication?: number; trend?: { id: string; canonicalTitle: string } }
export interface Trend {
  id: string; canonicalTitle: string; category: string; lifecycle: string; firstSeenAt: string; lastSeenAt: string;
  currentScore: number; peakScore: number; events: Array<{ event: Event; similarity?: number }>;
  publications?: Publication[]; scores?: Array<Record<string, number | string>>; snapshots?: Array<Record<string, number | string>>;
  analyses?: Array<Record<string, unknown>>;
}
export interface DashboardData { counts: { activeTrends: number; breakoutTrends: number; events24h: number; publications24h: number }; topTrends: Trend[]; sourceHealth: Source[]; categoryCounts: Record<string, number> }
export interface Watchlist { id: string; name: string; description?: string; category?: string; items: Array<{ id: string; value: string; aliases: string[]; enabled: boolean }> }
