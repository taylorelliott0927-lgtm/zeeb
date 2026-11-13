// One heartbeat of Zeeb's life. GitHub Actions runs this every few minutes.
// Read state -> let time pass -> offer actions -> ask the brain -> apply the result -> save.
import { ACTIONS, BOLT_NAMES, NEEDS, PARTS, PLACES, RANDOM_EVENTS, WORLD, inHours, placeFor } from "./world.js";
import { TOWN_DAY_MINUTES, chance, clamp, log, newId, pick, readJSON, realHoursPerTownHour, round, townClock, writeJSON } from "./util.js";
import { decide, muse, reactToWire, reflect, ruleDecide, ruleReact, ruleReflect } from "./mind.js";
import { fetchNotes, answerNote } from "./notes.js";
import { fetchCreatorReplies, isCreator, replyToLetter, sendLetter } from "./letters.js";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./util.js";
import { realWeather, toWeather, useWire } from "./internet.js";
import * as M from "./memory.js";
import { buildStep, designFriend, emptyFriend, friendText, friendTick, startFriend, wakeFriend } from "./friend.js";
import { activeGame, emptyGames, gamesText, startGame, workSession } from "./games.js";
import { emptyInterests, interestsText, noteInterest } from "./interests.js";
import { FLIGHT_SECONDS, MAX_BUILDS, buildsText, cleanBody, designThing, flightLog, flightOutcome, spotFor } from "./builds.js";
import { sheet } from "./mind.js";
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
  tunes: [], stash: [], reads: [], signals: [], builds: [], flights: [],
};

const character = readJSON("character.json", {});
const state = { ...structuredClone(DEFAULT_STATE), ...readJSON("state.json", DEFAULT_STATE) };
const feed = readJSON("feed.json", { entries: [] });
const works = { ...structuredClone(DEFAULT_WORKS), ...readJSON("works.json", DEFAULT_WORKS) };
const diary = readJSON("diary.json", { entries: [] });
const mem = readJSON("memories.json", M.emptyMemory());
const shop = { ...emptyShop(), ...readJSON("shop.json", emptyShop()) };
const friend = { ...emptyFriend(), ...readJSON("friend.json", emptyFriend()) };
const games = { ...emptyGames(), ...readJSON("games.json", emptyGames()) };
const interests = { ...emptyInterests(), ...readJSON("interests.json", emptyInterests()) };
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
  const blockedRecent = state.recent.slice(0, 3).map((r) => r.id).filter((x) => x !== state.action || ACTIONS[x]?.oneShot);
  // ...but not forever: after 8 town hours straight on one thing he's burned out on it, and it goes on the cooldown like anything else.
  if (state.action && streakHours() >= MAX_STREAK_HOURS) blockedRecent.push(state.action);
  const storm = state.weather?.kind === "sandstorm";
  let ids = Object.keys(ACTIONS).filter((id) => {
    const a = ACTIONS[id];
    if (blockedRecent.includes(id)) return false;
    if (!inHours(a.hours, clock.hour)) return false;
    if (a.needsNotes && !notes.length) return false;
    if (a.needsLinks && !(works.lastLinks || []).length) return false;
    if (a.needsParts && !works.stash.length) return false;
    if (a.needsCredits && state.credits < a.needsCredits) return false;
    if (a.needsTune && !works.tunes.length) return false;
    if (a.needsShip && !(works.dart.launched || []).length) return false;
    if (a.outdoorFlight && storm) return false;
    if (a.needsBuilds && !(works.builds || []).length) return false;
    if (a.needsShop && (a.needsShop === "open") !== Boolean(shop.open)) return false;
    if (a.needsFriend && a.needsFriend !== friend.stage) return false;
    if (a.friendOnly) return false;
    if (a.needsGame === "none" && activeGame(games)) return false;
    // At most one new game per town day.
    if (a.needsGame === "none" && games.games[0] && NOW - Date.parse(games.games[0].started) < TOWN_DAY_MINUTES * 60000) return false;
    if (a.needsGame === "active" && !activeGame(games)) return false;
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
  const continuing = id === state.action && !a.oneShot;
  const repeats = continuing ? 0 : state.recent.slice(0, 8).filter((r) => r.id === id).length;
  if (!continuing) {
    // Repeats are punished seven times harder than novelty is rewarded, and things he hasn't done
    // in ages feel extra fresh. Spending most of a day on the same few things gets a bit stale.
    const last = state.lastDone?.[id];
    const hoursSince = last ? (NOW - Date.parse(last)) / 3600000 / realHoursPerTownHour : Infinity;
    const fresh = repeats ? -0.07 * repeats : hoursSince > 24 ? 0.04 : hoursSince > 8 ? 0.02 : 0.01;
    const today = state.today?.day === clock.day ? state.today.counts : {};
    const total = Object.values(today).reduce((x, y) => x + y, 0);
    const share = total >= 6 ? (today[id] || 0) / total : 0;
    nudge(fresh - (share > 0.3 ? 0.03 : 0));
  }
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
  if (a.cost) { state.credits -= a.cost; pop(`-${a.cost} credit${a.cost > 1 ? "s" : ""}`, "spend"); }
  if (Array.isArray(a.earn) && id !== "fix_job") state.credits += a.earn[0];

  if (id !== "reply_notes" && id !== "go_to_sleep") post("did", text, { why: d.why || null, ok: true, ...(detail && id !== "browse_wire" ? { detail } : {}) });
  switch (id) {
    case "scavenge": {
      // Usually something, often a few things, now and then a real treasure.
      const n = chance(0.12) ? 0 : chance(0.35) ? 3 : chance(0.5) ? 2 : 1;
      const found = [];
      for (let i = 0; i < n; i++) found.push(addPart(chance(0.08)));
      if (found.length) {
        post("noticed", `Dug up ${found.map((p) => `${p.what}${p.good ? " (a really good one!)" : ""} and named it ${p.name}`).join("; ")}.`);
        nudge(0.03 * found.length);
      } else post("noticed", "Nothing worth keeping in the piles today.");
      break;
    }
    case "fix_job": {
      if (chance(0.25)) {
        const p = addPart(chance(0.2));
        post("noticed", `The trader paid him in parts: ${p.what}. He named it ${p.name}.`);
      } else {
        const pay = 3 + Math.floor(Math.random() * 4);
        state.credits += pay;
        pop(`+${pay} credits`, "credits");
        post("noticed", `Got paid ${pay} credits for the repair. Now has ${state.credits}.`);
      }
      break;
    }
    case "buy_part": {
      const good = /good|best|really/i.test(detail) && state.credits >= 8;
      const price = good ? 8 : 3 + Math.floor(Math.random() * 3);
      if (state.credits < price) { post("noticed", `Couldn't afford it: the trader wanted ${price} credits.`); break; }
      state.credits -= price;
      pop(`-${price} credits`, "spend");
      const p = addPart(good);
      post("noticed", `Bought ${p.what}${good ? " (a really good one)" : ""} for ${price} credits and named it ${p.name}. Has ${state.credits} left.`);
      nudge(0.03);
      break;
    }
    case "sell_scrap": {
      const want = String(detail).toLowerCase();
      const i = Math.max(0, works.stash.findIndex((p) => want && (want.includes(p.name.toLowerCase()) || want.includes(p.what.toLowerCase()))));
      const [p] = works.stash.splice(i, 1);
      const price = (p.good ? 5 : 2) + Math.floor(Math.random() * 3);
      state.credits += price;
      pop(`+${price} credits`, "credits");
      post("noticed", `Sold ${p.name} (${p.what}) for ${price} credits. Now has ${state.credits}.`);
      break;
    }
    case "busk": {
      const tips = Math.floor(Math.random() * 5);
      state.credits += tips;
      if (tips) pop(`+${tips} in tips`, "credits");
      post("noticed", tips ? `Played his tunes and got ${tips} credits in tips. Now has ${state.credits}.` : "Played his heart out. Nobody tipped. Rough crowd.");
      nudge(tips ? 0.04 : -0.03);
      break;
    }
    case "work_dart": {
      const dart = works.dart;
      const part = works.stash.pop();
      if (part) {
        dart.partsUsed = (dart.partsUsed || 0) + (part.good ? 2 : 1);
        // Remember exactly which part went in, so it can be seen mounted on the ship.
        dart.parts = [...(dart.parts || []), { name: part.name, what: part.what, ...(part.good ? { good: true } : {}), version: dart.version + 1 }].slice(-40);
      }
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
        dart.launched.push({ name: dart.name, day: clock.day, partsUsed: dart.partsUsed || 0, parts: dart.parts || [] });
        dart.partsUsed = 0;
        dart.parts = [];
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
    case "follow_link":
    case "read_news": {
      let target = detail;
      if (id === "follow_link") {
        const n = parseInt(String(detail).match(/\d+/)?.[0] || "", 10);
        const fromList = !/^https?:/i.test(detail) && n >= 1 ? (works.lastLinks || [])[n - 1] : null;
        target = fromList?.url || (String(detail).match(/https?:\/\/\S+/) || [])[0] || (works.lastLinks || [])[0]?.url || "";
      }
      const found = await useWire(a.internet, target);
      if (!found.failed && found.links?.length) works.lastLinks = found.links.slice(0, 12);
      else if (found.kind === "news" && !found.failed) works.lastLinks = (found.items || []).filter((i) => i.url).map((i) => ({ title: i.title, url: i.url }));
      const r = (await reactToWire({ character, works }, found)) || ruleReact(found);
      if (found.failed) { ok = false; feed.entries[0].ok = false; post("noticed", found.error ? `Couldn't read it: ${found.error}.` : "The Wire was down. Nothing loaded."); }
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
      // What he said he might look up next stays on his mind until his next search.
      state.nextSearch = r.next_search && String(r.next_search).trim() ? { text: String(r.next_search).trim().slice(0, 120), at: nowISO } : (id === "browse_wire" ? null : state.nextSearch);
      break;
    }
    case "wander":
    case "stargaze": {
      if (chance(0.2)) { const p = addPart(chance(0.05)); post("noticed", `Spotted ${p.what} half-buried in the sand. Named it ${p.name}.`); }
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
    case "test_flight": {
      const ship = works.dart.launched[works.dart.launched.length - 1];
      const outcome = flightOutcome(works, state.weather);
      const log_ = await flightLog(sheet(character), ship.name, outcome, detail, state.weather);
      const flight = { id: `f${Date.parse(nowISO).toString(36)}`, ship: ship.name, outcome, log: String(log_.log || "").slice(0, 600), at: nowISO, seconds: FLIGHT_SECONDS };
      works.flights = [flight, ...(works.flights || [])].slice(0, 40);
      state.flight = flight;
      post("did", `took ${ship.name} up for a test flight: ${outcome}`, { why: d.why || null, ok: true });
      post("mind", `Flight log: ${flight.log}`, { change: "flew", about: "piece" });
      if (log_.say) d.say = log_.say;
      if (log_.feeling) d.feeling = log_.feeling;
      nudge(outcome === "smooth" ? 0.25 : outcome === "sputter" ? 0.05 : -0.03);
      const first = works.flights.filter((f) => f.ship === ship.name).length === 1;
      M.remember(mem, `${first ? "First" : "Another"} test flight of ${ship.name} on day ${clock.day}: ${outcome}`, first ? 1 : 0.6, nowISO);
      if (first || outcome === "smooth") state.newsForCreator = state.newsForCreator || `You took ${ship.name} on a test flight (${outcome}). ${flight.log}`;
      break;
    }
    case "build_thing": {
      const idea = detail || "something for the outpost";
      const where = PLACES[d.place] ? d.place : place === "any" ? "hangar" : place;
      const design = await designThing(sheet(character), idea, where, works.stash);
      const spot = spotFor(design.place, works.builds || []);
      const part = works.stash.pop();
      const thing = { id: `b${Date.parse(nowISO).toString(36)}`, ...design, ...spot, day: clock.day, at: nowISO, usedPart: part ? part.what : null, usedPartName: part ? part.name : null, ...(part?.good ? { usedPartGood: true } : {}) };
      works.builds = [thing, ...(works.builds || [])].slice(0, MAX_BUILDS);
      place = thing.place;
      post("mind", `Built ${thing.name} near ${PLACES[thing.place].name}${thing.description ? `: ${thing.description}` : ""}`, { change: "built", about: "world" });
      M.remember(mem, `On day ${clock.day} I built ${thing.name} near ${PLACES[thing.place].name}`, 0.75, nowISO);
      nudge(0.06);
      break;
    }
    case "take_down_thing": {
      const b = (works.builds || []).find((x) => x.id === String(detail).trim()) || (works.builds || [])[works.builds.length - 1];
      if (b) {
        works.builds = works.builds.filter((x) => x !== b);
        post("mind", `Took down ${b.name}.`, { change: "removed", about: "world" });
      }
      break;
    }
    case "start_game": {
      const g = startGame(games, detail || d.interest || "a little game", nowISO);
      post("mind", `Started making a game. Idea: ${g.idea}`, { change: "started", about: "game" });
      M.remember(mem, `On day ${clock.day} I started making my own game: ${g.idea}`, 0.8, nowISO);
      // First session straight away.
      const r = await workSession(games, g, character, interestsText(interests), nowISO);
      reportGame(g, r);
      break;
    }
    case "work_game": {
      const g = activeGame(games);
      if (g) reportGame(g, await workSession(games, g, character, interestsText(interests), nowISO));
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

function reportGame(g, r) {
  if (r.abandoned) { post("felt", `Gave up on his game "${g.title}". ${r.note}`); return; }
  if (!r.ok) { post("noticed", `Sat at the terminal but ${r.note}.`); return; }
  post("mind", `Game "${g.title}" version ${r.v}: ${r.note || "worked on it"}${r.error ? ` (it has a bug: ${r.error.slice(0, 120)})` : ""}`, { change: "worked", about: "game" });
  if (r.released) {
    post("felt", `Released his game "${g.title}"! Anyone can play it in the Arcade now.`);
    nudge(0.25);
    M.remember(mem, `On day ${clock.day} I released my game "${g.title}"`, 0.95, nowISO);
    state.newsForCreator = `You released your game "${g.title}"! People can play it in the Arcade on your site.`;
  }
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

function applyChats() {
  const file = process.env.ZEEB_CHAT_FILE;
  if (!file) return false;
  let msgs = [];
  try { msgs = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return false; }
  msgs = (Array.isArray(msgs) ? msgs : []).filter((m) => m && m.text);
  if (!msgs.length) return false;
  const mine = msgs.filter((m) => m.from === "creator");
  const woke = msgs.some((m) => m.woke);
  state.needs.company = round(clamp(state.needs.company - Math.min(0.5, 0.12 * mine.length)));
  nudge(Math.min(0.15, 0.04 * mine.length));
  if (woke && state.asleep) post("felt", "His creator woke him up for a chat.");
  post("did", `had a live chat with his creator (${msgs.length} messages)`, { why: null, ok: true });
  const gist = mine.map((m) => m.text).join(" / ").replace(/\s+/g, " ").slice(0, 300);
  M.remember(mem, `Chatted live with my creator. They said: ${gist}`, 0.85, nowISO);
  for (const m of msgs.slice(-6)) state.creatorThread.push({ from: m.from === "creator" ? "creator" : "zeeb", chat: true, text: String(m.text).slice(0, 600), at: m.at || nowISO });
  state.creatorThread = state.creatorThread.slice(-40);
  state.lastChatAt = nowISO;
  return true;
}

// Add a scavenged part to his stash (good ones help the Dart more and sell for more).
// Little things that pop up over Zeeb on the website (credits gained or spent, parts found).
const pops = [];
const pop = (text, kind) => pops.push({ text, kind, at: nowISO });

function noteThought(text) {
  state.thoughts = [{ text, at: nowISO }, ...(state.thoughts || [])].slice(0, 6);
}

function addPart(good) {
  const p = { name: pick(BOLT_NAMES), what: pick(PARTS), at: nowISO, ...(good ? { good: true } : {}) };
  works.stash.unshift(p);
  works.stash = works.stash.slice(0, 20);
  pop(`+ ${p.what}${good ? " ★" : ""}`, "part");
  return p;
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

  // Live chats with his creator since the last heartbeat (from the chat page on the PC or phone).
  const chatted = applyChats();
  const night = clock.hour >= SLEEP_FROM || clock.hour < WAKE_AT;
  if (state.asleep) {
    const full = state.needs.charge <= 0.03;
    if (night && !full && !chatted) { settleFeelings(); return finish(); } // still charging, no AI needed
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
    state.event = { id: `e${Date.parse(nowISO).toString(36)}`, key: event.key, text: event.text, at: nowISO };
    if (event.key === "hauler_paint") state.haulerPaint = pick(["#e8476a", "#3fbf6f", "#f2c230", "#8a5cf0", "#2fb7d6", "#f07a2a"]);
    if (event.key === "light") state.lampOutUntil = new Date(NOW + TOWN_DAY_MINUTES * 60000).toISOString();
    post("noticed", event.text);
    nudge(event.mood || 0);
    for (const [k, v] of Object.entries(event.needs || {})) state.needs[k] = round(clamp(state.needs[k] + v));
    for (let i = 0; i < (event.part === true ? 1 : event.part || 0); i++) addPart(false);
    if (event.credits) { state.credits += event.credits; pop(`+${event.credits} credit${event.credits > 1 ? "s" : ""}`, "credits"); }
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
  const urgent = chatted || newNotes.length || creatorMsgs.length || event || state.newsForCreator || Math.max(...Object.values(state.needs)) > 0.85;
  if (busy && !urgent) {
    const a = ACTIONS[state.action];
    const share = Math.min(1, elapsedTownHours / Math.max(0.25, (a.minutes || 30) / 60)) * 0.5;
    for (const [k, v] of Object.entries(a.effects)) state.needs[k] = round(clamp(state.needs[k] + v * share));
    log(`still ${ACTIONS[state.action].doing} until ${state.busyUntilTown}`);
    // A fresh passing thought while he keeps at it (every heartbeat on your PC; sometimes on GitHub, to save free AI).
    if (RUNNER === "pc" || chance(0.3)) {
      const recent = feed.entries.filter((e) => Date.parse(e.at) > NOW - 30 * 60000).slice(0, 4).map((e) => e.text);
      const m = await muse({ character, state, works, clock, recent }).catch(() => null);
      if (m?.thought) { state.thought = String(m.thought).slice(0, 300); noteThought(state.thought); }
      state.say = String(m?.say || "").slice(0, 200);
      state.sayAt = nowISO;
    }
    settleFeelings();
    return finish();
  }
  const available = availableActions(notes);
  const ctx = { character, state, available, notes, newNotes, memories: M.strongest(mem, 12), beliefs: mem.beliefs, works, event, weather: state.weather, clock, creatorMsgs, thread: state.creatorThread, shop, shopCurrency: shopCurrency(), sellable: shop.open ? sellable(works, shop) : [], streakHours: streakHours(), friendText: friendText(friend), buildsText: buildsText(works), gamesText: gamesText(games), interestsText: interestsText(interests) };
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
  // What he's into: repeated interests can grow into an obsession.
  for (const ev of noteInterest(interests, d.interest, clock.day, nowISO, elapsedTownHours)) {
    if (ev.kind === "obsessed") {
      post("felt", `He's become a bit obsessed with ${ev.topic}.`);
      M.remember(mem, `I've become obsessed with ${ev.topic}`, 0.9, nowISO);
      state.newsForCreator = state.newsForCreator || `You've become totally obsessed with ${ev.topic}.`;
    } else post("noticed", `His obsession with ${ev.topic} has faded.`);
  }
  await handleLetters(d);
  writeDiaryNow(d);

  const result = await doAction(d.action, d, notes);

  for (const m of d.remember || []) M.remember(mem, m.text, Number(m.importance ?? 0.5), nowISO);
  for (const id of d.recalled || []) M.recall(mem, id);
  if (d.want && !state.wants.some((w) => w.text.toLowerCase() === String(d.want).toLowerCase())) {
    state.wants.unshift({ id: newId("w", state.wants), text: String(d.want).slice(0, 140), at: nowISO });
    state.wants = state.wants.slice(0, 4);
  }
  // Problems he's stuck on, in his own words, until he says he's sorted them.
  state.puzzles = state.puzzles || [];
  if (d.figured_out) {
    const p = state.puzzles.find((x) => x.id === String(d.figured_out).trim());
    if (p) { state.puzzles = state.puzzles.filter((x) => x !== p); post("mind", `Figured out: ${p.text}`, { change: "solved", about: "puzzle" }); }
  }
  if (d.figure_out && String(d.figure_out).trim() && !state.puzzles.some((p) => p.text.toLowerCase() === String(d.figure_out).trim().toLowerCase())) {
    state.puzzles.unshift({ id: newId("q", state.puzzles), text: String(d.figure_out).trim().slice(0, 160), at: nowISO });
    state.puzzles = state.puzzles.slice(0, 5);
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
  // How he chooses to move his body while doing it (the website animates this).
  state.body = cleanBody(d.body);
  state.thought = String(d.thought || state.thought).slice(0, 300);
  if (d.thought) noteThought(state.thought);
  state.sayAt = nowISO;
  state.feeling = String(d.feeling || state.feeling).slice(0, 120);
  state.say = String(d.say || "").slice(0, 200);
  state.recent.unshift({ id: d.action, detail: String(d.detail || "").slice(0, 80), at: nowISO });
  // Keep track of what he does today and when he last did each thing (shown to him, to help him notice ruts).
  if (state.today?.day !== clock.day) state.today = { day: clock.day, counts: {} };
  state.today.counts[d.action] = (state.today.counts[d.action] || 0) + 1;
  state.lastDone = { ...(state.lastDone || {}), [d.action]: nowISO };
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
  if (pops.length) state.pops = { at: nowISO, items: pops.slice(0, 6) };
  state.runner = RUNNER;
  if (RUNNER === "pc") state.pcBrainAt = nowISO;
  state.updatedAt = nowISO;
  state.clock = { day: clock.day, time: clock.label, hour: clock.hour, minute: clock.minute };
  state.townDayMinutes = Number(process.env.TOWN_DAY_MINUTES || 180);
  state.placeName = PLACES[state.place]?.name;
  // Everything he's said out loud or thought (the bubbles over his head), kept so it can be read back later.
  state.said = state.said || [];
  const said = (text, kind, at) => {
    text = String(text || "").trim();
    if (!text || state.said.slice(0, 12).some((x) => x.text === text)) return;
    state.said.unshift({ text, kind, at: at || nowISO, town: `day ${clock.day} ${clock.label}`, place: PLACES[state.place]?.name || "" });
  };
  for (const t of [...(state.thoughts || [])].reverse()) said(t.text, "think", t.at);
  said(state.thought, "think");
  said(state.say, "say");
  state.said = state.said.slice(0, 150);
  feed.entries = feed.entries.slice(0, FEED_KEEP);
  writeJSON("state.json", state);
  writeJSON("feed.json", feed);
  writeJSON("works.json", works);
  writeJSON("diary.json", diary);
  writeJSON("memories.json", mem);
  writeJSON("shop.json", shop);
  writeJSON("friend.json", friend);
  writeJSON("games.json", games);
  writeJSON("interests.json", interests);
  log(`${state.asleep ? "asleep" : state.doing} | mood ${state.mood} energy ${state.energy} | ${hasBrain() ? "AI" : "rules"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
