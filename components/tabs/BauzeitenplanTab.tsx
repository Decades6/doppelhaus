'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { Bauvorgang } from '@/lib/types';
import { arbeitstage, formatDauer, heuteIso, kalenderwoche, tageAddieren, tageZwischen, wochenMontag } from '@/lib/bauzeitenplan';

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

/** Breite einer Kalenderwoche im Balkendiagramm */
const WOCHE_PX = 26;
const TAG_PX = WOCHE_PX / 7;

function datumKurz(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${WOCHENTAGE[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

function zeitraum(v: Bauvorgang): string {
  return v.anfang === v.ende ? datumKurz(v.anfang) : `${datumKurz(v.anfang)} – ${datumKurz(v.ende)}`;
}

type Status = 'vorbei' | 'laeuft' | 'geplant';

function statusVon(v: Bauvorgang, heute: string): Status {
  if (v.ende < heute) return 'vorbei';
  if (v.anfang <= heute) return 'laeuft';
  return 'geplant';
}

const BALKEN_FARBE: Record<Status, string> = {
  vorbei: 'bg-gray-300 dark:bg-gray-600',
  laeuft: 'bg-green-500',
  geplant: 'bg-blue-500',
};

interface Formular {
  id: string | null;
  gewerk: string;
  vorgang: string;
  anfang: string;
  ende: string;
  dauer: string;
}

const EINGABE = 'w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100';

/** Schalter "im Kalender-Abo" — teilweise = nur ein Teil einer Gruppe ist ausgewählt */
function AboSchalter({ an, teilweise, onClick, titel }: { an: boolean; teilweise?: boolean; onClick: () => void; titel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={an}
      title={titel}
      className={`shrink-0 text-sm leading-none transition ${an ? '' : teilweise ? 'opacity-60' : 'grayscale opacity-25 hover:opacity-60'}`}
    >
      📅
    </button>
  );
}

export default function BauzeitenplanTab() {
  const [vorgaenge, setVorgaenge] = useState<Bauvorgang[]>([]);
  const [imAbo, setImAbo] = useState<Set<string>>(new Set());
  const [laden, setLaden] = useState(true);
  // Am Handy ist das breite Balkendiagramm schwer lesbar — dort mit der Liste starten
  const [ansicht, setAnsicht] = useState<'balken' | 'liste'>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches ? 'liste' : 'balken');
  const [formular, setFormular] = useState<Formular | null>(null);
  const [loeschenFragen, setLoeschenFragen] = useState(false);
  const [speichern, setSpeichern] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    async function ladeDaten() {
      const [plan, auswahl] = await Promise.all([
        supabase.from('bauzeitenplan').select('*').order('nr'),
        // RLS liefert nur die eigene Auswahl — jedes Konto entscheidet selbst
        supabase.from('bauzeitenplan_kalender').select('vorgang_id'),
      ]);
      if (plan.error) setFehler('Der Bauzeitenplan konnte nicht geladen werden. Wurde das SQL-Skript in Supabase ausgeführt?');
      // numeric kommt je nach Treiber als Text — für Vergleiche und Formatierung als Zahl führen
      if (plan.data) setVorgaenge((plan.data as Bauvorgang[]).map(v => ({ ...v, dauer_tage: Number(v.dauer_tage) })));
      if (auswahl.data) setImAbo(new Set(auswahl.data.map(a => a.vorgang_id as string)));
      setLaden(false);
    }
    ladeDaten();
  }, []);

  // Pop-up mit Escape schließen
  const formularOffen = formular !== null;
  useEffect(() => {
    if (!formularOffen) return;
    const beiTaste = (e: KeyboardEvent) => { if (e.key === 'Escape') { setFormular(null); setFehler(null); } };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [formularOffen]);

  const heute = heuteIso();

  // Gewerke in der Reihenfolge des Plans, Vorgänge darin nach Datum — neue Vorgänge
  // bekommen die höchste Nummer und würden sonst immer am Ende ihres Gewerks landen
  const gruppen = useMemo(() => {
    const nachGewerk = new Map<string, Bauvorgang[]>();
    for (const v of [...vorgaenge].sort((a, b) => a.nr - b.nr)) {
      if (!nachGewerk.has(v.gewerk)) nachGewerk.set(v.gewerk, []);
      nachGewerk.get(v.gewerk)!.push(v);
    }
    return [...nachGewerk.entries()].map(([gewerk, liste]) => ({
      gewerk,
      liste: [...liste].sort((a, b) => a.anfang.localeCompare(b.anfang) || a.nr - b.nr),
      anfang: liste.reduce((m, v) => (v.anfang < m ? v.anfang : m), liste[0].anfang),
      ende: liste.reduce((m, v) => (v.ende > m ? v.ende : m), liste[0].ende),
    }));
  }, [vorgaenge]);

  const zeitachse = useMemo(() => {
    if (vorgaenge.length === 0) return null;
    const erster = vorgaenge.reduce((m, v) => (v.anfang < m ? v.anfang : m), vorgaenge[0].anfang);
    const letzter = vorgaenge.reduce((m, v) => (v.ende > m ? v.ende : m), vorgaenge[0].ende);
    const start = wochenMontag(erster);
    const wochen = Math.ceil((tageZwischen(start, letzter) + 1) / 7);
    const schluss = tageAddieren(start, wochen * 7); // exklusiv

    const monate: { label: string; links: number; breite: number }[] = [];
    let cursor = start;
    while (cursor < schluss) {
      const [jahr, monat] = cursor.split('-').map(Number);
      const naechster = monat === 12 ? `${jahr + 1}-01-01` : `${jahr}-${String(monat + 1).padStart(2, '0')}-01`;
      const bis = naechster < schluss ? naechster : schluss;
      monate.push({
        label: monat === 1 || monate.length === 0 ? `${MONATE[monat - 1]} ${jahr}` : MONATE[monat - 1],
        links: tageZwischen(start, cursor) * TAG_PX,
        breite: tageZwischen(cursor, bis) * TAG_PX,
      });
      cursor = bis;
    }
    return {
      start,
      erster,
      letzter,
      breite: wochen * WOCHE_PX,
      wochen: Array.from({ length: wochen }, (_, i) => tageAddieren(start, i * 7)),
      monate,
      heuteLinks: heute >= start && heute < schluss ? tageZwischen(start, heute) * TAG_PX + TAG_PX / 2 : null,
    };
  }, [vorgaenge, heute]);

  const laufend = vorgaenge.filter(v => statusVon(v, heute) === 'laeuft');
  const naechster = [...vorgaenge].filter(v => v.anfang > heute).sort((a, b) => a.anfang.localeCompare(b.anfang))[0];
  const zuletztGeaendert = vorgaenge.reduce<string | null>((m, v) => (!m || v.updated_at > m ? v.updated_at : m), null);
  const gewerke = gruppen.map(g => g.gewerk);

  // ---------- Kalender-Abo ----------

  async function aboSetzen(ids: string[], an: boolean) {
    const betroffen = ids.filter(id => imAbo.has(id) !== an);
    if (betroffen.length === 0) return;
    const vorher = imAbo;
    setImAbo(prev => {
      const neu = new Set(prev);
      betroffen.forEach(id => (an ? neu.add(id) : neu.delete(id)));
      return neu;
    });
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = an
      ? await supabase.from('bauzeitenplan_kalender').upsert(betroffen.map(vorgang_id => ({ user_id: user?.id, vorgang_id })), { onConflict: 'user_id,vorgang_id', ignoreDuplicates: true })
      : await supabase.from('bauzeitenplan_kalender').delete().in('vorgang_id', betroffen);
    if (error) {
      setImAbo(vorher);
      setFehler('Die Auswahl fürs Kalender-Abo konnte nicht gespeichert werden.');
    }
  }

  function gruppenSchalter(liste: Bauvorgang[]) {
    const anzahl = liste.filter(v => imAbo.has(v.id)).length;
    return {
      an: anzahl === liste.length,
      teilweise: anzahl > 0 && anzahl < liste.length,
      umschalten: () => aboSetzen(liste.map(v => v.id), anzahl < liste.length),
    };
  }

  // ---------- Bearbeiten ----------

  function schliessen() {
    setFormular(null);
    setFehler(null);
  }

  function bearbeiten(v: Bauvorgang) {
    setFormular({ id: v.id, gewerk: v.gewerk, vorgang: v.vorgang, anfang: v.anfang, ende: v.ende, dauer: String(v.dauer_tage).replace('.', ',') });
    setLoeschenFragen(false);
    setFehler(null);
  }

  function neuerVorgang() {
    const tag = naechster?.anfang ?? heute;
    setFormular({ id: null, gewerk: '', vorgang: '', anfang: tag, ende: tag, dauer: String(arbeitstage(tag, tag)) });
    setLoeschenFragen(false);
    setFehler(null);
  }

  /** Bei geänderten Daten die Dauer neu vorschlagen — bleibt danach von Hand änderbar */
  function datumAendern(feld: 'anfang' | 'ende', wert: string) {
    setFormular(f => {
      if (!f || !wert) return f;
      const neu = { ...f, [feld]: wert };
      if (neu.ende < neu.anfang) neu.ende = neu.anfang;
      neu.dauer = String(arbeitstage(neu.anfang, neu.ende));
      return neu;
    });
  }

  async function formularSpeichern() {
    if (!formular || !formular.vorgang.trim() || !formular.gewerk.trim()) return;
    setSpeichern(true);
    setFehler(null);
    const dauer = parseFloat(formular.dauer.replace(',', '.'));
    const daten = {
      gewerk: formular.gewerk.trim(),
      vorgang: formular.vorgang.trim(),
      anfang: formular.anfang,
      ende: formular.ende,
      dauer_tage: Number.isFinite(dauer) && dauer >= 0 ? dauer : arbeitstage(formular.anfang, formular.ende),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = formular.id
      ? await supabase.from('bauzeitenplan').update(daten).eq('id', formular.id).select().single()
      : await supabase.from('bauzeitenplan')
          .insert({ ...daten, nr: vorgaenge.reduce((m, v) => Math.max(m, v.nr), 0) + 1 })
          .select().single();
    if (error || !data) {
      setFehler('Speichern hat nicht geklappt. Bitte noch einmal versuchen.');
    } else {
      const gespeichert = { ...(data as Bauvorgang), dauer_tage: Number((data as Bauvorgang).dauer_tage) };
      setVorgaenge(prev => (formular.id ? prev.map(v => (v.id === gespeichert.id ? gespeichert : v)) : [...prev, gespeichert]));
      setFormular(null);
    }
    setSpeichern(false);
  }

  async function vorgangLoeschen() {
    if (!formular?.id) return;
    const id = formular.id;
    const { error } = await supabase.from('bauzeitenplan').delete().eq('id', id);
    if (error) {
      setFehler('Löschen hat nicht geklappt.');
      return;
    }
    setVorgaenge(prev => prev.filter(v => v.id !== id));
    setImAbo(prev => { const neu = new Set(prev); neu.delete(id); return neu; });
    setFormular(null);
  }

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Bauzeitenplan...</div>;

  // Nach Monat des Anfangs gruppiert, für die Listenansicht
  const nachMonat = [...vorgaenge]
    .sort((a, b) => a.anfang.localeCompare(b.anfang) || a.nr - b.nr)
    .reduce<Record<string, Bauvorgang[]>>((acc, v) => {
      (acc[v.anfang.slice(0, 7)] ??= []).push(v);
      return acc;
    }, {});

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Bauzeitenplan</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Gemeinsamer Plan für Petrusov & Hägele
            {zuletztGeaendert && <> · zuletzt geändert am {new Date(zuletztGeaendert).toLocaleDateString('de-DE')}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 text-sm">
            {(['balken', 'liste'] as const).map(a => (
              <button key={a} onClick={() => setAnsicht(a)}
                className={`px-3 py-1.5 rounded-md transition-colors ${ansicht === a ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                {a === 'balken' ? 'Balken' : 'Liste'}
              </button>
            ))}
          </div>
          <button onClick={neuerVorgang}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Vorgang
          </button>
        </div>
      </div>

      {fehler && (
        <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-100 dark:border-red-900 rounded-lg px-4 py-3">{fehler}</div>
      )}

      {/* Kennzahlen */}
      {zeitachse && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">Baubeginn</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{datumKurz(zeitachse.erster)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">Fertigstellung</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{datumKurz(zeitachse.letzter)}</div>
            <div className="text-xs text-gray-400 mt-0.5">KW {kalenderwoche(zeitachse.letzter)}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 min-w-0">
            <div className="text-xs text-gray-500 dark:text-gray-400">{laufend.length > 0 ? 'Gerade dran' : 'Als Nächstes'}</div>
            {laufend.length > 0 ? (
              <div className="text-sm font-semibold text-green-600 dark:text-green-400 mt-1 truncate" title={laufend.map(v => v.vorgang).join(', ')}>
                {laufend[0].vorgang}{laufend.length > 1 && ` +${laufend.length - 1}`}
              </div>
            ) : naechster ? (
              <>
                <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1 truncate" title={naechster.vorgang}>{naechster.vorgang}</div>
                <div className="text-xs text-gray-400 mt-0.5">ab {datumKurz(naechster.anfang)}</div>
              </>
            ) : (
              <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">Alles erledigt</div>
            )}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">In deinem Kalender-Abo</div>
            <div className="text-lg font-bold text-gray-900 dark:text-white mt-1">{imAbo.size} von {vorgaenge.length}</div>
            <div className="flex gap-3 text-xs mt-0.5">
              <button onClick={() => aboSetzen(vorgaenge.map(v => v.id), true)} className="text-blue-600 dark:text-blue-400 hover:underline">alle</button>
              <button onClick={() => aboSetzen(vorgaenge.map(v => v.id), false)} className="text-blue-600 dark:text-blue-400 hover:underline">keine</button>
            </div>
          </div>
        </div>
      )}

      {/* Bearbeiten / neu — als Pop-up über dem Plan */}
      {formular && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 print:hidden"
          onMouseDown={e => { if (e.target === e.currentTarget) schliessen(); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="bauzeitenplan-dialog-titel"
            className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-5">
            <div className="flex items-start justify-between gap-4 mb-4">
              <h3 id="bauzeitenplan-dialog-titel" className="text-base font-semibold text-gray-900 dark:text-white">
                {formular.id ? 'Vorgang bearbeiten' : 'Neuer Vorgang'}
              </h3>
              <button onClick={schliessen} aria-label="Schließen"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none -mt-1">×</button>
            </div>

            {fehler && (
              <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2">{fehler}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">Gewerk *</label>
                <input list="bauzeitenplan-gewerke" value={formular.gewerk} onChange={e => setFormular(f => f && { ...f, gewerk: e.target.value })}
                  placeholder="z.B. Rohbau" autoFocus={!formular.id} className={EINGABE} />
                <datalist id="bauzeitenplan-gewerke">
                  {gewerke.map(g => <option key={g} value={g} />)}
                </datalist>
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">Vorgang *</label>
                <input value={formular.vorgang} onChange={e => setFormular(f => f && { ...f, vorgang: e.target.value })}
                  placeholder="z.B. Fundamente EG" className={EINGABE} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Anfang</label>
                <input type="date" value={formular.anfang} onChange={e => datumAendern('anfang', e.target.value)} className={EINGABE} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Ende</label>
                <input type="date" value={formular.ende} min={formular.anfang} onChange={e => datumAendern('ende', e.target.value)} className={EINGABE} />
              </div>
              <div className="col-span-2">
                <label className="text-xs text-gray-400 mb-1 block">Dauer (Arbeitstage)</label>
                <input inputMode="decimal" value={formular.dauer} onChange={e => setFormular(f => f && { ...f, dauer: e.target.value })} className={EINGABE} />
                <p className="text-xs text-gray-400 mt-1">Wird beim Ändern der Daten neu vorgeschlagen (Mo–Fr ohne Feiertage) und kann angepasst werden.</p>
              </div>
            </div>

            {loeschenFragen ? (
              <div className="mt-5 flex items-center justify-between gap-2 flex-wrap bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2 text-sm">
                <span className="text-red-700 dark:text-red-300">Wirklich löschen? Gilt für beide Familien.</span>
                <span className="flex gap-2">
                  <button onClick={() => setLoeschenFragen(false)} className="text-gray-500 dark:text-gray-400 px-3 py-1.5">Nein</button>
                  <button onClick={vorgangLoeschen} className="text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg">Ja, löschen</button>
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-5">
                {formular.id && (
                  <button onClick={() => setLoeschenFragen(true)} className="text-sm text-red-500 hover:text-red-600 px-1 py-2 mr-auto">Löschen</button>
                )}
                <button onClick={schliessen}
                  className="text-sm text-gray-500 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors ml-auto">
                  Abbrechen
                </button>
                <button onClick={formularSpeichern} disabled={speichern || !formular.vorgang.trim() || !formular.gewerk.trim()}
                  className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {speichern ? 'Speichert...' : 'Speichern'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {vorgaenge.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-400 mb-6">
          Noch keine Vorgänge eingetragen.
        </div>
      ) : ansicht === 'balken' && zeitachse ? (
        /* ---------- Balkendiagramm ---------- */
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm mb-6 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="w-max min-w-full text-xs">
              {/* Monate */}
              <div className="flex border-b border-gray-100 dark:border-gray-700">
                <div className="sticky left-0 z-20 w-44 sm:w-72 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700" />
                <div className="relative h-6" style={{ width: zeitachse.breite }}>
                  {zeitachse.monate.map(m => (
                    <div key={m.links} className="absolute top-0 h-full flex items-center px-1.5 border-l border-gray-200 dark:border-gray-600 font-semibold text-gray-600 dark:text-gray-300 overflow-hidden whitespace-nowrap"
                      style={{ left: m.links, width: m.breite }}>
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>
              {/* Kalenderwochen */}
              <div className="flex border-b border-gray-200 dark:border-gray-600">
                <div className="sticky left-0 z-20 w-44 sm:w-72 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700 px-4 flex items-center text-gray-400">
                  Vorgang
                </div>
                <div className="flex" style={{ width: zeitachse.breite }}>
                  {zeitachse.wochen.map(w => (
                    <div key={w} className={`text-center py-1 text-[10px] tabular-nums ${w <= heute && heute < tageAddieren(w, 7) ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-400'}`}
                      style={{ width: WOCHE_PX }} title={`KW ${kalenderwoche(w)} ab ${datumKurz(w)}`}>
                      {kalenderwoche(w)}
                    </div>
                  ))}
                </div>
              </div>

              {gruppen.map(g => {
                const schalter = gruppenSchalter(g.liste);
                return (
                  <div key={g.gewerk} className="border-b border-gray-100 dark:border-gray-700 last:border-b-0">
                    {/* Gewerk-Zeile */}
                    <div className="flex bg-gray-50 dark:bg-gray-900">
                      <div className="sticky left-0 z-10 w-44 sm:w-72 shrink-0 bg-gray-50 dark:bg-gray-900 border-r border-gray-100 dark:border-gray-700 flex items-center gap-2 px-4 h-7">
                        <AboSchalter an={schalter.an} teilweise={schalter.teilweise} onClick={schalter.umschalten}
                          titel={schalter.an ? 'Ganzes Gewerk aus dem Kalender-Abo nehmen' : 'Ganzes Gewerk ins Kalender-Abo'} />
                        <span className="font-semibold text-gray-700 dark:text-gray-200 truncate">{g.gewerk}</span>
                      </div>
                      <div className="relative h-7 text-gray-100 dark:text-gray-700/60" style={{ width: zeitachse.breite, ...wochenRaster() }}>
                        <div className="absolute top-3 h-1 rounded-full bg-gray-300 dark:bg-gray-600"
                          style={{ left: tageZwischen(zeitachse.start, g.anfang) * TAG_PX, width: Math.max((tageZwischen(g.anfang, g.ende) + 1) * TAG_PX, 4) }} />
                        <HeuteLinie links={zeitachse.heuteLinks} />
                      </div>
                    </div>
                    {/* Vorgänge */}
                    {g.liste.map(v => {
                      const status = statusVon(v, heute);
                      return (
                        <div key={v.id} className="flex group">
                          <div className="sticky left-0 z-10 w-44 sm:w-72 shrink-0 bg-white dark:bg-gray-800 border-r border-gray-100 dark:border-gray-700 flex items-center gap-2 pl-4 pr-2 h-7">
                            <AboSchalter an={imAbo.has(v.id)} onClick={() => aboSetzen([v.id], !imAbo.has(v.id))}
                              titel={imAbo.has(v.id) ? 'Aus dem Kalender-Abo nehmen' : 'Ins Kalender-Abo'} />
                            <button onClick={() => bearbeiten(v)} title={`${v.vorgang} · ${zeitraum(v)} · ${formatDauer(v.dauer_tage)}`}
                              className={`truncate text-left hover:text-blue-600 dark:hover:text-blue-400 ${status === 'vorbei' ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200'}`}>
                              {v.vorgang}
                            </button>
                          </div>
                          <div className="relative h-7 text-gray-100 dark:text-gray-700/60 group-hover:bg-blue-50/60 dark:group-hover:bg-blue-950/30" style={{ width: zeitachse.breite, ...wochenRaster() }}>
                            <button onClick={() => bearbeiten(v)} title={`${v.vorgang} · ${zeitraum(v)} · ${formatDauer(v.dauer_tage)}`}
                              className={`absolute top-1.5 h-4 rounded ${BALKEN_FARBE[status]} hover:ring-2 hover:ring-blue-300`}
                              style={{ left: tageZwischen(zeitachse.start, v.anfang) * TAG_PX, width: Math.max((tageZwischen(v.anfang, v.ende) + 1) * TAG_PX, 6) }} />
                            <HeuteLinie links={zeitachse.heuteLinks} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="flex gap-4 flex-wrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700">
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-blue-500" /> geplant</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-green-500" /> läuft gerade</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600" /> vorbei</span>
            <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-red-400" /> heute</span>
            <span>Klick auf einen Vorgang zum Bearbeiten · 📅 = erscheint in deinem Kalender-Abo</span>
          </div>
        </div>
      ) : (
        /* ---------- Liste ---------- */
        <div className="space-y-6 mb-6">
          {Object.keys(nachMonat).sort().map(monat => {
            const [jahr, m] = monat.split('-').map(Number);
            return (
              <div key={monat}>
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">{MONATE[m - 1]} {jahr}</h3>
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-700">
                  {nachMonat[monat].map(v => {
                    const status = statusVon(v, heute);
                    return (
                      <div key={v.id} className={`flex items-center gap-3 px-4 py-3 ${status === 'vorbei' ? 'opacity-50' : ''}`}>
                        <AboSchalter an={imAbo.has(v.id)} onClick={() => aboSetzen([v.id], !imAbo.has(v.id))}
                          titel={imAbo.has(v.id) ? 'Aus dem Kalender-Abo nehmen' : 'Ins Kalender-Abo'} />
                        <button onClick={() => bearbeiten(v)} className="flex-1 min-w-0 text-left">
                          <div className="font-medium text-gray-900 dark:text-white truncate">{v.vorgang}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{v.gewerk} · {zeitraum(v)}</div>
                        </button>
                        {status === 'laeuft' && <span className="text-[11px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 px-2 py-0.5 rounded-full">läuft</span>}
                        <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap tabular-nums">{formatDauer(v.dauer_tage)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500">
        Vorgänge mit 📅 erscheinen als ganztägige Einträge in deinem Kalender-Abo (Link im Reiter „Termine“).
        Die Auswahl gilt nur für dein Konto — der Plan selbst ist für beide Familien gleich.
      </p>
    </div>
  );
}

/** Senkrechte Linie für jede Kalenderwoche, gezeichnet in der Textfarbe des Elements */
function wochenRaster(): CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${WOCHE_PX - 1}px, currentColor ${WOCHE_PX - 1}px ${WOCHE_PX}px)`,
  };
}

function HeuteLinie({ links }: { links: number | null }) {
  if (links === null) return null;
  return <div className="absolute top-0 bottom-0 w-px bg-red-400 pointer-events-none" style={{ left: links }} />;
}
