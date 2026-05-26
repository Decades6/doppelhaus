'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { EigenleistungMaterial, Position, Version } from '@/lib/types';
import { formatEuro, comparePositionNr, parseGermanNumber, formatGermanNumber } from '@/lib/utils';

// Anschlüsse bleiben als feste Einzelfelder in kosten_manuell
interface AnschlussKosten {
  stromanschluss: number;
  wasseranschluss: number;
  sielanschluss: number;
  telekomanschluss: number;
}

const LEER_ANSCHLUESSE: AnschlussKosten = {
  stromanschluss: 0, wasseranschluss: 0, sielanschluss: 0, telekomanschluss: 0,
};

const ANSCHLUSS_NAMEN: Record<keyof AnschlussKosten, string> = {
  stromanschluss: 'Stromanschluss',
  wasseranschluss: 'Wasseranschluss',
  sielanschluss: 'Sielanschluss',
  telekomanschluss: 'Telekomanschluss',
};

// Dynamische Kategorien mit Unterpunkten
const KATEGORIEN = ['nebenkosten', 'notar', 'vermessung', 'erdarbeiten', 'kueche', 'sonstiges'] as const;
type Kategorie = typeof KATEGORIEN[number];

const KATEGORIEN_NAMEN: Record<Kategorie, string> = {
  nebenkosten: 'Nebenkosten',
  notar: 'Notar',
  vermessung: 'Vermessung',
  erdarbeiten: 'Erdarbeiten',
  kueche: 'Küche',
  sonstiges: 'Sonstiges',
};

interface KostenPosition {
  id: string;
  kategorie: string;
  bezeichnung: string;
  betrag: number;
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


const LEER_FORM = { bezeichnung: '', betrag: '' };

export default function KostenTab() {
  const [version, setVersion] = useState<Version | null>(null);
  const [eigenleistungGewerke, setEigenleistungGewerke] = useState<EigenleistungGewerk[]>([]);
  const [materialGewerke, setMaterialGewerke] = useState<MaterialGewerk[]>([]);
  const [anschluesse, setAnschluesse] = useState<AnschlussKosten>(LEER_ANSCHLUESSE);
  const [anschlussEingaben, setAnschlussEingaben] = useState<Record<string, string>>({});
  const [kostenPositionen, setKostenPositionen] = useState<Record<string, KostenPosition[]>>({});
  const [neuForm, setNeuForm] = useState<Record<string, { bezeichnung: string; betrag: string }>>({});
  const [materialDetails, setMaterialDetails] = useState<Record<string, EigenleistungMaterial[]>>({});
  const [aufgeklappteGewerke, setAufgeklappteGewerke] = useState<Set<string>>(new Set());
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [bearbeitungId, setBearbeitungId] = useState<string | null>(null);
  const [bearbeitungKategorie, setBearbeitungKategorie] = useState<Kategorie | null>(null);
  const [grundstueckspreisEingabe, setGrundstueckspreisEingabe] = useState('');
  const speicherTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { ladeDaten(); }, []);

  async function ladeDaten() {
    const { data: versionen } = await supabase.from('versionen').select('*').order('erstellt_am', { ascending: false }).limit(1);

    if (versionen && versionen.length > 0) {
      const v = versionen[0] as Version;
      setVersion(v);

      const [{ data: pos }, { data: mat }] = await Promise.all([
        supabase.from('positionen').select('gewerk, position_nr, gesamtpreis').eq('version_id', v.id).eq('eigenleistung', true).eq('nicht_im_angebot', false),
        supabase.from('eigenleistung_materialien').select('*').order('created_at', { ascending: true }),
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
        setEigenleistungGewerke([...gwMap.values()].sort((a, b) => comparePositionNr(a.gewerk_nr || null, b.gewerk_nr || null)));

        if (mat) {
          const matMap = new Map<string, number>();
          const details: Record<string, EigenleistungMaterial[]> = {};
          for (const m of mat as EigenleistungMaterial[]) {
            matMap.set(m.gewerk, (matMap.get(m.gewerk) ?? 0) + m.gesamtpreis);
            if (!details[m.gewerk]) details[m.gewerk] = [];
            details[m.gewerk].push(m);
          }
          setMaterialDetails(details);
          setMaterialGewerke(
            [...matMap.entries()]
              .map(([gewerk, material_summe]) => ({ gewerk, gewerk_nr: gwMap.get(gewerk)?.gewerk_nr ?? '', material_summe }))
              .sort((a, b) => comparePositionNr(a.gewerk_nr || null, b.gewerk_nr || null))
          );
        }
      }
    }

    const [{ data: anschlussRows }, { data: positionen }] = await Promise.all([
      supabase.from('kosten_manuell').select('schluessel, betrag'),
      supabase.from('kosten_positionen').select('id, kategorie, bezeichnung, betrag').order('created_at', { ascending: true }),
    ]);

    if (anschlussRows) {
      const geladen: Partial<AnschlussKosten> = {};
      const eingaben: Record<string, string> = {};
      for (const row of anschlussRows) {
        if (row.schluessel in LEER_ANSCHLUESSE) {
          (geladen as Record<string, number>)[row.schluessel] = row.betrag ?? 0;
          eingaben[row.schluessel] = row.betrag ? formatGermanNumber(row.betrag) : '';
        }
      }
      setAnschluesse({ ...LEER_ANSCHLUESSE, ...geladen });
      setAnschlussEingaben(eingaben);
    }

    if (positionen) {
      const grouped: Record<string, KostenPosition[]> = {};
      for (const p of positionen as KostenPosition[]) {
        if (!grouped[p.kategorie]) grouped[p.kategorie] = [];
        grouped[p.kategorie].push(p);
      }
      setKostenPositionen(grouped);
    }

    setLaden(false);
  }

  async function anschlussGeaendert(schluessel: keyof AnschlussKosten, rohwert: string) {
    setAnschlussEingaben(prev => ({ ...prev, [schluessel]: rohwert }));
    const betrag = parseGermanNumber(rohwert) ?? 0;
    setAnschluesse(prev => ({ ...prev, [schluessel]: betrag }));

    if (speicherTimeout.current) clearTimeout(speicherTimeout.current);
    speicherTimeout.current = setTimeout(async () => {
      setSpeichern(true);
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('kosten_manuell').upsert({ user_id: user?.id, schluessel, betrag }, { onConflict: 'user_id,schluessel' });
      setSpeichern(false);
    }, 800);
  }

  function bearbeitungStarten(pos: KostenPosition) {
    setBearbeitungId(pos.id);
    setBearbeitungKategorie(pos.kategorie as Kategorie);
    setNeuForm(prev => ({
      ...prev,
      [pos.kategorie]: { bezeichnung: pos.bezeichnung, betrag: formatGermanNumber(pos.betrag) },
    }));
  }

  function bearbeitungAbbrechen() {
    if (bearbeitungKategorie) setNeuForm(prev => ({ ...prev, [bearbeitungKategorie]: LEER_FORM }));
    setBearbeitungId(null);
    setBearbeitungKategorie(null);
  }

  async function positionHinzufuegen(kategorie: Kategorie) {
    const f = neuForm[kategorie] ?? LEER_FORM;
    if (!f.bezeichnung.trim()) return;
    const betrag = parseGermanNumber(f.betrag) ?? 0;
    if (betrag <= 0) return;

    if (bearbeitungId) {
      const { data, error } = await supabase
        .from('kosten_positionen')
        .update({ bezeichnung: f.bezeichnung.trim(), betrag })
        .eq('id', bearbeitungId)
        .select().single();
      if (!error && data) {
        setKostenPositionen(prev => ({
          ...prev,
          [kategorie]: (prev[kategorie] ?? []).map(p => p.id === bearbeitungId ? data as KostenPosition : p),
        }));
        setNeuForm(prev => ({ ...prev, [kategorie]: LEER_FORM }));
        setBearbeitungId(null);
        setBearbeitungKategorie(null);
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('kosten_positionen')
        .insert({ user_id: user?.id, kategorie, bezeichnung: f.bezeichnung.trim(), betrag })
        .select().single();

      if (!error && data) {
        setKostenPositionen(prev => ({ ...prev, [kategorie]: [...(prev[kategorie] ?? []), data as KostenPosition] }));
        setNeuForm(prev => ({ ...prev, [kategorie]: LEER_FORM }));
      }
    }
  }

  async function positionLoeschen(id: string, kategorie: Kategorie) {
    await supabase.from('kosten_positionen').delete().eq('id', id);
    setKostenPositionen(prev => ({ ...prev, [kategorie]: (prev[kategorie] ?? []).filter(p => p.id !== id) }));
  }

  const eigenleistungGesamt = eigenleistungGewerke.reduce((s, g) => s + g.eigenleistung_summe, 0);
  const brutto = version?.nettosumme ? (version.nettosumme - eigenleistungGesamt) * 1.19 : 0;
  const grundstueckspreis = parseGermanNumber(grundstueckspreisEingabe) ?? 0;
  const vorschlagNebenkosten = grundstueckspreis > 0 ? Math.round(grundstueckspreis * 0.055 * 100) / 100 : 0;
  const vorschlagNotar = grundstueckspreis > 0 ? Math.round((grundstueckspreis + brutto) * 0.015 * 100) / 100 : 0;
  const materialGesamt = materialGewerke.reduce((s, g) => s + g.material_summe, 0);
  const anschluesseGesamt = Object.values(anschluesse).reduce((s, v) => s + v, 0);
  const positionenGesamt = Object.values(kostenPositionen).flat().reduce((s, p) => s + p.betrag, 0);
  const manuelleGesamt = anschluesseGesamt + positionenGesamt;
  const gesamtFinanzierung = brutto + materialGesamt + manuelleGesamt;

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 print:hidden">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Gesamtkostenübersicht</h2>
        <div className="flex items-center gap-3">
          {speichern && <span className="text-xs text-gray-400">Speichert...</span>}
          <button onClick={() => window.print()}
            className="text-sm text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors">
            Drucken / PDF
          </button>
        </div>
      </div>

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
                  Netto: {formatEuro((version?.nettosumme ?? 0) - eigenleistungGesamt)}
                </td>
              </tr>
            )}

            {/* Eigenleistung Materialkosten */}
            {materialGewerke.length > 0 && (
              <>
                <tr className="bg-orange-50/50 dark:bg-orange-900/10">
                  <td className="px-6 py-4 font-semibold text-gray-800 dark:text-white">
                    Eigenleistung Materialkosten
                    <span className="ml-2 text-xs font-normal text-gray-400">(eigene Materialien)</span>
                  </td>
                  <td className="px-6 py-4 text-right font-semibold text-orange-600 dark:text-orange-400">{formatEuro(materialGesamt)}</td>
                </tr>
                {materialGewerke.map(g => {
                  const isOffen = aufgeklappteGewerke.has(g.gewerk);
                  const items = materialDetails[g.gewerk] ?? [];
                  return (
                    <Fragment key={g.gewerk}>
                      <tr
                        className="cursor-pointer hover:bg-orange-50/50 dark:hover:bg-orange-900/10 print:cursor-auto"
                        onClick={() => setAufgeklappteGewerke(prev => {
                          const next = new Set(prev);
                          isOffen ? next.delete(g.gewerk) : next.add(g.gewerk);
                          return next;
                        })}
                      >
                        <td className="px-6 py-2 pl-10 text-gray-600 dark:text-gray-300">
                          <span className="text-gray-300 dark:text-gray-600 mr-2 text-xs print:hidden">{isOffen ? '▼' : '▶'}</span>
                          <span className="text-xs text-gray-400 mr-2 font-mono">{g.gewerk_nr}</span>{g.gewerk === '__frei__' ? 'Zusätzliche Eigenleistungen' : g.gewerk}
                        </td>
                        <td className="px-6 py-2 text-right text-orange-600 dark:text-orange-400">{formatEuro(g.material_summe)}</td>
                      </tr>
                      {items.map(m => (
                        <tr key={m.id} className={`${isOffen ? 'table-row' : 'hidden'} print:table-row bg-orange-50/30 dark:bg-orange-900/5`}>
                          <td className="px-6 py-1 pl-16 text-xs text-gray-500 dark:text-gray-400">
                            {m.bezeichnung}
                            {m.menge != null && <span className="ml-1 text-gray-400">{m.menge} {m.einheit ?? ''}</span>}
                          </td>
                          <td className="px-6 py-1 text-right text-xs text-orange-500 dark:text-orange-400">{formatEuro(m.gesamtpreis)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </>
            )}

            {/* Weitere Kosten — Header */}
            <tr><td colSpan={2} className="px-6 py-2 bg-gray-50 dark:bg-gray-700/50 text-xs font-semibold text-gray-400 uppercase tracking-wide">Weitere Kosten</td></tr>

            {/* Pauschale-Hilfe */}
            <tr className="print:hidden bg-amber-50/50 dark:bg-amber-900/10">
              <td colSpan={2} className="px-6 py-3">
                <div className="flex items-center gap-4 flex-wrap">
                  <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Pauschale berechnen (Hamburg):</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Grundstückspreis</span>
                    <input type="text" value={grundstueckspreisEingabe} onChange={e => setGrundstueckspreisEingabe(e.target.value)} placeholder="z.B. 300.000"
                      className="w-36 text-right text-sm border border-amber-200 dark:border-amber-700 rounded-lg px-3 py-1 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                    <span className="text-xs text-gray-400">€</span>
                  </div>
                  {grundstueckspreis > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setNeuForm(prev => ({ ...prev, nebenkosten: { bezeichnung: 'Grunderwerbsteuer (5,5 %)', betrag: formatGermanNumber(vorschlagNebenkosten) } }))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 transition-colors"
                        title="Grunderwerbsteuer Hamburg: 5,5 % vom Grundstückspreis">
                        Nebenkosten {formatEuro(vorschlagNebenkosten)} vorschlagen
                      </button>
                      <button
                        onClick={() => setNeuForm(prev => ({ ...prev, notar: { bezeichnung: 'Notar & Grundbuch (1,5 %)', betrag: formatGermanNumber(vorschlagNotar) } }))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 transition-colors"
                        title="Notar + Grundbuch: 1,5 % von Grundstück + Baukosten">
                        Notar {formatEuro(vorschlagNotar)} vorschlagen
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>

            {/* Dynamische Kategorien mit Unterpunkten (ohne Sonstiges — kommt nach Anschlüsse) */}
            {KATEGORIEN.filter(k => k !== 'sonstiges').map(key => {
              const positionen = kostenPositionen[key] ?? [];
              const summe = positionen.reduce((s, p) => s + p.betrag, 0);
              const form = neuForm[key] ?? LEER_FORM;

              return (
                <Fragment key={key}>
                  <tr>
                    <td className="px-6 py-3 font-medium text-gray-700 dark:text-gray-200">{KATEGORIEN_NAMEN[key]}</td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-300">
                      {summe > 0 ? formatEuro(summe) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                  </tr>
                  {positionen.map(pos => (
                    <tr key={pos.id} className={bearbeitungId === pos.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}>
                      <td className="px-6 py-1.5 pl-10 text-xs text-gray-500 dark:text-gray-400">{pos.bezeichnung}</td>
                      <td className="px-6 py-1.5 text-right text-xs text-gray-600 dark:text-gray-300">
                        {formatEuro(pos.betrag)}
                        <button onClick={() => bearbeitungStarten(pos)}
                          className="ml-2 text-gray-300 hover:text-amber-500 transition-colors print:hidden" title="Bearbeiten">✎</button>
                        <button onClick={() => positionLoeschen(pos.id, key)}
                          className="ml-1 text-gray-300 hover:text-red-400 transition-colors print:hidden">×</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="print:hidden">
                    <td colSpan={2} className="px-6 pb-3 pl-10">
                      <div className="flex items-center gap-2">
                        <input type="text" value={form.bezeichnung}
                          onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, bezeichnung: e.target.value } }))}
                          onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                          placeholder="Bezeichnung"
                          className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                        <input type="text" value={form.betrag}
                          onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, betrag: e.target.value } }))}
                          onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                          placeholder="0,00"
                          className="w-28 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                        <span className="text-xs text-gray-400">€</span>
                        {bearbeitungId && bearbeitungKategorie === key && (
                          <button onClick={bearbeitungAbbrechen}
                            className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap">
                            Abbrechen
                          </button>
                        )}
                        <button onClick={() => positionHinzufuegen(key)}
                          disabled={!form.bezeichnung.trim() || (parseGermanNumber(form.betrag) ?? 0) <= 0}
                          className={`text-xs disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap ${bearbeitungId && bearbeitungKategorie === key ? 'text-amber-500 hover:text-amber-700 dark:hover:text-amber-400' : 'text-blue-500 hover:text-blue-700 dark:hover:text-blue-400'}`}>
                          {bearbeitungId && bearbeitungKategorie === key ? 'Speichern' : '+ Hinzufügen'}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}

            {/* Anschlüsse (feste Unterpunkte) */}
            <tr>
              <td className="px-6 py-3 font-medium text-gray-700 dark:text-gray-200">
                Anschlüsse <span className="ml-2 text-xs font-normal text-gray-400">(Strom, Wasser, Siel, Telekom)</span>
              </td>
              <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-300">
                {anschluesseGesamt > 0 ? formatEuro(anschluesseGesamt) : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </td>
            </tr>
            {(Object.keys(ANSCHLUSS_NAMEN) as (keyof AnschlussKosten)[]).map(key => (
              <tr key={key}>
                <td className="px-6 py-2 pl-10 text-gray-500 dark:text-gray-400">{ANSCHLUSS_NAMEN[key]}</td>
                <td className="px-6 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <input type="text" value={anschlussEingaben[key] ?? ''} onChange={e => anschlussGeaendert(key, e.target.value)}
                      placeholder="0,00"
                      className="w-36 text-right text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 print:border-0 print:bg-transparent" />
                    <span className="text-gray-400 text-xs print:hidden">€</span>
                  </div>
                </td>
              </tr>
            ))}

            {/* Sonstiges (immer letzter Punkt vor Gesamtsumme) */}
            {(() => {
              const key = 'sonstiges' as const;
              const positionen = kostenPositionen[key] ?? [];
              const summe = positionen.reduce((s, p) => s + p.betrag, 0);
              const form = neuForm[key] ?? LEER_FORM;
              return (
                <Fragment key={key}>
                  <tr>
                    <td className="px-6 py-3 font-medium text-gray-700 dark:text-gray-200">{KATEGORIEN_NAMEN[key]}</td>
                    <td className="px-6 py-3 text-right text-gray-600 dark:text-gray-300">
                      {summe > 0 ? formatEuro(summe) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                  </tr>
                  {positionen.map(pos => (
                    <tr key={pos.id} className={bearbeitungId === pos.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}>
                      <td className="px-6 py-1.5 pl-10 text-xs text-gray-500 dark:text-gray-400">{pos.bezeichnung}</td>
                      <td className="px-6 py-1.5 text-right text-xs text-gray-600 dark:text-gray-300">
                        {formatEuro(pos.betrag)}
                        <button onClick={() => bearbeitungStarten(pos)}
                          className="ml-2 text-gray-300 hover:text-amber-500 transition-colors print:hidden" title="Bearbeiten">✎</button>
                        <button onClick={() => positionLoeschen(pos.id, key)}
                          className="ml-1 text-gray-300 hover:text-red-400 transition-colors print:hidden">×</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="print:hidden">
                    <td colSpan={2} className="px-6 pb-3 pl-10">
                      <div className="flex items-center gap-2">
                        <input type="text" value={form.bezeichnung}
                          onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, bezeichnung: e.target.value } }))}
                          onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                          placeholder="Bezeichnung"
                          className="flex-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                        <input type="text" value={form.betrag}
                          onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, betrag: e.target.value } }))}
                          onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                          placeholder="0,00"
                          className="w-28 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                        <span className="text-xs text-gray-400">€</span>
                        {bearbeitungId && bearbeitungKategorie === key && (
                          <button onClick={bearbeitungAbbrechen}
                            className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap">
                            Abbrechen
                          </button>
                        )}
                        <button onClick={() => positionHinzufuegen(key)}
                          disabled={!form.bezeichnung.trim() || (parseGermanNumber(form.betrag) ?? 0) <= 0}
                          className={`text-xs disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap ${bearbeitungId && bearbeitungKategorie === key ? 'text-amber-500 hover:text-amber-700 dark:hover:text-amber-400' : 'text-blue-500 hover:text-blue-700 dark:hover:text-blue-400'}`}>
                          {bearbeitungId && bearbeitungKategorie === key ? 'Speichern' : '+ Hinzufügen'}
                        </button>
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })()}

            {/* Gesamtsumme */}
            <tr className="bg-gray-900 dark:bg-gray-950 print:bg-gray-100">
              <td className="px-6 py-5 font-bold text-white print:text-gray-900 text-base">
                Gesamtfinanzierungsbedarf
                <div className="text-xs font-normal text-gray-400 mt-0.5">Hauskosten + Materialkosten + Weitere Kosten</div>
              </td>
              <td className="px-6 py-5 text-right font-bold text-white print:text-gray-900 text-xl">
                {formatEuro(gesamtFinanzierung)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
