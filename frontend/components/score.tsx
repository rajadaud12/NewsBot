export function Score({ value }: { value: number }) {
  const color = value >= 85 ? 'bg-red-500' : value >= 70 ? 'bg-orange-500' : value >= 50 ? 'bg-amber-500' : 'bg-slate-500';
  return <div className="flex items-center gap-3"><div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200"><div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div><span className="font-mono text-sm font-semibold">{Math.round(value)}</span></div>;
}
