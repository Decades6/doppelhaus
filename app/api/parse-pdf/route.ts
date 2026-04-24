import { NextRequest, NextResponse } from 'next/server';
import { ParsedPosition } from '@/lib/types';

export const maxDuration = 30;

// ─── Reguläre Ausdrücke ───────────────────────────────────────────────────────

const PREIS_RX            = /(\d{1,3}(?:\.\d{3})*,\d{2})/g;
const PREIS_ZEILE_RX      = /\d{1,3}(?:\.\d{3})*,\d{2}\s*$/;
const PREIS_KLAMMER_RX    = /\((\d{1,3}(?:\.\d{3})*,\d{2})\)/;
const PREIS_IN_KLAMMER_RX = /\(\d{1,3}(?:\.\d{3})*,\d{2}\)/;

const POS_NR_3_RX = /^(\d+\.\d+\.\d+(?:\.\d+)*\.)/;
const POS_NR_2_RX = /^(\d+\.\d+\.)(?=\d)/;
const GEWERK_RX   = /^(\d+\.\d+\.)([A-ZÄÖÜa-zäöüß].{3,})/;
const SKIP_RX     = /^(Summe \d|Zwischensumme|Nettosumme|Bruttosumme|zzgl\.|MwSt)/i;
const CLOSING_RX  = /^(Summe |Zwischensumme )/i;

const EINHEIT_LIST = 'm²|m2|m³|m3|lfdm|lfm|mxWo\\.?|Woch\\.?|Wo\\.?|Stk\\.?|St\\.?|Psch\\.?|psch\\.?|kg|VE|Pkg\\.?|Std\\.?|qm|m';
const EINHEIT_RX   = new RegExp(`(\\d+(?:[,.]\\d+)?)\\s*(${EINHEIT_LIST})(?=\\s|[A-ZÄÖÜ]|$)`, 'i');

// Zeichen/Wörter die anzeigen dass ein Titel auf der nächsten Zeile weitergeht
const VERBINDUNGSWOERTER = new Set([
  'mit', 'und', 'für', 'von', 'zu', 'als',
  'der', 'die', 'das', 'des',
  'bei', 'an', 'in', 'auf', 'aus', 'nach', 'über', 'unter',
  'oder', 'je', 'pro',
]);

// Zeilenanfänge die auf Langtext (nicht Titel) hinweisen
const LANGTEXT_RX = /^[•\-]|^(bestehend|inkl\.|einschl\.|komplett|liefern|montieren|gemäß|nach DIN|Ausführung|Herstellung)/i;

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function parseGermanNumber(str: string): number {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

/** Entfernt Einheiten-Reste die am Anfang der Beschreibung kleben bleiben */
function bereinigeBeschreibung(text: string): string {
  return text
    .replace(/^ück\.?\s*/i, '')
    .replace(/^tück\.?\s*/i, '')
    .replace(/^och\.?\s*/i, '')
    .replace(/^xWo\.?\s*/i, '')
    .replace(/^Wo\.?\s*(?=[A-ZÄÖÜ])/, '')
    .replace(/^[a-zäöü]{1,4}\.?\s*(?=[A-ZÄÖÜ])/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Gibt true zurück wenn die Zeile unvollständig endet und die nächste Zeile
 *  zum Titel gehört. Erkannte Fälle:
 *  - Bindestrich am Ende:   "ISO-"  → "Kimmstein b=175 mm"
 *  - Komma am Ende:         "d=180 mm,"  → "punktweise fixiert"
 *  - Schrägstrich am Ende:  "LK 4/"  → "W09"
 *  - Offene Klammer:        "(bis"  → "200/200mm)"
 *  - Maß mit = am Ende:     "d=120"  → "mm"
 *  - Verbindungswort:       "Anlage mit"  → "16,38 kWp"
 */
function istTitelFortsetzung(zeile: string): boolean {
  const z = zeile.trim();
  if (!z) return false;

  if (z.endsWith('-')) return true;
  if (z.endsWith(',')) return true;
  if (z.endsWith('/')) return true;
  if (/=\d+\s*$/.test(z)) return true;

  const offeneKlammern = (z.match(/\(/g) ?? []).length > (z.match(/\)/g) ?? []).length;
  if (offeneKlammern) return true;

  const letztesWort = z.split(/\s+/).pop()?.toLowerCase().replace(/[^a-zäöüß]/g, '') ?? '';
  if (VERBINDUNGSWOERTER.has(letztesWort)) return true;

  return false;
}

/** Sammelt mehrzeilige Titel aus den Block-Zeilen (max. 3 Fortsetzungszeilen) */
function sammleTitel(lines: string[], descRaw: string): string {
  for (let j = 1; j <= 3 && j < lines.length - 1; j++) {
    if (!istTitelFortsetzung(descRaw)) break;
    const naechste = lines[j];
    if (!naechste || LANGTEXT_RX.test(naechste) || PREIS_ZEILE_RX.test(naechste)) break;
    descRaw += (descRaw.trim().endsWith('-') ? '' : ' ') + naechste;
  }
  return descRaw;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

function parseLeistungsverzeichnis(text: string): ParsedPosition[] {
  const positionen: ParsedPosition[] = [];

  const clean = text
    .replace(/Angebot[^\n]*\n/g, '')
    .replace(/Übertrag:[^\n]*\n?/g, '')
    .replace(/Seite \d+ von \d+[^\n]*\n?/g, '')
    .replace(/Nettosumme[\s\S]*/g, '');

  const lines = clean.split('\n').map(l => l.trim());

  // Positionen in Blöcke gruppieren
  let currentGewerk = 'Allgemein';
  const blocks: { posNr: string; gewerk: string; lines: string[] }[] = [];
  let current: { posNr: string; gewerk: string; lines: string[] } | null = null;

  for (const line of lines) {
    if (!line) continue;
    if (CLOSING_RX.test(line) || SKIP_RX.test(line)) {
      if (current) { blocks.push(current); current = null; }
      continue;
    }
    const gwMatch = line.match(GEWERK_RX);
    if (gwMatch && !POS_NR_3_RX.test(line) && !POS_NR_2_RX.test(line)) {
      currentGewerk = gwMatch[2].trim();
      continue;
    }
    const posMatch = line.match(POS_NR_3_RX) || line.match(POS_NR_2_RX);
    if (posMatch) {
      if (current) blocks.push(current);
      current = { posNr: posMatch[1], gewerk: currentGewerk, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push(current);

  // Blöcke in Positionen umwandeln
  for (const block of blocks) {
    const fullText = block.lines.join(' ');

    // Eventual / Alternativ erkennen (Preis steht in Klammern)
    const isEventual   = /\bEventual/i.test(fullText)  && PREIS_IN_KLAMMER_RX.test(fullText);
    const isAlternativ = /\bAlternativ/i.test(fullText) && PREIS_IN_KLAMMER_RX.test(fullText);
    const isOptional   = isEventual || isAlternativ;

    // Preis ermitteln
    let gesamtpreis: number;
    let einzelpreis: number | undefined;

    if (isOptional) {
      const m = fullText.match(PREIS_KLAMMER_RX);
      if (!m) continue;
      gesamtpreis = parseGermanNumber(m[1]);
      if (gesamtpreis <= 0) continue;
    } else {
      const preisZeile = [...block.lines].reverse().find(l => PREIS_ZEILE_RX.test(l));
      if (!preisZeile) continue;
      const allePreise = [...preisZeile.matchAll(PREIS_RX)];
      if (allePreise.length === 0) continue;
      gesamtpreis = parseGermanNumber(allePreise[allePreise.length - 1][1]);
      if (gesamtpreis <= 0) continue;
      if (allePreise.length >= 2) {
        const ep = parseGermanNumber(allePreise[allePreise.length - 2][1]);
        if (ep !== gesamtpreis) einzelpreis = ep;
      }
    }

    // Menge, Einheit und Beschreibung aus der ersten Zeile extrahieren
    const firstLine = block.lines[0].replace(POS_NR_3_RX, '').replace(POS_NR_2_RX, '').trim();
    const unitMatch  = firstLine.match(EINHEIT_RX);
    let menge: number | undefined;
    let einheit: string | undefined;
    let descRaw = firstLine;

    if (unitMatch) {
      menge   = parseGermanNumber(unitMatch[1]);
      einheit = unitMatch[2];
      descRaw = firstLine.replace(unitMatch[0], '').trim();
    }

    // Mehrzeiligen Titel zusammensetzen
    descRaw = sammleTitel(block.lines, descRaw);

    const beschreibung = bereinigeBeschreibung(
      descRaw.replace(/\s*\d{1,3}(?:\.\d{3})*,\d{2}\s*$/g, '').trim()
    );

    positionen.push({
      position_nr : block.posNr.replace(/\.$/, ''),
      gewerk      : block.gewerk,
      beschreibung: beschreibung || `Position ${block.posNr}`,
      menge,
      einheit,
      einzelpreis,
      gesamtpreis,
      eventual    : isEventual,
      alternativ  : isAlternativ,
    });
  }

  return positionen;
}

// ─── API Route ────────────────────────────────────────────────────────────────

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
