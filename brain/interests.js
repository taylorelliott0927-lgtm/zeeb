// What Zeeb keeps coming back to. Each heartbeat he can name what he's into right now.
// Topics he returns to again and again, on different days, can grow into an obsession.
// Nothing here picks the topic for him: it only notices patterns in what he chooses.
import { clamp, round } from "./util.js";

export const emptyInterests = () => ({ topics: [] });

const OBSESSED_AT = 8;     // score needed to become an obsession
const OBSESSION_DAYS = 2;  // ...across at least this many different town days
const FORGET_BELOW = 0.5;
const MAX_TOPICS = 25;

const clean = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9 '-]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

// Called every awake heartbeat with the topic he named (or nothing). Returns events worth posting.
export function noteInterest(interests, topic, day, nowISO, townHours) {
  const events = [];
  // Everything fades slowly unless he keeps returning to it.
  for (const t of interests.topics) t.score = round(Math.max(0, t.score - 0.06 * townHours));
  const name = clean(topic);
  if (name.length >= 3) {
    let t = interests.topics.find((x) => x.name === name || x.name.replace(/s$/, "") === name.replace(/s$/, ""));
    if (!t) {
      t = { name, score: 0, days: [], since: nowISO, obsession: false };
      interests.topics.push(t);
    }
    t.score = round(clamp(t.score + 1, 0, 30), 2);
    t.lastAt = nowISO;
    if (!t.days.includes(day)) t.days = [...t.days, day].slice(-10);
    if (!t.obsession && t.score >= OBSESSED_AT && t.days.length >= OBSESSION_DAYS) {
      t.obsession = true;
      t.obsessedSince = nowISO;
      events.push({ kind: "obsessed", topic: t.name });
    }
  }
  for (const t of interests.topics) {
    if (t.obsession && t.score < OBSESSED_AT / 3) {
      t.obsession = false;
      events.push({ kind: "faded", topic: t.name });
    }
  }
  interests.topics = interests.topics
    .filter((t) => t.score >= FORGET_BELOW || t.obsession)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOPICS);
  return events;
}

export function interestsText(interests) {
  const top = interests.topics.slice(0, 12);
  if (!top.length) return "YOUR INTERESTS: nothing has really grabbed you yet.";
  const obs = top.filter((t) => t.obsession);
  return `YOUR INTERESTS (what you keep coming back to): ${top.map((t) => `${t.name}${t.obsession ? " (you're obsessed with this)" : ""}`).join(", ")}.${obs.length ? " Obsessions pull at you: you think about them a lot and they colour your projects, searches and letters, though you can still do other things." : ""}`;
}
