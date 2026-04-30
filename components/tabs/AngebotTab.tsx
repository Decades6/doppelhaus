'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position, Version } from '@/lib/types';
import { formatEuro, formatDatum, comparePositionNr } from '@/lib/utils';
import Link from 'next/link';
import VersionenVerwalten from '@/components/VersionenVerwalten';

type Gruppe =
  | { type: 'single'; pos: Position }
  | { type: 'pair'; base: Position; alt: Position };

function buildPaare(sorted: Position[]): Gruppe[] {
  const result: Gruppe[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (sorted[i + 1]?.alternativ) {
      result.push({ type: 'pair', base: sorted[i], alt: sorted[i + 1] });
      i += 2;
    } else {
      result.push({ type: 'single', pos: sorted[i] });
      i++;
    }
  }
  return result;
}

export default function AngebotTab() {
  const [positionen, setPositionen] = useState<Position[]>([]);
  const [aktuelleVersion, setAktuelleVersion] = useState<Version | null>(null);
  const [alleVersionen, setAlleVersionen] = useState<Version[]>([]);
  const [versionsAnzahl, setVersionsAnzahl] = useState(0);
  const [loading, setLoading] = useState(true);
  const [offeneGewerke, setOffeneGewerke] = useState<Set<string>>(new Set());

  useEffect(() => { loadDaten(); }, []);

  async function loadDaten() {
    const { data: versionen } = await supabase
      .from('versionen')
      .select('*')
      .order('erstellt_am', { ascending: false });

    if (!versionen || versionen.length === 0) {
      setAlleVersionen([]);
      setAktuelleVersion(null);
      setPositionen([]);
      setVersionsAnzahl(0);
      setLoading(false);
      return;
    }

    setVersionsAnzahl(versionen.length);
    setAlleVersionen(versionen as Version[]);
    const neuste = versionen[0] as Version;
    setAktuelleVersion(neuste);

    const { data } = await supabase
      .from('positionen')
      .select('*')
      .eq('version_id', neuste.id)
      .order('gewerk', { ascending: true })
      .order('position_nr', { ascending: true });

    if (data) {
      setPositionen(data);
      const gewerke = new Set(data.map((p: Position) => p.gewerk));
      setOffeneGewerke(gewerke);
    }
    setLoading(false);
  }

  async function toggleOptionalAktiv(id: string, current: boolean) {
    await supabase.from('positionen').update({ optional_aktiv: !current }).eq('id', id);
    setPositionen(prev => prev.map(p => (p.id === id ? { ...p, optional_aktiv: !current } : p)));
  }

  async function toggleEigenleistung(id: string, current: boolean) {
    await supabase.from('positionen').update({ eigenleistung: !current }).eq('id', id);
    setPositionen(prev => prev.map(p => (p.id === id ? { ...p, eigenleistung: !current } : p)));
  }

  function exportGewerkeXml() {
    const sorted = [...new Set(positionen.map(p => p.gewerk))].sort((a, b) => {
      const aNr = positionen.find(p => p.gewerk === a && p.position_nr)?.position_nr ?? null;
      const bNr = positionen.find(p => p.gewerk === b && p.position_nr)?.position_nr ?? null;
      return comparePositionNr(aNr, bNr);
    });

    const zeilen = sorted.map(gewerk => {
      const nr = positionen.find(p => p.gewerk === gewerk && p.position_nr)?.position_nr?.split('.').slice(0, 2).join('.') ?? '';
      const anzahl = positionen.filter(p => p.gewerk === gewerk).length;
      return `  <gewerk>
    <nummer>${nr}</nummer>
    <name>${gewerk.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</name>
    <anzahl_positionen>${anzahl}</anzahl_positionen>
    <richtig></richtig>
    <falsch></falsch>
    <korrekte_bezeichnung></korrekte_bezeichnung>
  </gewerk>`;
    }).join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Gewerk-Prüfliste: ${aktuelleVersion?.name} -->
<!-- Anleitung: Trage X in <richtig> oder <falsch> ein. -->
<!-- Bei falsch: korrekte Bezeichnung in <korrekte_bezeichnung> eintragen. -->
<gewerke>
${zeilen}
</gewerke>`;

    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gewerke-pruefung-${aktuelleVersion?.name ?? 'export'}.xml`.replace(/\s+/g, '-');
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleGewerk(gewerk: string) {
    setOffeneGewerke(prev => {
      const next = new Set(prev);
      if (next.has(gewerk)) next.delete(gewerk);
      else next.add(gewerk);
      return next;
    });
  }

  const ersetzteIds = new Set<string>();
  [...new Set(positionen.map(p => p.gewerk))].forEach(gw => {
    const sorted = positionen
      .filter(p => p.gewerk === gw)
      .sort((a, b) => comparePositionNr(a.position_nr, b.position_nr));
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1].alternativ && sorted[i + 1].optional_aktiv) {
        ersetzteIds.add(sorted[i].id);
      }
    }
  });

  const istOptional = (p: Position) => (p.eventual || p.alternativ) && !p.optional_aktiv;
  const aktivPositionen = positionen.filter(p => !istOptional(p) && !ersetzteIds.has(p.id) && !p.nicht_im_angebot);
  const optionalPositionen = positionen.filter(p => p.eventual || p.alternativ);
  const optionalNichtAktiv = optionalPositionen.filter(p => !p.optional_aktiv);
  const eventualSumme = optionalNichtAktiv.reduce((sum, p) => sum + p.gesamtpreis, 0);

  const gesamtsumme = aktivPositionen.reduce((sum, p) => sum + p.gesamtpreis, 0);
  const eigenleistungSumme = aktivPositionen.filter(p => p.eigenleistung).reduce((sum, p) => sum + p.gesamtpreis, 0);
  const verbleibend = gesamtsumme - eigenleistungSumme;
  const mwst = verbleibend * 0.19;
  const brutto = verbleibend * 1.19;

  const gewerke = [...new Set(positionen.map(p => p.gewerk))].sort((a, b) => {
    const aNr = positionen.find(p => p.gewerk === a && p.position_nr)?.position_nr ?? null;
    const bNr = positionen.find(p => p.gewerk === b && p.position_nr)?.position_nr ?? null;
    return comparePositionNr(aNr, bNr);
  });

  if (loading) {
    return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;
  }

  if (!aktuelleVersion) {
    return (
      <div className="text-center py-20">
        <div className="text-7xl mb-6">📋</div>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-white mb-3">Noch kein Angebot hochgeladen</h2>
        <p className="text-gray-500 mb-8 max-w-md mx-auto">
          Lade euer PDF-Angebot vom Bauträger hoch und wir berechnen automatisch die Auswirkungen eurer Eigenleistungen.
        </p>
        <Link href="/upload" className="bg-blue-600 text-white px-8 py-3 rounded-xl text-lg hover:bg-blue-700 transition-colors">
          Angebot hochladen
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Versions-Info */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-500 dark:text-gray-300">Aktuelle Version:</span>
          <span className="font-medium text-gray-800 dark:text-gray-100">{aktuelleVersion.name}</span>
          <span className="text-gray-400 dark:text-gray-400">({formatDatum(aktuelleVersion.erstellt_am)})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportGewerkeXml}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
            title="Gewerk-Prüfliste als XML exportieren"
          >
            Gewerke exportieren
          </button>
          {versionsAnzahl >= 2 && (
            <Link
              href="/vergleich"
              className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors"
            >
              Versionen vergleichen
            </Link>
          )}
        </div>
      </div>

      <VersionenVerwalten versionen={alleVersionen} onGeloescht={loadDaten} />

      {/* Preis-Übersicht */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-blue-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Gesamtangebot</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatEuro(gesamtsumme)}</div>
          <div className="text-xs text-gray-400 mt-1">{positionen.length} Positionen</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-green-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Ersparnis durch Eigenleistung</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatEuro(eigenleistungSumme)}</div>
          <div className="text-xs text-gray-400 mt-1">{positionen.filter(p => p.eigenleistung).length} Positionen markiert</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Verbleibend für Bauträger</div>
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatEuro(verbleibend)}</div>
          <div className="text-xs text-gray-400 mt-1">
            {gesamtsumme > 0 ? Math.round((eigenleistungSumme / gesamtsumme) * 100) : 0}% Eigenleistungsanteil
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-gray-400">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">zzgl. 19 % MwSt.</div>
          <div className="text-2xl font-bold text-gray-700 dark:text-white">{formatEuro(mwst)}</div>
          <div className="text-xs text-gray-400 mt-1">auf Bauträger-Anteil</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-gray-800 dark:border-gray-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Brutto gesamt</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatEuro(brutto)}</div>
          <div className="text-xs text-gray-400 mt-1">inkl. MwSt.</div>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg px-4 py-3 mb-4 text-sm text-blue-700 dark:text-blue-300">
        Klicke auf das Kreis-Symbol rechts bei einer Position um sie als <strong>Eigenleistung</strong> zu markieren.
      </div>

      {optionalPositionen.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg px-4 py-3 mb-6 text-sm text-yellow-800 dark:text-yellow-300">
          <strong>{optionalPositionen.length} optionale Positionen</strong> (Eventual / Alternativ) — nutze den <strong>+</strong>-Button um sie ins Angebot aufzunehmen.
          {eventualSumme > 0 && <span className="ml-2 text-yellow-600 dark:text-yellow-400">Noch nicht aufgenommen: {formatEuro(eventualSumme)}</span>}
        </div>
      )}

      <div className="space-y-4">
        {gewerke.map(gewerk => {
          const gwPositionen = positionen
            .filter(p => p.gewerk === gewerk)
            .sort((a, b) => comparePositionNr(a.position_nr, b.position_nr));
          const gwPaare = buildPaare(gwPositionen);
          const gwSumme = gwPositionen
            .filter(p => !ersetzteIds.has(p.id) && !istOptional(p))
            .reduce((sum, p) => sum + p.gesamtpreis, 0);
          const gwEigenleistung = gwPositionen
            .filter(p => p.eigenleistung && !ersetzteIds.has(p.id))
            .reduce((sum, p) => sum + p.gesamtpreis, 0);
          const isOffen = offeneGewerke.has(gewerk);
          const gwNummerParts = gwPositionen.find(p => p.position_nr)?.position_nr?.split('.');
          const gwNummer = gwNummerParts ? gwNummerParts.slice(0, 2).join('.') : undefined;

          return (
            <div key={gewerk} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => toggleGewerk(gewerk)}
                className="w-full bg-gray-50 dark:bg-gray-700 px-6 py-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 dark:text-gray-300">{isOffen ? '▼' : '▶'}</span>
                  {gwNummer && (
                    <span className="text-xs font-mono font-medium text-gray-400 dark:text-gray-500 shrink-0">{gwNummer}</span>
                  )}
                  <h3 className="font-semibold text-gray-800 dark:text-white">{gewerk}</h3>
                  <span className="text-xs text-gray-400 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">
                    {gwPositionen.length} Pos.
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  {gwEigenleistung > 0 && (
                    <span className="text-green-600 font-medium">-{formatEuro(gwEigenleistung)}</span>
                  )}
                  <span className="text-gray-700 font-semibold">{formatEuro(gwSumme)}</span>
                </div>
              </button>

              {isOffen && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-600">
                        <th className="px-4 py-2 text-left font-medium w-20">Pos.</th>
                        <th className="px-4 py-2 text-left font-medium">Beschreibung</th>
                        <th className="px-4 py-2 text-right font-medium w-28">Menge</th>
                        <th className="px-4 py-2 text-right font-medium w-28">EP</th>
                        <th className="px-4 py-2 text-right font-medium w-32">GP</th>
                        <th className="px-4 py-2 text-center font-medium w-32">Aktion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                      {gwPaare.map(gruppe => {
                        if (gruppe.type === 'single') {
                          const p = gruppe.pos;
                          const ersetzt = ersetzteIds.has(p.id);
                          return (
                            <tr key={p.id} className={`transition-colors ${
                              p.eigenleistung ? 'bg-green-50 dark:bg-green-900/20' :
                              p.eventual && !p.optional_aktiv ? 'opacity-40' :
                              ersetzt ? 'opacity-30' :
                              'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}>
                              <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{p.position_nr || '–'}</td>
                              <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                                <div className="flex items-center gap-2">
                                  {p.eventual && <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 font-medium shrink-0">Eventual</span>}
                                  {p.beschreibung}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.menge != null ? `${p.menge} ${p.einheit || ''}`.trim() : '–'}</td>
                              <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.einzelpreis != null ? formatEuro(p.einzelpreis) : '–'}</td>
                              <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${p.eigenleistung ? 'line-through text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>{formatEuro(p.gesamtpreis)}</td>
                              <td className="px-4 py-3 text-center">
                                {p.eventual ? (
                                  <button onClick={() => toggleOptionalAktiv(p.id, p.optional_aktiv)} title={p.optional_aktiv ? 'Aus Angebot entfernen' : 'Ins Angebot aufnehmen'}
                                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mx-auto transition-all text-sm font-bold ${p.optional_aktiv ? 'bg-yellow-500 border-yellow-500 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-400 hover:border-yellow-400 hover:text-yellow-500'}`}>+</button>
                                ) : (
                                  <button onClick={() => toggleEigenleistung(p.id, p.eigenleistung)} title={p.eigenleistung ? 'Als Fremdleistung markieren' : 'Als Eigenleistung markieren'}
                                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mx-auto transition-all text-sm font-bold ${p.eigenleistung ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-green-400 hover:text-green-400'}`}>✓</button>
                                )}
                              </td>
                            </tr>
                          );
                        } else {
                          const { base, alt } = gruppe;
                          const altAktiv = alt.optional_aktiv;
                          return (
                            <>
                              <tr key={base.id} className={`border-l-2 border-blue-300 dark:border-blue-600 transition-colors ${altAktiv ? 'opacity-30' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs whitespace-nowrap">{base.position_nr || '–'}</td>
                                <td className={`px-4 py-3 dark:text-gray-200 ${altAktiv ? 'line-through text-gray-400' : 'text-gray-800'}`}>{base.beschreibung}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{base.menge != null ? `${base.menge} ${base.einheit || ''}`.trim() : '–'}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{base.einzelpreis != null ? formatEuro(base.einzelpreis) : '–'}</td>
                                <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${altAktiv ? 'line-through text-gray-300 dark:text-gray-600' : 'text-gray-900 dark:text-white'}`}>{formatEuro(base.gesamtpreis)}</td>
                                <td className="px-4 py-3 text-center">
                                  {!altAktiv && (
                                    <button onClick={() => toggleEigenleistung(base.id, base.eigenleistung)} title={base.eigenleistung ? 'Als Fremdleistung markieren' : 'Als Eigenleistung markieren'}
                                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mx-auto transition-all text-sm font-bold ${base.eigenleistung ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 dark:border-gray-600 text-transparent hover:border-green-400 hover:text-green-400'}`}>✓</button>
                                  )}
                                </td>
                              </tr>
                              <tr key={alt.id} className={`border-l-2 border-blue-300 dark:border-blue-600 transition-colors ${!altAktiv ? 'opacity-50' : 'bg-blue-50 dark:bg-blue-900/20'}`}>
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="flex flex-col items-start gap-0.5">
                                    <span className="text-[10px] font-semibold text-blue-400 dark:text-blue-500 uppercase tracking-wide leading-none">oder</span>
                                    <span className="text-xs text-gray-400 dark:text-gray-500">{alt.position_nr || '–'}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-gray-800 dark:text-gray-200">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 font-medium shrink-0">Alternativ</span>
                                    {alt.beschreibung}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{alt.menge != null ? `${alt.menge} ${alt.einheit || ''}`.trim() : '–'}</td>
                                <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{alt.einzelpreis != null ? formatEuro(alt.einzelpreis) : '–'}</td>
                                <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${altAktiv ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{formatEuro(alt.gesamtpreis)}</td>
                                <td className="px-4 py-3 text-center">
                                  <button onClick={() => toggleOptionalAktiv(alt.id, alt.optional_aktiv)} title={altAktiv ? 'Basis-Position wiederherstellen' : 'Als Alternative wählen'}
                                    className={`w-8 h-8 rounded-full border-2 flex items-center justify-center mx-auto transition-all text-sm font-bold ${altAktiv ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300 dark:border-gray-600 text-gray-400 hover:border-blue-400 hover:text-blue-500'}`}>↔</button>
                                </td>
                              </tr>
                            </>
                          );
                        }
                      })}
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
