import { PageHeader } from '@/components/page-header';
import { TrendTable } from '@/components/trend-table';
import { api } from '@/lib/api';
import { DashboardData } from '@/types';
import { TOPIC_GROUPS } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';
export default async function DashboardPage() {
  const data = await api<DashboardData>('/dashboard', { counts: { activeTrends: 0, breakoutTrends: 0, events24h: 0, publications24h: 0 }, topTrends: [], sourceHealth: [], categoryCounts: {} });
  const cards = [['Active trends', data.counts.activeTrends], ['Breakouts', data.counts.breakoutTrends], ['Events · 24h', data.counts.events24h], ['Published · 24h', data.counts.publications24h]];
  return <><PageHeader eyebrow="Live intelligence" title="Signal overview"><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">Pipeline dashboard</span></PageHeader>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</section>
    <section className="mt-10"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Highest-value trends</h2><span className="text-xs text-slate-500">Deterministic score</span></div><TrendTable trends={data.topTrends} /></section>
    <section className="mt-10"><div className="mb-4"><h2 className="text-lg font-semibold">Initial topic coverage</h2><p className="mt-1 text-sm text-slate-500">The eight discovery areas from the scope, with active trend counts.</p></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{TOPIC_GROUPS.map((topic) => { const count = topic.categories.reduce((sum, category) => sum + (data.categoryCounts[category] ?? 0), 0); return <article key={topic.title} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><h3 className="font-medium text-slate-950">{topic.title}</h3><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700">{count}</span></div><p className="mt-2 text-xs leading-5 text-slate-500">{topic.description}</p></article>; })}</div></section>
  </>;
}
