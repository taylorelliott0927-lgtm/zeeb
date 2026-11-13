import { World } from "./world3d.js?v=18";

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

function renderFeed(entries) {
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
  const log = el("ul", "list");
  for (const l of (d.log || []).slice(0, 6)) log.append(el("li", null, `v${l.version}: ${l.change}`));
  box.append(log);
  if (d.parts?.length) {
    box.append(el("div", "muted", `Parts built into this one (${d.parts.length}), mounted on the ship in the hangar:`), partChips(d.parts));
  }
  if (d.launched?.length) {
    box.append(el("h4", null, "Finished ships"));
    const ul = el("ul", "list");
    for (const l of d.launched) { const li = el("li", null, `${l.name}, finished on day ${l.day}`); if (l.parts?.length) li.append(partChips(l.parts)); ul.append(li); }
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
  if (w.builds?.length) {
    box.append(el("h4", null, "Things he's built"));
    const ul = el("ul", "list");
    for (const b of w.builds) { const li = el("li", null, `${b.name} (near ${({ hangar: "Hangar Bay 3", cantina: "the cantina", market: "the junk market", tower: "the comms tower", depot: "the fuel depot", ridge: "the dune ridge" })[b.place] || "the outpost"})`); if (b.description) li.append(el("div", "muted", b.description)); if (b.usedPart) li.append(el("div", "muted", `built with ${b.usedPartName ? `${b.usedPartName}, ` : ""}${b.usedPart}${b.usedPartGood ? " ★" : ""} (it sits on a plate beside it)`)); ul.append(li); }
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
  box.append(el("h4", null, "Parts in his stash"));
  const stash = el("ul", "list");
  for (const p of w.stash) stash.append(el("li", p.good ? "good-part-text" : null, `${p.name}, ${p.what}${p.good ? " ★" : ""}`));
  if (!w.stash.length) stash.append(el("li", "muted", "empty"));
  box.append(el("div", "muted", "They sit on the shelf at the back of Hangar Bay 3. ★ = a good part."), stash);
  box.append(el("h4", null, "Signals sent into deep space"));
  const sig = el("ul", "list");
  for (const s of w.signals.slice(0, 6)) sig.append(el("li", null, `"${s.text}"`));
  if (!w.signals.length) sig.append(el("li", "muted", "none yet"));
  box.append(sig);
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
    for (const t of mind_interests.topics.slice(0, 8)) {
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
    const [w, d, mem, c, sh, gm, it] = await Promise.all([load("works.json"), load("diary.json"), load("memories.json"), load("character.json"), load("shop.json"), load("games.json"), load("interests.json")]);
    works = w || works;
    mind_interests = it;
    renderArcade(gm);
    world?.setExtras({ shopOpen: Boolean(sh?.open), gamesCount: gm?.games?.length || 0 });
    renderWorks(works); renderDiary(d); renderMind(s, mem); renderWho(c); renderShop(sh);
  }
  world?.setState({ ...s, works });
  if (fr) { world?.setFriend(fr); renderFriend(fr); }
  renderStats(s);
  renderFeed(feed?.entries || []);
  world?.setBubbleLines(s, feed?.entries || []);
  $("status").textContent = `last heartbeat ${ago(s.updatedAt || new Date(s.lastTick).toISOString())}`;
}

refresh();
setInterval(refresh, 30000);
setInterval(tickClock, 1000);
