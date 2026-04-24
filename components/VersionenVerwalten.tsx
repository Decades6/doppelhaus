'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Version } from '@/lib/types';
import { formatEuro, formatDatumMitUhrzeit } from '@/lib/utils';

interface Props {
  versionen: Version[];
  onGeloescht: () => void;
}

export default function VersionenVerwalten({ versionen, onGeloescht }: Props) {
  const [offen, setOffen] = useState(false);
  const [loeschenId, setLoeschenId] = useState<string | null>(null);
  const [laden, setLaden] = useState(false);

  async function versionLoeschen(id: string) {
    setLaden(true);
    await supabase.from('positionen').delete().eq('version_id', id);
    await supabase.from('versionen').delete().eq('id', id);
    setLoeschenId(null);
    setLaden(false);
    onGeloescht();
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm mb-6 overflow-hidden">
      <button
        onClick={() => setOffen(v => !v)}
        className="w-full px-4 py-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="font-medium">Versionen verwalten ({versionen.length})</span>
        <span>{offen ? '▲' : '▼'}</span>
      </button>
      {offen && (
        <div className="border-t border-gray-100 dark:border-gray-600 divide-y divide-gray-50 dark:divide-gray-700">
          {versionen.map(v => (
            <div key={v.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-100">{v.name}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500">
                  Hochgeladen: {formatDatumMitUhrzeit(v.erstellt_am)}
                  {v.nettosumme != null
                    ? <span className="ml-2 text-green-500">&#10003; Netto: {formatEuro(v.nettosumme)}</span>
                    : <span className="ml-2 text-orange-400">&#9888; Bitte neu hochladen</span>
                  }
                </div>
              </div>
              {loeschenId === v.id ? (
                <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <span className="text-xs text-red-600 dark:text-red-400">Wirklich löschen?</span>
                  <button
                    onClick={() => versionLoeschen(v.id)}
                    disabled={laden}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {laden ? '...' : 'Ja, löschen'}
                  </button>
                  <button
                    onClick={() => setLoeschenId(null)}
                    className="text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
                  >
                    Abbrechen
                  </button>
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setLoeschenId(v.id); }}
                  className="text-xs text-red-500 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:border-red-400 transition-colors"
                >
                  Löschen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
