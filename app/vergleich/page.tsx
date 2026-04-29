'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position, Version } from '@/lib/types';
import { formatEuro, formatDatum, formatDatumMitUhrzeit, comparePositionNr } from '@/lib/utils';
import Link from 'next/link';
import VersionenVerwalten from '@/components/VersionenVerwalten';

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
  eventual: boolean;
  alternativ: boolean;
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
      eventual:  (n ?? a)!.eventual,
      alternativ: (n ?? a)!.alternativ,
    });
  }

  return zeilen.sort((x, y) => comparePositionNr(x.position_nr, y.position_nr));
}

const BADGE: Record<Aenderungstyp, { label: string; bg: string; text: string; row: string }> = {
  neu:          { label: 'Neu',          bg: 'bg-green-100 dark:bg-green-900/40',  text: 'text-green-700 dark:text-green-400',  row: 'bg-green-50 dark:bg-green-900/20' },
  entfernt:     { label: 'Entfernt',     bg: 'bg-red-100 dark:bg-red-900/40',      text: 'text-red-700 dark:text-red-400',      row: 'bg-red-50 dark:bg-red-900/20' },
  preis:        { label: 'Preis',        bg: 'bg-orange-100 dark:bg-orange-900/40',text: 'text-orange-700 dark:text-orange-400',row: 'bg-orange-50 dark:bg-orange-900/20' },
  beschreibung: { label: 'Beschreibung', bg: 'bg-blue-100 dark:bg-blue-900/40',    text: 'text-blue-700 dark:text-blue-400',    row: 'bg-blue-50 dark:bg-blue-900/20' },
  unveraendert: { label: '',             bg: '',                                    text: '',                                    row: '' },
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
    loadVersionen();
  }, []);

  async function loadVersionen() {
    const { data } = await supabase
      .from('versionen')
      .select('*')
      .order('erstellt_am', { ascending: true });

    if (data && data.length >= 2) {
      setVersionen(data as Version[]);
      setBasisId(data[data.length - 2].id);
      setNeuId(data[data.length - 1].id);
    } else if (data) {
      setVersionen(data as Version[]);
    }
    setLaden(false);
  }

  async function nachLoeschen() {
    setZeilen([]);
    await loadVersionen();
  }

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

  const pflichtig           = (z: VergleichZeile) => !z.eventual && !z.alternativ;
  const pflichtigeZeilen    = zeilen.filter(pflichtig);
  const neuGesamtNettoCalc  = pflichtigeZeilen.reduce((sum, z) => sum + (z.gesamtpreis_neu ?? 0), 0);
  const altGesamtNettoCalc  = pflichtigeZeilen.reduce((sum, z) => sum + (z.gesamtpreis_alt ?? 0), 0);
  const neuGesamtNetto      = neuVersion?.nettosumme ?? neuGesamtNettoCalc;
  const altGesamtNetto      = basisVersion?.nettosumme ?? altGesamtNettoCalc;
  const gesamtDifferenz     = neuGesamtNetto - altGesamtNetto;
  const neuMwst             = neuGesamtNetto * 0.19;
  const neuBrutto           = neuGesamtNetto * 1.19;
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Versionsvergleich</h1>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">← Dashboard</Link>
      </div>

      {/* Versionsauswahl */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">Basis:</span>
          <select
            value={basisId}
            onChange={e => setBasisId(e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
          >
            {versionen.map(v => (
              <option key={v.id} value={v.id} disabled={v.id === neuId}>
                {v.name} ({formatDatum(v.erstellt_am)})
              </option>
            ))}
          </select>
        </div>
        <span className="text-gray-400 dark:text-gray-500">→</span>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">Neu:</span>
          <select
            value={neuId}
            onChange={e => setNeuId(e.target.value)}
            className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
          >
            {versionen.map(v => (
              <option key={v.id} value={v.id} disabled={v.id === basisId}>
                {v.name} ({formatDatum(v.erstellt_am)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <VersionenVerwalten versionen={versionen} onGeloescht={nachLoeschen} />

      {vergleichLaden ? (
        <div className="text-center py-16 text-gray-500">Vergleiche Versionen...</div>
      ) : (
        <>
          {/* Zusammenfassung */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-gray-400">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Preisdifferenz</div>
              <div className={`text-2xl font-bold ${gesamtDifferenz >= 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {gesamtDifferenz >= 0 ? '+' : ''}{formatEuro(gesamtDifferenz)}
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">Netto</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-blue-400">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Netto gesamt (neu)</div>
              <div className="text-2xl font-bold text-gray-800 dark:text-white">{formatEuro(neuGesamtNetto)}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{neuVersion?.name}</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-gray-300">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">zzgl. 19 % MwSt.</div>
              <div className="text-2xl font-bold text-gray-700 dark:text-white">{formatEuro(neuMwst)}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">auf neue Version</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-gray-800 dark:border-gray-500">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Brutto gesamt (neu)</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatEuro(neuBrutto)}</div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">inkl. MwSt.</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-green-500">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Neue Positionen</div>
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">+{anzahlNeu}</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-red-500">
              <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Entfernte / Geändert</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">{anzahlEntfernt + anzahlPreis}</div>
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
                    ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 border-gray-800 dark:border-gray-200'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-400'
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
              const gwNummerParts = gwZeilen.find(z => z.position_nr)?.position_nr?.split('.');
              const gwNummer = gwNummerParts ? gwNummerParts.slice(0, 2).join('.') : undefined;

              return (
                <div key={gewerk} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gray-50 dark:bg-gray-700 px-6 py-3 border-b border-gray-100 dark:border-gray-600 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {gwNummer && (
                        <span className="text-xs font-mono font-medium text-gray-400 dark:text-gray-500 shrink-0">{gwNummer}</span>
                      )}
                      <h3 className="font-semibold text-gray-800 dark:text-white">{gewerk}</h3>
                      <span className="text-xs text-gray-400 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">
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
                        <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-600">
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
                              <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">
                                {z.position_nr || '–'}
                              </td>
                              <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                                {z.aenderung === 'beschreibung' ? (
                                  <div>
                                    <div className="line-through text-gray-400 dark:text-gray-500 text-xs">{z.beschreibung_alt}</div>
                                    <div>{z.beschreibung_neu}</div>
                                  </div>
                                ) : (
                                  z.beschreibung_neu ?? z.beschreibung_alt
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                {z.gesamtpreis_alt != null ? formatEuro(z.gesamtpreis_alt) : '–'}
                              </td>
                              <td className="px-4 py-3 text-right font-medium whitespace-nowrap text-gray-900 dark:text-white">
                                {z.gesamtpreis_neu != null ? formatEuro(z.gesamtpreis_neu) : '–'}
                              </td>
                              <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${
                                z.differenz > 0 ? 'text-red-600 dark:text-red-400' : z.differenz < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500'
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
