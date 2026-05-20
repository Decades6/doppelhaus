'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Position, EigenleistungMaterial } from '@/lib/types';
import { formatEuro, comparePositionNr } from '@/lib/utils';

interface NeuesFormular {
  bezeichnung: string;
  menge: string;
  einheit: string;
  einzelpreis: string;
  gesamtpreis: string;
}

const LEER: NeuesFormular = { bezeichnung: '', menge: '', einheit: 'Stk.', einzelpreis: '', gesamtpreis: '' };

export default function EigenleistungenTab() {
  const [positionen, setPositionen] = useState<Position[]>([]);
  const [materialien, setMaterialien] = useState<EigenleistungMaterial[]>([]);
  const [offeneGewerke, setOffeneGewerke] = useState<Set<string>>(new Set());
  const [formulare, setFormulare] = useState<Record<string, NeuesFormular>>({});
  const [speichernLaden, setSpeichernLaden] = useState<string | null>(null);
  const [laden, setLaden] = useState(true);
  const [loeschenLaden, setLoeschenLaden] = useState<string | null>(null);
  const [bearbeitungId, setBearbeitungId] = useState<string | null>(null);
  const [bearbeitungGewerk, setBearbeitungGewerk] = useState<string | null>(null);

  useEffect(() => { ladeDaten(); }, []);

  async function ladeDaten() {
    const { data: versionen } = await supabase
      .from('versionen').select('id').order('erstellt_am', { ascending: false }).limit(1);

    if (!versionen || versionen.length === 0) { setLaden(false); return; }
    const versionId = versionen[0].id;

    const [{ data: pos }, { data: mat }] = await Promise.all([
      supabase.from('positionen').select('*').eq('version_id', versionId).eq('eigenleistung', true),
      supabase.from('eigenleistung_materialien').select('*').order('created_at', { ascending: true }),
    ]);

    if (pos) {
      setPositionen(pos as Position[]);
      const gewerke = new Set((pos as Position[]).map(p => p.gewerk));
      setOffeneGewerke(gewerke);
    }
    if (mat) setMaterialien(mat as EigenleistungMaterial[]);
    setLaden(false);
  }

  function formularAendern(gewerk: string, feld: keyof NeuesFormular, wert: string) {
    setFormulare(prev => {
      const aktuell = prev[gewerk] ?? { ...LEER };
      const neu = { ...aktuell, [feld]: wert };
      if (feld === 'menge' || feld === 'einzelpreis') {
        const m = parseFloat((feld === 'menge' ? wert : neu.menge).replace(',', '.'));
        const ep = parseFloat((feld === 'einzelpreis' ? wert : neu.einzelpreis).replace(',', '.'));
        if (!isNaN(m) && !isNaN(ep)) neu.gesamtpreis = (m * ep).toFixed(2).replace('.', ',');
      }
      return { ...prev, [gewerk]: neu };
    });
  }

  function bearbeitungStarten(gewerk: string, m: EigenleistungMaterial) {
    setBearbeitungId(m.id);
    setBearbeitungGewerk(gewerk);
    setFormulare(prev => ({
      ...prev,
      [gewerk]: {
        bezeichnung: m.bezeichnung,
        menge: m.menge != null ? String(m.menge).replace('.', ',') : '',
        einheit: m.einheit ?? 'Stk.',
        einzelpreis: m.einzelpreis != null ? String(m.einzelpreis).replace('.', ',') : '',
        gesamtpreis: String(m.gesamtpreis).replace('.', ','),
      },
    }));
  }

  function bearbeitungAbbrechen() {
    if (bearbeitungGewerk) setFormulare(prev => ({ ...prev, [bearbeitungGewerk]: { ...LEER } }));
    setBearbeitungId(null);
    setBearbeitungGewerk(null);
  }

  async function materialHinzufuegen(gewerk: string) {
    const f = formulare[gewerk];
    if (!f?.bezeichnung.trim()) return;
    const gp = parseFloat(f.gesamtpreis.replace(',', '.'));
    if (isNaN(gp) || gp <= 0) return;

    setSpeichernLaden(gewerk);

    if (bearbeitungId) {
      const update = {
        bezeichnung: f.bezeichnung.trim(),
        menge: f.menge ? parseFloat(f.menge.replace(',', '.')) : null,
        einheit: f.einheit || null,
        einzelpreis: f.einzelpreis ? parseFloat(f.einzelpreis.replace(',', '.')) : null,
        gesamtpreis: gp,
      };
      const { error } = await supabase.from('eigenleistung_materialien').update(update).eq('id', bearbeitungId);
      if (!error) {
        setMaterialien(prev => prev.map(m => m.id === bearbeitungId ? { ...m, ...update } : m));
        setFormulare(prev => ({ ...prev, [gewerk]: { ...LEER } }));
        setBearbeitungId(null);
        setBearbeitungGewerk(null);
      }
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('eigenleistung_materialien')
        .insert({ user_id: user?.id, gewerk, bezeichnung: f.bezeichnung.trim(), menge: f.menge ? parseFloat(f.menge.replace(',', '.')) : null, einheit: f.einheit || null, einzelpreis: f.einzelpreis ? parseFloat(f.einzelpreis.replace(',', '.')) : null, gesamtpreis: gp })
        .select().single();

      if (!error && data) {
        setMaterialien(prev => [...prev, data as EigenleistungMaterial]);
        setFormulare(prev => ({ ...prev, [gewerk]: { ...LEER } }));
      }
    }

    setSpeichernLaden(null);
  }

  async function materialLoeschen(id: string) {
    await supabase.from('eigenleistung_materialien').delete().eq('id', id);
    setMaterialien(prev => prev.filter(m => m.id !== id));
  }

  async function positionEntfernen(id: string) {
    setLoeschenLaden(id);
    await supabase.from('positionen').delete().eq('id', id);
    setPositionen(prev => prev.filter(p => p.id !== id));
    setLoeschenLaden(null);
  }

  const gewerke = [...new Set(positionen.map(p => p.gewerk))].sort((a, b) => {
    const aNr = positionen.find(p => p.gewerk === a)?.position_nr ?? null;
    const bNr = positionen.find(p => p.gewerk === b)?.position_nr ?? null;
    return comparePositionNr(aNr, bNr);
  });

  const freiEigenleistungen = materialien.filter(m => m.gewerk === '__frei__');
  const regularMaterialien  = materialien.filter(m => m.gewerk !== '__frei__');

  const gesamtErsparnis      = positionen.reduce((s, p) => s + p.gesamtpreis, 0);
  const gesamtMaterialkosten = regularMaterialien.reduce((s, m) => s + m.gesamtpreis, 0)
                             + freiEigenleistungen.reduce((s, m) => s + m.gesamtpreis, 0);
  const nettoErsparnis = gesamtErsparnis - gesamtMaterialkosten;

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;


  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Eigenleistungs-Planer</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-green-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Ersparnis vom Bauträger</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatEuro(gesamtErsparnis)}</div>
          <div className="text-xs text-gray-400 mt-1">{positionen.length} Positionen · {gewerke.length} Gewerke</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-orange-400">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Eigene Materialkosten</div>
          <div className="text-2xl font-bold text-orange-500 dark:text-orange-400">{formatEuro(gesamtMaterialkosten)}</div>
          <div className="text-xs text-gray-400 mt-1">{regularMaterialien.length} Materialpositionen</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-blue-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Netto-Ersparnis</div>
          <div className={`text-2xl font-bold ${nettoErsparnis >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>{formatEuro(nettoErsparnis)}</div>
          <div className="text-xs text-gray-400 mt-1">Bauträger − Materialien</div>
        </div>
      </div>

      {positionen.length === 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl px-5 py-4 mb-4 text-sm text-amber-800 dark:text-amber-300">
          Noch keine Angebots-Positionen als Eigenleistung markiert. Gehe zum Tab <strong>Angebot</strong> und markiere Positionen.
        </div>
      )}

      {/* Freie Eigenleistungen (kein Angebotsbezug) */}
      {(() => {
        const f = formulare['__frei__'] ?? { ...LEER };
        const isOffen = offeneGewerke.has('__frei__');
        const freiSumme = freiEigenleistungen.reduce((s, m) => s + m.gesamtpreis, 0);
        return (
          <div className="mb-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <button
              onClick={() => setOffeneGewerke(prev => { const next = new Set(prev); isOffen ? next.delete('__frei__') : next.add('__frei__'); return next; })}
              className="w-full bg-gray-50 dark:bg-gray-700 px-6 py-4 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <span className="text-gray-400">{isOffen ? '▼' : '▶'}</span>
                <h3 className="font-semibold text-gray-800 dark:text-white">Eigenleistungen</h3>
                <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">{freiEigenleistungen.length} Einträge</span>
              </div>
              {freiSumme > 0 && (
                <span className="font-bold text-orange-500 dark:text-orange-400">{formatEuro(freiSumme)}</span>
              )}
            </button>

            {isOffen && (
              <div className="p-6 space-y-4">
                {freiEigenleistungen.length > 0 && (
                  <div className="rounded-lg overflow-hidden border border-gray-100 dark:border-gray-600">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-4 py-2 text-left font-medium">Bezeichnung</th>
                          <th className="px-4 py-2 text-right font-medium w-24">Menge</th>
                          <th className="px-4 py-2 text-left font-medium w-16">Einheit</th>
                          <th className="px-4 py-2 text-right font-medium w-28">EP</th>
                          <th className="px-4 py-2 text-right font-medium w-28">GP</th>
                          <th className="px-4 py-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                        {freiEigenleistungen.map(m => (
                          <tr key={m.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bearbeitungId === m.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                            <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{m.bezeichnung}</td>
                            <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{m.menge ?? '–'}</td>
                            <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{m.einheit ?? '–'}</td>
                            <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{m.einzelpreis != null ? formatEuro(m.einzelpreis) : '–'}</td>
                            <td className="px-4 py-2 text-right font-medium text-orange-600 dark:text-orange-400">{formatEuro(m.gesamtpreis)}</td>
                            <td className="px-4 py-2 text-center whitespace-nowrap">
                              <button onClick={() => bearbeitungStarten('__frei__', m)} className="text-gray-300 hover:text-amber-500 transition-colors mr-1" title="Bearbeiten">✎</button>
                              <button onClick={() => materialLoeschen(m.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-40">
                    <label className="text-xs text-gray-400 mb-1 block">Bezeichnung</label>
                    <input value={f.bezeichnung} onChange={e => formularAendern('__frei__', 'bezeichnung', e.target.value)} onKeyDown={e => e.key === 'Enter' && materialHinzufuegen('__frei__')}
                      placeholder="z.B. Malerarbeiten Wohnung 1"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-gray-400 mb-1 block">Menge</label>
                    <input value={f.menge} onChange={e => formularAendern('__frei__', 'menge', e.target.value)} placeholder="10"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div className="w-24">
                    <label className="text-xs text-gray-400 mb-1 block">Einheit</label>
                    <input value={f.einheit} onChange={e => formularAendern('__frei__', 'einheit', e.target.value)} placeholder="Std."
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-gray-400 mb-1 block">Einzelpreis €</label>
                    <input value={f.einzelpreis} onChange={e => formularAendern('__frei__', 'einzelpreis', e.target.value)} placeholder="25,00"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  <div className="w-28">
                    <label className="text-xs text-gray-400 mb-1 block">Gesamtpreis €</label>
                    <input value={f.gesamtpreis} onChange={e => formularAendern('__frei__', 'gesamtpreis', e.target.value)} placeholder="250,00"
                      className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                  </div>
                  {bearbeitungId && bearbeitungGewerk === '__frei__' && (
                    <button onClick={bearbeitungAbbrechen}
                      className="text-sm text-gray-500 dark:text-gray-400 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap">
                      Abbrechen
                    </button>
                  )}
                  <button onClick={() => materialHinzufuegen('__frei__')} disabled={speichernLaden === '__frei__' || !f.bezeichnung.trim()}
                    className={`text-sm text-white px-4 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap ${bearbeitungId && bearbeitungGewerk === '__frei__' ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                    {speichernLaden === '__frei__' ? '...' : bearbeitungId && bearbeitungGewerk === '__frei__' ? 'Speichern' : '+ Hinzufügen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      <div className="space-y-4">
        {gewerke.map(gewerk => {
          const gwPos = positionen.filter(p => p.gewerk === gewerk).sort((a, b) => comparePositionNr(a.position_nr, b.position_nr));
          const gwMat = regularMaterialien.filter(m => m.gewerk === gewerk);
          const gwErsparnis = gwPos.reduce((s, p) => s + p.gesamtpreis, 0);
          const gwMaterialkosten = gwMat.reduce((s, m) => s + m.gesamtpreis, 0);
          const gwNetto = gwErsparnis - gwMaterialkosten;
          const isOffen = offeneGewerke.has(gewerk);
          const f = formulare[gewerk] ?? { ...LEER };

          return (
            <div key={gewerk} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
              <button
                onClick={() => setOffeneGewerke(prev => { const next = new Set(prev); isOffen ? next.delete(gewerk) : next.add(gewerk); return next; })}
                className="w-full bg-gray-50 dark:bg-gray-700 px-6 py-4 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{isOffen ? '▼' : '▶'}</span>
                  <h3 className="font-semibold text-gray-800 dark:text-white">{gewerk}</h3>
                  <span className="text-xs text-gray-400 bg-gray-200 dark:bg-gray-600 px-2 py-0.5 rounded-full">{gwPos.length} Pos.</span>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-gray-400 dark:text-gray-500">Bauträger: <span className="font-medium text-gray-700 dark:text-gray-200">{formatEuro(gwErsparnis)}</span></span>
                  {gwMaterialkosten > 0 && <span className="text-orange-500">Material: {formatEuro(gwMaterialkosten)}</span>}
                  <span className={`font-bold ${gwNetto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>Netto: {gwNetto >= 0 ? '+' : ''}{formatEuro(gwNetto)}</span>
                </div>
              </button>

              {isOffen && (
                <div className="p-6 space-y-6">
                  <div>
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Positionen vom Bauträger (Eigenleistung)</h4>
                    <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-600">
                          {gwPos.map(p => (
                            <tr key={p.id} className={p.nicht_im_angebot ? 'bg-orange-50 dark:bg-orange-900/20' : ''}>
                              <td className="px-4 py-2 text-xs text-gray-400 w-16">{p.position_nr || '–'}</td>
                              <td className="px-4 py-2 text-gray-700 dark:text-gray-200">
                                <div className="flex items-center gap-2 flex-wrap">
                                  {p.nicht_im_angebot && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-400 font-medium shrink-0">Nicht mehr im Angebot</span>}
                                  <span className={p.nicht_im_angebot ? 'text-gray-400 dark:text-gray-500' : ''}>{p.beschreibung}</span>
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap w-32">{p.menge != null ? `${p.menge} ${p.einheit || ''}`.trim() : ''}</td>
                              <td className="px-4 py-2 text-right font-medium text-gray-800 dark:text-white whitespace-nowrap w-28">{formatEuro(p.gesamtpreis)}</td>
                              <td className="px-4 py-2 text-center w-10">
                                {p.nicht_im_angebot && (
                                  <button onClick={() => positionEntfernen(p.id)} disabled={loeschenLaden === p.id}
                                    className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none disabled:opacity-50" title="Position entfernen">×</button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Meine Materialliste</h4>
                    {gwMat.length > 0 && (
                      <div className="mb-3 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-600">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400">
                              <th className="px-4 py-2 text-left font-medium">Bezeichnung</th>
                              <th className="px-4 py-2 text-right font-medium w-24">Menge</th>
                              <th className="px-4 py-2 text-left font-medium w-16">Einheit</th>
                              <th className="px-4 py-2 text-right font-medium w-28">EP</th>
                              <th className="px-4 py-2 text-right font-medium w-28">GP</th>
                              <th className="px-4 py-2 w-10"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                            {gwMat.map(m => (
                              <tr key={m.id} className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bearbeitungId === m.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
                                <td className="px-4 py-2 text-gray-800 dark:text-gray-200">{m.bezeichnung}</td>
                                <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-300">{m.menge ?? '–'}</td>
                                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{m.einheit ?? '–'}</td>
                                <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">{m.einzelpreis != null ? formatEuro(m.einzelpreis) : '–'}</td>
                                <td className="px-4 py-2 text-right font-medium text-orange-600 dark:text-orange-400">{formatEuro(m.gesamtpreis)}</td>
                                <td className="px-4 py-2 text-center whitespace-nowrap">
                                  <button onClick={() => bearbeitungStarten(gewerk, m)} className="text-gray-300 hover:text-amber-500 transition-colors mr-1" title="Bearbeiten">✎</button>
                                  <button onClick={() => materialLoeschen(m.id)} className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">×</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <div className="flex gap-2 items-end flex-wrap">
                      <div className="flex-1 min-w-40">
                        <label className="text-xs text-gray-400 mb-1 block">Bezeichnung</label>
                        <input value={f.bezeichnung} onChange={e => formularAendern(gewerk, 'bezeichnung', e.target.value)} onKeyDown={e => e.key === 'Enter' && materialHinzufuegen(gewerk)}
                          placeholder="z.B. Fliesen 60×60"
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="w-20">
                        <label className="text-xs text-gray-400 mb-1 block">Menge</label>
                        <input value={f.menge} onChange={e => formularAendern(gewerk, 'menge', e.target.value)} placeholder="10"
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="w-24">
                        <label className="text-xs text-gray-400 mb-1 block">Einheit</label>
                        <input value={f.einheit} onChange={e => formularAendern(gewerk, 'einheit', e.target.value)} placeholder="m²"
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="w-28">
                        <label className="text-xs text-gray-400 mb-1 block">Einzelpreis €</label>
                        <input value={f.einzelpreis} onChange={e => formularAendern(gewerk, 'einzelpreis', e.target.value)} placeholder="25,00"
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      <div className="w-28">
                        <label className="text-xs text-gray-400 mb-1 block">Gesamtpreis €</label>
                        <input value={f.gesamtpreis} onChange={e => formularAendern(gewerk, 'gesamtpreis', e.target.value)} placeholder="250,00"
                          className="w-full text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100" />
                      </div>
                      {bearbeitungId && bearbeitungGewerk === gewerk && (
                        <button onClick={bearbeitungAbbrechen}
                          className="text-sm text-gray-500 dark:text-gray-400 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-gray-400 transition-colors whitespace-nowrap">
                          Abbrechen
                        </button>
                      )}
                      <button onClick={() => materialHinzufuegen(gewerk)} disabled={speichernLaden === gewerk || !f.bezeichnung.trim()}
                        className={`text-sm text-white px-4 py-2 rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap ${bearbeitungId && bearbeitungGewerk === gewerk ? 'bg-amber-500 hover:bg-amber-600' : 'bg-blue-600 hover:bg-blue-700'}`}>
                        {speichernLaden === gewerk ? '...' : bearbeitungId && bearbeitungGewerk === gewerk ? 'Speichern' : '+ Hinzufügen'}
                      </button>
                    </div>
                  </div>

                  {gwMat.length > 0 && (
                    <div className="flex justify-end">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded-lg px-5 py-3 text-sm space-y-1 min-w-64">
                        <div className="flex justify-between text-gray-500 dark:text-gray-400">
                          <span>Bauträger-Ersparnis</span>
                          <span className="font-medium text-gray-700 dark:text-gray-200">{formatEuro(gwErsparnis)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500 dark:text-gray-400">
                          <span>Eigene Materialkosten</span>
                          <span className="font-medium text-orange-500">− {formatEuro(gwMaterialkosten)}</span>
                        </div>
                        <div className="flex justify-between font-bold border-t border-gray-200 dark:border-gray-600 pt-1 mt-1">
                          <span className="text-gray-700 dark:text-white">Netto-Ersparnis</span>
                          <span className={gwNetto >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>{formatEuro(gwNetto)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
