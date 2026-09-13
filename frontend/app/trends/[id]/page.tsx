import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Score } from '@/components/score';
import { api, formatTime, humanize } from '@/lib/api';
import { Trend } from '@/types';

export const dynamic = 'force-dynamic';
export default async function TrendDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trend = await api<Trend | null>(`/trends/${id}`, null);
  if (!trend) return <><PageHeader title="Trend unavailable" /><p className="text-slate-600">The API is unavailable or this trend does not exist.</p></>;
  const platforms = [...new Set(trend.events.map(({ event }) => event.platform))];
  const latestScore = trend.scores?.at(-1);
  return <><PageHeader eyebrow={humanize(trend.category)} title={trend.canonicalTitle}><Score value={trend.currentScore} /></PageHeader>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[['Lifecycle', humanize(trend.lifecycle)], ['Platforms', platforms.join(' • ')], ['First seen', formatTime(trend.firstSeenAt)], ['Last updated', formatTime(trend.lastSeenAt)]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 font-medium">{value}</p></div>)}</section>
    {latestScore && <section className="mt-8 rounded-xl border border-slate-200 bg-white p-6"><h2 className="font-semibold">Score composition</h2><div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">{['velocity', 'acceleration', 'engagement', 'crossPlatformSpread', 'novelty', 'sourceStrength'].map((key) => <div key={key}><p className="text-xs text-slate-500">{humanize(key)}</p><p className="mt-1 font-mono text-lg">{Math.round(Number(latestScore[key] ?? 0))}</p></div>)}</div></section>}
    <section className="mt-8"><h2 className="mb-4 font-semibold">Clustered evidence</h2><div className="space-y-3">{trend.events.map(({ event, similarity }) => <article key={event.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><span className="rounded bg-slate-100 px-2 py-1">{event.platform}</span><span>{formatTime(event.publishedAt)}</span>{similarity !== undefined && <span>{Math.round(similarity * 100)}% cluster match</span>}</div><Link href={event.url} target="_blank" className="mt-3 block font-medium hover:text-orange-600">{event.title}</Link>{event.author && <p className="mt-1 text-sm text-slate-500">{event.author}</p>}</article>)}</div></section>
  </>;
}
