// Runs Zeeb's heartbeat on your PC with your own AI (Ollama), then saves his state to GitHub.
// While this is running, GitHub's heartbeat steps aside. Close it (or turn the PC off) and GitHub takes over again.
// Started by "Start Zeeb.bat" (and automatically at Windows start-up if you chose that in setup).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { PC_DIR, ROOT, git, gpuBusy, loadSettings, ollamaInfo } from "./common.js";

const S = loadSettings();
const OLLAMA_URL = S.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = S.OLLAMA_MODEL || "qwen2.5:3b";
const EVERY_MIN = Math.max(2, Number(S.PC_INTERVAL_MINUTES || 5));
const GAME_GPU = Number(S.GAME_GPU_PERCENT || 40);
const GAME_MEM = Number(S.GAME_GPU_MEMORY_MB || 2600);
const LOG = path.join(PC_DIR, "zeeb-pc.log");
const LOCK = path.join(PC_DIR, ".lock");
const PAUSE = path.join(PC_DIR, "PAUSE");

function log(msg) {
  const line = `[${new Date().toLocaleString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + "\n");
    if (fs.statSync(LOG).size > 2_000_000) fs.writeFileSync(LOG, fs.readFileSync(LOG, "utf8").slice(-500_000));
  } catch {}
}

// Only one copy at a time.
function takeLock() {
  try {
    const pid = Number(fs.readFileSync(LOCK, "utf8"));
    if (pid && pid !== process.pid) {
      try { process.kill(pid, 0); return false; } catch {}
    }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid));
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function heartbeat() {
  if (fs.existsSync(PAUSE)) return log("Paused (run 'Resume Zeeb.bat' to continue). GitHub is looking after him.");
  if (!S.GITHUB_TOKEN) return log("No settings yet. Double-click 'Setup Zeeb.bat' first.");

  const gpu = gpuBusy(GAME_GPU, GAME_MEM);
  if (gpu.busy) return log(`Graphics card is busy (${gpu.util}% in use, ${gpu.mem} MB memory), probably a game. Stepping aside so GitHub covers him.`);

  const models = await ollamaInfo(OLLAMA_URL);
  if (!models) return log("Ollama isn't running. Open the Ollama app (or restart the PC). GitHub is covering him meanwhile.");
  if (!models.some((m) => m.name === MODEL || m.name === `${MODEL}:latest`)) return log(`The model ${MODEL} isn't downloaded. Run 'Setup Zeeb.bat' again.`);

  // Start from exactly what's on GitHub (your code changes and his latest state).
  const f = git("fetch", "--quiet", "origin", "main");
  if (!f.ok) return log(`Couldn't reach GitHub (${f.err.split("\n")[0]}). Will try again next time.`);
  const reset = git("reset", "--hard", "--quiet", "origin/main");
  if (!reset.ok) return log(`Couldn't update the folder: ${reset.err}`);

  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, "brain", "tick.js")], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 8 * 60000,
    env: {
      ...process.env,
      ZEEB_RUNNER: "pc",
      OLLAMA_URL,
      OLLAMA_MODEL: MODEL,
      GITHUB_TOKEN: S.GITHUB_TOKEN,
      GITHUB_REPOSITORY: S.GITHUB_REPOSITORY || "",
      GITHUB_REPOSITORY_OWNER: (S.GITHUB_REPOSITORY || "").split("/")[0],
      ...(S.GEMINI_API_KEY ? { GEMINI_API_KEY: S.GEMINI_API_KEY } : {}),
      ...(S.STRIPE_KEY ? { STRIPE_KEY: S.STRIPE_KEY } : {}),
      SHOP_CURRENCY: S.SHOP_CURRENCY || "cad",
    },
  });
  const said = (r.stdout || "").trim().split("\n").filter(Boolean);
  if (r.status !== 0) return log(`Heartbeat had a problem:\n${(r.stderr || r.error?.message || "").slice(0, 800)}`);
  log(`${said[said.length - 1] || "heartbeat done"}  (${Math.round((Date.now() - t0) / 1000)}s)`);

  git("add", "data");
  if (git("diff", "--cached", "--quiet").ok) return;
  git("commit", "--quiet", "-m", "zeeb: heartbeat (PC brain)");
  const p = git("push", "--quiet", "origin", "HEAD:main");
  if (!p.ok) {
    log(`Couldn't save to GitHub this time (${p.err.split("\n")[0]}). Skipping this heartbeat.`);
    git("fetch", "--quiet", "origin", "main");
    git("reset", "--hard", "--quiet", "origin/main");
  }
}

async function main() {
  process.chdir(ROOT);
  if (!takeLock()) {
    console.log("Zeeb's PC brain is already running in another window.");
    return;
  }
  log(`Zeeb's PC brain started. Model: ${MODEL}. Heartbeat every ${EVERY_MIN} minutes. Leave this window open (minimised is fine).`);
  if (process.env.ZEEB_PC_ONCE === "1") { await heartbeat(); try { fs.unlinkSync(LOCK); } catch {} return; } // for testing
  for (;;) {
    const start = Date.now();
    try { await heartbeat(); } catch (e) { log(`Unexpected problem: ${e.message}`); }
    await sleep(Math.max(15000, EVERY_MIN * 60000 - (Date.now() - start)));
  }
}

main();
