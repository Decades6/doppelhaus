'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Termin } from '@/lib/types';

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function formatDatumLang(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return `${WOCHENTAGE[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`;
}

function monatKey(iso: string): string {
  return iso.slice(0, 7); // "2026-05"
}

function monatLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONATE[parseInt(m) - 1]} ${y}`;
}

function heute(): string {
  return new Date().toISOString().split('T')[0];
}

export default function KalenderTab() {
  const [termine, setTermine] = useState<Termin[]>([]);
  const [laden, setLaden] = useState(true);
  const [speichern, setSpeichern] = useState(false);
  const [icsToken, setIcsToken] = useState<string | null>(null);
  const [tokenLaden, setTokenLaden] = useState(true);
  const [tokenKopiert, setTokenKopiert] = useState(false);
  const [formOffen, setFormOffen] = useState(false);
  const [form, setForm] = useState({
    titel: '',
    datum: heute(),
    uhrzeit_von: '',
    uhrzeit_bis: '',
    beschreibung: '',
    ort: '',
  });

  useEffect(() => {
    ladeTermine();
    ladeOderErstelleToken();
  }, []);

  async function ladeTermine() {
    const { data } = await supabase
      .from('termine')
      .select('*')
      .order('datum', { ascending: true })
      .order('uhrzeit_von', { ascending: true });
    if (data) setTermine(data as Termin[]);
    setLaden(false);
  }

  async function ladeOderErstelleToken() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTokenLaden(false); return; }

    const { data: existing } = await supabase
      .from('kalender_tokens')
      .select('token')
      .eq('user_id', user.id)
      .limit(1);

    if (existing && existing.length > 0) {
      setIcsToken(existing[0].token);
    } else {
      const { data: neu } = await supabase
        .from('kalender_tokens')
        .insert({ user_id: user.id })
        .select('token')
        .single();
      if (neu?.token) setIcsToken(neu.token);
    }
    setTokenLaden(false);
  }

  async function terminHinzufuegen() {
    if (!form.titel.trim() || !form.datum) return;
    setSpeichern(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('termine')
      .insert({
        user_id: user?.id,
        titel: form.titel.trim(),
        datum: form.datum,
        uhrzeit_von: form.uhrzeit_von || null,
        uhrzeit_bis: form.uhrzeit_bis || null,
        beschreibung: form.beschreibung.trim() || null,
        ort: form.ort.trim() || null,
      })
      .select()
      .single();

    if (!error && data) {
      setTermine(prev => [...prev, data as Termin].sort((a, b) => a.datum.localeCompare(b.datum) || (a.uhrzeit_von ?? '').localeCompare(b.uhrzeit_von ?? '')));
      setForm({ titel: '', datum: heute(), uhrzeit_von: '', uhrzeit_bis: '', beschreibung: '', ort: '' });
      setFormOffen(false);
    }
    setSpeichern(false);
  }

  async function terminLoeschen(id: string) {
    await supabase.from('termine').delete().eq('id', id);
    setTermine(prev => prev.filter(t => t.id !== id));
  }

  function icsUrl(): string {
    if (!icsToken) return '';
    return `${window.location.origin}/api/kalender.ics?token=${icsToken}`;
  }

  async function tokenKopieren() {
    await navigator.clipboard.writeText(icsUrl());
    setTokenKopiert(true);
    setTimeout(() => setTokenKopiert(false), 2000);
  }

  const heut = heute();

  // Nach Monat gruppieren
  const monatsgruppen = termine.reduce<Record<string, Termin[]>>((acc, t) => {
    const key = monatKey(t.datum);
    if (!acc[key]) acc[key] = [];
    acc[key].push(t);
    return acc;
  }, {});

  const aktuellerMonat = heut.slice(0, 7);
  const vergangeneMonat = Object.keys(monatsgruppen).filter(k => k < aktuellerMonat).sort();
  const kommendeMonat = Object.keys(monatsgruppen).filter(k => k >= aktuellerMonat).sort();

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Termine...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Termine</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Gemeinsamer Kalender für Petrusov & Hägele</p>
        </div>
        <button
          onClick={() => setFormOffen(v => !v)}
          className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Neuer Termin
        </button>
      </div>

      {/* Formular */}
      {formOffen && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6 border border-blue-100 dark:border-blue-900">
          <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-4">Neuen Termin eintragen</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Titel *</label>
              <input value={form.titel} onChange={e => setForm(p => ({ ...p, titel: e.target.value }))}
                placeholder="z.B. Baugespräch mit Architekt"
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Datum *</label>
              <input type="date" value={form.datum} onChange={e => setForm(p => ({ ...p, datum: e.target.value }))}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Ort</label>
              <input value={form.ort} onChange={e => setForm(p => ({ ...p, ort: e.target.value }))}
                placeholder="z.B. Baustelle Hamburg"
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Uhrzeit von</label>
              <input type="time" value={form.uhrzeit_von} onChange={e => setForm(p => ({ ...p, uhrzeit_von: e.target.value }))}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Uhrzeit bis</label>
              <input type="time" value={form.uhrzeit_bis} onChange={e => setForm(p => ({ ...p, uhrzeit_bis: e.target.value }))}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-gray-400 mb-1 block">Beschreibung</label>
              <textarea value={form.beschreibung} onChange={e => setForm(p => ({ ...p, beschreibung: e.target.value }))}
                placeholder="Optionale Notizen..."
                rows={2}
                className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 resize-none" />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={terminHinzufuegen} disabled={speichern || !form.titel.trim()}
              className="text-sm bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
              {speichern ? 'Speichert...' : 'Termin speichern'}
            </button>
            <button onClick={() => setFormOffen(false)}
              className="text-sm text-gray-500 px-5 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* Terminliste */}
      {termine.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-10 text-center text-gray-400 mb-6">
          Noch keine Termine eingetragen.
        </div>
      ) : (
        <div className="space-y-6 mb-8">
          {kommendeMonat.map(monat => (
            <div key={monat}>
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-3">
                {monatLabel(monat)}
              </h3>
              <div className="space-y-2">
                {monatsgruppen[monat].map(t => {
                  const istHeute = t.datum === heut;
                  const istVergangen = t.datum < heut;
                  return (
                    <div key={t.id} className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex items-start gap-4 ${istHeute ? 'border-l-4 border-blue-500' : istVergangen ? 'opacity-50' : ''}`}>
                      <div className="shrink-0 text-center w-12">
                        <div className={`text-2xl font-bold leading-none ${istHeute ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                          {new Date(t.datum + 'T00:00:00').getDate()}
                        </div>
                        <div className="text-xs text-gray-400 uppercase">{WOCHENTAGE[new Date(t.datum + 'T00:00:00').getDay()]}</div>
                        {istHeute && <div className="text-[10px] text-blue-500 font-semibold mt-0.5">Heute</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white">{t.titel}</div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
                          {(t.uhrzeit_von || t.uhrzeit_bis) && (
                            <span>🕐 {t.uhrzeit_von?.slice(0, 5)}{t.uhrzeit_bis ? ` – ${t.uhrzeit_bis.slice(0, 5)}` : ''} Uhr</span>
                          )}
                          {t.ort && <span>📍 {t.ort}</span>}
                        </div>
                        {t.beschreibung && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t.beschreibung}</div>
                        )}
                      </div>
                      <button onClick={() => terminLoeschen(t.id)}
                        className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {vergangeneMonat.length > 0 && (
            <details className="group">
              <summary className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none">
                Vergangene Termine ({vergangeneMonat.reduce((s, m) => s + monatsgruppen[m].length, 0)})
              </summary>
              <div className="mt-3 space-y-6 opacity-60">
                {vergangeneMonat.map(monat => (
                  <div key={monat}>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{monatLabel(monat)}</h3>
                    <div className="space-y-2">
                      {monatsgruppen[monat].map(t => (
                        <div key={t.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 flex items-start gap-4">
                          <div className="shrink-0 text-center w-12">
                            <div className="text-2xl font-bold leading-none text-gray-400">{new Date(t.datum + 'T00:00:00').getDate()}</div>
                            <div className="text-xs text-gray-400 uppercase">{WOCHENTAGE[new Date(t.datum + 'T00:00:00').getDay()]}</div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-600 dark:text-gray-300">{t.titel}</div>
                            <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
                              {(t.uhrzeit_von || t.uhrzeit_bis) && <span>🕐 {t.uhrzeit_von?.slice(0, 5)}{t.uhrzeit_bis ? ` – ${t.uhrzeit_bis.slice(0, 5)}` : ''} Uhr</span>}
                              {t.ort && <span>📍 {t.ort}</span>}
                            </div>
                          </div>
                          <button onClick={() => terminLoeschen(t.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none shrink-0">×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* Kalenderabo */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">Outlook-Kalenderabo</h3>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Füge diesen Link in Outlook ein um alle Termine automatisch zu abonnieren:<br />
          Outlook → Kalender → <strong>Aus dem Internet hinzufügen</strong>
        </p>
        {tokenLaden ? (
          <div className="text-xs text-gray-400">Link wird generiert...</div>
        ) : icsToken ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={icsUrl()}
              className="flex-1 text-xs font-mono bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-gray-600 dark:text-gray-300 select-all"
              onClick={e => (e.target as HTMLInputElement).select()}
            />
            <button onClick={tokenKopieren}
              className={`text-sm px-4 py-2 rounded-lg border transition-colors whitespace-nowrap ${tokenKopiert ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400'}`}>
              {tokenKopiert ? '✓ Kopiert' : 'Kopieren'}
            </button>
          </div>
        ) : (
          <div className="text-xs text-red-400">Token konnte nicht generiert werden.</div>
        )}
      </div>
    </div>
  );
}
