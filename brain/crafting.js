// Zeeb inventing his own parts at the workbench. He decides what to make and how; whether it works
// depends on what he knows (things he's read on the Wire and remembers), his materials, and practice.
import { askJSON } from "./llm.js";
import { clamp } from "./util.js";

const SHAPES = ["box", "cylinder", "ball", "cone"];
const TURNS = ["up", "forward", "back", "side"];
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
const words = (t) => new Set(String(t || "").toLowerCase().match(/[a-z]{4,}/g) || []);
const key = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function emptyCrafting() { return { recipes: [], attempts: [] }; }

// What he plans: a new kind of part, made from what he has, using what he knows.
export async function planPart(sheetText, idea, ctx) {
  const { stash, reads, memories, crafting } = ctx;
  const user = `You're at your workbench trying to make a new kind of part nobody gave you: "${idea || "something you need"}".
Materials in your stash: ${stash.map((p) => p.what).join(", ") || "nothing, just loose scrap"}.
Things you've read on the Wire lately: ${reads.slice(0, 8).map((r) => `"${r.title}"${r.takeaway ? ` (${r.takeaway})` : ""}`).join("; ") || "nothing yet"}.
Things you remember: ${memories.slice(0, 8).join("; ") || "nothing much"}.
${crafting.attempts.length ? `Your earlier tries: ${crafting.attempts.slice(0, 5).map((a) => `${a.what}: ${a.result}`).join("; ")}.` : ""}
Say how you'd make it, using what you actually know. Then design what the finished part looks like, small, out of simple shapes (sizes in metres, it fits in your hand: about 0.1 to 0.5 across; y 0 is the bottom).
"turn" says which way a cone or cylinder points: up, forward, back, or side.
Return JSON:
{"what": "the part's name, short, like 'a flexible duct seal ring'", "how": "how you make it, one or two sentences", "uses": "what it's for", "materials": ["which stash parts you use, by kind, 0 to 2"],
 "look": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 0.2, "h": 0.05, "d": 0.2, "x": 0, "y": 0.03, "z": 0, "color": "#rrggbb", "glow": 0}]}
Use 1 to 8 shapes for the look.`;
  const r = await askJSON(sheetText, user, { temperature: 0.9 });
  if (!r?.what) return null;
  const look = (Array.isArray(r.look) ? r.look : []).filter((p) => SHAPES.includes(p?.shape)).slice(0, 8).map((p) => ({
    shape: p.shape, turn: TURNS.includes(p.turn) ? p.turn : "up",
    w: num(p.w, 0.02, 0.6, 0.2), h: num(p.h, 0.02, 0.6, 0.1), d: num(p.d, 0.02, 0.6, 0.2),
    x: num(p.x, -0.3, 0.3, 0), y: num(p.y, 0, 0.6, 0.05), z: num(p.z, -0.3, 0.3, 0),
    color: HEX.test(p.color) ? p.color : "#b08a5a", glow: num(p.glow, 0, 1, 0),
  }));
  return {
    what: String(r.what).slice(0, 50), how: String(r.how || "").slice(0, 240), uses: String(r.uses || "").slice(0, 140),
    materials: (Array.isArray(r.materials) ? r.materials : []).map(String).slice(0, 2),
    look: look.length ? look : [{ shape: "cylinder", turn: "up", w: 0.3, h: 0.06, d: 0.3, x: 0, y: 0.03, z: 0, color: "#b08a5a", glow: 0 }],
  };
}

// Does it work? Knowing about it (from the Wire or memory), having materials and having tried before all help.
export function tryToMake(plan, ctx) {
  const { reads, memories, crafting, materialsUsed } = ctx;
  const known = crafting.recipes.find((r) => key(r.what) === key(plan.what));
  if (known) return { ok: Math.random() < 0.9, known, why: "he's made these before" };
  const planWords = words(`${plan.what} ${plan.how} ${plan.uses}`);
  const learned = [...reads.slice(0, 20).map((r) => `${r.title} ${r.takeaway || ""}`), ...memories].filter((t) => { let n = 0; for (const w of words(t)) if (planWords.has(w)) n++; return n >= 2; });
  const tries = crafting.attempts.filter((a) => key(a.what) === key(plan.what)).length;
  const chance = clamp(0.2 + Math.min(0.35, learned.length * 0.12) + Math.min(0.3, tries * 0.1) + (materialsUsed > 0 ? 0.1 : 0), 0.05, 0.9);
  return { ok: Math.random() < chance, chance, learnedFrom: learned.length, tries };
}

export function craftingText(crafting) {
  const r = crafting.recipes, a = crafting.attempts.filter((x) => x.result === "didn't work");
  if (!r.length && !a.length) return "";
  return `PARTS YOU'VE INVENTED: ${r.map((x) => `${x.what} (made ${x.made}x)`).join(", ") || "none yet"}.${a.length ? ` Tries that didn't work yet: ${a.slice(0, 4).map((x) => x.what).join(", ")}.` : ""}`;
}
