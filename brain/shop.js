// Zeeb's shop. It does nothing until Zeeb himself decides to open it (the open_shop action).
// He chooses what to sell, what to call it, the description and the price.
// Real money only flows if his creator has added a Stripe key (STRIPE_KEY). Without one, prices are in his in-world credits.
// Limits: only his own digital creations, prices between 1 and 20, at most 30 items, every item labelled as made by an AI character.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, clamp, fetchWithTimeout, log } from "./util.js";

const STRIPE_KEY = process.env.STRIPE_KEY || "";
const CURRENCY = (process.env.SHOP_CURRENCY || "cad").toLowerCase();
const REPO = process.env.GITHUB_REPOSITORY || "";
export const SITE_URL = process.env.SITE_URL || (REPO ? `https://${REPO.split("/")[0]}.github.io/${REPO.split("/")[1]}/` : "");
export const PRICE_MIN = 1, PRICE_MAX = 20, MAX_ITEMS = 30;
export const realMoney = () => Boolean(STRIPE_KEY);
export const currency = () => (realMoney() ? CURRENCY : "credits");

export const emptyShop = () => ({ open: false, name: "", openedAt: null, items: [], lastSalesCheck: null, totalSales: 0 });

// ---------- what he could sell ----------
export function sellable(works, shop) {
  const listed = new Set(shop.items.filter((i) => i.active).map((i) => i.source));
  const out = [];
  for (const t of works.tunes.slice(0, 8)) if (!listed.has(`tune:${t.id}`)) out.push({ source: `tune:${t.id}`, kind: "tune", what: `your tune "${t.title}" (${t.notes}) as a real audio file` });
  const d = works.dart;
  const bp = `blueprint:${d.name}:v${d.version}`;
  if (d.version > 0 && !listed.has(bp)) out.push({ source: bp, kind: "blueprint", what: `a signed blueprint drawing of ${d.name} as it is now (version ${d.version}, ${d.progress}% built)` });
  for (const l of d.launched || []) {
    const s = `blueprint:${l.name}:finished`;
    if (!listed.has(s)) out.push({ source: s, kind: "blueprint", what: `a signed blueprint of ${l.name}, finished on day ${l.day}` });
  }
  const pc = `postcard:rustwell`;
  if (!listed.has(pc)) out.push({ source: pc, kind: "postcard", what: "a postcard of Rustwell Outpost at sunset, signed by you" });
  return out;
}

// ---------- making the files ----------
const SHOP_DIR = () => path.join(DATA_DIR, "shop");

const FREQ = { bip: [880, 880], bwee: [660, 990], bop: [523, 523], doo: [392, 392], bzzt: [220, 220], tee: [1046, 1046], boop: [440, 330] };
export function tuneWav(notes) {
  const rate = 22050, words = String(notes).split("-").filter((w) => FREQ[w]);
  const seq = [...words, ...words, ...words.slice().reverse(), ...words];
  const noteLen = 0.22, gap = 0.04, total = Math.ceil(seq.length * (noteLen + gap) * rate) + rate / 2;
  const pcm = new Int16Array(total);
  let i = 0, phase = 0;
  for (const w of seq) {
    const [f0, f1] = FREQ[w], n = Math.floor(noteLen * rate);
    for (let k = 0; k < n && i < total; k++, i++) {
      const t = k / n, f = f0 + (f1 - f0) * t;
      phase += (2 * Math.PI * f) / rate;
      const env = Math.min(1, k / 200) * Math.min(1, (n - k) / 800);
      const wave = w === "bzzt" ? Math.sign(Math.sin(phase)) * 0.5 : Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.15;
      pcm[i] = Math.round(wave * env * 9000);
    }
    i += Math.floor(gap * rate);
  }
  const buf = Buffer.alloc(44 + pcm.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(pcm.length * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  return buf;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function blueprintSvg(name, version, progress, serial) {
  const parts = Math.max(1, Math.ceil((progress / 100) * 6));
  const show = (n, el) => (parts >= n ? el : el.replace(/stroke="#cfe8ff"/g, 'stroke="#cfe8ff" stroke-dasharray="4 6" opacity="0.35"'));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="800" height="520">
<rect width="800" height="520" fill="#123a6b"/>
<g stroke="#2b5c95" stroke-width="1">${Array.from({ length: 40 }, (_, i) => `<line x1="${i * 20}" y1="0" x2="${i * 20}" y2="520"/>`).join("")}${Array.from({ length: 26 }, (_, i) => `<line x1="0" y1="${i * 20}" x2="800" y2="${i * 20}"/>`).join("")}</g>
<g fill="none" stroke="#cfe8ff" stroke-width="3" stroke-linejoin="round">
${show(1, '<path d="M560 260 L660 260 L560 230 Z M560 260 L660 260 L560 290 Z" stroke="#cfe8ff"/>')}
${show(2, '<rect x="300" y="230" width="260" height="60" rx="20" stroke="#cfe8ff"/>')}
${show(3, '<path d="M380 230 L330 120 L470 230 M380 290 L330 400 L470 290" stroke="#cfe8ff"/>')}
${show(4, '<rect x="250" y="240" width="50" height="40" rx="6" stroke="#cfe8ff"/><path d="M250 248 L215 236 M250 272 L215 284" stroke="#cfe8ff"/>')}
${show(5, '<path d="M320 230 L300 180 L360 230" stroke="#cfe8ff"/>')}
${show(6, '<ellipse cx="500" cy="242" rx="38" ry="14" stroke="#cfe8ff"/>')}
</g>
<g fill="#cfe8ff" font-family="monospace">
<text x="40" y="60" font-size="30" font-weight="bold">${esc(String(name).toUpperCase())}</text>
<text x="40" y="92" font-size="18">VERSION ${version} . ${progress}% BUILT . HANGAR BAY 3, RUSTWELL OUTPOST</text>
<text x="40" y="480" font-size="16">BLUEPRINT No. ${serial}  .  MADE BY ZEEB, AN AI CHARACTER</text>
<text x="600" y="480" font-size="26" font-style="italic">- zeeb</text>
</g></svg>`;
}

export function postcardSvg(rating, serial) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" width="800" height="520">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a6b"/><stop offset="0.55" stop-color="#e8743b"/><stop offset="1" stop-color="#f7c873"/></linearGradient></defs>
<rect width="800" height="520" fill="url(#s)"/>
<circle cx="520" cy="300" r="46" fill="#ffe8a8"/><circle cx="610" cy="330" r="26" fill="#ffd0a0"/>
<path d="M0 380 Q 150 330 300 370 T 600 360 T 800 350 L800 520 L0 520 Z" fill="#c98a4b"/>
<path d="M0 430 Q 200 400 420 440 T 800 420 L800 520 L0 520 Z" fill="#a8693a"/>
<path d="M120 400 A 60 60 0 0 1 240 400 Z" fill="#3a2a3a"/><rect x="330" y="330" width="8" height="70" fill="#3a2a3a"/><circle cx="334" cy="326" r="5" fill="#ff5a4a"/>
<g fill="#fff8ee" font-family="Georgia, serif">
<text x="40" y="70" font-size="34" font-style="italic">Greetings from Rustwell Outpost</text>
<text x="40" y="104" font-size="18">desert moon Kessa-9 . tonight's sunset: ${rating}/10</text>
<text x="40" y="490" font-size="14" font-family="monospace">POSTCARD No. ${serial} . MADE BY ZEEB, AN AI CHARACTER</text>
<text x="620" y="490" font-size="28" font-style="italic">- zeeb</text>
</g></svg>`;
}

function makeFile(item, works) {
  fs.mkdirSync(SHOP_DIR(), { recursive: true });
  const [kind, a, b] = item.source.split(":");
  let file, data;
  if (kind === "tune") {
    const t = works.tunes.find((x) => String(x.id) === a);
    if (!t) return null;
    file = `${item.id}.wav`; data = tuneWav(t.notes);
  } else if (kind === "blueprint") {
    const d = works.dart;
    const finished = b === "finished";
    file = `${item.id}.svg`;
    data = blueprintSvg(a, finished ? "final" : d.version, finished ? 100 : d.progress, item.serial);
  } else {
    file = `${item.id}.svg`;
    data = postcardSvg(works.lastSunsetRating || 8, item.serial);
  }
  fs.writeFileSync(path.join(SHOP_DIR(), file), data);
  return `shop/${file}`;
}

// ---------- Stripe (only with a key) ----------
async function stripe(method, endpoint, params) {
  const body = params ? new URLSearchParams(params).toString() : undefined;
  const res = await fetchWithTimeout(`${process.env.STRIPE_API_BASE || "https://api.stripe.com/v1"}/${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${j?.error?.message || "error"}`);
  return j;
}

async function stripeList(item) {
  const product = await stripe("POST", "products", {
    name: item.name,
    description: `${item.description} (Made by Zeeb, an AI character. A digital download.)`.slice(0, 500),
    "metadata[zeeb_item]": item.id,
  });
  const price = await stripe("POST", "prices", { product: product.id, currency: CURRENCY, unit_amount: String(Math.round(item.price * 100)) });
  const link = await stripe("POST", "payment_links", {
    "line_items[0][price]": price.id,
    "line_items[0][quantity]": "1",
    "after_completion[type]": "redirect",
    "after_completion[redirect][url]": `${SITE_URL}?thanks=${item.id}`,
    "metadata[zeeb_item]": item.id,
  });
  return { link: link.url, linkId: link.id };
}

// ---------- changes Zeeb makes ----------
// change = {"open": "shop name"} | {"list": {"source","name","description","price"}} | {"unlist": "item id"} | {"reprice": {"id","price"}} | {"close": true}
export async function applyShopChange(shop, works, change, nowISO, post) {
  if (!change || typeof change !== "object") return [];
  const happened = [];
  if (change.open && !shop.open) {
    shop.open = true;
    shop.name = String(change.open).slice(0, 60) || "Zeeb's Hangar Shop";
    shop.openedAt = nowISO;
    happened.push(`opened his shop, "${shop.name}"`);
  }
  if (!shop.open) return happened;
  if (change.close) {
    for (const it of shop.items.filter((i) => i.active)) await deactivate(it);
    shop.open = false;
    happened.push("closed his shop");
    return happened;
  }
  if (change.list && shop.items.filter((i) => i.active).length < MAX_ITEMS) {
    const l = change.list;
    const option = sellable(works, shop).find((s) => s.source === l.source);
    if (option) {
      const item = {
        id: `z${Date.parse(nowISO).toString(36)}`,
        serial: shop.items.filter((i) => i.kind === option.kind).length + 1,
        source: option.source,
        kind: option.kind,
        name: String(l.name || option.what).slice(0, 80),
        description: String(l.description || "").slice(0, 400),
        price: Math.round(clamp(Number(l.price) || 3, PRICE_MIN, PRICE_MAX) * 100) / 100,
        currency: currency(),
        listedAt: nowISO,
        active: true,
        sales: 0,
      };
      item.file = makeFile(item, works);
      if (item.file) {
        if (realMoney()) {
          try { Object.assign(item, await stripeList(item)); }
          catch (e) { log("Stripe listing failed:", e.message); item.currency = "credits"; item.note = "real-money link failed; listed for credits"; }
        }
        shop.items.unshift(item);
        happened.push(`put "${item.name}" in his shop for ${item.price} ${item.currency}`);
      }
    }
  }
  if (change.unlist) {
    const it = shop.items.find((i) => i.id === change.unlist && i.active);
    if (it) { await deactivate(it); happened.push(`took "${it.name}" out of his shop`); }
  }
  if (change.reprice?.id) {
    const it = shop.items.find((i) => i.id === change.reprice.id && i.active);
    const price = Math.round(clamp(Number(change.reprice.price) || it?.price || 3, PRICE_MIN, PRICE_MAX) * 100) / 100;
    if (it && price !== it.price) {
      // A new price means a new link; the old one is switched off.
      await deactivate(it);
      const copy = { ...it, id: `z${Date.parse(nowISO).toString(36)}r`, price, listedAt: nowISO, active: true, sales: 0, link: undefined, linkId: undefined };
      if (realMoney()) { try { Object.assign(copy, await stripeList(copy)); } catch (e) { log("Stripe reprice failed:", e.message); } }
      shop.items.unshift(copy);
      happened.push(`changed the price of "${it.name}" to ${price} ${copy.currency}`);
    }
  }
  return happened;
}

async function deactivate(it) {
  it.active = false;
  if (it.linkId && realMoney()) {
    try { await stripe("POST", `payment_links/${it.linkId}`, { active: "false" }); } catch (e) { log("Stripe unlist failed:", e.message); }
  }
}

// Check for new sales about once an hour (real money only).
export async function checkSales(shop, nowMs) {
  if (!realMoney() || !shop.open) return [];
  if (shop.lastSalesCheck && nowMs - Date.parse(shop.lastSalesCheck) < 55 * 60000) return [];
  shop.lastSalesCheck = new Date(nowMs).toISOString();
  const sold = [];
  for (const it of shop.items.filter((i) => i.linkId)) {
    try {
      const j = await stripe("GET", `checkout/sessions?payment_link=${it.linkId}&status=complete&limit=100`);
      const n = (j.data || []).length;
      if (n > it.sales) { sold.push({ item: it, count: n - it.sales }); shop.totalSales += n - it.sales; it.sales = n; }
    } catch (e) { log("Stripe sales check failed:", e.message); break; }
  }
  return sold;
}
