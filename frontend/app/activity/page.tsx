'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { formatTime, humanize } from '@/lib/api';
import { PipelineActivity } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const stages = ['', 'QUEUE', 'COLLECTION', 'NORMALIZATION', 'CLUSTERING', 'SCORING', 'VALIDATION', 'LLM', 'MEDIA', 'TELEGRAM'];
const statuses = ['', 'QUEUED', 'STARTED', 'PASSED', 'REJECTED', 'SKIPPED', 'FAILED', 'COMPLETED'];

export default function ActivityPage() {
  const [activity, setActivity] = useState<PipelineActivity>({ items: [], total: 0 });
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [available, setAvailable] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const query = new URLSearchParams({ take: '300' });
      if (stage) query.set('stage', stage);
      if (status) query.set('status', status);
      const response = await fetch(`${API_URL}/activity?${query}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('API unavailable');
      setActivity(await response.json() as PipelineActivity);
      setAvailable(true);
    } catch { setAvailable(false); }
  }, [stage, status]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return <>
    <PageHeader eyebrow="Auto-refreshes every 5 seconds" title="Live news pipeline" />
    <section className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <select aria-label="Filter by stage" value={stage} onChange={(event) => setStage(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        {stages.map((value) => <option key={value} value={value}>{value ? humanize(value) : 'All stages'}</option>)}
      </select>
      <select aria-label="Filter by status" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
        {statuses.map((value) => <option key={value} value={value}>{value ? humanize(value) : 'All statuses'}</option>)}
      </select>
      <span className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${available ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{available ? `${activity.total} logged steps` : 'Backend unavailable'}</span>
    </section>
    <div className="space-y-3">
      {activity.items.map((item) => {
        const stageName = item.context?.stage ?? 'PIPELINE';
        const state = item.context?.status ?? item.level;
        const tone = state === 'FAILED' ? 'bg-red-100 text-red-800' : state === 'REJECTED' ? 'bg-amber-100 text-amber-800' : state === 'PASSED' || state === 'COMPLETED' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800';
        return <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-900 px-2 py-1 font-semibold text-white">{humanize(String(stageName))}</span>
            <span className={`rounded-full px-2.5 py-1 font-medium ${tone}`}>{humanize(String(state))}</span>
            {item.context?.source && <span className="rounded bg-slate-100 px-2 py-1">{String(item.context.source)}</span>}
            <time className="ml-auto text-slate-500">{formatTime(item.createdAt)}</time>
          </div>
          <p className="mt-3 text-sm font-medium text-slate-900">{item.message}</p>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            {item.context?.trendId && <Link className="hover:text-orange-600" href={`/trends/${item.context.trendId}`}>Open trend</Link>}
            {item.context?.publicationId && <Link className="hover:text-orange-600" href="/publications">Open Telegram outbox</Link>}
          </div>
        </article>;
      })}
      {!activity.items.length && <p className="rounded-xl border border-dashed bg-white p-10 text-center text-slate-500">No pipeline steps match these filters yet.</p>}
    </div>
  </>;
}
