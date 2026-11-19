// Datenschicht im Browser: beantwortet die /api/...-Aufrufe der Oberfläche ohne Server.
// Daten liegen im localStorage dieses Geräts. Direkt abgefragt werden: Wetter (Open-Meteo),
// Unwetterwarnungen des DWD (über Bright Sky), Spritpreise (Tankerkönig), Todoist und das Morgenbriefing.

const KEY = 'dashboard-data-v1';
const TZ = 'Europe/Berlin';

const DEFAULTS = {
  car: {
    name: '',
    model: '',
    licensePlate: '',
    mileageKm: null,
    fuelPercent: null,
    rangeKm: null,
    nextInspection: '',
    nextService: '',
    nextServiceKm: null,
    tireChange: '',
    locked: null,
    location: '',
    notes: '',
    oilLastKm: null, // letzter Ölwechsel bei km
    oilLastDate: '', // … und am
    oilIntervalKm: 15000,
    oilIntervalMonths: 12,
    updatedAt: null,
  },
  tasks: [],
  expenses: [],
  notes: [], // kurze Notizen
  settings: {
    weather: { name: 'Wiesbaden', latitude: 50.0826, longitude: 8.24 },
    todoist: { token: '', filter: 'overdue | 7 days' },
    fuel: { apiKey: '', type: 'e10', radius: 5 },
    briefing: { url: 'https://nuowdnio.github.io/morgenbriefing/' },
  },
  lastBackupAt: null,
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function normalize(parsed = {}) {
  return {
    ...clone(DEFAULTS),
    ...parsed,
    car: { ...DEFAULTS.car, ...(parsed.car || {}) },
    settings: {
      weather: parsed.settings?.weather || clone(DEFAULTS.settings.weather),
      todoist: { ...DEFAULTS.settings.todoist, ...(parsed.settings?.todoist || {}) },
      fuel: { ...DEFAULTS.settings.fuel, ...(parsed.settings?.fuel || {}) },
      briefing: { ...DEFAULTS.settings.briefing, ...(parsed.settings?.briefing || {}) },
    },
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
    expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
  };
}

let db = null;
function load() {
  if (db) return db;
  try {
    db = normalize(JSON.parse(localStorage.getItem(KEY) || '{}'));
  } catch {
    db = normalize();
  }
  return db;
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new HttpError(507, 'Speichern im Browser nicht möglich (Speicher voll oder privater Modus).');
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const dateOrEmpty = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
const round2 = (n) => Math.round(n * 100) / 100;
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function publicSettings() {
  return {
    weather: db.settings.weather,
    todoist: { connected: Boolean(db.settings.todoist.token), fromEnv: false, filter: db.settings.todoist.filter },
    fuel: { configured: Boolean(db.settings.fuel.apiKey), type: db.settings.fuel.type, radius: db.settings.fuel.radius },
    briefing: { url: db.settings.briefing.url },
  };
}

// ---------- Auto ----------
function putCar(b) {
  db.car = {
    ...db.car,
    name: str(b.name, 100),
    model: str(b.model, 100),
    licensePlate: str(b.licensePlate, 20),
    mileageKm: numOrNull(b.mileageKm),
    fuelPercent: b.fuelPercent == null || b.fuelPercent === '' ? null : Math.max(0, Math.min(100, Number(b.fuelPercent) || 0)),
    rangeKm: numOrNull(b.rangeKm),
    nextInspection: dateOrEmpty(b.nextInspection),
    nextService: dateOrEmpty(b.nextService),
    nextServiceKm: numOrNull(b.nextServiceKm),
    tireChange: dateOrEmpty(b.tireChange),
    locked: typeof b.locked === 'boolean' ? b.locked : null,
    location: str(b.location, 200),
    notes: str(b.notes, 2000),
    oilLastKm: numOrNull(b.oilLastKm),
    oilLastDate: dateOrEmpty(b.oilLastDate),
    oilIntervalKm: numOrNull(b.oilIntervalKm) || 15000,
    oilIntervalMonths: numOrNull(b.oilIntervalMonths) || 12,
    updatedAt: new Date().toISOString(),
  };
  save();
  return db.car;
}

// ---------- Aufgaben (lokal) ----------
const PRIORITIES = ['low', 'normal', 'high'];
function sanitizeTask(b, existing = {}) {
  return {
    ...existing,
    ...(b.title !== undefined && { title: str(b.title, 300) }),
    ...(b.notes !== undefined && { notes: str(b.notes, 2000) }),
    ...(b.due !== undefined && { due: dateOrEmpty(b.due) }),
    ...(b.priority !== undefined && { priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal' }),
    ...(b.done !== undefined && { done: Boolean(b.done), doneAt: b.done ? new Date().toISOString() : null }),
  };
}

// ---------- Todoist (API v1) ----------
const TODOIST = 'https://api.todoist.com/api/v1';
let todoistCache = null;

async function todoistCall(token, path, { method = 'GET', query, body } = {}) {
  const url = new URL(TODOIST + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new HttpError(502, 'Todoist nicht erreichbar (keine Verbindung oder vom Browser blockiert).');
  }
  if (res.status === 401 || res.status === 403) throw new HttpError(401, 'Todoist-Token ungültig oder abgelaufen.');
  if (res.status === 400 && path.includes('filter')) throw new HttpError(400, 'Der Todoist-Filter ist ungültig. Bitte in den Einstellungen prüfen.');
  if (!res.ok) throw new HttpError(502, `Todoist antwortet mit HTTP ${res.status}.`);
  const text = res.status === 204 ? '' : await res.text();
  return text ? JSON.parse(text) : null;
}

async function todoistAll(token, path, query = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = await todoistCall(token, path, { query: { ...query, limit: '200', cursor } });
    out.push(...(data.results || []));
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

const PRIORITY_LABEL = { 4: 'P1', 3: 'P2', 2: 'P3', 1: null };
function mapTodoist(t, projects) {
  const due = t.due || null;
  return {
    id: t.id,
    title: t.content,
    notes: t.description || '',
    due: due?.date ? due.date.slice(0, 10) : '',
    dueDateTime: due?.date && due.date.length > 10 ? due.date : null,
    dueString: due?.string || '',
    recurring: Boolean(due?.is_recurring),
    priority: t.priority === 4 ? 'high' : t.priority === 1 ? 'normal' : 'medium',
    priorityLabel: PRIORITY_LABEL[t.priority] || null,
    project: projects.get(t.project_id) || '',
    labels: t.labels || [],
    done: Boolean(t.checked),
    url: `https://app.todoist.com/app/task/${t.id}`,
    createdAt: t.added_at || '',
    source: 'todoist',
  };
}

async function todoistTasks(refresh) {
  const { token, filter } = db.settings.todoist;
  const key = `${token.slice(-6)}|${filter}`;
  if (!refresh && todoistCache?.key === key && Date.now() - todoistCache.at < 60_000) return todoistCache.data;
  const [tasks, projectList] = await Promise.all([
    todoistAll(token, '/tasks/filter', { query: filter, lang: 'en' }),
    todoistAll(token, '/projects'),
  ]);
  const projects = new Map(projectList.map((p) => [p.id, p.name === 'Inbox' ? 'Eingang' : p.name]));
  const data = tasks.map((t) => mapTodoist(t, projects));
  todoistCache = { key, at: Date.now(), data };
  return data;
}

// ---------- Wetter (Open-Meteo) ----------
let weatherCache = null;

async function getJson(url, what) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new HttpError(502, `${what} nicht erreichbar (keine Internetverbindung?).`);
  }
  if (!res.ok) throw new HttpError(502, `${what} antwortet mit HTTP ${res.status}.`);
  return res.json();
}

async function searchPlaces(name) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '6', language: 'de', format: 'json' });
  const data = await getJson(url, 'Ortssuche');
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

async function getForecast(loc, refresh) {
  const key = `${loc.latitude},${loc.longitude}`;
  if (!refresh && weatherCache?.key === key && Date.now() - weatherCache.at < 15 * 60_000) return weatherCache.data;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(loc.latitude),
    longitude: String(loc.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset',
    timezone: TZ,
    forecast_days: '6',
    wind_speed_unit: 'kmh',
  });
  const raw = await getJson(url, 'Wetterdienst');
  const nowHour = raw.current.time.slice(0, 13);
  const startIdx = Math.max(0, raw.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const data = {
    location: loc.name,
    current: {
      time: raw.current.time,
      temperature: raw.current.temperature_2m,
      feelsLike: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      precipitation: raw.current.precipitation,
      windSpeed: raw.current.wind_speed_10m,
      code: raw.current.weather_code,
      isDay: raw.current.is_day !== 0,
    },
    hourly: raw.hourly.time.slice(startIdx, startIdx + 24).map((time, i) => ({
      time,
      temperature: raw.hourly.temperature_2m[startIdx + i],
      precipitationProbability: raw.hourly.precipitation_probability?.[startIdx + i] ?? null,
      precipitation: raw.hourly.precipitation?.[startIdx + i] ?? 0,
      code: raw.hourly.weather_code[startIdx + i],
      isDay: raw.hourly.is_day?.[startIdx + i] !== 0,
    })),
    daily: raw.daily.time.map((date, i) => ({
      date,
      code: raw.daily.weather_code[i],
      max: raw.daily.temperature_2m_max[i],
      min: raw.daily.temperature_2m_min[i],
      precipitationProbability: raw.daily.precipitation_probability_max?.[i] ?? null,
      precipitationSum: raw.daily.precipitation_sum?.[i] ?? 0,
      sunrise: raw.daily.sunrise?.[i] ?? null,
      sunset: raw.daily.sunset?.[i] ?? null,
    })),
    fetchedAt: new Date().toISOString(),
  };
  weatherCache = { key, at: Date.now(), data };
  return data;
}

// ---------- Auto-Ausgaben ----------
export const EXPENSE_CATEGORIES = {
  fuel: 'Tanken',
  oil: 'Ölwechsel',
  service: 'Inspektion / Wartung',
  repair: 'Reparatur',
  tires: 'Reifen',
  insurance: 'Versicherung',
  tax: 'Kfz-Steuer',
  inspection: 'HU / TÜV',
  parking: 'Parken / Maut',
  care: 'Pflege / Wäsche',
  other: 'Sonstiges',
};

function sanitizeExpense(b, existing = {}) {
  const e = { ...existing };
  if (b.date !== undefined) e.date = dateOrEmpty(b.date) || todayStr();
  if (b.category !== undefined) e.category = EXPENSE_CATEGORIES[b.category] ? b.category : 'other';
  if (b.amount !== undefined) {
    const amount = Number(String(b.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new HttpError(400, 'Bitte einen gültigen Betrag eingeben.');
    e.amount = round2(amount);
  }
  if (b.mileageKm !== undefined) e.mileageKm = numOrNull(b.mileageKm) == null ? null : Math.round(numOrNull(b.mileageKm));
  if (b.liters !== undefined) {
    const l = numOrNull(String(b.liters ?? '').replace(',', '.'));
    e.liters = l == null || l <= 0 ? null : round2(l);
  }
  if (b.fullTank !== undefined) e.fullTank = Boolean(b.fullTank);
  if (b.station !== undefined) e.station = str(b.station, 100);
  if (b.note !== undefined) e.note = str(b.note, 500);
  if (e.category !== 'fuel') {
    e.liters = null;
    e.fullTank = false;
  }
  return e;
}

function syncCarFromExpense(e) {
  let changed = false;
  if (e.mileageKm != null && (db.car.mileageKm == null || e.mileageKm > db.car.mileageKm)) {
    db.car.mileageKm = e.mileageKm;
    changed = true;
  }
  if (e.category === 'fuel' && e.fullTank && e.date === todayStr()) {
    db.car.fuelPercent = 100;
    changed = true;
  }
  // Ein eingetragener Ölwechsel setzt den Ölwechsel-Zähler zurück.
  if (e.category === 'oil' && (!db.car.oilLastDate || e.date >= db.car.oilLastDate)) {
    db.car.oilLastDate = e.date;
    if (e.mileageKm != null) db.car.oilLastKm = e.mileageKm;
    changed = true;
  }
  if (changed) db.car.updatedAt = new Date().toISOString();
}

const sortExpenses = (list) => [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.mileageKm ?? 0) - (a.mileageKm ?? 0));

/** CSV (Excel-kompatibel: Semikolon, Dezimalkomma, BOM) */
export function expensesCsv() {
  load();
  const cell = (v) => {
    const t = v == null ? '' : String(v);
    return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const num = (n) => (n == null ? '' : String(n).replace('.', ','));
  const rows = [['Datum', 'Kategorie', 'Betrag (EUR)', 'Kilometerstand', 'Liter', 'Preis je Liter', 'Vollgetankt', 'Tankstelle', 'Notiz']];
  for (const e of sortExpenses(db.expenses).reverse()) {
    rows.push([
      e.date,
      EXPENSE_CATEGORIES[e.category],
      num(e.amount),
      e.mileageKm ?? '',
      num(e.liters),
      e.liters ? num((e.amount / e.liters).toFixed(3)) : '',
      e.category === 'fuel' ? (e.fullTank ? 'ja' : 'nein') : '',
      e.station,
      e.note,
    ]);
  }
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}

// ---------- Sicherung ----------
export function exportBackup() {
  load();
  db.lastBackupAt = new Date().toISOString();
  save();
  // Der Todoist-Token gehört nicht in eine Datei, die man herumschickt.
  const copy = clone(db);
  copy.settings.todoist.token = '';
  copy.settings.fuel.apiKey = '';
  return JSON.stringify({ app: 'dashboard', version: 1, exportedAt: db.lastBackupAt, data: copy }, null, 2);
}

export function importBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Die Datei ist keine gültige Sicherung.');
  }
  if (parsed?.app !== 'dashboard' || !parsed.data) throw new Error('Die Datei ist keine Dashboard-Sicherung.');
  const { token } = load().settings.todoist;
  const { apiKey } = db.settings.fuel;
  db = normalize(parsed.data);
  if (!db.settings.todoist.token) db.settings.todoist.token = token; // eigene Schlüssel behalten
  if (!db.settings.fuel.apiKey) db.settings.fuel.apiKey = apiKey;
  save();
  return { tasks: db.tasks.length, expenses: db.expenses.length, notes: db.notes.length };
}

export function backupInfo() {
  load();
  return { lastBackupAt: db.lastBackupAt, entries: db.expenses.length + db.tasks.length + db.notes.length };
}

// ---------- Unwetterwarnungen (DWD über Bright Sky, kostenlos, ohne Schlüssel) ----------
let alertsCache = null;
async function getAlerts(loc, refresh) {
  const key = `${loc.latitude},${loc.longitude}`;
  if (!refresh && alertsCache?.key === key && Date.now() - alertsCache.at < 10 * 60_000) return alertsCache.data;
  const url = new URL('https://api.brightsky.dev/alerts');
  url.search = new URLSearchParams({ lat: String(loc.latitude), lon: String(loc.longitude) });
  const raw = await getJson(url, 'Warndienst');
  const now = Date.now();
  const alerts = (raw.alerts || [])
    .filter((a) => !a.expires || new Date(a.expires).getTime() > now)
    .map((a) => ({
      id: a.id ?? a.alert_id,
      severity: a.severity || 'minor',
      // DWD liefert Ereignisse in Großbuchstaben ("STRENGER FROST") -> "Strenger Frost"
      event: (a.event_de || a.event_en || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase()),
      headline: a.headline_de || a.headline_en || '',
      description: a.description_de || a.description_en || '',
      instruction: a.instruction_de || a.instruction_en || '',
      onset: a.onset || a.effective || null,
      expires: a.expires || null,
    }));
  const RANK = { extreme: 0, severe: 1, moderate: 2, minor: 3 };
  alerts.sort((a, b) => (RANK[a.severity] ?? 4) - (RANK[b.severity] ?? 4));
  const data = { alerts, area: raw.location?.name || loc.name, fetchedAt: new Date().toISOString() };
  alertsCache = { key, at: Date.now(), data };
  return data;
}

// ---------- Spritpreise (Tankerkönig, Daten der MTS-K, CC BY 4.0) ----------
const FUEL_CACHE_KEY = 'dashboard-fuelprices-v1';
async function getFuelPrices(refresh) {
  const { apiKey, type, radius } = db.settings.fuel;
  const loc = db.settings.weather;
  const key = `${loc.latitude},${loc.longitude},${radius}`;
  let cached = null;
  try {
    cached = JSON.parse(localStorage.getItem(FUEL_CACHE_KEY) || 'null');
  } catch {}
  // Tankerkönig bittet um sparsame Abfragen: höchstens alle 10 Minuten.
  if (cached?.key === key && Date.now() - cached.at < (refresh ? 5 : 10) * 60_000) return { ...cached.data, type };

  const url = new URL('https://creativecommons.tankerkoenig.de/json/list.php');
  url.search = new URLSearchParams({ lat: String(loc.latitude), lng: String(loc.longitude), rad: String(radius), sort: 'dist', type: 'all', apikey: apiKey });
  let raw;
  try {
    raw = await getJson(url, 'Tankerkönig');
  } catch (err) {
    if (cached?.key === key) return { ...cached.data, type, stale: true, error: err.message };
    throw err;
  }
  if (!raw.ok) throw new HttpError(502, raw.message ? `Tankerkönig: ${raw.message}` : 'Tankerkönig hat keine Daten geliefert.');
  const data = {
    place: loc.name,
    radius,
    stations: (raw.stations || []).map((st) => ({
      id: st.id,
      name: st.brand || st.name,
      fullName: st.name,
      street: [st.street, st.houseNumber].filter(Boolean).join(' ').trim(),
      place: st.place,
      dist: st.dist,
      isOpen: Boolean(st.isOpen),
      e5: typeof st.e5 === 'number' ? st.e5 : null,
      e10: typeof st.e10 === 'number' ? st.e10 : null,
      diesel: typeof st.diesel === 'number' ? st.diesel : null,
      lat: st.lat,
      lng: st.lng,
    })),
    fetchedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(FUEL_CACHE_KEY, JSON.stringify({ key, at: Date.now(), data }));
  } catch {}
  return { ...data, type };
}

// ---------- Morgenbriefing (eigenes Projekt "morgenbriefing" auf GitHub Pages) ----------
let briefingCache = null;
async function getBriefing(refresh) {
  const base = db.settings.briefing.url.replace(/\/?$/, '/');
  if (!refresh && briefingCache?.base === base && Date.now() - briefingCache.at < 15 * 60_000) return briefingCache.data;
  const bust = refresh ? `?t=${Date.now()}` : '';
  const index = await getJson(new URL(`data/index.json${bust}`, base), 'Morgenbriefing');
  const day = index.dates?.[0];
  if (!day) throw new HttpError(404, 'Noch kein Briefing vorhanden.');
  const raw = await getJson(new URL(`data/${day}.json${bust}`, base), 'Morgenbriefing');

  // Dieselben Themen ausblenden wie auf der Briefing-Seite (gleiche Webadresse, gleicher Speicher).
  let off = new Set();
  try {
    off = new Set(JSON.parse(localStorage.getItem('briefing.topics.off') || '[]'));
  } catch {}
  const labels = new Map((raw.topics || []).map((t) => [t.id, t.label]));
  const count = Math.min(Number(raw.top_count) || 5, 5);
  const stories = (raw.stories || [])
    .filter((st) => !off.has(st.topic))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, count)
    .map((st) => ({
      title: st.title,
      summary: (Array.isArray(st.summary) ? st.summary[0] : st.summary) || '',
      topic: labels.get(st.topic) || st.topic,
      sourceCount: st.source_count || st.links?.length || 1,
      url: st.links?.[0]?.url || '',
      source: st.links?.[0]?.source || '',
    }));
  const dax = raw.markets?.groups?.flatMap((g) => g.items || []).find((i) => i.symbol === '^GDAXI');
  const data = {
    date: raw.date,
    generatedAt: raw.generated_at,
    url: base,
    stories,
    markets: raw.markets?.available ? raw.markets.summary : '',
    dax: dax ? { price: dax.price, change: dax.change_1d } : null,
  };
  briefingCache = { base, at: Date.now(), data };
  return data;
}

// ---------- Notizen ----------
function sanitizeNote(b, existing = {}) {
  const text = str(b.text, 2000);
  if (!text) throw new HttpError(400, 'Die Notiz ist leer.');
  return { ...existing, text, pinned: b.pinned !== undefined ? Boolean(b.pinned) : Boolean(existing.pinned), updatedAt: new Date().toISOString() };
}
const sortNotes = (list) => [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));

// ---------- Router ----------
// Ergebnisse immer als Kopie herausgeben, damit die Oberfläche die gespeicherten Daten nicht versehentlich mitändert.
export async function localApi(path, options = {}) {
  const result = await route(path, options);
  return result == null ? result : clone(result);
}

async function route(path, { method = 'GET', body } = {}) {
  load();
  const url = new URL(path, 'http://local');
  const p = url.pathname;
  const q = url.searchParams;
  const b = typeof body === 'string' ? JSON.parse(body) : body || {};
  let m;

  if (p === '/api/state' && method === 'GET') return { car: db.car, settings: publicSettings() };
  if (p === '/api/car' && method === 'PUT') return putCar(b);

  // Aufgaben
  if (p === '/api/tasks' && method === 'GET') {
    if (!db.settings.todoist.token) return { source: 'local', tasks: db.tasks };
    try {
      return { source: 'todoist', tasks: await todoistTasks(q.has('refresh')) };
    } catch (err) {
      return { source: 'todoist', tasks: [], error: err.message };
    }
  }
  if (p === '/api/tasks' && method === 'POST') {
    const token = db.settings.todoist.token;
    if (token) {
      const text = str(b.title, 500);
      if (!text) throw new HttpError(400, 'Titel fehlt.');
      todoistCache = null;
      return mapTodoist(await todoistCall(token, '/tasks/quick', { method: 'POST', body: { text } }), new Map());
    }
    const task = sanitizeTask(b, { id: newId(), title: '', notes: '', due: '', priority: 'normal', done: false, doneAt: null, createdAt: new Date().toISOString() });
    if (!task.title) throw new HttpError(400, 'Titel fehlt.');
    db.tasks.push(task);
    save();
    return task;
  }
  if ((m = p.match(/^\/api\/tasks\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    const token = db.settings.todoist.token;
    if (method === 'PATCH') {
      if (token) {
        if (b.done === undefined) throw new HttpError(400, 'Todoist-Aufgaben bitte direkt in Todoist bearbeiten.');
        todoistCache = null;
        await todoistCall(token, `/tasks/${encodeURIComponent(id)}/${b.done ? 'close' : 'reopen'}`, { method: 'POST' });
        return { id, done: Boolean(b.done) };
      }
      const i = db.tasks.findIndex((t) => t.id === id);
      if (i < 0) throw new HttpError(404, 'Aufgabe nicht gefunden.');
      db.tasks[i] = sanitizeTask(b, db.tasks[i]);
      save();
      return db.tasks[i];
    }
    if (method === 'DELETE') {
      db.tasks = db.tasks.filter((t) => t.id !== id);
      save();
      return null;
    }
  }

  // Ausgaben
  if (p === '/api/expenses' && method === 'GET') return { expenses: sortExpenses(db.expenses), categories: EXPENSE_CATEGORIES };
  if (p === '/api/expenses' && method === 'POST') {
    const e = sanitizeExpense(
      { date: '', category: 'fuel', mileageKm: null, liters: null, fullTank: false, station: '', note: '', ...b },
      { id: newId(), createdAt: new Date().toISOString() },
    );
    if (e.amount == null) throw new HttpError(400, 'Bitte einen Betrag eingeben.');
    db.expenses.push(e);
    syncCarFromExpense(e);
    save();
    return { expense: e, car: db.car };
  }
  if ((m = p.match(/^\/api\/expenses\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    const i = db.expenses.findIndex((x) => x.id === id);
    if (method === 'PATCH') {
      if (i < 0) throw new HttpError(404, 'Eintrag nicht gefunden.');
      db.expenses[i] = sanitizeExpense(b, db.expenses[i]);
      syncCarFromExpense(db.expenses[i]);
      save();
      return { expense: db.expenses[i], car: db.car };
    }
    if (method === 'DELETE') {
      db.expenses = db.expenses.filter((x) => x.id !== id);
      save();
      return null;
    }
  }

  // Wetter
  if (p === '/api/weather' && method === 'GET') {
    const loc = db.settings.weather;
    if (!loc) return { configured: false };
    try {
      return { configured: true, ...(await getForecast(loc, q.has('refresh'))) };
    } catch (err) {
      return { configured: true, location: loc.name, error: err.message };
    }
  }
  if (p === '/api/weather/search' && method === 'GET') {
    const name = str(q.get('q'), 100);
    return name.length < 2 ? [] : searchPlaces(name);
  }

  // Unwetter, Spritpreise, Briefing
  if (p === '/api/alerts' && method === 'GET') {
    try {
      return await getAlerts(db.settings.weather, q.has('refresh'));
    } catch (err) {
      return { alerts: [], error: err.message };
    }
  }
  if (p === '/api/fuelprices' && method === 'GET') {
    if (!db.settings.fuel.apiKey) return { configured: false };
    try {
      return { configured: true, ...(await getFuelPrices(q.has('refresh'))) };
    } catch (err) {
      return { configured: true, type: db.settings.fuel.type, stations: [], error: err.message };
    }
  }
  if (p === '/api/briefing' && method === 'GET') {
    try {
      return await getBriefing(q.has('refresh'));
    } catch (err) {
      return { url: db.settings.briefing.url, stories: [], error: err.message };
    }
  }

  // Notizen
  if (p === '/api/notes' && method === 'GET') return sortNotes(db.notes);
  if (p === '/api/notes' && method === 'POST') {
    const note = sanitizeNote(b, { id: newId(), createdAt: new Date().toISOString() });
    db.notes.push(note);
    save();
    return note;
  }
  if ((m = p.match(/^\/api\/notes\/(.+)$/))) {
    const id = decodeURIComponent(m[1]);
    const i = db.notes.findIndex((n) => n.id === id);
    if (method === 'PATCH') {
      if (i < 0) throw new HttpError(404, 'Notiz nicht gefunden.');
      db.notes[i] = sanitizeNote({ text: db.notes[i].text, ...b }, db.notes[i]);
      save();
      return db.notes[i];
    }
    if (method === 'DELETE') {
      db.notes = db.notes.filter((n) => n.id !== id);
      save();
      return null;
    }
  }

  // Einstellungen
  if (p === '/api/settings/fuel' && method === 'PUT') {
    const apiKey = str(b.apiKey, 100);
    if (apiKey && !/^[0-9a-f-]{36}$/i.test(apiKey)) throw new HttpError(400, 'Der Tankerkönig-Schlüssel hat das Format 00000000-0000-0000-0000-000000000000.');
    if (apiKey) db.settings.fuel.apiKey = apiKey;
    if (b.remove) db.settings.fuel.apiKey = '';
    if (['e5', 'e10', 'diesel'].includes(b.type)) db.settings.fuel.type = b.type;
    if ([2, 5, 10, 15].includes(Number(b.radius))) db.settings.fuel.radius = Number(b.radius);
    try {
      localStorage.removeItem(FUEL_CACHE_KEY);
    } catch {}
    save();
    return publicSettings();
  }
  if (p === '/api/settings/briefing' && method === 'PUT') {
    let url = str(b.url, 300);
    try {
      url = new URL(url).toString();
    } catch {
      throw new HttpError(400, 'Bitte eine vollständige Adresse eingeben (https://…).');
    }
    db.settings.briefing.url = url;
    briefingCache = null;
    save();
    return publicSettings();
  }
  if (p === '/api/settings/weather' && method === 'PUT') {
    const lat = Number(b.latitude);
    const lon = Number(b.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, 'Ungültige Koordinaten.');
    db.settings.weather = { name: str(b.name, 100) || 'Mein Standort', latitude: lat, longitude: lon };
    weatherCache = null;
    alertsCache = null;
    save();
    return publicSettings();
  }
  if (p === '/api/settings/todoist' && method === 'PUT') {
    const token = str(b.token, 200);
    if (token) await todoistCall(token, '/projects', { query: { limit: '1' } }); // Token prüfen
    if (token) db.settings.todoist.token = token;
    if (b.filter !== undefined) db.settings.todoist.filter = str(b.filter, 500) || 'overdue | 7 days';
    todoistCache = null;
    save();
    return publicSettings();
  }
  if (p === '/api/settings/todoist' && method === 'DELETE') {
    db.settings.todoist.token = '';
    todoistCache = null;
    save();
    return publicSettings();
  }

  throw new HttpError(404, 'Nicht gefunden.');
}
