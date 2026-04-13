import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ParsedPosition } from '@/lib/types';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Filtert den PDF-Text auf das Wesentliche:
 * Nur Gewerk-Überschriften, erste Zeile jeder Position und Preiszeilen.
 * Das reduziert den Text drastisch und macht Claude schneller.
 */
function vorfiltern(text: string): string {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);

  const posNrRx    = /^\d+\.\d+\.\d/;          // Positionszeile: 1.1.3 ...
  const gewerkRx   = /^\d+\.\d+\.[A-ZÄÖÜ]/;    // Gewerk-Überschrift: 1.1.Rohbau
  const preisRx    = /\d{1,3}(?:\.\d{3})*,\d{2}\s*$/; // Zeile endet mit Preis
  const skipRx     = /^(Summe |Zwischensumme |Übertrag|Nettosumme|Bruttosumme|zzgl\.|Seite \d)/i;

  const result: string[] = [];
  let inPos = false;
  let preisGesehen = false;

  for (const line of lines) {
    if (skipRx.test(line)) { inPos = false; preisGesehen = false; continue; }

    if (gewerkRx.test(line) && !posNrRx.test(line)) {
      result.push(line);
      inPos = false;
      continue;
    }

    if (posNrRx.test(line)) {
      // Neue Position: erste Zeile immer behalten
      result.push(line);
      inPos = true;
      preisGesehen = false;
      continue;
    }

    if (inPos && !preisGesehen && preisRx.test(line)) {
      result.push(line);
      preisGesehen = true;
      continue;
    }

    // Lange Beschreibungstexte überspringen
  }

  return result.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('pdf') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Keine Datei hochgeladen' }, { status: 400 });
    }
    if (file.type !== 'application/pdf') {
      return NextResponse.json({ error: 'Bitte nur PDF-Dateien hochladen' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Text aus PDF extrahieren
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfModule = await import('pdf-parse') as any;
    const pdfParse = pdfModule.default ?? pdfModule;
    const pdfData = await pdfParse(buffer);

    // Nur relevante Zeilen an Claude schicken
    const gefilterterText = vorfiltern(pdfData.text);

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Du bist Experte für deutsche Leistungsverzeichnisse.

Der Text unten wurde aus einer PDF extrahiert. Einheiten kleben manchmal am Kurztitel:
- "StückBauschuttcontainer" → Einheit "Stück", Beschreibung "Bauschuttcontainer bis 5 m³"
- "psch.Baustelle einrichten" → Einheit "psch.", Beschreibung "Baustelle einrichten"
- "ückBauschuttcontainer" → Einheit "Stück" (abgeschnitten), Beschreibung "Bauschuttcontainer..."
- "Woch.Baustellen-WC" → Einheit "Woch.", Beschreibung "Baustellen-WC"

Extrahiere alle Positionen. Antworte NUR mit JSON-Array:
[{"position_nr":"1.1.1","gewerk":"Baustelleneinrichtung","beschreibung":"Kurzer Titel","menge":1,"einheit":"Stück","einzelpreis":250.00,"gesamtpreis":250.00}]

Regeln:
- Nur Positionen mit Gesamtpreis > 0
- Keine Summenzeilen oder Gewerk-Überschriften
- Deutsche Zahlen: "1.234,56" → 1234.56
- position_nr ohne abschließenden Punkt

Text:
${gefilterterText}`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const cleaned = responseText.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Claude konnte keine Positionen erkennen. Bitte versuche es erneut.' },
        { status: 500 }
      );
    }

    const positionen: ParsedPosition[] = JSON.parse(jsonMatch[0]);
    const gueltige = positionen.filter(p => p.gesamtpreis > 0 && p.beschreibung);

    return NextResponse.json({ positionen: gueltige, anzahl: gueltige.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('PDF parse error:', msg);
    return NextResponse.json(
      { error: `Fehler beim Verarbeiten der PDF: ${msg}` },
      { status: 500 }
    );
  }
}
