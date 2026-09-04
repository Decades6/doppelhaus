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

const KATEGORIEN = ['planung', 'versicherungen', 'nebenkosten', 'notar', 'baustelle', 'erdarbeiten', 'vermessung', 'aussenanlagen', 'kueche', 'maschinen', 'sonstiges'] as const;
type Kategorie = typeof KATEGORIEN[number];

const KATEGORIEN_NAMEN: Record<Kategorie, string> = {
  planung: 'Planung & Genehmigung',
  versicherungen: 'Versicherungen',
  nebenkosten: 'Erschließung & Abgaben',
  notar: 'Notar & Grundbuch',
  baustelle: 'Baustelle',
  erdarbeiten: 'Erdarbeiten',
  vermessung: 'Vermessung',
  aussenanlagen: 'Außenanlagen',
  kueche: 'Küche',
  maschinen: 'Maschinen und Werkzeug',
  sonstiges: 'Sonstiges',
};

const BAUNEBENKOSTEN_KEYS: readonly Kategorie[] = ['planung', 'versicherungen', 'nebenkosten', 'notar', 'baustelle', 'erdarbeiten', 'vermessung'];
const WEITERE_KOSTEN_KEYS: readonly Kategorie[] = ['kueche', 'maschinen', 'sonstiges'];

interface KostenPosition {
  id: string;
  kategorie: string;
  bezeichnung: string;
  betrag: number;
  menge?: string | null;
  unterkategorie?: string | null;
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


const LEER_FORM = { bezeichnung: '', betrag: '', menge: '', einzelpreis: '', unterkategorie: '' };

function Ampel({ bezahlt, gesamt }: { bezahlt: number; gesamt: number }) {
  if (gesamt <= 0) return null;
  const color = bezahlt >= gesamt ? 'bg-green-500' : bezahlt > 0 ? 'bg-yellow-400' : 'bg-red-500';
  const title = bezahlt >= gesamt ? 'Vollständig bezahlt' : bezahlt > 0 ? 'Teilweise bezahlt' : 'Noch nicht bezahlt';
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} title={title} />;
}

export default function KostenTab() {
  const [version, setVersion] = useState<Version | null>(null);
  const [eigenleistungGewerke, setEigenleistungGewerke] = useState<EigenleistungGewerk[]>([]);
  const [materialGewerke, setMaterialGewerke] = useState<MaterialGewerk[]>([]);
  const [anschluesse, setAnschluesse] = useState<AnschlussKosten>(LEER_ANSCHLUESSE);
  const [anschlussEingaben, setAnschlussEingaben] = useState<Record<string, string>>({});
  const [kostenPositionen, setKostenPositionen] = useState<Record<string, KostenPosition[]>>({});
  const [neuForm, setNeuForm] = useState<Record<string, { bezeichnung: string; betrag: string; menge: string; einzelpreis: string; unterkategorie: string }>>({});
  const [materialDetails, setMaterialDetails] = useState<Record<string, EigenleistungMaterial[]>>({});
  const [aufgeklappteGewerke, setAufgeklappteGewerke] = useState<Set<string>>(new Set());
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [bearbeitungId, setBearbeitungId] = useState<string | null>(null);
  const [bearbeitungKategorie, setBearbeitungKategorie] = useState<Kategorie | null>(null);
  const [editBezeichnung, setEditBezeichnung] = useState('');
  const [editUnterkategorie, setEditUnterkategorie] = useState('');
  const [editBetrag, setEditBetrag] = useState('');
  const [editMenge, setEditMenge] = useState('');
  const [editEinzelpreis, setEditEinzelpreis] = useState('');
  const [speichertEdit, setSpeichertEdit] = useState(false);
  const [editFehler, setEditFehler] = useState('');
  const [grundstueckspreisEingabe, setGrundstueckspreisEingabe] = useState('');
  const speicherTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bezahltNachBeschreibung, setBezahltNachBeschreibung] = useState<Record<string, number>>({});
  const [bezahltNachKategorie, setBezahltNachKategorie] = useState<Record<string, number>>({});

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

    const [{ data: anschlussRows }, { data: positionen }, { data: z }] = await Promise.all([
      supabase.from('kosten_manuell').select('schluessel, betrag'),
      supabase.from('kosten_positionen').select('id, kategorie, bezeichnung, betrag, menge, unterkategorie').order('created_at', { ascending: true }),
      supabase.from('zahlungen').select('beschreibung, kategorie, betrag'),
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

    if (z) {
      const beschMap: Record<string, number> = {};
      const katMap: Record<string, number> = {};
      for (const zahlung of z as { beschreibung: string; kategorie: string; betrag: number }[]) {
        const key = zahlung.beschreibung.trim().toLowerCase();
        beschMap[key] = (beschMap[key] ?? 0) + zahlung.betrag;
        katMap[zahlung.kategorie] = (katMap[zahlung.kategorie] ?? 0) + zahlung.betrag;
      }
      setBezahltNachBeschreibung(beschMap);
      setBezahltNachKategorie(katMap);
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
    setEditFehler('');
    setEditBezeichnung(pos.bezeichnung);
    setEditUnterkategorie(pos.unterkategorie ?? '');
    setEditBetrag(formatGermanNumber(pos.betrag));
    const menge = pos.menge ?? '';
    setEditMenge(menge);
    const mengeNum = parseFloat(menge.replace(',', '.'));
    const einzelpreis = (pos.kategorie === 'maschinen' || pos.kategorie === 'sonstiges') && !isNaN(mengeNum) && mengeNum > 0
      ? formatGermanNumber(pos.betrag / mengeNum)
      : '';
    setEditEinzelpreis(einzelpreis);
  }

  function editMengeEpAendern(feld: 'menge' | 'einzelpreis', wert: string) {
    const neueMenge = feld === 'menge' ? wert : editMenge;
    const neuerEp = feld === 'einzelpreis' ? wert : editEinzelpreis;
    if (feld === 'menge') setEditMenge(wert); else setEditEinzelpreis(wert);
    const m = parseFloat(neueMenge.replace(',', '.'));
    const ep = parseFloat(neuerEp.replace(',', '.'));
    if (!isNaN(m) && m > 0 && !isNaN(ep) && ep > 0) {
      setEditBetrag((m * ep).toFixed(2).replace('.', ','));
    } else if (!isNaN(ep) && ep > 0) {
      setEditBetrag(feld === 'einzelpreis' ? wert : neuerEp);
    }
  }

  function mengeEpAendern(key: string, feld: 'menge' | 'einzelpreis', wert: string) {
    setNeuForm(prev => {
      const aktuell = prev[key] ?? LEER_FORM;
      const neu = { ...aktuell, [feld]: wert };
      const m = parseFloat((feld === 'menge' ? wert : neu.menge).replace(',', '.'));
      const ep = parseFloat((feld === 'einzelpreis' ? wert : neu.einzelpreis).replace(',', '.'));
      if (!isNaN(m) && m > 0 && !isNaN(ep) && ep > 0) {
        neu.betrag = (m * ep).toFixed(2).replace('.', ',');
      } else if (!isNaN(ep) && ep > 0) {
        neu.betrag = feld === 'einzelpreis' ? wert : neu.einzelpreis;
      }
      return { ...prev, [key]: neu };
    });
  }

  function bearbeitungAbbrechen() {
    setBearbeitungId(null);
    setBearbeitungKategorie(null);
    setEditFehler('');
  }

  async function positionAktualisieren() {
    if (!bearbeitungId || !bearbeitungKategorie) return;
    if (!editBezeichnung.trim()) return;
    const betrag = parseGermanNumber(editBetrag) ?? 0;
    if (betrag <= 0) return;

    const id = bearbeitungId;
    const kategorie = bearbeitungKategorie;
    const menge = editMenge.trim() || null;
    const unterkategorie = editUnterkategorie.trim() || null;

    setSpeichertEdit(true);
    setEditFehler('');

    const { data, error } = await supabase
      .from('kosten_positionen')
      .update({ bezeichnung: editBezeichnung.trim(), betrag, menge, unterkategorie })
      .eq('id', id)
      .select('id, kategorie, bezeichnung, betrag, menge, unterkategorie')
      .maybeSingle();

    setSpeichertEdit(false);

    if (error) {
      console.error('Kosten speichern fehlgeschlagen:', error);
      setEditFehler(error.message || 'Speichern fehlgeschlagen.');
      return;
    }
    if (!data) {
      console.error('Kosten speichern: Update betraf 0 Zeilen (vermutlich RLS-Berechtigung) für id', id);
      setEditFehler('Speichern fehlgeschlagen: keine Berechtigung, diese Position zu ändern.');
      return;
    }

    setKostenPositionen(prev => ({
      ...prev,
      [kategorie]: (prev[kategorie] ?? []).map(p => p.id === id ? data as KostenPosition : p),
    }));
    setBearbeitungId(null);
    setBearbeitungKategorie(null);
  }

  async function positionHinzufuegen(kategorie: Kategorie) {
    const f = neuForm[kategorie] ?? LEER_FORM;
    if (!f.bezeichnung.trim()) return;
    const betrag = parseGermanNumber(f.betrag) ?? 0;
    if (betrag <= 0) return;

    const menge = f.menge?.trim() || null;
    const unterkategorie = f.unterkategorie?.trim() || null;

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('kosten_positionen')
      .insert({ user_id: user?.id, kategorie, bezeichnung: f.bezeichnung.trim(), betrag, menge, unterkategorie })
      .select().single();

    if (!error && data) {
      setKostenPositionen(prev => ({ ...prev, [kategorie]: [...(prev[kategorie] ?? []), data as KostenPosition] }));
      setNeuForm(prev => ({ ...prev, [kategorie]: LEER_FORM }));
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
  const gesamtStunden = Object.values(materialDetails).flat().reduce((s, m) => s + (m.zeitaufwand_stunden ?? 0), 0);
  const baunebenkostenPositionen = BAUNEBENKOSTEN_KEYS.reduce((s, k) => s + (kostenPositionen[k] ?? []).reduce((ss, p) => ss + p.betrag, 0), 0);
  const baunebenkostenGesamt = baunebenkostenPositionen + anschluesseGesamt;
  const aussenanlagenGesamt = (kostenPositionen['aussenanlagen'] ?? []).reduce((s, p) => s + p.betrag, 0);
  const weitereKostenGesamt = WEITERE_KOSTEN_KEYS.reduce((s, k) => s + (kostenPositionen[k] ?? []).reduce((ss, p) => ss + p.betrag, 0), 0);
  const gesamtFinanzierung = brutto + materialGesamt + baunebenkostenGesamt + aussenanlagenGesamt + weitereKostenGesamt;

  function renderKategorie(key: Kategorie) {
    const pos = kostenPositionen[key] ?? [];
    const summe = pos.reduce((s, p) => s + p.betrag, 0);
    const form = neuForm[key] ?? LEER_FORM;
    const vorhandeneGruppen = [...new Set(pos.map(p => p.unterkategorie).filter(Boolean) as string[])];
    const ohneGruppe = pos.filter(p => !p.unterkategorie);
    const hatGruppen = vorhandeneGruppen.length > 0;
    const ohneGruppeSumme = ohneGruppe.reduce((s, p) => s + p.betrag, 0);

    const renderPosition = (p: KostenPosition) => {
      if (bearbeitungId === p.id) {
        return (
          <tr key={p.id} className="bg-amber-50 dark:bg-amber-900/20">
            <td colSpan={2} className="px-6 py-2 pl-14">
              <div className="flex items-center gap-2 flex-wrap">
                <input type="text" value={editBezeichnung}
                  onChange={e => setEditBezeichnung(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                  placeholder="Bezeichnung"
                  className="flex-1 min-w-32 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                <input type="text" value={editUnterkategorie}
                  list={`gruppen-${key}`}
                  onChange={e => setEditUnterkategorie(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                  placeholder="Kategorie (optional)"
                  className="w-36 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                <input type="text" value={editBetrag}
                  onChange={e => setEditBetrag(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                  placeholder="0,00"
                  className="w-24 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                <span className="text-xs text-gray-400">€</span>
                <button onClick={bearbeitungAbbrechen} disabled={speichertEdit} className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors whitespace-nowrap">Abbrechen</button>
                <button onClick={positionAktualisieren}
                  disabled={speichertEdit || !editBezeichnung.trim() || (parseGermanNumber(editBetrag) ?? 0) <= 0}
                  className="text-xs text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                  {speichertEdit ? 'Speichert...' : 'Speichern'}
                </button>
                {editFehler && <span className="text-xs text-red-600 dark:text-red-400 basis-full">{editFehler}</span>}
              </div>
            </td>
          </tr>
        );
      }
      return (
        <tr key={p.id} className="print-kein-trennstrich">
          <td className="px-6 py-1.5 pl-14 text-xs text-gray-500 dark:text-gray-400">{p.bezeichnung}</td>
          <td className="px-6 py-1.5 text-right text-xs text-gray-600 dark:text-gray-300">
            <span className="inline-flex items-center justify-end gap-2">
              <Ampel bezahlt={bezahltNachBeschreibung[p.bezeichnung.trim().toLowerCase()] ?? 0} gesamt={p.betrag} />
              {formatEuro(p.betrag)}
            </span>
            <button onClick={() => bearbeitungStarten(p)} className="ml-2 text-gray-300 hover:text-amber-500 transition-colors print:hidden" title="Bearbeiten">✎</button>
            <button onClick={() => positionLoeschen(p.id, key)} className="ml-1 text-gray-300 hover:text-red-400 transition-colors print:hidden">×</button>
          </td>
        </tr>
      );
    };

    return (
      <Fragment key={key}>
        {/* Kategorie-Zeile: zeigt ungrouped-Summe wenn Gruppen vorhanden, sonst Gesamt */}
        {(!hatGruppen || ohneGruppe.length > 0) && (
          <tr>
            <td className="px-6 py-2.5 pl-8 font-medium text-sm text-gray-700 dark:text-gray-200">{KATEGORIEN_NAMEN[key]}</td>
            <td className="px-6 py-2.5 text-right text-gray-600 dark:text-gray-300">
              {(hatGruppen ? ohneGruppeSumme : summe) > 0 ? (
                <span className="inline-flex items-center justify-end gap-2">
                  <Ampel bezahlt={bezahltNachKategorie[KATEGORIEN_NAMEN[key]] ?? 0} gesamt={hatGruppen ? ohneGruppeSumme : summe} />
                  {formatEuro(hatGruppen ? ohneGruppeSumme : summe)}
                </span>
              ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
            </td>
          </tr>
        )}

        {/* Einträge ohne Gruppe */}
        {ohneGruppe.map(p => renderPosition(p))}

        {/* Gruppen auf gleicher Ebene wie Kategorie-Zeile */}
        {vorhandeneGruppen.map(gruppe => {
          const gruppenPos = pos.filter(p => p.unterkategorie === gruppe);
          const gruppenSumme = gruppenPos.reduce((s, p) => s + p.betrag, 0);
          return (
            <Fragment key={gruppe}>
              <tr>
                <td className="px-6 py-2.5 pl-8 font-medium text-sm text-gray-700 dark:text-gray-200">{gruppe}</td>
                <td className="px-6 py-2.5 text-right text-gray-600 dark:text-gray-300">
                  {gruppenSumme > 0 ? formatEuro(gruppenSumme) : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
              </tr>
              {gruppenPos.map(p => renderPosition(p))}
            </Fragment>
          );
        })}

        {/* Formular */}
        <tr className="print:hidden">
          <td colSpan={2} className="px-6 pb-2.5 pl-8">
            <div className="flex items-center gap-2 flex-wrap">
              <input type="text" value={form.bezeichnung}
                onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, bezeichnung: e.target.value } }))}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="Bezeichnung"
                className="flex-1 min-w-32 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <input type="text" value={form.unterkategorie}
                list={`gruppen-${key}`}
                onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, unterkategorie: e.target.value } }))}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="Kategorie (optional)"
                className="w-36 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <datalist id={`gruppen-${key}`}>
                {vorhandeneGruppen.map(g => <option key={g} value={g} />)}
              </datalist>
              <input type="text" value={form.betrag}
                onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, betrag: e.target.value } }))}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="0,00"
                className="w-24 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <span className="text-xs text-gray-400">€</span>
              <button onClick={() => positionHinzufuegen(key)}
                disabled={!form.bezeichnung.trim() || (parseGermanNumber(form.betrag) ?? 0) <= 0}
                className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                + Hinzufügen
              </button>
            </div>
          </td>
        </tr>
      </Fragment>
    );
  }

  function renderMengeEpKategorie(key: 'maschinen' | 'sonstiges') {
    const pos = kostenPositionen[key] ?? [];
    const summe = pos.reduce((s, p) => s + p.betrag, 0);
    const form = neuForm[key] ?? LEER_FORM;
    return (
      <Fragment key={key}>
        <tr>
          <td className="px-6 py-2.5 pl-8 font-medium text-sm text-gray-700 dark:text-gray-200">{KATEGORIEN_NAMEN[key]}</td>
          <td className="px-6 py-2.5 text-right text-gray-600 dark:text-gray-300">
            {summe > 0 ? (
              <span className="inline-flex items-center justify-end gap-2">
                <Ampel bezahlt={bezahltNachKategorie[KATEGORIEN_NAMEN[key]] ?? 0} gesamt={summe} />
                {formatEuro(summe)}
              </span>
            ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
          </td>
        </tr>
        {pos.map(p => {
          if (bearbeitungId === p.id) {
            return (
              <tr key={p.id} className="bg-amber-50 dark:bg-amber-900/20">
                <td colSpan={2} className="px-6 py-2 pl-14">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input type="text" value={editBezeichnung}
                      onChange={e => setEditBezeichnung(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                      placeholder="Bezeichnung"
                      className="flex-1 min-w-40 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                    <input type="text" value={editMenge}
                      onChange={e => editMengeEpAendern('menge', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                      placeholder="Menge"
                      className="w-16 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                    <span className="text-xs text-gray-400">×</span>
                    <input type="text" value={editEinzelpreis}
                      onChange={e => editMengeEpAendern('einzelpreis', e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && positionAktualisieren()}
                      placeholder="EP"
                      className="w-24 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-amber-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
                    <span className="text-xs text-gray-400">€</span>
                    {editBetrag && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">= {editBetrag} €</span>}
                    <button onClick={bearbeitungAbbrechen} disabled={speichertEdit} className="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:border-gray-400 disabled:opacity-50 transition-colors whitespace-nowrap">Abbrechen</button>
                    <button onClick={positionAktualisieren}
                      disabled={speichertEdit || !editBezeichnung.trim() || (parseGermanNumber(editBetrag) ?? 0) <= 0}
                      className="text-xs text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                      {speichertEdit ? 'Speichert...' : 'Speichern'}
                    </button>
                    {editFehler && <span className="text-xs text-red-600 dark:text-red-400 basis-full">{editFehler}</span>}
                  </div>
                </td>
              </tr>
            );
          }
          return (
            <tr key={p.id} className="print-kein-trennstrich">
              <td className="px-6 py-1.5 pl-14 text-xs text-gray-500 dark:text-gray-400">
                {p.menge && <span className="mr-1.5 text-gray-400">{p.menge}×</span>}
                {p.bezeichnung}
              </td>
              <td className="px-6 py-1.5 text-right text-xs text-gray-600 dark:text-gray-300">
                <span className="inline-flex items-center justify-end gap-2">
                  <Ampel bezahlt={bezahltNachBeschreibung[p.bezeichnung.trim().toLowerCase()] ?? 0} gesamt={p.betrag} />
                  {formatEuro(p.betrag)}
                </span>
                <button onClick={() => bearbeitungStarten(p)} className="ml-2 text-gray-300 hover:text-amber-500 transition-colors print:hidden" title="Bearbeiten">✎</button>
                <button onClick={() => positionLoeschen(p.id, key)} className="ml-1 text-gray-300 hover:text-red-400 transition-colors print:hidden">×</button>
              </td>
            </tr>
          );
        })}
        <tr className="print:hidden">
          <td colSpan={2} className="px-6 pb-2.5 pl-14">
            <div className="flex items-center gap-2 flex-wrap">
              <input type="text" value={form.bezeichnung}
                onChange={e => setNeuForm(prev => ({ ...prev, [key]: { ...prev[key] ?? LEER_FORM, bezeichnung: e.target.value } }))}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="Bezeichnung"
                className="flex-1 min-w-40 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <input type="text" value={form.menge}
                onChange={e => mengeEpAendern(key, 'menge', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="Menge"
                className="w-16 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <span className="text-xs text-gray-400">×</span>
              <input type="text" value={form.einzelpreis}
                onChange={e => mengeEpAendern(key, 'einzelpreis', e.target.value)}
                onKeyDown={e => e.key === 'Enter' && positionHinzufuegen(key)}
                placeholder="EP"
                className="w-24 text-right text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200" />
              <span className="text-xs text-gray-400">€</span>
              {form.betrag && <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">= {form.betrag} €</span>}
              <button onClick={() => positionHinzufuegen(key)}
                disabled={!form.bezeichnung.trim() || (parseGermanNumber(form.betrag) ?? 0) <= 0}
                className="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-400 disabled:text-gray-300 dark:disabled:text-gray-600 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                + Hinzufügen
              </button>
            </div>
          </td>
        </tr>
      </Fragment>
    );
  }

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
              <th className="px-6 py-3 text-right font-semibold text-gray-700 dark:text-gray-200 w-64">
                <div className="flex items-baseline justify-end">
                  <span className="w-20 text-right mr-3">Arbeitsstunden</span>
                  <span className="w-32 text-right">Betrag</span>
                </div>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">

            {/* Hauskosten */}
            <tr className="bg-blue-50/50 dark:bg-blue-900/10">
              <td className="px-6 py-4 font-semibold text-gray-800 dark:text-white">Hauskosten</td>
              <td className="px-6 py-4 text-right font-semibold text-gray-800 dark:text-white">
                {brutto > 0 ? (
                  <span className="inline-flex items-center justify-end gap-2">
                    <Ampel bezahlt={bezahltNachKategorie['Bauträger'] ?? 0} gesamt={brutto} />
                    {formatEuro(brutto)}
                  </span>
                ) : <span className="text-gray-400 text-xs">Kein Angebot geladen</span>}
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
                  <td className="px-6 py-4 text-right font-semibold text-orange-600 dark:text-orange-400">
                    <div className="flex items-baseline justify-end">
                      <span className="w-20 text-right text-xs font-normal text-purple-500 dark:text-purple-400 mr-3">{gesamtStunden > 0 ? `${gesamtStunden.toLocaleString('de-DE')} Std.` : ''}</span>
                      <span className="w-32 text-right">{formatEuro(materialGesamt)}</span>
                    </div>
                  </td>
                </tr>
                {materialGewerke.map(g => {
                  const isOffen = aufgeklappteGewerke.has(g.gewerk);
                  const items = materialDetails[g.gewerk] ?? [];
                  const gwStunden = items.reduce((s, m) => s + (m.zeitaufwand_stunden ?? 0), 0);
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
                        <td className="px-6 py-2 text-right text-orange-600 dark:text-orange-400">
                          <div className="flex items-baseline justify-end">
                            <span className="w-20 text-right text-xs text-purple-400 mr-3">{gwStunden > 0 ? `${gwStunden.toLocaleString('de-DE')} Std.` : ''}</span>
                            <span className="w-32 text-right">{formatEuro(g.material_summe)}</span>
                          </div>
                        </td>
                      </tr>
                      {items.map(m => (
                        <tr key={m.id} className={`${isOffen ? 'table-row' : 'hidden'} print:table-row print-kein-trennstrich bg-orange-50/30 dark:bg-orange-900/5`}>
                          <td className="px-6 py-1 pl-16 text-xs text-gray-500 dark:text-gray-400">
                            {m.bezeichnung}
                            {m.menge != null && <span className="ml-1 text-gray-400">{m.menge} {m.einheit ?? ''}</span>}
                          </td>
                          <td className="px-6 py-1 text-right text-xs text-orange-500 dark:text-orange-400">
                            <div className="flex items-baseline justify-end">
                              <span className="w-20 text-right text-xs text-purple-400 mr-3">{m.zeitaufwand_stunden != null ? `${m.zeitaufwand_stunden} Std.` : ''}</span>
                              <span className="w-32 text-right">{formatEuro(m.gesamtpreis)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </>
            )}

            {/* ══ BAUNEBENKOSTEN ══ */}
            <tr className="bg-gray-100 dark:bg-gray-700/80">
              <td className="px-6 py-3 font-bold text-gray-800 dark:text-white text-sm tracking-wide">Baunebenkosten</td>
              <td className="px-6 py-3 text-right font-bold text-gray-800 dark:text-white">
                {baunebenkostenGesamt > 0 ? formatEuro(baunebenkostenGesamt) : <span className="text-gray-400 font-normal text-xs">—</span>}
              </td>
            </tr>

            {/* Pauschale-Hilfe */}
            <tr className="print:hidden bg-amber-50/50 dark:bg-amber-900/10">
              <td colSpan={2} className="px-6 py-3 pl-8">
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
                        onClick={() => setNeuForm(prev => ({ ...prev, nebenkosten: { bezeichnung: 'Grunderwerbsteuer (5,5 %)', betrag: formatGermanNumber(vorschlagNebenkosten), menge: '', einzelpreis: '', unterkategorie: '' } }))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 transition-colors"
                        title="Grunderwerbsteuer Hamburg: 5,5 % vom Grundstückspreis">
                        Erschließung {formatEuro(vorschlagNebenkosten)} vorschlagen
                      </button>
                      <button
                        onClick={() => setNeuForm(prev => ({ ...prev, notar: { bezeichnung: 'Notar & Grundbuch (1,5 %)', betrag: formatGermanNumber(vorschlagNotar), menge: '', einzelpreis: '', unterkategorie: '' } }))}
                        className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-3 py-1 rounded-full hover:bg-amber-200 transition-colors"
                        title="Notar + Grundbuch: 1,5 % von Grundstück + Baukosten">
                        Notar {formatEuro(vorschlagNotar)} vorschlagen
                      </button>
                    </div>
                  )}
                </div>
              </td>
            </tr>

            {renderKategorie('planung')}
            {renderKategorie('versicherungen')}
            {renderKategorie('nebenkosten')}
            {renderKategorie('notar')}

            {/* Anschlüsse (feste Felder) */}
            <tr>
              <td className="px-6 py-2.5 pl-8 font-medium text-sm text-gray-700 dark:text-gray-200">
                Anschlüsse <span className="ml-2 text-xs font-normal text-gray-400">(Strom, Wasser, Siel, Telekom)</span>
              </td>
              <td className="px-6 py-2.5 text-right text-gray-600 dark:text-gray-300">
                {anschluesseGesamt > 0 ? (
                  <span className="inline-flex items-center justify-end gap-2">
                    <Ampel bezahlt={bezahltNachKategorie['Anschlüsse'] ?? 0} gesamt={anschluesseGesamt} />
                    {formatEuro(anschluesseGesamt)}
                  </span>
                ) : <span className="text-gray-300 dark:text-gray-600">—</span>}
              </td>
            </tr>
            {(Object.keys(ANSCHLUSS_NAMEN) as (keyof AnschlussKosten)[]).map(key => (
              <tr key={key}>
                <td className="px-6 py-2 pl-14 text-xs text-gray-500 dark:text-gray-400">{ANSCHLUSS_NAMEN[key]}</td>
                <td className="px-6 py-2 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Ampel bezahlt={bezahltNachBeschreibung[ANSCHLUSS_NAMEN[key].toLowerCase()] ?? 0} gesamt={anschluesse[key]} />
                    <input type="text" value={anschlussEingaben[key] ?? ''} onChange={e => anschlussGeaendert(key, e.target.value)}
                      placeholder="0,00"
                      className="w-36 text-right text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 print:border-0 print:bg-transparent" />
                    <span className="text-gray-400 text-xs print:hidden">€</span>
                  </div>
                </td>
              </tr>
            ))}

            {renderKategorie('baustelle')}
            {renderKategorie('erdarbeiten')}
            {renderKategorie('vermessung')}

            {/* ══ AUSSENANLAGEN ══ */}
            <tr className="bg-gray-100 dark:bg-gray-700/80">
              <td className="px-6 py-3 font-bold text-gray-800 dark:text-white text-sm tracking-wide">Außenanlagen</td>
              <td className="px-6 py-3 text-right font-bold text-gray-800 dark:text-white">
                {aussenanlagenGesamt > 0 ? formatEuro(aussenanlagenGesamt) : <span className="text-gray-400 font-normal text-xs">—</span>}
              </td>
            </tr>
            {renderKategorie('aussenanlagen')}

            {/* ══ WEITERE KOSTEN ══ */}
            <tr className="bg-gray-100 dark:bg-gray-700/80">
              <td className="px-6 py-3 font-bold text-gray-800 dark:text-white text-sm tracking-wide">Weitere Kosten</td>
              <td className="px-6 py-3 text-right font-bold text-gray-800 dark:text-white">
                {weitereKostenGesamt > 0 ? formatEuro(weitereKostenGesamt) : <span className="text-gray-400 font-normal text-xs">—</span>}
              </td>
            </tr>
            {renderKategorie('kueche')}
            {renderMengeEpKategorie('maschinen')}
            {renderMengeEpKategorie('sonstiges')}

            {/* Gesamtsumme */}
            <tr className="bg-gray-900 dark:bg-gray-950 print:bg-gray-100">
              <td className="px-6 py-5 font-bold text-white print:text-gray-900 text-base">
                Gesamtfinanzierungsbedarf
                <div className="text-xs font-normal text-gray-400 mt-0.5">Hauskosten + Materialkosten + Baunebenkosten + Außenanlagen + Weitere Kosten</div>
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
