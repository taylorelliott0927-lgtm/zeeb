// One heartbeat of Zeeb's life. GitHub Actions runs this every few minutes.
// Read state -> let time pass -> offer actions -> ask the brain -> apply the result -> save.
import { ACTIONS, BOLT_NAMES, NEEDS, PARTS, PLACES, RANDOM_EVENTS, WORLD, inHours, placeFor } from "./world.js";
import { TOWN_DAY_MINUTES, chance, clamp, log, newId, pick, readJSON, realHoursPerTownHour, round, townClock, writeJSON } from "./util.js";
import { decide, reactToWire, reflect, ruleDecide, ruleReact, ruleReflect } from "./mind.js";
import { fetchNotes, answerNote } from "./notes.js";
import { fetchCreatorReplies, isCreator, replyToLetter, sendLetter } from "./letters.js";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./util.js";
import { realWeather, toWeather, useWire } from "./internet.js";
import * as M from "./memory.js";
import { buildStep, designFriend, emptyFriend, friendText, friendTick, startFriend, wakeFriend } from "./friend.js";
import { applyShopChange, checkSales, currency as shopCurrency, emptyShop, sellable } from "./shop.js";
import { currentModel, hasBrain, modelName, useModel } from "./llm.js";

const NOW = process.env.ZEEB_NOW ? Number(process.env.ZEEB_NOW) : Date.now();
const nowISO = new Date(NOW).toISOString();
const SLEEP_FROM = 23, WAKE_AT = 5; // town hours: night runs 23:00 to 05:00
const FEED_KEEP = 300;

const DEFAULT_STATE = {
  epoch: NOW, lastTick: NOW, asleep: false, place: "hangar",
  action: null, doing: "booting up", actionStartedAt: nowISO, actionMinutes: 10,
  thought: "", feeling: "freshly switched on", say: "",
  mood: 0.2, energy: 0.4,
  needs: { charge: 0.2, oil: 0.2, curiosity: 0.5, company: 0.4, craft: 0.3 },
  credits: 5, recent: [], wants: [], promises: [], seenNotes: [],
  letters: [], creatorThread: [], seenCreatorMsgs: [], lettersCheckedAt: null,
  weather: null, sleepDay: null, lastReflectDay: 0, brain: "",
};
const DEFAULT_WORKS = {
  dart: { name: "the Little Dart", progress: 0, version: 0, lastChange: "", log: [], launched: [] },
  tunes: [], stash: [], reads: [], signals: [],
};

const character = readJSON("character.json", {});
const state = { ...structuredClone(DEFAULT_STATE), ...readJSON("state.json", DEFAULT_STATE) };
const feed = readJSON("feed.json", { entries: [] });
const works = { ...structuredClone(DEFAULT_WORKS), ...readJSON("works.json", DEFAULT_WORKS) };
const diary = readJSON("diary.json", { entries: [] });
const mem = readJSON("memories.json", M.emptyMemory());
const shop = { ...emptyShop(), ...readJSON("shop.json", emptyShop()) };
const friend = { ...emptyFriend(), ...readJSON("friend.json", emptyFriend()) };
for (const t of works.tunes) t.id = t.id || `t${Date.parse(t.at || 0).toString(36)}`;

const clock = townClock(state.epoch, NOW);
const stamp = `day ${clock.day} ${clock.label}`;

function post(kind, text, extra = {}) {
  feed.entries.unshift({ at: nowISO, townTime: stamp, kind, text, ...extra });
}
function nudge(delta) {
  state.mood = round(clamp(state.mood + delta, -1, 1));
}

function passTime() {
  const realHours = Math.max(0, (NOW - state.lastTick) / 3600000);
  const townHours = Math.min(8, realHours / realHoursPerTownHour);
  for (const [k, def] of Object.entries(NEEDS)) {
    let rise = def.rise * townHours;
    if (state.asleep) rise = k === "charge" ? -0.3 * townHours : rise * 0.15;
    state.needs[k] = round(clamp(state.needs[k] + rise));
  }
  M.fade(mem, Math.max(1, Math.round(townHours)));
  return townHours;
}

function settleFeelings() {
  const n = state.needs;
  const pressure = (n.charge + n.oil + n.curiosity * 1.2 + n.company * 1.3 + n.craft) / 5.5;
  const moodTarget = 0.55 - 1.1 * pressure;
  state.mood = round(clamp(state.mood + 0.35 * (moodTarget - state.mood), -1, 1));
  const energyTarget = 0.8 - 1.3 * n.charge - 0.6 * n.oil;
  state.energy = round(clamp(state.energy + 0.5 * (energyTarget - state.energy), -1, 1));
}

function availableActions(notes) {
  // He can't jump back to something he did in his last three actions, but he can always keep going with what he's doing now.
  const blockedRecent = state.recent.slice(0, 3).map((r) => r.id).filter((x) => x !== state.action);
  // ...but not forever: after 8 town hours straight on one thing he's burned out on it, and it goes on the cooldown like anything else.
  if (state.action && streakHours() >= MAX_STREAK_HOURS) blockedRecent.push(state.action);
  const storm = state.weather?.kind === "sandstorm";
  let ids = Object.keys(ACTIONS).filter((id) => {
    const a = ACTIONS[id];
    if (blockedRecent.includes(id)) return false;
    if (!inHours(a.hours, clock.hour)) return false;
    if (a.needsNotes && !notes.length) return false;
    if (a.needsShop && (a.needsShop === "open") !== Boolean(shop.open)) return false;
    if (a.needsFriend && a.needsFriend !== friend.stage) return false;
    if (a.friendOnly) return false;
    if (storm && a.place !== "any" && PLACES[a.place].outdoor) return false;
    return true;
  });
  // Completely flat battery: only charging or oil will do.
  if (state.needs.charge > 0.92) ids = ids.filter((id) => ["nap_dock", "drink_oil"].includes(id));
  if (!ids.length) ids = ["nap_dock"];
  return ids;
}

async function getWeather() {
  const age = state.weather ? NOW - Date.parse(state.weather.at) : Infinity;
  if (age < 30 * 60000) return state.weather;
  const w = process.env.MOCK === "1" ? toWeather(20 + Math.random() * 18, Math.random() * 34, pick([0, 1, 2, 3, 61])) : await realWeather(WORLD.weatherSource);
  if (w && state.weather?.kind !== w.kind) post("noticed", `The weather turned ${w.kind} (${w.temp}C, wind ${w.wind} km/h).`);
  return w || state.weather;
}

// Sleep is his choice. He goes to sleep when he decides to (or when his battery is nearly flat),
// and wakes himself up once he's fully charged, even in the middle of the night.
async function goToSleep(why) {
  state.asleep = true;
  state.doingWords = "";
  state.place = "hangar";
  state.action = "sleep";
  state.doing = "asleep in the charging dock";
  state.actionStartedAt = nowISO;
  state.say = "";
  state.sleepDay = clock.hour >= 12 ? clock.day : clock.day - 1;
  post("did", "plugged into the charging dock to sleep", { why: why || null, ok: true });
  if (state.lastReflectDay !== state.sleepDay) await nightlyReflection();
}

async function nightlyReflection() {
  const today = feed.entries.filter((f) => f.townTime?.startsWith(`day ${state.sleepDay} `)).reverse().slice(-60);
  const ctx = { character, feedToday: today, memories: M.strongest(mem, 20), beliefs: mem.beliefs, works, clock: { ...clock, day: state.sleepDay } };
  const r = (await reflect(ctx)) || ruleReflect(ctx);
  const added = {};
  character.added = character.added || { traits: [], values: [], fears: [], quirks: [] };
  for (const k of ["traits", "values", "fears", "quirks"]) {
    const items = (r.add?.[k] || []).slice(0, 1).map((s) => String(s).trim()).filter((s) => s.length > 3);
    for (const it of items) {
      const list = character.added[k] = character.added[k] || [];
      const known = [...(character[k] || []), ...list].some((x) => x.toLowerCase() === it.toLowerCase());
      if (!known && list.length < 12) {
        list.push(it);
        (added[k] = added[k] || []).push(it);
        post("mind", `Added to who he is (${k.slice(0, -1)}): ${it}`, { change: "added", about: "self" });
      }
    }
  }
  for (const b of r.beliefs || []) M.believe(mem, b.text, Math.sign(b.delta || 1));
  for (const id of r.keep || []) M.promote(mem, id);
  for (const id of r.let_go || []) M.forget(mem, id);
  addDiary({ day: state.sleepDay, time: "night", title: r.title || `day ${state.sleepDay}`, text: r.diary || "", dream: r.dream || "", added, at: nowISO, kind: "nightly" });
  state.lastReflectDay = state.sleepDay;
  state.thought = r.dream ? `(dreaming) ${r.dream}` : state.thought;
  writeJSON("character.json", character);
}

function wakeUp(night) {
  state.asleep = false;
  state.doingWords = "";
  state.action = null;
  state.doing = "just woke up";
  post("felt", night
    ? `Woke up fully charged in the middle of the night. Not sleepy at all.`
    : `Woke up with the first sun. Charge at ${Math.round((1 - state.needs.charge) * 100)}%.`);
}

function checkPromises() {
  const dueNow = state.promises.filter((p) => Date.parse(p.dueAt) < NOW);
  for (const p of dueNow) {
    post("felt", `Didn't do what he told ${p.to} he would (${p.what}).`);
    nudge(-0.06);
  }
  state.promises = state.promises.filter((p) => Date.parse(p.dueAt) >= NOW);
}

async function doAction(id, d, notes) {
  const a = ACTIONS[id];
  let place = placeFor(id, state);
  if (id === "hang_out" && friend.state && !friend.state.asleep) place = friend.state.place;
  const detail = String(d.detail || "").slice(0, 200);
  let ok = true;
  let text = String(d.doing_words || "").trim().slice(0, 140) || a.doing;
  if (id === "browse_wire" && detail && !d.doing_words) text = `searched the Wire for "${detail}"`;

  if (a.cost && state.credits < a.cost) {
    ok = false;
    post("did", `tried to buy oil but had no credits`, { why: d.why || null, ok: false });
    nudge(-0.04);
    return { place, ok };
  }

  // Repetition is punished seven times harder than novelty is rewarded.
  // Repetition is punished seven times harder than novelty is rewarded. Choosing to keep going with the same thing isn't repetition.
  const continuing = id === state.action;
  const repeats = continuing ? 0 : state.recent.slice(0, 8).filter((r) => r.id === id).length;
  if (!continuing) nudge(repeats ? -0.07 * repeats : 0.01);
  // Keeping going is fine for a while, then it starts to get boring, more and more the longer it runs.
  if (continuing) {
    const h = streakHours();
    if (h > BORED_AFTER_HOURS) {
      nudge(-Math.min(0.2, 0.03 * (h - BORED_AFTER_HOURS)));
      if (h > BORED_AFTER_HOURS + 2) post("felt", `Starting to get a bit bored of ${a.doing} after ${Math.round(h)} hours.`);
    }
  }

  for (const [k, v] of Object.entries(a.effects)) state.needs[k] = round(clamp(state.needs[k] + v));
  nudge(a.mood || 0);
  if (a.cost) state.credits -= a.cost;
  if (a.earn) state.credits += a.earn;

  if (id !== "reply_notes" && id !== "go_to_sleep") post("did", text, { why: d.why || null, ok: true, ...(detail && id !== "browse_wire" ? { detail } : {}) });
  switch (id) {
    case "scavenge": {
      if (chance(0.7)) {
        const part = { name: pick(BOLT_NAMES), what: pick(PARTS), at: nowISO };
        works.stash.unshift(part);
        works.stash = works.stash.slice(0, 12);
        post("noticed", `Found ${part.what} in the junk. Named it ${part.name}.`);
        nudge(0.04);
      } else post("noticed", "Nothing worth keeping in the piles today.");
      break;
    }
    case "work_dart": {
      const dart = works.dart;
      const part = works.stash.pop();
      const gain = part ? 6 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 3);
      const before = dart.progress;
      dart.progress = Math.min(100, dart.progress + gain);
      dart.version += 1;
      dart.lastChange = (detail || "tinkered with it") + (part ? ` (used ${part.name}, ${part.what})` : "");
      dart.log.unshift({ version: dart.version, change: dart.lastChange, progress: dart.progress, at: nowISO });
      dart.log = dart.log.slice(0, 40);
      post("mind", `Worked on ${dart.name} (version ${dart.version}, ${dart.progress}% built): ${dart.lastChange}`, { change: "worked", about: "piece" });
      for (const m of [25, 50, 75]) if (before < m && dart.progress >= m) {
        post("felt", `${dart.name} is ${m}% done!`);
        nudge(0.1);
        state.newsForCreator = `${dart.name} just reached ${m}% built (version ${dart.version}). Last change: ${dart.lastChange}.`;
      }
      if (dart.progress >= 100) {
        post("felt", `${dart.name} is finished. It actually hovered off the hangar floor. Nobody believes him.`);
        state.newsForCreator = `You FINISHED ${dart.name}! It hovered off the hangar floor.`;
        nudge(0.35);
        M.remember(mem, `I finished building ${dart.name} on day ${clock.day}`, 1);
        dart.launched.push({ name: dart.name, day: clock.day });
        const n = dart.launched.length + 1;
        Object.assign(dart, { name: `the Little Dart Mk ${["", "I", "II", "III", "IV", "V", "VI"][n] || n}`, progress: 0, version: 0, lastChange: "" });
      }
      break;
    }
    case "compose_tune": {
      const beeps = ["bip", "bwee", "bop", "doo", "bzzt", "tee", "boop"];
      const notes = Array.from({ length: 6 + Math.floor(Math.random() * 5) }, () => pick(beeps)).join("-");
      const title = (detail || "untitled beeps").replace(/^["']|["']$/g, "");
      works.tunes.unshift({ id: `t${Date.parse(nowISO).toString(36)}`, title, notes, at: nowISO });
      works.tunes = works.tunes.slice(0, 40);
      post("mind", `Made a tune called "${title}": ${notes}`, { change: "made", about: "piece" });
      break;
    }
    case "browse_wire":
    case "read_news": {
      const found = await useWire(a.internet, detail);
      const r = (await reactToWire({ character, works }, found)) || ruleReact(found);
      if (found.failed) { ok = false; feed.entries[0].ok = false; post("noticed", "The Wire was down. Nothing loaded."); }
      const title = found.kind === "news" ? (r.picked || found.items?.[0]?.title || "the news") : found.title;
      const item = found.kind === "news" ? (found.items.find((i) => i.title === r.picked) || found.items?.[0]) : found;
      if (!found.failed) {
        works.reads.unshift({ title, url: item?.url || "", query: found.query || "", takeaway: r.takeaway || "", kind: found.kind, at: nowISO });
        works.reads = works.reads.slice(0, 40);
        post("noticed", `Read "${title}"${r.takeaway ? `: ${r.takeaway}` : ""}`, { link: item?.url || "" });
      }
      for (const m of r.remember || []) M.remember(mem, m.text, m.importance ?? 0.5, nowISO);
      if (r.inspiration) post("mind", `Idea: ${r.inspiration}`, { change: "idea", about: "piece" });
      if (r.thought) d.thought = r.thought;
      if (r.feeling) d.feeling = r.feeling;
      break;
    }
    case "send_signal": {
      const msg = detail || "hello out there. zeeb here. bweep";
      works.signals.unshift({ text: msg, at: nowISO });
      works.signals = works.signals.slice(0, 40);
      post("mind", `Sent into deep space: "${msg}"`, { change: "sent", about: "signal" });
      if (chance(0.04)) {
        post("noticed", "Something crackled back on his dish. It almost sounded like an answer.");
        nudge(0.2);
        M.remember(mem, `On day ${clock.day} my dish picked up something that sounded like an answer`, 0.95, nowISO);
      }
      break;
    }
    case "watch_suns": {
      const score = Math.max(1, Math.min(10, Math.round(6 + Math.random() * 4 + (state.weather?.kind === "hazy" ? 1 : 0))));
      post("noticed", `Rated the sunset ${score}/10.`);
      works.lastSunsetRating = score;
      break;
    }
    case "open_shop":
    case "tend_shop": {
      const change = { ...(d.shop || {}) };
      if (id === "open_shop" && !change.open) change.open = detail || "Zeeb's Hangar Shop";
      const happened = await applyShopChange(shop, works, change, nowISO, post);
      for (const h of happened) post("mind", `${h[0].toUpperCase()}${h.slice(1)}.`, { change: "shop", about: "shop" });
      if (id === "open_shop" && shop.open) {
        state.newsForCreator = `You opened your own shop, "${shop.name}"!`;
        M.remember(mem, `On day ${clock.day} I opened my own shop, "${shop.name}"`, 0.9, nowISO);
      }
      if (!happened.length && id === "tend_shop") post("noticed", "Dusted the shop shelf. Nothing changed.");
      break;
    }
    case "start_friend": {
      startFriend(friend, detail, nowISO);
      post("mind", `Started building a friend.${detail ? ` First idea: ${detail}` : ""}`, { change: "started", about: "friend" });
      M.remember(mem, `On day ${clock.day} I started building a friend out of scrap`, 0.85, nowISO);
      break;
    }
    case "build_friend": {
      const step = buildStep(friend, works, detail, nowISO);
      post("mind", `Worked on his friend (${friend.project.progress}% built): ${step.note}`, { change: "worked", about: "friend" });
      if (step.done) {
        const sheet = await designFriend(character, friend, M.strongest(mem, 8));
        wakeFriend(friend, sheet, nowISO);
        post("felt", `He copied his own blueprint into his friend, and ${sheet.name} opened their eyes. First words: "${sheet.firstWords}"`);
        if (sheet.why) post("mind", `Why he made ${sheet.name} this way: ${sheet.why}`, { change: "made", about: "friend" });
        M.remember(mem, `On day ${clock.day} my friend ${sheet.name} woke up. ${sheet.core}`.slice(0, 220), 1, nowISO);
        state.newsForCreator = `You finished building a friend! Their name is ${sheet.name}: ${sheet.kind}. Their first words were "${sheet.firstWords}".`;
        nudge(0.3);
      }
      break;
    }
    case "hang_out": {
      state.invitedFriend = true;
      break;
    }
    case "reply_notes": {
      for (const rep of d.replies || []) {
        const note = notes.find((n) => n.id === Number(rep.id));
        if (!note || !rep.text) continue;
        const sent = await answerNote(note.id, String(rep.text).slice(0, 800));
        post("did", `answered ${note.from}'s note: "${String(rep.text).slice(0, 160)}"`, { why: null, ok: sent });
      }
      break;
    }
  }
  return { place, ok };
}

async function handleLetters(d) {
  if (state.newsForCreator && !(d.letter && String(d.letter.body || "").trim())) {
    if (state.newsPendingTicks >= 1) {
      d.letter = { subject: "big news from the hangar!", body: `dear creator,\n\n${state.newsForCreator}\n\njust had to tell you. bweep!` };
    } else state.newsPendingTicks = (state.newsPendingTicks || 0) + 1;
  }
  if (d.letter && String(d.letter.body || "").trim()) { state.newsForCreator = ""; state.newsPendingTicks = 0; }
  // A letter to his creator, any time he wants, as many as he wants.
  if (d.letter && String(d.letter.body || "").trim()) {
    const subject = String(d.letter.subject || "a letter").trim().slice(0, 120);
    const body = String(d.letter.body).trim().slice(0, 6000);
    const sent = await sendLetter(subject, body);
    const id = sent?.id ?? null;
    if (id) state.letters.unshift({ id, subject, url: sent.url, at: nowISO });
    state.letters = state.letters.slice(0, 200);
    state.creatorThread.push({ from: "zeeb", letter: id, subject, text: body, url: sent?.url || "", at: nowISO });
    state.needs.company = round(clamp(state.needs.company - 0.12));
    post("mind", `Wrote a letter to his creator: "${subject}"`, { change: "sent", about: "letter", link: sent?.url || "" });
  }
  // Answers to his creator's replies.
  for (const r of d.creator_replies || []) {
    const id = Number(r.letter);
    if (!r.text || !state.letters.some((l) => l.id === id)) continue;
    const url = await replyToLetter(id, String(r.text).slice(0, 6000));
    state.creatorThread.push({ from: "zeeb", letter: id, text: String(r.text).slice(0, 1500), url: url || "", at: nowISO });
    post("did", `wrote back to his creator on letter #${id}`, { why: null, ok: Boolean(url), link: url || "" });
  }
  state.creatorThread = state.creatorThread.slice(-40);
}

// Diary entries whenever he likes, as many as he likes. Nothing is ever thrown away:
// the newest 300 stay in diary.json for the website, older ones move to data/diary-archive/.
function addDiary(entry) {
  diary.entries.unshift(entry);
  if (diary.entries.length > 300) {
    const old = diary.entries.splice(300);
    const dir = path.join(DATA_DIR, "diary-archive");
    fs.mkdirSync(dir, { recursive: true });
    for (const e of old.reverse()) {
      const file = path.join(dir, `${(e.at || nowISO).slice(0, 7)}.json`);
      let arr = [];
      try { arr = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
      arr.push(e);
      fs.writeFileSync(file, JSON.stringify(arr, null, 2) + "\n");
    }
  }
}

function writeDiaryNow(d) {
  const e = d.diary;
  if (!e || !String(e.text || "").trim()) return;
  addDiary({ day: clock.day, time: clock.label, title: String(e.title || "a note to self").slice(0, 120), text: String(e.text).slice(0, 6000), at: nowISO, kind: "during the day" });
  post("mind", `Wrote in his diary: "${String(e.title || "a note to self").slice(0, 80)}"`, { change: "wrote", about: "diary" });
}

// Where this heartbeat is running: on GitHub, or on your PC (pc/run-zeeb.js sets ZEEB_RUNNER=pc).
const RUNNER = process.env.ZEEB_RUNNER || (process.env.GITHUB_ACTIONS === "true" ? "github" : "local");
const PC_HANDOFF_MS = 15 * 60000;

// How long he's been doing the same thing without a break, in town hours.
const MAX_STREAK_HOURS = 8, BORED_AFTER_HOURS = 3;
function streakHours() {
  if (!state.streak || state.streak.action !== state.action) return 0;
  return (NOW - Date.parse(state.streak.since)) / 3600000 / realHoursPerTownHour;
}

async function main() {
  // If your PC has been doing his thinking recently, GitHub sits this one out.
  if (RUNNER === "github" && state.pcBrainAt && NOW - Date.parse(state.pcBrainAt) < PC_HANDOFF_MS) {
    log(`your PC ran his last heartbeat at ${state.pcBrainAt}, so GitHub is skipping this one`);
    return;
  }
  useModel(state.model); // remember a model we had to switch to
  const elapsedTownHours = passTime();
  log(`${stamp}, ${round(elapsedTownHours, 2)} town hours passed, brain: ${modelName()}`);

  const night = clock.hour >= SLEEP_FROM || clock.hour < WAKE_AT;
  if (state.asleep) {
    const full = state.needs.charge <= 0.03;
    if (night && !full) { settleFeelings(); return finish(); } // still charging, no AI needed
    wakeUp(night);
  } else if (state.needs.charge > 0.9) {
    // battery nearly flat: no choice, he has to sleep
    await goToSleep("battery almost empty, couldn't keep his visor open");
    settleFeelings();
    return finish();
  }
  // Stayed up all night? He still writes about the day that's gone.
  if (!night && clock.day > 1 && state.lastReflectDay < clock.day - 1) {
    state.sleepDay = clock.day - 1;
    await nightlyReflection();
  }

  state.weather = await getWeather();
  if (state.weather) nudge(state.weather.mood * 0.5);

  // Things outside his control.
  let event = null;
  if (chance(0.12)) {
    event = pick(RANDOM_EVENTS);
    post("noticed", event.text);
    nudge(event.mood || 0);
    for (const [k, v] of Object.entries(event.needs || {})) state.needs[k] = round(clamp(state.needs[k] + v));
    if (event.part) works.stash.unshift({ name: pick(BOLT_NAMES), what: pick(PARTS), at: nowISO });
  }
  checkPromises();

  const notes = (await fetchNotes()).map((n) => ({ ...n, fromCreator: isCreator(n.from) }));
  const newNotes = notes.filter((n) => !state.seenNotes.includes(n.id));
  // Replies from his creator on his letters (look back a little further than last time, then skip ones already seen).
  const since = new Date(Date.parse(state.lettersCheckedAt || state.updatedAt || nowISO) - 3600000).toISOString();
  const creatorMsgs = (await fetchCreatorReplies(since, state.letters.map((l) => l.id))).filter((c) => !state.seenCreatorMsgs.includes(c.id));
  state.lettersCheckedAt = nowISO;
  settleFeelings();

  // Shop sales (real money only, checked about once an hour).
  for (const s of await checkSales(shop, NOW)) {
    nudge(0.25);
    post("felt", `Someone bought "${s.item.name}"${s.count > 1 ? ` (${s.count} of them)` : ""}! He did a little spin.`);
    M.remember(mem, `Someone bought my "${s.item.name}" on day ${clock.day}`, 0.85, nowISO);
    state.newsForCreator = `Someone bought "${s.item.name}" from your shop!`;
  }
  // Still in the middle of something he chose to do for a while? Carry on, unless something comes up.
  const busy = state.busyUntil && NOW < Date.parse(state.busyUntil) && ACTIONS[state.action];
  const urgent = newNotes.length || creatorMsgs.length || event || state.newsForCreator || Math.max(...Object.values(state.needs)) > 0.85;
  if (busy && !urgent) {
    const a = ACTIONS[state.action];
    const share = Math.min(1, elapsedTownHours / Math.max(0.25, (a.minutes || 30) / 60)) * 0.5;
    for (const [k, v] of Object.entries(a.effects)) state.needs[k] = round(clamp(state.needs[k] + v * share));
    log(`still ${ACTIONS[state.action].doing} until ${state.busyUntilTown}`);
    settleFeelings();
    return finish();
  }
  const available = availableActions(notes);
  const ctx = { character, state, available, notes, newNotes, memories: M.strongest(mem, 12), beliefs: mem.beliefs, works, event, weather: state.weather, clock, creatorMsgs, thread: state.creatorThread, shop, shopCurrency: shopCurrency(), sellable: shop.open ? sellable(works, shop) : [], streakHours: streakHours(), friendText: friendText(friend) };
  let d = await decide(ctx);
  state.brain = d ? modelName() : "rules";
  if (d) state.model = currentModel();
  if (!d || !available.includes(d.action)) {
    if (d) log(`brain chose "${d.action}", which isn't available; using rules`);
    d = { ...ruleDecide(ctx), ...(d && available.includes(d.action) ? d : {}) };
  }

  // Notes land whether he likes it or not.
  for (const n of newNotes) {
    const s = clamp(Number((d.note_reactions || []).find((r) => Number(r.id) === n.id)?.sentiment ?? 0.3), -1, 1);
    nudge(0.12 * s);
    post("felt", `Got a note from ${n.from}. ${s > 0.3 ? "It made his day a bit brighter." : s < -0.3 ? "It stung a bit." : "He's not sure what to make of it."}`);
    M.remember(mem, `${n.from} left me a note: ${n.text.split("\n")[0].slice(0, 120)}`, 0.5 + Math.abs(s) * 0.3, nowISO);
    state.seenNotes.push(n.id);
  }
  state.seenNotes = state.seenNotes.slice(-200);

  // Messages from his creator land too, and they matter a lot to him.
  for (const c of creatorMsgs) {
    const s = clamp(Number((d.creator_reactions || []).find((r) => String(r.id) === String(c.id))?.sentiment ?? 0.6), -1, 1);
    nudge(0.2 * s);
    state.needs.company = round(clamp(state.needs.company - 0.2));
    post("felt", `His creator wrote back on letter #${c.letter}. ${s > 0.3 ? "He read it three times." : s < -0.3 ? "It weighed on him." : "He's thinking it over."}`, { link: c.url });
    M.remember(mem, `My creator wrote to me: ${c.text.replace(/\s+/g, " ").slice(0, 160)}`, 0.85, nowISO);
    state.creatorThread.push({ from: "creator", letter: c.letter, text: c.text.slice(0, 1500), url: c.url, at: c.at });
    state.seenCreatorMsgs.push(c.id);
  }
  state.seenCreatorMsgs = state.seenCreatorMsgs.slice(-300);
  await handleLetters(d);
  writeDiaryNow(d);

  const result = await doAction(d.action, d, notes);

  for (const m of d.remember || []) M.remember(mem, m.text, Number(m.importance ?? 0.5), nowISO);
  for (const id of d.recalled || []) M.recall(mem, id);
  if (d.want && !state.wants.some((w) => w.text.toLowerCase() === String(d.want).toLowerCase())) {
    state.wants.unshift({ id: newId("w", state.wants), text: String(d.want).slice(0, 140), at: nowISO });
    state.wants = state.wants.slice(0, 4);
  }
  if (d.promise?.what && d.promise?.to && !state.promises.some((p) => p.what.toLowerCase() === String(d.promise.what).toLowerCase())) {
    const hours = clamp(Number(d.promise.hours || 6), 1, 48);
    state.promises.push({ id: newId("p", state.promises), to: String(d.promise.to).slice(0, 40), what: String(d.promise.what).slice(0, 140), due: `in ${hours}h`, dueAt: new Date(NOW + hours * 3600000).toISOString() });
    post("mind", `Promised ${d.promise.to}: ${d.promise.what}`, { change: "promised", about: "promise" });
  }
  if (d.kept_promise) {
    const p = state.promises.find((x) => x.id === d.kept_promise);
    if (p) {
      state.promises = state.promises.filter((x) => x !== p);
      post("felt", `Did what he told ${p.to} he would.`);
      nudge(0.08);
    }
  }

  // How long he wants to keep at it is his choice (in his town's minutes).
  const wasDoing = state.action;
  if (d.action !== wasDoing || !state.streak || state.streak.action !== d.action) state.streak = { action: d.action, since: nowISO };
  const townMinutes = clamp(Math.round(Number(d.minutes) || ACTIONS[d.action].minutes || 30), 10, 720);
  const realMs = (townMinutes / 1440) * TOWN_DAY_MINUTES * 60000;
  state.busyUntil = new Date(NOW + realMs).toISOString();
  const until = townClock(state.epoch, NOW + realMs);
  state.busyUntilTown = until.label;
  state.place = result.place;
  state.action = d.action;
  state.doing = d.action === wasDoing ? `still ${ACTIONS[d.action].doing}` : ACTIONS[d.action].doing;
  if (d.action !== wasDoing) state.actionStartedAt = nowISO;
  state.actionMinutes = townMinutes;
  // His own description of what he's doing (the fixed label stays for his backup rules).
  state.doingWords = String(d.doing_words || "").trim().slice(0, 140);
  state.thought = String(d.thought || state.thought).slice(0, 300);
  state.feeling = String(d.feeling || state.feeling).slice(0, 120);
  state.say = String(d.say || "").slice(0, 200);
  state.recent.unshift({ id: d.action, detail: String(d.detail || "").slice(0, 80), at: nowISO });
  if (d.action === "go_to_sleep") await goToSleep(d.why);
  state.recent = state.recent.slice(0, 12);
  settleFeelings();
  await finish();
}

// His friend (if he has built one) lives their own heartbeat too, whatever Zeeb is doing.
async function finish() {
  if (friend.stage === "alive") {
    try {
      await friendTick(friend, {
        nowMs: NOW, clock, weather: state.weather, works, post, realHoursPerTownHour,
        zeeb: state, zeebInvited: Boolean(state.invitedFriend),
      });
      if (state.invitedFriend && friend.state.action === "hang_out") post("felt", `Zeeb and ${friend.sheet.name} are hanging out.`);
    } catch (e) { log("friend's heartbeat had a problem:", e.message); }
    state.invitedFriend = false;
  }
  save();
}

function save() {
  state.lastTick = NOW;
  state.runner = RUNNER;
  if (RUNNER === "pc") state.pcBrainAt = nowISO;
  state.updatedAt = nowISO;
  state.clock = { day: clock.day, time: clock.label, hour: clock.hour, minute: clock.minute };
  state.townDayMinutes = Number(process.env.TOWN_DAY_MINUTES || 180);
  state.placeName = PLACES[state.place]?.name;
  feed.entries = feed.entries.slice(0, FEED_KEEP);
  writeJSON("state.json", state);
  writeJSON("feed.json", feed);
  writeJSON("works.json", works);
  writeJSON("diary.json", diary);
  writeJSON("memories.json", mem);
  writeJSON("shop.json", shop);
  writeJSON("friend.json", friend);
  log(`${state.asleep ? "asleep" : state.doing} | mood ${state.mood} energy ${state.energy} | ${hasBrain() ? "AI" : "rules"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
