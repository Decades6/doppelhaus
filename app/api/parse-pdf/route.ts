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

    const buffer = await file.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Analysiere dieses deutsche Bauangebot (Leistungsverzeichnis) und extrahiere alle Positionen.

Für jede Position extrahiere:
- position_nr: Die Positionsnummer (z.B. "1.1.1", "2.3.4") ohne abschließenden Punkt
- gewerk: Das übergeordnete Gewerk/die Kategorie (Abschnittsüberschrift)
- beschreibung: NUR der kurze Titel der Position (oft fettgedruckt), NICHT den langen Beschreibungstext
- menge: Die Menge als Zahl
- einheit: Die Einheit (z.B. "m²", "Stück", "pauschal", "lfdm", "Woch.")
- einzelpreis: Der Einzelpreis als Zahl (deutsche Kommas in Punkte umwandeln, ohne €)
- gesamtpreis: Der Gesamtpreis als Zahl (deutsche Kommas in Punkte umwandeln, ohne €)

Antworte NUR mit einem gültigen JSON-Array, ohne Markdown-Blöcke, ohne erklärenden Text:
[
  {
    "position_nr": "1.1.1",
    "gewerk": "Baustelleneinrichtung",
    "beschreibung": "Baustelle einrichten",
    "menge": 1,
    "einheit": "pauschal",
    "einzelpreis": 1000.00,
    "gesamtpreis": 1000.00
  }
]

Wichtige Regeln:
- Nur Positionen mit Gesamtpreis > 0
- Keine Summenzeilen, Übertragzeilen oder Gewerke-Überschriften als eigene Positionen
- Keine Eventual- oder Alternativpositionen
- Deutsche Zahlen umrechnen: "1.234,56" → 1234.56`,
            },
          ],
        },
      ],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // JSON extrahieren (Markdown-Blöcke entfernen falls vorhanden)
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
    console.error('PDF parse error:', error);
    return NextResponse.json(
      { error: 'Fehler beim Verarbeiten der PDF. Bitte versuche es erneut.' },
      { status: 500 }
    );
  }
}
