'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setChecking(false);
      if (!session && pathname !== '/login') {
        router.push('/login');
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session && pathname !== '/login') {
        router.push('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Lädt...</div>
      </div>
    );
  }

  if (pathname === '/login') {
    return <>{children}</>;
  }

  if (!user) return null;

  const familienname = user.user_metadata?.display_name ?? user.email?.split('@')[0] ?? 'Nutzer';

  return (
    <>
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-gray-900 dark:text-white hover:text-blue-600 transition-colors">
            Doppelhaus Angebot
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/kosten"
              className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
            >
              Kostenübersicht
            </Link>
            <Link
              href="/eigenleistungen"
              className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
            >
              Eigenleistungen
            </Link>
            <Link
              href="/vergleich"
              className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
            >
              Vergleich
            </Link>
            <Link
              href="/upload"
              className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              PDF hochladen
            </Link>
            <div className="flex items-center gap-2 pl-3 border-l border-gray-200 dark:border-gray-600">
              <span className="text-sm text-gray-500 dark:text-gray-400 capitalize">{familienname}</span>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                title="Abmelden"
              >
                Abmelden
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>
    </>
  );
}
