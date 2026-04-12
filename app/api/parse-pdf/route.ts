import { NextRequest, NextResponse } from 'next/server';
import { ParsedPosition } from '@/lib/types';

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
  // 2-level section headers (Gewerk): "1.1.Baustelleneinrichtung" "1.2.Gerüstbauarbeiten"
  const gewerkRx = /^(\d+\.\d+\.)([A-ZÄÖÜa-zäöüß].{3,})/;
  // Skip subtotals
  const skipRx = /^(Summe \d|Zwischensumme|Nettosumme|Bruttosumme|zzgl\.|MwSt)/i;

  // 3-level positions: "1.1.1." | 2-level positions (rare, e.g. "11.1." followed by digit)
  const posNrRx3 = /^(\d+\.\d+\.\d+(?:\.\d+)*\.)/;
  const posNrRx2 = /^(\d+\.\d+\.)(?=\d)/;
  // Close block on section-summary lines (prevents their prices leaking into previous block)
  const closingRx = /^(Summe |Zwischensumme )/i;

  let currentGewerk = 'Allgemein';
  const blocks: { posNr: string; gewerk: string; lines: string[] }[] = [];
  let current: { posNr: string; gewerk: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (!line) continue;

    // Close current block on summary lines (before skipping them)
    if (closingRx.test(line) || skipRx.test(line)) {
      if (current) { blocks.push(current); current = null; }
      continue;
    }

    // Update Gewerk from 2-level headers
    const gwMatch = line.match(gewerkRx);
    if (gwMatch && !posNrRx3.test(line) && !posNrRx2.test(line)) {
      currentGewerk = gwMatch[2].trim();
      continue;
    }

    // New position block starts
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
  // A line that ends with a German price (the actual price line, not tech-spec lines)
  const priceLineRx = /\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;
  const unitList = 'm²|m2|m³|m3|lfdm|lfm|Stk\\.?|St\\.?|Psch\\.?|psch\\.?|Woch\\.?|kg|VE|Pkg\\.?|Std\\.?|xWo\\.?|\\bm\\b|qm';
  const unitRx = new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${unitList})`, 'i');

  for (const block of blocks) {
    const fullText = block.lines.join(' ');

    // Skip Eventual / Alternativ positions (optional extras not in base price)
    if (/\b(Eventual|Alternativ)\b/.test(fullText)) continue;
    // Skip if last price is in parentheses (also marks optional positions)
    if (parenthesizedPriceRx.test(fullText)) continue;

    // Find the last line that ends with a price (ignores tech-spec lines like "λ=0,035 W/(mK)")
    const priceLine = [...block.lines].reverse().find(l => priceLineRx.test(l));
    if (!priceLine) continue;

    // Find all prices in that line
    const allPrices = [...priceLine.matchAll(priceRx)];
    if (allPrices.length === 0) continue;

    const gesamtpreis = parseGermanNumber(allPrices[allPrices.length - 1][1]);
    if (gesamtpreis <= 0) continue;

    let einzelpreis: number | undefined;
    if (allPrices.length >= 2) {
      const ep = parseGermanNumber(allPrices[allPrices.length - 2][1]);
      if (ep !== gesamtpreis) einzelpreis = ep;
    }

    // Extract description from first line (after pos number)
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

    const positionen = parseLeistungsverzeichnis(data.text);

    return NextResponse.json({
      positionen,
      anzahl: positionen.length,
      rawText: data.text.slice(0, 2000), // First 2000 chars for debugging
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
