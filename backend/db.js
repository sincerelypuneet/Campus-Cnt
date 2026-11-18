// backend/db.js

import { promises as fs } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'data');
const pendingWrites = new Map(); // filePath -> promise chain

// Ensure data directory exists
await fs.mkdir(dataDir, { recursive: true });

/** Utility: Resolve a safe file path within the data directory */
function resolveFile(fileName) {
  const fullPath = path.resolve(dataDir, fileName);
  if (!fullPath.startsWith(dataDir)) {
    throw new Error('Attempt to access file outside data directory');
  }
  return fullPath;
}

/** Load JSON, handling corrupted files */
async function read(fileName) {
  const filePath = resolveFile(fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    // If file does not exist, initialize with default
    if (err.code === 'ENOENT') {
      const defaultData = fileName === 'settings.json' ? {} : [];
      await write(fileName, defaultData);
      return defaultData;
    }
    // Corrupted JSON – backup and reinitialize
    console.warn(`Corrupted JSON in ${fileName}: ${err.message}. Backing up and resetting.`);
    const backupPath = `${filePath}.bak.${new Date().toISOString()}`;
    await fs.copyFile(filePath, backupPath);
    const defaultData = fileName === 'settings.json' ? {} : [];
    await write(fileName, defaultData);
    return defaultData;
  }
}

/** Atomic write with backup */
async function write(fileName, data) {
  const filePath = resolveFile(fileName);
  const tmpPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak.${new Date().toISOString()}`;

  const json = JSON.stringify(data, null, 2);
  // Backup current file if it exists
  try {
    await fs.access(filePath);
    await fs.copyFile(filePath, backupPath);
  } catch (_) {}

  await fs.writeFile(tmpPath, json, 'utf8');
  await fs.rename(tmpPath, filePath);
}

/** Queue write operations per file to avoid race conditions */
function queueWrite(fileName, operation) {
  const current = pendingWrites.get(fileName) || Promise.resolve();
  const next = current.then(operation).catch(err => {
    console.error(`Error processing write for ${fileName}:`, err);
    throw err;
  });
  pendingWrites.set(fileName, next);
  return next;
}

/** Generate a UUID v4 */
function generateId() {
  return randomUUID();
}

/** Add a new record */
async function add(fileName, record) {
  const id = generateId();
  const newRecord = { id, ...record };
  return queueWrite(fileName, async () => {
    const data = await read(fileName);
    if (!Array.isArray(data)) throw new Error(`${fileName} is not an array`);
    data.push(newRecord);
    await write(fileName, data);
    return newRecord;
  });
}

async function addIf(fileName, record, conflictsWith) {
  const newRecord = { id: generateId(), ...record };
  return queueWrite(fileName, async () => {
    const data = await read(fileName);
    if (!Array.isArray(data)) throw new Error(`${fileName} is not an array`);
    const conflict = data.find(conflictsWith);
    if (conflict) return { inserted: false, conflict };
    data.push(newRecord);
    await write(fileName, data);
    return { inserted: true, record: newRecord };
  });
}

async function mutate(fileName, operation) {
  return queueWrite(fileName, async () => {
    const data = await read(fileName);
    if (!Array.isArray(data)) throw new Error(`${fileName} is not an array`);
    const outcome = operation(data);
    if (outcome.changed) await write(fileName, data);
    return outcome.value;
  });
}

/** Update an existing record by id */
async function update(fileName, id, patch) {
  return queueWrite(fileName, async () => {
    const data = await read(fileName);
    if (!Array.isArray(data)) throw new Error(`${fileName} is not an array`);
    const index = data.findIndex(r => r.id === id);
    if (index === -1) return null;
    const updated = { ...data[index], ...patch };
    data[index] = updated;
    await write(fileName, data);
    return updated;
  });
}

/** Delete a record by id */
async function del(fileName, id) {
  return queueWrite(fileName, async () => {
    const data = await read(fileName);
    if (!Array.isArray(data)) throw new Error(`${fileName} is not an array`);
    const filtered = data.filter(r => r.id !== id);
    await write(fileName, filtered);
  });
}

/** Find a record by id */
async function getById(fileName, id) {
  const data = await read(fileName);
  if (!Array.isArray(data)) return null;
  return data.find(r => r.id === id) || null;
}

/** Generic search using a predicate function */
async function find(fileName, predicate) {
  const data = await read(fileName);
  if (!Array.isArray(data)) return [];
  return data.filter(predicate);
}

export default {
  read,
  write,
  add,
  addIf,
  mutate,
  update,
  delete: del,
  getById,
  find,
  generateId,
};
