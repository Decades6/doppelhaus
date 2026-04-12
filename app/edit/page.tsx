'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position } from '@/lib/types';

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export default function EditPage() {
  const [positionen, setPositionen] = useState<Position[]>([]);
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [fehler, setFehler] = useState('');
  const [gespeichert, setGespeichert] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('positionen')
        .select('*')
        .order('gewerk', { ascending: true })
        .order('position_nr', { ascending: true });
      if (data) setPositionen(data);
      setLaden(false);
    }
    load();
  }, []);

  function aendern(id: string, feld: keyof Position, wert: string) {
    setPositionen(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (feld === 'gesamtpreis' || feld === 'einzelpreis' || feld === 'menge') {
        const zahl = parseFloat(wert.replace(',', '.'));
        return { ...p, [feld]: isNaN(zahl) ? undefined : zahl };
      }
      return { ...p, [feld]: wert };
    }));
  }

  function loeschen(id: string) {
    setPositionen(prev => prev.filter(p => p.id !== id));
  }

  async function allesSpeichern() {
    setSpeichern(true);
    setFehler('');

    const { error } = await supabase.from('positionen').upsert(
      positionen.map(p => ({
        id: p.id,
        position_nr: p.position_nr || null,
        gewerk: p.gewerk || 'Allgemein',
        beschreibung: p.beschreibung,
        menge: p.menge || null,
        einheit: p.einheit || null,
        einzelpreis: p.einzelpreis || null,
        gesamtpreis: p.gesamtpreis,
        eigenleistung: p.eigenleistung,
      }))
    );

    setSpeichern(false);

    if (error) {
      setFehler('Fehler beim Speichern: ' + error.message);
      return;
    }

    setGespeichert(true);
    setTimeout(() => { window.location.href = '/'; }, 1500);
  }

  const gesamtsumme = positionen.reduce((sum, p) => sum + p.gesamtpreis, 0);

  if (laden) {
    return <div className="text-center py-16 text-gray-500">Lade Positionen...</div>;
  }

  if (gespeichert) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Gespeichert!</h2>
        <p className="text-gray-500 mb-4">Du wirst gleich weitergeleitet...</p>
        <a href="/" className="text-blue-600 hover:underline text-sm">→ Jetzt zum Dashboard</a>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Positionen bearbeiten</h1>
          <p className="text-gray-500 text-sm mt-1">{positionen.length} Positionen</p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/" className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 border border-gray-300 rounded-lg">
            Abbrechen
          </a>
          <button
            onClick={allesSpeichern}
            disabled={speichern}
            className="text-sm bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
          >
            {speichern ? 'Wird gespeichert...' : 'Änderungen speichern'}
          </button>
        </div>
      </div>

      {fehler && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">{fehler}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex items-center justify-between">
        <span className="text-gray-600 font-medium">Gesamtsumme</span>
        <span className="text-xl font-bold text-gray-900">{formatEuro(gesamtsumme)}</span>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                <th className="px-3 py-3 text-left font-medium w-20">Pos.</th>
                <th className="px-3 py-3 text-left font-medium w-36">Gewerk</th>
                <th className="px-3 py-3 text-left font-medium">Beschreibung</th>
                <th className="px-3 py-3 text-right font-medium w-20">Menge</th>
                <th className="px-3 py-3 text-left font-medium w-16">Einheit</th>
                <th className="px-3 py-3 text-right font-medium w-28">GP (€)</th>
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {positionen.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input value={p.position_nr || ''} onChange={e => aendern(p.id, 'position_nr', e.target.value)}
                      className="w-full text-xs text-gray-600 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" placeholder="–" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={p.gewerk} onChange={e => aendern(p.id, 'gewerk', e.target.value)}
                      className="w-full text-xs text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={p.beschreibung} onChange={e => aendern(p.id, 'beschreibung', e.target.value)}
                      className="w-full text-gray-800 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={p.menge ?? ''} onChange={e => aendern(p.id, 'menge', e.target.value)}
                      className="w-full text-right text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" placeholder="–" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={p.einheit || ''} onChange={e => aendern(p.id, 'einheit', e.target.value)}
                      className="w-full text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" placeholder="–" />
                  </td>
                  <td className="px-3 py-2">
                    <input value={p.gesamtpreis} onChange={e => aendern(p.id, 'gesamtpreis', e.target.value)}
                      className="w-full text-right font-medium text-gray-900 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => loeschen(p.id)}
                      className="text-gray-400 hover:text-red-400 transition-colors text-lg leading-none" title="Position löschen">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
