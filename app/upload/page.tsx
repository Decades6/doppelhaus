'use client';

import { useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ParsedPosition } from '@/lib/types';
import { useRouter } from 'next/navigation';

function formatEuro(amount: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [schritt, setSchritt] = useState<'upload' | 'pruefen' | 'speichern'>('upload');
  const [laden, setLaden] = useState(false);
  const [fehler, setFehler] = useState('');
  const [positionen, setPositionen] = useState<ParsedPosition[]>([]);
  const [dateiname, setDateiname] = useState('');

  async function handleDateiWahl(file: File) {
    if (!file || file.type !== 'application/pdf') {
      setFehler('Bitte nur PDF-Dateien hochladen.');
      return;
    }

    setFehler('');
    setLaden(true);
    setDateiname(file.name);

    const formData = new FormData();
    formData.append('pdf', file);

    try {
      const res = await fetch('/api/parse-pdf', {
        method: 'POST',
        body: formData,
      });

      const json = await res.json();

      if (!res.ok) {
        setFehler(json.error || 'Fehler beim Verarbeiten der PDF.');
        setLaden(false);
        return;
      }

      if (json.positionen.length === 0) {
        setFehler('Es konnten keine Positionen erkannt werden. Das PDF hat möglicherweise ein ungewöhnliches Format.');
        setLaden(false);
        return;
      }

      // Direkt speichern ohne Zwischenschritt
      await speichernMitDaten(json.positionen);
    } catch {
      setFehler('Verbindungsfehler. Bitte versuche es erneut.');
      setLaden(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleDateiWahl(file);
  }

  function positionAendern(index: number, feld: keyof ParsedPosition, wert: string) {
    setPositionen(prev => {
      const neu = [...prev];
      if (feld === 'gesamtpreis' || feld === 'einzelpreis' || feld === 'menge') {
        const zahl = parseFloat(wert.replace(',', '.'));
        (neu[index] as unknown as Record<string, unknown>)[feld] = isNaN(zahl) ? undefined : zahl;
      } else {
        (neu[index] as unknown as Record<string, unknown>)[feld] = wert;
      }
      return neu;
    });
  }

  function positionLoeschen(index: number) {
    setPositionen(prev => prev.filter((_, i) => i !== index));
  }

  function positionHinzufuegen() {
    setPositionen(prev => [
      ...prev,
      {
        gewerk: prev.length > 0 ? prev[prev.length - 1].gewerk : 'Allgemein',
        beschreibung: '',
        gesamtpreis: 0,
      },
    ]);
  }

  async function speichernMitDaten(daten: ParsedPosition[]) {
    const gueltige = daten.filter(p => p.beschreibung.trim() && p.gesamtpreis >= 0);
    setLaden(true);
    setFehler('');

    // Neue Version anlegen
    const versionName = dateiname || `Angebot ${new Date().toLocaleDateString('de-DE')}`;
    const { data: version, error: versionFehler } = await supabase
      .from('versionen')
      .insert({ name: versionName })
      .select()
      .single();

    if (versionFehler || !version) {
      setFehler('Fehler beim Anlegen der Version: ' + (versionFehler?.message || ''));
      setLaden(false);
      return;
    }

    const { error } = await supabase.from('positionen').insert(
      gueltige.map(p => ({
        version_id: version.id,
        position_nr: p.position_nr || null,
        gewerk: p.gewerk || 'Allgemein',
        beschreibung: p.beschreibung,
        menge: p.menge || null,
        einheit: p.einheit || null,
        einzelpreis: p.einzelpreis || null,
        gesamtpreis: p.gesamtpreis,
        eigenleistung: false,
      }))
    );

    setLaden(false);

    if (error) {
      setFehler('Fehler beim Speichern: ' + error.message);
      return;
    }

    setSchritt('speichern');
    setTimeout(() => { window.location.href = '/'; }, 1500);
  }

  async function speichern() {
    await speichernMitDaten(positionen);
  }

  const gesamtsumme = positionen.reduce((sum, p) => sum + (p.gesamtpreis || 0), 0);

  // Schritt 1: Upload
  if (schritt === 'upload') {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Angebot hochladen</h1>
        <p className="text-gray-500 mb-8">
          Lade das PDF-Angebot eures Bauträgers hoch. Wir lesen alle Positionen automatisch aus.
        </p>

        {fehler && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {fehler}
          </div>
        )}

        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded-2xl p-16 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all"
        >
          {laden ? (
            <div>
              <div className="text-4xl mb-4">⏳</div>
              <p className="text-gray-600 font-medium">PDF wird ausgelesen...</p>
              <p className="text-gray-400 text-sm mt-1">Das kann einen Moment dauern</p>
            </div>
          ) : (
            <div>
              <div className="text-5xl mb-4">📄</div>
              <p className="text-gray-700 font-semibold text-lg">PDF hierher ziehen</p>
              <p className="text-gray-400 mt-2">oder klicken zum Auswählen</p>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) handleDateiWahl(file);
          }}
        />
      </div>
    );
  }

  // Schritt 3: Erfolgreich gespeichert
  if (schritt === 'speichern') {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Erfolgreich gespeichert!</h2>
        <p className="text-gray-500 mb-4">Du wirst gleich weitergeleitet...</p>
        <a href="/" className="text-blue-600 hover:underline text-sm">
          → Jetzt zum Dashboard
        </a>
      </div>
    );
  }

  // Schritt 2: Überprüfen
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Positionen prüfen</h1>
          <p className="text-gray-500 text-sm mt-1">
            {positionen.length} Positionen aus &quot;{dateiname}&quot; erkannt
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSchritt('upload')}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 border border-gray-300 rounded-lg"
          >
            Andere PDF
          </button>
          <button
            onClick={speichern}
            disabled={laden}
            className="text-sm bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
          >
            {laden ? 'Wird gespeichert...' : `${positionen.length} Positionen speichern`}
          </button>
        </div>
      </div>

      {fehler && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 mb-4 text-sm">
          {fehler}
        </div>
      )}

      {positionen.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg px-4 py-3 mb-4 text-sm">
          Keine Positionen automatisch erkannt. Füge sie bitte manuell hinzu.
        </div>
      )}

      {/* Gesamtsumme */}
      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex items-center justify-between">
        <span className="text-gray-600 font-medium">Gesamtsumme der erkannten Positionen</span>
        <span className="text-xl font-bold text-gray-900">{formatEuro(gesamtsumme)}</span>
      </div>

      {/* Tabelle */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
                <th className="px-3 py-3 text-left font-medium w-20">Pos.</th>
                <th className="px-3 py-3 text-left font-medium w-36">Gewerk</th>
                <th className="px-3 py-3 text-left font-medium">Beschreibung</th>
                <th className="px-3 py-3 text-right font-medium w-20">Menge</th>
                <th className="px-3 py-3 text-left font-medium w-16">Einheit</th>
                <th className="px-3 py-3 text-right font-medium w-28">GP (€)</th>
                <th className="px-3 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {positionen.map((p, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input
                      value={p.position_nr || ''}
                      onChange={e => positionAendern(i, 'position_nr', e.target.value)}
                      className="w-full text-xs text-gray-600 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={p.gewerk}
                      onChange={e => positionAendern(i, 'gewerk', e.target.value)}
                      className="w-full text-xs text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={p.beschreibung}
                      onChange={e => positionAendern(i, 'beschreibung', e.target.value)}
                      className="w-full text-gray-800 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={p.menge ?? ''}
                      onChange={e => positionAendern(i, 'menge', e.target.value)}
                      className="w-full text-right text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={p.einheit || ''}
                      onChange={e => positionAendern(i, 'einheit', e.target.value)}
                      className="w-full text-gray-700 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                      placeholder="–"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={p.gesamtpreis}
                      onChange={e => positionAendern(i, 'gesamtpreis', e.target.value)}
                      className="w-full text-right font-medium text-gray-900 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded px-1 py-0.5 outline-none"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => positionLoeschen(i)}
                      className="text-gray-400 hover:text-red-400 transition-colors text-lg leading-none"
                      title="Position löschen"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <button
        onClick={positionHinzufuegen}
        className="text-sm text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 px-4 py-2 rounded-lg transition-colors"
      >
        + Position manuell hinzufügen
      </button>
    </div>
  );
}
