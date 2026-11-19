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
    res.json({ car: db.car, tasks: db.tasks, calendars: db.calendars.map(publicCalendar) });
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

app.post(
  '/api/tasks',
  wrap(async (req, res) => {
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
    await update((db) => db.tasks.push(task));
    res.status(201).json(task);
  }),
);

app.patch(
  '/api/tasks/:id',
  wrap(async (req, res) => {
    const task = await update((db) => {
      const i = db.tasks.findIndex((t) => t.id === req.params.id);
      if (i < 0) throw new HttpError(404, 'Aufgabe nicht gefunden.');
      db.tasks[i] = sanitizeTask(req.body || {}, db.tasks[i]);
      return db.tasks[i];
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
