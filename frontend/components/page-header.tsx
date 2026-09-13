import { ReactNode } from 'react';

export function PageHeader({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div>{eyebrow && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">{eyebrow}</p>}<h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1></div>{children}</div>;
}
