import type { Metadata } from 'next';
import { Sidebar } from '@/components/sidebar';
import './globals.css';

export const metadata: Metadata = { title: 'Signal Desk', description: 'Viral news intelligence and Telegram publishing dashboard' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><Sidebar /><main className="min-h-screen p-5 sm:p-8 lg:ml-64 lg:p-10">{children}</main></body></html>;
}
