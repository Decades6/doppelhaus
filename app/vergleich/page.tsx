'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position, Version } from '@/lib/types';
import Link from 'next/link';

type Aenderungstyp = 'neu' | 'entfernt' | 'preis' | 'beschreibung' | 'unveraendert';
type Filter = 'alle' | 'aenderungen' | 'neu' | 'entfernt' | 'preis';

interface VergleichZeile {
  key: string;
  position_nr: string | null;
  gewerk: string;
  beschreibung_alt?: string;
  beschreibung_neu?: string;
  gesamtpreis_alt?: number;
  gesamtpreis_neu?: number;
  differenz: number;
  aenderung: Aenderungstyp;
}

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDatum(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function comparePositionNr(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] || 0) - (partsB[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function vergleiche(alt: Position[], neu: Position[]): VergleichZeile[] {
  const altMap = new Map<string, Position>();
  const neuMap = new Map<string, Position>();

  for (const p of alt) {
    const key = p.position_nr || `${p.gewerk}__${p.beschreibung}`;
    altMap.set(key, p);
  }
  for (const p of neu) {
    const key = p.position_nr || `${p.gewerk}__${p.beschreibung}`;
    neuMap.set(key, p);
  }

  const alleKeys = new Set([...altMap.keys(), ...neuMap.keys()]);
  const zeilen: VergleichZeile[] = [];

  for (const key of alleKeys) {
    const a = altMap.get(key);
    const n = neuMap.get(key);

    let aenderung: Aenderungstyp;
    if (!a) aenderung = 'neu';
    else if (!n) aenderung = 'entfernt';
    else if (Math.abs(a.gesamtpreis - n.gesamtpreis) > 0.01) aenderung = 'preis';
    else if (a.beschreibung.trim() !== n.beschreibung.trim()) aenderung = 'beschreibung';
    else aenderung = 'unveraendert';

    zeilen.push({
      key,
      position_nr: (a ?? n)!.position_nr,
      gewerk: (a ?? n)!.gewerk,
      beschreibung_alt: a?.beschreibung,
      beschreibung_neu: n?.beschreibung,
      gesamtpreis_alt: a?.gesamtpreis,
      gesamtpreis_neu: n?.gesamtpreis,
      differenz: (n?.gesamtpreis ?? 0) - (a?.gesamtpreis ?? 0),
      aenderung,
    });
  }

  return zeilen.sort((x, y) => comparePositionNr(x.position_nr, y.position_nr));
}

const BADGE: Record<Aenderungstyp, { label: string; bg: string; text: string; row: string }> = {
  neu:          { label: 'Neu',          bg: 'bg-green-100',  text: 'text-green-700',  row: 'bg-green-50' },
  entfernt:     { label: 'Entfernt',     bg: 'bg-red-100',    text: 'text-red-700',    row: 'bg-red-50' },
  preis:        { label: 'Preis',        bg: 'bg-orange-100', text: 'text-orange-700', row: 'bg-orange-50' },
  beschreibung: { label: 'Beschreibung', bg: 'bg-blue-100',   text: 'text-blue-700',   row: 'bg-blue-50' },
  unveraendert: { label: '',             bg: '',              text: '',                row: '' },
};

export default function VergleichPage() {
  const [versionen, setVersionen] = useState<Version[]>([]);
  const [basisId, setBasisId] = useState('');
  const [neuId, setNeuId] = useState('');
  const [zeilen, setZeilen] = useState<VergleichZeile[]>([]);
  const [laden, setLaden] = useState(true);
  const [vergleichLaden, setVergleichLaden] = useState(false);
  const [filter, setFilter] = useState<Filter>('aenderungen');

  useEffect(() => {
    async function loadVersionen() {
      const { data } = await supabase
        .from('versionen')
        .select('*')
        .order('erstellt_am', { ascending: true });

      if (data && data.length >= 2) {
        setVersionen(data as Version[]);
        setBasisId(data[data.length - 2].id);
        setNeuId(data[data.length - 1].id);
      }
      setLaden(false);
    }
    loadVersionen();
  }, []);

  useEffect(() => {
    if (basisId && neuId && basisId !== neuId) {
      ladeVergleich();
    }
  }, [basisId, neuId]);

  async function ladeVergleich() {
    setVergleichLaden(true);

    const [{ data: altDaten }, { data: neuDaten }] = await Promise.all([
      supabase.from('positionen').select('*').eq('version_id', basisId),
      supabase.from('positionen').select('*').eq('version_id', neuId),
    ]);

    if (altDaten && neuDaten) {
      setZeilen(vergleiche(altDaten as Position[], neuDaten as Position[]));
    }
    setVergleichLaden(false);
  }

  const basisVersion = versionen.find(v => v.id === basisId);
  const neuVersion = versionen.find(v => v.id === neuId);

  const gefilterteZeilen = zeilen.filter(z => {
    if (filter === 'alle') return true;
    if (filter === 'aenderungen') return z.aenderung !== 'unveraendert';
    return z.aenderung === filter;
  });

  const gesamtDifferenz = zeilen.reduce((sum, z) => sum + z.differenz, 0);
  const neuGesamtNetto  = zeilen.reduce((sum, z) => sum + (z.gesamtpreis_neu ?? 0), 0);
  const neuMwst         = neuGesamtNetto * 0.19;
  const neuBrutto       = neuGesamtNetto * 1.19;
  const anzahlNeu      = zeilen.filter(z => z.aenderung === 'neu').length;
  const anzahlEntfernt = zeilen.filter(z => z.aenderung === 'entfernt').length;
  const anzahlPreis    = zeilen.filter(z => z.aenderung === 'preis').length;

  const gewerke = [...new Set(gefilterteZeilen.map(z => z.gewerk))];

  if (laden) {
    return <div className="text-center py-16 text-gray-500">Lade Versionen...</div>;
  }

  if (versionen.length < 2) {
    return (
      <div className="text-center py-20">
        <div className="text-6xl mb-6">📊</div>
        <h2 className="text-2xl font-semibold text-gray-700 mb-3">Mindestens 2 Versionen erforderlich</h2>
        <p className="text-gray-500 mb-8">Lade ein weiteres PDF hoch um einen Vergleich zu erstellen.</p>
        <Link href="/upload" className="bg-blue-600 text-white px-8 py-3 rounded-xl hover:bg-blue-700 transition-colors">
          PDF hochladen
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Versionsvergleich</h1>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</Link>
      </div>

      {/* Versionsauswahl */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 font-medium">Basis:</span>
          <select
            value={basisId}
            onChange={e => setBasisId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400"
          >
            {versionen.map(v => (
              <option key={v.id} value={v.id} disabled={v.id === neuId}>
                {v.name} ({formatDatum(v.erstellt_am)})
              </option>
            ))}
          </select>
        </div>
        <span className="text-gray-400">→</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 font-medium">Neu:</span>
          <select
            value={neuId}
            onChange={e => setNeuId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400"
          >
            {versionen.map(v => (
              <option key={v.id} value={v.id} disabled={v.id === basisId}>
                {v.name} ({formatDatum(v.erstellt_am)})
              </option>
            ))}
          </select>
        </div>
      </div>

      {vergleichLaden ? (
        <div className="text-center py-16 text-gray-500">Vergleiche Versionen...</div>
      ) : (
        <>
          {/* Zusammenfassung */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-gray-400">
              <div className="text-sm text-gray-500 mb-1">Preisdifferenz</div>
              <div className={`text-2xl font-bold ${gesamtDifferenz >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                {gesamtDifferenz >= 0 ? '+' : ''}{formatEuro(gesamtDifferenz)}
              </div>
              <div className="text-xs text-gray-400 mt-1">Netto</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-blue-400">
              <div className="text-sm text-gray-500 mb-1">Netto gesamt (neu)</div>
              <div className="text-2xl font-bold text-gray-800">{formatEuro(neuGesamtNetto)}</div>
              <div className="text-xs text-gray-400 mt-1">{neuVersion?.name}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-gray-300">
              <div className="text-sm text-gray-500 mb-1">zzgl. 19 % MwSt.</div>
              <div className="text-2xl font-bold text-gray-700">{formatEuro(neuMwst)}</div>
              <div className="text-xs text-gray-400 mt-1">auf neue Version</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-gray-800">
              <div className="text-sm text-gray-500 mb-1">Brutto gesamt (neu)</div>
              <div className="text-2xl font-bold text-gray-900">{formatEuro(neuBrutto)}</div>
              <div className="text-xs text-gray-400 mt-1">inkl. MwSt.</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-green-500">
              <div className="text-sm text-gray-500 mb-1">Neue Positionen</div>
              <div className="text-2xl font-bold text-green-600">+{anzahlNeu}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5 border-l-4 border-red-500">
              <div className="text-sm text-gray-500 mb-1">Entfernte / Geändert</div>
              <div className="text-2xl font-bold text-red-600">{anzahlEntfernt + anzahlPreis}</div>
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-2 mb-4 flex-wrap">
            {([
              ['alle',        'Alle'],
              ['aenderungen', 'Nur Änderungen'],
              ['neu',         'Neu'],
              ['entfernt',    'Entfernt'],
              ['preis',       'Preisänderung'],
            ] as [Filter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                  filter === key
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tabelle nach Gewerk */}
          <div className="space-y-4">
            {gewerke.map(gewerk => {
              const gwZeilen = gefilterteZeilen.filter(z => z.gewerk === gewerk);
              const gwDiff = gwZeilen.reduce((sum, z) => sum + z.differenz, 0);

              return (
                <div key={gewerk} className="bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-6 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <h3 className="font-semibold text-gray-800">{gewerk}</h3>
                      <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
                        {gwZeilen.length} Pos.
                      </span>
                    </div>
                    {gwDiff !== 0 && (
                      <span className={`text-sm font-semibold ${gwDiff > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {gwDiff > 0 ? '+' : ''}{formatEuro(gwDiff)}
                      </span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-100">
                          <th className="px-4 py-2 text-left font-medium w-20">Pos.</th>
                          <th className="px-4 py-2 text-left font-medium">Beschreibung</th>
                          <th className="px-4 py-2 text-right font-medium w-32">Basis</th>
                          <th className="px-4 py-2 text-right font-medium w-32">Neu</th>
                          <th className="px-4 py-2 text-right font-medium w-28">Differenz</th>
                          <th className="px-4 py-2 text-center font-medium w-28">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {gwZeilen.map(z => {
                          const stil = BADGE[z.aenderung];
                          return (
                            <tr key={z.key} className={stil.row}>
                              <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                                {z.position_nr || '–'}
                              </td>
                              <td className="px-4 py-3 text-gray-800">
                                {z.aenderung === 'beschreibung' ? (
                                  <div>
                                    <div className="line-through text-gray-400 text-xs">{z.beschreibung_alt}</div>
                                    <div>{z.beschreibung_neu}</div>
                                  </div>
                                ) : (
                                  z.beschreibung_neu ?? z.beschreibung_alt
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                                {z.gesamtpreis_alt != null ? formatEuro(z.gesamtpreis_alt) : '–'}
                              </td>
                              <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-gray-900">
                                {z.gesamtpreis_neu != null ? formatEuro(z.gesamtpreis_neu) : '–'}
                              </td>
                              <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                                z.differenz > 0 ? 'text-red-600' : z.differenz < 0 ? 'text-green-600' : 'text-gray-400'
                              }`}>
                                {z.differenz !== 0
                                  ? `${z.differenz > 0 ? '+' : ''}${formatEuro(z.differenz)}`
                                  : '–'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {stil.label && (
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stil.bg} ${stil.text}`}>
                                    {stil.label}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
