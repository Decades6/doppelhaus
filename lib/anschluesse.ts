// Die Anschlüsse sind feste Einzelposten in `kosten_manuell` (Schlüssel + Betrag),
// keine frei anlegbaren Kostenpositionen. Namen und Schlüssel liegen hier zentral,
// damit Kosten-Tab, Übersicht und der ICS-Feed dieselben verwenden.

export const ANSCHLUSS_NAMEN = {
  stromanschluss: 'Stromanschluss',
  wasseranschluss: 'Wasseranschluss',
  sielanschluss: 'Sielanschluss',
  telekomanschluss: 'Telekomanschluss',
} as const;

export type AnschlussSchluessel = keyof typeof ANSCHLUSS_NAMEN;

export const ANSCHLUSS_SCHLUESSEL = Object.keys(ANSCHLUSS_NAMEN) as AnschlussSchluessel[];

export function istAnschluss(schluessel: string): schluessel is AnschlussSchluessel {
  return schluessel in ANSCHLUSS_NAMEN;
}
