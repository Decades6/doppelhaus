'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Zahlung } from '@/lib/types';
import { formatEuro } from '@/lib/utils';

const KATEGORIEN = ['Bauträger', 'Notar/Grundbuch', 'Anschlüsse', 'Material', 'Eigenleistung', 'Sonstiges'];

function formatDatumDE(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ZahlungenTab() {
  const [zahlungen, setZahlungen] = useState<Zahlung[]>([]);
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [form, setForm] = useState({
    datum: new Date().toISOString().split('T')[0],
    beschreibung: '',
    kategorie: 'Bauträger',
    betrag: '',
  });

  useEffect(() => { ladeZahlungen(); }, []);

  async function ladeZahlungen() {
    const { data } = await supabase.from('zahlungen').select('*').order('datum', { ascending: false });
    if (data) setZahlungen(data as Zahlung[]);
    setLaden(false);
  }

  async function hinzufuegen() {
    const betrag = parseFloat(form.betrag.replace(/\./g, '').replace(',', '.'));
    if (!form.beschreibung.trim() || isNaN(betrag) || betrag <= 0) return;
    setSpeichern(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('zahlungen')
      .insert({ user_id: user?.id, datum: form.datum, beschreibung: form.beschreibung.trim(), kategorie: form.kategorie, betrag })
      .select().single();
    if (!error && data) {
      setZahlungen(prev => [data as Zahlung, ...prev].sort((a, b) => b.datum.localeCompare(a.datum)));
      setForm(prev => ({ ...prev, beschreibung: '', betrag: '' }));
    }
    setSpeichern(false);
  }

  async function loeschen(id: string) {
    await supabase.from('zahlungen').delete().eq('id', id);
    setZahlungen(prev => prev.filter(z => z.id !== id));
  }

  const gesamtBezahlt = zahlungen.reduce((s, z) => s + z.betrag, 0);

  const nachKategorie = KATEGORIEN.map(k => ({
    kategorie: k,
    summe: zahlungen.filter(z => z.kategorie === k).reduce((s, z) => s + z.betrag, 0),
  })).filter(k => k.summe > 0);

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Zahlungserfassung</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Erfasse alle geleisteten Zahlungen rund ums Haus</p>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500 dark:text-gray-400">Gesamt bezahlt</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatEuro(gesamtBezahlt)}</div>
        </div>
      </div>

      {/* Formular */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">Neue Zahlung erfassen</h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Datum</label>
            <input type="date" value={form.datum} onChange={e => setForm(p => ({ ...p, datum: e.target.value }))}
              className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs text-gray-400 mb-1 block">Beschreibung</label>
            <input type="text" value={form.beschreibung} onChange={e => setForm(p => ({ ...p, beschreibung: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && hinzufuegen()}
              placeholder="z.B. Abschlagsrechnung 1"
              className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Kategorie</label>
            <select value={form.kategorie} onChange={e => setForm(p => ({ ...p, kategorie: e.target.value }))}
              className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
              {KATEGORIEN.map(k => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Betrag €</label>
            <input type="text" value={form.betrag} onChange={e => setForm(p => ({ ...p, betrag: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && hinzufuegen()}
              placeholder="10.000,00"
              className="w-32 text-right text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
          </div>
          <button onClick={hinzufuegen} disabled={speichern || !form.beschreibung.trim()}
            className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap">
            {speichern ? '...' : '+ Hinzufügen'}
          </button>
        </div>
      </div>

      {zahlungen.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-400">
          Noch keine Zahlungen erfasst.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Zahlungsliste */}
          <div className="xl:col-span-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400">
                  <th className="px-5 py-3 text-left font-medium">Datum</th>
                  <th className="px-5 py-3 text-left font-medium">Beschreibung</th>
                  <th className="px-5 py-3 text-left font-medium">Kategorie</th>
                  <th className="px-5 py-3 text-right font-medium">Betrag</th>
                  <th className="px-5 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {zahlungen.map(z => (
                  <tr key={z.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDatumDE(z.datum)}</td>
                    <td className="px-5 py-3 text-gray-800 dark:text-gray-200">{z.beschreibung}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{z.kategorie || 'Sonstiges'}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900 dark:text-white">{formatEuro(z.betrag)}</td>
                    <td className="px-5 py-3 text-center">
                      <button onClick={() => loeschen(z.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600">
                  <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-gray-600 dark:text-gray-300">Gesamt</td>
                  <td className="px-5 py-3 text-right font-bold text-gray-900 dark:text-white">{formatEuro(gesamtBezahlt)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Aufschlüsselung nach Kategorie */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-4">Nach Kategorie</h3>
            <div className="space-y-3">
              {nachKategorie.map(k => (
                <div key={k.kategorie}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 dark:text-gray-300">{k.kategorie}</span>
                    <span className="font-medium text-gray-800 dark:text-white">{formatEuro(k.summe)}</span>
                  </div>
                  <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(k.summe / gesamtBezahlt) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
