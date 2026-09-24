// Die Anschlüsse sind feste Einzelposten in `kosten_manuell` (Schlüssel + Betrag),
// keine frei anlegbaren Kostenpositionen. Sie liegen hier zentral, damit Kosten-Tab,
// Übersicht und der ICS-Feed dieselben Schlüssel und Namen verwenden.
//
// Jeder Anschluss hat zwei Posten: den Anschluss selbst (die späteren Arbeiten) und
// die Verwaltungsgebühr für den Antrag.

export interface AnschlussPosten {
  /** Schlüssel in kosten_manuell */
  schluessel: string;
  /** Eindeutiger Name — für die Zuordnung von Zahlungen und für Kalendereinträge.
   *  Muss eindeutig sein, sonst zählt eine Zahlung auf mehrere Posten gleichzeitig. */
  name: string;
  /** Beschriftung in der Tabelle (unter dem Anschluss verkürzt) */
  anzeige: string;
  /** Gebührenzeile — wird unter dem zugehörigen Anschluss eingerückt dargestellt */
  istGebuehr: boolean;
}

const ANSCHLUESSE = [
  ['stromanschluss', 'Stromanschluss'],
  ['wasseranschluss', 'Wasseranschluss'],
  ['sielanschluss', 'Sielanschluss'],
  ['telekomanschluss', 'Telekomanschluss'],
] as const;

export const ANSCHLUSS_POSTEN: AnschlussPosten[] = ANSCHLUESSE.flatMap(([schluessel, name]) => [
  { schluessel, name, anzeige: name, istGebuehr: false },
  {
    schluessel: `${schluessel}_gebuehr`,
    name: `Verwaltungsgebühr ${name}`,
    anzeige: 'Verwaltungsgebühr',
    istGebuehr: true,
  },
]);

const NACH_SCHLUESSEL = new Map(ANSCHLUSS_POSTEN.map(p => [p.schluessel, p]));

export function anschlussPosten(schluessel: string): AnschlussPosten | undefined {
  return NACH_SCHLUESSEL.get(schluessel);
}

export function istAnschluss(schluessel: string): boolean {
  return NACH_SCHLUESSEL.has(schluessel);
}
