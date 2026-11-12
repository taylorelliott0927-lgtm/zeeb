// Zeeb's window onto the real internet ("the Wire"). Every source here is free and needs no key.
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
  };
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

export async function useWire(kind, query) {
  if (process.env.MOCK === "1") {
    return kind === "news"
      ? { kind, items: [{ source: "Test News", title: "A probe reached a comet", url: "https://example.com", text: "" }] }
      : { kind, query, found: true, title: `About ${query || "something"}`, url: "https://example.com", text: `${query} is a thing people study. It is quite interesting.`, others: [] };
  }
  try {
    if (kind === "search") {
      if (!query || query.length < 2) return await randomArticle();
      const r = await searchWire(query);
      return r.found ? r : await randomArticle().then((x) => ({ ...x, query, note: "nothing matched, so he clicked a random page" }));
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
