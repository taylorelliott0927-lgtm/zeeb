// Runs Zeeb's heartbeat on your PC with your own AI (Ollama), then saves his state to GitHub.
// While this is running, GitHub's heartbeat steps aside. Close it (or turn the PC off) and GitHub takes over again.
// Started by "Start Zeeb.bat" (and automatically at Windows start-up if you chose that in setup).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { PC_DIR, ROOT, git, gpuBusy, loadSettings, ollamaInfo, saveSettings } from "./common.js";

const S = loadSettings();
const OLLAMA_URL = S.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = S.OLLAMA_MODEL || "qwen2.5:3b";
const EVERY_MIN = Math.max(2, Number(S.PC_INTERVAL_MINUTES || 3));
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
  await reloadChatIfChanged();

  const t0 = Date.now();
  // Hand any live chats since last time to this heartbeat (moved aside so new chats aren't lost meanwhile).
  const CHAT_PENDING = path.join(PC_DIR, "chat-pending.json"), CHAT_NOW = path.join(PC_DIR, "chat-processing.json");
  let chatFile = "";
  try {
    if (fs.existsSync(CHAT_NOW)) chatFile = CHAT_NOW; // left over from a heartbeat that failed
    else if (fs.existsSync(CHAT_PENDING)) { fs.renameSync(CHAT_PENDING, CHAT_NOW); chatFile = CHAT_NOW; }
  } catch {}
  // Run asynchronously so the live chat keeps answering while he thinks.
  const r = await runTick({
    env: {
      ...process.env,
      ZEEB_RUNNER: "pc",
      ...(chatFile ? { ZEEB_CHAT_FILE: chatFile } : {}),
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
  const doneWithChat = () => { if (chatFile) { try { fs.unlinkSync(chatFile); } catch {} } };
  if (git("diff", "--cached", "--quiet").ok) return doneWithChat();
  git("commit", "--quiet", "-m", "zeeb: heartbeat (PC brain)");
  let p = git("push", "--quiet", "origin", "HEAD:main");
  if (!p.ok) {
    // Usually someone just uploaded code files to GitHub. His data doesn't clash with those, so slot it in on top.
    const pulled = git("pull", "--rebase", "--quiet", "origin", "main");
    if (pulled.ok) p = git("push", "--quiet", "origin", "HEAD:main");
    else git("rebase", "--abort");
  }
  if (p.ok) return doneWithChat();
  log(`Couldn't save to GitHub this time (${p.err.split("\n")[0]}). Will try again next heartbeat${chatFile ? "; your chat is kept for then" : ""}.`);
  git("fetch", "--quiet", "origin", "main");
  git("reset", "--hard", "--quiet", "origin/main");
}

// Live chat (pc/chat.js). Needs Ollama; the PIN keeps other people on your Wi-Fi out.
let chatServer = null, chatVersion = 0;
// When an update changes chat.js, restart the chat with the new version (no need to restart Zeeb).
async function reloadChatIfChanged() {
  try {
    const v = fs.statSync(path.join(PC_DIR, "chat.js")).mtimeMs;
    if (!chatServer || v === chatVersion) return;
    chatServer.closeAllConnections?.();
    await new Promise((res) => chatServer.close(() => res()));
    chatServer = null;
    log("Chat was updated: restarting it with the new version.");
    await startChatServer();
  } catch (e) { log(`Couldn't reload the chat: ${e.message}`); }
}

async function startChatServer() {
  if (process.env.ZEEB_NO_CHAT === "1") return;
  let pin = S.CHAT_PIN;
  if (!pin) {
    pin = String(crypto.randomInt(100000, 1000000));
    saveSettings({ ...S, CHAT_PIN: pin });
    S.CHAT_PIN = pin;
  }
  const port = Number(S.CHAT_PORT || 8787);
  try {
    process.env.OLLAMA_URL = OLLAMA_URL;
    process.env.OLLAMA_MODEL = MODEL;
    if (S.GEMINI_API_KEY) process.env.GEMINI_API_KEY = S.GEMINI_API_KEY;
    chatVersion = fs.statSync(path.join(PC_DIR, "chat.js")).mtimeMs;
    const { startChat, lanAddresses } = await import(`./chat.js?v=${chatVersion}`);
    chatServer = await startChat({ port, pin, log });
    log(`Chat with Zeeb on this PC: http://localhost:${port}`);
    const ips = lanAddresses();
    if (ips.length) log(`On your phone (same home Wi-Fi): ${ips.map((ip) => `http://${ip}:${port}`).join("  or  ")}   PIN: ${pin}`);
  } catch (e) {
    log(`Live chat couldn't start (${e.code === "EADDRINUSE" ? `port ${port} is already in use` : e.message}). Zeeb still runs normally.`);
  }
}

function runTick({ env }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, "brain", "tick.js")], { cwd: ROOT, env, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 8 * 60000);
    child.on("error", (error) => { clearTimeout(timer); resolve({ status: 1, stdout, stderr, error }); });
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

async function main() {
  process.chdir(ROOT);
  if (!takeLock()) {
    console.log("Zeeb's PC brain is already running in another window.");
    return;
  }
  log(`Zeeb's PC brain started. Model: ${MODEL}. Heartbeat every ${EVERY_MIN} minutes. Leave this window open (minimised is fine).`);
  await startChatServer();
  if (process.env.ZEEB_PC_ONCE === "1") { await heartbeat(); try { fs.unlinkSync(LOCK); } catch {} return; } // for testing
  for (;;) {
    const start = Date.now();
    try { await heartbeat(); } catch (e) { log(`Unexpected problem: ${e.message}`); }
    await sleep(Math.max(15000, EVERY_MIN * 60000 - (Date.now() - start)));
  }
}

main();
