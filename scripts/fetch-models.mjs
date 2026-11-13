// Builds Zeeb's model library: free (CC0, public domain) low-poly 3D models by Kenney (kenney.nl).
// Run by the "Fetch model library" GitHub Action. It downloads the packs, keeps the .glb models,
// measures each one, and writes web/models/catalog.json so Zeeb can search it by name and tags.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.env.MODELS_OUT || path.join(ROOT, "web", "models");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "zeeb-models-"));
const MAX_FILE = 600 * 1024;        // skip anything heavy so the site stays quick
const MAX_TOTAL = 60 * 1024 * 1024; // whole library stays under about 60 MB

// Kenney packs (all CC0). Each pack name also becomes a tag, so "space" finds the space kits.
const PACKS = [
  "space-kit", "space-station-kit", "modular-space-kit", "furniture-kit", "nature-kit", "survival-kit",
  "city-kit-commercial", "city-kit-suburban", "city-kit-industrial", "car-kit", "food-kit", "tower-defense-kit",
  "conveyor-kit", "factory-kit", "mini-arena", "blaster-kit", "platformer-kit", "pirate-kit", "castle-kit",
  "graveyard-kit", "holiday-kit", "retro-urban-kit", "mini-market", "hexagon-kit", "fantasy-town-kit",
];
// Kenney's own GitHub starter kits (also CC0), as a backup source if the website download is unavailable.
const REPOS = [
  "KenneyNL/Starter-Kit-City-Builder", "KenneyNL/Starter-Kit-3D-Platformer", "KenneyNL/Starter-Kit-FPS",
  "KenneyNL/Starter-Kit-Racing", "KenneyNL/Starter-Kit-Basic-Scene",
];

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" };
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const words = (s) => String(s).toLowerCase().replace(/kenney|_|-|\.glb/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));

// Read a .glb and measure it (bounding box of every mesh, with the scene's transforms applied).
function measure(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) return null;
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  if ((gltf.buffers || []).some((b) => b.uri)) return null; // needs extra files: skip
  if ((gltf.images || []).some((i) => i.uri)) return null;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let tris = 0;
  const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  const trs = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], t = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0], t[1], t[2], 1];
  };
  const visit = (i, parent) => {
    const n = gltf.nodes[i], m = mul(parent, trs(n));
    if (n.mesh !== undefined) for (const p of gltf.meshes[n.mesh].primitives) {
      const a = gltf.accessors[p.attributes.POSITION];
      if (!a?.min || !a?.max) continue;
      tris += (p.indices !== undefined ? gltf.accessors[p.indices].count : a.count) / 3;
      for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
        const v = [m[0] * cx + m[4] * cy + m[8] * cz + m[12], m[1] * cx + m[5] * cy + m[9] * cz + m[13], m[2] * cx + m[6] * cy + m[10] * cz + m[14]];
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
      }
    }
    for (const c of n.children || []) visit(c, m);
  };
  const scene = gltf.scenes?.[gltf.scene || 0];
  for (const i of scene?.nodes || []) visit(i, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  if (!Number.isFinite(min[0]) || tris > 20000) return null;
  return { min: min.map((v) => +v.toFixed(3)), max: max.map((v) => +v.toFixed(3)), tris: Math.round(tris) };
}

const catalog = [];
let total = 0;
function addFrom(dir, pack) {
  const all = walk(dir).filter((f) => f.toLowerCase().endsWith(".glb"));
  // Kenney packs ship each model in a few formats; the "GLB format" folder is the one we want.
  const preferred = all.filter((f) => /glb[ _-]?format/i.test(f));
  let added = 0;
  for (const f of preferred.length ? preferred : all) {
    const size = fs.statSync(f).size;
    if (size > MAX_FILE || total + size > MAX_TOTAL) continue;
    const base = path.basename(f, ".glb").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const id = `${pack}/${base}`;
    if (catalog.some((c) => c.id === id)) continue;
    let m;
    try { m = measure(f); } catch { m = null; }
    if (!m) continue;
    fs.mkdirSync(path.join(OUT, pack), { recursive: true });
    fs.copyFileSync(f, path.join(OUT, pack, `${base}.glb`));
    total += size;
    const name = words(base).join(" ") || base;
    catalog.push({ id, name, tags: [...new Set([...words(pack), ...words(base)])].filter((t) => t !== "kit"), min: m.min, max: m.max });
    added++;
  }
  console.log(`  ${pack}: ${added} models`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// For testing: build the library from a local folder instead of downloading.
if (process.env.MODELS_LOCAL) { addFrom(process.env.MODELS_LOCAL, "test-kit"); PACKS.length = 0; REPOS.length = 0; }
for (const pack of PACKS) {
  try {
    const page = await (await fetch(`https://kenney.nl/assets/${pack}`, { headers: UA })).text();
    const zip = (page.match(/href="([^"]+\.zip)"/i) || [])[1];
    if (!zip) { console.log(`  ${pack}: no download found, skipped`); continue; }
    const url = new URL(zip, "https://kenney.nl").href;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) { console.log(`  ${pack}: download answered ${res.status}, skipped`); continue; }
    const zf = path.join(TMP, `${pack}.zip`), dir = path.join(TMP, pack);
    fs.writeFileSync(zf, Buffer.from(await res.arrayBuffer()));
    execFileSync("unzip", ["-q", "-o", zf, "-d", dir]);
    addFrom(dir, pack);
  } catch (e) { console.log(`  ${pack}: ${e.message}, skipped`); }
}
for (const repo of REPOS) {
  try {
    const dir = path.join(TMP, repo.replace("/", "_"));
    execFileSync("git", ["clone", "--depth", "1", "--quiet", `https://github.com/${repo}.git`, dir]);
    addFrom(dir, repo.split("/")[1].toLowerCase().replace(/^starter-kit-/, ""));
  } catch (e) { console.log(`  ${repo}: ${e.message}, skipped`); }
}

catalog.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, "catalog.json"), JSON.stringify({ made: new Date().toISOString(), credit: "3D models by Kenney (kenney.nl), CC0 public domain.", models: catalog }));
fs.writeFileSync(path.join(OUT, "CREDITS.txt"), "3D models by Kenney (www.kenney.nl), released under CC0 1.0 (public domain).\nThank you Kenney!\n");
console.log(`Library: ${catalog.length} models, ${(total / 1048576).toFixed(1)} MB`);
if (!catalog.length) process.exit(1);
