import { PageHeader } from '@/components/page-header';
import { TrendTable } from '@/components/trend-table';
import { api } from '@/lib/api';
import { Trend } from '@/types';
import Link from 'next/link';
import { CATEGORY_OPTIONS, LIFECYCLE_OPTIONS } from '@/lib/taxonomy';

export const dynamic = 'force-dynamic';
export default async function TrendsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const trends = await api<Trend[]>(`/trends${query ? `?${query}` : ''}`, []);
  const field = 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800';
  return <><PageHeader eyebrow="Detection pipeline" title="Trends" /><form className="mb-5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <label className="grid gap-1 text-xs font-medium text-slate-500">Search<input name="q" defaultValue={params.q} placeholder="Title or keyword" className={field} /></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Category<select name="category" defaultValue={params.category ?? ''} className={field}><option value="">All categories</option>{CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Platform<select name="platform" defaultValue={params.platform ?? ''} className={field}><option value="">All platforms</option><option value="news">News</option><option value="reddit">Reddit</option><option value="x">X</option><option value="tiktok">TikTok</option></select></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Source<select name="source" defaultValue={params.source ?? ''} className={field}><option value="">All sources</option><option value="gdelt">GDELT</option><option value="google-news">Google News</option><option value="reddit">Reddit</option><option value="x">X</option><option value="tiktok">TikTok</option></select></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Lifecycle<select name="lifecycle" defaultValue={params.lifecycle ?? ''} className={field}><option value="">All states</option>{LIFECYCLE_OPTIONS.map((value) => <option key={value} value={value}>{value[0] + value.slice(1).toLowerCase()}</option>)}</select></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Minimum score<input name="minScore" defaultValue={params.minScore} type="number" min="0" max="100" step="1" placeholder="0" className={field} /></label>
      <label className="grid gap-1 text-xs font-medium text-slate-500">Time window<select name="hours" defaultValue={params.hours ?? ''} className={field}><option value="">Any time</option><option value="1">Last hour</option><option value="6">Last 6 hours</option><option value="24">Last 24 hours</option><option value="72">Last 3 days</option><option value="168">Last 7 days</option></select></label>
      <div className="flex items-end gap-2"><button className="flex-1 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Apply filters</button><Link href="/trends" className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Reset</Link></div>
    </div>
  </form><p className="mb-3 text-sm text-slate-500">{trends.length} matching trend{trends.length === 1 ? '' : 's'}</p><TrendTable trends={trends} /></>;
}
