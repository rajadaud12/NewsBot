import Link from 'next/link';

const links = [
  ['/dashboard', 'Overview'], ['/trends', 'Trends'], ['/sources', 'Sources'], ['/watchlists', 'Watchlists'], ['/publications', 'Telegram Queue'], ['/settings', 'Settings'],
];

export function Sidebar() {
  return <aside className="border-b border-slate-800 bg-slate-950 px-5 py-5 text-white lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
    <Link href="/dashboard" className="block text-lg font-semibold tracking-tight">Signal Desk</Link>
    <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">Viral intelligence</p>
    <nav className="mt-5 flex gap-2 overflow-x-auto lg:mt-10 lg:flex-col">
      {links.map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-900 hover:text-white">{label}</Link>)}
    </nav>
  </aside>;
}
