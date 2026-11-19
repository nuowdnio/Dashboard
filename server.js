import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { load, update, newId } from './lib/store.js';
import {
  getEvents,
  normalizeUrl,
  saveUploadedIcs,
  removeCalendarFiles,
  invalidate,
} from './lib/calendar.js';
import { searchPlaces, getForecast, clearWeatherCache } from './lib/weather.js';
import * as todoist from './lib/todoist.js';
import { CARRIERS, STATUSES, guessCarrier, trackingUrl, fetchDhlStatus, clearDhlCache } from './lib/packages.js';

process.env.TZ ||= 'Europe/Berlin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '25mb' }));

// Optionaler Passwortschutz (HTTP Basic Auth), sobald DASHBOARD_PASSWORD gesetzt ist.
if (PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const pass = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
      const a = crypto.createHash('sha256').update(pass).digest();
      const b = crypto.createHash('sha256').update(PASSWORD).digest();
      if (crypto.timingSafeEqual(a, b)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Dashboard"').status(401).send('Anmeldung erforderlich');
  });
}

app.use(express.static(path.join(__dirname, 'public')));

const COLORS = ['#4f8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#ec4899'];
const PRIORITIES = ['low', 'normal', 'high'];

const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const dateOrEmpty = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');

// Kalender-URL nur gekürzt an den Browser geben (enthält bei Google einen geheimen Schlüssel).
function publicCalendar(c) {
  let urlHint = '';
  if (c.url) {
    try {
      urlHint = new URL(c.url).host;
    } catch {}
  }
  return { id: c.id, name: c.name, color: c.color, type: c.type, enabled: c.enabled !== false, urlHint };
}

// Zugangsdaten aus Umgebungsvariablen haben Vorrang vor den im Dashboard gespeicherten.
const todoistToken = (db) => process.env.TODOIST_TOKEN || db.settings.todoist.token;
const dhlKey = (db) => process.env.DHL_API_KEY || db.settings.dhl.apiKey;

function publicSettings(db) {
  return {
    weather: db.settings.weather,
    todoist: {
      connected: Boolean(todoistToken(db)),
      fromEnv: Boolean(process.env.TODOIST_TOKEN),
      filter: db.settings.todoist.filter,
    },
    dhl: { configured: Boolean(dhlKey(db)), fromEnv: Boolean(process.env.DHL_API_KEY) },
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ---------- Gesamtzustand ----------
app.get(
  '/api/state',
  wrap(async (req, res) => {
    const db = await load();
    res.json({ car: db.car, calendars: db.calendars.map(publicCalendar), settings: publicSettings(db) });
  }),
);

// ---------- Auto ----------
app.put(
  '/api/car',
  wrap(async (req, res) => {
    const b = req.body || {};
    const car = await update((db) => {
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
        updatedAt: new Date().toISOString(),
      };
      return db.car;
    });
    res.json(car);
  }),
);

// ---------- Aufgaben ----------
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

app.get(
  '/api/tasks',
  wrap(async (req, res) => {
    const db = await load();
    const token = todoistToken(db);
    if (!token) return res.json({ source: 'local', tasks: db.tasks });
    if (req.query.refresh) todoist.clearTodoistCache();
    try {
      res.json({ source: 'todoist', tasks: await todoist.getTasks(token, db.settings.todoist.filter) });
    } catch (err) {
      res.json({ source: 'todoist', tasks: [], error: err.message });
    }
  }),
);

app.post(
  '/api/tasks',
  wrap(async (req, res) => {
    const db = await load();
    const token = todoistToken(db);
    if (token) {
      const text = str(req.body?.title, 500);
      if (!text) throw new HttpError(400, 'Titel fehlt.');
      try {
        return res.status(201).json(await todoist.quickAdd(token, text));
      } catch (err) {
        throw new HttpError(err.status || 502, err.message);
      }
    }
    const task = sanitizeTask(req.body || {}, {
      id: newId(),
      title: '',
      notes: '',
      due: '',
      priority: 'normal',
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString(),
    });
    if (!task.title) throw new HttpError(400, 'Titel fehlt.');
    await update((d) => d.tasks.push(task));
    res.status(201).json(task);
  }),
);

app.patch(
  '/api/tasks/:id',
  wrap(async (req, res) => {
    const db = await load();
    const token = todoistToken(db);
    if (token) {
      if (req.body?.done === undefined) throw new HttpError(400, 'Todoist-Aufgaben bitte direkt in Todoist bearbeiten.');
      try {
        await todoist.setDone(token, req.params.id, Boolean(req.body.done));
      } catch (err) {
        throw new HttpError(err.status || 502, err.message);
      }
      return res.json({ id: req.params.id, done: Boolean(req.body.done) });
    }
    const task = await update((d) => {
      const i = d.tasks.findIndex((t) => t.id === req.params.id);
      if (i < 0) throw new HttpError(404, 'Aufgabe nicht gefunden.');
      d.tasks[i] = sanitizeTask(req.body || {}, d.tasks[i]);
      return d.tasks[i];
    });
    res.json(task);
  }),
);

app.delete(
  '/api/tasks/:id',
  wrap(async (req, res) => {
    await update((db) => {
      db.tasks = db.tasks.filter((t) => t.id !== req.params.id);
    });
    res.status(204).end();
  }),
);

// ---------- Kalender ----------
app.post(
  '/api/calendars',
  wrap(async (req, res) => {
    const b = req.body || {};
    const db = await load();
    const cal = {
      id: newId(),
      name: str(b.name, 100) || 'Kalender',
      color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : COLORS[db.calendars.length % COLORS.length],
      enabled: true,
    };

    if (b.ics) {
      cal.type = 'file';
      try {
        await saveUploadedIcs(cal.id, b.ics);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    } else {
      cal.type = 'url';
      try {
        cal.url = normalizeUrl(b.url);
      } catch (err) {
        throw new HttpError(400, `Ungültiger Link: ${err.message}`);
      }
    }

    await update((d) => d.calendars.push(cal));
    res.status(201).json(publicCalendar(cal));
  }),
);

app.patch(
  '/api/calendars/:id',
  wrap(async (req, res) => {
    const b = req.body || {};
    const cal = await update(async (db) => {
      const c = db.calendars.find((x) => x.id === req.params.id);
      if (!c) throw new HttpError(404, 'Kalender nicht gefunden.');
      if (b.name !== undefined) c.name = str(b.name, 100) || c.name;
      if (/^#[0-9a-f]{6}$/i.test(b.color || '')) c.color = b.color;
      if (b.enabled !== undefined) c.enabled = Boolean(b.enabled);
      if (b.ics && c.type === 'file') await saveUploadedIcs(c.id, b.ics);
      invalidate(c.id);
      return c;
    });
    res.json(publicCalendar(cal));
  }),
);

app.delete(
  '/api/calendars/:id',
  wrap(async (req, res) => {
    await update((db) => {
      db.calendars = db.calendars.filter((c) => c.id !== req.params.id);
    });
    await removeCalendarFiles(req.params.id);
    res.status(204).end();
  }),
);

app.get(
  '/api/events',
  wrap(async (req, res) => {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + days);
    const db = await load();
    if (req.query.refresh) db.calendars.forEach((c) => invalidate(c.id));
    res.json(await getEvents(db.calendars, from, to));
  }),
);

// ---------- Einstellungen ----------
app.put(
  '/api/settings/weather',
  wrap(async (req, res) => {
    const b = req.body || {};
    const lat = Number(b.latitude);
    const lon = Number(b.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new HttpError(400, 'Ungültige Koordinaten.');
    }
    const db = await update((d) => {
      d.settings.weather = { name: str(b.name, 100) || 'Mein Standort', latitude: lat, longitude: lon };
      return d;
    });
    clearWeatherCache();
    res.json(publicSettings(db));
  }),
);

app.put(
  '/api/settings/todoist',
  wrap(async (req, res) => {
    const b = req.body || {};
    const token = str(b.token, 200);
    const filter = b.filter !== undefined ? str(b.filter, 500) || 'overdue | 7 days' : undefined;
    if (token) {
      try {
        await todoist.verifyToken(token);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    }
    const db = await update((d) => {
      if (token) d.settings.todoist.token = token;
      if (filter !== undefined) d.settings.todoist.filter = filter;
      return d;
    });
    todoist.clearTodoistCache();
    res.json(publicSettings(db));
  }),
);

app.delete(
  '/api/settings/todoist',
  wrap(async (req, res) => {
    const db = await update((d) => {
      d.settings.todoist.token = '';
      return d;
    });
    todoist.clearTodoistCache();
    res.json(publicSettings(db));
  }),
);

app.put(
  '/api/settings/dhl',
  wrap(async (req, res) => {
    const db = await update((d) => {
      d.settings.dhl.apiKey = str(req.body?.apiKey, 200);
      return d;
    });
    clearDhlCache();
    res.json(publicSettings(db));
  }),
);

// ---------- Wetter ----------
app.get(
  '/api/weather/search',
  wrap(async (req, res) => {
    const q = str(req.query.q, 100);
    if (q.length < 2) return res.json([]);
    try {
      res.json(await searchPlaces(q));
    } catch (err) {
      throw new HttpError(502, err.message);
    }
  }),
);

app.get(
  '/api/weather',
  wrap(async (req, res) => {
    const db = await load();
    if (!db.settings.weather) return res.json({ configured: false });
    if (req.query.refresh) clearWeatherCache();
    try {
      res.json({ configured: true, ...(await getForecast(db.settings.weather)) });
    } catch (err) {
      res.json({ configured: true, location: db.settings.weather.name, error: err.message });
    }
  }),
);

// ---------- Pakete ----------
const DAY_MS = 86_400_000;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Sichtbar ist ein Paket, solange es nicht zugestellt ist – zugestellte nur noch am Tag der Zustellung.
const isVisible = (p) => p.status !== 'delivered' || (p.deliveredAt && new Date(p.deliveredAt) >= startOfToday());

function publicPackage(p) {
  return { ...p, carrierName: (CARRIERS[p.carrier] || CARRIERS.other).name, trackingUrl: trackingUrl(p) };
}

function sanitizePackage(b, existing = {}) {
  const pkg = { ...existing };
  if (b.title !== undefined) pkg.title = str(b.title, 120);
  if (b.trackingNumber !== undefined) pkg.trackingNumber = str(b.trackingNumber, 60).replace(/\s+/g, '');
  if (b.carrier !== undefined) pkg.carrier = CARRIERS[b.carrier] ? b.carrier : guessCarrier(pkg.trackingNumber);
  if (b.expected !== undefined) pkg.expected = dateOrEmpty(b.expected);
  if (b.customUrl !== undefined) {
    const u = str(b.customUrl, 500);
    pkg.customUrl = /^https?:\/\//i.test(u) ? u : '';
  }
  if (b.status !== undefined && STATUSES.includes(b.status)) {
    if (b.status === 'delivered' && pkg.status !== 'delivered') pkg.deliveredAt = new Date().toISOString();
    if (b.status !== 'delivered') pkg.deliveredAt = null;
    pkg.status = b.status;
    pkg.statusSource = 'manual';
  }
  return pkg;
}

app.get(
  '/api/packages',
  wrap(async (req, res) => {
    const db = await load();
    const key = dhlKey(db);
    const errors = [];

    // Bei DHL-Paketen den Status automatisch abfragen, sofern ein API-Schlüssel hinterlegt ist.
    if (key) {
      const dhl = db.packages.filter((p) => p.carrier === 'dhl' && p.trackingNumber && p.status !== 'delivered');
      if (req.query.refresh) dhl.forEach((p) => clearDhlCache(p.trackingNumber));
      const results = await Promise.allSettled(dhl.map((p) => fetchDhlStatus(key, p.trackingNumber)));
      await update((d) => {
        results.forEach((r, i) => {
          const p = d.packages.find((x) => x.id === dhl[i].id);
          if (!p) return;
          if (r.status === 'rejected') return errors.push(r.reason.message);
          if (!r.value) return;
          Object.assign(p, {
            status: r.value.status,
            statusText: r.value.statusText,
            location: r.value.location,
            estimatedDelivery: r.value.estimatedDelivery,
            statusSource: 'dhl',
            lastChecked: new Date().toISOString(),
          });
          if (r.value.status === 'delivered' && !p.deliveredAt) p.deliveredAt = r.value.updatedAt || new Date().toISOString();
        });
      });
    }

    // Zugestellte Pakete nach einer Woche aufräumen.
    const stale = (p) => p.status === 'delivered' && Date.now() - new Date(p.deliveredAt) > 7 * DAY_MS;
    if (db.packages.some(stale)) {
      await update((d) => {
        d.packages = d.packages.filter((p) => !stale(p));
      });
    }

    res.json({
      packages: db.packages.filter(isVisible).map(publicPackage),
      carriers: Object.fromEntries(Object.entries(CARRIERS).map(([k, v]) => [k, v.name])),
      dhlConfigured: Boolean(key),
      errors: [...new Set(errors)],
    });
  }),
);

app.post(
  '/api/packages',
  wrap(async (req, res) => {
    const b = req.body || {};
    const pkg = sanitizePackage(
      { carrier: b.carrier || 'auto', ...b },
      { id: newId(), title: '', trackingNumber: '', expected: '', customUrl: '', status: 'expected', statusText: '', createdAt: new Date().toISOString() },
    );
    if (!pkg.title && !pkg.trackingNumber) throw new HttpError(400, 'Bitte Bezeichnung oder Sendungsnummer angeben.');
    if (!pkg.title) pkg.title = `Paket (${(CARRIERS[pkg.carrier] || CARRIERS.other).name})`;
    await update((db) => db.packages.push(pkg));
    res.status(201).json(publicPackage(pkg));
  }),
);

app.patch(
  '/api/packages/:id',
  wrap(async (req, res) => {
    const pkg = await update((db) => {
      const i = db.packages.findIndex((p) => p.id === req.params.id);
      if (i < 0) throw new HttpError(404, 'Paket nicht gefunden.');
      db.packages[i] = sanitizePackage(req.body || {}, db.packages[i]);
      return db.packages[i];
    });
    res.json(publicPackage(pkg));
  }),
);

app.delete(
  '/api/packages/:id',
  wrap(async (req, res) => {
    await update((db) => {
      db.packages = db.packages.filter((p) => p.id !== req.params.id);
    });
    res.status(204).end();
  }),
);

app.use('/api', (req, res) => res.status(404).json({ error: 'Nicht gefunden.' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Interner Fehler.' : err.message });
});

await load();
app.listen(PORT, HOST, () => {
  console.log(`Dashboard läuft auf http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST !== '127.0.0.1' && !PASSWORD) {
    console.warn('Hinweis: Das Dashboard ist im Netzwerk erreichbar, aber ohne Passwort (DASHBOARD_PASSWORD).');
  }
});
