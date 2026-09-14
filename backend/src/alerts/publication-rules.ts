import { PublicationStatus, PublicationType, TrendLifecycle } from '@prisma/client';

export interface PublicationSnapshot {
  type: PublicationType;
  status: PublicationStatus;
  scoreAtPublication: number | null;
  lifecycleAtPublication: TrendLifecycle | null;
  createdAt: Date;
}

export interface BreakingCandidate {
  score: number;
  velocity: number;
  acceleration: number;
  sourceCount: number;
  platformCount: number;
  publisherCount?: number;
  lifecycle: TrendLifecycle;
  publications: PublicationSnapshot[];
  isLeadingIndicator?: boolean;
  isSocialViral?: boolean;
  hasMajorProgress?: boolean;
  eventsCount?: number;
}

export function canPublishBreaking(candidate: BreakingCandidate, threshold = 55): boolean {
  const isSpecial = Boolean(candidate.isLeadingIndicator || candidate.isSocialViral);

  // Threshold check: default 55
  if (candidate.score < threshold) return false;

  // Traditional news requires breakout or hot lifecycle and multiple independent publishers;
  // Social viral trends (TikTok hashtags, sounds, viral X discussions) qualify directly once meeting the threshold.
  if (!isSpecial) {
    if (candidate.lifecycle !== TrendLifecycle.BREAKOUT && candidate.lifecycle !== TrendLifecycle.HOT) return false;
    if (candidate.sourceCount < 2 && candidate.platformCount < 2 && (candidate.publisherCount ?? 0) < 2) return false;
    if (candidate.velocity < 45 && candidate.acceleration < 35) return false;
  }

  // Today's Publication Checklist:
  // If this story was already published to Telegram, do NOT repeat it merely because score shifted.
  // It may only be sent again if there is documented major progress (e.g. new scandal, significant development).
  const latest = candidate.publications.find(
    (pub) => pub.type === PublicationType.BREAKING && pub.status === PublicationStatus.SENT,
  );

  if (!latest) return true;

  const hoursSincePublication = (Date.now() - new Date(latest.createdAt).getTime()) / 3_600_000;

  // If sent within the past 18 hours (today's news), only resend if genuine major progress was detected
  if (hoursSincePublication < 18) {
    return Boolean(candidate.hasMajorProgress && hoursSincePublication >= 3);
  }

  // If sent more than 18 hours ago, allow re-activation only on a fresh breakout transition
  return candidate.lifecycle === TrendLifecycle.BREAKOUT && latest.lifecycleAtPublication !== TrendLifecycle.BREAKOUT;
}
