// Persönliches Dashboard – Frontend (ohne Build-Schritt, reines JavaScript).

const REFRESH_MS = 5 * 60 * 1000;
const state = { car: {}, tasks: [], calendars: [], events: [], eventErrors: [], loadedAt: null };

// ---------- Hilfsfunktionen ----------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function toast(message, isError = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const todayKey = () => dayKey(new Date());

/** Tage bis zu einem Datum (YYYY-MM-DD). Negativ = in der Vergangenheit. */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = parseDay(todayKey());
  return Math.round((parseDay(dateStr) - today) / 86_400_000);
}

const fmtTime = (d) => d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (s, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) =>
  s ? parseDay(s).toLocaleDateString('de-DE', opts) : '–';
const fmtNum = (n) => (n == null ? '–' : Number(n).toLocaleString('de-DE'));

function relativeDay(key) {
  const diff = daysUntil(key);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === 2) return 'Übermorgen';
  return parseDay(key).toLocaleDateString('de-DE', { weekday: 'long' });
}

function dueBadge(dateStr, { warnDays = 30 } = {}) {
  const d = daysUntil(dateStr);
  if (d == null) return '';
  let cls = 'ok';
  let text = `in ${d} Tagen`;
  if (d < 0) {
    cls = 'bad';
    text = d === -1 ? 'seit gestern fällig' : `seit ${-d} Tagen fällig`;
  } else if (d === 0) {
    cls = 'bad';
    text = 'heute';
  } else if (d === 1) {
    cls = 'warn';
    text = 'morgen';
  } else if (d <= warnDays) {
    cls = 'warn';
  }
  return `<span class="badge ${cls}">${text}</span>`;
}

// ---------- Kopfzeile ----------
function tickClock() {
  const now = new Date();
  $('#clock').textContent = fmtTime(now);
  $('#today').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const h = now.getHours();
  $('#greeting').textContent = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
}

// ---------- Auto ----------
function carWarnings(car) {
  const list = [];
  const check = (date, label) => {
    const d = daysUntil(date);
    if (d != null && d <= 30) list.push({ label, d, level: d <= 0 ? 'bad' : 'warn' });
  };
  check(car.nextInspection, 'HU/TÜV');
  check(car.nextService, 'Inspektion');
  check(car.tireChange, 'Reifenwechsel');
  if (car.nextServiceKm && car.mileageKm != null && car.nextServiceKm - car.mileageKm <= 1000) {
    list.push({ label: 'Inspektion (km)', d: null, level: car.nextServiceKm <= car.mileageKm ? 'bad' : 'warn' });
  }
  if (car.fuelPercent != null && car.fuelPercent < 20) list.push({ label: 'Tank/Akku niedrig', d: null, level: 'bad' });
  return list.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}

function renderCar() {
  const car = state.car || {};
  const el = $('#car');
  const hasData = car.name || car.model || car.licensePlate || car.mileageKm != null;
  if (!hasData) {
    el.innerHTML = `<div class="empty">Noch keine Fahrzeugdaten.<br/><button class="btn" data-open="car-dialog">Auto einrichten</button></div>`;
    return;
  }

  const fuel = car.fuelPercent;
  const fuelCls = fuel == null ? '' : fuel < 20 ? 'bad' : fuel < 35 ? 'warn' : '';
  const kmLeft = car.nextServiceKm && car.mileageKm != null ? car.nextServiceKm - car.mileageKm : null;
  const lockBadge =
    car.locked === true
      ? '<span class="badge ok">🔒 verriegelt</span>'
      : car.locked === false
        ? '<span class="badge bad">🔓 offen</span>'
        : '<span class="badge">unbekannt</span>';

  el.innerHTML = `
    <div class="car-title">
      <div>
        <div class="name">${esc(car.name || car.model)}</div>
        ${car.name && car.model ? `<div class="muted small">${esc(car.model)}</div>` : ''}
      </div>
      ${car.licensePlate ? `<span class="plate">${esc(car.licensePlate)}</span>` : ''}
    </div>
    ${
      fuel != null
        ? `<div class="gauge">
            <div class="gauge-bar"><div class="gauge-fill ${fuelCls}" style="width:${fuel}%"></div></div>
            <div class="gauge-label"><span>Tank / Akku ${fuel} %</span><span>${car.rangeKm != null ? `≈ ${fmtNum(car.rangeKm)} km Reichweite` : ''}</span></div>
          </div>`
        : ''
    }
    <dl class="kv">
      <dt>Kilometerstand</dt><dd>${car.mileageKm != null ? `${fmtNum(car.mileageKm)} km` : '–'}</dd>
      <dt>HU / TÜV</dt><dd>${fmtDate(car.nextInspection, { month: '2-digit', year: 'numeric' })} ${dueBadge(car.nextInspection)}</dd>
      <dt>Inspektion</dt><dd>${car.nextService ? fmtDate(car.nextService) : ''} ${dueBadge(car.nextService)}
        ${kmLeft != null ? `<span class="badge ${kmLeft <= 0 ? 'bad' : kmLeft <= 1000 ? 'warn' : ''}">${kmLeft <= 0 ? 'km überschritten' : `noch ${fmtNum(kmLeft)} km`}</span>` : ''}
        ${!car.nextService && kmLeft == null ? '–' : ''}</dd>
      <dt>Reifenwechsel</dt><dd>${fmtDate(car.tireChange)} ${dueBadge(car.tireChange)}</dd>
      <dt>Verriegelung</dt><dd>${lockBadge}</dd>
      ${car.location ? `<dt>Standort</dt><dd>${esc(car.location)}</dd>` : ''}
    </dl>
    ${car.notes ? `<div class="car-notes">${esc(car.notes)}</div>` : ''}
    ${car.updatedAt ? `<p class="muted small" style="margin:10px 0 0">Stand: ${new Date(car.updatedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · manuell</p>` : ''}
  `;
}

function openCarDialog() {
  const form = $('#car-form');
  const car = state.car || {};
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = car[el.name];
    el.value = v == null ? '' : String(v);
  }
  $('#car-dialog').showModal();
}

$('#car-form').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'save') return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target));
  fd.locked = fd.locked === '' ? null : fd.locked === 'true';
  try {
    state.car = await api('/api/car', { method: 'PUT', body: fd });
    $('#car-dialog').close();
    renderCar();
    renderSummary();
    toast('Auto-Status gespeichert');
  } catch (err) {
    toast(err.message, true);
  }
});

// ---------- Aufgaben ----------
const PRIO_ORDER = { high: 0, normal: 1, low: 2 };

function sortedTasks() {
  const showDone = $('#show-done').checked;
  return state.tasks
    .filter((t) => showDone || !t.done)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.due || '9999').localeCompare(b.due || '9999') ||
        PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

function renderTasks() {
  const list = $('#tasks');
  const tasks = sortedTasks();
  if (!tasks.length) {
    list.innerHTML = `<li class="empty">${state.tasks.length ? 'Alles erledigt 🎉' : 'Keine Aufgaben. Leg oben die erste an.'}</li>`;
    return;
  }
  list.innerHTML = tasks
    .map((t) => {
      const prio = t.priority === 'high' ? '<span class="badge bad">Hoch</span>' : t.priority === 'low' ? '<span class="badge">Niedrig</span>' : '';
      const due = t.due ? `<span class="badge">${fmtDate(t.due, { day: '2-digit', month: '2-digit' })}</span>${t.done ? '' : dueBadge(t.due, { warnDays: 3 })}` : '';
      return `
        <li class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
          <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Erledigt" />
          <div>
            <div class="t-title">${esc(t.title)}</div>
            ${prio || due ? `<div class="t-meta">${prio}${due}</div>` : ''}
          </div>
          <button class="del" title="Löschen" aria-label="Löschen">✕</button>
        </li>`;
    })
    .join('');
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  try {
    const task = await api('/api/tasks', { method: 'POST', body });
    state.tasks.push(task);
    form.reset();
    form.title.focus();
    renderTasks();
    renderSummary();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#tasks').addEventListener('click', async (e) => {
  const li = e.target.closest('.task');
  if (!li) return;
  const id = li.dataset.id;
  try {
    if (e.target.matches('input[type=checkbox]')) {
      const updated = await api(`/api/tasks/${id}`, { method: 'PATCH', body: { done: e.target.checked } });
      state.tasks = state.tasks.map((t) => (t.id === id ? updated : t));
    } else if (e.target.closest('.del')) {
      await api(`/api/tasks/${id}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== id);
    } else return;
    renderTasks();
    renderSummary();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#show-done').addEventListener('change', renderTasks);

// ---------- Termine ----------
function eventDayKey(ev) {
  const key = ev.allDay ? ev.start : dayKey(new Date(ev.start));
  // Laufende Termine, die vor heute begonnen haben, unter "Heute" einsortieren.
  return key < todayKey() ? todayKey() : key;
}

function renderEvents() {
  const el = $('#events');
  const errors = state.eventErrors
    .map((e) => `<div class="error-box">⚠ „${esc(e.calendarName)}“ konnte nicht geladen werden: ${esc(e.message)}</div>`)
    .join('');

  if (!state.calendars.length) {
    el.innerHTML = `<div class="empty">Noch kein Kalender verbunden.<br/><button class="btn" data-open="calendar-dialog">Samsung / Google Kalender verbinden</button></div>`;
    return;
  }
  if (!state.events.length) {
    el.innerHTML = `${errors}<div class="empty">Keine Termine im gewählten Zeitraum.</div>`;
    return;
  }

  const groups = new Map();
  for (const ev of state.events) {
    const key = eventDayKey(ev);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }

  const now = new Date();
  el.innerHTML =
    errors +
    [...groups]
      .map(([key, evs]) => {
        const items = evs
          .map((ev) => {
            let time = 'ganztägig';
            let cls = '';
            let extra = '';
            if (ev.allDay) {
              // Ende ist bei ganztägigen Terminen exklusiv.
              if (ev.end) {
                const last = parseDay(ev.end);
                last.setDate(last.getDate() - 1);
                if (dayKey(last) > ev.start) extra = `bis ${last.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`;
              }
            } else {
              const s = new Date(ev.start);
              const en = ev.end ? new Date(ev.end) : null;
              time = en ? `${fmtTime(s)} – ${fmtTime(en)}` : fmtTime(s);
              if (en && dayKey(en) !== dayKey(s)) extra = `bis ${en.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${fmtTime(en)}`;
              if (en && en < now) cls = 'past';
              else if (s <= now && (!en || en > now)) cls = 'now';
            }
            const meta = [extra, ev.location, state.calendars.length > 1 ? ev.calendarName : ''].filter(Boolean).map(esc).join(' · ');
            return `
              <div class="event ${cls}" style="--c:${esc(ev.color)}" title="${esc(ev.description)}">
                <div class="time">${time}</div>
                <div>
                  <div class="title">${esc(ev.title)} ${cls === 'now' ? '<span class="badge accent">läuft</span>' : ''}</div>
                  ${meta ? `<div class="meta">${meta}</div>` : ''}
                </div>
              </div>`;
          })
          .join('');
        const diff = daysUntil(key);
        return `
          <section class="day">
            <div class="day-head">
              <span>${relativeDay(key)}</span>
              <span class="badge">${fmtDate(key, { day: 'numeric', month: 'long' })}</span>
              ${diff <= 1 ? `<span class="badge accent">${evs.length} Termin${evs.length === 1 ? '' : 'e'}</span>` : ''}
            </div>
            ${items}
          </section>`;
      })
      .join('');
}

async function loadEvents(refresh = false) {
  if (!state.calendars.length) {
    state.events = [];
    state.eventErrors = [];
    return;
  }
  const days = $('#event-range').value;
  const data = await api(`/api/events?days=${days}${refresh ? '&refresh=1' : ''}`);
  state.events = data.events;
  state.eventErrors = data.errors;
}

$('#event-range').addEventListener('change', async () => {
  await loadEvents().catch((err) => toast(err.message, true));
  renderEvents();
  renderSummary();
});

// ---------- Kalender verwalten ----------
function renderCalendarList() {
  const list = $('#calendar-list');
  if (!state.calendars.length) {
    list.innerHTML = '<li class="muted small" style="border:0;display:block;padding:0">Noch keine Kalender verbunden.</li>';
    return;
  }
  list.innerHTML = state.calendars
    .map(
      (c) => `
      <li data-id="${esc(c.id)}">
        <span class="dot" style="background:${esc(c.color)}"></span>
        <div>
          <div>${esc(c.name)}</div>
          <div class="muted small">${c.type === 'file' ? 'Hochgeladene .ics-Datei' : `iCal-Link · ${esc(c.urlHint)}`}</div>
        </div>
        <label class="toggle"><input type="checkbox" data-action="toggle" ${c.enabled ? 'checked' : ''}/> aktiv</label>
        <button class="btn btn-danger" data-action="delete">Entfernen</button>
      </li>`,
    )
    .join('');
}

function setCalendarMsg(text, type = '') {
  const el = $('#calendar-msg');
  el.textContent = text;
  el.className = `msg ${type}`;
}

async function afterCalendarChange(message) {
  renderCalendarList();
  setCalendarMsg('Lade Termine …');
  try {
    await loadEvents(true);
    const err = state.eventErrors[0];
    setCalendarMsg(err ? `„${err.calendarName}“: ${err.message}` : message, err ? 'error' : 'ok');
  } catch (e) {
    setCalendarMsg(e.message, 'error');
  }
  renderEvents();
  renderSummary();
}

$('#calendar-url-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const cal = await api('/api/calendars', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    state.calendars.push(cal);
    form.reset();
    await afterCalendarChange(`„${cal.name}“ verbunden.`);
  } catch (err) {
    setCalendarMsg(err.message, 'error');
  }
});

$('#calendar-file-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const file = form.file.files[0];
  if (!file) return;
  try {
    const ics = await file.text();
    const cal = await api('/api/calendars', { method: 'POST', body: { name: form.name.value, color: form.color.value, ics } });
    state.calendars.push(cal);
    form.reset();
    await afterCalendarChange(`„${cal.name}“ importiert.`);
  } catch (err) {
    setCalendarMsg(err.message, 'error');
  }
});

$('#calendar-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]');
  const action = e.target.dataset.action;
  if (!li || !action) return;
  const id = li.dataset.id;
  try {
    if (action === 'delete') {
      const cal = state.calendars.find((c) => c.id === id);
      if (!confirm(`Kalender „${cal?.name}“ entfernen?`)) return;
      await api(`/api/calendars/${id}`, { method: 'DELETE' });
      state.calendars = state.calendars.filter((c) => c.id !== id);
      await afterCalendarChange('Kalender entfernt.');
    } else if (action === 'toggle') {
      const updated = await api(`/api/calendars/${id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
      state.calendars = state.calendars.map((c) => (c.id === id ? updated : c));
      await afterCalendarChange('Gespeichert.');
    }
  } catch (err) {
    setCalendarMsg(err.message, 'error');
  }
});

// ---------- Übersicht ----------
function renderSummary() {
  const today = todayKey();
  const now = new Date();
  const todays = state.events.filter((e) => eventDayKey(e) === today);
  const upcoming = state.events.find((e) => (e.allDay ? e.start >= today : new Date(e.start) > now));
  const open = state.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const warnings = carWarnings(state.car || {});

  let nextHint = 'Keine anstehenden Termine';
  if (upcoming) {
    const when = upcoming.allDay
      ? relativeDay(upcoming.start)
      : `${relativeDay(dayKey(new Date(upcoming.start)))}, ${fmtTime(new Date(upcoming.start))}`;
    nextHint = `${when}: ${upcoming.title}`;
  }

  const stats = [
    {
      label: 'Termine heute',
      value: state.calendars.length ? todays.length : '–',
      hint: state.calendars.length ? nextHint : 'Kein Kalender verbunden',
    },
    {
      label: 'Offene Aufgaben',
      value: open.length,
      hint: overdue.length ? `${overdue.length} überfällig` : dueToday.length ? `${dueToday.length} heute fällig` : 'Nichts überfällig',
      cls: overdue.length ? 'bad' : dueToday.length ? 'warn' : '',
    },
    {
      label: 'Auto',
      value: warnings.length ? `${warnings.length} Hinweis${warnings.length === 1 ? '' : 'e'}` : state.car?.updatedAt ? 'Alles ok' : '–',
      hint: warnings.length
        ? warnings.map((w) => (w.d == null ? w.label : `${w.label} ${w.d <= 0 ? 'fällig' : `in ${w.d} T.`}`)).join(', ')
        : state.car?.fuelPercent != null
          ? `Tank/Akku ${state.car.fuelPercent} %`
          : 'Noch nicht eingerichtet',
      cls: warnings.some((w) => w.level === 'bad') ? 'bad' : warnings.length ? 'warn' : '',
    },
  ];

  $('#summary').innerHTML = stats
    .map(
      (s) => `
      <div class="stat ${s.cls || ''}">
        <div class="label">${esc(s.label)}</div>
        <div class="value">${esc(s.value)}</div>
        <div class="hint" title="${esc(s.hint)}">${esc(s.hint)}</div>
      </div>`,
    )
    .join('');
}

// ---------- Dialoge öffnen/schließen ----------
document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  if (opener) {
    const id = opener.dataset.open;
    if (id === 'car-dialog') openCarDialog();
    else {
      renderCalendarList();
      setCalendarMsg('');
      $(`#${id}`).showModal();
    }
  }
  if (e.target.closest('[data-close]')) e.target.closest('dialog').close();
});

// ---------- Laden ----------
async function loadAll(refresh = false) {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const s = await api('/api/state');
    Object.assign(state, s);
    await loadEvents(refresh);
    state.loadedAt = new Date();
    $('#last-update').textContent = `Zuletzt aktualisiert: ${fmtTime(state.loadedAt)} Uhr`;
  } catch (err) {
    toast(`Laden fehlgeschlagen: ${err.message}`, true);
  } finally {
    btn.classList.remove('spin');
  }
  renderSummary();
  renderEvents();
  renderTasks();
  renderCar();
}

$('#refresh').addEventListener('click', () => loadAll(true));

tickClock();
setInterval(tickClock, 1000);
setInterval(() => {
  // Ansicht jede Minute neu zeichnen (z. B. "läuft"-Markierung), Daten alle 5 Minuten neu laden.
  if (state.loadedAt && Date.now() - state.loadedAt > REFRESH_MS) loadAll();
  else {
    renderSummary();
    renderEvents();
  }
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.loadedAt && Date.now() - state.loadedAt > 60_000) loadAll();
});

loadAll();
