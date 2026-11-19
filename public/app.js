// Persönliches Dashboard – Frontend (ohne Build-Schritt, reines JavaScript).

const REFRESH_MS = 5 * 60 * 1000;
const state = {
  car: {},
  settings: { weather: null, todoist: {}, dhl: {}, mail: {} },
  expenses: [],
  expenseCategories: {},
  mail: null,
  tasks: [],
  taskSource: 'local',
  taskError: '',
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

// ---------- Auto-Kosten ----------
const CATEGORY_ICONS = {
  fuel: '⛽',
  service: '🔧',
  repair: '🛠',
  tires: '🛞',
  insurance: '🛡',
  tax: '🏛',
  inspection: '✅',
  parking: '🅿️',
  care: '🧽',
  other: '📎',
};
const fmtEur = (n, digits = 2) =>
  n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDec = (n, digits = 1) => (n == null || !Number.isFinite(n) ? '–' : n.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const monthKey = (dateStr) => dateStr.slice(0, 7);

function costRangeStart(range) {
  const now = new Date();
  if (range === 'year') return `${now.getFullYear()}-01-01`;
  if (range === '12m') return dayKey(new Date(now.getFullYear(), now.getMonth() - 11, 1));
  return '0000-01-01';
}

/** Durchschnittsverbrauch nach der Volltank-Methode (von Volltanken zu Volltanken). */
function fuelConsumption(expenses) {
  const fuel = expenses
    .filter((e) => e.category === 'fuel' && e.mileageKm != null && e.liters)
    .sort((a, b) => a.mileageKm - b.mileageKm || a.date.localeCompare(b.date));
  let liters = 0;
  let km = 0;
  let lastFull = null;
  let pending = 0;
  for (const e of fuel) {
    if (lastFull) pending += e.liters;
    if (e.fullTank) {
      if (lastFull && e.mileageKm > lastFull.mileageKm) {
        liters += pending;
        km += e.mileageKm - lastFull.mileageKm;
      }
      lastFull = e;
      pending = 0;
    }
  }
  return km > 0 ? (liters / km) * 100 : null;
}

function costStats(expenses, range) {
  const start = costRangeStart(range);
  const inRange = expenses.filter((e) => e.date >= start);
  const total = inRange.reduce((s, e) => s + e.amount, 0);
  const thisMonth = expenses.filter((e) => monthKey(e.date) === monthKey(todayKey())).reduce((s, e) => s + e.amount, 0);

  // Gefahrene km im Zeitraum: höchster Stand im Zeitraum minus letzter Stand davor (bzw. niedrigster im Zeitraum).
  const kmIn = inRange.filter((e) => e.mileageKm != null).map((e) => e.mileageKm);
  const kmBefore = expenses.filter((e) => e.date < start && e.mileageKm != null).map((e) => e.mileageKm);
  const baseKm = kmBefore.length ? Math.max(...kmBefore) : kmIn.length ? Math.min(...kmIn) : null;
  const kmDriven = kmIn.length && baseKm != null ? Math.max(...kmIn) - baseKm : null;

  const fuelIn = inRange.filter((e) => e.category === 'fuel' && e.liters);
  const fuelLiters = fuelIn.reduce((s, e) => s + e.liters, 0);
  const avgPrice = fuelLiters ? fuelIn.reduce((s, e) => s + e.amount, 0) / fuelLiters : null;
  const lastFuel = expenses.filter((e) => e.category === 'fuel' && e.liters).sort((a, b) => b.date.localeCompare(a.date))[0];

  const byCategory = {};
  for (const e of inRange) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;

  return {
    total,
    thisMonth,
    kmDriven: kmDriven > 0 ? kmDriven : null,
    perKm: kmDriven > 0 ? total / kmDriven : null,
    consumption: fuelConsumption(inRange) ?? fuelConsumption(expenses), // Zeitraum, sonst gesamt
    avgPrice,
    lastPrice: lastFuel ? lastFuel.amount / lastFuel.liters : null,
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    count: inRange.length,
  };
}

/** Monatswerte (letzte 12 Monate), getrennt nach Tanken und sonstigen Kosten. */
function monthlySeries(expenses) {
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, date: d, fuel: 0, other: 0 });
  }
  const idx = new Map(months.map((m) => [m.key, m]));
  for (const e of expenses) {
    const m = idx.get(monthKey(e.date));
    if (m) m[e.category === 'fuel' ? 'fuel' : 'other'] += e.amount;
  }
  return months;
}

/** "Schöne" Skala für die y-Achse. */
function niceMax(v) {
  if (v <= 0) return 100;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= v) return f * p;
  return 10 * p;
}

function renderCostChart(months) {
  const max = niceMax(Math.max(...months.map((m) => m.fuel + m.other)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
  const bars = months
    .map((m) => {
      const total = m.fuel + m.other;
      const label = m.date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
      const tip = `${m.date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}&#10;Tanken: ${fmtEur(m.fuel)}&#10;Sonstiges: ${fmtEur(m.other)}&#10;Summe: ${fmtEur(total)}`;
      return `
        <div class="cc-col" tabindex="0" data-tip="${tip}" aria-label="${tip.replace(/&#10;/g, ', ')}">
          <div class="cc-stack" style="height:${(total / max) * 100}%">
            ${m.other ? `<div class="cc-seg cc-other" style="flex:${m.other}"></div>` : ''}
            ${m.fuel ? `<div class="cc-seg cc-fuel" style="flex:${m.fuel}"></div>` : ''}
          </div>
          <div class="cc-x">${label.replace(' ', '<br/>')}</div>
        </div>`;
    })
    .join('');
  return `
    <div class="cc" role="img" aria-label="Monatliche Autokosten der letzten 12 Monate">
      <div class="cc-legend">
        <span><i class="sw cc-fuel"></i>Tanken</span>
        <span><i class="sw cc-other"></i>Sonstige Kosten</span>
      </div>
      <div class="cc-plot">
        <div class="cc-grid">${ticks
          .map((t) => `<div class="cc-tick" style="bottom:${(t / max) * 100}%"><span>${fmtEur(t, 0)}</span></div>`)
          .join('')}</div>
        <div class="cc-bars">${bars}</div>
      </div>
      <div class="cc-tooltip" hidden></div>
    </div>`;
}

let showAllExpenses = false;

function renderCosts() {
  const el = $('#costs');
  const car = state.car || {};
  $('#costs-title').textContent = `💶 Kosten · ${car.name || car.model || 'Auto'}`;
  const expenses = state.expenses;
  if (!expenses.length) {
    el.innerHTML = `<div class="empty">Noch keine Ausgaben eingetragen.<br/>Trag nach dem Tanken Betrag, Liter und Kilometerstand ein: Dann siehst du hier Verbrauch, Kosten pro km und eine Monatsübersicht.<br/><button class="btn" data-open="expense-dialog" data-category="fuel">⛽ Erste Tankfüllung eintragen</button></div>`;
    return;
  }
  const range = $('#cost-range').value;
  const rangeLabel = { '12m': 'letzte 12 Monate', year: `Jahr ${new Date().getFullYear()}`, all: 'gesamt' }[range];
  const s = costStats(expenses, range);
  const maxCat = s.byCategory[0]?.[1] || 1;
  const list = showAllExpenses ? expenses : expenses.slice(0, 6);

  el.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="label">Diesen Monat</div><div class="value">${fmtEur(s.thisMonth)}</div></div>
      <div class="kpi"><div class="label">Summe</div><div class="value">${fmtEur(s.total)}</div><div class="hint">${rangeLabel}${s.kmDriven ? ` · ${fmtNum(s.kmDriven)} km` : ''}</div></div>
      <div class="kpi"><div class="label">Kosten pro km</div><div class="value">${s.perKm != null ? fmtEur(s.perKm) : '–'}</div><div class="hint">${s.perKm != null ? 'alle Kosten / gefahrene km' : 'braucht km-Stände'}</div></div>
      <div class="kpi"><div class="label">Ø Verbrauch</div><div class="value">${s.consumption != null ? `${fmtDec(s.consumption)} l` : '–'}</div><div class="hint">${s.consumption != null ? 'pro 100 km' : 'braucht 2× Volltanken mit km'}</div></div>
      <div class="kpi"><div class="label">Spritpreis</div><div class="value">${s.lastPrice != null ? `${fmtDec(s.lastPrice, 3)} €` : '–'}</div><div class="hint">${s.avgPrice != null ? `zuletzt · Ø ${fmtDec(s.avgPrice, 3)} €/l` : 'pro Liter'}</div></div>
    </div>

    ${renderCostChart(monthlySeries(expenses))}

    <div class="cost-split">
      <section>
        <h4>Nach Art (${rangeLabel})</h4>
        <ul class="cat-bars">
          ${s.byCategory
            .map(
              ([cat, sum]) => `
            <li>
              <span class="cat-name">${CATEGORY_ICONS[cat] || ''} ${esc(state.expenseCategories[cat] || cat)}</span>
              <span class="cat-bar"><span style="width:${(sum / maxCat) * 100}%"></span></span>
              <span class="cat-val">${fmtEur(sum, 0)}</span>
            </li>`,
            )
            .join('') || '<li class="muted small">Keine Ausgaben in diesem Zeitraum.</li>'}
        </ul>
      </section>
      <section>
        <h4>Letzte Einträge</h4>
        <ul class="expense-list">
          ${list
            .map((e) => {
              const details = [
                e.liters ? `${fmtDec(e.liters, 2)} l à ${fmtDec(e.amount / e.liters, 3)} €` : '',
                e.mileageKm != null ? `${fmtNum(e.mileageKm)} km` : '',
                e.category === 'fuel' && e.liters && !e.fullTank ? 'nicht voll' : '',
                e.station,
                e.note,
              ]
                .filter(Boolean)
                .map(esc)
                .join(' · ');
              return `
              <li data-id="${esc(e.id)}">
                <span class="ex-icon" title="${esc(state.expenseCategories[e.category])}">${CATEGORY_ICONS[e.category] || '📎'}</span>
                <div class="ex-main">
                  <div><strong>${esc(state.expenseCategories[e.category])}</strong> <span class="muted small">${fmtDate(e.date)}</span></div>
                  ${details ? `<div class="muted small">${details}</div>` : ''}
                </div>
                <span class="ex-amount">${fmtEur(e.amount)}</span>
                <span class="ex-actions">
                  <button data-action="edit" title="Bearbeiten" aria-label="Bearbeiten">✎</button>
                  <button data-action="delete" title="Löschen" aria-label="Löschen">✕</button>
                </span>
              </li>`;
            })
            .join('')}
        </ul>
        <div class="row ex-footer">
          ${expenses.length > 6 ? `<button class="btn btn-ghost" data-action="toggle-all">${showAllExpenses ? 'Weniger anzeigen' : `Alle ${expenses.length} anzeigen`}</button>` : ''}
          <a class="btn btn-ghost" href="/api/expenses.csv" download>CSV exportieren</a>
        </div>
      </section>
    </div>
  `;
}

async function loadExpenses() {
  const data = await api('/api/expenses');
  state.expenses = data.expenses;
  state.expenseCategories = data.categories;
}

$('#cost-range').addEventListener('change', renderCosts);

// Tooltip für das Monatsdiagramm (Maus und Tastatur)
function showCostTip(col) {
  const chart = col.closest('.cc');
  const tip = chart.querySelector('.cc-tooltip');
  tip.innerHTML = col.dataset.tip
    .split('\n')
    .map((line, i) => (i === 0 ? `<strong>${esc(line)}</strong>` : esc(line)))
    .join('<br/>');
  tip.hidden = false;
  const c = chart.getBoundingClientRect();
  const r = col.getBoundingClientRect();
  const left = Math.min(Math.max(r.left - c.left + r.width / 2, 70), c.width - 70);
  tip.style.left = `${left}px`;
  chart.querySelectorAll('.cc-col.active').forEach((x) => x.classList.remove('active'));
  col.classList.add('active');
}
function hideCostTip(chart) {
  chart.querySelector('.cc-tooltip').hidden = true;
  chart.querySelectorAll('.cc-col.active').forEach((x) => x.classList.remove('active'));
}
$('#costs').addEventListener('mouseover', (e) => {
  const col = e.target.closest('.cc-col');
  const chart = e.target.closest('.cc');
  if (col) showCostTip(col);
  else if (chart) hideCostTip(chart);
});
$('#costs').addEventListener('focusin', (e) => {
  const col = e.target.closest('.cc-col');
  if (col) showCostTip(col);
});
$('#costs').addEventListener('mouseleave', () => {
  const chart = $('#costs .cc');
  if (chart) hideCostTip(chart);
});
$('#costs').addEventListener('focusout', (e) => {
  const chart = e.target.closest('.cc');
  if (chart) hideCostTip(chart);
});

$('#costs').addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'toggle-all') {
    showAllExpenses = !showAllExpenses;
    return renderCosts();
  }
  const li = e.target.closest('li[data-id]');
  const exp = state.expenses.find((x) => x.id === li?.dataset.id);
  if (!exp) return;
  if (action === 'edit') return openExpenseDialog(exp);
  if (action === 'delete') {
    if (!confirm(`${state.expenseCategories[exp.category]} vom ${fmtDate(exp.date)} über ${fmtEur(exp.amount)} löschen?`)) return;
    try {
      await api(`/api/expenses/${exp.id}`, { method: 'DELETE' });
      state.expenses = state.expenses.filter((x) => x.id !== exp.id);
      renderCosts();
      renderSummary();
    } catch (err) {
      toast(err.message, true);
    }
  }
});

function updateExpenseForm() {
  const form = $('#expense-form');
  const isFuel = form.category.value === 'fuel';
  form.querySelectorAll('.fuel-only').forEach((el) => (el.hidden = !isFuel));
  const amount = Number(String(form.amount.value).replace(',', '.'));
  const liters = Number(String(form.liters.value).replace(',', '.'));
  $('#expense-preview').textContent = isFuel && amount > 0 && liters > 0 ? `= ${fmtDec(amount / liters, 3)} € pro Liter` : '';
}
$('#expense-form').addEventListener('input', updateExpenseForm);

function openExpenseDialog(exp, category = 'fuel') {
  const form = $('#expense-form');
  form.reset();
  $('#expense-dialog-title').textContent = exp ? 'Eintrag bearbeiten' : category === 'fuel' ? '⛽ Tanken eintragen' : 'Ausgabe eintragen';
  form.id.value = exp?.id || '';
  form.category.value = exp?.category || category;
  form.date.value = exp?.date || todayKey();
  form.amount.value = exp ? String(exp.amount).replace('.', ',') : '';
  form.mileageKm.value = exp?.mileageKm ?? '';
  form.mileageKm.placeholder = state.car?.mileageKm != null ? `zuletzt ${fmtNum(state.car.mileageKm)}` : 'optional';
  form.liters.value = exp?.liters != null ? String(exp.liters).replace('.', ',') : '';
  form.fullTank.checked = exp ? Boolean(exp.fullTank) : true;
  form.station.value = exp?.station || '';
  form.note.value = exp?.note || '';
  setMsg('#expense-msg', '');
  updateExpenseForm();
  $('#expense-dialog').showModal();
  form.amount.focus();
}

$('#expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const body = Object.fromEntries(new FormData(form));
  body.fullTank = form.fullTank.checked;
  const id = body.id;
  delete body.id;
  try {
    const res = id
      ? await api(`/api/expenses/${id}`, { method: 'PATCH', body })
      : await api('/api/expenses', { method: 'POST', body });
    state.car = res.car;
    await loadExpenses();
    $('#expense-dialog').close();
    renderCosts();
    renderCar();
    renderSummary();
    toast(id ? 'Eintrag gespeichert' : `${state.expenseCategories[res.expense.category]} über ${fmtEur(res.expense.amount)} eingetragen`);
  } catch (err) {
    setMsg('#expense-msg', err.message, 'error');
  }
});

// ---------- Mails ----------
function fmtMailDate(iso) {
  const d = new Date(iso);
  const key = dayKey(d);
  const diff = daysUntil(key);
  if (diff === 0) return fmtTime(d);
  if (diff === -1) return 'gestern';
  if (diff > -7) return d.toLocaleDateString('de-DE', { weekday: 'short' });
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

function renderMail() {
  const m = state.mail;
  const list = $('#mail');
  const count = $('#mail-count');
  $('#mail-open').hidden = !m?.webmailUrl;
  if (m?.webmailUrl) $('#mail-open').href = m.webmailUrl;
  count.hidden = !m?.messages?.length;
  if (m?.messages) count.textContent = `${m.unreadCount} ungelesen${m.flaggedCount ? ` · ${m.flaggedCount} markiert` : ''}`;

  if (!m || !m.configured) {
    list.innerHTML = `<li class="empty">Noch kein Postfach verbunden.<br/><button class="btn" data-open="settings-dialog" data-focus="mail-email">GMX verbinden</button></li>`;
    return;
  }
  if (m.error) {
    list.innerHTML = `<li class="error-box">⚠ ${esc(m.error)}</li>`;
    return;
  }
  if (!m.messages.length) {
    list.innerHTML = '<li class="empty">Posteingang erledigt 🎉 Keine ungelesenen oder markierten Mails.</li>';
    return;
  }
  list.innerHTML = m.messages
    .map(
      (x) => `
      <li class="mail ${x.unread ? 'unread' : ''}" data-uid="${x.uid}">
        <span class="mail-dot" title="${x.unread ? 'ungelesen' : ''}"></span>
        <div class="mail-main">
          <div class="mail-from">${esc(x.from)} ${x.flagged ? '<span class="badge warn" title="Markiert">⭐ markiert</span>' : ''}</div>
          <div class="mail-subject">${esc(x.subject)}</div>
        </div>
        <div class="mail-side">
          <span class="muted small">${fmtMailDate(x.date)}</span>
          <span class="mail-actions">
            ${x.unread ? '<button data-action="seen" title="Als gelesen markieren">✓ Gelesen</button>' : ''}
            ${x.flagged ? '<button data-action="unflag" title="Markierung entfernen">Erledigt</button>' : ''}
          </span>
        </div>
      </li>`,
    )
    .join('');
}

async function loadMail(refresh = false) {
  state.mail = await api(`/api/mail${refresh ? '?refresh=1' : ''}`);
}

$('#mail').addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const li = e.target.closest('li[data-uid]');
  if (!action || !li) return;
  const uid = Number(li.dataset.uid);
  const body = action === 'seen' ? { seen: true } : { flagged: false };
  try {
    e.target.disabled = true;
    await api(`/api/mail/${uid}`, { method: 'PATCH', body });
    const msg = state.mail.messages.find((x) => x.uid === uid);
    if (action === 'seen') {
      msg.unread = false;
      state.mail.unreadCount = Math.max(0, state.mail.unreadCount - 1);
    } else {
      msg.flagged = false;
      state.mail.flaggedCount = Math.max(0, state.mail.flaggedCount - 1);
    }
    // Erledigte Mails (gelesen und nicht markiert) verschwinden aus der Liste.
    state.mail.messages = state.mail.messages.filter((x) => x.unread || x.flagged);
    renderMail();
    renderSummary();
  } catch (err) {
    e.target.disabled = false;
    toast(err.message, true);
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
  $('#mail-status').innerHTML = s.mail.configured
    ? `<span class="badge ok">verbunden</span> <span class="muted">${esc(s.mail.email)} · ${esc(s.mail.host)}${s.mail.fromEnv ? ' (über Umgebungsvariablen)' : ''}</span>`
    : '<span class="badge">nicht verbunden</span>';
  $('#mail-form').email.value = s.mail.email || '';
  $('#mail-disconnect').hidden = !s.mail.configured || s.mail.fromEnv;
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

$('#mail-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  setMsg('#settings-msg', 'Melde mich beim Postfach an …');
  try {
    const settings = await api('/api/settings/mail', { method: 'PUT', body });
    e.target.password.value = '';
    await afterSettingsChange(settings, 'Postfach verbunden ✓');
  } catch (err) {
    setMsg('#settings-msg', err.message, 'error');
  }
});

$('#mail-disconnect').addEventListener('click', async () => {
  if (!confirm('Postfach trennen? Zugangsdaten werden gelöscht.')) return;
  const settings = await api('/api/settings/mail', { method: 'DELETE' });
  await afterSettingsChange(settings, 'Postfach getrennt.');
});

// ---------- Übersicht ----------
function renderSummary() {
  const today = todayKey();
  const open = state.tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = open.filter((t) => t.due === today);
  const warnings = carWarnings(state.car || {});

  const stats = [];
  const w = state.weather;
  if (w?.current) {
    stats.push({
      label: `Wetter ${w.location || ''}`,
      value: `${wxIcon(w.current.code, w.current.isDay)} ${deg(w.current.temperature)}`,
      hint: rainHint(w).wet ? rainHint(w).text : `${wxText(w.current.code)}, ${deg(w.daily[0].min)} / ${deg(w.daily[0].max)}`,
    });
  }
  const m = state.mail;
  if (m?.configured) {
    stats.push({
      label: 'Mails',
      value: m.error ? '–' : `✉️ ${m.unreadCount}`,
      hint: m.error ? 'Postfach nicht erreichbar' : `ungelesen${m.flaggedCount ? ` · ${m.flaggedCount} markiert` : ''}`,
      cls: m.error ? 'bad' : '',
    });
  }
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
  if (state.expenses.length) {
    const monthTotal = state.expenses.filter((e) => monthKey(e.date) === monthKey(today)).reduce((sum, e) => sum + e.amount, 0);
    const lastFuel = state.expenses.find((e) => e.category === 'fuel');
    stats.push({
      label: 'Autokosten Monat',
      value: fmtEur(monthTotal, 0),
      hint: lastFuel
        ? `Zuletzt getankt ${daysUntil(lastFuel.date) >= -1 ? relativeDay(lastFuel.date).toLowerCase() : `am ${fmtDate(lastFuel.date, { day: '2-digit', month: '2-digit' })}`}`
        : 'Noch nicht getankt',
    });
  }

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
    else if (id === 'expense-dialog') openExpenseDialog(null, opener.dataset.category || 'fuel');
    else {
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
    const results = await Promise.allSettled([loadTasks(refresh), loadWeather(refresh), loadPackages(refresh), loadExpenses(), loadMail(refresh)]);
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
  renderCosts();
  renderMail();
  renderTasks();
  renderCar();
}

$('#refresh').addEventListener('click', () => loadAll(true));

tickClock();
setInterval(tickClock, 1000);
setInterval(() => {
  // Daten alle 5 Minuten neu laden.
  if (state.loadedAt && Date.now() - state.loadedAt > REFRESH_MS) loadAll();
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.loadedAt && Date.now() - state.loadedAt > 60_000) loadAll();
});

loadAll();
