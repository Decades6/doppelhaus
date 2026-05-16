import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { Termin } from '@/lib/types';

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

function termineZuIcs(termine: Termin[], kalenderName: string): string {
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
      const endDatum = new Date(t.datum + 'T00:00:00');
      endDatum.setDate(endDatum.getDate() + 1);
      const endIso = endDatum.toISOString().split('T')[0].replace(/-/g, '');
      dtstart = `DTSTART;VALUE=DATE:${t.datum.replace(/-/g, '')}`;
      dtend = `DTEND;VALUE=DATE:${endIso}`;
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

  const ics = termineZuIcs((termine ?? []) as Termin[], 'Doppelhaus Baukalender');

  return new NextResponse(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="doppelhaus.ics"',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
