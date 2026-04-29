'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position, Version } from '@/lib/types';
import { formatEuro, comparePositionNr } from '@/lib/utils';
import Link from 'next/link';

interface ManuelleKosten {
  nebenkosten: number;
  notar: number;
  vermessung: number;
  stromanschluss: number;
  wasseranschluss: number;
  sielanschluss: number;
  telekomanschluss: number;
  erdarbeiten: number;
  kueche: number;
}

const LEER_KOSTEN: ManuelleKosten = {
  nebenkosten: 0, notar: 0, vermessung: 0,
  stromanschluss: 0, wasseranschluss: 0, sielanschluss: 0, telekomanschluss: 0,
  erdarbeiten: 0, kueche: 0,
};

const BEZEICHNUNGEN: Record<keyof ManuelleKosten, string> = {
  nebenkosten:      'Nebenkosten',
  notar:            'Notar',
  vermessung:       'Vermessung',
  stromanschluss:   'Stromanschluss',
  wasseranschluss:  'Wasseranschluss',
  sielanschluss:    'Sielanschluss',
  telekomanschluss: 'Telekomanschluss',
  erdarbeiten:      'Erdarbeiten',
  kueche:           'Küche',
};

function parseEingabe(wert: string): number {
  return parseFloat(wert.replace(/\./g, '').replace(',', '.')) || 0;
}

function formatEingabe(wert: number): string {
  if (wert === 0) return '';
  return wert.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface EigenleistungGewerk {
  gewerk: string;
  gewerk_nr: string;
  eigenleistung_summe: number;
}

interface MaterialGewerk {
  gewerk: string;
  gewerk_nr: string;
  material_summe: number;
}

export default function KostenPage() {
  const [version, setVersion] = useState<Version | null>(null);
  const [eigenleistungGewerke, setEigenleistungGewerke] = useState<EigenleistungGewerk[]>([]);
  const [materialGewerke, setMaterialGewerke] = useState<MaterialGewerk[]>([]);
  const [kosten, setKosten] = useState<ManuelleKosten>(LEER_KOSTEN);
  const [eingaben, setEingaben] = useState<Record<string, string>>({});
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [grundstueckspreisEingabe, setGrundstueckspreisEingabe] = useState('');
  const speicherTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);


  useEffect(() => { ladeDaten(); }, []);

  async function ladeDaten() {
    const { data: versionen } = await supabase
      .from('versionen')
      .select('*')
      .order('erstellt_am', { ascending: false })
      .limit(1);

    if (versionen && versionen.length > 0) {
      const v = versionen[0] as Version;
      setVersion(v);

      const [{ data: pos }, { data: mat }] = await Promise.all([
        supabase.from('positionen').select('gewerk, position_nr, gesamtpreis')
          .eq('version_id', v.id).eq('eigenleistung', true).eq('nicht_im_angebot', false),
        supabase.from('eigenleistung_materialien').select('gewerk, gesamtpreis'),
      ]);

      if (pos) {
        const gwMap = new Map<string, EigenleistungGewerk>();
        for (const p of pos as Pick<Position, 'gewerk' | 'position_nr' | 'gesamtpreis'>[]) {
          if (!gwMap.has(p.gewerk)) {
            const nr = p.position_nr?.split('.').slice(0, 2).join('.') ?? '';
            gwMap.set(p.gewerk, { gewerk: p.gewerk, gewerk_nr: nr, eigenleistung_summe: 0 });
          }
          gwMap.get(p.gewerk)!.eigenleistung_summe += p.gesamtpreis;
        }
        setEigenleistungGewerke(
          [...gwMap.values()].sort((a, b) => comparePositionNr(a.gewerk_nr || null, b.gewerk_nr || null))
        );

        if (mat) {
          const matMap = new Map<string, number>();
          for (const m of mat as { gewerk: string; gesamtpreis: number }[]) {
            matMap.set(m.gewerk, (matMap.get(m.gewerk) ?? 0) + m.gesamtpreis);
          }
          setMaterialGewerke(
            [...matMap.entries()]
              .map(([gewerk, material_summe]) => ({
                gewerk,
                gewerk_nr: gwMap.get(gewerk)?.gewerk_nr ?? '',
                material_summe,
              }))
              .sort((a, b) => comparePositionNr(a.gewerk_nr || null, b.gewerk_nr || null))
          );
        }
      }
    }

    const { data: manuelleRows } = await supabase
      .from('kosten_manuell')
      .select('schluessel, betrag');

    if (manuelleRows) {
      const geladen: Partial<ManuelleKosten> = {};
      const eingangsWerte: Record<string, string> = {};
      for (const row of manuelleRows) {
        if (row.schluessel in LEER_KOSTEN) {
          (geladen as Record<string, number>)[row.schluessel] = row.betrag ?? 0;
          eingangsWerte[row.schluessel] = row.betrag ? formatEingabe(row.betrag) : '';
        }
      }
      setKosten({ ...LEER_KOSTEN, ...geladen });
      setEingaben(eingangsWerte);
    }

    setLaden(false);
  }

  async function feldGeaendert(schluessel: keyof ManuelleKosten, rohwert: string) {
    setEingaben(prev => ({ ...prev, [schluessel]: rohwert }));
    const betrag = parseEingabe(rohwert);
    setKosten(prev => ({ ...prev, [schluessel]: betrag }));

    if (speicherTimeout.current) clearTimeout(speicherTimeout.current);
    speicherTimeout.current = setTimeout(async () => {
      setSpeichern(true);
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('kosten_manuell').upsert(
        { user_id: user?.id, schluessel, betrag },
        { onConflict: 'user_id,schluessel' }
      );
      setSpeichern(false);
    }, 800);
  }

  const eigenleistungGesamt = eigenleistungGewerke.reduce((s, g) => s + g.eigenleistung_summe, 0);
  // Bauträger-Anteil: Gesamtnetto minus Eigenleistungen (netto), dann Brutto
  const brutto = version?.nettosumme ? (version.nettosumme - eigenleistungGesamt) * 1.19 : 0;
  const grundstueckspreis = parseEingabe(grundstueckspreisEingabe);
  const vorschlagNebenkosten = grundstueckspreis > 0 ? Math.round(grundstueckspreis * 0.055 * 100) / 100 : 0;
  const vorschlagNotar = grundstueckspreis > 0 ? Math.round((grundstueckspreis + brutto) * 0.015 * 100) / 100 : 0;
  const materialGesamt = materialGewerke.reduce((s, g) => s + g.material_summe, 0);
  const anschluesseGesamt = kosten.stromanschluss + kosten.wasseranschluss + kosten.sielanschluss + kosten.telekomanschluss;
  const manuelleGesamt = Object.values(kosten).reduce((s, v) => s + v, 0);
  const gesamtFinanzierung = brutto + materialGesamt + manuelleGesamt;

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gesamtkostenübersicht</h1>
        <div className="flex items-center gap-3">
          {speichern && <span className="text-xs text-gray-400">Speichert...</span>}
          <button
            onClick={() => window.print()}
            className="text-sm text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors"
          >
            Drucken / PDF
          </button>
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">← Dashboard</Link>
        </div>
      </div>

      {/* Print-Titel */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-bold">Gesamtkostenübersicht — Neubau Doppelhaus</h1>
        <p className="text-sm text-gray-500 mt-1">Stand: {new Date().toLocaleDateString('de-DE')}</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden print:shadow-none print:border print:border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700 border-b border-gray-100 dark:border-gray-600">
              <th className="px-6 py-3 text-left font-semibold text-gray-700 dark:text-gray-200">Kostenstelle</th>
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-200 w-48">Betrag</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">

            {/* Hauskosten */}
            <tr className="bg-blue-50/50 dark:bg-blue-900/10">
              <td className="px-6 py-4 font-semibold text-gray-800 dark:text-white">Hauskosten</td>
              <td className="px-6 py-4 text-right font-semibold text-gray-800 dark:text-white">
                {brutto > 0 ? formatEuro(brutto) : <span className="text-gray-400 text-xs">Kein Angebot geladen</span>}
              </td>
            </tr>
            {brutto > 0 && (
              <tr>
                <td className="px-6 py-2 pl-10 text-xs text-gray-400 dark:text-gray-500">
                  Brutto Bauträger-Anteil inkl. 19% MwSt. — {version?.name}
                </td>
                <td className="px-6 py-2 text-right text-xs text-gray-400 dark:text-gray-500">
                  Netto: {formatEuro(version!.nettosumme! - eigenleistungGesamt)}
                </td>
              </tr>
            )}

            {/* Eigenleistungen Materialkosten */}
            {materialGewerke.length > 0 && (
              <>
                <tr className="bg-orange-50/50 dark:bg-orange-900/10">
                  <td className="px-6 py-4 font-semibold text-gray-800 dark:text-white">
                    Eigenleistung Materialkosten
                    <span className="ml-2 text-xs font-normal text-gray-400">(eigene Materialien)</span>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-orange-600 dark:text-orange-400">
                    {formatEuro(materialGesamt)}
                  </td>
                </tr>
                {materialGewerke.map(g => (
                  <tr key={g.gewerk}>
                    <td className="px-6 py-2 pl-10 text-gray-600 dark:text-gray-300">
                      <span className="text-xs text-gray-400 mr-2 font-mono">{g.gewerk_nr}</span>
                      {g.gewerk}
                    </td>
                    <td className="px-6 py-2 text-right text-orange-600 dark:text-orange-400">
                      {formatEuro(g.material_summe)}
                    </td>
                  </tr>
                ))}
              </>
            )}

            {/* Trennlinie */}
            <tr><td colSpan={2} className="px-6 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-semibold text-gray-400 uppercase tracking-wide">Weitere Kosten</td></tr>

            {/* Pauschale-Hilfe */}
            <tr className="print:hidden bg-amber-50/50 dark:bg-amber-900/10">
              <td colSpan={2} className="px-6 py-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Pauschale berechnen (Hamburg):</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Grundstückspreis</span>
                    <input
                      type="text"
                      value={grundstueckspreisEingabe}
                      onChange={e => setGrundstueckspreisEingabe(e.target.value)}
                      placeholder="z.B. 300.000"
                      className="w-36 text-right text-sm border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-1 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                    />
                    <span className="text-xs text-gray-400">€</span>
                  </div>
                  {grundstueckspreis > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => feldGeaendert('nebenkosten', formatEingabe(vorschlagNebenkosten))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                        title="Grunderwerbsteuer Hamburg: 5,5 % vom Grundstückspreis"
                      >
                        Nebenkosten {formatEuro(vorschlagNebenkosten)} übernehmen
                      </button>
                      <button
                        onClick={() => feldGeaendert('notar', formatEingabe(vorschlagNotar))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                        title="Notar + Grundbuch: 1,5 % von Grundstück + Baukosten"
                      >
                        Notar {formatEuro(vorschlagNotar)} übernehmen
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>

            {/* Einfache manuelle Felder */}
            {(['nebenkosten', 'notar', 'vermessung'] as (keyof ManuelleKosten)[]).map(key => (
              <tr key={key}>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-200">{BEZEICHNUNGEN[key]}</td>
                <td className="px-6 py-3 text-right">
                  <KostenInput
                    wert={eingaben[key] ?? ''}
                    onChange={v => feldGeaendert(key, v)}
                  />
                </td>
              </tr>
            ))}

            {/* Anschlüsse */}
            <tr>
              <td className="px-6 py-3 text-gray-700 dark:text-gray-200">
                Anschlüsse
                <span className="ml-2 text-xs text-gray-400">(Strom, Wasser, Siel, Telekom)</span>
              </td>
              <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400 text-sm">
                {anschluesseGesamt > 0 ? formatEuro(anschluesseGesamt) : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </td>
            </tr>
            {(['stromanschluss', 'wasseranschluss', 'sielanschluss', 'telekomanschluss'] as (keyof ManuelleKosten)[]).map(key => (
              <tr key={key}>
                <td className="px-6 py-2 pl-10 text-gray-500 dark:text-gray-400">{BEZEICHNUNGEN[key]}</td>
                <td className="px-6 py-2 text-right">
                  <KostenInput
                    wert={eingaben[key] ?? ''}
                    onChange={v => feldGeaendert(key, v)}
                  />
                </td>
              </tr>
            ))}

            {/* Rest */}
            {(['erdarbeiten', 'kueche'] as (keyof ManuelleKosten)[]).map(key => (
              <tr key={key}>
                <td className="px-6 py-3 text-gray-700 dark:text-gray-200">{BEZEICHNUNGEN[key]}</td>
                <td className="px-6 py-3 text-right">
                  <KostenInput
                    wert={eingaben[key] ?? ''}
                    onChange={v => feldGeaendert(key, v)}
                  />
                </td>
              </tr>
            ))}

            {/* Gesamtsumme */}
            <tr className="bg-gray-900 dark:bg-gray-950 print:bg-gray-100">
              <td className="px-6 py-5 font-bold text-white dark:text-white print:text-gray-900 text-base">
                Gesamtfinanzierungsbedarf
                <div className="text-xs font-normal text-gray-400 mt-0.5">Hauskosten + Materialkosten + Weitere Kosten</div>
              </td>
              <td className="px-6 py-5 text-right font-bold text-white dark:text-white print:text-gray-900 text-xl">
                {formatEuro(gesamtFinanzierung)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KostenInput({ wert, onChange }: { wert: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-end gap-1">
      <input
        type="text"
        value={wert}
        onChange={e => onChange(e.target.value)}
        placeholder="0,00"
        className="w-36 text-right text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 print:border-0 print:bg-transparent"
      />
      <span className="text-gray-400 text-xs print:hidden">€</span>
    </div>
  );
}
