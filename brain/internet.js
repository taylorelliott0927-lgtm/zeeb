// Zeeb's window onto the real internet ("the Wire"). Every source here is free and needs no key.
import dns from "node:dns/promises";
import net from "node:net";
import { fetchWithTimeout, log, pick } from "./util.js";

const UA = {
  "User-Agent": `ZeebBot/1.0 (a little virtual bot; https://github.com/${process.env.GITHUB_REPOSITORY || "zeeb"})`,
  Accept: "application/json",
};

async function getJSON(url) {
  const res = await fetchWithTimeout(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

const trim = (s, n = 900) => (s || "").replace(/\s+/g, " ").trim().slice(0, n);

const STOP = new Set(["about", "with", "that", "this", "from", "into", "what", "when", "where", "which", "there", "their", "them", "then", "than", "some", "more", "need", "want", "just", "better", "information", "inspiration", "gather", "find", "look", "looking", "ideas", "make", "making", "ensure", "little", "dart", "zeeb", "would", "could", "should", "maybe", "really", "things", "thing"]);

// Search Wikipedia and read the best match.
export async function searchWire(query) {
  const q = encodeURIComponent(query.slice(0, 120));
  const search = await getJSON(
    `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=5&format=json&origin=*`
  );
  const hits = search?.query?.search || [];
  if (!hits.length) return { kind: "search", query, found: false, items: [] };
  // Mostly the top hit, sometimes a rabbit hole.
  const hit = Math.random() < 0.75 ? hits[0] : pick(hits);
  const summary = await getJSON(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`
  );
  return {
    kind: "search",
    query,
    found: true,
    title: summary.title,
    url: summary?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
    text: trim(summary.extract),
    others: hits.filter((h) => h.title !== hit.title).map((h) => h.title).slice(0, 4),
    links: await wikiLinks(hit.title),
  };
}

// The outside websites a Wikipedia article points to, so he can follow them somewhere new.
async function wikiLinks(title) {
  try {
    const d = await getJSON(`https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=externallinks&format=json&origin=*`);
    return (d?.parse?.externallinks || []).filter((u) => /^https?:/.test(u) && !/wikipedia|wikimedia|wikidata|archive\.org|doi\.org|worldcat|jstor|google\./.test(u) && !BLOCKED.test(u)).slice(0, 10)
      .map((u) => { try { const x = new URL(u); return { title: `${x.hostname.replace(/^www\./, "")}${x.pathname.length > 1 ? x.pathname.slice(0, 50) : ""}`, url: u }; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export async function randomArticle() {
  const s = await getJSON("https://en.wikipedia.org/api/rest_v1/page/random/summary");
  return {
    kind: "search", query: "(random page)", found: true, title: s.title,
    url: s?.content_urls?.desktop?.page, text: trim(s.extract), others: [],
  };
}

async function spaceNews() {
  const d = await getJSON("https://api.spaceflightnewsapi.net/v4/articles/?limit=6");
  return (d.results || []).map((a) => ({
    source: a.news_site, title: a.title, url: a.url, text: trim(a.summary, 280),
  }));
}

async function hackerNews() {
  const ids = (await getJSON("https://hacker-news.firebaseio.com/v0/topstories.json")).slice(0, 6);
  const items = await Promise.all(
    ids.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null))
  );
  return items.filter(Boolean).map((i) => ({
    source: "Hacker News", title: i.title, url: i.url || `https://news.ycombinator.com/item?id=${i.id}`, text: "",
  }));
}

export async function readNews() {
  const [space, hn] = await Promise.allSettled([spaceNews(), hackerNews()]);
  const items = [
    ...(space.status === "fulfilled" ? space.value.slice(0, 4) : []),
    ...(hn.status === "fulfilled" ? hn.value.slice(0, 3) : []),
  ];
  if (!items.length) throw new Error("no news sources answered");
  return { kind: "news", items };
}

// ---------- the open web: free search, reading any public page, following links ----------
// A normal browser signature: many sites (and search engines) turn away anything that calls itself a bot.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_BYTES = 1_500_000;
// Only grown-up content filters here are basic: obvious adult or gambling sites are skipped.
const BLOCKED = /(porn|xxx|xvideo|xhamster|onlyfans|hentai|sex(?!t)|nsfw|casino|betting|bet365|gambl)/i;

const isPrivateIP = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:") && isPrivateIP(v.slice(7));
};

// Public websites only: never your home network, your router or this computer.
export async function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443"].includes(u.port)) return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan|.*\.home)$/i.test(host)) return null;
  if (BLOCKED.test(host)) return null;
  if (net.isIP(host)) return isPrivateIP(host) ? null : u;
  try {
    const addrs = await dns.lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIP(a.address))) return null;
  } catch { return null; }
  return u;
}

const decode = (s) => String(s || "")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export function pageToText(html, baseUrl) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim().slice(0, 140);
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = (body.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i) || [])[2] || body;
  const text = decode(main.replace(/<\/(p|div|h\d|li|br|tr)>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 40).join("\n").slice(0, 3200);
  const links = [];
  const seen = new Set();
  for (const m of main.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decode(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (label.length < 4 || label.length > 90) continue;
    let href;
    try { href = new URL(decode(m[1]), baseUrl).href; } catch { continue; }
    if (!/^https?:/.test(href) || seen.has(href) || BLOCKED.test(href)) continue;
    seen.add(href);
    links.push({ title: label, url: href });
    if (links.length >= 60) break;
  }
  // Mix links that lead to other websites in with the page's own, so there's always somewhere new to wander.
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const home = host(baseUrl);
  const away = links.filter((l) => host(l.url) !== home), own = links.filter((l) => host(l.url) === home);
  const mixed = [];
  while (mixed.length < 12 && (away.length || own.length)) { if (away.length) mixed.push(away.shift()); if (own.length && mixed.length < 12) mixed.push(own.shift()); }
  return { title, text, links: mixed };
}

export async function readPage(raw) {
  let url = await safeUrl(raw);
  if (!url) return { kind: "page", failed: true, error: "that address isn't a public website he's allowed to open", url: String(raw) };
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetchWithTimeout(url.href, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html,text/plain;q=0.9" }, redirect: "manual" }, 15000);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location"), url).href);
      if (!url) return { kind: "page", failed: true, error: "the page tried to send him somewhere he isn't allowed" };
      continue;
    }
    if (!res.ok) return { kind: "page", failed: true, error: `the site answered ${res.status}`, url: url.href };
    const type = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) return { kind: "page", failed: true, error: "that link isn't a web page he can read (it's a file)", url: url.href };
    const reader = res.body.getReader();
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length; chunks.push(value);
      if (size > MAX_BYTES) { reader.cancel().catch(() => {}); break; }
    }
    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    const page = /text\/plain/i.test(type) ? { title: url.hostname, text: html.slice(0, 3200), links: [] } : pageToText(html, url.href);
    if (!page.text) return { kind: "page", failed: true, error: "the page had nothing he could read (it probably needs a full browser)", url: url.href };
    return { kind: "page", found: true, title: page.title || url.hostname, url: url.href, site: url.hostname.replace(/^www\./, ""), text: page.text, links: page.links };
  }
  return { kind: "page", failed: true, error: "too many redirects" };
}

// Free web search with no key. Several search engines, tried in turn until one answers
// (DuckDuckGo, DuckDuckGo Lite, Mojeek, Marginalia and Wiby, which finds small independent websites).
async function getHTML(url) {
  const res = await fetchWithTimeout(url, { headers: { "User-Agent": BROWSER_UA, Accept: "text/html", "Accept-Language": "en" } }, 15000);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}
const ENGINES = {
  duckduckgo: async (q) => parseSearch(await getHTML(`https://html.duckduckgo.com/html/?q=${q}`)),
  duckduckgo_lite: async (q) => parseLinks(await getHTML(`https://lite.duckduckgo.com/lite/?q=${q}`), /<a[^>]*href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi),
  mojeek: async (q) => parseLinks(await getHTML(`https://www.mojeek.com/search?q=${q}`), /<a[^>]*class=["']title["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  marginalia: async (q) => ((await getJSON(`https://api.marginalia.nu/public/search/${q}?count=10`))?.results || []).map((r) => ({ title: r.title || r.url, url: r.url })),
  wiby: async (q) => ((await getJSON(`https://wiby.me/json/?q=${q}`)) || []).map((r) => ({ title: r.Title || r.URL, url: r.URL })),
};
export async function webSearch(query) {
  const q = encodeURIComponent(query.slice(0, 150));
  for (const [name, engine] of Object.entries(ENGINES)) {
    try {
      const results = (await engine(q)).filter((r) => /^https?:/.test(r.url) && !BLOCKED.test(r.url)).slice(0, 10);
      if (results.length) { log(`searched with ${name}: ${results.length} results`); return results; }
    } catch (e) { log(`${name} search didn't answer (${e.message})`); }
  }
  return [];
}
export function parseLinks(html, re) {
  const out = [];
  for (const m of html.matchAll(re)) {
    let href = decode(m[1]);
    const ud = href.match(/[?&]uddg=([^&]+)/);
    if (ud) href = decodeURIComponent(ud[1]);
    if (href.startsWith("//")) href = "https:" + href;
    const title = decode(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (/^https?:/.test(href) && title && !/duckduckgo\.com|mojeek\.com/.test(href)) out.push({ title, url: href });
    if (out.length >= 10) break;
  }
  return out;
}

export function parseSearch(html) {
  const results = [];
  for (const m of html.matchAll(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = decode(m[1]);
    const ud = href.match(/[?&]uddg=([^&]+)/);
    if (ud) href = decodeURIComponent(ud[1]);
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:/.test(href) || BLOCKED.test(href) || /duckduckgo\.com\/y\.js|ad_domain/.test(href)) continue;
    const title = decode(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    results.push({ title, url: href });
    if (results.length >= 8) break;
  }
  return results;
}

// Search the web, then open one of the results (usually the top one) and read it.
async function searchAndRead(query, recentSites = []) {
  let results = [];
  try { results = await webSearch(query); } catch (e) { log("web search failed:", e.message); }
  if (!results.length) return null;
  // Sites he hasn't read lately go first, so he keeps finding new places instead of the same few.
  const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const fresh = results.filter((r) => !recentSites.includes(site(r.url))), seen = results.filter((r) => recentSites.includes(site(r.url)));
  const order = [...(Math.random() < 0.7 ? fresh : [pick(fresh.length ? fresh : results), ...fresh]), ...seen];
  for (const r of order.slice(0, 5)) {
    try {
      const page = await readPage(r.url);
      if (page.found) return { ...page, kind: "search", query, others: results.filter((x) => x.url !== page.url).map((x) => x.title).slice(0, 5), links: [...results.filter((x) => x.url !== page.url), ...(page.links || [])].slice(0, 12) };
    } catch {}
  }
  return null;
}

export async function useWire(kind, query, recentSites = []) {
  if (process.env.MOCK === "1") {
    if (kind === "page") return { kind, found: true, title: "A test page", url: query || "https://example.com", site: "example.com", text: "This is a page about something. It has words in it.", links: [{ title: "Another page", url: "https://example.com/2" }] };
    return kind === "news"
      ? { kind, items: [{ source: "Test News", title: "A probe reached a comet", url: "https://example.com", text: "" }] }
      : { kind, query, found: true, title: `About ${query || "something"}`, url: "https://example.com", text: `${query} is a thing people study. It is quite interesting.`, others: [], links: [{ title: "More about it", url: "https://example.com/more" }] };
  }
  try {
    if (kind === "page") return await readPage(query);
    if (kind === "search") {
      if (!query || query.length < 2) return await randomArticle();
      const web = await searchAndRead(query, recentSites);
      if (web) return web;
      const r = await searchWire(query);
      if (r.found) return r;
      // Long, chatty searches often find nothing: try again with just the main words before giving up.
      const short = query.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).slice(0, 4).join(" ");
      if (short && short !== query.toLowerCase()) {
        const again = (await searchAndRead(short, recentSites)) || (await searchWire(short));
        if (again && again.found !== false) return { ...again, query };
      }
      return { kind, query, failed: true, error: "nothing came up for that search" };
    }
    return await readNews();
  } catch (e) {
    log("wire failed:", e.message);
    return { kind, query, failed: true, error: e.message };
  }
}

// Real weather from a real desert town becomes the outpost's weather.
export async function realWeather(src) {
  try {
    const d = await getJSON(
      `https://api.open-meteo.com/v1/forecast?latitude=${src.lat}&longitude=${src.lon}&current=temperature_2m,wind_speed_10m,weather_code`
    );
    const c = d.current || {};
    return toWeather(c.temperature_2m, c.wind_speed_10m, c.weather_code, src.name);
  } catch (e) {
    log("weather failed:", e.message);
    return null;
  }
}

export function toWeather(temp, wind, code, source = "") {
  let kind = "clear";
  if (wind >= 28) kind = "sandstorm";
  else if (wind >= 18) kind = "windy";
  else if (code >= 51) kind = "rare rain";
  else if (code >= 2) kind = "hazy";
  else if (temp >= 34) kind = "scorching";
  const mood = { clear: 0.01, sandstorm: -0.06, windy: -0.01, "rare rain": 0.05, hazy: 0, scorching: -0.02 }[kind];
  return { kind, temp: Math.round(temp ?? 25), wind: Math.round(wind ?? 5), mood, source, at: new Date().toISOString() };
}
