// Live chat with Zeeb, served by his PC brain.
// On this PC: http://localhost:8787 (no PIN). On your phone, on the same home Wi-Fi: http://<this PC's address>:8787 with your PIN.
// It only answers on your home network, never the internet. Each chat is saved and folded into his
// memory and mood on his next heartbeat.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PC_DIR, ROOT } from "./common.js";

export const PENDING = path.join(PC_DIR, "chat-pending.json");
const HISTORY = path.join(PC_DIR, "chat-history.json");
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const writeJSON = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const data = (name, d) => readJSON(path.join(ROOT, "data", name), d);

export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
  }
  return out;
}

const isLocal = (req) => /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || "");
const isHomeNetwork = (ip) => /^(::1|127\.|::ffff:127\.|10\.|::ffff:10\.|192\.168\.|::ffff:192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:172\.(1[6-9]|2\d|3[01])\.|fe80:)/i.test(ip || "");

export async function startChat({ port = 8787, pin, log }) {
  const { askChat } = await import("../brain/llm.js");
  const { sheet } = await import("../brain/mind.js");
  const fails = new Map();
  let busy = false;

  // Word overlap between two replies, 0 to 1 (used to catch him repeating himself).
  const words = (t) => new Set(String(t).toLowerCase().match(/[a-z']+/g) || []);
  function overlap(a, b) {
    const A = words(a), B = words(b);
    if (!A.size || !B.size) return 0;
    let n = 0; for (const w of A) if (B.has(w)) n++;
    return n / Math.min(A.size, B.size);
  }

  async function reply(message) {
    const character = data("character.json", {});
    const state = data("state.json", {});
    const mem = data("memories.json", { memories: [] });
    const feed = data("feed.json", { entries: [] }).entries.slice(0, 5);
    const history = readJSON(HISTORY, []).slice(-16);
    const asleep = Boolean(state.asleep);
    const system = `${sheet(character)}

YOU ARE IN A LIVE CHAT WITH YOUR CREATOR right now, typing on the chat screen in the hangar.
Your creator is the person who built your world. They live in the real world, not at Rustwell Outpost, so ask about their life, not about the outpost.

BACKGROUND (only bring this up if it fits; don't keep repeating it):
${asleep ? "You were asleep in the charging dock and their message just woke you up." : `You're ${state.doingWords || state.doing || "around"} at ${state.placeName || "the outpost"}.`}
Mood: ${state.feeling || "fine"}. On your mind: ${state.thought || "nothing much"}
Lately: ${feed.map((f) => f.text).join("; ")}
You remember: ${(mem.memories || []).sort((a, b) => b.strength - a.strength).slice(0, 8).map((m) => m.text).join("; ")}

HOW TO CHAT
- Answer what they just said. React to it, like a real friend would.
- Never repeat something you already said earlier in this chat. Say something new each time.
- Usually 1 to 3 short sentences. Plain text, in your own voice. No "Zeeb:" at the start.
- You can ask them things, tell them about your day, joke, disagree, or change the subject.`;
    const turns = [];
    for (const m of history) {
      const role = m.from === "creator" ? "user" : "assistant";
      if (turns.length && turns[turns.length - 1].role === role) turns[turns.length - 1].content += "\n" + m.text;
      else turns.push({ role, content: m.text });
    }
    if (turns[0]?.role === "assistant") turns.shift();
    turns.push({ role: "user", content: message });
    const clean = (t) => String(t || "").trim().replace(/^(zeeb|you)\s*:\s*/i, "").replace(/^["']|["']$/g, "").slice(0, 600);
    const mine = history.filter((m) => m.from !== "creator").slice(-4).map((m) => m.text);
    let text = clean(await askChat(system, turns, { temperature: 0.9 }));
    // Too close to something he already said? Ask once more, with a nudge.
    if (text && mine.some((p) => overlap(p, text) > 0.6)) {
      const again = clean(await askChat(system + "\n\nYour last draft repeated yourself. Respond only to their newest message with something you haven't said yet.", turns, { temperature: 1.1 }));
      const worst = (t) => Math.max(0, ...mine.map((p) => overlap(p, t)));
      if (again && worst(again) < worst(text)) text = again; // keep whichever repeats less
    }
    return { text: text || "*static* ...sorry, my dish is acting up. say that again?", asleep };
  }

  function record(entries) {
    const hist = readJSON(HISTORY, []);
    hist.push(...entries);
    writeJSON(HISTORY, hist.slice(-200));
    const pend = readJSON(PENDING, []);
    pend.push(...entries);
    writeJSON(PENDING, pend.slice(-60));
  }

  const server = http.createServer(async (req, res) => {
    const ip = req.socket.remoteAddress || "";
    const send = (code, body, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "DENY" });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (!isHomeNetwork(ip)) return send(403, { error: "home network only" });
    const url = new URL(req.url, "http://x");
    const needPin = !isLocal(req);
    const f = fails.get(ip) || { n: 0, until: 0 };
    const checkPin = (given) => {
      if (!needPin) return true;
      if (Date.now() < f.until) return false;
      if (String(given || "") === String(pin)) { fails.delete(ip); return true; }
      f.n += 1; if (f.n >= 8) { f.until = Date.now() + 10 * 60000; f.n = 0; }
      fails.set(ip, f);
      return false;
    };

    if (req.method === "GET" && url.pathname === "/") return send(200, PAGE(needPin), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/api/status") {
      if (!checkPin(req.headers["x-pin"])) return send(401, { error: "pin" });
      const s = data("state.json", {});
      return send(200, { doing: s.asleep ? "asleep in the charging dock" : s.doingWords || s.doing, place: s.placeName, feeling: s.feeling, mood: s.mood, asleep: s.asleep, history: readJSON(HISTORY, []).slice(-30) });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      if (!checkPin(req.headers["x-pin"])) return send(401, { error: "pin" });
      let body = "";
      for await (const c of req) { body += c; if (body.length > 4000) break; }
      let msg = "";
      try { msg = String(JSON.parse(body).message || "").trim().slice(0, 1000); } catch {}
      if (!msg) return send(400, { error: "empty" });
      if (busy) return send(429, { error: "Zeeb is still answering your last message" });
      busy = true;
      try {
        const at = new Date().toISOString();
        const r = await reply(msg);
        const pend = readJSON(PENDING, []);
        const woke = r.asleep && !pend.some((m) => m.woke);
        record([{ from: "creator", text: msg, at, ...(woke ? { woke: true } : {}) }, { from: "zeeb", text: r.text, at: new Date().toISOString() }]);
        return send(200, { reply: r.text });
      } catch (e) {
        log?.(`Chat problem: ${e.message}`);
        return send(500, { error: "something went wrong" });
      } finally { busy = false; }
    }
    send(404, { error: "not found" });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", resolve);
  });
  return server;
}

const PAGE = (needPin) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Chat with Zeeb</title>
<style>
:root{--bg:#120f17;--panel:#1c1822;--line:#352e3f;--text:#f1e7da;--muted:#a99c8f;--rust:#d0602e;--cyan:#4ef2ff;color-scheme:dark}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;height:100%;display:flex;flex-direction:column;padding:12px 16px}
header{padding:6px 0 10px;border-bottom:1px solid var(--line)}h1{margin:0;font-size:19px}.st{color:var(--muted);font-size:13px}
#log{flex:1;overflow:auto;padding:12px 0;display:flex;flex-direction:column;gap:8px}
.m{max-width:82%;padding:9px 13px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.me{align-self:flex-end;background:var(--rust);color:#fff;border-bottom-right-radius:4px}
.z{align-self:flex-start;background:var(--panel);border:1px solid var(--line);border-bottom-left-radius:4px}
.typing{color:var(--muted);font-size:13px;min-height:18px}
form{display:flex;gap:8px;padding-top:8px}input{flex:1;font:inherit;padding:11px 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--text)}
button{font:inherit;padding:10px 18px;border-radius:999px;border:0;background:var(--rust);color:#fff;font-weight:600}
.pin{margin:auto;text-align:center}.pin input{text-align:center;max-width:180px;margin:10px 0}
</style></head><body><div class="wrap">
<header><h1>Chat with Zeeb</h1><div class="st" id="st">connecting...</div></header>
<div id="pinbox" class="pin" hidden><p>Enter the PIN shown in Zeeb's PC brain window.</p><input id="pin" inputmode="numeric" autocomplete="off"><br><button id="pinok">OK</button><p class="st" id="pinerr"></p></div>
<div id="log"></div><div class="typing" id="typing"></div>
<form id="f"><input id="msg" placeholder="Say something to Zeeb..." autocomplete="off" maxlength="1000"><button>Send</button></form>
</div><script>
const NEED_PIN=${needPin ? "true" : "false"};let pin="";try{pin=localStorage.getItem("zeebpin")||""}catch(e){}
const $=id=>document.getElementById(id);
function bubble(t,who){const d=document.createElement("div");d.className="m "+(who==="creator"?"me":"z");d.textContent=t;$("log").appendChild(d);$("log").scrollTop=1e9}
async function api(p,o={}){o.headers=Object.assign({"Content-Type":"application/json","x-pin":pin},o.headers||{});const r=await fetch(p,o);if(r.status===401)throw new Error("pin");return r}
async function status(first){try{const r=await api("/api/status");const s=await r.json();$("st").textContent=(s.asleep?"asleep in the charging dock":s.doing||"")+(s.place&&!s.asleep?" at "+s.place:"")+(s.feeling?" · feels "+s.feeling:"");
if(first){$("log").innerHTML="";(s.history||[]).forEach(m=>bubble(m.text,m.from))}$("pinbox").hidden=true;$("f").hidden=false}catch(e){if(e.message==="pin"){$("pinbox").hidden=false;$("f").hidden=true;$("st").textContent="locked"}}}
$("pinok").onclick=async()=>{pin=$("pin").value.trim();try{localStorage.setItem("zeebpin",pin)}catch(e){}$("pinerr").textContent="";await status(true);if(!$("pinbox").hidden)$("pinerr").textContent="That PIN didn't work."};
$("f").onsubmit=async e=>{e.preventDefault();const t=$("msg").value.trim();if(!t)return;$("msg").value="";bubble(t,"creator");$("typing").textContent="Zeeb is typing...";
try{const r=await api("/api/chat",{method:"POST",body:JSON.stringify({message:t})});const j=await r.json();bubble(j.reply||j.error||"...","zeeb")}catch(err){bubble(err.message==="pin"?"(locked: enter the PIN again)":"(couldn't reach Zeeb: is his PC brain running?)","zeeb")}
$("typing").textContent="";status(false)};
status(true);setInterval(()=>status(false),30000);
</script></body></html>`;
