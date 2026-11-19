// Einfache JSON-Datei als Datenspeicher (data/db.json).
// Für ein persönliches Dashboard völlig ausreichend; später leicht gegen SQLite o.ä. austauschbar.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = {
  car: {
    name: '',
    model: '',
    licensePlate: '',
    mileageKm: null,
    fuelPercent: null,
    rangeKm: null,
    nextInspection: '', // TÜV / HU (YYYY-MM-DD)
    nextService: '', // Inspektion / Wartung (YYYY-MM-DD)
    nextServiceKm: null,
    tireChange: '', // Reifenwechsel (YYYY-MM-DD)
    locked: null, // true / false / null = unbekannt
    location: '',
    notes: '',
    source: 'manual', // später z.B. 'api'
    updatedAt: null,
  },
  tasks: [],
  calendars: [],
};

let cache = null;
let writeQueue = Promise.resolve();

export async function load() {
  if (cache) return cache;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = {
      ...structuredClone(DEFAULTS),
      ...parsed,
      car: { ...DEFAULTS.car, ...(parsed.car || {}) },
    };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    cache = structuredClone(DEFAULTS);
    await persist();
  }
  return cache;
}

// Schreibt atomar (tmp-Datei + rename) und serialisiert parallele Schreibvorgänge.
export function persist() {
  writeQueue = writeQueue.then(async () => {
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(cache, null, 2));
    await fs.rename(tmp, DB_FILE);
  });
  return writeQueue;
}

export async function update(mutator) {
  const db = await load();
  const result = await mutator(db);
  await persist();
  return result;
}

export const newId = () => crypto.randomUUID();
