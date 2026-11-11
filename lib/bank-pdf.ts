// Erzeugt die Bank-PDF als echte Datei: Bericht (Blöcke + Gesamtsumme) und danach die
// Rechnungen der aufgeführten Zahlungen in Berichtsreihenfolge. Läuft im Browser.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Zahlung } from '@/lib/types';
import { formatEuro } from '@/lib/utils';

export interface BankBlock {
  titel: string;
  eintraege: Zahlung[];
  summe: number;
}

export interface Beleg {
  dateiname: string;
  bytes: ArrayBuffer;
  /** Identifiziert die Datei (Storage-Pfad). Hängt dieselbe Datei an mehreren Zahlungen,
   *  wird sie nur einmal angehängt. */
  schluessel: string;
}

export interface BankPdfEingabe {
  bloecke: BankBlock[];
  gesamt: number;
  von: string;
  bis: string;
  /** Rechnungen je Zahlungs-ID; fehlt der Eintrag, wird nichts angehängt */
  belege: Map<string, Beleg[]>;
}

const A4 = { b: 595.28, h: 841.89 };
const RAND = 50;
const GRAU = rgb(0.9, 0.91, 0.92);
const TEXTGRAU = rgb(0.4, 0.4, 0.4);

function datumDE(iso: string): string {
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

/** Standard-Schriften kennen nur Latin-1 (+ €, Gedankenstriche …) — Rest ersetzen statt abzustürzen. */
function sicher(text: string): string {
  return text.replace(/[^ -~ -ÿ€–—‘’“”„•…]/g, '?').replace(/[\r\n\t]+/g, ' ');
}

function umbrechen(text: string, font: PDFFont, groesse: number, maxBreite: number): string[] {
  const zeilen: string[] = [];
  let aktuell = '';
  for (const wort of sicher(text).split(' ')) {
    const probe = aktuell ? `${aktuell} ${wort}` : wort;
    if (font.widthOfTextAtSize(probe, groesse) <= maxBreite || !aktuell) aktuell = probe;
    else { zeilen.push(aktuell); aktuell = wort; }
  }
  if (aktuell) zeilen.push(aktuell);
  return zeilen.length ? zeilen : [''];
}

function kuerzen(text: string, font: PDFFont, groesse: number, maxBreite: number): string {
  let t = sicher(text);
  while (t.length > 1 && font.widthOfTextAtSize(t, groesse) > maxBreite) t = t.slice(0, -1);
  return t;
}

function istBild(name: string): 'jpg' | 'png' | null {
  const n = name.toLowerCase();
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'jpg';
  if (n.endsWith('.png')) return 'png';
  return null;
}

export async function erzeugeBankPdf(eingabe: BankPdfEingabe): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fett = await doc.embedFont(StandardFonts.HelveticaBold);

  let seite: PDFPage = doc.addPage([A4.b, A4.h]);
  let y = A4.h - RAND;
  const rechts = A4.b - RAND;

  const platz = (hoehe: number) => {
    if (y - hoehe < RAND) {
      seite = doc.addPage([A4.b, A4.h]);
      y = A4.h - RAND;
    }
  };
  const betragRechts = (text: string, yy: number, f: PDFFont, groesse: number) =>
    seite.drawText(sicher(text), { x: rechts - 6 - f.widthOfTextAtSize(sicher(text), groesse), y: yy, size: groesse, font: f });

  // ── Kopf ──
  seite.drawText('Nachweis bezahlter Positionen', { x: RAND, y: y - 16, size: 17, font: fett });
  y -= 36;
  const zeitraum = eingabe.von || eingabe.bis
    ? ` · Zeitraum: ${eingabe.von ? datumDE(eingabe.von) : 'Beginn'} – ${eingabe.bis ? datumDE(eingabe.bis) : 'heute'}`
    : '';
  seite.drawText(sicher(`Neubau Doppelhaus · Stand: ${new Date().toLocaleDateString('de-DE')}${zeitraum}`), {
    x: RAND, y: y - 2, size: 9.5, font, color: TEXTGRAU,
  });
  y -= 30;

  // ── Blöcke ──
  const beschrBreite = rechts - 6 - 90 - (RAND + 80);
  for (const block of eingabe.bloecke) {
    platz(20 + 24 + 14);
    seite.drawRectangle({ x: RAND, y: y - 20, width: rechts - RAND, height: 20, color: GRAU });
    seite.drawText(sicher(block.titel), { x: RAND + 6, y: y - 14, size: 10.5, font: fett });
    y -= 20;

    for (const z of block.eintraege) {
      const zeilen = umbrechen(z.beschreibung, font, 9.5, beschrBreite);
      const hoehe = zeilen.length * 12 + 8;
      platz(hoehe);
      const oben = y - 14;
      seite.drawText(datumDE(z.datum), { x: RAND + 6, y: oben, size: 9.5, font });
      zeilen.forEach((zl, i) => seite.drawText(zl, { x: RAND + 80, y: oben - i * 12, size: 9.5, font }));
      betragRechts(formatEuro(z.betrag), oben, font, 9.5);
      y -= hoehe;
      seite.drawLine({ start: { x: RAND, y }, end: { x: rechts, y }, thickness: 0.5, color: GRAU });
    }

    platz(26);
    seite.drawText(sicher(`Summe ${block.titel}`), { x: RAND + 6, y: y - 16, size: 10, font: fett });
    betragRechts(formatEuro(block.summe), y - 16, fett, 10);
    y -= 38;
  }

  // ── Gesamtsumme ──
  platz(30);
  seite.drawRectangle({ x: RAND, y: y - 26, width: rechts - RAND, height: 26, color: GRAU });
  seite.drawText('Gesamtsumme bezahlter Positionen', { x: RAND + 6, y: y - 18, size: 11.5, font: fett });
  betragRechts(formatEuro(eingabe.gesamt), y - 18, fett, 11.5);

  // ── Rechnungen anhängen, in Berichtsreihenfolge ──
  // Eine Datei kann zu mehreren Zahlungen gehören: sie kommt nur einmal (bei der ersten
  // Zahlung) und nennt in der Fußzeile alle Zahlungen, die sie belegt.
  const zahlungenJeBeleg = new Map<string, Zahlung[]>();
  for (const block of eingabe.bloecke) {
    for (const z of block.eintraege) {
      for (const beleg of eingabe.belege.get(z.id) ?? []) {
        zahlungenJeBeleg.set(beleg.schluessel, [...(zahlungenJeBeleg.get(beleg.schluessel) ?? []), z]);
      }
    }
  }
  const schonAngehaengt = new Set<string>();
  const beschreibung = (z: Zahlung) => `${datumDE(z.datum)} – ${z.beschreibung} – ${formatEuro(z.betrag)}`;

  for (const block of eingabe.bloecke) {
    for (const z of block.eintraege) {
      for (const beleg of eingabe.belege.get(z.id) ?? []) {
        if (schonAngehaengt.has(beleg.schluessel)) continue;
        schonAngehaengt.add(beleg.schluessel);
        const belegte = zahlungenJeBeleg.get(beleg.schluessel) ?? [z];
        const stempel = belegte.length === 1
          ? `Beleg zu: ${beschreibung(belegte[0])}`
          : `Beleg zu ${belegte.length} Zahlungen: ${belegte.map(beschreibung).join(' ; ')}`;
        const seiten: PDFPage[] = [];
        try {
          const bild = istBild(beleg.dateiname);
          if (bild) {
            const img = bild === 'jpg' ? await doc.embedJpg(beleg.bytes) : await doc.embedPng(beleg.bytes);
            const s = doc.addPage([A4.b, A4.h]);
            const rand = 36;
            const faktor = Math.min((A4.b - 2 * rand) / img.width, (A4.h - 2 * rand - 10) / img.height, 1);
            const b = img.width * faktor, h = img.height * faktor;
            s.drawImage(img, { x: (A4.b - b) / 2, y: A4.h - rand - h, width: b, height: h });
            seiten.push(s);
          } else {
            const quelle = await PDFDocument.load(beleg.bytes, { ignoreEncryption: true });
            const kopien = await doc.copyPages(quelle, quelle.getPageIndices());
            kopien.forEach(k => seiten.push(doc.addPage(k)));
          }
        } catch (e) {
          throw new Error(`„${beleg.dateiname}“ konnte nicht eingelesen werden (${e instanceof Error ? e.message : 'unbekannter Fehler'}).`);
        }
        for (const s of seiten) {
          s.drawText(kuerzen(stempel, font, 7, s.getWidth() - 40), { x: 20, y: 9, size: 7, font, color: TEXTGRAU });
        }
      }
    }
  }

  return doc.save();
}
