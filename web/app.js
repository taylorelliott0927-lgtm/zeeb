import { World, DEFAULT_SHIP } from "./world3d.js?v=34";

// ---------- where Zeeb's data lives ----------
// On GitHub Pages (you.github.io/repo) we read the live files straight from the repo,
// so the page updates the moment the brain saves, without redeploying the site.
function sources() {
  const cfg = window.ZEEB_CONFIG || {};
  let owner = cfg.owner, repo = cfg.repo;
  const branch = cfg.branch || "main";
  if (!owner && location.hostname.endsWith(".github.io")) {
    owner = location.hostname.split(".")[0];
    repo = location.pathname.split("/").filter(Boolean)[0] || `${owner}.github.io`;
  }
  const live = owner && repo ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/data/` : null;
  return { owner, repo, live, local: cfg.dataUrl || "./data/" };
}
const SRC = sources();

async function load(name) {
  const bust = `?t=${Math.floor(Date.now() / 20000)}`;
  for (const base of [SRC.live, SRC.local].filter(Boolean)) {
    try {
      const r = await fetch(base + name + bust, { cache: "no-store" });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

async function loadBlob(rel) {
  for (const base of [SRC.live, SRC.local].filter(Boolean)) {
    try {
      const r = await fetch(base + rel, { cache: "no-store" });
      if (r.ok) return await r.blob();
    } catch {}
  }
  return null;
}
const TYPES = { wav: "audio/wav", svg: "image/svg+xml" };
async function typedUrl(rel) {
  const b = await loadBlob(rel);
  if (!b) return null;
  return URL.createObjectURL(new Blob([b], { type: TYPES[rel.split(".").pop()] || b.type }));
}

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
const pct = (v) => `${Math.round(v * 100)}%`;
const NEED_LABELS = { charge: "Charge", oil: "Oil", curiosity: "Curiosity", company: "Company", craft: "Craft" };

// ---------- 3D ----------
let world = null;
try {
  world = new World($("world"), $("labels"));
  world.onMode = (m) => ($("modeText").textContent = m === "follow" ? "following Zeeb" : "walking around");
  world.start();
  window.zeebWorld = world;
} catch (e) {
  console.warn(e);
  $("nogl").hidden = false;
}
$("btnFollow").onclick = () => world?.setMode("follow");
$("btnWalk").onclick = () => world?.setMode("walk");
$("btnWhistle").onclick = () => world?.whistle();

// ---------- tabs ----------
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    document.querySelectorAll(".panel").forEach((p) => (p.hidden = p.id !== `panel-${b.dataset.tab}`));
  })
);
if (SRC.owner && SRC.repo) $("noteLink").href = `https://github.com/${SRC.owner}/${SRC.repo}/issues/new?template=note.yml`;
else { $("noteLink").removeAttribute("href"); $("notesInfo").textContent = "Notes switch on once this site is running on GitHub Pages."; }

// ---------- rendering ----------
let S = null, works = null, mind_interests = null;

function renderStats(s) {
  $("doing").textContent = s.asleep ? "asleep in the charging dock"
    : s.doingWords ? `${s.doingWords} (at ${s.placeName || "the outpost"}${s.busyUntilTown ? `, until about ${s.busyUntilTown}` : ""})`
    : `${s.doing} at ${s.placeName || "the outpost"}${s.busyUntilTown ? ` (until about ${s.busyUntilTown})` : ""}`;
  $("thought").textContent = s.thought ? `"${s.thought}"` : "";
  $("feeling").textContent = s.feeling ? `feels: ${s.feeling}` : "";
  const two = (id, v) => {
    const i = $(id), w = Math.abs(v) * 50;
    i.style.left = v >= 0 ? "50%" : `${50 - w}%`;
    i.style.width = `${w}%`;
    i.style.background = v >= 0 ? "var(--good)" : "var(--bad)";
  };
  two("mMood", s.mood); two("mEnergy", s.energy);
  const needs = $("needs");
  needs.replaceChildren(el("div", "muted", "needs (full bar = satisfied)"));
  for (const [k, v] of Object.entries(s.needs || {})) {
    const row = el("div", "meter");
    row.append(el("span", null, NEED_LABELS[k] || k));
    const bar = el("div", "bar"), fill = el("i");
    fill.style.width = pct(1 - v);
    fill.style.background = v > 0.65 ? "var(--bad)" : v > 0.35 ? "var(--brass)" : "var(--cyan)";
    bar.append(fill); row.append(bar, el("span", "val", pct(1 - v)));
    needs.append(row);
  }
  const facts = $("facts");
  facts.replaceChildren();
  const w = s.weather;
  for (const t of [
    `${s.credits} credits`,
    w ? `${w.kind}, ${w.temp}°C` : null,
    s.brain ? `brain: ${s.brain}` : null,
  ].filter(Boolean)) facts.append(el("span", "chip", t));
}

// ---------- feed: his current town day, plus a calendar of every town day he's lived (all in his time) ----------
const dayOf = (f) => Number((f.townTime || "").match(/day (\d+)/)?.[1]) || 0;
const timeOf = (f) => (f.townTime || "").replace(/^day \d+\s*/, "");
let feedView = "today", feedDay = null, latestFeed = [], feedIndex = null, calWeek = null;
const dayFiles = new Map();

function feedItem(f) {
  const li = el("li", `k-${f.kind}${f.ok === false ? " failed" : ""}`);
  li.append(el("span", "dot"));
  const body = el("div");
  const text = el("div", "text");
  if (f.link) { const a = el("a", null, f.text); a.href = f.link; a.target = "_blank"; a.rel = "noopener nofollow"; text.append(a); }
  else text.textContent = (f.ok === false ? "(turned down) " : "") + f.text;
  body.append(text);
  if (f.why) body.append(el("div", "why", f.why));
  body.append(el("div", "meta", `${f.kind} · ${timeOf(f)}`));
  li.append(body);
  return li;
}

const currentDay = () => Number(S?.clock?.day) || Math.max(0, ...latestFeed.map(dayOf));

function renderDay(day, entries) {
  const list = $("feed");
  list.replaceChildren();
  const items = entries.filter((f) => dayOf(f) === day).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const head = el("li", "day-head");
  head.append(el("span", null, day === currentDay() ? `Today · Day ${day}` : `Day ${day}`), el("span", "muted", ` · ${items.length} things`));
  list.append(head);
  for (const f of items) list.append(feedItem(f));
  if (!items.length) list.append(el("li", "muted", day === currentDay() ? "Nothing yet today." : "Nothing saved for this day."));
}

async function loadIndex() { feedIndex = (await load("feed-days/index.json")) || feedIndex || { days: [] }; return feedIndex; }

async function showDay(day) {
  feedDay = day;
  if (feedView === "calendar") renderCalendar();
  renderDay(day, latestFeed);
  if (!dayFiles.has(day) || day === currentDay()) { const f = await load(`feed-days/day-${day}.json`); if (f?.entries) dayFiles.set(day, f.entries); }
  const seen = new Set();
  renderDay(day, [...latestFeed, ...(dayFiles.get(day) || [])].filter((e) => { const k = e.at + e.text; if (seen.has(k)) return false; seen.add(k); return true; }));
}

// His calendar: town days in weeks of 7 (Week 1 is days 1 to 7, and so on).
async function renderCalendar() {
  const cal = $("calendar");
  const idx = await loadIndex();
  const counts = {};
  for (const d of idx.days) counts[d.day] = d.count;
  for (const f of latestFeed) if (!counts[dayOf(f)]) counts[dayOf(f)] = 1;
  const today = currentDay();
  const lastWeek = Math.max(1, Math.ceil(today / 7));
  calWeek ||= lastWeek;
  cal.replaceChildren();
  const nav = el("div", "cal-nav");
  const prev = el("button", "seg", "‹"), next = el("button", "seg", "›");
  prev.type = next.type = "button";
  prev.disabled = calWeek <= 1; next.disabled = calWeek >= lastWeek;
  prev.onclick = () => { calWeek = Math.max(1, calWeek - 1); renderCalendar(); };
  next.onclick = () => { calWeek = Math.min(lastWeek, calWeek + 1); renderCalendar(); };
  nav.append(prev, el("strong", null, `Week ${calWeek} · days ${calWeek * 7 - 6} to ${calWeek * 7}`), next);
  cal.append(nav);
  const grid = el("div", "cal-month");
  for (let n = calWeek * 7 - 6; n <= calWeek * 7; n++) {
    const has = Boolean(counts[n]);
    const b = el("button", `cal-date${has ? " has" : ""}${n === feedDay ? " on" : ""}${n === today ? " today" : ""}`);
    b.type = "button";
    b.append(el("strong", null, `Day ${n}`));
    b.append(el("span", null, has ? `${counts[n]}` : n > today ? "" : "–"));
    b.disabled = !has;
    b.onclick = () => showDay(n);
    grid.append(b);
  }
  cal.append(grid);
  cal.append(el("p", "muted", "His town days, in weeks of 7. Tap a day to see everything he did. Days without a number weren't saved (before the calendar existed)."));
}

function setFeedView(v) {
  feedView = v;
  $("feedRecent").classList.toggle("on", v === "today");
  $("feedCal").classList.toggle("on", v === "calendar");
  $("calendar").hidden = v !== "calendar";
  if (v === "calendar") { renderCalendar(); if (feedDay) showDay(feedDay); else $("feed").replaceChildren(); }
  else { feedDay = null; renderDay(currentDay(), latestFeed); }
}
setTimeout(() => { $("feedRecent")?.addEventListener("click", () => setFeedView("today")); $("feedCal")?.addEventListener("click", () => setFeedView("calendar")); }, 0);

function renderFeed(entries) {
  latestFeed = entries;
  if (feedView === "today") renderDay(currentDay(), entries); // his whole current day is always in the live feed
}

function renderFeedOld(entries) {
  const list = $("feed");
  list.replaceChildren();
  for (const f of entries.slice(0, 60)) {
    const li = el("li", `k-${f.kind}${f.ok === false ? " failed" : ""}`);
    li.append(el("span", "dot"));
    const body = el("div");
    const text = el("div", "text");
    if (f.link) { const a = el("a", null, f.text); a.href = f.link; a.target = "_blank"; a.rel = "noopener nofollow"; text.append(a); }
    else text.textContent = (f.ok === false ? "(turned down) " : "") + f.text;
    body.append(text);
    if (f.why) body.append(el("div", "why", f.why));
    body.append(el("div", "meta", `${f.kind} · ${f.townTime || ""} · ${ago(f.at)}`));
    li.append(body);
    list.append(li);
  }
  if (!entries.length) list.append(el("li", "muted", "Nothing yet. Zeeb's first heartbeat will show up here."));
}

function renderDiary(d) {
  const box = $("diary");
  box.replaceChildren();
  if (!d?.entries?.length) return box.append(el("p", "muted", "Zeeb writes in his diary whenever he feels like it, and every night when he plugs in to sleep."));
  for (const e of d.entries) {
    const div = el("div", "entry");
    const when = e.time === "night" || !e.time ? "night" : e.time;
    div.append(el("div", "title", e.title), el("div", "meta muted", `day ${e.day} · ${when} · ${ago(e.at)}`), el("p", null, e.text));
    if (e.dream) div.append(el("p", "muted", `dreamed: ${e.dream}`));
    const added = Object.entries(e.added || {}).flatMap(([k, v]) => v.map((x) => `${k.slice(0, -1)}: ${x}`));
    if (added.length) div.append(el("p", "muted", `added to himself: ${added.join("; ")}`));
    box.append(div);
  }
}

// A side view of a ship drawn from its design (nose to the right), as a small picture.
function shipSVG(design) {
  const parts = design?.parts?.length ? design.parts : DEFAULT_SHIP;
  const NS = "http://www.w3.org/2000/svg";
  const box = (pt) => {
    const len = pt.turn === "forward" || pt.turn === "back" ? pt.h : pt.d; // along the ship
    const tall = pt.turn === "up" ? pt.h : pt.turn === "side" ? pt.w : pt.d; // up and down
    return { z0: pt.z - len / 2, z1: pt.z + len / 2, y0: pt.y - tall / 2, y1: pt.y + tall / 2 };
  };
  const bs = parts.map(box);
  const zMin = Math.min(...bs.map((b) => b.z0)), zMax = Math.max(...bs.map((b) => b.z1)), yMin = Math.min(...bs.map((b) => b.y0)), yMax = Math.max(...bs.map((b) => b.y1));
  const W = 160, H = 80, pad = 6, k = Math.min((W - pad * 2) / Math.max(0.1, zMax - zMin), (H - pad * 2) / Math.max(0.1, yMax - yMin));
  const X = (z) => pad + (z - zMin) * k + ((W - pad * 2) - (zMax - zMin) * k) / 2, Y = (y) => H - pad - (y - yMin) * k - ((H - pad * 2) - (yMax - yMin) * k) / 2;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "ship-pic"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", design?.description || "the plain scrap-dart look");
  // draw wide flat parts (wings) first so the hull sits on top
  parts.map((pt, i) => [pt, bs[i]]).sort((a, b) => b[0].w - a[0].w).forEach(([pt, b]) => {
    let n;
    if (pt.shape === "ball") { n = document.createElementNS(NS, "ellipse"); n.setAttribute("cx", (X(b.z0) + X(b.z1)) / 2); n.setAttribute("cy", (Y(b.y0) + Y(b.y1)) / 2); n.setAttribute("rx", Math.max(1, (X(b.z1) - X(b.z0)) / 2)); n.setAttribute("ry", Math.max(1, (Y(b.y0) - Y(b.y1)) / 2)); }
    else if (pt.shape === "cone") {
      n = document.createElementNS(NS, "polygon");
      const [l, r, t, bt] = [X(b.z0), X(b.z1), Y(b.y1), Y(b.y0)], mx = (l + r) / 2, my = (t + bt) / 2;
      const pts = pt.turn === "forward" ? [[l, t], [r, my], [l, bt]] : pt.turn === "back" ? [[r, t], [l, my], [r, bt]] : pt.turn === "side" ? [[l, t], [r, t], [r, bt], [l, bt]] : [[l, bt], [mx, t], [r, bt]];
      n.setAttribute("points", pts.map((p) => p.join(",")).join(" "));
    } else { n = document.createElementNS(NS, "rect"); n.setAttribute("x", X(b.z0)); n.setAttribute("y", Y(b.y1)); n.setAttribute("width", Math.max(1, X(b.z1) - X(b.z0))); n.setAttribute("height", Math.max(1, Y(b.y0) - Y(b.y1))); if (pt.shape === "cylinder") n.setAttribute("rx", Math.min(8, (Y(b.y0) - Y(b.y1)) / 2)); }
    n.setAttribute("fill", /^#[0-9a-f]{6}$/i.test(pt.color || "") ? pt.color : "#ccc");
    if (pt.glow > 0.3) n.setAttribute("filter", "drop-shadow(0 0 3px " + pt.color + ")");
    svg.append(n);
  });
  return svg;
}

// A row of little chips naming each part, gold star on the good ones.
function partChips(parts) {
  const row = el("div", "facts");
  for (const p of parts) { const c = el("span", p.good ? "chip good-part" : "chip", `${p.what}${p.good ? " ★" : ""}`); c.title = p.name || ""; row.append(c); }
  return row;
}

function renderWorks(w) {
  const box = $("works");
  box.replaceChildren();
  if (!w) return;
  const d = w.dart;
  box.append(el("h4", null, d.name));
  const bar = el("div", "progress"), fill = el("i"); fill.style.width = `${d.progress}%`; bar.append(fill);
  box.append(bar, el("div", "muted", `${d.progress}% built · version ${d.version}${d.launched?.length ? ` · ${d.launched.length} finished before this one` : ""}`));
  const look = el("div", "ship-card");
  look.append(shipSVG(d.design), el("div", "muted", d.design ? `His design: ${d.design.description}` : "Still the plain scrap-dart look. He can design it any way he likes, whenever he wants."));
  box.append(look);
  const log = el("ul", "list");
  for (const l of (d.log || []).slice(0, 6)) log.append(el("li", null, `v${l.version}: ${l.change}`));
  box.append(log);
  if (d.parts?.length) {
    box.append(el("div", "muted", `Parts built into this one (${d.parts.length}), mounted on the ship in the hangar:`), partChips(d.parts));
  }
  if (d.launched?.length) {
    box.append(el("h4", null, "Finished ships"));
    const ul = el("ul", "list");
    for (const l of d.launched) { const li = el("li", "ship-card", `${l.name}, finished on day ${l.day}`); li.prepend(shipSVG(l.design)); if (l.design?.description) li.append(el("div", "muted", l.design.description)); if (l.parts?.length) li.append(partChips(l.parts)); ul.append(li); }
    box.append(ul);
  }
  if (w.flights?.length) {
    box.append(el("h4", null, "Test flights"));
    for (const f of w.flights.slice(0, 8)) {
      const card = el("div", "flight-card");
      card.append(el("div", "title", `${f.ship}: ${f.outcome}`), el("div", "meta muted", ago(f.at)), el("p", null, f.log));
      const btn = el("button", "link-btn", "Watch this flight");
      btn.type = "button";
      btn.onclick = () => { world?.setMode("follow"); world?.playFlight(f); window.scrollTo({ top: 0, behavior: "smooth" }); };
      card.append(btn);
      box.append(card);
    }
  }
  if (w.projects?.length) {
    box.append(el("h4", null, "Big projects he's building"));
    for (const p of w.projects) {
      const card = el("div", "flight-card");
      const bar = el("div", "progress"), fill = el("i"); fill.style.width = `${p.progress}%`; bar.append(fill);
      card.append(el("div", "title", p.name), bar, el("div", "muted", `${p.progress}% built · near ${({ hangar: "Hangar Bay 3", cantina: "the cantina", market: "the junk market", tower: "the comms tower", depot: "the fuel depot", ridge: "the dune ridge", flats: "the salt flats", crater: "the old crater", mesa: "the red mesa" })[p.place] || "the outpost"} · started day ${p.day}`));
      if (p.description) card.append(el("p", null, p.description));
      if (p.plan?.components?.length) card.append(el("div", "muted", `His plan${p.plan.purpose ? ` (for ${p.plan.purpose})` : ""}: ${p.plan.components.map((c) => c.name).join(", ")}`));
      const ul = el("ul", "list");
      for (const l of (p.log || []).slice(0, 8)) ul.append(el("li", null, `${l.progress}%: ${l.note}${l.town ? ` (${l.town})` : ""}`));
      card.append(ul);
      box.append(card);
    }
  }
  if (w.builds?.length) {
    box.append(el("h4", null, "Things he's built"));
    const ul = el("ul", "list");
    for (const b of w.builds) { const li = el("li", null, `${b.name} (near ${({ hangar: "Hangar Bay 3", cantina: "the cantina", market: "the junk market", tower: "the comms tower", depot: "the fuel depot", ridge: "the dune ridge" })[b.place] || "the outpost"})`); if (b.description) li.append(el("div", "muted", b.description)); if (b.took) li.append(el("div", "muted", `a big project: took ${b.took} work sessions`)); if (b.plan?.components?.length) li.append(el("div", "muted", `His plan${b.plan.purpose ? ` (for ${b.plan.purpose})` : ""}: ${b.plan.components.map((c) => c.name).join(", ")} · ${(b.parts || []).length} pieces`)); if (b.usedPart) li.append(el("div", "muted", `built with ${b.usedPartName ? `${b.usedPartName}, ` : ""}${b.usedPart}${b.usedPartGood ? " ★" : ""} (it sits on a plate beside it)`)); ul.append(li); }
    box.append(ul);
  }
  box.append(el("h4", null, "Tunes"));
  const tunes = el("ul", "list");
  for (const t of w.tunes.slice(0, 10)) tunes.append(el("li", null, `"${t.title}": ${t.notes}`));
  if (!w.tunes.length) tunes.append(el("li", "muted", "none yet"));
  box.append(tunes);
  box.append(el("h4", null, "Read on the Wire"));
  const reads = el("ul", "list");
  for (const r of w.reads.slice(0, 10)) {
    const li = el("li");
    const a = el("a", null, r.title); a.href = r.url || "#"; a.target = "_blank"; a.rel = "noopener nofollow";
    li.append(a);
    if (r.takeaway) li.append(el("div", "muted", r.takeaway));
    reads.append(li);
  }
  if (!w.reads.length) reads.append(el("li", "muted", "nothing yet"));
  box.append(reads);
  const C = w.crafting || {};
  if (C.recipes?.length || C.attempts?.length) {
    box.append(el("h4", null, "Parts he's invented"));
    const ul = el("ul", "list");
    for (const r of C.recipes || []) { const li = el("li", null, `${r.what} (made ${r.made}x, first on day ${r.day})`); if (r.how) li.append(el("div", "muted", `How: ${r.how}`)); if (r.uses) li.append(el("div", "muted", `For: ${r.uses}`)); ul.append(li); }
    const fails = (C.attempts || []).filter((a) => a.result !== "worked" && !(C.recipes || []).some((r) => r.what.toLowerCase() === a.what.toLowerCase()));
    for (const a of fails.slice(0, 5)) ul.append(el("li", "muted", `still trying: ${a.what}${a.how ? `. ${a.how}` : ""}`));
    if (!C.recipes?.length) ul.prepend(el("li", "muted", "nothing has worked yet"));
    box.append(ul);
  }
  box.append(el("h4", null, "Parts in his stash"));
  const stash = el("ul", "list");
  for (const p of w.stash) stash.append(el("li", p.good ? "good-part-text" : p.custom ? "made-part-text" : null, `${p.name}, ${p.what}${p.good ? " ★" : ""}${p.custom ? " (he made this)" : ""}`));
  if (!w.stash.length) stash.append(el("li", "muted", "empty"));
  box.append(el("div", "muted", "They sit on the shelf at the back of Hangar Bay 3. ★ = a good part."), stash);
  box.append(el("h4", null, "Signals sent into deep space"));
  const sig = el("ul", "list");
  for (const s of w.signals.slice(0, 6)) sig.append(el("li", null, `"${s.text}"`));
  if (!w.signals.length) sig.append(el("li", "muted", "none yet"));
  box.append(sig);
}

// Everything from his speech and thought bubbles, newest first, so nothing gets missed.
function renderSaid(s) {
  const box = $("said");
  if (!box) return;
  const list = s.said || [];
  const sig = JSON.stringify(list.slice(0, 3)) + list.length;
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(el("p", "muted", "Everything from his bubbles: things he says out loud (speech) and things he's thinking (thought). Newest at the top."));
  if (!list.length) box.append(el("p", "muted", "Nothing yet. This fills up from his next heartbeat."));
  for (const m of list) {
    const row = el("div", `said-row ${m.kind === "say" ? "said-say" : "said-think"}`);
    row.append(el("div", "said-kind", m.kind === "say" ? "said" : "thought"), el("div", "said-text", m.kind === "say" ? `"${m.text}"` : m.text), el("div", "meta muted", `${m.town || ""}${m.place ? ` · ${m.place}` : ""} · ${ago(m.at)}`));
    box.append(row);
  }
}

function renderMind(s, mem) {
  const box = $("mind");
  box.replaceChildren();
  box.append(el("h4", null, "Wants"));
  const wants = el("ul", "list");
  for (const w of s.wants || []) wants.append(el("li", null, w.text));
  if (!s.wants?.length) wants.append(el("li", "muted", "nothing in particular"));
  box.append(wants);
  box.append(el("h4", null, "Trying to figure out"));
  const puz = el("ul", "list");
  for (const q of s.puzzles || []) puz.append(el("li", null, q.text));
  if (s.nextSearch?.text) puz.append(el("li", "muted", `might look up on the Wire: "${s.nextSearch.text}"`));
  if (!puz.children.length) puz.append(el("li", "muted", "nothing right now"));
  box.append(puz);
  box.append(el("h4", null, "Promises"));
  const pr = el("ul", "list");
  for (const p of s.promises || []) pr.append(el("li", null, `to ${p.to}: ${p.what} (due ${ago(p.dueAt).replace(" ago", "")})`));
  if (!s.promises?.length) pr.append(el("li", "muted", "none open"));
  box.append(pr);
  box.append(el("h4", null, "Letters with his creator"));
  const th = [...(s.creatorThread || [])].slice(-40);
  if (!th.length) box.append(el("p", "muted", "He hasn't written to his creator yet."));
  // A small scrolling chat box, oldest at the top, newest at the bottom.
  const scroller = el("div", "thread");
  if (th.length) box.append(scroller);
  for (const m of th) {
    const row = el("div", `msg ${m.from === "zeeb" ? "from-zeeb" : "from-creator"}`);
    const who = el("div", "title");
    if (m.url) { const a = el("a", null, m.from === "zeeb" ? `Zeeb${m.subject ? `: ${m.subject}` : ""}` : "His creator"); a.href = m.url; a.target = "_blank"; a.rel = "noopener"; who.append(a); }
    else who.textContent = m.from === "zeeb" ? `Zeeb${m.subject ? `: ${m.subject}` : ""}` : "His creator";
    row.append(who, el("p", null, m.text.length > 400 ? m.text.slice(0, 400) + "..." : m.text), el("div", "meta muted", `${m.chat ? "live chat · " : ""}${ago(m.at)}`));
    scroller.append(row);
  }
  if (th.length) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; });
  if (mind_interests?.topics?.length) {
    box.append(el("h4", null, "Interests"));
    const ul = el("ul", "list");
    for (const t of mind_interests.topics.slice(0, 25)) {
      const li = el("li", null, t.name);
      if (t.obsession) li.append(el("span", "badge obsessed", "obsessed"));
      ul.append(li);
    }
    box.append(ul);
  }
  box.append(el("h4", null, "Beliefs"));
  const bl = el("ul", "list");
  for (const b of mem?.beliefs || []) bl.append(el("li", null, `${b.text} (evidence ${b.evidence})`));
  if (!mem?.beliefs?.length) bl.append(el("li", "muted", "still working things out"));
  box.append(bl);
  box.append(el("h4", null, "Memories (small on purpose: new ones push weak ones out)"));
  for (const m of [...(mem?.memories || [])].sort((a, b) => b.strength - a.strength)) {
    const row = el("div", "mem");
    const t = el("span", null, m.text);
    t.append(el("span", "tag", m.term));
    row.append(t, el("span", "s", `strength ${m.strength.toFixed(2)} · recalled ${m.recalls}`));
    box.append(row);
  }
}

function renderWho(c) {
  const box = $("who");
  box.replaceChildren();
  if (!c) return;
  box.append(el("h3", null, `${c.name}, ${c.kind}`), el("p", null, c.core), el("p", "muted", c.backstory));
  for (const k of ["traits", "values", "fears", "quirks"]) {
    box.append(el("h4", null, k));
    const ul = el("ul", "list");
    for (const x of c[k] || []) ul.append(el("li", null, x));
    for (const x of c.added?.[k] || []) { const li = el("li", null, x); li.append(el("span", "tag", "he added this")); ul.append(li); }
    box.append(ul);
  }
  box.append(el("h4", null, "voice"), el("p", "muted", c.voice));
}

function renderFriend(f) {
  const tab = $("friendTab");
  const stage = f?.stage || "none";
  tab.hidden = stage === "none";
  const box = $("friend");
  box.replaceChildren();
  if (stage === "building") {
    box.append(el("h3", null, "Zeeb is building a friend"));
    if (f.project.idea) box.append(el("p", "muted", `His idea: ${f.project.idea}`));
    const bar = el("div", "progress"), fill = el("i"); fill.style.width = `${f.project.progress}%`; bar.append(fill);
    box.append(bar, el("div", "muted", `${f.project.progress}% built`));
    const ul = el("ul", "list");
    for (const l of f.project.log.slice(0, 8)) ul.append(el("li", null, `${l.progress}%: ${l.note}`));
    if (f.project.parts?.length) box.append(el("div", "muted", "Parts in the frame:"), partChips(f.project.parts));
    box.append(ul);
    return;
  }
  if (stage !== "alive") return;
  const s = f.sheet, st = f.state;
  box.append(el("h3", null, `${s.name}, ${s.kind}`), el("p", null, s.core));
  box.append(el("p", "muted", `Built by Zeeb from scrap and a copy of his own blueprint. Woke up ${ago(f.bornAt)}.${s.why ? ` Zeeb says: "${s.why}"` : ""}`));
  box.append(el("h4", null, "Right now"));
  box.append(el("p", null, st.asleep ? "asleep in the charging dock" : `${st.doing}${st.feeling ? `, feeling ${st.feeling}` : ""}`));
  if (st.thought) box.append(el("p", "muted", `"${st.thought}"`));
  const two = (label, v) => { const row = el("div", "meter wide"); const bar = el("div", "bar two"), i = el("i"); const w = Math.abs(v) * 50; i.style.left = v >= 0 ? "50%" : `${50 - w}%`; i.style.width = `${w}%`; i.style.background = v >= 0 ? "var(--good)" : "var(--bad)"; bar.append(i); row.append(el("span", null, label), bar); return row; };
  box.append(two("Mood", st.mood), two("Energy", st.energy));
  box.append(el("h4", null, "Promises to Zeeb"));
  const pr = el("ul", "list");
  for (const p of f.promises) pr.append(el("li", null, p.what));
  if (!f.promises.length) pr.append(el("li", "muted", "none open"));
  box.append(pr);
  for (const k of ["traits", "values", "fears", "quirks"]) {
    box.append(el("h4", null, k));
    const ul = el("ul", "list");
    for (const x of [...(s[k] || []), ...((s.added || {})[k] || [])]) ul.append(el("li", null, x));
    box.append(ul);
  }
  box.append(el("h4", null, `${s.name}'s diary`));
  if (!f.diary.length) box.append(el("p", "muted", "nothing yet"));
  for (const e of f.diary.slice(0, 20)) {
    const div = el("div", "entry");
    div.append(el("div", "title", e.title), el("div", "meta muted", `day ${e.day} · ${e.time} · ${ago(e.at)}`), el("p", null, e.text));
    box.append(div);
  }
}

// ---------- arcade: games Zeeb wrote himself, played in a locked box ----------
const LOCK = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:">`;
async function playGame(file, holder) {
  holder.replaceChildren(el("div", "muted", "loading..."));
  const blob = await loadBlob(file);
  if (!blob) return holder.replaceChildren(el("div", "muted", "couldn't load the game"));
  let html = await blob.text();
  html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + LOCK) : LOCK + html;
  const frame = document.createElement("iframe");
  frame.className = "game-frame";
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("title", "Zeeb's game");
  frame.srcdoc = html;
  holder.replaceChildren(frame);
  frame.focus();
}
// Everything he owns: what's on him, what's on his shelf, and everything he's made.
function renderInventory(w, s, shop, games) {
  const box = $("inventory");
  if (!box || !w) return;
  box.replaceChildren();
  const part = (p) => { const li = el("li", p.good ? "good-part-text" : p.custom ? "made-part-text" : null, `${p.name}, ${p.what}${p.good ? " ★" : ""}${p.custom ? " (he made this)" : ""}`); return li; };
  const section = (title, items, empty) => {
    box.append(el("h4", null, title));
    const ul = el("ul", "list");
    for (const it of items) ul.append(typeof it === "string" ? el("li", null, it) : it);
    if (!items.length) ul.append(el("li", "muted", empty));
    box.append(ul);
  };
  const carrying = (w.stash || []).filter((p) => p.carrying), shelf = (w.stash || []).filter((p) => !p.carrying);
  box.append(el("p", "muted", "★ = a really good part · green = a part he invented and made himself"));
  section("On him right now", [`${s.credits ?? 0} credit${s.credits === 1 ? "" : "s"}`, ...carrying.map(part)], "nothing else");
  if (carrying.length) box.append(el("p", "muted", "Parts he picks up while he's out stay with him until he's back at the hangar."));
  section(`On his shelf in Hangar Bay 3 (${shelf.length})`, shelf.map(part), "empty");
  const C = w.crafting || {};
  section("Parts he's invented", (C.recipes || []).map((r) => `${r.what} (made ${r.made}x)${r.uses ? ` · for ${r.uses}` : ""}`), "none yet");
  const d = w.dart || {};
  section("Ships", [
    `${d.name || "the Little Dart"}: ${d.progress || 0}% built${d.parts?.length ? ` · ${d.parts.length} parts in it` : ""}${d.design ? " · his own design" : ""}`,
    ...(d.launched || []).map((l) => `${l.name}: finished on day ${l.day}${l.parts?.length ? ` · ${l.parts.length} parts` : ""}${l.design ? " · his own design" : ""}`),
  ], "none");
  const where = { hangar: "Hangar Bay 3", cantina: "the cantina", market: "the junk market", tower: "the comms tower", depot: "the fuel depot", ridge: "the dune ridge", flats: "the salt flats", crater: "the old crater", mesa: "the red mesa" };
  section(`Things he's built (${(w.builds || []).length})`, (w.builds || []).map((b) => {
    const models = (b.parts || []).filter((p) => p.model).length;
    return `${b.name} · near ${where[b.place] || "the outpost"} · ${(b.parts || []).length} pieces${models ? ` (${models} from his model library)` : ""}`;
  }), "nothing yet");
  if ((w.projects || []).length) section("Big projects in progress", w.projects.map((p) => `${p.name} · ${p.progress}% built`), "none");
  section(`Tunes (${(w.tunes || []).length})`, (w.tunes || []).slice(0, 8).map((t) => `"${t.title}"`), "none yet");
  if (games?.games?.length) section("Games", games.games.map((g) => `${g.title || g.idea}${g.released ? " (released)" : " (in progress)"}`), "none");
  if (shop?.open) section(`In his shop, "${shop.name || "his shop"}"`, (shop.items || []).map((i) => `${i.name}${i.price ? ` · ${i.price}` : ""}`), "nothing listed yet");
  section("Signals sent into deep space", [`${(w.signals || []).length} so far`], "none");
}

// Every page he's opened and every search he's made, newest first, by town day.
let webEntries = [];
function renderWeb(log) {
  if (log?.entries) webEntries = log.entries;
  const box = $("weblog");
  if (!box) return;
  const q = ($("webFilter")?.value || "").toLowerCase().trim();
  const items = webEntries.filter((e) => !q || `${e.title} ${e.url} ${e.query} ${e.takeaway}`.toLowerCase().includes(q));
  box.replaceChildren(el("p", "muted", `${webEntries.filter((e) => !e.failed).length} pages read so far${q ? ` · ${items.length} match` : ""}. Things on the internet aren't always true.`));
  let day = null;
  const ul = el("ul", "feed");
  for (const e of items.slice(0, 400)) {
    const d = (e.town || "").match(/day (\d+)/)?.[1] || "";
    if (d !== day) { day = d; ul.append(el("li", "day-head", d ? `Day ${d}` : "Earlier")); }
    const li = el("li", e.failed ? "k-did failed" : "k-noticed");
    li.append(el("span", "dot"));
    const body = el("div");
    const t = el("div", "text");
    if (e.url && !e.failed) { const a = el("a", null, e.title || e.url); a.href = e.url; a.target = "_blank"; a.rel = "noopener nofollow"; t.append(a); }
    else t.textContent = e.failed ? `Couldn't open ${e.title || "a page"}${e.error ? ` (${e.error})` : ""}` : e.title;
    body.append(t);
    let site = ""; try { site = e.url ? new URL(e.url).hostname.replace(/^www\./, "") : ""; } catch {}
    const bits = [site, e.query && e.query !== "(random page)" ? `searched "${e.query}"` : e.kind === "news" ? "from the news" : e.kind === "page" ? "followed a link" : "", (e.town || "").replace(/^day \d+\s*/, "")].filter(Boolean);
    if (e.takeaway) body.append(el("div", "why", e.takeaway));
    body.append(el("div", "meta", bits.join(" · ")));
    li.append(body);
    ul.append(li);
  }
  if (!items.length) ul.append(el("li", "muted", q ? "Nothing matches." : "He hasn't read anything on the Wire yet."));
  box.append(ul);
}
setTimeout(() => $("webFilter")?.addEventListener("input", () => renderWeb()), 0);

function renderArcade(g) {
  const games = g?.games || [];
  $("arcadeTab").hidden = !games.length;
  const box = $("arcade");
  if (box.dataset.sig === JSON.stringify(games.map((x) => [x.id, x.status, x.versions?.[0]?.v]))) return; // don't interrupt someone playing
  box.dataset.sig = JSON.stringify(games.map((x) => [x.id, x.status, x.versions?.[0]?.v]));
  box.replaceChildren();
  if (!games.length) return;
  box.append(el("p", "muted", "Games Zeeb wrote himself, code and all. They run in a locked box that can't reach anything else. Expect the odd bug: he's learning."));
  for (const game of games) {
    const card = el("div", "game-card");
    const head = el("div", "title", game.title);
    head.append(el("span", "badge", game.status === "released" ? "released" : game.status === "abandoned" ? "abandoned" : `in progress, v${game.versions?.[0]?.v || 0}`));
    card.append(head, el("p", "muted", game.idea));
    const v = game.versions?.[0];
    if (v?.changes) card.append(el("p", null, `Latest: ${v.changes}`));
    if (v?.error) card.append(el("p", "muted", `Known bug: ${v.error}`));
    const holder = el("div");
    if (game.playable) {
      const btn = el("button", "button", game.status === "released" ? "Play" : "Play test build");
      btn.type = "button";
      btn.onclick = () => playGame(game.playable, holder);
      card.append(btn);
    } else card.append(el("p", "muted", "No working version yet."));
    card.append(holder);
    box.append(card);
  }
}

let shopData = null;
function renderShop(shop) {
  shopData = shop;
  const tab = $("shopTab");
  tab.hidden = !shop?.open;
  const box = $("shop");
  box.replaceChildren();
  if (!shop?.open) return;
  const items = shop.items.filter((i) => i.active);
  box.append(el("h3", null, shop.name));
  box.append(el("p", "muted", `Zeeb opened this shop himself on ${new Date(shop.openedAt).toLocaleDateString()}. He picks what to sell, writes the descriptions and sets the prices. Everything here is made by Zeeb, an AI character. ${items.some((i) => i.link) ? "Payments go to his creator." : ""}`));
  if (!items.length) box.append(el("p", "muted", "The shelf is empty for now."));
  for (const it of items) {
    const row = el("div", "shop-item");
    const thumb = el("div", "shop-thumb", it.kind === "tune" ? "tune" : "...");
    if (it.kind !== "tune") typedUrl(it.file).then((u) => { if (u) { const img = el("img"); img.src = u; img.alt = it.name; thumb.replaceChildren(img); } });
    const body = el("div");
    body.append(el("div", "name", it.name), el("div", "price", it.currency === "credits" ? `${it.price} credits (in-world only)` : `${it.price.toFixed(2)} ${it.currency.toUpperCase()}`), el("p", null, it.description));
    const actions = el("div", "shop-actions");
    if (it.link) { const a = el("a", "button", "Buy"); a.href = it.link; a.target = "_blank"; a.rel = "noopener"; actions.append(a); }
    if (it.kind === "tune") {
      const btn = el("button", "link-btn", "Listen");
      btn.type = "button";
      btn.onclick = async () => { btn.textContent = "loading..."; const u = await typedUrl(it.file); if (u) { const au = el("audio"); au.controls = true; au.src = u; btn.replaceWith(au); au.play().catch(() => {}); } else btn.textContent = "couldn't load"; };
      actions.append(btn);
    }
    if (it.sales) actions.append(el("span", "muted", `${it.sales} sold`));
    body.append(actions);
    row.append(thumb, body);
    box.append(row);
  }
  maybeThanks();
}

let thanked = false;
function maybeThanks() {
  const id = new URLSearchParams(location.search).get("thanks");
  if (!id || thanked || !shopData) return;
  const it = shopData.items.find((i) => i.id === id);
  if (!it) return;
  thanked = true;
  $("thanksTitle").textContent = `Thank you for buying "${it.name}"!`;
  $("thanks").hidden = false;
  $("thanksClose").onclick = () => ($("thanks").hidden = true);
  $("thanksDownload").onclick = async () => {
    const u = await typedUrl(it.file);
    if (!u) return ($("thanksText").textContent = "The download didn't load. Try again in a minute.");
    const a = document.createElement("a");
    a.href = u; a.download = `zeeb-${it.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.${it.file.split(".").pop()}`;
    a.click();
  };
}

function tickClock() {
  if (!S?.epoch) return;
  const dayMs = (S.townDayMinutes || 180) * 60000;
  const total = Date.now() - S.epoch;
  const day = Math.floor(total / dayMs) + 1;
  const mins = Math.floor(((total % dayMs) / dayMs) * 1440);
  $("clock").textContent = `day ${day} · ${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

let slow = 0;
async function refresh() {
  const [s, feed, fr] = await Promise.all([load("state.json"), load("feed.json"), load("friend.json")]);
  if (!s) { $("status").textContent = "Zeeb's brain hasn't saved anything yet. Run the first heartbeat on GitHub."; return; }
  S = s;
  if (slow++ % 4 === 0 || !works) {
    const [w, d, mem, c, sh, gm, it, wl] = await Promise.all([load("works.json"), load("diary.json"), load("memories.json"), load("character.json"), load("shop.json"), load("games.json"), load("interests.json"), load("web-log.json")]);
    works = w || works;
    mind_interests = it;
    renderArcade(gm);
    world?.setExtras({ shopOpen: Boolean(sh?.open), gamesCount: gm?.games?.length || 0 });
    renderWorks(works); renderDiary(d); renderMind(s, mem); renderWho(c); renderShop(sh);
    renderInventory(works, s, sh, gm);
    renderWeb(wl || { entries: (works?.reads || []) });
  }
  world?.setState({ ...s, works });
  if (fr) { world?.setFriend(fr); renderFriend(fr); }
  renderStats(s);
  renderSaid(s);
  renderFeed(feed?.entries || []);
  world?.setBubbleLines(s, feed?.entries || []);
  $("status").textContent = `last heartbeat ${ago(s.updatedAt || new Date(s.lastTick).toISOString())}`;
}

refresh();
setInterval(refresh, 20000);
setInterval(tickClock, 1000);
