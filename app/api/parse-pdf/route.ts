import { NextRequest, NextResponse } from 'next/server';
import { ParsedPosition } from '@/lib/types';

export const maxDuration = 30;

function parseGermanNumber(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// Bereinigt Einheiten-Reste die am Anfang der Beschreibung kleben
function bereinigeBeschreibung(text: string): string {
  return text
    .replace(/^ück\s*/i, '')        // "Stück" → "ück..." Rest
    .replace(/^üs\s*/i, '')         // andere "üs..." Reste
    .replace(/^sch\.?\s*/i, '')     // "psch." → "sch..." Rest
    .replace(/^dm\s*/i, '')         // "lfdm" → "dm..." Rest
    .replace(/^tück\s*/i, '')       // "Stück" Variante
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLeistungsverzeichnis(text: string): ParsedPosition[] {
  const positionen: ParsedPosition[] = [];

  const clean = text
    .replace(/Angebot[^\n]*\n/g, '')
    .replace(/Übertrag:[^\n]*\n?/g, '')
    .replace(/Seite \d+ von \d+[^\n]*\n?/g, '')
    .replace(/Nettosumme[\s\S]*/g, '');

  const lines = clean.split('\n').map(l => l.trim());

  const gewerkRx  = /^(\d+\.\d+\.)([A-ZÄÖÜa-zäöüß].{3,})/;
  const skipRx    = /^(Summe \d|Zwischensumme|Nettosumme|Bruttosumme|zzgl\.|MwSt)/i;
  const posNrRx3  = /^(\d+\.\d+\.\d+(?:\.\d+)*\.)/;
  const posNrRx2  = /^(\d+\.\d+\.)(?=\d)/;
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

  const priceRx           = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  const parenthesizedRx   = /\(\d{1,3}(?:\.\d{3})*,\d{2}\)/;
  const priceLineRx       = /\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;
  const unitList          = 'm²|m2|m³|m3|lfdm|lfm|Stk\\.?|St\\.?|Psch\\.?|psch\\.?|Woch\\.?|kg|VE|Pkg\\.?|Std\\.?|\\bm\\b|qm';
  const unitRx            = new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${unitList})`, 'i');

  for (const block of blocks) {
    const fullText = block.lines.join(' ');
    if (/\b(Eventual|Alternativ)\b/.test(fullText)) continue;
    if (parenthesizedRx.test(fullText)) continue;

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
      menge    = parseGermanNumber(unitMatch[1]);
      einheit  = unitMatch[2];
      descRaw  = firstLine.replace(unitMatch[0], '').trim();
    }

    const beschreibung = bereinigeBeschreibung(
      descRaw.replace(/\d{1,3}(?:\.\d{3})*,\d{2}/g, '').trim()
    );

    positionen.push({
      position_nr : block.posNr.replace(/\.$/, ''),
      gewerk      : block.gewerk,
      beschreibung: beschreibung || `Position ${block.posNr}`,
      menge,
      einheit,
      einzelpreis,
      gesamtpreis,
    });
  }

  return positionen;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfModule = await import('pdf-parse') as any;
    const pdfParse  = pdfModule.default ?? pdfModule;
    const pdfData   = await pdfParse(buffer);

    const positionen = parseLeistungsverzeichnis(pdfData.text);

    return NextResponse.json({ positionen, anzahl: positionen.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('PDF parse error:', msg);
    return NextResponse.json(
      { error: `Fehler beim Verarbeiten der PDF: ${msg}` },
      { status: 500 }
    );
  }
}
