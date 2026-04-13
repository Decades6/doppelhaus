import { NextRequest, NextResponse } from 'next/server';
import { ParsedPosition } from '@/lib/types';

function parseGermanNumber(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

function parseLeistungsverzeichnis(text: string): ParsedPosition[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
  const positionen: ParsedPosition[] = [];
  let currentGewerk = 'Allgemein';

  // German price at end of line: e.g. "3.750,00" or "150,00"
  const endPricePattern = /(\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:€|EUR)?\s*$/;
  // All German prices in a string
  const allPricesPattern = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
  // Position number at start (e.g. "01.001", "1.1.2", "3")
  const posNrPattern = /^(\d{1,3}(?:\.\d{1,3}){1,3})\s+/;
  // Section header: short line with number + text, no price
  const sectionPattern = /^(\d{1,2})\s{1,4}([A-ZÄÖÜa-zäöüß][^\d]{5,50})$/;
  // Quantity + unit pattern
  const unitList = 'm²|m2|m³|m3|lfdm|lfm|Stk\\.?|St\\.?|Psch\\.?|psch\\.?|kg|VE|Pkg\\.?|\\bm\\b|qm|Std\\.?|h\\b|to\\b|t\\b|l\\b';
  const unitPattern = new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${unitList})`, 'i');

  for (const line of lines) {
    // Detect section header (Gewerk)
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch && !line.match(endPricePattern)) {
      currentGewerk = sectionMatch[2].trim();
      continue;
    }

    // Check for price at end of line
    const endMatch = line.match(endPricePattern);
    if (!endMatch) continue;

    const gesamtpreis = parseGermanNumber(endMatch[1]);
    if (gesamtpreis <= 0 || gesamtpreis > 99999999) continue;

    let rest = line;
    let position_nr: string | undefined;

    // Extract position number from start
    const posMatch = line.match(posNrPattern);
    if (posMatch) {
      position_nr = posMatch[1];
      rest = rest.slice(posMatch[0].length);
    }

    // Remove total price from end
    rest = rest.replace(endPricePattern, '').trim();

    // Find Einzelpreis (last remaining price)
    const allPrices = [...rest.matchAll(allPricesPattern)];
    let einzelpreis: number | undefined;
    if (allPrices.length >= 1) {
      const last = allPrices[allPrices.length - 1];
      const ep = parseGermanNumber(last[1]);
      if (ep !== gesamtpreis) {
        einzelpreis = ep;
        rest = (rest.slice(0, last.index!) + rest.slice(last.index! + last[0].length)).trim();
      }
    }

    // Find menge and einheit
    let menge: number | undefined;
    let einheit: string | undefined;
    const unitMatch = rest.match(unitPattern);
    if (unitMatch) {
      menge = parseGermanNumber(unitMatch[1]);
      einheit = unitMatch[2];
      rest = rest.replace(unitMatch[0], '').trim();
    }

    // Clean up description
    const beschreibung = rest
      .replace(/\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (beschreibung.length > 1 || position_nr) {
      positionen.push({
        position_nr,
        gewerk: currentGewerk,
        beschreibung: beschreibung || `Position ${position_nr || positionen.length + 1}`,
        menge,
        einheit,
        einzelpreis,
        gesamtpreis,
      });
    }
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

    // Dynamic import to avoid build-time issues with pdf-parse
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule = await import('pdf-parse') as any;
    const pdfParse = pdfParseModule.default ?? pdfParseModule;
    const data = await pdfParse(buffer);

    const positionen = parseLeistungsverzeichnis(data.text);

    return NextResponse.json({
      positionen,
      anzahl: positionen.length,
      rawText: data.text.slice(0, 2000), // First 2000 chars for debugging
    });
  } catch (error) {
    console.error('PDF parse error:', error);
    return NextResponse.json(
      { error: 'PDF konnte nicht gelesen werden. Bitte versuche es erneut.' },
      { status: 500 }
    );
  }
}
