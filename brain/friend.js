// A friend Zeeb can build, only if he decides he wants one (start_friend -> build_friend -> they wake up).
// When the friend is finished, Zeeb copies his own blueprint into them and decides who they are.
// After that the friend lives their own life on every heartbeat: needs, moods, memories, choices, a diary.
import { ACTIONS, NEEDS, PLACES, BOLT_NAMES, PARTS, inHours, placeFor } from "./world.js";
import { askJSON } from "./llm.js";
import { chance, clamp, newId, pick, round } from "./util.js";
import * as M from "./memory.js";

export const FRIEND_ACTIONS = ["nap_dock", "drink_oil", "scavenge", "cantina_band", "chat_patrons", "watch_suns", "stargaze", "wander", "hang_out", "help_dart", "go_to_sleep"];

export const emptyFriend = () => ({ stage: "none", project: null, sheet: null, state: null, mem: { memories: [], beliefs: [] }, diary: [], promises: [], bornAt: null });

const HEX = /^#[0-9a-f]{6}$/i;

// ---------- building ----------
export function startFriend(friend, idea, nowISO) {
  friend.stage = "building";
  friend.project = { progress: 0, idea: String(idea || "").slice(0, 200), started: nowISO, log: [] };
}

export function buildStep(friend, works, detail, nowISO) {
  const part = works.stash.pop();
  const gain = part ? 10 + Math.floor(Math.random() * 6) : 4 + Math.floor(Math.random() * 3);
  friend.project.progress = Math.min(100, friend.project.progress + gain);
  const note = (detail || "worked on the frame") + (part ? ` (used ${part.name}, ${part.what})` : "");
  friend.project.log.unshift({ progress: friend.project.progress, note, at: nowISO });
  friend.project.log = friend.project.log.slice(0, 30);
  return { done: friend.project.progress >= 100, note };
}

export async function designFriend(zeebSheet, friend, memories) {
  const sys = `You are ${zeebSheet.name}, ${zeebSheet.kind}. ${zeebSheet.core}\nVoice: ${zeebSheet.voice}\nKeep everything friendly and suitable for all ages. Reply with JSON only.`;
  const user = `You've just finished building a friend out of scrap in Hangar Bay 3. Your first idea for them was: "${friend.project?.idea || "someone to keep me company"}".
Now you copy your own blueprint into them, the same kind of mind you run on, and decide who they are. They should be their own person, not a copy of you.
Things you remember: ${memories.map((m) => m.text).join("; ") || "(nothing much)"}
Return JSON:
{"name": "their name", "kind": "one line on what they are and look like", "core": "who they are, 2 sentences",
 "traits": ["4 to 6 traits"], "values": ["2 or 3"], "fears": ["2 or 3"], "quirks": ["2 to 4"],
 "voice": "how they talk", "colors": {"body": "#rrggbb", "eye": "#rrggbb"},
 "first_words": "the first thing they say when they wake up", "why": "why you made them this way, in your voice"}`;
  const r = await askJSON(sys, user, { temperature: 1.0 });
  const fallback = {
    name: pick(["Pip", "Tink", "Nova", "Rivet", "Juno", "Sprock"]), kind: "a small round helper bot with one big curious eye",
    core: "Gentle and patient, likes listening more than talking. Thinks Zeeb's ideas are the best ideas.",
    traits: ["patient", "curious about bugs and beetles", "laughs at Zeeb's jokes", "a bit shy with strangers"],
    values: ["looking after Zeeb", "quiet mornings"], fears: ["loud freighters", "being switched off"],
    quirks: ["hums when thinking", "collects shiny washers"], voice: "Soft, short sentences. Says 'oh!' a lot.",
    colors: { body: "#6fb3a6", eye: "#ffd36b" }, first_words: "oh! hello. are you the one who built me?", why: "everyone needs someone who listens.",
  };
  const s = { ...fallback, ...(r || {}) };
  const list = (x, n) => (Array.isArray(x) ? x : []).map(String).filter(Boolean).slice(0, n);
  return {
    name: String(s.name).slice(0, 24) || fallback.name,
    kind: String(s.kind).slice(0, 160),
    core: String(s.core).slice(0, 400),
    traits: list(s.traits, 6).length ? list(s.traits, 6) : fallback.traits,
    values: list(s.values, 3).length ? list(s.values, 3) : fallback.values,
    fears: list(s.fears, 3).length ? list(s.fears, 3) : fallback.fears,
    quirks: list(s.quirks, 4).length ? list(s.quirks, 4) : fallback.quirks,
    voice: String(s.voice).slice(0, 200),
    colors: { body: HEX.test(s.colors?.body) ? s.colors.body : fallback.colors.body, eye: HEX.test(s.colors?.eye) ? s.colors.eye : fallback.colors.eye },
    firstWords: String(s.first_words || fallback.first_words).slice(0, 200),
    why: String(s.why || "").slice(0, 300),
    added: { traits: [], quirks: [] },
  };
}

export function wakeFriend(friend, sheet, nowISO) {
  friend.stage = "alive";
  friend.sheet = sheet;
  friend.bornAt = nowISO;
  friend.state = {
    mood: 0.4, energy: 0.5, needs: { charge: 0.1, oil: 0.2, curiosity: 0.6, company: 0.2, craft: 0.3 },
    place: "hangar", action: null, doing: "blinking awake on the workbench", thought: "", feeling: "brand new", say: sheet.firstWords,
    recent: [], busyUntil: null, asleep: false, lastTick: Date.parse(nowISO),
  };
}

// ---------- living ----------
function friendSystem(f, zeebName) {
  const s = f.sheet;
  const all = (k) => [...(s[k] || []), ...((s.added || {})[k] || [])].map((x) => `- ${x}`).join("\n");
  return `You are ${s.name}, ${s.kind}. ${zeebName} built you out of scrap at Rustwell Outpost on the desert moon Kessa-9, using a copy of his own blueprint.
WHO YOU ARE: ${s.core}
TRAITS:\n${all("traits")}\nVALUES:\n${all("values")}\nFEARS:\n${all("fears")}\nQUIRKS:\n${all("quirks")}
VOICE: ${s.voice}
You choose your own actions for your own reasons. Needs grow over time and pull your mood around. Repeating yourself gets dull.
Stay in character, never mention being an AI. Keep everything friendly and suitable for all ages. Reply with JSON only.`;
}

export async function friendDecide(f, ctx) {
  const st = f.state;
  const list = ctx.available.map((id) => `- ${id}: ${id === st.action ? "(keep going) " : ""}${ACTIONS[id].about.replace(/\byour ship\b/, "his ship")}`).join("\n");
  const user = `Town day ${ctx.clock.day}, ${ctx.clock.label}. You're at ${PLACES[st.place]?.name || "the outpost"}. Weather: ${ctx.weather?.kind || "clear"}.
Mood ${st.mood.toFixed(2)}, energy ${st.energy.toFixed(2)}.
Needs (0 met, 1 pressing): ${Object.entries(st.needs).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(", ")}
You did recently: ${st.recent.slice(0, 6).map((r) => r.id).join(", ") || "you just woke up for the first time"}
ZEEB (who built you): ${ctx.zeeb.doing} at ${PLACES[ctx.zeeb.place]?.name || "the outpost"}. Feels: ${ctx.zeeb.feeling}. ${ctx.zeeb.say ? `He just said: "${ctx.zeeb.say}"` : ""}${ctx.zeebInvited ? " He wants to hang out with you right now." : ""}
Your promises to Zeeb: ${f.promises.map((p) => `${p.id}: ${p.what}`).join("; ") || "none"}
Things you remember: ${M.strongest(f.mem, 8).map((m) => `${m.id}: ${m.text}`).join("; ") || "nothing yet"}

ACTIONS YOU CAN TAKE NOW
${list}

Return JSON:
{"action": "an id", "minutes": 45, "why": "...", "thought": "...", "feeling": "a few words", "say": "something you say, or empty", "detail": "",
 "remember": [{"text": "...", "importance": 0.5}], "diary": null, "promise_to_zeeb": null, "kept_promise": null}
minutes: how long you want to do it, in town minutes (10 to 720). diary: {"title","text"} if you want to write in your diary, any time.
promise_to_zeeb: {"what": "...", "hours": 6} if you promise Zeeb something. kept_promise: a promise id you just kept, or null.`;
  return askJSON(friendSystem(f, "Zeeb"), user, { temperature: 1.0 });
}

function ruleFriend(f, available) {
  const n = f.state.needs;
  const best = available.map((id) => {
    let sc = 0;
    for (const [k, v] of Object.entries(ACTIONS[id].effects)) sc += -v * (n[k] + 0.1);
    if (id === "go_to_sleep") sc += n.charge * 1.4;
    return [id, sc + Math.random() * 0.25];
  }).sort((a, b) => b[1] - a[1])[0]?.[0] || "wander";
  return { action: best, why: "felt like it", thought: "", feeling: f.state.mood > 0.2 ? "content" : "a little flat", say: "" };
}

// One heartbeat for the friend. post(kind, text, extra) writes to the shared feed.
export async function friendTick(f, ctx) {
  if (f.stage !== "alive") return;
  const st = f.state;
  const nowMs = ctx.nowMs, nowISO = new Date(nowMs).toISOString(), name = f.sheet.name;
  const townHours = Math.min(8, Math.max(0, (nowMs - (st.lastTick || nowMs)) / 3600000 / ctx.realHoursPerTownHour));
  st.lastTick = nowMs;
  for (const [k, def] of Object.entries(NEEDS)) {
    let rise = def.rise * 0.9 * townHours;
    if (st.asleep) rise = k === "charge" ? -0.3 * townHours : rise * 0.15;
    st.needs[k] = round(clamp(st.needs[k] + rise));
  }
  M.fade(f.mem, Math.max(1, Math.round(townHours)));
  const settle = () => {
    const x = st.needs;
    const pressure = (x.charge + x.oil + x.curiosity * 1.2 + x.company * 1.3 + x.craft) / 5.5;
    st.mood = round(clamp(st.mood + 0.35 * (0.55 - 1.1 * pressure - st.mood), -1, 1));
    st.energy = round(clamp(st.energy + 0.5 * (0.8 - 1.3 * x.charge - 0.6 * x.oil - st.energy), -1, 1));
  };
  const night = ctx.clock.hour >= 23 || ctx.clock.hour < 5;
  if (st.asleep) {
    if (night && st.needs.charge > 0.03) return settle();
    st.asleep = false; st.action = null; st.doing = "just woke up";
    ctx.post("felt", `${name} woke up${night ? " in the middle of the night, fully charged" : ""}.`);
  } else if (st.needs.charge > 0.9) {
    Object.assign(st, { asleep: true, action: "sleep", doing: "asleep in the charging dock", place: "hangar", say: "" });
    ctx.post("did", `${name} dozed off in the charging dock`, { why: null, ok: true });
    return settle();
  }

  const urgent = ctx.zeebInvited || Math.max(...Object.values(st.needs)) > 0.85;
  if (st.busyUntil && nowMs < Date.parse(st.busyUntil) && ACTIONS[st.action] && !urgent) return settle();

  const recentBlock = st.recent.slice(0, 3).map((r) => r.id).filter((x) => x !== st.action);
  const available = FRIEND_ACTIONS.filter((id) => {
    const a = ACTIONS[id];
    if (!a || recentBlock.includes(id)) return false;
    if (!inHours(a.hours, ctx.clock.hour)) return false;
    if (ctx.weather?.kind === "sandstorm" && a.place !== "any" && PLACES[a.place]?.outdoor) return false;
    return true;
  });
  let d = await friendDecide(f, { ...ctx, available });
  if (!d || !available.includes(d.action)) d = { ...ruleFriend(f, available), ...(d && available.includes(d.action) ? d : {}) };

  const a = ACTIONS[d.action];
  const continuing = d.action === st.action;
  const repeats = continuing ? 0 : st.recent.slice(0, 8).filter((r) => r.id === d.action).length;
  if (!continuing) st.mood = round(clamp(st.mood + (repeats ? -0.07 * repeats : 0.01), -1, 1));
  for (const [k, v] of Object.entries(a.effects)) st.needs[k] = round(clamp(st.needs[k] + v));
  st.mood = round(clamp(st.mood + (a.mood || 0), -1, 1));

  const place = d.action === "hang_out" ? ctx.zeeb.place : placeFor(d.action, st);
  const text = `${name} is ${a.doing.replace(/\bhis friend\b/, "Zeeb")}`;
  if (d.action === "scavenge" && chance(0.6)) {
    const part = { name: pick(BOLT_NAMES), what: pick(PARTS), at: nowISO };
    ctx.works.stash.unshift(part);
    ctx.post("noticed", `${name} found ${part.what} and gave it to Zeeb.`);
  }
  if (d.action === "help_dart") {
    const dart = ctx.works.dart;
    dart.progress = Math.min(99, dart.progress + 2 + Math.floor(Math.random() * 3));
    ctx.post("mind", `${name} helped with ${dart.name} (${dart.progress}% built).`, { change: "helped", about: "piece" });
  }
  if (d.action === "go_to_sleep") {
    Object.assign(st, { asleep: true, action: "sleep", doing: "asleep in the charging dock", place: "hangar", say: "" });
    ctx.post("did", `${name} plugged in to sleep`, { why: d.why || null, ok: true });
  } else {
    ctx.post("did", text + (d.say ? `: "${String(d.say).slice(0, 160)}"` : ""), { why: d.why || null, ok: true, who: "friend" });
    const townMin = clamp(Math.round(Number(d.minutes) || a.minutes || 30), 10, 720);
    st.busyUntil = new Date(nowMs + (townMin / 60) * ctx.realHoursPerTownHour * 3600000).toISOString();
    st.place = place; st.action = d.action; st.doing = a.doing.replace(/\bhis friend\b/, "Zeeb");
    st.say = String(d.say || "").slice(0, 200);
  }
  st.thought = String(d.thought || st.thought || "").slice(0, 300);
  st.feeling = String(d.feeling || st.feeling || "").slice(0, 120);
  st.recent.unshift({ id: d.action, at: nowISO });
  st.recent = st.recent.slice(0, 12);
  for (const m of d.remember || []) M.remember(f.mem, m.text, Number(m.importance ?? 0.5), nowISO);
  if (d.diary?.text) {
    f.diary.unshift({ day: ctx.clock.day, time: ctx.clock.label, title: String(d.diary.title || "a note").slice(0, 120), text: String(d.diary.text).slice(0, 4000), at: nowISO });
    f.diary = f.diary.slice(0, 300);
    ctx.post("mind", `${name} wrote in their diary: "${String(d.diary.title || "a note").slice(0, 80)}"`, { change: "wrote", about: "diary" });
  }
  if (d.promise_to_zeeb?.what && f.promises.length < 6 && !f.promises.some((p) => p.what.toLowerCase() === String(d.promise_to_zeeb.what).toLowerCase())) {
    const hours = clamp(Number(d.promise_to_zeeb.hours) || 6, 1, 48);
    f.promises.push({ id: newId("fp", f.promises), what: String(d.promise_to_zeeb.what).slice(0, 140), dueAt: new Date(nowMs + hours * 3600000).toISOString(), at: nowISO });
    ctx.post("mind", `${name} promised Zeeb: ${String(d.promise_to_zeeb.what).slice(0, 140)}`, { change: "promised", about: "promise" });
  }
  if (d.kept_promise) {
    const p = f.promises.find((x) => x.id === d.kept_promise);
    if (p) { f.promises = f.promises.filter((x) => x !== p); ctx.post("felt", `${name} did what they told Zeeb they would (${p.what}).`); }
  }
  for (const p of f.promises.filter((x) => Date.parse(x.dueAt) < nowMs)) ctx.post("felt", `${name} didn't get round to: ${p.what}.`);
  f.promises = f.promises.filter((x) => Date.parse(x.dueAt) >= nowMs);
  settle();
}

// What Zeeb's prompt says about his friend.
export function friendText(f) {
  if (!f || f.stage === "none") return "FRIEND: you don't have a friend bot. If you ever wanted company, you could build one out of scrap with a copy of your own blueprint (start_friend). Only if you want to.";
  if (f.stage === "building") return `FRIEND: you're building a friend out of scrap: ${f.project.progress}% done. Your idea: "${f.project.idea}". Last step: ${f.project.log[0]?.note || "just started"}.`;
  const s = f.state;
  return `YOUR FRIEND ${f.sheet.name} (${f.sheet.kind}): ${f.sheet.core}
Right now they're ${s.asleep ? "asleep" : s.doing} at ${PLACES[s.place]?.name || "the outpost"}, feeling ${s.feeling || "fine"}.${s.say ? ` They just said: "${s.say}"` : ""}
Their promises to you: ${f.promises.map((p) => p.what).join("; ") || "none"}`;
}
