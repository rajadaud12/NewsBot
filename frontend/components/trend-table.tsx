import Link from 'next/link';
import { Trend } from '@/types';
import { formatTime, humanize } from '@/lib/api';
import { Score } from './score';

export function TrendTable({ trends }: { trends: Trend[] }) {
  if (!trends.length) return <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">No trends match the current view. Collectors will populate this table when signals arrive.</div>;
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left text-sm">
    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Trend</th><th className="px-5 py-3">Score</th><th className="px-5 py-3">State</th><th className="px-5 py-3">Signals</th><th className="px-5 py-3">Telegram</th><th className="px-5 py-3">Updated</th></tr></thead>
    <tbody className="divide-y divide-slate-100">{trends.map((trend) => <tr key={trend.id} className="hover:bg-slate-50">
      <td className="max-w-xl px-5 py-4"><Link className="font-medium text-slate-950 hover:text-orange-600" href={`/trends/${trend.id}`}>{trend.canonicalTitle}</Link><div className="mt-1"><span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">{humanize(trend.category)}</span></div></td>
      <td className="px-5 py-4"><Score value={trend.currentScore} /></td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">{humanize(trend.lifecycle)}</span></td>
      <td className="px-5 py-4 text-slate-600">{[...new Set(trend.events.map(({ event }) => event.rawEvent?.source?.name ?? event.platform))].map(humanize).join(' • ') || '—'}</td><td className="px-5 py-4 text-xs text-slate-600">{trend.publications?.[0] ? humanize(trend.publications[0].status) : 'Not queued'}</td><td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatTime(trend.lastSeenAt)}</td>
    </tr>)}</tbody></table></div></div>;
}
