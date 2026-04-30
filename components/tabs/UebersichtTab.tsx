'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatEuro } from '@/lib/utils';

interface UebersichtDaten {
  nettosumme: number;
  versionName: string;
  eigenleistungNetto: number;
  materialkosten: number;
  weitereKosten: number;
  bezahlt: number;
  anzahlPositionen: number;
  anzahlEigenleistung: number;
}

export default function UebersichtTab({ onTabWechsel }: { onTabWechsel: (tab: string) => void }) {
  const [daten, setDaten] = useState<UebersichtDaten | null>(null);
  const [laden, setLaden] = useState(true);

  useEffect(() => { ladeDaten(); }, []);

  async function ladeDaten() {
    const { data: versionen } = await supabase
      .from('versionen').select('id, name, nettosumme')
      .order('erstellt_am', { ascending: false }).limit(1);

    if (!versionen || versionen.length === 0) { setLaden(false); return; }
    const v = versionen[0];

    const [
      { data: pos },
      { data: eigenPos },
      { data: mat },
      { data: kosten },
      { data: zahlungen },
    ] = await Promise.all([
      supabase.from('positionen').select('id').eq('version_id', v.id),
      supabase.from('positionen').select('gesamtpreis').eq('version_id', v.id).eq('eigenleistung', true).eq('nicht_im_angebot', false),
      supabase.from('eigenleistung_materialien').select('gesamtpreis'),
      supabase.from('kosten_manuell').select('betrag'),
      supabase.from('zahlungen').select('betrag'),
    ]);

    setDaten({
      nettosumme: v.nettosumme ?? 0,
      versionName: v.name,
      eigenleistungNetto: (eigenPos ?? []).reduce((s, p) => s + p.gesamtpreis, 0),
      materialkosten: (mat ?? []).reduce((s, m) => s + m.gesamtpreis, 0),
      weitereKosten: (kosten ?? []).reduce((s, k) => s + (k.betrag ?? 0), 0),
      bezahlt: (zahlungen ?? []).reduce((s, z) => s + z.betrag, 0),
      anzahlPositionen: pos?.length ?? 0,
      anzahlEigenleistung: eigenPos?.length ?? 0,
    });
    setLaden(false);
  }

  if (laden) return <div className="text-center py-16 text-gray-500">Lade Daten...</div>;

  if (!daten || daten.nettosumme === 0) {
    return (
      <div className="text-center py-20">
        <div className="text-7xl mb-6">📋</div>
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-white mb-3">Noch kein Angebot hochgeladen</h2>
        <p className="text-gray-500 mb-8">Lade euer PDF-Angebot vom Bauträger hoch um loszulegen.</p>
        <a href="/upload" className="bg-blue-600 text-white px-8 py-3 rounded-xl text-lg hover:bg-blue-700 transition-colors">
          Angebot hochladen
        </a>
      </div>
    );
  }

  const bautraegerBrutto = (daten.nettosumme - daten.eigenleistungNetto) * 1.19;
  const gesamtFinanzierung = bautraegerBrutto + daten.materialkosten + daten.weitereKosten;
  const nochOffen = Math.max(0, gesamtFinanzierung - daten.bezahlt);
  const fortschritt = gesamtFinanzierung > 0 ? Math.min(100, (daten.bezahlt / gesamtFinanzierung) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Hauptkennzahlen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-gray-700 dark:border-gray-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Gesamtfinanzierungsbedarf</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{formatEuro(gesamtFinanzierung)}</div>
          <div className="text-xs text-gray-400 mt-1">inkl. aller Kosten & MwSt.</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-green-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Bereits bezahlt</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{formatEuro(daten.bezahlt)}</div>
          <div className="text-xs text-gray-400 mt-1">{fortschritt.toFixed(0)} % des Gesamtbetrags</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">Noch offen</div>
          <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{formatEuro(nochOffen)}</div>
          <div className="text-xs text-gray-400 mt-1">verbleibend</div>
        </div>
      </div>

      {/* Fortschrittsbalken */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Zahlungsfortschritt</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{fortschritt.toFixed(1)} %</span>
        </div>
        <div className="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-3">
          <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${fortschritt}%` }} />
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-2">
          <span>{formatEuro(daten.bezahlt)} bezahlt</span>
          <span>{formatEuro(nochOffen)} offen</span>
        </div>
      </div>

      {/* Bereiche */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <button onClick={() => onTabWechsel('angebot')}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-all text-left group hover:shadow-md">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-3">Angebot</div>
          <div className="text-xl font-bold text-gray-900 dark:text-white mb-1">{formatEuro(bautraegerBrutto)}</div>
          <div className="text-xs text-gray-400 mb-3">Bauträger brutto inkl. MwSt.</div>
          <div className="text-xs text-gray-400">{daten.anzahlPositionen} Positionen · {daten.versionName}</div>
          <div className="text-xs text-blue-500 mt-3 group-hover:underline">→ Zum Angebot</div>
        </button>

        <button onClick={() => onTabWechsel('eigenleistungen')}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-600 transition-all text-left group hover:shadow-md">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-3">Eigenleistungen</div>
          <div className="text-xl font-bold text-green-600 dark:text-green-400 mb-1">− {formatEuro(daten.eigenleistungNetto)}</div>
          <div className="text-xs text-gray-400 mb-3">Ersparnis vom Bauträger</div>
          <div className="text-xs text-gray-400">{daten.anzahlEigenleistung} Positionen markiert</div>
          <div className="text-xs text-blue-500 mt-3 group-hover:underline">→ Zu Eigenleistungen</div>
        </button>

        <button onClick={() => onTabWechsel('kosten')}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-600 transition-all text-left group hover:shadow-md">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-3">Kosten</div>
          <div className="text-xl font-bold text-gray-700 dark:text-gray-200 mb-1">{formatEuro(daten.materialkosten + daten.weitereKosten)}</div>
          <div className="text-xs text-gray-400 mb-3">Material + Weitere Kosten</div>
          <div className="text-xs text-gray-400">Notar, Anschlüsse, Material etc.</div>
          <div className="text-xs text-blue-500 mt-3 group-hover:underline">→ Zur Kostenübersicht</div>
        </button>

        <button onClick={() => onTabWechsel('zahlungen')}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border border-gray-100 dark:border-gray-700 hover:border-orange-300 dark:hover:border-orange-600 transition-all text-left group hover:shadow-md">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-3">Zahlungen</div>
          <div className="text-xl font-bold text-green-600 dark:text-green-400 mb-1">{formatEuro(daten.bezahlt)}</div>
          <div className="text-xs text-gray-400 mb-3">bereits bezahlt</div>
          <div className="text-xs text-gray-400">{fortschritt.toFixed(0)} % des Gesamtbetrags</div>
          <div className="text-xs text-blue-500 mt-3 group-hover:underline">→ Zu Zahlungen</div>
        </button>
      </div>
    </div>
  );
}
