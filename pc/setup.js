// One-time setup for Zeeb's PC brain. Double-click "Setup Zeeb.bat" to run it.
// It checks everything is installed, downloads the AI model, saves your settings and (if you like)
// makes Zeeb's PC brain start whenever Windows starts. Safe to run again any time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { PC_DIR, ROOT, git, gpuBusy, loadSettings, ollamaInfo, repoSlug, saveSettings } from "./common.js";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = "") => ((await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def);
const ok = (m) => console.log(`  OK  ${m}`);
const bad = (m) => console.log(`  !!  ${m}`);
const step = (n, m) => console.log(`\n[${n}] ${m}`);
function stop(msg) {
  console.log(`\n${msg}\n\nFix that, then double-click "Setup Zeeb.bat" again.`);
  rl.close();
  process.exit(1);
}

const old = loadSettings();
const OLLAMA_URL = old.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5:3b";

console.log("==============================================");
console.log("   Zeeb's PC brain: setup");
console.log("==============================================");

step(1, "Checking Node.js");
const major = Number(process.versions.node.split(".")[0]);
if (major < 20) stop(`Node.js ${process.versions.node} is too old. Install the LTS version from nodejs.org.`);
ok(`Node.js ${process.versions.node}`);

step(2, "Checking Git and this folder");
const gv = git("--version");
if (!gv.ok) stop("Git isn't installed (or Windows can't find it). Install Git for Windows from git-scm.com.");
ok(gv.out);
const slug = repoSlug();
if (!slug) stop("This folder isn't a copy of your zeeb repository. Follow the 'download Zeeb to your PC' step in the guide.");
ok(`Your repository: ${slug}`);
git("config", "user.name", "zeeb-bot");
git("config", "user.email", "zeeb-bot@users.noreply.github.com");
// Keep private files out of GitHub, even though nothing but the data folder is ever saved.
const exclude = path.join(ROOT, ".git", "info", "exclude");
try {
  const cur = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : "";
  const add = ["pc/settings.env", "pc/zeeb-pc.log", "pc/.lock", "pc/PAUSE", "pc/chat-pending.json", "pc/chat-processing.json", "pc/chat-history.json"].filter((l) => !cur.includes(l));
  if (add.length) fs.appendFileSync(exclude, "\n" + add.join("\n") + "\n");
} catch {}

step(3, "Checking Ollama (your PC's AI)");
const models = await ollamaInfo(OLLAMA_URL);
if (!models) stop("Ollama isn't running. Install it from ollama.com, open it once (a llama icon appears by the clock), then try again.");
ok("Ollama is running");

step(4, "Choosing and downloading the AI model");
console.log(`  The recommended model for a GTX 1650 (4 GB) is ${DEFAULT_MODEL}. Just press Enter to use it.`);
const model = await ask("  Model", old.OLLAMA_MODEL || DEFAULT_MODEL);
if (!models.some((m) => m.name === model || m.name === `${model}:latest`)) {
  console.log(`  Downloading ${model} (about 2 GB, a few minutes)...`);
  const res = await fetch(`${OLLAMA_URL}/api/pull`, { method: "POST", body: JSON.stringify({ model, stream: true }) });
  if (!res.ok || !res.body) stop(`Ollama couldn't download ${model} (${res.status}). Check the name and your internet.`);
  let last = "";
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const j = JSON.parse(line);
        if (j.error) stop(`Download failed: ${j.error}`);
        const pct = j.total ? ` ${Math.floor((j.completed || 0) / j.total * 100)}%` : "";
        const msg = `  ${j.status}${pct}`;
        if (msg !== last) { process.stdout.write(`\r${msg.padEnd(60)}`); last = msg; }
      } catch {}
    }
  }
  console.log("");
}
ok(`${model} is downloaded`);

console.log("  Asking it a quick test question...");
const t0 = Date.now();
try {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model, stream: false, format: "json", keep_alive: "20s",
      messages: [{ role: "user", content: 'You are Zeeb, a cheerful little repair bot. Reply with JSON: {"hello": "a one-line greeting to your creator"}' }],
    }),
  });
  const j = await r.json();
  const said = JSON.parse(j.message.content).hello;
  ok(`It answered in ${Math.round((Date.now() - t0) / 1000)}s: "${said}"`);
} catch (e) {
  stop(`The model didn't answer properly (${e.message}).`);
}

step(5, "Connecting to GitHub");
console.log("  Paste your GitHub token (it starts with github_pat_). Right-click pastes in this window.");
let token = "";
for (;;) {
  token = await ask("  Token", old.GITHUB_TOKEN ? "(press Enter to keep the saved one)" : "");
  if (token.startsWith("(press")) token = old.GITHUB_TOKEN;
  if (!token) { bad("No token entered."); continue; }
  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "zeeb-setup" };
  const r = await fetch(`https://api.github.com/repos/${slug}/issues?per_page=1`, { headers: h }).catch(() => null);
  if (r?.ok) { ok("Token works: Zeeb can read and send letters and notes"); break; }
  bad(`GitHub didn't accept that token (${r ? r.status : "no connection"}). Make sure it's for the ${slug.split("/")[1]} repository with Issues: Read and write.`);
}
console.log("  Checking Zeeb can save to GitHub from this PC (a browser window may open to sign in; that's normal)...");
// Catch up with GitHub first: his GitHub heartbeat may have saved since this folder was downloaded.
git("fetch", "--quiet", "origin", "main");
git("reset", "--hard", "--quiet", "origin/main");
const push = git("push", "--dry-run", "origin", "HEAD:main");
// "rejected" means GitHub accepted the sign-in but someone saved a moment ago: that's fine for this check.
if (!push.ok && !/rejected|non-fast-forward|fetch first/i.test(push.err)) stop(`Saving to GitHub didn't work:\n  ${push.err.split("\n").slice(0, 3).join("\n  ")}\n  Sign in when Git asks you to.`);
ok("Saving to GitHub works");

step(6, "Zeeb's shop (optional)");
console.log("  Zeeb can open a shop if he ever decides to. To let it take real money, paste a Stripe");
console.log("  restricted key (starts with rk_). Otherwise just press Enter: his shop would use in-world credits.");
let stripeKey = old.STRIPE_KEY || "";
for (;;) {
  const k = await ask("  Stripe key", stripeKey ? "(press Enter to keep the saved one)" : "(press Enter to skip)");
  if (k.startsWith("(press")) break;
  if (!k.startsWith("rk_")) { bad("That doesn't look like a restricted key (rk_...). Use a restricted key, never your secret key."); continue; }
  const r = await fetch("https://api.stripe.com/v1/products?limit=1", { headers: { Authorization: `Bearer ${k}` } }).catch(() => null);
  if (r?.ok) { stripeKey = k; ok("Stripe key works"); break; }
  bad(`Stripe didn't accept it (${r ? r.status : "no connection"}). Check the key has the four permissions in the guide.`);
}
const shopCurrency = stripeKey ? (await ask("  Currency for his prices", old.SHOP_CURRENCY || "cad")).toLowerCase() : (old.SHOP_CURRENCY || "cad");
if (!stripeKey) ok("Skipped. You can add it any time by running setup again.");

saveSettings({
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: slug,
  OLLAMA_URL,
  OLLAMA_MODEL: model,
  PC_INTERVAL_MINUTES: old.PC_INTERVAL_MINUTES || 3,
  GAME_GPU_PERCENT: old.GAME_GPU_PERCENT || 40,
  GAME_GPU_MEMORY_MB: old.GAME_GPU_MEMORY_MB || 2600,
  ...(old.CHAT_PIN ? { CHAT_PIN: old.CHAT_PIN } : {}),
  ...(old.GEMINI_API_KEY ? { GEMINI_API_KEY: old.GEMINI_API_KEY } : {}),
  ...(stripeKey ? { STRIPE_KEY: stripeKey } : {}),
  SHOP_CURRENCY: shopCurrency,
});
ok(`Settings saved privately in ${path.join("pc", "settings.env")}`);

step(7, "Game detection");
const g = gpuBusy(1000, 1e9);
if (g.known) ok(`Graphics card found. Right now: ${g.util}% busy, ${g.mem} MB memory used. When a game pushes it past 40% or 2600 MB, Zeeb steps aside.`);
else bad("Couldn't read the graphics card (nvidia-smi missing), so game detection is off. Zeeb will still work.");

step(8, "Start automatically with Windows?");
const auto = (await ask("  Start Zeeb's PC brain whenever Windows starts? (Y/n)", "Y")).toLowerCase();
const startupDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
const startupFile = path.join(startupDir, "Zeeb PC brain.bat");
if (auto.startsWith("y")) {
  try {
    fs.mkdirSync(startupDir, { recursive: true });
    fs.writeFileSync(startupFile, `@echo off\r\nstart "Zeeb's PC brain" /min "${path.join(PC_DIR, "Start Zeeb.bat")}"\r\n`);
    ok("Done. He'll start (minimised) every time you log in to Windows.");
  } catch (e) {
    bad(`Couldn't add it to start-up (${e.message}). You can just double-click 'Start Zeeb.bat' instead.`);
  }
} else {
  try { fs.unlinkSync(startupFile); } catch {}
  ok("Okay. Double-click 'Start Zeeb.bat' whenever you want your PC to be his brain.");
}

console.log("\n==============================================");
console.log("  All set! Now double-click 'Start Zeeb.bat'.");
console.log("==============================================\n");
rl.close();
