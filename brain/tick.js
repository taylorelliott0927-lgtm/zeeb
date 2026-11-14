// One heartbeat of Zeeb's life. GitHub Actions runs this every few minutes.
// Read state -> let time pass -> offer actions -> ask the brain -> apply the result -> save.
import { ACTIONS, BOLT_NAMES, NEEDS, PARTS, PLACES, RANDOM_EVENTS, WORLD, inHours, placeFor } from "./world.js";
import { TOWN_DAY_MINUTES, chance, clamp, log, newId, pick, readJSON, realHoursPerTownHour, round, townClock, writeJSON } from "./util.js";
import { decide, muse, surfNext, reactToWire, reflect, ruleDecide, ruleReact, ruleReflect } from "./mind.js";
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
import { buildShipPart, looksLikeShip, planShip, reviewDesign } from "./builds.js";
import { addKitPieces, buildKitShip, expandKit, planKitBuild, planKitShip } from "./kit.js";
import { FLIGHT_SECONDS, MAX_BUILDS, buildComponent, buildsText, cleanBody, designShip, designThing, lookUpModels, planBuild, refineThing, flightLog, flightOutcome, spotFor } from "./builds.js";
import { sheet } from "./mind.js";
import { craftingText, emptyCrafting, planPart, tryToMake } from "./crafting.js";
import { applyShopChange, checkSales, currency as shopCurrency, emptyShop, sellable } from "./shop.js";
import { askJSON, currentModel, hasBrain, modelName, useModel } from "./llm.js";

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
    if (a.needsProject && !(works.projects || []).length) return false;
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
  const pct = Math.round((1 - state.needs.charge) * 100);
  post("felt", pct < 90
    ? `His creator's chat woke him up early. Charge at ${pct}%.`
    : night ? `Woke up fully charged in the middle of the night. Not sleepy at all.`
    : clock.hour >= 5 && clock.hour < 9 ? `Woke up with the first sun, fully charged.` : `Woke up fully charged.`);
}

function checkPromises() {
  const dueNow = state.promises.filter((p) => Date.parse(p.dueAt) < NOW);
  for (const p of dueNow) {
    post("felt", `Didn't do what he told ${p.to} he would (${p.what}).`);
    nudge(-0.06);
  }
  state.promises = state.promises.filter((p) => Date.parse(p.dueAt) >= NOW);
}

// Everything he's ever looked at on the Wire, kept in data/web-log.json for the website's Web tab.
function webLog(entry) {
  const log = readJSON("web-log.json", { entries: [] });
  if (!log.entries.length && (works.reads || []).length) log.entries = works.reads.map((r) => ({ ...r, town: "" })); // first time: start from what he's read lately
  log.entries.unshift({ ...entry, at: nowISO, town: stamp });
  log.entries = log.entries.slice(0, 2000);
  writeJSON("web-log.json", log);
}

// Turn "3" or a web address into the link he means (from the links he saw last time on the Wire).
function linkTarget(detail) {
  detail = String(detail || "");
  const n = parseInt(detail.match(/\d+/)?.[0] || "", 10);
  const fromList = !/^https?:/i.test(detail) && n >= 1 ? (works.lastLinks || [])[n - 1] : null;
  return fromList?.url || (detail.match(/https?:\/\/\S+/) || [])[0] || (works.lastLinks || [])[0]?.url || "";
}

// Read one thing off the Wire (a search, a page or the news), react to it, and keep a record with the link.
async function readTheWire(kind, target, wasSearch) {
  const recentSites = [...new Set((works.reads || []).slice(0, 15).map((r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean))];
  const readUrls = (works.reads || []).map((r) => r.url).filter(Boolean);
  let found = await useWire(kind, target, recentSites, readUrls);
  if (kind === "search" && target) { state.searches = [{ q: String(target).slice(0, 100), at: nowISO }, ...(state.searches || []).filter((x) => x.q.toLowerCase() !== String(target).toLowerCase())].slice(0, 12); }
  // A page that won't open: try other links he can see (new sites first), then search for what it was about.
  if (found.failed && kind === "page") {
    const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
    const wanted = (works.lastLinks || []).find((l) => l.url === target);
    const others = (works.lastLinks || []).filter((l) => l.url !== target);
    const tryOrder = [...others.filter((l) => !recentSites.includes(site(l.url))), ...others.filter((l) => recentSites.includes(site(l.url)))].slice(0, 4);
    const tried = [site(target) || "that page"];
    for (const l of tryOrder) {
      const next = await useWire("page", l.url, recentSites);
      tried.push(site(l.url));
      if (!next.failed) { found = { ...next, note: `${tried[0]} wouldn't open, so he tried another link` }; break; }
    }
    if (found.failed && wanted?.title) {
      const s2 = await useWire("search", wanted.title, recentSites);
      if (!s2.failed) found = { ...s2, note: "the page wouldn't open, so he searched for it instead" };
    }
    if (!found.failed) post("noticed", `${tried[0]} wouldn't open, so he ${found.kind === "search" ? `searched for "${wanted?.title}" instead` : `tried ${site(found.url)} instead`}.`);
  }
  if (!found.failed && found.links?.length) works.lastLinks = found.links.slice(0, 12);
  else if (found.kind === "news" && !found.failed) works.lastLinks = (found.items || []).filter((i) => i.url).map((i) => ({ title: i.title, url: i.url }));
  const r = (await reactToWire({ character, works }, found)) || ruleReact(found);
  if (found.failed) { post("noticed", found.error ? `Couldn't read it: ${found.error}.` : "The Wire was down. Nothing loaded."); webLog({ title: found.url || found.query || "a page", url: found.url || "", query: found.query || "", failed: true, error: found.error || "", kind }); }
  const title = found.kind === "news" ? (r.picked || found.items?.[0]?.title || "the news") : found.title;
  const item = found.kind === "news" ? (found.items.find((i) => i.title === r.picked) || found.items?.[0]) : found;
  if (!found.failed) {
    works.reads.unshift({ title, url: item?.url || "", query: found.query || "", takeaway: r.takeaway || "", kind: found.kind, at: nowISO });
    webLog({ title, url: item?.url || "", query: found.query || "", takeaway: r.takeaway || "", kind: found.kind });
    works.reads = works.reads.slice(0, 40);
    post("noticed", `Read "${title}"${r.takeaway ? `: ${r.takeaway}` : ""}`, { link: item?.url || "" });
  }
  for (const m of r.remember || []) M.remember(mem, m.text, m.importance ?? 0.5, nowISO);
  if (r.inspiration) post("mind", `Idea: ${r.inspiration}`, { change: "idea", about: "piece" });
  // What he said he might look up next stays on his mind until his next search.
  state.nextSearch = r.next_search && String(r.next_search).trim() ? { text: String(r.next_search).trim().slice(0, 120), at: nowISO } : (wasSearch ? null : state.nextSearch);
  return { ...r, failed: Boolean(found.failed) };
}

async function doAction(id, d, notes) {
  const a = ACTIONS[id];
  let place = placeFor(id, state);
  if (id === "hang_out" && friend.state && !friend.state.asleep) place = friend.state.place;
  if (id === "work_project" && (works.projects || []).length) place = ((works.projects || []).find((p) => String(d.detail || "").includes(p.id)) || works.projects[0]).place;
  const detail = String(d.detail || "").slice(0, 200);
  let ok = true;
  // The small AI sometimes copies the example sentence from its instructions word for word; that isn't really him, so use the plain description.
  if (/curled up in the dock, dish switched off/i.test(String(d.doing_words || "")) && !["nap_dock", "go_to_sleep"].includes(id)) d.doing_words = "";
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
        dart.partsUsed = (dart.partsUsed || 0) + (part.good || part.custom ? 2 : 1);
        // Remember exactly which part went in, so it can be seen mounted on the ship.
        dart.parts = [...(dart.parts || []), { name: part.name, what: part.what, ...(part.good ? { good: true } : {}), ...(part.custom ? { custom: part.custom } : {}), version: dart.version + 1 }].slice(-40);
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
        dart.launched.push({ name: dart.name, day: clock.day, partsUsed: dart.partsUsed || 0, parts: dart.parts || [], ...(dart.design ? { design: dart.design } : {}) });
        dart.design = null;
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
      const kind = id === "follow_link" ? "page" : a.internet;
      // If he forgot to say what to search for, use what he said he was looking for (never a random page).
      // (skipping anything he's searched in his last few searches, so a forgotten detail doesn't repeat the same search)
      const recentQ = (state.searches || []).slice(0, 4).map((x) => x.q.toLowerCase());
      const searchFor = detail || [state.nextSearch?.text, ...(state.puzzles || []).map((p) => p.text), String(d.why || "").slice(0, 120), String(d.doing_words || "")].find((q) => q && !recentQ.includes(q.toLowerCase())) || "";
      let target = id === "follow_link" ? linkTarget(detail) : id === "browse_wire" ? searchFor : detail;
      let wireKind = kind;
      // Nothing new to search for? Open one of the links he hasn't read yet instead of repeating himself.
      if (id === "browse_wire" && !target) {
        const readU = new Set((works.reads || []).map((r) => r.url));
        const link = (works.lastLinks || []).find((l) => !readU.has(l.url));
        if (link) { target = link.url; wireKind = "page"; }
      }
      const r = await readTheWire(wireKind, target, id === "browse_wire" && wireKind === "search");
      if (r.failed) { ok = false; feed.entries[0].ok = false; }
      if (r.thought) d.thought = r.thought;
      if (r.feeling) d.feeling = r.feeling;
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
      const lib = await lookUpModels(sheet(character), idea).catch(() => ({ searches: [], found: [] }));
      if (lib.searches.length) post("noticed", `Looked up ${lib.searches.map((q) => `"${q}"`).join(", ")} in his model library${lib.found.length ? `: found ${lib.found.slice(0, 6).map((m) => m.name).join(", ")}${lib.found.length > 6 ? " and more" : ""}` : ", but nothing matched"}.`);
      // He plans it with his builder's kit (ready-made pieces placed where he says, plus his own extra shapes).
      let design = null;
      const bp = await planKitBuild(sheet(character), idea, PLACES[where]?.name || "near Hangar Bay 3", Object.keys(PLACES), lib.found, works.stash);
      if (bp) {
        const built = expandKit(bp);
        if (built.parts.length >= 3) design = {
          name: String(bp.name || idea).slice(0, 50), description: String(bp.description || "").slice(0, 200), place: PLACES[bp.place] ? bp.place : where, parts: built.parts,
          plan: { purpose: String(bp.purpose || "").slice(0, 160), size: built.frame, components: bp.pieces.slice(0, 30).map((p) => ({ name: `${p.kit}${p.where ? ` (${p.where})` : ""}` })) },
          kit: { size: { width: built.frame.W, depth: built.frame.D }, colors: bp.colors || {}, pieces: bp.pieces.slice(0, 30), extra_shapes: (bp.extra_shapes || []).slice(0, 12) },
        };
      }
      // (older ways, only if the kit plan didn't work out)
      const plan = design ? null : await planBuild(sheet(character), idea, where, works.stash, lib.found);
      if (plan) {
        let parts = [];
        for (const comp of plan.components.slice(0, RUNNER === "pc" ? 8 : 4)) parts = [...parts, ...(await buildComponent(sheet(character), plan, comp, parts, lib.found))].slice(0, 120);
        // An honest look: does it actually look like what he set out to build? He can fix it.
        if (parts.length >= 3 && RUNNER === "pc") parts = (await reviewDesign(sheet(character), `"${plan.name}"`, plan.description, parts, "Build space: centred on x 0, z 0, standing on the ground at y 0 (y is height).")).parts;
        if (parts.length >= 3) design = { name: plan.name, description: plan.description, place: plan.place, parts, plan: { purpose: plan.purpose, size: plan.size, components: plan.components } };
      }
      const fromKit = Boolean(design);
      design ||= await designThing(sheet(character), idea, where, works.stash, lib.found);
      // Then a final look where he adds the finishing details (kit builds already have theirs).
      if (!fromKit && design.parts.length >= 2) {
        const more = await refineThing(sheet(character), design, "", lib.found).catch(() => null);
        if (more) { design.parts = [...design.parts, ...more.add].slice(0, 140); design.description = more.description || design.description; }
      }
      const spot = spotFor(design.place, [...(works.builds || []), ...(works.projects || [])]);
      // Big builds (he says so, or they're large) become projects that take several work sessions.
      const area = design.kit ? design.kit.size.width * design.kit.size.depth : 0;
      const hl = String(bp?.how_long || ""), big = (/big|project|several|long/i.test(hl) && !/quick/i.test(hl)) || area >= 20 || design.parts.length >= 70;
      if (big && (works.projects || []).length < 3) {
        const sessions = Math.max(3, Math.min(12, Math.round(area / 6 + (design.kit?.pieces?.length || design.parts.length / 8) / 2)));
        const proj = { id: `p${Date.parse(nowISO).toString(36)}`, ...design, ...spot, sessions, progress: Math.round(100 / sessions), started: nowISO, day: clock.day, log: [{ progress: Math.round(100 / sessions), note: "laid out the plan and started on it", town: stamp }] };
        works.projects = [proj, ...(works.projects || [])];
        place = proj.place;
        post("mind", `Started a big project near ${PLACES[proj.place].name}: ${proj.name}${proj.description ? ` (${proj.description})` : ""}. It'll take a while.`, { change: "started", about: "world" });
        M.remember(mem, `On day ${clock.day} I started building ${proj.name} near ${PLACES[proj.place].name}. It's a big one.`, 0.8, nowISO);
        nudge(0.05);
        break;
      }
      const part = works.stash.pop();
      const thing = { id: `b${Date.parse(nowISO).toString(36)}`, ...design, ...spot, day: clock.day, at: nowISO, usedPart: part ? part.what : null, usedPartName: part ? part.name : null, ...(part?.good ? { usedPartGood: true } : {}) };
      works.builds = [thing, ...(works.builds || [])].slice(0, MAX_BUILDS);
      place = thing.place;
      post("mind", `Built ${thing.name} near ${PLACES[thing.place].name}${thing.description ? `: ${thing.description}` : ""}`, { change: "built", about: "world" });
      M.remember(mem, `On day ${clock.day} I built ${thing.name} near ${PLACES[thing.place].name}`, 0.75, nowISO);
      nudge(0.06);
      break;
    }
    case "design_ship": {
      const dart = works.dart;
      // He picks every part of his ship (hull, nose, cockpit, wings, engines, fins, extras, colours) and the kit builds it properly.
      let design = null;
      const kitShip = await planKitShip(sheet(character), detail, dart);
      if (kitShip?.hull || kitShip?.wings || kitShip?.engines) {
        const sp = buildKitShip(kitShip);
        if (looksLikeShip(sp)) design = { name: String(kitShip.name || "").trim().slice(0, 40), description: String(kitShip.description || detail || "").slice(0, 200), parts: sp };
      }
      const plan = design ? { parts: [] } : await planShip(sheet(character), detail, dart);
      let parts = [];
      for (const p of plan.parts.slice(0, RUNNER === "pc" ? 8 : 5)) parts = [...parts, ...(await buildShipPart(sheet(character), plan, p, parts))].slice(0, 60);
      if (parts.length >= 4) {
        const rev = await reviewDesign(sheet(character), `your ship ${plan.name || dart.name}`, plan.description, parts, "Ship space: the nose points toward +z, y is up (y 0 is the bottom), x is left/right.");
        parts = rev.parts;
        if (looksLikeShip(parts)) design = { name: plan.name, description: plan.description, parts };
      }
      // If that didn't come out ship-shaped, one try the simple way; if that fails too, he keeps the look he had.
      if (!design) { const d2 = await designShip(sheet(character), detail, dart); if (d2 && looksLikeShip(d2.parts)) design = d2; }
      if (!design) { ok = false; feed.entries[0].ok = false; post("noticed", "Scribbled a few ship sketches but none of them looked right yet."); break; }
      const oldName = dart.name;
      if (design.name && design.name.toLowerCase() !== oldName.toLowerCase()) dart.name = design.name;
      dart.design = { description: design.description, parts: design.parts, at: nowISO, day: clock.day };
      post("mind", `Designed a new look for ${dart.name}${dart.name !== oldName ? ` (renamed from ${oldName})` : ""}: ${design.description}`, { change: "designed", about: "ship" });
      M.remember(mem, `On day ${clock.day} I designed how ${dart.name} looks: ${design.description}`, 0.7, nowISO);
      nudge(0.05);
      break;
    }
    case "craft_part": {
      const C = (works.crafting ||= emptyCrafting());
      const memories = M.strongest(mem, 10).map((m) => m.text);
      const plan = await planPart(sheet(character), detail, { stash: works.stash, reads: works.reads || [], memories, crafting: C }).catch(() => null);
      if (!plan) { ok = false; feed.entries[0].ok = false; post("noticed", "Sat at the workbench a while but couldn't work out where to start."); break; }
      // He uses up the materials he picked from his stash.
      const used = [];
      for (const m of plan.materials) {
        const want = m.toLowerCase().replace(/^(an?|the|some) /, "").split(/\s+/).filter((w) => w.length > 3);
        const i = works.stash.findIndex((p) => want.some((w) => p.what.toLowerCase().includes(w)));
        if (i >= 0) used.push(works.stash.splice(i, 1)[0]);
      }
      const res = tryToMake(plan, { reads: works.reads || [], memories, crafting: C, materialsUsed: used.length });
      const from = used.length ? ` out of ${used.map((u) => `${u.name} (${u.what})`).join(" and ")}` : "";
      if (res.ok) {
        let recipe = res.known;
        if (!recipe) {
          recipe = { id: `r${Date.parse(nowISO).toString(36)}`, what: plan.what, how: plan.how, uses: plan.uses, look: plan.look, firstMade: nowISO, day: clock.day, made: 0 };
          C.recipes.unshift(recipe);
          C.recipes = C.recipes.slice(0, 30);
          post("felt", `He invented a new part: ${recipe.what}! ${recipe.how}`);
          M.remember(mem, `On day ${clock.day} I invented ${recipe.what}: ${recipe.how}`, 0.85, nowISO);
          nudge(0.12);
        } else nudge(0.04);
        recipe.made = (recipe.made || 0) + 1;
        const p = { name: pick(BOLT_NAMES), what: recipe.what, at: nowISO, custom: recipe.id };
        works.stash.unshift(p);
        works.stash = works.stash.slice(0, 20);
        pop(`+ ${recipe.what} (he made it!)`, "part");
        post("noticed", `Made ${recipe.what}${from} and named it ${p.name}.`);
        C.attempts.unshift({ what: recipe.what, result: "worked", at: nowISO });
      } else {
        post("noticed", `Tried to make ${plan.what}${from}. It didn't work yet.${plan.how ? ` (His plan: ${plan.how})` : ""}`);
        C.attempts.unshift({ what: plan.what, how: plan.how, result: "didn't work", at: nowISO });
        nudge(-0.02);
      }
      C.attempts = C.attempts.slice(0, 20);
      break;
    }
    case "work_project": {
      const proj = (works.projects || []).find((p) => detail.includes(p.id)) || (works.projects || [])[0];
      if (!proj) break;
      const part = works.stash.pop();
      const gain = Math.round((100 / proj.sessions) * (part ? (part.good || part.custom ? 1.6 : 1.3) : 1) * (0.8 + Math.random() * 0.4));
      proj.progress = Math.min(100, proj.progress + gain);
      const note = (d.doing_words || detail.replace(proj.id, "") || "kept building").trim().slice(0, 160) + (part ? ` (used ${part.name}, ${part.what})` : "");
      proj.log = [{ progress: proj.progress, note, town: stamp }, ...(proj.log || [])].slice(0, 30);
      place = proj.place;
      if (proj.progress >= 100) {
        works.projects = works.projects.filter((p) => p !== proj);
        const { sessions, progress, log, started, ...done } = proj;
        works.builds = [{ ...done, id: proj.id.replace(/^p/, "b"), day: clock.day, at: nowISO, buildLog: log, took: log.length }, ...(works.builds || [])].slice(0, MAX_BUILDS);
        post("felt", `Finished building ${proj.name}! It took ${log.length} work sessions.`);
        M.remember(mem, `On day ${clock.day} I finished building ${proj.name} near ${PLACES[proj.place].name}`, 0.9, nowISO);
        state.newsForCreator = `You finished building ${proj.name} near ${PLACES[proj.place].name}!`;
        nudge(0.15);
      } else post("mind", `Worked on ${proj.name} (${proj.progress}% built): ${note}`, { change: "worked", about: "world" });
      break;
    }
    case "improve_thing": {
      const builds = works.builds || [];
      const id = String(detail).match(/b[0-9a-z]{6,}/i)?.[0];
      const b = builds.find((x) => x.id === id) || builds.find((x) => detail.toLowerCase().includes(String(x.name).toLowerCase())) || builds[0];
      if (!b) break;
      const wish = detail.replace(id || "", "").replace(/^[\s:,-]+/, "");
      const lib = await lookUpModels(sheet(character), `${wish || "more detail"} for ${b.name}`).catch(() => ({ searches: [], found: [] }));
      if (lib.searches.length) post("noticed", `Looked up ${lib.searches.map((q) => `"${q}"`).join(", ")} in his model library${lib.found.length ? `: found ${lib.found.slice(0, 6).map((m) => m.name).join(", ")}` : ", but nothing matched"}.`);
      // He adds pieces from his builder's kit; older builds keep what they had and get the new pieces on top.
      if (!b.kit) {
        const xs = b.parts.filter((p) => !p.model).map((p) => [Math.abs(p.x) + (p.w || 0) / 2, Math.abs(p.z) + (p.d || 0) / 2]);
        b.kit = { size: { width: Math.max(2, ...xs.map((v) => v[0] * 2)), depth: Math.max(2, ...xs.map((v) => v[1] * 2)) }, colors: {}, pieces: [], extra_shapes: [] };
        b.legacyParts = b.parts;
      }
      const more = await addKitPieces(sheet(character), b, wish, lib.found);
      if (!more) { ok = false; feed.entries[0].ok = false; post("noticed", `Stared at ${b.name} for a while but didn't change anything.`); break; }
      b.kit.pieces = [...b.kit.pieces, ...(more.pieces || [])].slice(0, 40);
      b.kit.extra_shapes = [...(b.kit.extra_shapes || []), ...(more.extra_shapes || [])].slice(0, 20);
      const before = b.parts.length;
      b.parts = [...(b.legacyParts || []), ...expandKit(b.kit).parts].slice(0, 260);
      more.add = { length: Math.max(0, b.parts.length - before) };
      b.description = more.description || b.description;
      b.updatedAt = nowISO;
      place = b.place;
      post("mind", `Added to ${b.name} (${more.add.length} new pieces): ${b.description}`, { change: "improved", about: "world" });
      nudge(0.04);
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
      const g = startGame(games, detail || [].concat(d.interest || [])[0] || "a little game", nowISO);
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
  // Big news stays on his mind for a few heartbeats in case he wants to write about it. He writes it himself or not at all.
  if (state.newsForCreator && !(d.letter && String(d.letter.body || "").trim())) {
    state.newsPendingTicks = (state.newsPendingTicks || 0) + 1;
    if (state.newsPendingTicks > 6) { state.newsForCreator = ""; state.newsPendingTicks = 0; }
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

// Things he said in chat that he'd do stay on his mind as his own plans (he can still change his mind).
async function plansFromChat() {
  const recent = state.creatorThread.filter((m) => m.chat).slice(-10);
  if (!recent.some((m) => m.from === "zeeb")) return;
  const r = await askJSON(sheet(character), `Here's your live chat with your creator just now:
${recent.map((m) => `${m.from === "zeeb" ? "you" : "creator"}: ${m.text.slice(0, 400)}`).join("\n")}
Did YOU say you'd do anything (build something, look something up, make something, go somewhere)? List only what you really mean to do, in your own words, short. Empty list if nothing.
Return JSON: {"plans": ["..."]}`, { temperature: 0.4 }).catch(() => null);
  state.plans = state.plans || [];
  for (const p of (Array.isArray(r?.plans) ? r.plans : []).map((x) => String(x).trim().slice(0, 140)).filter((x) => x.length > 4).slice(0, 3)) {
    if (state.plans.some((q) => q.text.toLowerCase() === p.toLowerCase())) continue;
    state.plans.unshift({ id: newId("pl", state.plans), text: p, at: nowISO });
    post("mind", `Plans to: ${p}`, { change: "planned", about: "plan" });
  }
  state.plans = state.plans.slice(0, 6);
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
  if (chatted) await plansFromChat();
  const night = clock.hour >= SLEEP_FROM || clock.hour < WAKE_AT;
  if (state.asleep) {
    const full = state.needs.charge <= 0.03;
    // Once he's in the dock he stays until he's charged (day or night), unless his creator chats with him.
    if (!full && !chatted) { settleFeelings(); return finish(); } // still charging, no AI needed
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
    // At the comms tower for a while? Each heartbeat he can open another page, search something new, or just think about it. His pick.
    if (a.internet && (RUNNER === "pc" || chance(0.3))) {
      const next = await surfNext({ character, state, works, clock }).catch(() => null);
      const choice = String(next?.next || "").trim();
      if (choice) {
        let isLink = /^\d+$/.test(choice) || /^https?:/i.test(choice);
        let target = isLink ? linkTarget(choice) : choice;
        // The exact same search he just did? He's already read that, so he clicks a link he hasn't opened yet instead.
        if (!isLink && (state.searches || []).slice(0, 2).some((x) => x.q.toLowerCase() === choice.toLowerCase())) {
          const readU = new Set((works.reads || []).map((r) => r.url));
          const link = (works.lastLinks || []).find((l) => !readU.has(l.url));
          if (link) { isLink = true; target = link.url; }
        }
        const r = await readTheWire(isLink ? "page" : "search", target, !isLink);
        if (r.thought) { state.thought = String(r.thought).slice(0, 300); noteThought(state.thought); }
        if (r.feeling) state.feeling = String(r.feeling).slice(0, 80);
        state.say = String(next?.say || "").slice(0, 200);
        state.sayAt = nowISO;
        settleFeelings();
        return finish();
      }
      if (next?.thought) { state.thought = String(next.thought).slice(0, 300); noteThought(state.thought); }
      state.say = String(next?.say || "").slice(0, 200);
      state.sayAt = nowISO;
      settleFeelings();
      return finish();
    }
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
  const ctx = { character, state, available, notes, newNotes, memories: M.strongest(mem, 12), beliefs: mem.beliefs, works, event, weather: state.weather, clock, creatorMsgs, thread: state.creatorThread, shop, shopCurrency: shopCurrency(), sellable: shop.open ? sellable(works, shop) : [], streakHours: streakHours(), friendText: friendText(friend), buildsText: [buildsText(works), craftingText(works.crafting || emptyCrafting())].filter(Boolean).join("\n"), gamesText: gamesText(games), interestsText: interestsText(interests) };
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
  // He can be into several things at once; each one he names counts (time only passes once).
  const named = (Array.isArray(d.interest) ? d.interest : String(d.interest || "").split(/[;,\n]+/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
  const interestEvents = named.length ? named.flatMap((t, i) => noteInterest(interests, t, clock.day, nowISO, i === 0 ? elapsedTownHours : 0)) : noteInterest(interests, "", clock.day, nowISO, elapsedTownHours);
  for (const ev of interestEvents) {
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
  // Plans he made (in chat or anywhere): he says when one's done or dropped. Old ones fade after a few town days.
  state.plans = (state.plans || []).filter((p) => NOW - Date.parse(p.at) < 4 * TOWN_DAY_MINUTES * 60000);
  if (d.done_plan) {
    const p = state.plans.find((x) => x.id === String(d.done_plan).trim());
    if (p) { state.plans = state.plans.filter((x) => x !== p); post("mind", `Done with (or let go of) a plan: ${p.text}`, { change: "plan done", about: "plan" }); }
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

// Every feed entry is also kept forever in a file for its town day (data/feed-days/day-N.json),
// so the website's calendar can show any day he's ever lived.
function archiveFeed() {
  const since = state.feedArchivedAt ? Date.parse(state.feedArchivedAt) : -Infinity;
  const fresh = feed.entries.filter((e) => Date.parse(e.at) > since);
  if (!fresh.length) return;
  const byDay = {};
  for (const e of fresh) { const d = Number((e.townTime || "").match(/day (\d+)/)?.[1]); if (d) (byDay[d] ||= []).push(e); }
  const index = readJSON("feed-days/index.json", { days: [] });
  for (const [d, list] of Object.entries(byDay)) {
    const file = `feed-days/day-${d}.json`;
    const cur = readJSON(file, { day: Number(d), entries: [] });
    const seen = new Set(cur.entries.map((e) => e.at + e.text));
    for (const e of list) if (!seen.has(e.at + e.text)) cur.entries.push(e);
    cur.entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    writeJSON(file, cur);
    const row = { day: Number(d), count: cur.entries.length, first: cur.entries[cur.entries.length - 1].at, last: cur.entries[0].at };
    index.days = [row, ...index.days.filter((x) => x.day !== row.day)];
  }
  index.days.sort((a, b) => b.day - a.day);
  writeJSON("feed-days/index.json", index);
  state.feedArchivedAt = feed.entries.reduce((m, e) => (Date.parse(e.at) > Date.parse(m) ? e.at : m), fresh[0].at);
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
  // Parts he picks up while he's out stay on him until he's back at the hangar, then go on the shelf.
  const shelved = [];
  for (const p of works.stash) {
    if (state.place === "hangar") { if (p.carrying) { delete p.carrying; shelved.push(p); } }
    else if (p.at === nowISO && p.carrying === undefined) p.carrying = true;
  }
  if (shelved.length) post("noticed", `Put ${shelved.map((p) => `${p.name} (${p.what})`).join(", ")} on his shelf.`);
  archiveFeed();
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
