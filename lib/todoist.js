// Todoist-Anbindung über die Todoist API v1 (https://developer.todoist.com/api/v1/).
// Der persönliche API-Token bleibt auf dem Server und wird nie an den Browser geschickt.
const BASE = (process.env.TODOIST_API_BASE || 'https://api.todoist.com') + '/api/v1';
const CACHE_TTL_MS = 60 * 1000;

let cache = null; // { key, at, data }

export class TodoistError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function call(token, path, { method = 'GET', query, body } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { 'Content-Type': 'application/json' }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new TodoistError(`Todoist nicht erreichbar (${err.cause?.code || err.name}).`, 502);
  }
  if (res.status === 401 || res.status === 403) throw new TodoistError('Todoist-Token ungültig oder abgelaufen.', 401);
  if (res.status === 400 && path.includes('filter')) {
    throw new TodoistError('Der Todoist-Filter ist ungültig. Bitte in den Einstellungen prüfen.', 400);
  }
  if (!res.ok) throw new TodoistError(`Todoist antwortet mit HTTP ${res.status}.`, 502);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Alle Seiten einer paginierten Liste abrufen (results + next_cursor).
async function callAll(token, path, query = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = await call(token, path, { query: { ...query, limit: '200', cursor } });
    out.push(...(data.results || []));
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

// Todoist: priority 4 = P1 (dringend) … 1 = P4 (normal).
const PRIORITY_LABEL = { 4: 'P1', 3: 'P2', 2: 'P3', 1: null };

function mapTask(t, projects) {
  const due = t.due || null;
  const dueDate = due?.date ? due.date.slice(0, 10) : '';
  const dueTime = due?.date && due.date.length > 10 ? due.date : null; // mit Uhrzeit
  return {
    id: t.id,
    title: t.content,
    notes: t.description || '',
    due: dueDate,
    dueDateTime: dueTime,
    dueString: due?.string || '',
    recurring: Boolean(due?.is_recurring),
    priority: t.priority === 4 ? 'high' : t.priority === 1 ? 'normal' : 'medium',
    priorityLabel: PRIORITY_LABEL[t.priority] || null,
    todoistPriority: t.priority,
    project: projects.get(t.project_id) || '',
    labels: t.labels || [],
    done: Boolean(t.checked),
    url: `https://app.todoist.com/app/task/${t.id}`,
    createdAt: t.added_at || '',
    source: 'todoist',
  };
}

export async function verifyToken(token) {
  await call(token, '/projects', { query: { limit: '1' } });
}

export async function getTasks(token, filter) {
  const key = `${token.slice(-6)}|${filter}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const [tasks, projectList] = await Promise.all([
    callAll(token, '/tasks/filter', { query: filter, lang: 'en' }),
    callAll(token, '/projects'),
  ]);
  const projects = new Map(projectList.map((p) => [p.id, p.name === 'Inbox' ? 'Eingang' : p.name]));
  const data = tasks.map((t) => mapTask(t, projects));
  cache = { key, at: Date.now(), data };
  return data;
}

/** Schnell hinzufügen mit Todoists natürlicher Sprache, z. B. "Reifen wechseln morgen p1 #Auto". */
export async function quickAdd(token, text) {
  cache = null;
  const t = await call(token, '/tasks/quick', { method: 'POST', body: { text } });
  return mapTask(t, new Map());
}

export async function setDone(token, id, done) {
  cache = null;
  await call(token, `/tasks/${encodeURIComponent(id)}/${done ? 'close' : 'reopen'}`, { method: 'POST' });
}

export function clearTodoistCache() {
  cache = null;
}
