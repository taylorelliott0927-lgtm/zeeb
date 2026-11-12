import { World } from "./world3d.js";

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
let S = null, works = null;

function renderStats(s) {
  $("doing").textContent = s.asleep ? "asleep in the charging dock" : `${s.doing} at ${s.placeName || "the outpost"}`;
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
  if (!d?.entries?.length) return box.append(el("p", "muted", "Zeeb writes in his diary each night when he plugs in to sleep."));
  for (const e of d.entries) {
    const div = el("div", "entry");
    div.append(el("div", "title", `Day ${e.day}: ${e.title}`), el("p", null, e.text));
    if (e.dream) div.append(el("p", "muted", `dreamed: ${e.dream}`));
    const added = Object.entries(e.added || {}).flatMap(([k, v]) => v.map((x) => `${k.slice(0, -1)}: ${x}`));
    if (added.length) div.append(el("p", "muted", `added to himself: ${added.join("; ")}`));
    box.append(div);
  }
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
  for (const p of w.stash) stash.append(el("li", null, `${p.name}, ${p.what}`));
  if (!w.stash.length) stash.append(el("li", "muted", "empty"));
  box.append(stash);
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
  box.append(el("h4", null, "Promises"));
  const pr = el("ul", "list");
  for (const p of s.promises || []) pr.append(el("li", null, `to ${p.to}: ${p.what} (due ${ago(p.dueAt).replace(" ago", "")})`));
  if (!s.promises?.length) pr.append(el("li", "muted", "none open"));
  box.append(pr);
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
  const [s, feed] = await Promise.all([load("state.json"), load("feed.json")]);
  if (!s) { $("status").textContent = "Zeeb's brain hasn't saved anything yet. Run the first heartbeat on GitHub."; return; }
  S = s;
  if (slow++ % 4 === 0 || !works) {
    const [w, d, mem, c] = await Promise.all([load("works.json"), load("diary.json"), load("memories.json"), load("character.json")]);
    works = w || works;
    renderWorks(works); renderDiary(d); renderMind(s, mem); renderWho(c);
  }
  world?.setState({ ...s, works });
  renderStats(s);
  renderFeed(feed?.entries || []);
  $("status").textContent = `last heartbeat ${ago(s.updatedAt || new Date(s.lastTick).toISOString())}`;
}

refresh();
setInterval(refresh, 30000);
setInterval(tickClock, 1000);
