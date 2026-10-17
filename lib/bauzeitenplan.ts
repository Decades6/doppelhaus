// Datumshilfen für den Bauzeitenplan. Alle Rechnungen laufen in UTC auf reinen
// ISO-Daten ("2027-03-15"), damit die Zeitzone von Browser oder Server kein Datum
// verschiebt (siehe naechsterTagIcs im ICS-Feed — dieselbe Falle).

function utc(iso: string): Date {
  return new Date(iso + 'T00:00:00Z');
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function tageAddieren(datum: string, tage: number): string {
  const d = utc(datum);
  d.setUTCDate(d.getUTCDate() + tage);
  return iso(d);
}

/** Kalendertage von `von` bis `bis` (bis − von). */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((utc(bis).getTime() - utc(von).getTime()) / 86_400_000);
}

/** Heutiges Datum in der Ortszeit des Browsers. */
export function heuteIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Montag der Woche, in der `datum` liegt. */
export function wochenMontag(datum: string): string {
  const wochentag = (utc(datum).getUTCDay() + 6) % 7; // Mo = 0
  return tageAddieren(datum, -wochentag);
}

/** ISO-Kalenderwoche */
export function kalenderwoche(datum: string): number {
  const d = utc(datum);
  const donnerstag = new Date(d);
  donnerstag.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const jahresbeginn = new Date(Date.UTC(donnerstag.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((donnerstag.getTime() - jahresbeginn.getTime()) / 86_400_000 - 3 + ((jahresbeginn.getUTCDay() + 6) % 7)) / 7);
}

function ostersonntag(jahr: number): string {
  // Gaußsche Osterformel (gregorianisch)
  const a = jahr % 19, b = Math.floor(jahr / 100), c = jahr % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monat = Math.floor((h + l - 7 * m + 114) / 31);
  const tag = ((h + l - 7 * m + 114) % 31) + 1;
  return `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

const feiertagCache = new Map<number, Set<string>>();

/** Gesetzliche Feiertage in Hamburg */
function feiertage(jahr: number): Set<string> {
  let tage = feiertagCache.get(jahr);
  if (!tage) {
    const ostern = ostersonntag(jahr);
    tage = new Set([
      `${jahr}-01-01`, `${jahr}-05-01`, `${jahr}-10-03`, `${jahr}-10-31`, `${jahr}-12-25`, `${jahr}-12-26`,
      tageAddieren(ostern, -2),  // Karfreitag
      tageAddieren(ostern, 1),   // Ostermontag
      tageAddieren(ostern, 39),  // Christi Himmelfahrt
      tageAddieren(ostern, 50),  // Pfingstmontag
    ]);
    feiertagCache.set(jahr, tage);
  }
  return tage;
}

/** Arbeitstage (Mo–Fr ohne Hamburger Feiertage) von `anfang` bis `ende`, beide eingeschlossen.
 *  Nur ein Vorschlag — der Bauzeitenplan des Bauträgers rechnet mit eigenem Kalender
 *  (Betriebsferien, Brückentage), deshalb bleibt die Dauer von Hand änderbar. */
export function arbeitstage(anfang: string, ende: string): number {
  let anzahl = 0;
  for (let d = anfang; d <= ende; d = tageAddieren(d, 1)) {
    const wochentag = utc(d).getUTCDay();
    if (wochentag !== 0 && wochentag !== 6 && !feiertage(Number(d.slice(0, 4))).has(d)) anzahl++;
  }
  return anzahl;
}

export function formatDauer(tage: number): string {
  const text = tage.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  return `${text} ${tage === 1 ? 'Tag' : 'Tage'}`;
}
