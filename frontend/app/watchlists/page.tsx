import { PageHeader } from '@/components/page-header';
import { api, humanize } from '@/lib/api';
import { Watchlist } from '@/types';

export const dynamic = 'force-dynamic';
export default async function WatchlistsPage() {
  const lists = await api<Watchlist[]>('/watchlists', []);
  return <><PageHeader eyebrow="Editable discovery inputs" title="Watchlists" /><div className="grid gap-4 lg:grid-cols-2">{lists.map((list) => <article key={list.id} className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">{list.name}</h2><p className="mt-1 text-sm text-slate-500">{list.description}</p></div><span className="rounded bg-slate-100 px-2 py-1 text-xs">{humanize(list.category)}</span></div><div className="mt-5 flex flex-wrap gap-2">{list.items.length ? list.items.map((item) => <span key={item.id} className="rounded-full border border-slate-200 px-3 py-1 text-sm">{item.value}</span>) : <span className="text-sm text-slate-400">No entries yet. Add entries through the watchlist API.</span>}</div></article>)}</div></>;
}
