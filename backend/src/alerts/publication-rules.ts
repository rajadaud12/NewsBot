import { PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';

export interface PublicationSnapshot { type: PublicationType; status: PublicationStatus; scoreAtPublication: number | null; lifecycleAtPublication: TrendLifecycle | null; createdAt: Date }
export interface BreakingCandidate { score: number; velocity: number; acceleration: number; sourceCount: number; platformCount: number; lifecycle: TrendLifecycle; publications: PublicationSnapshot[] }

export function canPublishBreaking(candidate: BreakingCandidate, threshold = 85, scoreDelta = 5): boolean {
  if (candidate.score < threshold || candidate.lifecycle !== TrendLifecycle.BREAKOUT) return false;
  if (candidate.sourceCount < 2 && candidate.platformCount < 2) return false;
  if (candidate.velocity < 55 && candidate.acceleration < 45) return false;
  const latest = candidate.publications.find((publication) => publication.type === PublicationType.BREAKING && publication.status === PublicationStatus.SENT);
  if (!latest) return true;
  return candidate.score >= Number(latest.scoreAtPublication ?? 0) + scoreDelta || latest.lifecycleAtPublication !== candidate.lifecycle;
}
