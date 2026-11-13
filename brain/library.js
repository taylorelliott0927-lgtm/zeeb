// Zeeb's model library: free 3D models (by Kenney, CC0) he can look up by name and use in his builds.
// The list lives in web/models/catalog.json (made by the "Fetch model library" GitHub Action).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "models", "catalog.json");
let cache = null;

export function catalog() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(FILE, "utf8")).models || []; } catch { cache = []; }
  return cache;
}
export const hasLibrary = () => catalog().length > 0;
export const findModel = (id) => catalog().find((m) => m.id === id);

const words = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");

// Look things up the way you'd search a shop catalogue: every word counts, names count most.
export function searchModels(query, limit = 8) {
  const q = words(query).map(stem);
  if (!q.length) return [];
  return catalog().map((m) => {
    const name = words(m.name).map(stem), tags = m.tags.map(stem);
    let score = 0;
    for (const w of q) {
      if (name.includes(w)) score += 3;
      else if (tags.includes(w)) score += 2;
      else if (name.some((n) => n.startsWith(w) || w.startsWith(n))) score += 1;
    }
    return { m, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.m.name.length - b.m.name.length).slice(0, limit).map((x) => x.m);
}

// How a model is described to him: id, name and its real size, so he can pick a sensible height.
export const describeModel = (m) => `${m.id}: ${m.name} (about ${+(m.max[0] - m.min[0]).toFixed(1)} wide, ${+(m.max[1] - m.min[1]).toFixed(1)} tall as made)`;

// Turn a model piece from his design into something safe to draw.
export function cleanModelPart(p) {
  const m = findModel(String(p?.model || ""));
  if (!m) return null;
  const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  return { model: m.id, name: m.name, x: n(p.x, -6, 6, 0), y: n(p.y, 0, 8, 0), z: n(p.z, -6, 6, 0), height: n(p.height, 0.1, 8, 1), turn_degrees: n(p.turn_degrees, -360, 360, 0), min: m.min, max: m.max };
}
