// Persönliches Dashboard – Frontend (ohne Build-Schritt, reines JavaScript).

const REFRESH_MS = 5 * 60 * 1000;
const state = {
  car: {},
  calendars: [],
  settings: { weather: null, todoist: {}, dhl: {} },
  tasks: [],
  taskSource: 'local',
  taskError: '',
  events: [],
  eventErrors: [],
  weather: null,
  packages: [],
  packageErrors: [],
  loadedAt: null,
};

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

function setMsg(sel, text, type = '') {
  const el = $(sel);
  el.textContent = text;
  el.className = `msg ${type}`;
}

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const todayKey = () => dayKey(new Date());

/** Tage bis zu einem Datum (YYYY-MM-DD). Negativ = in der Vergangenheit. */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((parseDay(dateStr) - parseDay(todayKey())) / 86_400_000);
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
  if (diff === -1) return 'Gestern';
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

// ---------- Wetter ----------
// WMO-Wettercodes -> Text und Symbol
const WMO = {
  0: ['Klar', '☀️', '🌙'],
  1: ['Überwiegend klar', '🌤', '🌙'],
  2: ['Teilweise bewölkt', '⛅', '☁️'],
  3: ['Bedeckt', '☁️'],
  45: ['Nebel', '🌫'],
  48: ['Reifnebel', '🌫'],
  51: ['Leichter Nieselregen', '🌦'],
  53: ['Nieselregen', '🌦'],
  55: ['Starker Nieselregen', '🌧'],
  56: ['Gefrierender Niesel', '🌧'],
  57: ['Gefrierender Niesel', '🌧'],
  61: ['Leichter Regen', '🌦'],
  63: ['Regen', '🌧'],
  65: ['Starker Regen', '🌧'],
  66: ['Gefrierender Regen', '🌧'],
  67: ['Gefrierender Regen', '🌧'],
  71: ['Leichter Schneefall', '🌨'],
  73: ['Schneefall', '🌨'],
  75: ['Starker Schneefall', '❄️'],
  77: ['Schneegriesel', '🌨'],
  80: ['Leichte Regenschauer', '🌦'],
  81: ['Regenschauer', '🌧'],
  82: ['Heftige Regenschauer', '⛈'],
  85: ['Schneeschauer', '🌨'],
  86: ['Starke Schneeschauer', '❄️'],
  95: ['Gewitter', '⛈'],
  96: ['Gewitter mit Hagel', '⛈'],
  99: ['Schweres Gewitter mit Hagel', '⛈'],
};
const wxText = (code) => (WMO[code] || ['Unbekannt'])[0];
const wxIcon = (code, isDay = true) => {
  const e = WMO[code] || ['', '🌡'];
  return !isDay && e[2] ? e[2] : e[1];
};
const deg = (n) => `${Math.round(n)}°`;
const isWet = (code) => code >= 51;

/** Kurzer Hinweis, ob es in den nächsten Stunden regnet bzw. schneit. */
function rainHint(w) {
  const next = w.hourly.slice(0, 12);
  const first = next.findIndex((h) => (h.precipitationProbability ?? 0) >= 50 || h.precipitation >= 0.3);
  if (isWet(w.current.code) && w.current.precipitation > 0) {
    const dryIdx = next.findIndex((h) => (h.precipitationProbability ?? 0) < 30 && h.precipitation < 0.1);
    return { wet: true, text: dryIdx > 0 ? `Niederschlag, voraussichtlich trocken ab ${next[dryIdx].time.slice(11, 16)} Uhr` : 'Es regnet gerade. Schirm mitnehmen ☂️' };
  }
  if (first < 0) return { wet: false, text: 'In den nächsten 12 Stunden bleibt es voraussichtlich trocken.' };
  const h = next[first];
  const snow = [71, 73, 75, 77, 85, 86].includes(h.code);
  return {
    wet: true,
    text: `${snow ? 'Schnee' : 'Regen'} ab ca. ${h.time.slice(11, 16)} Uhr (${h.precipitationProbability ?? '?'} %). ${snow ? 'Vorsicht auf der Straße' : 'Schirm mitnehmen'} ${snow ? '❄️' : '☂️'}`,
  };
}

function renderWeather() {
  const el = $('#weather');
  const w = state.weather;
  $('#weather-title').textContent = w?.location ? `🌤 Wetter · ${w.location}` : '🌤 Wetter';
  if (!w || !w.configured) {
    el.innerHTML = `<div class="empty">Noch kein Ort festgelegt.<br/><button class="btn" data-open="settings-dialog" data-focus="weather-search">Ort festlegen</button></div>`;
    return;
  }
  if (w.error) {
    el.innerHTML = `<div class="error-box">⚠ Wetter konnte nicht geladen werden: ${esc(w.error)}</div>`;
    return;
  }
  const c = w.current;
  const today = w.daily[0];
  const hint = rainHint(w);
  const allMin = Math.min(...w.daily.map((d) => d.min));
  const allMax = Math.max(...w.daily.map((d) => d.max));
  const span = Math.max(1, allMax - allMin);

  el.innerHTML = `
    <div class="wx-now">
      <div class="wx-icon">${wxIcon(c.code, c.isDay)}</div>
      <div>
        <div class="wx-temp">${deg(c.temperature)}</div>
      </div>
      <div>
        <div class="wx-desc">${esc(wxText(c.code))}</div>
        <div class="wx-meta">Gefühlt ${deg(c.feelsLike)} · ${deg(today.min)} / ${deg(today.max)}</div>
        <div class="wx-meta">💨 ${Math.round(c.windSpeed)} km/h · 💧 ${c.humidity} %${
          today.sunrise ? ` · 🌅 ${today.sunrise.slice(11, 16)} · 🌇 ${today.sunset.slice(11, 16)}` : ''
        }</div>
      </div>
    </div>
    <div class="wx-alert ${hint.wet ? '' : 'dry'}">${esc(hint.text)}</div>
    <div class="wx-hours">
      ${w.hourly
        .slice(0, 12)
        .map(
          (h, i) => `
        <div class="wx-hour">
          <div class="muted">${i === 0 ? 'Jetzt' : h.time.slice(11, 13) + ' Uhr'}</div>
          <div class="i">${wxIcon(h.code, h.isDay)}</div>
          <div class="t">${deg(h.temperature)}</div>
          <div class="p">${(h.precipitationProbability ?? 0) >= 20 ? `${h.precipitationProbability} %` : ''}</div>
        </div>`,
        )
        .join('')}
    </div>
    <div class="wx-days">
      ${w.daily
        .slice(0, 6)
        .map(
          (d) => `
        <div class="wx-day">
          <span>${daysUntil(d.date) === 0 ? 'Heute' : parseDay(d.date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric' })}</span>
          <span class="i" title="${esc(wxText(d.code))}">${wxIcon(d.code)}</span>
          <span class="min">${deg(d.min)}</span>
          <span class="wx-range"><span style="left:${((d.min - allMin) / span) * 100}%;right:${100 - ((d.max - allMin) / span) * 100}%"></span></span>
          <span class="max">${deg(d.max)}</span>
          <span class="p">${(d.precipitationProbability ?? 0) >= 20 ? `💧${d.precipitationProbability} %` : ''}</span>
        </div>`,
        )
        .join('')}
    </div>
  `;
}

async function loadWeather(refresh = false) {
  state.weather = await api(`/api/weather${refresh ? '?refresh=1' : ''}`);
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
  if (car.fuelPercent != null && car.fuelPercent < 20) list.push({ label: 'Tank fast leer', d: null, level: 'bad' });
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
        : '';

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
            <div class="gauge-label"><span>Tank ${fuel} %</span><span>${car.rangeKm != null ? `≈ ${fmtNum(car.rangeKm)} km Reichweite` : ''}</span></div>
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
      ${lockBadge ? `<dt>Verriegelung</dt><dd>${lockBadge}</dd>` : ''}
      ${car.location ? `<dt>Standort</dt><dd>${esc(car.location)}</dd>` : ''}
    </dl>
    ${car.notes ? `<div class="car-notes">${esc(car.notes)}</div>` : ''}
    ${car.updatedAt ? `<p class="muted small" style="margin:10px 0 0">Stand: ${new Date(car.updatedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}</p>` : ''}
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

// ---------- Aufgaben (lokal oder Todoist) ----------
const PRIO_ORDER = { high: 0, medium: 1, normal: 2, low: 3 };
const isTodoist = () => state.taskSource === 'todoist';

function sortedTasks() {
  // Bei Todoist bleiben gerade abgehakte Aufgaben bis zum nächsten Laden sichtbar (zum Rückgängigmachen).
  const showDone = isTodoist() || $('#show-done').checked;
  return state.tasks
    .filter((t) => showDone || !t.done)
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.dueDateTime || a.due || '9999').localeCompare(b.dueDateTime || b.due || '9999') ||
        PRIO_ORDER[a.priority] - PRIO_ORDER[b.priority] ||
        (a.createdAt || '').localeCompare(b.createdAt || ''),
    );
}

function taskBadges(t) {
  const out = [];
  if (t.source === 'todoist') {
    if (t.priorityLabel) out.push(`<span class="badge ${t.priorityLabel.toLowerCase()}">${t.priorityLabel}</span>`);
  } else if (t.priority === 'high') out.push('<span class="badge bad">Hoch</span>');
  else if (t.priority === 'low') out.push('<span class="badge">Niedrig</span>');

  if (t.due) {
    const time = t.dueDateTime ? ` ${t.dueDateTime.slice(11, 16)}` : '';
    out.push(`<span class="badge">${fmtDate(t.due, { day: '2-digit', month: '2-digit' })}${time}${t.recurring ? ' ↻' : ''}</span>`);
    if (!t.done) out.push(dueBadge(t.due, { warnDays: 3 }));
  }
  if (t.project) out.push(`<span class="badge">#${esc(t.project)}</span>`);
  for (const l of t.labels || []) out.push(`<span class="badge">@${esc(l)}</span>`);
  return out.join('');
}

function renderTasks() {
  const todo = isTodoist();
  $('#task-source').hidden = !todo;
  $('#todoist-open').hidden = !todo;
  $('#show-done-wrap').hidden = todo;
  $('#task-hint').hidden = !todo;
  $('#task-form').classList.toggle('todoist', todo);
  $('#task-form').title.placeholder = todo ? 'Neue Aufgabe in Todoist …' : 'Neue Aufgabe …';

  const list = $('#tasks');
  const error = state.taskError ? `<li class="error-box">⚠ ${esc(state.taskError)}</li>` : '';
  const tasks = sortedTasks();
  if (!tasks.length) {
    const msg = todo
      ? state.taskError
        ? ''
        : 'Nichts fällig in Todoist 🎉'
      : state.tasks.length
        ? 'Alles erledigt 🎉'
        : 'Keine Aufgaben. Leg oben die erste an oder verbinde Todoist unter ⚙.';
    list.innerHTML = error + (msg ? `<li class="empty">${msg}</li>` : '');
    return;
  }
  list.innerHTML =
    error +
    tasks
      .map((t) => {
        const badges = taskBadges(t);
        const title = t.url
          ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" title="In Todoist öffnen">${esc(t.title)}</a>`
          : esc(t.title);
        return `
        <li class="task ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
          <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Erledigt" />
          <div>
            <div class="t-title">${title}</div>
            ${badges ? `<div class="t-meta">${badges}</div>` : ''}
          </div>
          ${t.source === 'todoist' ? '<span></span>' : '<button class="del" title="Löschen" aria-label="Löschen">✕</button>'}
        </li>`;
      })
      .join('');
}

async function loadTasks(refresh = false) {
  const data = await api(`/api/tasks${refresh ? '?refresh=1' : ''}`);
  state.taskSource = data.source;
  state.tasks = data.tasks;
  state.taskError = data.error || '';
}

$('#task-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  try {
    const task = await api('/api/tasks', { method: 'POST', body });
    form.reset();
    form.title.focus();
    if (isTodoist()) {
      // Neu laden, damit Projektname und Filter stimmen (die Aufgabe fällt evtl. nicht in den Filter).
      await loadTasks();
      if (!state.tasks.some((t) => t.id === task.id)) toast('In Todoist angelegt (passt nicht zum Anzeige-Filter).');
      else toast('In Todoist angelegt');
    } else state.tasks.push(task);
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
      const done = e.target.checked;
      const updated = await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: { done } });
      state.tasks = state.tasks.map((t) => (t.id === id ? { ...t, ...updated, done } : t));
      if (isTodoist() && done) toast('In Todoist erledigt');
    } else if (e.target.closest('.del')) {
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.tasks = state.tasks.filter((t) => t.id !== id);
    } else return;
    renderTasks();
    renderSummary();
  } catch (err) {
    e.target.checked = !e.target.checked;
    toast(err.message, true);
  }
});

$('#show-done').addEventListener('change', renderTasks);

// ---------- Pakete ----------
const PKG_STATUS = {
  expected: ['Angekündigt', ''],
  transit: ['Unterwegs', 'accent'],
  out_for_delivery: ['In Zustellung 🚚', 'warn'],
  delivered: ['Zugestellt ✓', 'ok'],
  problem: ['Problem', 'bad'],
};

function expectedText(p) {
  const date = p.estimatedDelivery ? p.estimatedDelivery.slice(0, 10) : p.expected;
  if (!date || p.status === 'delivered') return '';
  const d = daysUntil(date);
  if (d < 0) return `<span class="badge bad">sollte seit ${fmtDate(date, { day: '2-digit', month: '2-digit' })} da sein</span>`;
  return `<span class="badge ${d <= 1 ? 'warn' : ''}">erwartet ${d <= 2 ? relativeDay(date).toLowerCase() : fmtDate(date, { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>`;
}

function renderPackages() {
  const card = $('#packages-card');
  const pkgs = [...state.packages].sort(
    (a, b) => Number(a.status === 'delivered') - Number(b.status === 'delivered') || (a.expected || '9999').localeCompare(b.expected || '9999'),
  );
  card.hidden = pkgs.length === 0;
  if (!pkgs.length) {
    $('#packages').innerHTML = '';
    return;
  }
  const errors = state.packageErrors.map((e) => `<li class="error-box">⚠ ${esc(e)}</li>`).join('');
  $('#packages').innerHTML =
    errors +
    pkgs
      .map((p) => {
        const [label, cls] = PKG_STATUS[p.status] || PKG_STATUS.expected;
        const number = p.trackingNumber ? esc(p.trackingNumber) : 'Sendungsverfolgung';
        const link = p.trackingUrl ? `<a href="${esc(p.trackingUrl)}" target="_blank" rel="noopener">${number} ↗</a>` : p.trackingNumber ? number : '';
        const detail = [p.statusText, p.location].filter(Boolean).map(esc).join(' · ');
        return `
        <li class="package st-${esc(p.status)}" data-id="${esc(p.id)}">
          <div class="p-title">${esc(p.title)}</div>
          <div class="p-actions">
            ${p.status !== 'delivered' ? '<button data-action="received" title="Als erhalten markieren">✓ Erhalten</button>' : ''}
            <button data-action="edit" title="Bearbeiten">✎</button>
            <button data-action="delete" title="Entfernen">✕</button>
          </div>
          <div class="p-meta">
            <span class="badge ${cls}">${label}</span>
            ${expectedText(p)}
            <span>${esc(p.carrierName)}</span>
            ${link ? `<span>${link}</span>` : ''}
          </div>
          ${detail ? `<div class="p-meta">${detail}${p.statusSource === 'dhl' ? ' (DHL)' : ''}</div>` : ''}
        </li>`;
      })
      .join('');
}

async function loadPackages(refresh = false) {
  const data = await api(`/api/packages${refresh ? '?refresh=1' : ''}`);
  state.packages = data.packages;
  state.packageErrors = data.errors || [];
}

function openPackageDialog(pkg) {
  const form = $('#package-form');
  form.reset();
  $('#package-dialog-title').textContent = pkg ? 'Paket bearbeiten' : 'Paket erwarten';
  if (pkg) for (const el of form.elements) if (el.name && pkg[el.name] != null) el.value = pkg[el.name];
  form.id.value = pkg?.id || '';
  setMsg('#package-msg', '');
  $('#package-dialog').showModal();
  form.title.focus();
}

$('#package-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  const id = body.id;
  delete body.id;
  try {
    if (id) await api(`/api/packages/${id}`, { method: 'PATCH', body });
    else await api('/api/packages', { method: 'POST', body });
    await loadPackages();
    $('#package-dialog').close();
    renderPackages();
    renderSummary();
    toast('Paket gespeichert');
  } catch (err) {
    setMsg('#package-msg', err.message, 'error');
  }
});

$('#packages').addEventListener('click', async (e) => {
  const li = e.target.closest('.package');
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!li || !action) return;
  const pkg = state.packages.find((p) => p.id === li.dataset.id);
  try {
    if (action === 'edit') return openPackageDialog(pkg);
    if (action === 'received') await api(`/api/packages/${pkg.id}`, { method: 'PATCH', body: { status: 'delivered' } });
    if (action === 'delete') {
      if (!confirm(`„${pkg.title}“ entfernen?`)) return;
      await api(`/api/packages/${pkg.id}`, { method: 'DELETE' });
    }
    await loadPackages();
    renderPackages();
    renderSummary();
  } catch (err) {
    toast(err.message, true);
  }
});

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
          <div class="muted small">${c.type === 'file' ? 'Hochgeladene .ics-Datei · <a href="#" data-action="replace">Datei ersetzen</a>' : `iCal-Link · ${esc(c.urlHint)}`}</div>
        </div>
        <label class="toggle"><input type="checkbox" data-action="toggle" ${c.enabled ? 'checked' : ''}/> aktiv</label>
        <button class="btn btn-danger" data-action="delete">Entfernen</button>
      </li>`,
    )
    .join('');
}

async function afterCalendarChange(message) {
  renderCalendarList();
  setMsg('#calendar-msg', 'Lade Termine …');
  try {
    await loadEvents(true);
    const err = state.eventErrors[0];
    setMsg('#calendar-msg', err ? `„${err.calendarName}“: ${err.message}` : message, err ? 'error' : 'ok');
  } catch (e) {
    setMsg('#calendar-msg', e.message, 'error');
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
    setMsg('#calendar-msg', err.message, 'error');
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
    setMsg('#calendar-msg', err.message, 'error');
  }
});

let replaceCalendarId = null;
$('#calendar-replace-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !replaceCalendarId) return;
  try {
    await api(`/api/calendars/${replaceCalendarId}`, { method: 'PATCH', body: { ics: await file.text() } });
    await afterCalendarChange('Kalenderdatei ersetzt.');
  } catch (err) {
    setMsg('#calendar-msg', err.message, 'error');
  }
});

$('#calendar-list').addEventListener('click', async (e) => {
  const li = e.target.closest('li[data-id]');
  const action = e.target.dataset.action;
  if (!li || !action) return;
  const id = li.dataset.id;
  try {
    if (action === 'replace') {
      e.preventDefault();
      replaceCalendarId = id;
      $('#calendar-replace-file').click();
    } else if (action === 'delete') {
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
    setMsg('#calendar-msg', err.message, 'error');
  }
});

// ---------- Einstellungen ----------
function renderSettings() {
  const s = state.settings;
  $('#weather-current-place').textContent = s.weather ? `Aktuell: ${s.weather.name}` : 'Noch kein Ort festgelegt.';
  $('#todoist-status').innerHTML = s.todoist.connected
    ? `<span class="badge ok">verbunden</span>${s.todoist.fromEnv ? ' <span class="muted">(über Umgebungsvariable TODOIST_TOKEN)</span>' : ''}`
    : '<span class="badge">nicht verbunden</span> <span class="muted">Ohne Todoist werden die Aufgaben lokal im Dashboard gespeichert.</span>';
  $('#todoist-form').filter.value = s.todoist.filter || '';
  $('#todoist-disconnect').hidden = !s.todoist.connected || s.todoist.fromEnv;
  $('#dhl-status').innerHTML = s.dhl.configured ? '<span class="badge ok">Schlüssel hinterlegt</span>' : '<span class="badge">kein Schlüssel</span>';
}

async function afterSettingsChange(settings, message) {
  state.settings = settings;
  renderSettings();
  setMsg('#settings-msg', message, 'ok');
  await loadAll();
}

async function saveWeatherPlace(place) {
  try {
    const settings = await api('/api/settings/weather', { method: 'PUT', body: place });
    $('#weather-results').innerHTML = '';
    $('#weather-search').value = '';
    await afterSettingsChange(settings, `Wetter-Ort: ${place.name}`);
  } catch (err) {
    setMsg('#settings-msg', err.message, 'error');
  }
}

let placeResults = [];
$('#weather-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('#settings-msg', 'Suche …');
  try {
    placeResults = await api(`/api/weather/search?q=${encodeURIComponent(e.target.q.value)}`);
    $('#weather-results').innerHTML = placeResults.length
      ? placeResults.map((p, i) => `<li><button type="button" data-i="${i}"><strong>${esc(p.name)}</strong> <span class="muted small">${esc(p.region)}</span></button></li>`).join('')
      : '<li class="muted small">Kein Ort gefunden.</li>';
    setMsg('#settings-msg', '');
  } catch (err) {
    setMsg('#settings-msg', err.message, 'error');
  }
});

$('#weather-results').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-i]');
  if (btn) saveWeatherPlace(placeResults[Number(btn.dataset.i)]);
});

$('#weather-geo').addEventListener('click', () => {
  if (!navigator.geolocation) return setMsg('#settings-msg', 'Standort wird von diesem Browser nicht unterstützt.', 'error');
  setMsg('#settings-msg', 'Standort wird ermittelt …');
  navigator.geolocation.getCurrentPosition(
    (pos) =>
      saveWeatherPlace({
        name: 'Mein Standort',
        latitude: Math.round(pos.coords.latitude * 100) / 100,
        longitude: Math.round(pos.coords.longitude * 100) / 100,
      }),
    () =>
      setMsg(
        '#settings-msg',
        'Standort nicht verfügbar. Er funktioniert nur über localhost oder https. Bitte den Ort stattdessen suchen.',
        'error',
      ),
    { timeout: 10_000 },
  );
});

$('#todoist-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  setMsg('#settings-msg', body.token ? 'Prüfe Token bei Todoist …' : 'Speichere …');
  try {
    const settings = await api('/api/settings/todoist', { method: 'PUT', body });
    e.target.token.value = '';
    await afterSettingsChange(settings, body.token ? 'Todoist verbunden ✓' : 'Todoist-Filter gespeichert.');
  } catch (err) {
    setMsg('#settings-msg', err.message, 'error');
  }
});

$('#todoist-disconnect').addEventListener('click', async () => {
  if (!confirm('Todoist trennen? Danach werden wieder die lokalen Aufgaben angezeigt.')) return;
  const settings = await api('/api/settings/todoist', { method: 'DELETE' });
  await afterSettingsChange(settings, 'Todoist getrennt.');
});

$('#dhl-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const settings = await api('/api/settings/dhl', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
    e.target.apiKey.value = '';
    await afterSettingsChange(settings, settings.dhl.configured ? 'DHL-Schlüssel gespeichert.' : 'DHL-Schlüssel entfernt.');
  } catch (err) {
    setMsg('#settings-msg', err.message, 'error');
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

  const stats = [];
  const w = state.weather;
  if (w?.current) {
    stats.push({
      label: `Wetter ${w.location || ''}`,
      value: `${wxIcon(w.current.code, w.current.isDay)} ${deg(w.current.temperature)}`,
      hint: rainHint(w).wet ? rainHint(w).text : `${wxText(w.current.code)}, ${deg(w.daily[0].min)} / ${deg(w.daily[0].max)}`,
    });
  }
  stats.push({
    label: 'Termine heute',
    value: state.calendars.length ? todays.length : '–',
    hint: state.calendars.length ? nextHint : 'Kein Kalender verbunden',
  });
  stats.push({
    label: isTodoist() ? 'Todoist' : 'Offene Aufgaben',
    value: open.length,
    hint: state.taskError
      ? 'Todoist nicht erreichbar'
      : overdue.length
        ? `${overdue.length} überfällig${dueToday.length ? `, ${dueToday.length} heute` : ''}`
        : dueToday.length
          ? `${dueToday.length} heute fällig`
          : 'Nichts überfällig',
    cls: overdue.length || state.taskError ? 'bad' : dueToday.length ? 'warn' : '',
  });
  const activePkgs = state.packages.filter((p) => p.status !== 'delivered');
  if (activePkgs.length) {
    const soon = activePkgs.filter((p) => p.status === 'out_for_delivery' || p.expected === today);
    stats.push({
      label: 'Pakete',
      value: `📦 ${activePkgs.length}`,
      hint: soon.length ? `${soon.length} kommt heute` : activePkgs.map((p) => p.title).join(', '),
      cls: soon.length ? 'warn' : '',
    });
  }
  stats.push({
    label: 'Auto',
    value: warnings.length ? `${warnings.length} Hinweis${warnings.length === 1 ? '' : 'e'}` : state.car?.updatedAt ? 'Alles ok' : '–',
    hint: warnings.length
      ? warnings.map((w) => (w.d == null ? w.label : `${w.label} ${w.d <= 0 ? 'fällig' : `in ${w.d} T.`}`)).join(', ')
      : state.car?.mileageKm != null
        ? `${fmtNum(state.car.mileageKm)} km`
        : 'Noch nicht eingerichtet',
    cls: warnings.some((w) => w.level === 'bad') ? 'bad' : warnings.length ? 'warn' : '',
  });

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
    // Ein offener Dialog wird geschlossen, bevor der nächste aufgeht.
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (id === 'car-dialog') openCarDialog();
    else if (id === 'package-dialog') openPackageDialog(null);
    else {
      if (id === 'calendar-dialog') {
        renderCalendarList();
        setMsg('#calendar-msg', '');
      }
      if (id === 'settings-dialog') {
        renderSettings();
        setMsg('#settings-msg', '');
      }
      $(`#${id}`).showModal();
      if (opener.dataset.focus) $(`#${opener.dataset.focus}`)?.focus();
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
    // Unabhängige Quellen parallel laden; ein Fehler in einer Quelle blockiert die anderen nicht.
    const results = await Promise.allSettled([loadEvents(refresh), loadTasks(refresh), loadWeather(refresh), loadPackages(refresh)]);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) toast(`Teilweise nicht geladen: ${failed.reason.message}`, true);
    state.loadedAt = new Date();
    $('#last-update').textContent = `Zuletzt aktualisiert: ${fmtTime(state.loadedAt)} Uhr`;
  } catch (err) {
    toast(`Laden fehlgeschlagen: ${err.message}`, true);
  } finally {
    btn.classList.remove('spin');
  }
  renderAll();
}

function renderAll() {
  renderSummary();
  renderPackages();
  renderWeather();
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
