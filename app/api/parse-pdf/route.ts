import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ParsedPosition } from '@/lib/types';

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
    const text = pdfData.text;

    // Claude analysiert den Text intelligent
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: `Du bist Experte für deutsche Leistungsverzeichnisse im Bauwesen.

Der folgende Text wurde automatisch aus einer PDF extrahiert. Dabei wurden Spalten manchmal zusammengeklebt, z.B.:
- "StückBauschuttcontainer" → Einheit "Stück" wurde mit dem Kurztitel zusammengeklebt
- "psch.Baustelle einrichten" → Einheit "psch." klebt am Kurztitel
- "Woch.Baustellen-WC" → Einheit "Woch." klebt am Kurztitel
- "ückBauschuttcontainer" → "St" von "Stück" fehlt, Rest klebt am Titel

Bitte extrahiere alle Positionen korrekt und trenne dabei Einheiten von Beschreibungen.

Regeln:
- Nur echte Positionen mit Positionsnummer (z.B. 1.1.1, 2.3.4)
- Keine Summenzeilen, Übertragzeilen oder Gewerk-Überschriften
- Keine Eventual- oder Alternativpositionen
- Nur Positionen mit Gesamtpreis > 0
- Deutsche Zahlen umrechnen: "1.234,56" → 1234.56
- beschreibung = nur der kurze Titel, nicht der lange Beschreibungstext

Antworte NUR mit einem JSON-Array ohne Markdown:
[
  {
    "position_nr": "1.1.1",
    "gewerk": "Baustelleneinrichtung",
    "beschreibung": "Bauschuttcontainer bis 5 m³",
    "menge": 1,
    "einheit": "Stück",
    "einzelpreis": 250.00,
    "gesamtpreis": 250.00
  }
]

Hier ist der extrahierte Text:
${text}`,
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // JSON extrahieren
    const cleaned = responseText
      .replace(/^```json?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'Claude konnte keine Positionen erkennen. Bitte versuche es erneut.' },
        { status: 500 }
      );
    }

    const positionen: ParsedPosition[] = JSON.parse(jsonMatch[0]);
    const gueltige = positionen.filter(p => p.gesamtpreis > 0 && p.beschreibung);

    return NextResponse.json({
      positionen: gueltige,
      anzahl: gueltige.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('PDF parse error:', msg);
    return NextResponse.json(
      { error: `Fehler beim Verarbeiten der PDF: ${msg}` },
      { status: 500 }
    );
  }
}
