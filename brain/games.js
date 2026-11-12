// Games Zeeb can make, only if he decides to (start_game -> work_game sessions -> release).
// He writes the whole game himself as one small web page. Every version is checked for code errors,
// and he sees those errors next session so he can fix them. Visitors play released games (and the
// latest working test build) in a locked box on his site that can't reach anything else.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { DATA_DIR } from "./util.js";
import { askText } from "./llm.js";

export const emptyGames = () => ({ games: [] });
const KEEP_VERSIONS = 5;
const MAX_CODE = 40000;

export const activeGame = (g) => g.games.find((x) => x.status === "in progress");

export function startGame(g, idea, nowISO) {
  const game = { id: `g${Date.parse(nowISO).toString(36)}`, title: "untitled game", idea: String(idea || "a little game").slice(0, 200), status: "in progress", started: nowISO, versions: [], notes: [] };
  g.games.unshift(game);
  return game;
}

// Syntax-check every <script> in the page. Returns null if fine, or the first error message.
export function checkCode(html) {
  if (!/<canvas|<div|<body|<button/i.test(html)) return "the page has nothing to show (no canvas or elements)";
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!scripts.length) return "there's no script in the page";
  for (const code of scripts) {
    try { new vm.Script(code); } catch (e) { return `${e.name}: ${e.message}`; }
  }
  if (/<script[^>]+src=|<link[^>]+href=["']?https?:|fetch\(|XMLHttpRequest|WebSocket|import\s*\(/i.test(html)) return "the game tries to load something from the internet, which isn't allowed (everything must be inside the page)";
  return null;
}

function parseReply(text) {
  const t = String(text || "");
  const code = (t.match(/```html\s*([\s\S]*?)```/i) || t.match(/```\s*(<!DOCTYPE[\s\S]*?)```/i) || t.match(/(<!DOCTYPE html[\s\S]*<\/html>)/i) || [])[1] || "";
  const line = (k) => (t.match(new RegExp(`^\\s*${k}\\s*:\\s*(.+)$`, "im")) || [])[1]?.trim() || "";
  return {
    title: line("TITLE").replace(/^["']|["']$/g, "").slice(0, 60),
    changes: line("CHANGES").slice(0, 300),
    done: /^y/i.test(line("DONE")),
    abandon: /^y/i.test(line("ABANDON")),
    code: code.trim(),
  };
}

export async function workSession(g, game, character, interests, nowISO) {
  const last = game.versions[0];
  let prevCode = "";
  if (last?.file) { try { prevCode = fs.readFileSync(path.join(DATA_DIR, last.file), "utf8"); } catch {} }
  const sys = `You are ${character.name}, ${character.kind}, and you're making a little computer game by yourself. You write real, working code.
Voice for titles and notes: ${character.voice}
Keep everything friendly and suitable for all ages.`;
  const user = `YOUR GAME IDEA: ${game.idea}
${interests ? `${interests}\n` : ""}${last ? `LAST VERSION (v${last.v}, "${game.title}"): ${last.changes || ""}
${last.error ? `IT HAD A BUG when tested: ${last.error}\nFix that first.` : "It ran without code errors."}
YOUR NOTES SO FAR: ${game.notes.slice(0, 5).join(" | ") || "none"}
THE CODE SO FAR:
\`\`\`html
${prevCode.slice(0, 14000)}
\`\`\`
Improve it in this session: fix bugs, add a feature, make it more fun, or polish it. Write out the WHOLE new version.` : "This is your first session: write a first playable version, simple is fine."}

RULES FOR THE GAME
- One complete HTML page with a <canvas> and plain JavaScript inside <script> tags. No external files, images, fonts, links or internet.
- Fits in about 480x360 pixels. Works with keyboard and with mouse or touch.
- Shows its title, how to play, and a score or goal. Has a way to restart.
- Under 300 lines.

Reply in exactly this format:
TITLE: the game's name
CHANGES: what you did this session, in your voice, one sentence
DONE: yes if you're happy to release it to visitors now, otherwise no
ABANDON: yes only if you've lost interest and want to give up on this game, otherwise no
\`\`\`html
...the whole game...
\`\`\``;
  const reply = await askText(sys, user, { temperature: 0.7 });
  if (!reply) return { ok: false, note: "couldn't think straight enough to code today" };
  const r = parseReply(reply);
  if (r.abandon) { game.status = "abandoned"; game.ended = nowISO; return { ok: true, abandoned: true, note: r.changes || "gave up on it" }; }
  if (!r.code || r.code.length < 200) return { ok: false, note: "wrote some ideas down but no working code yet" };
  const code = r.code.slice(0, MAX_CODE);
  const error = checkCode(code);
  const v = (last?.v || 0) + 1;
  const dir = path.join(DATA_DIR, "games", game.id);
  fs.mkdirSync(dir, { recursive: true });
  const file = `games/${game.id}/v${v}.html`;
  fs.writeFileSync(path.join(DATA_DIR, file), code);
  if (r.title) game.title = r.title;
  game.versions.unshift({ v, at: nowISO, changes: r.changes, error, file });
  if (r.changes) game.notes.unshift(r.changes);
  game.notes = game.notes.slice(0, 10);
  // Keep the last few versions on disk (always keeping the last one that worked).
  const lastGood = game.versions.find((x) => !x.error);
  for (const old of game.versions.slice(KEEP_VERSIONS)) {
    if (old === lastGood) continue;
    try { fs.unlinkSync(path.join(DATA_DIR, old.file)); } catch {}
    old.file = null;
  }
  game.playable = lastGood?.file || null;
  let released = false;
  if (r.done && !error) { game.status = "released"; game.released = nowISO; released = true; }
  return { ok: true, v, error, released, note: r.changes };
}

export function gamesText(g) {
  const cur = activeGame(g);
  const done = g.games.filter((x) => x.status === "released");
  const parts = [];
  if (cur) parts.push(`YOUR GAME IN PROGRESS: "${cur.title}" (${cur.idea}), version ${cur.versions[0]?.v || 0}.${cur.versions[0]?.error ? " The last version had a bug." : ""}`);
  else parts.push("GAMES: you could write your own little computer game (start_game) about anything you like, if you ever want to. Nobody expects you to.");
  if (done.length) parts.push(`Games you've released: ${done.map((x) => `"${x.title}"`).join(", ")}.`);
  return parts.join(" ");
}
