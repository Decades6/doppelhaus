'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Zahlung, Rechnung } from '@/lib/types';
import { formatEuro, parseGermanNumber, formatGermanNumber } from '@/lib/utils';
import { erzeugeBankPdf, type Beleg } from '@/lib/bank-pdf';
import { DATEI_ENDUNGEN, bildAlsJpeg, istPdf } from '@/lib/bild';
import { KATEGORIEN_NAMEN, BAUNEBENKOSTEN_KEYS } from '@/components/tabs/KostenTab';
import { ANSCHLUSS_POSTEN } from '@/lib/anschluesse';

// Kategorien, die es nur bei Zahlungen gibt (keine Kostenpositionen-Kategorie).
// "Anschlüsse" wird im Kosten-Tab über genau diesen Namen zugeordnet.
const ZUSATZ_KATEGORIEN = ['Bauträger', 'Material', 'Eigenleistung', 'Anschlüsse'];

// Eine gemeinsame Liste für beide Tabs: nur wenn die Namen identisch sind,
// findet die Ampel im Kosten-Tab die zugehörigen Zahlungen.
const KATEGORIEN = [...ZUSATZ_KATEGORIEN, ...Object.values(KATEGORIEN_NAMEN)];

// Die Anschlüsse liegen in kosten_manuell statt in kosten_positionen. Für die
// Schnellauswahl bekommen sie diese Pseudo-Kategorie, damit sie gruppiert erscheinen.
const ANSCHLUSS_KATEGORIE = '__anschluesse';

/** Kostenpositions-Kategorie (z.B. "kueche") → Zahlungs-Kategoriename (z.B. "Küche") */
function kostenZuZahlung(kategorie: string): string {
  if (kategorie === ANSCHLUSS_KATEGORIE) return 'Anschlüsse';
  return KATEGORIEN_NAMEN[kategorie as keyof typeof KATEGORIEN_NAMEN] ?? 'Sonstiges';
}

interface KostenVorlage { id: string; kategorie: string; bezeichnung: string; betrag: number; }

// Bankrelevant ist alles, was im Kosten-Tab im Gesamtfinanzierungsbedarf steht — ohne
// Grundstück. Alles darunter (Inventar, Weitere Kosten) und das Grundstück selbst nicht.
const BANK_BLOECKE = [
  { id: 'haus',           titel: 'Hauskosten' },
  { id: 'material',       titel: 'Eigenleistung Materialkosten' },
  { id: 'baunebenkosten', titel: 'Baunebenkosten' },
  { id: 'aussenanlagen',  titel: 'Außenanlagen' },
] as const;
type BankBlockId = typeof BANK_BLOECKE[number]['id'];

/** Zahlungs-Kategorie → Block der Bank-PDF; Kategorien, die hier fehlen, sind nicht bankrelevant. */
const BANK_BLOCK_NACH_KATEGORIE: Record<string, BankBlockId> = {
  'Bauträger': 'haus',
  'Material': 'material',
  'Anschlüsse': 'baunebenkosten',
  ...Object.fromEntries(BAUNEBENKOSTEN_KEYS.map(k => [KATEGORIEN_NAMEN[k], 'baunebenkosten' as const])),
  [KATEGORIEN_NAMEN.aussenanlagen]: 'aussenanlagen',
};
interface EigenleistungVorlage { id: string; gewerk: string; bezeichnung: string; gesamtpreis: number; }

function formatDatumDE(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ZahlungenTab() {
  const [zahlungen, setZahlungen] = useState<Zahlung[]>([]);
  const [kostenVorlagen, setKostenVorlagen] = useState<KostenVorlage[]>([]);
  const [eigenleistungVorlagen, setEigenleistungVorlagen] = useState<EigenleistungVorlage[]>([]);
  const [vorlageId, setVorlageId] = useState('');
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [bankPanelOffen, setBankPanelOffen] = useState(false);
  const [bankVon, setBankVon] = useState('');
  const [bankBis, setBankBis] = useState('');
  const [bankMitRechnungen, setBankMitRechnungen] = useState(true);
  const [bankErzeugt, setBankErzeugt] = useState(false);
  const [bankFehler, setBankFehler] = useState('');
  const [rechnungen, setRechnungen] = useState<Record<string, Rechnung[]>>({});
  const [uploadZahlungId, setUploadZahlungId] = useState<string | null>(null);
  const [auswahlZahlungId, setAuswahlZahlungId] = useState<string | null>(null);
  const [vorhandenZahlungId, setVorhandenZahlungId] = useState<string | null>(null);
  const zielZahlungId = useRef<string | null>(null);
  const dateiInput = useRef<HTMLInputElement>(null);
  const kameraInput = useRef<HTMLInputElement>(null);
  const [rechnungFehler, setRechnungFehler] = useState('');
  const [bearbeitungId, setBearbeitungId] = useState<string | null>(null);
  const [form, setForm] = useState({
    datum: new Date().toISOString().split('T')[0],
    beschreibung: '',
    kategorie: 'Bauträger',
    betrag: '',
  });

  useEffect(() => { ladeZahlungen(); }, []);

  async function ladeZahlungen() {
    const [{ data: z }, { data: v }, { data: em }, { data: km }, { data: rg }] = await Promise.all([
      supabase.from('zahlungen').select('*').order('datum', { ascending: false }),
      supabase.from('kosten_positionen').select('id, kategorie, bezeichnung, betrag').order('kategorie').order('bezeichnung'),
      supabase.from('eigenleistung_materialien').select('id, gewerk, bezeichnung, gesamtpreis').order('gewerk').order('bezeichnung'),
      supabase.from('kosten_manuell').select('schluessel, betrag'),
      supabase.from('zahlung_rechnungen').select('*').order('created_at', { ascending: true }),
    ]);
    if (z) setZahlungen(z as Zahlung[]);
    if (rg) {
      const nachZahlung: Record<string, Rechnung[]> = {};
      for (const r of rg as Rechnung[]) (nachZahlung[r.zahlung_id] ??= []).push(r);
      setRechnungen(nachZahlung);
    }

    // Anschlüsse in Vorlagen-Form bringen. Als Bezeichnung dient der eindeutige Name
    // ("Verwaltungsgebühr Sielanschluss") — darüber ordnet die Ampel im Kosten-Tab zu.
    const betragNachSchluessel = new Map(
      ((km ?? []) as { schluessel: string; betrag: number | null }[]).map(r => [r.schluessel, r.betrag ?? 0]),
    );
    const anschlussVorlagen: KostenVorlage[] = ANSCHLUSS_POSTEN
      .filter(p => (betragNachSchluessel.get(p.schluessel) ?? 0) > 0)
      .map(p => ({
        id: p.schluessel,
        kategorie: ANSCHLUSS_KATEGORIE,
        bezeichnung: p.name,
        betrag: betragNachSchluessel.get(p.schluessel) ?? 0,
      }));

    setKostenVorlagen([...((v ?? []) as KostenVorlage[]), ...anschlussVorlagen]);
    if (em) setEigenleistungVorlagen(em as EigenleistungVorlage[]);
    setLaden(false);
  }

  function vorlageWaehlen(compositeId: string) {
    setVorlageId(compositeId);
    if (!compositeId) return;

    const bezahltFuer = (bezeichnung: string) =>
      zahlungen
        .filter(z => z.beschreibung.trim().toLowerCase() === bezeichnung.trim().toLowerCase())
        .reduce((s, z) => s + z.betrag, 0);

    if (compositeId.startsWith('e_')) {
      const e = eigenleistungVorlagen.find(e => e.id === compositeId.slice(2));
      if (!e) return;
      const rest = Math.max(e.gesamtpreis - bezahltFuer(e.bezeichnung), 0);
      setForm(p => ({ ...p, beschreibung: e.bezeichnung, betrag: formatGermanNumber(rest), kategorie: 'Material' }));
    } else {
      const v = kostenVorlagen.find(v => v.id === compositeId.slice(2));
      if (!v) return;
      const rest = Math.max(v.betrag - bezahltFuer(v.bezeichnung), 0);
      setForm(p => ({
        ...p,
        beschreibung: v.bezeichnung,
        betrag: formatGermanNumber(rest),
        kategorie: kostenZuZahlung(v.kategorie),
      }));
    }
  }

  function bearbeitungStarten(z: Zahlung) {
    setBearbeitungId(z.id);
    setVorlageId('');
    setForm({ datum: z.datum, beschreibung: z.beschreibung, kategorie: z.kategorie ?? 'Sonstiges', betrag: formatGermanNumber(z.betrag) });
  }

  function bearbeitungAbbrechen() {
    setBearbeitungId(null);
    setForm({ datum: new Date().toISOString().split('T')[0], beschreibung: '', kategorie: 'Bauträger', betrag: '' });
    setVorlageId('');
  }

  async function hinzufuegen() {
    const betrag = parseGermanNumber(form.betrag);
    if (!form.beschreibung.trim() || betrag == null || betrag <= 0) return;
    setSpeichern(true);

    if (bearbeitungId) {
      const { data, error } = await supabase
        .from('zahlungen')
        .update({ datum: form.datum, beschreibung: form.beschreibung.trim(), kategorie: form.kategorie, betrag })
        .eq('id', bearbeitungId)
        .select().single();
      if (!error && data) {
        setZahlungen(prev => prev.map(z => z.id === bearbeitungId ? data as Zahlung : z).sort((a, b) => b.datum.localeCompare(a.datum)));
        setBearbeitungId(null);
        setForm({ datum: new Date().toISOString().split('T')[0], beschreibung: '', kategorie: 'Bauträger', betrag: '' });
        setVorlageId('');
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('zahlungen')
        .insert({ user_id: user?.id, datum: form.datum, beschreibung: form.beschreibung.trim(), kategorie: form.kategorie, betrag })
        .select().single();
      if (!error && data) {
        setZahlungen(prev => [data as Zahlung, ...prev].sort((a, b) => b.datum.localeCompare(a.datum)));
        setForm(prev => ({ ...prev, beschreibung: '', betrag: '' }));
        setVorlageId('');
      }
    }

    setSpeichern(false);
  }

  async function loeschen(id: string) {
    // Dateien zuerst entfernen — die Datenbankzeilen verschwinden per Cascade mit der Zahlung
    // — außer eine Datei belegt auch eine andere Zahlung
    const anderweitigGenutzt = new Set(
      Object.entries(rechnungen).filter(([zid]) => zid !== id).flatMap(([, liste]) => liste.map(r => r.pfad)),
    );
    const dateien = (rechnungen[id] ?? []).map(r => r.pfad).filter(p => !anderweitigGenutzt.has(p));
    if (dateien.length > 0) await supabase.storage.from('rechnungen').remove(dateien);
    await supabase.from('zahlungen').delete().eq('id', id);
    setZahlungen(prev => prev.filter(z => z.id !== id));
    setRechnungen(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id)));
  }

  async function rechnungenHochladen(zahlungId: string, dateien: FileList | null) {
    if (!dateien || dateien.length === 0) return;
    setRechnungFehler('');
    setUploadZahlungId(zahlungId);
    const { data: { user } } = await supabase.auth.getUser();
    const neu: Rechnung[] = [];
    for (const original of Array.from(dateien)) {
      // Kamera-Fotos haben teils keine Endung im Namen — dann zählt der Typ
      if (!DATEI_ENDUNGEN.test(original.name) && !original.type.startsWith('image/')) {
        setRechnungFehler(`„${original.name}“ wird nicht unterstützt — erlaubt sind PDF und Fotos (JPG, PNG, HEIC).`);
        continue;
      }
      let datei = original;
      if (!istPdf(original)) {
        try {
          datei = await bildAlsJpeg(original);
        } catch {
          setRechnungFehler(`„${original.name}“ konnte nicht als Bild gelesen werden.`);
          continue;
        }
      }
      const pfad = `${user?.id}/${zahlungId}/${Date.now()}-${datei.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('rechnungen').upload(pfad, datei, { contentType: datei.type || undefined });
      if (upErr) { setRechnungFehler(`Upload fehlgeschlagen: ${upErr.message}`); continue; }
      const { data, error } = await supabase
        .from('zahlung_rechnungen')
        .insert({ zahlung_id: zahlungId, pfad, dateiname: datei.name })
        .select().single();
      if (error || !data) {
        await supabase.storage.from('rechnungen').remove([pfad]);
        setRechnungFehler(`Speichern fehlgeschlagen: ${error?.message ?? 'unbekannter Fehler'}`);
        continue;
      }
      neu.push(data as Rechnung);
    }
    if (neu.length > 0) setRechnungen(prev => ({ ...prev, [zahlungId]: [...(prev[zahlungId] ?? []), ...neu] }));
    setUploadZahlungId(null);
  }

  async function rechnungOeffnen(r: Rechnung) {
    const { data, error } = await supabase.storage.from('rechnungen').createSignedUrl(r.pfad, 120);
    if (error || !data) { setRechnungFehler(`Öffnen fehlgeschlagen: ${error?.message ?? 'unbekannter Fehler'}`); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function rechnungLoeschen(r: Rechnung) {
    const { error } = await supabase.from('zahlung_rechnungen').delete().eq('id', r.id);
    if (error) { setRechnungFehler(`Löschen fehlgeschlagen: ${error.message}`); return; }
    // Datei nur löschen, wenn sie keine andere Zahlung mehr belegt
    const nochGenutzt = Object.values(rechnungen).flat().some(x => x.id !== r.id && x.pfad === r.pfad);
    if (!nochGenutzt) await supabase.storage.from('rechnungen').remove([r.pfad]);
    setRechnungen(prev => ({ ...prev, [r.zahlung_id]: (prev[r.zahlung_id] ?? []).filter(x => x.id !== r.id) }));
  }

  /** Hängt eine bereits hochgeladene Rechnung an eine weitere Zahlung — ohne neuen Upload. */
  async function rechnungVerknuepfen(zahlungId: string, pfad: string) {
    setVorhandenZahlungId(null);
    const quelle = Object.values(rechnungen).flat().find(r => r.pfad === pfad);
    if (!quelle) return;
    setRechnungFehler('');
    const { data, error } = await supabase
      .from('zahlung_rechnungen')
      .insert({ zahlung_id: zahlungId, pfad: quelle.pfad, dateiname: quelle.dateiname })
      .select().single();
    if (error || !data) { setRechnungFehler(`Verknüpfen fehlgeschlagen: ${error?.message ?? 'unbekannter Fehler'}`); return; }
    setRechnungen(prev => ({ ...prev, [zahlungId]: [...(prev[zahlungId] ?? []), data as Rechnung] }));
  }

  /** Alle Rechnungsdateien (je Datei einmal), die noch nicht an dieser Zahlung hängen. */
  function vorhandeneRechnungen(zahlungId: string) {
    const schonDran = new Set((rechnungen[zahlungId] ?? []).map(r => r.pfad));
    const gesehen = new Set<string>();
    const liste: { pfad: string; label: string }[] = [];
    for (const z of zahlungen) {
      for (const r of rechnungen[z.id] ?? []) {
        if (z.id === zahlungId || schonDran.has(r.pfad) || gesehen.has(r.pfad)) continue;
        gesehen.add(r.pfad);
        liste.push({ pfad: r.pfad, label: `${r.dateiname} — ${formatDatumDE(z.datum)} ${z.beschreibung}` });
      }
    }
    return liste;
  }

  async function bankPdfErstellen() {
    setBankFehler('');
    setBankErzeugt(true);
    try {
      const belege = new Map<string, Beleg[]>();
      if (bankMitRechnungen) {
        const geladen = new Map<string, ArrayBuffer>(); // je Datei nur einmal herunterladen
        for (const block of bankBloecke) {
          for (const z of block.eintraege) {
            const liste: Beleg[] = [];
            for (const r of rechnungen[z.id] ?? []) {
              let bytes = geladen.get(r.pfad);
              if (!bytes) {
                const { data, error } = await supabase.storage.from('rechnungen').download(r.pfad);
                if (error || !data) throw new Error(`„${r.dateiname}“ konnte nicht geladen werden: ${error?.message ?? 'unbekannter Fehler'}`);
                bytes = await data.arrayBuffer();
                geladen.set(r.pfad, bytes);
              }
              liste.push({ dateiname: r.dateiname, bytes, schluessel: r.pfad });
            }
            if (liste.length > 0) belege.set(z.id, liste);
          }
        }
      }
      const bytes = await erzeugeBankPdf({ bloecke: bankBloecke, gesamt: bankGesamt, von: bankVon, bis: bankBis, belege });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `Bank-Nachweis ${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setBankFehler(e instanceof Error ? e.message : 'PDF konnte nicht erstellt werden.');
    } finally {
      setBankErzeugt(false);
    }
  }

  const gesamtBezahlt = zahlungen.reduce((s, z) => s + z.betrag, 0);

  const planungSummen = (() => {
    const acc: Record<string, number> = {};
    for (const v of kostenVorlagen) {
      const kat = kostenZuZahlung(v.kategorie);
      acc[kat] = (acc[kat] ?? 0) + v.betrag;
    }
    for (const e of eigenleistungVorlagen) {
      acc['Material'] = (acc['Material'] ?? 0) + e.gesamtpreis;
    }
    return acc;
  })();

  const nachKategorie = KATEGORIEN.map(k => ({
    kategorie: k,
    summe: zahlungen.filter(z => z.kategorie === k).reduce((s, z) => s + z.betrag, 0),
  })).filter(k => k.summe > 0);

  // ── Bank-PDF: bezahlte, bankrelevante Zahlungen im gewählten Zeitraum, nach Blöcken ──
  // Zusätzlich zur Kategorie der Zahlung zählt die Zuordnung über den Namen der Kostenposition
  // (wie bei der Ampel im Kosten-Tab) — so fällt auch eine falsch kategorisierte Zahlung nicht heraus.
  const bankBlockNachName = new Map<string, BankBlockId>();
  for (const v of kostenVorlagen) {
    const block = BANK_BLOCK_NACH_KATEGORIE[kostenZuZahlung(v.kategorie)];
    if (block) bankBlockNachName.set(v.bezeichnung.trim().toLowerCase(), block);
  }

  /** Block der Bank-PDF, in den die Zahlung gehört — undefined, wenn sie nicht bankrelevant ist.
   *  Dieselbe Regel steuert das "Bank"-Label in der Liste und die PDF. */
  const bankBlockFuer = (z: Zahlung): BankBlockId | undefined =>
    BANK_BLOCK_NACH_KATEGORIE[z.kategorie ?? ''] ?? bankBlockNachName.get(z.beschreibung.trim().toLowerCase());

  const bankBloecke = (() => {
    const nachBlock = new Map<BankBlockId, Zahlung[]>(BANK_BLOECKE.map(b => [b.id, []]));
    for (const z of zahlungen) {
      if (bankVon && z.datum < bankVon) continue;
      if (bankBis && z.datum > bankBis) continue;
      const block = bankBlockFuer(z);
      if (block) nachBlock.get(block)!.push(z);
    }
    return BANK_BLOECKE
      .map(b => {
        const eintraege = (nachBlock.get(b.id) ?? []).sort((x, y) => x.datum.localeCompare(y.datum));
        return { ...b, eintraege, summe: eintraege.reduce((s, z) => s + z.betrag, 0) };
      })
      .filter(b => b.eintraege.length > 0);
  })();
  const bankGesamt = bankBloecke.reduce((s, b) => s + b.summe, 0);
  const bankAnzahl = bankBloecke.reduce((s, b) => s + b.eintraege.length, 0);
  const bankOhneRechnung = bankBloecke.reduce((s, b) => s + b.eintraege.filter(z => !(rechnungen[z.id]?.length)).length, 0);

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Zahlungserfassung</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Erfasse alle geleisteten Zahlungen rund ums Haus</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => setBankPanelOffen(o => !o)}
            className={`text-sm px-4 py-2 rounded-lg border transition-colors whitespace-nowrap ${bankPanelOffen
              ? 'border-blue-400 text-blue-600 dark:text-blue-300'
              : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'}`}>
            Bank-PDF
          </button>
          <div className="text-right">
            <div className="text-sm text-gray-500 dark:text-gray-400">Gesamt bezahlt</div>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatEuro(gesamtBezahlt)}</div>
          </div>
        </div>
      </div>

      {bankPanelOffen && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-1">Nachweis bezahlter Positionen für die Bank</h3>
          <p className="text-xs text-gray-400 mb-4">
            Enthält alles, was im Kosten-Tab über dem Gesamtfinanzierungsbedarf steht — ohne Grundstück.
          </p>
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Von</label>
              <input type="date" value={bankVon} onChange={e => setBankVon(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Bis</label>
              <input type="date" value={bankBis} onChange={e => setBankBis(e.target.value)}
                className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            {(bankVon || bankBis) && (
              <button onClick={() => { setBankVon(''); setBankBis(''); }}
                className="text-sm text-gray-500 dark:text-gray-400 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors">
                Zeitraum zurücksetzen
              </button>
            )}
            <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
              {bankAnzahl} {bankAnzahl === 1 ? 'Zahlung' : 'Zahlungen'} · <span className="font-semibold text-gray-800 dark:text-white">{formatEuro(bankGesamt)}</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 py-2 cursor-pointer">
              <input type="checkbox" checked={bankMitRechnungen} onChange={e => setBankMitRechnungen(e.target.checked)} />
              Rechnungen anhängen
            </label>
            <button onClick={bankPdfErstellen} disabled={bankAnzahl === 0 || bankErzeugt}
              className="ml-auto text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 rounded-lg transition-colors whitespace-nowrap">
              {bankErzeugt ? 'Erstelle …' : 'PDF erstellen'}
            </button>
          </div>
          {bankMitRechnungen && bankOhneRechnung > 0 && bankAnzahl > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
              Zu {bankOhneRechnung} von {bankAnzahl} Zahlungen ist noch keine Rechnung hinterlegt.
            </p>
          )}
          {bankFehler && <p className="text-xs text-red-600 dark:text-red-400 mt-3">{bankFehler}</p>}
        </div>
      )}

      {/* Formular */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">{bearbeitungId ? 'Zahlung bearbeiten' : 'Neue Zahlung erfassen'}</h3>
        {(kostenVorlagen.length > 0 || eigenleistungVorlagen.length > 0) && (() => {
          const bezahltNachName = zahlungen.reduce((acc, z) => {
            const key = z.beschreibung.trim().toLowerCase();
            acc[key] = (acc[key] ?? 0) + z.betrag;
            return acc;
          }, {} as Record<string, number>);

          const offeneKosten = kostenVorlagen
            .map(v => ({ ...v, bezahlt: bezahltNachName[v.bezeichnung.trim().toLowerCase()] ?? 0 }))
            .filter(v => v.betrag > 0 && v.bezahlt < v.betrag);
          const vollBezahltKosten = kostenVorlagen.filter(v => v.betrag > 0).length - offeneKosten.length;

          const offeneEigenleistungen = eigenleistungVorlagen
            .map(e => ({ ...e, bezahlt: bezahltNachName[e.bezeichnung.trim().toLowerCase()] ?? 0 }))
            .filter(e => e.gesamtpreis > 0 && e.bezahlt < e.gesamtpreis);
          const vollBezahltEigen = eigenleistungVorlagen.filter(e => e.gesamtpreis > 0).length - offeneEigenleistungen.length;

          const vollBezahlt = vollBezahltKosten + vollBezahltEigen;
          const kostenKategorien = [...new Set(offeneKosten.map(v => v.kategorie))];
          const eigenGewerke = [...new Set(offeneEigenleistungen.map(e => e.gewerk))];

          return (
            <div className="mb-4">
              <label className="text-xs text-gray-400 mb-1 block">
                Schnellauswahl
                {vollBezahlt > 0 && (
                  <span className="ml-2 text-green-500">{vollBezahlt} vollständig bezahlt</span>
                )}
              </label>
              <select value={vorlageId} onChange={e => vorlageWaehlen(e.target.value)}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
                <option value="">– Kostenpunkt oder Eigenleistung wählen –</option>
                {offeneKosten.length > 0 && kostenKategorien.map(kat => (
                  <optgroup key={kat} label={kostenZuZahlung(kat)}>
                    {offeneKosten.filter(v => v.kategorie === kat).map(v => {
                      const rest = v.betrag - v.bezahlt;
                      return (
                        <option key={v.id} value={`k_${v.id}`}>
                          {v.bezeichnung} – {v.bezahlt > 0 ? `noch ${formatEuro(rest)} offen (von ${formatEuro(v.betrag)})` : formatEuro(v.betrag)}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
                {offeneEigenleistungen.length > 0 && eigenGewerke.map(gewerk => (
                  <optgroup key={gewerk} label={`Eigenleistung · ${gewerk === '__frei__' ? 'Zusätzliche Eigenleistungen' : gewerk}`}>
                    {offeneEigenleistungen.filter(e => e.gewerk === gewerk).map(e => {
                      const rest = e.gesamtpreis - e.bezahlt;
                      return (
                        <option key={e.id} value={`e_${e.id}`}>
                          {e.bezeichnung} – {e.bezahlt > 0 ? `noch ${formatEuro(rest)} offen (von ${formatEuro(e.gesamtpreis)})` : formatEuro(e.gesamtpreis)}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          );
        })()}
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
              list="beschreibung-vorschlaege"
              placeholder="z.B. Abschlagsrechnung 1"
              className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            <datalist id="beschreibung-vorschlaege">
              {[...new Set([
                ...zahlungen.map(z => z.beschreibung),
                ...kostenVorlagen.map(v => v.bezeichnung),
                ...eigenleistungVorlagen.map(e => e.bezeichnung),
              ])].sort().map(v => <option key={v} value={v} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Kategorie</label>
            <select value={form.kategorie} onChange={e => setForm(p => ({ ...p, kategorie: e.target.value }))}
              className="max-w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100">
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
          {bearbeitungId && (
            <button onClick={bearbeitungAbbrechen}
              className="text-sm text-gray-500 dark:text-gray-400 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap">
              Abbrechen
            </button>
          )}
          <button onClick={hinzufuegen} disabled={speichern || !form.beschreibung.trim()}
            className={`text-sm text-white px-5 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap ${bearbeitungId ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {speichern ? '...' : bearbeitungId ? 'Speichern' : '+ Hinzufügen'}
          </button>
        </div>
      </div>

      {/* Gemeinsame, versteckte Eingabefelder für den Rechnungs-Upload */}
      <input ref={dateiInput} type="file" multiple accept="application/pdf,image/*,.heic,.heif" className="hidden"
        onChange={e => { if (zielZahlungId.current) rechnungenHochladen(zielZahlungId.current, e.target.files); e.target.value = ''; }} />
      <input ref={kameraInput} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { if (zielZahlungId.current) rechnungenHochladen(zielZahlungId.current, e.target.files); e.target.value = ''; }} />

      {rechnungFehler && (
        <div className="text-sm text-red-600 dark:text-red-400 mb-4">{rechnungFehler}</div>
      )}

      {zahlungen.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-400">
          Noch keine Zahlungen erfasst.
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Zahlungsliste */}
          <div className="xl:col-span-3 bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
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
                  <tr key={z.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bearbeitungId === z.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDatumDE(z.datum)}</td>
                    <td className="px-5 py-3 text-gray-800 dark:text-gray-200">
                      {z.beschreibung}
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {(rechnungen[z.id] ?? []).map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 max-w-56">
                            <button onClick={() => rechnungOeffnen(r)} className="truncate hover:underline" title={`${r.dateiname} öffnen`}>📎 {r.dateiname}</button>
                            <button onClick={() => rechnungLoeschen(r)} className="text-blue-300 hover:text-red-500" title="Rechnung entfernen">×</button>
                          </span>
                        ))}
                        {uploadZahlungId === z.id ? (
                          <span className="text-xs text-gray-400">Lädt hoch …</span>
                        ) : auswahlZahlungId === z.id ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <button onClick={() => { zielZahlungId.current = z.id; setAuswahlZahlungId(null); dateiInput.current?.click(); }}
                              className="px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400">
                              📁 Datei wählen
                            </button>
                            <button onClick={() => { zielZahlungId.current = z.id; setAuswahlZahlungId(null); kameraInput.current?.click(); }}
                              className="px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400">
                              📷 Foto aufnehmen
                            </button>
                            {vorhandeneRechnungen(z.id).length > 0 && (
                              <button onClick={() => { setAuswahlZahlungId(null); setVorhandenZahlungId(z.id); }}
                                className="px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400">
                                🔗 Vorhandene Rechnung
                              </button>
                            )}
                            <button onClick={() => setAuswahlZahlungId(null)} className="text-gray-400 hover:text-gray-600" title="Abbrechen">×</button>
                          </span>
                        ) : vorhandenZahlungId === z.id ? (
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <select defaultValue="" onChange={e => e.target.value && rechnungVerknuepfen(z.id, e.target.value)}
                              className="max-w-72 text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200">
                              <option value="">– Rechnung wählen –</option>
                              {vorhandeneRechnungen(z.id).map(v => <option key={v.pfad} value={v.pfad}>{v.label}</option>)}
                            </select>
                            <button onClick={() => setVorhandenZahlungId(null)} className="text-gray-400 hover:text-gray-600" title="Abbrechen">×</button>
                          </span>
                        ) : (
                          <button onClick={() => setAuswahlZahlungId(z.id)} disabled={uploadZahlungId !== null}
                            className="text-xs text-gray-400 hover:text-blue-500 transition-colors disabled:opacity-50">
                            + Rechnung
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{z.kategorie || 'Sonstiges'}</span>
                      {bankBlockFuer(z) && (
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded border border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-900/30 dark:text-blue-300"
                          title="Bankrelevant — Teil des Gesamtfinanzierungsbedarfs, erscheint in der Bank-PDF">
                          Bank
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-gray-900 dark:text-white whitespace-nowrap">{formatEuro(z.betrag)}</td>
                    <td className="px-5 py-3 text-center whitespace-nowrap">
                      <button onClick={() => bearbeitungStarten(z)} className="text-gray-300 hover:text-amber-500 transition-colors mr-1" title="Bearbeiten">✎</button>
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
              {nachKategorie.map(k => {
                const geplant = planungSummen[k.kategorie] ?? 0;
                const offen = geplant > 0 ? Math.max(geplant - k.summe, 0) : 0;
                const prozentBezahlt = geplant > 0 ? Math.min((k.summe / geplant) * 100, 100) : 0;
                const prozentOffen = geplant > 0 ? Math.round(100 - prozentBezahlt) : null;
                return (
                  <div key={k.kategorie}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 dark:text-gray-300">{k.kategorie}</span>
                      <span className="font-medium text-gray-800 dark:text-white">{formatEuro(k.summe)}</span>
                    </div>
                    <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-1.5 mb-1">
                      <div
                        className="bg-blue-500 h-1.5 rounded-full"
                        style={{ width: geplant > 0 ? `${prozentBezahlt}%` : `${(k.summe / gesamtBezahlt) * 100}%` }}
                      />
                    </div>
                    {prozentOffen !== null && (
                      <div className="text-xs">
                        {offen > 0
                          ? <span className="text-orange-400">{prozentOffen}% offen – {formatEuro(offen)}</span>
                          : <span className="text-green-500">vollständig bezahlt</span>
                        }
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
