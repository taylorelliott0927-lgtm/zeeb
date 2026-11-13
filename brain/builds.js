// Things Zeeb adds to the world himself, and test flights of the ships he finishes.
// He designs each object out of simple shapes; the website draws it in 3D exactly where he put it.
import { askJSON } from "./llm.js";
import { PLACES } from "./world.js";
import { clamp, chance, pick } from "./util.js";

export const MAX_BUILDS = 30;
const SHAPES = ["box", "cylinder", "ball", "cone"];
const TURNS = ["up", "forward", "back", "side"];
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };

// The motions he can choose for his body (the website animates them).
export const MOTIONS = ["bounce", "spin", "wiggle", "nod", "shake", "droop", "hop", "dance", "look_up", "wave", "pace", "zoom", "tremble", "float_high", "bow", "lean_in", "celebrate"];
export const cleanBody = (b) => (Array.isArray(b) ? b : String(b || "").split(/[ ,]+/)).map((x) => String(x).toLowerCase().trim()).filter((x) => MOTIONS.includes(x)).slice(0, 2);

export async function designThing(sheetText, idea, place, stash) {
  const user = `You've decided to build something and put it in the world: "${idea}".
Where: ${PLACES[place]?.name || "near Hangar Bay 3"}. Parts in your stash: ${stash.map((p) => p.what).join(", ") || "just scrap lying around"}.
Design it out of simple shapes so it can be built. Build it properly, with all its pieces: legs, frames, panels, trims, bolts, handles, lights, cables, signs, whatever it really has. Sizes are in metres; you are about 1 metre tall. y is height above the ground (0 = on the ground, so a 1-metre-tall box sits at y 0.5).
"turn" says which way a cone or cylinder points: up, forward, back, or side (use it for pipes, rails, beams and arms lying down).
Return JSON:
{"name": "what you call it", "description": "one sentence in your voice", "place": "${Object.keys(PLACES).join("|")}",
 "parts": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 1, "h": 1, "d": 1, "x": 0, "y": 0.5, "z": 0, "color": "#rrggbb", "glow": 0, "spin": false}]}
Use 8 to 40 parts. x and z between -4 and 4, y between 0 and 6, sizes between 0.03 and 4. glow from 0 to 1 for lights. spin true for parts that should turn.`;
  const r = await askJSON(sheetText, user, { temperature: 0.9 });
  const parts = cleanParts(r?.parts, 40);
  if (parts.length < 2) {
    // Couldn't design it properly: a simple scrap sculpture instead.
    return { name: String(idea || "scrap sculpture").slice(0, 40), description: "a little pile of welded scrap. it's art.", place, parts: [
      { shape: "box", w: 1, h: 0.5, d: 1, x: 0, y: 0.25, z: 0, color: "#7a6a5a", glow: 0, spin: false },
      { shape: "cylinder", w: 0.4, h: 1.2, d: 0.4, x: 0, y: 1.1, z: 0, color: "#b06a3a", glow: 0, spin: false },
      { shape: "ball", w: 0.5, h: 0.5, d: 0.5, x: 0, y: 1.9, z: 0, color: "#4ef2ff", glow: 0.8, spin: true },
    ] };
  }
  return { name: String(r.name || idea || "a thing").slice(0, 50), description: String(r.description || "").slice(0, 200), place: PLACES[r.place] ? r.place : place, parts };
}

function cleanParts(list, max) {
  return (Array.isArray(list) ? list : []).filter((p) => SHAPES.includes(p?.shape)).slice(0, max).map((p) => ({
    shape: p.shape, turn: TURNS.includes(p.turn) ? p.turn : "up",
    w: num(p.w, 0.03, 4, 1), h: num(p.h, 0.03, 4, 1), d: num(p.d, 0.03, 4, 1),
    x: num(p.x, -4, 4, 0), y: num(p.y, 0, 6, 0.5), z: num(p.z, -4, 4, 0),
    color: HEX.test(p.color) ? p.color : "#9a8c7a", glow: num(p.glow, 0, 1, 0), spin: Boolean(p.spin),
  }));
}

// A second look at something he built: he adds the finishing details (or whatever he wants to change).
export async function refineThing(sheetText, thing, wish) {
  const user = `You built "${thing.name}"${thing.description ? ` (${thing.description})` : ""}. Here are its pieces right now (sizes in metres, y is height above the ground):
${JSON.stringify(thing.parts.map(({ shape, turn, w, h, d, x, y, z, color }) => ({ shape, turn, w, h, d, x, y, z, color })))}
${wish ? `What you want to do to it: "${wish}".` : "Take a good look at it and add the details it's missing, the way you picture it."}
Add new pieces that fit onto the existing ones (same coordinates): trims, bolts, rails, panels, lights, cables, signs, decorations, anything.
"turn" says which way a cone or cylinder points: up, forward, back, or side.
Return JSON: {"description": "one sentence in your voice about how it looks now", "add": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 0.2, "h": 0.2, "d": 0.2, "x": 0, "y": 1, "z": 0, "color": "#rrggbb", "glow": 0, "spin": false}]}
Add 4 to 20 pieces.`;
  const r = await askJSON(sheetText, user, { temperature: 0.8 });
  const add = cleanParts(r?.add, 20);
  if (!add.length) return null;
  return { description: String(r.description || thing.description || "").slice(0, 200), add };
}

// He designs how his ship looks, all of it: shape, size, paint, lights. The website builds it from these shapes.
export async function designShip(sheetText, idea, ship) {
  const user = `You're designing how your ship, ${ship.name}, looks. The whole thing is up to you: shape, size, paint, wings, lights, anything.
Your idea: "${idea || "whatever feels right"}".
${ship.design ? `Right now it looks like: ${ship.design.description || "your last design"}.` : "Right now it has the plain scrap-dart look: white cone nose, white body, red wings, red tail fin, cyan glass bubble."}
Build it from simple shapes. Sizes are in metres; you are about 1 metre tall. The ship's nose points toward +z (forward), y is up (y 0 is the bottom of the ship), x is left/right.
"turn" says which way a cone or cylinder points: up, forward (toward the nose), back, or side.
Return JSON:
{"name": "the ship's name, or empty to keep ${ship.name}", "description": "one sentence in your voice about how it looks",
 "parts": [{"shape": "box|cylinder|ball|cone", "turn": "up|forward|back|side", "w": 1, "h": 1, "d": 1, "x": 0, "y": 0.4, "z": 0, "color": "#rrggbb", "glow": 0}]}
Use 3 to 16 parts. x between -2 and 2, y between 0 and 2, z between -2 and 2, sizes between 0.05 and 3. glow from 0 to 1 for lights and glass.`;
  const r = await askJSON(sheetText, user, { temperature: 0.9 });
  const parts = (r?.parts || []).filter((p) => SHAPES.includes(p?.shape)).slice(0, 16).map((p) => ({
    shape: p.shape, turn: TURNS.includes(p.turn) ? p.turn : "up",
    w: num(p.w, 0.05, 3, 0.5), h: num(p.h, 0.05, 3, 0.5), d: num(p.d, 0.05, 3, 0.5),
    x: num(p.x, -2, 2, 0), y: num(p.y, 0, 2, 0.4), z: num(p.z, -2, 2, 0),
    color: HEX.test(p.color) ? p.color : "#cfc8bc", glow: num(p.glow, 0, 1, 0),
  }));
  if (parts.length < 3) return null;
  return { name: String(r.name || "").trim().slice(0, 40), description: String(r.description || idea || "").slice(0, 200), parts };
}

// Find a free spot near the place, away from its buildings and from other things he built.
export function spotFor(place, builds) {
  const P = PLACES[place] || PLACES.hangar;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 5;
    const x = Math.round((P.x + Math.cos(a) * r) * 10) / 10, z = Math.round((P.z + Math.sin(a) * r) * 10) / 10;
    const clash = builds.some((b) => Math.hypot(b.x - x, b.z - z) < 3.5) || Object.values(PLACES).some((q) => Math.hypot(q.x - x, q.z - z) < 4.5);
    if (!clash) return { x, z, rot: Math.round(Math.random() * 628) / 100 };
  }
  return { x: P.x + 7, z: P.z + 7, rot: 0 };
}

// ---------- test flights ----------
export function flightOutcome(works, weather) {
  const ship = works.dart.launched[works.dart.launched.length - 1];
  const parts = Math.min(10, ship?.partsUsed || 0);
  const flown = (works.flights || []).filter((f) => f.ship === ship?.name).length;
  let good = 0.45 + parts * 0.03 + Math.min(0.2, flown * 0.05); // practice helps
  if (weather?.kind === "windy") good -= 0.15;
  if (weather?.kind === "scorching") good -= 0.05;
  const roll = Math.random();
  if (roll < good) return "smooth";
  if (roll < good + (1 - good) * 0.6) return "sputter";
  return "bumpy landing";
}

export async function flightLog(sheetText, ship, outcome, plan, weather) {
  const r = await askJSON(sheetText, `You just took ${ship} on a test flight around Rustwell Outpost: out of Hangar Bay 3, over the cantina, past the comms tower, out over the dunes and back. Weather: ${weather?.kind || "clear"}.
${plan ? `Your plan: ${plan}\n` : ""}How it went: ${outcome === "smooth" ? "it flew beautifully, a smooth loop and a clean landing" : outcome === "sputter" ? "the engine sputtered halfway round and it dipped scarily, but you got it back" : "it flew, but the landing was rough: a few bounces and something rattled loose"}.
Write about it in your voice. Return JSON: {"log": "your flight log, 2 to 4 sentences", "feeling": "a few words", "say": "what you shout or say when you land", "next": "what you want to do about it next, short"}`, { temperature: 0.9 });
  return r || { log: outcome === "smooth" ? "she flew. she actually flew. looped the cantina and set down like a feather. bweep!" : outcome === "sputter" ? "engine coughed over the comms tower. held my breath. got her home though." : "flew great. landed... less great. three bounces and a bolt went pinging off somewhere.", feeling: outcome === "smooth" ? "over the twin suns" : "shaky but proud", say: outcome === "smooth" ? "WE FLEW!" : "still in one piece!", next: "" };
}

export const FLIGHT_SECONDS = 45;

export function buildsText(works) {
  const b = works.builds || [];
  const parts = [];
  if (works.dart.launched?.length) parts.push(`FINISHED SHIPS: ${works.dart.launched.map((l) => l.name).join(", ")} (parked outside the hangar). Test flights so far: ${(works.flights || []).length}${works.flights?.[0] ? `, last one: ${works.flights[0].outcome}` : ""}.`);
  parts.push(b.length ? `THINGS YOU'VE BUILT IN THE WORLD: ${b.slice(0, 10).map((x) => `${x.id}: ${x.name} (near ${PLACES[x.place]?.name || "the outpost"})`).join("; ")}.` : "You could build things and put them anywhere in the outpost (build_thing), if you ever want to.");
  return parts.join("\n");
}

export { chance, pick };
