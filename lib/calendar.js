// Kalender-Anbindung über iCal (.ics).
//
// Samsung Kalender hat keine öffentliche API. Er zeigt aber die Kalender der Konten an,
// die auf dem Handy eingerichtet sind (meist Google, ggf. Outlook/Exchange).
// Diese Konten bieten einen privaten iCal-Link an, den das Dashboard regelmäßig abruft.
// Alternativ kann eine exportierte .ics-Datei hochgeladen werden.
import fs from 'node:fs/promises';
import path from 'node:path';
import ical from 'node-ical';
import { DATA_DIR } from './store.js';

const CAL_DIR = path.join(DATA_DIR, 'calendars');
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_ICS_BYTES = 20 * 1024 * 1024;

const feedCache = new Map(); // calendarId -> { at, data }

export function normalizeUrl(input) {
  let url = String(input || '').trim();
  if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);
  const parsed = new URL(url); // wirft bei ungültiger URL
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Nur http(s)- oder webcal-Links werden unterstützt.');
  }
  return parsed.toString();
}

export function validateIcs(text) {
  if (typeof text !== 'string' || !text.includes('BEGIN:VCALENDAR')) {
    throw new Error('Das ist keine gültige iCal-Datei (BEGIN:VCALENDAR fehlt).');
  }
  if (Buffer.byteLength(text) > MAX_ICS_BYTES) throw new Error('Die Datei ist zu groß.');
  return text;
}

export async function saveUploadedIcs(id, text) {
  await fs.mkdir(CAL_DIR, { recursive: true });
  await fs.writeFile(path.join(CAL_DIR, `${id}.ics`), validateIcs(text));
  feedCache.delete(id);
}

export async function removeCalendarFiles(id) {
  feedCache.delete(id);
  await fs.rm(path.join(CAL_DIR, `${id}.ics`), { force: true });
}

export function invalidate(id) {
  feedCache.delete(id);
}

async function fetchIcs(url) {
  let res;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/calendar, text/plain, */*' },
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'Zeitüberschreitung' : err.cause?.code || err.cause?.message || err.message;
    throw new Error(`Server nicht erreichbar (${reason}).`);
  }
  if (res.status === 404) throw new Error('Link nicht gefunden (HTTP 404) – ist die iCal-Adresse noch gültig?');
  if (!res.ok) throw new Error(`Abruf fehlgeschlagen (HTTP ${res.status}).`);
  return validateIcs(await res.text());
}

async function loadCalendarData(cal) {
  const hit = feedCache.get(cal.id);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const text =
    cal.type === 'file'
      ? await fs.readFile(path.join(CAL_DIR, `${cal.id}.ics`), 'utf8')
      : await fetchIcs(cal.url);
  const data = ical.sync.parseICS(text);
  feedCache.set(cal.id, { at: Date.now(), data });
  return data;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Ganztägige Termine als reines Datum (YYYY-MM-DD) übergeben, damit es keine Zeitzonen-Verschiebung gibt.
function toDay(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'val' in value) return String(value.val);
  return String(value);
}

/**
 * Liefert alle Termine aller aktiven Kalender im Zeitraum [from, to].
 * Fehler einzelner Kalender werden gesammelt statt die ganze Antwort scheitern zu lassen.
 */
export async function getEvents(calendars, from, to) {
  const events = [];
  const errors = [];

  await Promise.all(
    calendars
      .filter((c) => c.enabled !== false)
      .map(async (cal) => {
        try {
          const data = await loadCalendarData(cal);
          const items = Object.values(data);
          const recurringUids = new Set(items.filter((i) => i.rrule).map((i) => i.uid));
          for (const item of items) {
            if (item.type !== 'VEVENT' || !item.start) continue;
            if (item.status === 'CANCELLED') continue;
            // Einzelne geänderte Instanzen (RECURRENCE-ID) werden über das Haupt-Event expandiert.
            if (item.recurrenceid && !item.rrule && recurringUids.has(item.uid)) continue;

            let instances;
            try {
              instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
            } catch (err) {
              continue; // fehlerhafte Wiederholungsregel -> Termin überspringen
            }

            for (const inst of instances) {
              const ev = inst.event || item;
              if (ev.status === 'CANCELLED') continue;
              const allDay = Boolean(inst.isFullDay);
              events.push({
                id: `${cal.id}:${item.uid || ''}:${inst.start.getTime()}`,
                calendarId: cal.id,
                calendarName: cal.name,
                color: cal.color,
                title: textOf(inst.summary ?? ev.summary) || '(ohne Titel)',
                location: textOf(ev.location),
                description: textOf(ev.description).slice(0, 2000),
                allDay,
                start: allDay ? toDay(inst.start) : inst.start.toISOString(),
                end: inst.end ? (allDay ? toDay(inst.end) : inst.end.toISOString()) : null,
              });
            }
          }
        } catch (err) {
          errors.push({ calendarId: cal.id, calendarName: cal.name, message: err.message });
        }
      }),
  );

  // Ganztägige Termine = lokale Mitternacht, stehen also vor den Terminen desselben Tages.
  const sortKey = (e) => new Date(e.allDay ? `${e.start}T00:00:00` : e.start).getTime();
  events.sort((a, b) => sortKey(a) - sortKey(b) || Number(b.allDay) - Number(a.allDay));

  return { events, errors };
}
