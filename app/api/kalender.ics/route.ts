import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Termin } from '@/lib/types';
import { ANSCHLUSS_NAMEN, istAnschluss, type AnschlussSchluessel } from '@/lib/anschluesse';

function icsEscapen(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(datum: string, uhrzeit: string | null): string {
  if (!uhrzeit) {
    // Ganztägig
    return `${datum.replace(/-/g, '')}`;
  }
  const [h, m] = uhrzeit.split(':');
  return `${datum.replace(/-/g, '')}T${h}${m}00`;
}

/** Folgetag als YYYYMMDD — für DTEND ganztägiger Termine (Ende ist exklusiv).
 *  Rechnet bewusst in UTC, sonst verschiebt die Serverzeitzone das Datum. */
function naechsterTagIcs(datum: string): string {
  const d = new Date(datum + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

interface Zahlungsziel {
  id: string;
  bezeichnung: string;
  betrag: number;
  zahlungsziel: string;
}

function formatEuro(betrag: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(betrag);
}

/** Ganztägige Termine für offene Zahlungsziele — nur für den Besitzer des Tokens. */
function zahlungszieleZuVevents(ziele: Zahlungsziel[], jetzt: string): string[] {
  return ziele.map(z => {
    return [
      'BEGIN:VEVENT',
      `UID:zahlungsziel-${z.id}@doppelhaus`,
      `DTSTAMP:${jetzt}`,
      `DTSTART;VALUE=DATE:${z.zahlungsziel.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${naechsterTagIcs(z.zahlungsziel)}`,
      `SUMMARY:${icsEscapen(`Zahlung fällig: ${z.bezeichnung}`)}`,
      `DESCRIPTION:${icsEscapen(`Offener Betrag: ${formatEuro(z.betrag)}`)}`,
      'END:VEVENT',
    ].join('\r\n');
  });
}

function termineZuIcs(termine: Termin[], kalenderName: string, zusatzEvents: string[] = []): string {
  const events = termine.map(t => {
    const uid = `${t.id}@doppelhaus`;
    const dtstamp = new Date(t.created_at).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    let dtstart: string;
    let dtend: string;

    if (t.uhrzeit_von) {
      dtstart = `DTSTART:${icsDate(t.datum, t.uhrzeit_von)}`;
      const endZeit = t.uhrzeit_bis ?? t.uhrzeit_von;
      dtend = `DTEND:${icsDate(t.datum, endZeit)}`;
    } else {
      // Ganztägiger Termin — Endedatum ist Tag + 1
      dtstart = `DTSTART;VALUE=DATE:${t.datum.replace(/-/g, '')}`;
      dtend = `DTEND;VALUE=DATE:${naechsterTagIcs(t.datum)}`;
    }

    const lines = [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      dtstart,
      dtend,
      `SUMMARY:${icsEscapen(t.titel)}`,
    ];
    if (t.ort) lines.push(`LOCATION:${icsEscapen(t.ort)}`);
    if (t.beschreibung) lines.push(`DESCRIPTION:${icsEscapen(t.beschreibung)}`);
    lines.push('END:VEVENT');
    return lines.join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Doppelhaus//Baukalender//DE',
    `X-WR-CALNAME:${kalenderName}`,
    'X-WR-TIMEZONE:Europe/Berlin',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    ...zusatzEvents,
    'END:VCALENDAR',
  ].join('\r\n');
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse('Token fehlt', { status: 400 });
  }

  // Token validieren
  const { data: tokenRow, error: tokenError } = await supabaseAdmin
    .from('kalender_tokens')
    .select('user_id')
    .eq('token', token)
    .single();

  if (tokenError || !tokenRow) {
    return new NextResponse('Ungültiger Token', { status: 403 });
  }

  // Alle Termine laden (shared calendar)
  const { data: termine, error } = await supabaseAdmin
    .from('termine')
    .select('*')
    .order('datum', { ascending: true })
    .order('uhrzeit_von', { ascending: true });

  if (error) {
    return new NextResponse('Fehler beim Laden der Termine', { status: 500 });
  }

  // Zahlungsziele gehören nur dem Besitzer des Tokens — Kostenpositionen sind
  // pro Konto privat und dürfen nicht im gemeinsamen Kalender aller landen.
  const [{ data: kostenPos }, { data: anschluesse }, { data: zahlungen }] = await Promise.all([
    supabaseAdmin
      .from('kosten_positionen')
      .select('id, bezeichnung, betrag, zahlungsziel')
      .eq('user_id', tokenRow.user_id)
      .not('zahlungsziel', 'is', null),
    // Anschlüsse liegen als feste Schlüssel in kosten_manuell, nicht als Kostenposition
    supabaseAdmin
      .from('kosten_manuell')
      .select('schluessel, betrag, zahlungsziel')
      .eq('user_id', tokenRow.user_id)
      .not('zahlungsziel', 'is', null),
    supabaseAdmin
      .from('zahlungen')
      .select('beschreibung, betrag')
      .eq('user_id', tokenRow.user_id),
  ]);

  // Bereits vollständig bezahlte Posten nicht mehr als Termin ausliefern.
  // Zuordnung über die Beschreibung — dieselbe Logik wie die Ampel im Kosten-Tab.
  const bezahltNachBeschreibung: Record<string, number> = {};
  for (const z of (zahlungen ?? []) as { beschreibung: string; betrag: number }[]) {
    const schluessel = z.beschreibung.trim().toLowerCase();
    bezahltNachBeschreibung[schluessel] = (bezahltNachBeschreibung[schluessel] ?? 0) + z.betrag;
  }

  // Anschlüsse auf dieselbe Form bringen wie die Kostenpositionen
  const anschlussZiele: Zahlungsziel[] = ((anschluesse ?? []) as { schluessel: string; betrag: number | null; zahlungsziel: string }[])
    .filter(a => istAnschluss(a.schluessel))
    .map(a => ({
      id: a.schluessel,
      bezeichnung: ANSCHLUSS_NAMEN[a.schluessel as AnschlussSchluessel],
      betrag: a.betrag ?? 0,
      zahlungsziel: a.zahlungsziel,
    }));

  const offeneZiele = [...((kostenPos ?? []) as Zahlungsziel[]), ...anschlussZiele].filter(p => {
    const bezahlt = bezahltNachBeschreibung[p.bezeichnung.trim().toLowerCase()] ?? 0;
    return bezahlt < p.betrag;
  });

  const jetzt = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = termineZuIcs(
    (termine ?? []) as Termin[],
    'Doppelhaus Baukalender',
    zahlungszieleZuVevents(offeneZiele, jetzt),
  );

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="doppelhaus.ics"',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
