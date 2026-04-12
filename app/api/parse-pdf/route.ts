import { NextRequest, NextResponse } from 'next/server';
import { ParsedPosition } from '@/lib/types';

// ─── Fallback: Regex-Parser ───────────────────────────────────────────────────

function parseGermanNumber(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

function parseLeistungsverzeichnis(text: string): ParsedPosition[] {
  const positionen: ParsedPosition[] = [];

  // 1. Remove repeating page headers/footers
  const clean = text
    .replace(/Angebot - Entwurf[\s\S]*?Pos\.MengeEinheitBeschreibungPreisGesamt\n/g, '')
    .replace(/Übertrag:[^\n]*\n?/g, '')
    .replace(/Seite \d+ von \d+[^\n]*\n?/g, '')
    .replace(/Nettosumme[\s\S]*/g, ''); // everything after Nettosumme is footer

  const lines = clean.split('\n').map(l => l.trim());

  // 2. Collect position blocks
  const gewerkRx = /^(\d+\.\d+\.)([A-ZÄÖÜa-zäöüß].{3,})/;
  const skipRx = /^(Summe \d|Zwischensumme|Nettosumme|Bruttosumme|zzgl\.|MwSt)/i;
  const posNrRx3 = /^(\d+\.\d+\.\d+(?:\.\d+)*\.)/;
  const posNrRx2 = /^(\d+\.\d+\.)(?=\d)/;
  const closingRx = /^(Summe |Zwischensumme )/i;

  let currentGewerk = 'Allgemein';
  const blocks: { posNr: string; gewerk: string; lines: string[] }[] = [];
  let current: { posNr: string; gewerk: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (!line) continue;

    if (closingRx.test(line) || skipRx.test(line)) {
      if (current) { blocks.push(current); current = null; }
      continue;
    }

    const gwMatch = line.match(gewerkRx);
    if (gwMatch && !posNrRx3.test(line) && !posNrRx2.test(line)) {
      currentGewerk = gwMatch[2].trim();
      continue;
    }

    const posMatch = line.match(posNrRx3) || line.match(posNrRx2);
    if (posMatch) {
      if (current) blocks.push(current);
      current = { posNr: posMatch[1], gewerk: currentGewerk, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  // 3. Parse each block
  const priceRx = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const parenthesizedPriceRx = /\(\d{1,3}(?:\.\d{3})*,\d{2}\)/;
  const priceLineRx = /\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;
  const unitList = 'm²|m2|m³|m3|lfdm|lfm|Stk\\.?|St\\.?|Psch\\.?|psch\\.?|Woch\\.?|kg|VE|Pkg\\.?|Std\\.?|xWo\\.?|\\bm\\b|qm';
  const unitRx = new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${unitList})`, 'i');

  for (const block of blocks) {
    const fullText = block.lines.join(' ');

    if (/\b(Eventual|Alternativ)\b/.test(fullText)) continue;
    if (parenthesizedPriceRx.test(fullText)) continue;

    const priceLine = [...block.lines].reverse().find(l => priceLineRx.test(l));
    if (!priceLine) continue;

    const allPrices = [...priceLine.matchAll(priceRx)];
    if (allPrices.length === 0) continue;

    const gesamtpreis = parseGermanNumber(allPrices[allPrices.length - 1][1]);
    if (gesamtpreis <= 0) continue;

    let einzelpreis: number | undefined;
    if (allPrices.length >= 2) {
      const ep = parseGermanNumber(allPrices[allPrices.length - 2][1]);
      if (ep !== gesamtpreis) einzelpreis = ep;
    }

    const firstLine = block.lines[0].replace(posNrRx3, '').replace(posNrRx2, '').trim();
    const unitMatch = firstLine.match(unitRx);
    let menge: number | undefined;
    let einheit: string | undefined;
    let descRaw = firstLine;
    if (unitMatch) {
      menge = parseGermanNumber(unitMatch[1]);
      einheit = unitMatch[2];
      descRaw = firstLine.replace(unitMatch[0], '').trim();
    }

    const beschreibung = descRaw
      .replace(/\d{1,3}(?:\.\d{3})*,\d{2}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    positionen.push({
      position_nr: block.posNr.replace(/\.$/, ''),
      gewerk: block.gewerk,
      beschreibung: beschreibung || `Position ${block.posNr}`,
      menge,
      einheit,
      einzelpreis,
      gesamtpreis,
    });
  }

  return positionen;
}

// ─── Claude AI Parser ─────────────────────────────────────────────────────────

async function parseWithClaude(text: string): Promise<ParsedPosition[]> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16384,
    messages: [
      {
        role: 'user',
        content: `Du bist ein Experte für deutsche Leistungsverzeichnisse im Bauwesen.

Extrahiere alle Leistungspositionen aus dem folgenden Text.

REGELN:
- Nur echte Positionen mit Positionsnummern (z.B. "1.1.1", "2.3.4")
- KEINE Summenzeilen, Übertragzeilen, Seitenköpfe/-fußzeilen
- KEINE "Eventual"- oder "Alternativ"-Positionen (optionale Extras)
- KEINE Positionen mit Preisen in Klammern
- Nur Positionen mit positivem Gesamtpreis
- Deutsche Zahlen umrechnen: "1.234,56" → 1234.56

JSON-Felder pro Position:
- position_nr (string): Positionsnummer ohne abschließenden Punkt
- gewerk (string): übergeordnete Kategorie/Gewerk
- beschreibung (string): kurze Leistungsbeschreibung
- menge (number|null): Menge
- einheit (string|null): z.B. "m²", "m³", "Stk.", "psch.", "lfm"
- einzelpreis (number|null): Einzelpreis netto in Euro
- gesamtpreis (number): Gesamtpreis netto in Euro (Pflichtfeld)

Antworte NUR mit dem JSON-Array, ohne Markdown-Formatierung, ohne Erklärungen.

Leistungsverzeichnis:
${text}`,
      },
    ],
  });

  const raw = message.content[0].type === 'text' ? message.content[0].text : '';

  // Strip potential markdown code blocks
  const json = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(json) as Array<{
    position_nr?: string;
    gewerk?: string;
    beschreibung?: string;
    menge?: number | null;
    einheit?: string | null;
    einzelpreis?: number | null;
    gesamtpreis: number;
  }>;

  return parsed
    .filter(p => p.gesamtpreis > 0 && p.beschreibung)
    .map(p => ({
      position_nr: p.position_nr ?? undefined,
      gewerk: p.gewerk ?? 'Allgemein',
      beschreibung: p.beschreibung ?? '',
      menge: p.menge ?? undefined,
      einheit: p.einheit ?? undefined,
      einzelpreis: p.einzelpreis ?? undefined,
      gesamtpreis: p.gesamtpreis,
    }));
}

// ─── Route Handler ────────────────────────────────────────────────────────────

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any;
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const data = await pdfParse(buffer);

    let positionen: ParsedPosition[];
    let methode = 'regex';

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        positionen = await parseWithClaude(data.text);
        methode = 'claude';
      } catch (e) {
        console.error('Claude-Parser fehlgeschlagen, Fallback auf Regex:', e);
        positionen = parseLeistungsverzeichnis(data.text);
      }
    } else {
      positionen = parseLeistungsverzeichnis(data.text);
    }

    return NextResponse.json({
      positionen,
      anzahl: positionen.length,
      methode,
      rawText: data.text.slice(0, 2000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('PDF parse error:', error);
    return NextResponse.json(
      { error: `PDF konnte nicht gelesen werden: ${msg}` },
      { status: 500 }
    );
  }
}
