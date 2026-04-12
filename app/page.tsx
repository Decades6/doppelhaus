'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position } from '@/lib/types';
import Link from 'next/link';

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export default function Dashboard() {
  const [positionen, setPositionen] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [offeneGewerke, setOffeneGewerke] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadPositionen();
  }, []);

  async function loadPositionen() {
    const { data } = await supabase
      .from('positionen')
      .select('*')
      .order('gewerk', { ascending: true })
      .order('position_nr', { ascending: true });

    if (data) {
      setPositionen(data);
      // All Gewerke open by default
      const gewerke = new Set(data.map((p: Position) => p.gewerk));
      setOffeneGewerke(gewerke);
    }
    setLoading(false);
  }

  async function toggleEigenleistung(id: string, current: boolean) {
    await supabase
      .from('positionen')
      .update({ eigenleistung: !current })
      .eq('id', id);

    setPositionen(prev =>
      prev.map(p => (p.id === id ? { ...p, eigenleistung: !current } : p))
    );
  }

  function toggleGewerk(gewerk: string) {
    setOffeneGewerke(prev => {
      const next = new Set(prev);
      if (next.has(gewerk)) next.delete(gewerk);
      else next.add(gewerk);
      return next;
    });
  }

  const gesamtsumme = positionen.reduce((sum, p) => sum + p.gesamtpreis, 0);
  const eigenleistungSumme = positionen
    .filter(p => p.eigenleistung)
    .reduce((sum, p) => sum + p.gesamtpreis, 0);
  const verbleibend = gesamtsumme - eigenleistungSumme;
  const mwst = verbleibend * 0.19;
  const brutto = verbleibend * 1.19;

  const gewerke = [...new Set(positionen.map(p => p.gewerk))];

  if (loading) {
    return (
      <div className="text-center py-16 text-gray-500">
        <div className="text-4xl mb-3">...</div>
        <p>Lade Daten...</p>
      </div>
    );
  }

  if (positionen.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-7xl mb-6">📋</div>
        <h2 className="text-2xl font-semibold text-gray-700 mb-3">Noch kein Angebot hochgeladen</h2>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Lade euer PDF-Angebot vom Bauträger hoch und wir berechnen automatisch die
          Auswirkungen eurer Eigenleistungen.
        </p>
        <Link
          href="/upload"
          className="bg-blue-600 text-white px-8 py-3 rounded-xl text-lg hover:bg-blue-700 transition-colors"
        >
          Angebot hochladen
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Preis-Übersicht */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-blue-500">
          <div className="text-sm text-gray-500 mb-1">Gesamtangebot</div>
          <div className="text-2xl font-bold text-gray-900">{formatEuro(gesamtsumme)}</div>
          <div className="text-xs text-gray-400 mt-1">{positionen.length} Positionen</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500">
          <div className="text-sm text-gray-500 mb-1">Ersparnis durch Eigenleistung</div>
          <div className="text-2xl font-bold text-green-600">{formatEuro(eigenleistungSumme)}</div>
          <div className="text-xs text-gray-400 mt-1">
            {positionen.filter(p => p.eigenleistung).length} Positionen markiert
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
          <div className="text-sm text-gray-500 mb-1">Verbleibend für Bauträger</div>
          <div className="text-2xl font-bold text-orange-600">{formatEuro(verbleibend)}</div>
          <div className="text-xs text-gray-400 mt-1">
            {gesamtsumme > 0 ? Math.round((eigenleistungSumme / gesamtsumme) * 100) : 0}% Eigenleistungsanteil
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-gray-400">
          <div className="text-sm text-gray-500 mb-1">zzgl. 19 % MwSt.</div>
          <div className="text-2xl font-bold text-gray-700">{formatEuro(mwst)}</div>
          <div className="text-xs text-gray-400 mt-1">auf Bauträger-Anteil</div>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-gray-800">
          <div className="text-sm text-gray-500 mb-1">Brutto gesamt</div>
          <div className="text-2xl font-bold text-gray-900">{formatEuro(brutto)}</div>
          <div className="text-xs text-gray-400 mt-1">inkl. MwSt.</div>
        </div>
      </div>

      {/* Hinweis */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-6 text-sm text-blue-700">
        Klicke auf das Kreis-Symbol rechts bei einer Position um sie als <strong>Eigenleistung</strong> zu markieren.
        Der Preis wird dann aus der Gesamtberechnung herausgerechnet.
      </div>

      {/* Positionen nach Gewerk */}
      <div className="space-y-4">
        {gewerke.map(gewerk => {
          const gwPositionen = positionen.filter(p => p.gewerk === gewerk);
          const gwSumme = gwPositionen.reduce((sum, p) => sum + p.gesamtpreis, 0);
          const gwEigenleistung = gwPositionen
            .filter(p => p.eigenleistung)
            .reduce((sum, p) => sum + p.gesamtpreis, 0);
          const isOffen = offeneGewerke.has(gewerk);

          return (
            <div key={gewerk} className="bg-white rounded-xl shadow-sm overflow-hidden">
              {/* Gewerk Header */}
              <button
                onClick={() => toggleGewerk(gewerk)}
                className="w-full bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-100 hover:bg-gray-100 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{isOffen ? '▼' : '▶'}</span>
                  <h3 className="font-semibold text-gray-800">{gewerk}</h3>
                  <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                    {gwPositionen.length} Pos.
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {gwEigenleistung > 0 && (
                    <span className="text-green-600 font-medium">
                      -{formatEuro(gwEigenleistung)}
                    </span>
                  )}
                  <span className="text-gray-700 font-semibold">{formatEuro(gwSumme)}</span>
                </div>
              </button>

              {/* Positionen Tabelle */}
              {isOffen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 border-b border-gray-100">
                        <th className="px-4 py-2 text-left font-medium w-20">Pos.</th>
                        <th className="px-4 py-2 text-left font-medium">Beschreibung</th>
                        <th className="px-4 py-2 text-right font-medium w-28">Menge</th>
                        <th className="px-4 py-2 text-right font-medium w-28">EP</th>
                        <th className="px-4 py-2 text-right font-medium w-32">GP</th>
                        <th className="px-4 py-2 text-center font-medium w-32">Eigenleistung</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {gwPositionen.map(p => (
                        <tr
                          key={p.id}
                          className={`transition-colors ${
                            p.eigenleistung ? 'bg-green-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {p.position_nr || '–'}
                          </td>
                          <td className="px-4 py-3 text-gray-800">
                            {p.beschreibung}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                            {p.menge != null ? `${p.menge} ${p.einheit || ''}`.trim() : '–'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                            {p.einzelpreis != null ? formatEuro(p.einzelpreis) : '–'}
                          </td>
                          <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${
                            p.eigenleistung ? 'line-through text-gray-300' : 'text-gray-900'
                          }`}>
                            {formatEuro(p.gesamtpreis)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => toggleEigenleistung(p.id, p.eigenleistung)}
                              title={p.eigenleistung ? 'Als Fremdleistung markieren' : 'Als Eigenleistung markieren'}
                              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mx-auto transition-all text-sm font-bold ${
                                p.eigenleistung
                                  ? 'bg-green-500 border-green-500 text-white'
                                  : 'border-gray-300 text-transparent hover:border-green-400 hover:text-green-400'
                              }`}
                            >
                              ✓
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
