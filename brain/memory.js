// A deliberately small memory. New memories only get in by pushing weaker ones out.
import { clamp, newId, round } from "./util.js";

export const LIMITS = { short: 14, long: 22, beliefs: 12 };

export function emptyMemory() {
  return { memories: [], beliefs: [] };
}

export function fade(mem, ticks = 1) {
  for (const m of mem.memories) m.strength = round(clamp(m.strength - (m.term === "long" ? 0.004 : 0.015) * ticks, 0, 1));
}

export function remember(mem, text, importance = 0.5, at = new Date().toISOString()) {
  text = String(text || "").trim().slice(0, 220);
  if (text.length < 4) return null;
  const same = mem.memories.find((m) => m.text.toLowerCase() === text.toLowerCase());
  if (same) {
    recall(mem, same.id);
    return same;
  }
  const item = { id: newId("m", mem.memories), text, strength: round(clamp(0.35 + importance * 0.5)), recalls: 0, term: "short", at };
  mem.memories.push(item);
  squeeze(mem);
  return mem.memories.includes(item) ? item : null;
}

export function recall(mem, id) {
  const m = mem.memories.find((x) => x.id === id);
  if (!m) return;
  m.recalls += 1;
  m.strength = round(clamp(m.strength + 0.15));
  if (m.term === "short" && (m.recalls >= 3 || m.strength >= 0.9)) m.term = "long";
  squeeze(mem);
}

export function forget(mem, id) {
  mem.memories = mem.memories.filter((m) => m.id !== id);
}

export function promote(mem, id) {
  const m = mem.memories.find((x) => x.id === id);
  if (m) m.term = "long";
  squeeze(mem);
}

function squeeze(mem) {
  for (const term of ["short", "long"]) {
    const list = mem.memories.filter((m) => m.term === term).sort((a, b) => a.strength - b.strength);
    while (list.length > LIMITS[term]) {
      const weakest = list.shift();
      mem.memories = mem.memories.filter((m) => m !== weakest);
    }
  }
}

export function believe(mem, text, delta = 1) {
  text = String(text || "").trim().slice(0, 160);
  if (text.length < 4) return;
  const b = mem.beliefs.find((x) => x.text.toLowerCase() === text.toLowerCase());
  if (b) b.evidence = Math.max(0, b.evidence + delta);
  else if (delta > 0) mem.beliefs.push({ id: newId("b", mem.beliefs), text, evidence: delta });
  mem.beliefs = mem.beliefs.filter((x) => x.evidence > 0).sort((a, b) => b.evidence - a.evidence).slice(0, LIMITS.beliefs);
}

export function strongest(mem, n = 10) {
  return [...mem.memories].sort((a, b) => b.strength - a.strength).slice(0, n);
}
