import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.ZEEB_DATA_DIR || path.join(here, "..", "data");

export function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJSON(name, value) {
  fs.mkdirSync(path.dirname(path.join(DATA_DIR, name)), { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2) + "\n");
}

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

export function newId(prefix, existing = []) {
  let n = existing.length + 1;
  const ids = new Set(existing.map((x) => x.id));
  while (ids.has(prefix + n)) n++;
  return prefix + n;
}

// One town day lasts this many real minutes (Pino's lasts about three hours).
export const TOWN_DAY_MINUTES = Number(process.env.TOWN_DAY_MINUTES || 180);

export function townClock(epochMs, nowMs) {
  const realMinutes = (nowMs - epochMs) / 60000;
  const townMinutesTotal = (realMinutes / TOWN_DAY_MINUTES) * 1440;
  const day = Math.floor(townMinutesTotal / 1440) + 1;
  const minuteOfDay = Math.floor(townMinutesTotal % 1440);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return {
    day,
    hour,
    minute,
    minuteOfDay,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

// Real hours that pass per town hour, used to scale need decay.
export const realHoursPerTownHour = TOWN_DAY_MINUTES / 60 / 24;

export async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export function log(...args) {
  console.log("[zeeb]", ...args);
}
