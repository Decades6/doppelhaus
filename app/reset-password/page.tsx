'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [passwort, setPasswort] = useState('');
  const [bestaetigung, setBestaetigung] = useState('');
  const [fehler, setFehler] = useState('');
  const [laden, setLaden] = useState(false);
  const [fertig, setFertig] = useState(false);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setFehler('');
    if (passwort !== bestaetigung) { setFehler('Passwörter stimmen nicht überein.'); return; }
    if (passwort.length < 6) { setFehler('Passwort muss mindestens 6 Zeichen haben.'); return; }
    setLaden(true);
    const { error } = await supabase.auth.updateUser({ password: passwort });
    setLaden(false);
    if (error) { setFehler('Fehler: ' + error.message); return; }
    setFertig(true);
    setTimeout(() => router.push('/'), 2000);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Neues Passwort</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Bitte wähle ein neues Passwort</p>
        </div>

        {fertig ? (
          <p className="text-center text-green-600 dark:text-green-400 font-medium">
            Passwort gespeichert! Du wirst weitergeleitet…
          </p>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Neues Passwort</label>
              <input type="password" value={passwort} onChange={e => setPasswort(e.target.value)} required autoFocus
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-sm"
                placeholder="••••••••" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Passwort bestätigen</label>
              <input type="password" value={bestaetigung} onChange={e => setBestaetigung(e.target.value)} required
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-900 dark:text-white bg-white dark:bg-gray-700 focus:outline-none focus:border-blue-400 text-sm"
                placeholder="••••••••" />
            </div>

            {fehler && (
              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-400 rounded-lg px-3 py-2 text-sm">
                {fehler}
              </div>
            )}

            <button type="submit" disabled={laden}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              {laden ? 'Wird gespeichert...' : 'Passwort speichern'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
