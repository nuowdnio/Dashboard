// E-Mail per IMAP (für GMX vorkonfiguriert).
// 1. Übersicht über "noch zu bearbeitende" Mails: ungelesene und markierte (⭐) im Posteingang.
// 2. Versandbestätigungen erkennen und daraus automatisch Pakete anlegen.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { guessCarrier } from './packages.js';

const OVERVIEW_TTL_MS = 2 * 60 * 1000;
const SCAN_DAYS = 14;
const MAX_SCAN_MESSAGES = 40;
const MAX_LIST = 25;

// IMAP-Server anhand der Mailadresse (GMX zuerst, ein paar andere gleich mit).
const HOSTS = [
  [/@gmx\.(de|net|at|ch)$/i, 'imap.gmx.net'],
  [/@gmx\./i, 'imap.gmx.com'],
  [/@(web\.de)$/i, 'imap.web.de'],
  [/@(gmail|googlemail)\.com$/i, 'imap.gmail.com'],
  [/@t-online\.de$/i, 'secureimap.t-online.de'],
  [/@(outlook|hotmail|live)\./i, 'outlook.office365.com'],
];

export function imapHost(cfg) {
  if (cfg.host) return cfg.host;
  return (HOSTS.find(([re]) => re.test(cfg.email)) || [null, 'imap.gmx.net'])[1];
}

export function webmailUrl(cfg) {
  const host = imapHost(cfg);
  if (host.includes('gmx.com')) return 'https://www.gmx.com/';
  if (host.includes('gmx')) return 'https://www.gmx.net/';
  if (host.includes('web.de')) return 'https://web.de/';
  if (host.includes('gmail')) return 'https://mail.google.com/';
  if (host.includes('office365')) return 'https://outlook.live.com/mail/';
  return '';
}

function friendlyError(err) {
  const text = `${err.responseText || ''} ${err.message || ''}`;
  if (err.authenticationFailed || /auth|login|credentials|password/i.test(text)) {
    return 'Anmeldung fehlgeschlagen. Stimmen Adresse und Passwort, und ist bei GMX der IMAP-Zugriff erlaubt?';
  }
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || /timeout/i.test(text)) {
    return `Mailserver nicht erreichbar (${err.code || 'Zeitüberschreitung'}).`;
  }
  return `Mailabruf fehlgeschlagen: ${err.message}`;
}

async function withInbox(cfg, fn) {
  const port = Number(process.env.MAIL_IMAP_PORT || 993);
  const client = new ImapFlow({
    host: imapHost(cfg),
    port,
    secure: process.env.MAIL_IMAP_INSECURE ? false : true, // nur für lokale Tests unverschlüsselt
    auth: { user: cfg.email, pass: cfg.password },
    logger: false,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  client.on('error', () => {}); // Verbindungsfehler werden über connect()/await gemeldet
  try {
    await client.connect();
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  const lock = await client.getMailboxLock('INBOX');
  try {
    return await fn(client);
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
}

async function fetchAll(client, uids, query) {
  const out = [];
  if (!uids.length) return out;
  for await (const msg of client.fetch(uids, query, { uid: true })) out.push(msg);
  return out;
}

const addr = (list) => list?.[0] || {};

// ---------- Übersicht offene Mails ----------
let overviewCache = null; // { key, at, data }

export async function verifyLogin(cfg) {
  await withInbox(cfg, async () => true);
}

export async function getOverview(cfg, { refresh = false } = {}) {
  const key = `${cfg.email}|${imapHost(cfg)}`;
  if (!refresh && overviewCache?.key === key && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) return overviewCache.data;

  const data = await withInbox(cfg, async (client) => {
    const unseen = (await client.search({ seen: false }, { uid: true })) || [];
    const flagged = (await client.search({ flagged: true }, { uid: true })) || [];
    const uids = [...new Set([...unseen, ...flagged])].sort((a, b) => b - a).slice(0, MAX_LIST);
    const msgs = await fetchAll(client, uids, { uid: true, envelope: true, flags: true, internalDate: true });
    const messages = msgs
      .map((m) => {
        const from = addr(m.envelope?.from);
        return {
          uid: m.uid,
          from: from.name || from.address || 'Unbekannt',
          fromAddress: from.address || '',
          subject: m.envelope?.subject || '(kein Betreff)',
          date: (m.envelope?.date || m.internalDate || new Date()).toISOString(),
          unread: !m.flags?.has('\\Seen'),
          flagged: Boolean(m.flags?.has('\\Flagged')),
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
    return { unreadCount: unseen.length, flaggedCount: flagged.length, messages };
  });
  overviewCache = { key, at: Date.now(), data };
  return data;
}

/** Mail als gelesen markieren bzw. Markierung (⭐) entfernen. */
export async function updateMessage(cfg, uid, { seen, flagged }) {
  overviewCache = null;
  await withInbox(cfg, async (client) => {
    if (seen === true) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    if (seen === false) await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
    if (flagged === false) await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
    if (flagged === true) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
  });
}

export function clearMailCache() {
  overviewCache = null;
}

// ---------- Versandmails -> Pakete ----------
const CARRIER_SENDERS = [
  [/dhl\.(de|com)|deutschepost|post\.de/i, 'dhl'],
  [/hermes|myhermes/i, 'hermes'],
  [/dpd\./i, 'dpd'],
  [/gls[-.]/i, 'gls'],
  [/ups\.com/i, 'ups'],
  [/amazon\./i, 'amazon'],
];
const CARRIER_NAMES = { dhl: 'DHL', hermes: 'Hermes', dpd: 'DPD', gls: 'GLS', ups: 'UPS' };
const SHIPPING_SUBJECT =
  /versand|versendet|verschickt|unterwegs|auf dem weg|sendung|paket|lieferung|zustellung|zugestellt|geliefert|shipped|shipment|tracking|delivered/i;
const NOT_SHIPPING = /newsletter|gutschein|rabatt|angebot|bewert|umfrage|rechnung|invoice|sale\b/i;

const URL_PATTERNS = [
  ['dpd', /dpd\.(?:de|com)[^\s"'<>]*?(?:parcel\/|parcelno=|parcelNr=|query=)(\d{14})/i],
  ['gls', /gls[^\s"'<>]*?(?:match=|parcelno=|txtRefNo=)([A-Z0-9]{8,14})/i],
  ['hermes', /hermes[^\s"'<>]*?(?:sendungsinformation\/?#|shipmentID=|shipmentId=|#)([A-Z0-9]{14,20})/i],
  ['dhl', /dhl\.[^\s"'<>]*?(?:piececode|idc|tracking-id|trackingnumber|tracking-number)=([A-Z0-9]{10,39})/i],
  ['ups', /\b(1Z[0-9A-Z]{16})\b/],
];
const LABELED_NUMBER =
  /(?:sendungs-?\s?(?:nummer|nr\.?|id)|tracking-?\s?(?:nummer|number|nr\.?|id)|paket-?\s?(?:nummer|nr\.?)|parcel\s?(?:number|no\.?))\s*[:#]?\s*([A-Z0-9]{8,30})/i;

function parseGermanDate(day, month, year, ref) {
  let y = year ? Number(year.length === 2 ? `20${year}` : year) : ref.getFullYear();
  const d = new Date(y, Number(month) - 1, Number(day));
  if (!year && d < new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 30)) d.setFullYear(y + 1); // Jahreswechsel
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(month) - 1) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Wertet eine Mail aus. Gibt null zurück, wenn es keine Versandmail ist,
 * sonst { carrier, trackingNumber, title, status, expected }.
 */
export function extractShipment({ fromName = '', fromAddress = '', subject = '', text = '', html = '', date = new Date() }) {
  if (!SHIPPING_SUBJECT.test(subject) || NOT_SHIPPING.test(subject)) return null;
  const body = `${text}\n${html}`.slice(0, 300_000);
  const senderCarrier = (CARRIER_SENDERS.find(([re]) => re.test(fromAddress)) || [])[1] || null;

  let carrier = null;
  let trackingNumber = '';
  for (const [c, re] of URL_PATTERNS) {
    const m = body.match(re);
    if (m) {
      carrier = c;
      trackingNumber = m[1].toUpperCase();
      break;
    }
  }
  if (!trackingNumber) {
    const m = `${subject}\n${text || body}`.match(LABELED_NUMBER);
    if (m && /\d{6,}/.test(m[1])) trackingNumber = m[1].toUpperCase();
  }
  if (!carrier) {
    const mentioned = /\bDHL\b/.test(body) ? 'dhl' : /\bHermes\b/i.test(body) ? 'hermes' : /\bDPD\b/.test(body) ? 'dpd' : /\bGLS\b/.test(body) ? 'gls' : /\bUPS\b/.test(body) ? 'ups' : null;
    const guessed = trackingNumber ? guessCarrier(trackingNumber) : null;
    carrier = (senderCarrier !== 'amazon' && senderCarrier) || (guessed !== 'other' && guessed) || mentioned || senderCarrier || 'other';
  }

  // Ohne Sendungsnummer nur, wenn es eindeutig eine Versandmail eines Händlers/Paketdiensts ist.
  if (!trackingNumber && !(senderCarrier && /versandt|verschickt|unterwegs|auf dem weg|shipped|zugestellt|geliefert/i.test(subject))) {
    return null;
  }

  let status = 'transit';
  if (/zugestellt|wurde geliefert|delivered|abgegeben/i.test(subject)) status = 'delivered';
  else if (/heute|in zustellung|zustellfahrzeug|out for delivery/i.test(subject)) status = 'out_for_delivery';
  else if (/angekündigt|vorankündigung|ankündigung/i.test(subject)) status = 'expected';

  let expected = '';
  const dm = body.match(/(?:voraussichtlich|zustellung|lieferung|ankunft|zustelltag|liefertermin)[^\n]{0,80}?(\d{1,2})\.\s?(\d{1,2})\.(\d{4}|\d{2})?/i);
  if (dm) expected = parseGermanDate(dm[1], dm[2], dm[3], date);
  if (!expected && status === 'out_for_delivery') expected = parseGermanDate(date.getDate(), date.getMonth() + 1, String(date.getFullYear()), date);

  // Titel: Artikel in Anführungszeichen aus dem Betreff, sonst Absender + Betreff.
  const quoted = subject.match(/[„"“»]([^"“”«]{3,80})[“”"«]/);
  const shop = fromName.replace(/\s*(versand|kundenservice|team|no-?reply)\s*$/i, '').trim();
  let title;
  if (quoted) title = `${shop ? shop + ': ' : ''}${quoted[1]}`;
  else if (senderCarrier && senderCarrier !== 'amazon') {
    // Mail vom Paketdienst selbst: Absender (Shop) steht oft im Text.
    const from = `${text}`.match(/(?:absender|versender|von)\s*:\s*([^\n<]{2,40})/i);
    title = `${CARRIER_NAMES[senderCarrier]}-Paket${from ? ` von ${from[1].trim()}` : ''}`;
  } else title = `${shop || 'Paket'}: ${subject}`;
  title = title.slice(0, 100);

  return { carrier, trackingNumber, title, status, expected };
}

/**
 * Durchsucht die Mails der letzten 14 Tage nach Versandmails.
 * `known` = bereits ausgewertete Message-IDs (werden übersprungen).
 */
export async function scanShipments(cfg, known = new Set()) {
  return withInbox(cfg, async (client) => {
    const since = new Date(Date.now() - SCAN_DAYS * 86_400_000);
    const uids = ((await client.search({ since }, { uid: true })) || []).sort((a, b) => b - a).slice(0, 300);
    const heads = await fetchAll(client, uids, { uid: true, envelope: true });
    const fresh = heads.filter((m) => m.envelope?.messageId && !known.has(m.envelope.messageId));
    const shipping = fresh.filter((m) => SHIPPING_SUBJECT.test(m.envelope?.subject || '') && !NOT_SHIPPING.test(m.envelope?.subject || ''));
    const candidates = shipping.slice(0, MAX_SCAN_MESSAGES);
    // Was diesmal nicht ausgewertet wurde (zu viele Kandidaten), bleibt für den nächsten Durchlauf offen.
    const postponed = new Set(shipping.slice(MAX_SCAN_MESSAGES));
    const checkedIds = fresh.filter((m) => !postponed.has(m)).map((m) => m.envelope.messageId);
    const sources = await fetchAll(client, candidates.map((m) => m.uid), { uid: true, envelope: true, source: true });
    const found = [];
    for (const m of sources) {
      try {
        const parsed = await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true });
        const from = parsed.from?.value?.[0] || {};
        const shipment = extractShipment({
          fromName: from.name || '',
          fromAddress: from.address || '',
          subject: parsed.subject || '',
          text: parsed.text || '',
          html: typeof parsed.html === 'string' ? parsed.html : '',
          date: parsed.date || new Date(),
        });
        if (shipment) found.push({ ...shipment, messageId: m.envelope.messageId, mailDate: (parsed.date || new Date()).toISOString() });
      } catch {
        // kaputte Mail ignorieren
      }
    }
    // Älteste zuerst, damit spätere Mails (z. B. "zugestellt") den Status überschreiben.
    found.sort((a, b) => a.mailDate.localeCompare(b.mailDate));
    return { shipments: found, checkedIds };
  });
}
