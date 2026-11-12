// Shared helpers for running Zeeb's brain on your own PC.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PC_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(PC_DIR, "..");
export const SETTINGS = path.join(PC_DIR, "settings.env");

export function loadSettings() {
  const out = {};
  try {
    for (const line of fs.readFileSync(SETTINGS, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return out;
}

export function saveSettings(obj) {
  const lines = [
    "# Zeeb's PC brain settings. Keep this file private: it holds your GitHub token.",
    "# It is never uploaded (only the data folder gets saved to GitHub).",
    ...Object.entries(obj).map(([k, v]) => `${k}=${v}`),
  ];
  fs.writeFileSync(SETTINGS, lines.join("\n") + "\n");
}

export function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", windowsHide: true, ...opts });
  return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() || (r.error ? r.error.message : ""), status: r.status };
}

export const git = (...args) => run("git", args);

export function repoSlug() {
  const r = git("config", "--get", "remote.origin.url");
  if (!r.ok) return "";
  const m = r.out.match(/github\.com[/:]([^/]+)\/([^/.\s]+?)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : "";
}

export async function ollamaInfo(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${url}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json()).models || [];
  } catch {
    return null;
  }
}

// Is a game (or anything heavy) using the graphics card right now?
// Uses nvidia-smi, which comes with NVIDIA's driver. If it isn't there, we assume no game.
export function gpuBusy(utilLimit = 40, memLimitMb = 2600) {
  const samples = [];
  for (let i = 0; i < 3; i++) {
    const r = run("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits"]);
    if (!r.ok) return { busy: false, known: false };
    const [util, mem] = r.out.split("\n")[0].split(",").map((x) => Number(x.trim()));
    samples.push({ util, mem });
    if (i < 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 700);
  }
  const util = Math.min(...samples.map((s) => s.util));
  const mem = Math.min(...samples.map((s) => s.mem));
  return { busy: util >= utilLimit || mem >= memLimitMb, known: true, util, mem };
}
