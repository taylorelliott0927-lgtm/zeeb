// Things Zeeb adds to the world himself, and test flights of the ships he finishes.
// He designs each object out of simple shapes; the website draws it in 3D exactly where he put it.
import { askJSON } from "./llm.js";
import { PLACES } from "./world.js";
import { clamp, chance, pick } from "./util.js";
import { catalog, cleanModelPart, describeModel, hasLibrary, searchModels } from "./library.js";

// Before building, he can look things up in his model library (free 3D models). Up to him.
export async function lookUpModels(sheetText, idea) {
  if (!hasLibrary()) return { searches: [], found: [] };
  const tags = {};
  for (const m of catalog()) for (const t of m.tags) tags[t] = (tags[t] || 0) + 1;
  const common = Object.entries(tags).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t).join(", ");
  const r = await askJSON(sheetText, `You're about to build: "${idea}".
You have a library of ${catalog().length} ready-made 3D models you can use in your builds (free models by Kenney). Common words in it: ${common}.
Do you want to look anything up in it? You can search up to 3 times, or not at all if you'd rather make everything yourself.
Return JSON: {"searches": ["a few words", "..."]}`, { temperature: 0.8 });
  const searches = (Array.isArray(r?.searches) ? r.searches : []).map((x) => String(x).slice(0, 60)).filter(Boolean).slice(0, 3);
  const found = [];
  for (const q of searches) for (const m of searchModels(q, 6)) if (!found.includes(m)) found.push(m);
  return { searches, found: found.slice(0, 14) };
}

const modelsText = (found) => found?.length ? `
MODELS YOU FOUND IN YOUR LIBRARY (use any of them, as many times as you like, mixed with your own shapes, or none):
${found.map(describeModel).join("\n")}
To use one, add a part like {"model": "the id", "x": 0, "y": 0, "z": 0, "height": 1.5, "turn_degrees": 0}: height is how tall you want it in metres, y is where its base sits, turn_degrees turns it around.` : "";

function allParts(list, maxShapes) {
  const shapes = cleanParts(list, maxShapes);
  const models = (Array.isArray(list) ? list : []).filter((p) => p?.model).map(cleanModelPart).filter(Boolean).slice(0, 15);
  return [...shapes, ...models];
}

export const MAX_BUILDS = 100;
const SHAPES = ["box", "cylinder", "ball", "cone"];
const TURNS = ["up", "forward", "back", "side"];
const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };

// The motions he can choose for his body (the website animates them).
export const MOTIONS = ["bounce", "spin", "wiggle", "nod", "shake", "droop", "hop", "dance", "look_up", "wave", "pace", "zoom", "tremble", "float_high", "bow", "lean_in", "celebrate"];
export const cleanBody = (b) => (Array.isArray(b) ? b : String(b || "").split(/[ ,]+/)).map((x) => String(x).toLowerCase().trim()).filter((x) => MOTIONS.includes(x)).slice(0, 2);

export async function designThing(sheetText, idea, place, stash, found = []) {
  const user = `You've decided to build something and put it in the world: "${idea}".
Where: ${PLACES[place]?.name || "near Hangar Bay 3"}. Parts in your stash: ${stash.map((p) => p.what).join(", ") || "just scrap lying around"}.
Design it out of simple shapes so it can be built. Build it properly, with all its pieces: legs, frames, panels, trims, bolts, handles, lights, cables, signs, whatever it really has. Sizes are in metres; you are about 1 metre tall. y is height above the ground (0 = on the ground, so a 1-metre-tall box sits at y 0.5).
"turn" says which way a cone or cylinder points: up, forward, back, or side (use it for pipes, rails, beams and arms lying down).
Return JSON:
{"name": "what you call it", "description": "one sentence in your voice", "place": "${Object.keys(PLACES).join("|")}",
 "parts": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 1, "h": 1, "d": 1, "x": 0, "y": 0.5, "z": 0, "color": "#rrggbb", "glow": 0, "spin": false}]}
Use 8 to 40 parts. x and z between -4 and 4, y between 0 and 6, sizes between 0.03 and 4. glow from 0 to 1 for lights. spin true for parts that should turn.${modelsText(found)}`;
  const r = await askJSON(sheetText, user, { temperature: 0.9 });
  const parts = allParts(r?.parts, 40);
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
export async function refineThing(sheetText, thing, wish, found = []) {
  const user = `You built "${thing.name}"${thing.description ? ` (${thing.description})` : ""}. Here are its pieces right now (sizes in metres, y is height above the ground):
${JSON.stringify(thing.parts.map((p) => (p.model ? { model: p.model, name: p.name, x: p.x, y: p.y, z: p.z, height: p.height } : { shape: p.shape, turn: p.turn, w: p.w, h: p.h, d: p.d, x: p.x, y: p.y, z: p.z, color: p.color })))}
${wish ? `What you want to do to it: "${wish}".` : "Take a good look at it and add the details it's missing, the way you picture it."}
Add new pieces that fit onto the existing ones (same coordinates): trims, bolts, rails, panels, lights, cables, signs, decorations, anything.
"turn" says which way a cone or cylinder points: up, forward, back, or side.
Return JSON: {"description": "one sentence in your voice about how it looks now", "add": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 0.2, "h": 0.2, "d": 0.2, "x": 0, "y": 1, "z": 0, "color": "#rrggbb", "glow": 0, "spin": false}]}
Add 4 to 20 pieces.${modelsText(found)}`;
  const r = await askJSON(sheetText, user, { temperature: 0.8 });
  const add = allParts(r?.add, 20);
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

// ---------- ships, planned part by part so they always read as a ship ----------
// Where each kind of ship part goes (ship space: nose toward +z, y up, centre line x 0). These are just
// where the parts physically sit; what each one looks like, its size, shape and colour is all his.
const SHIP_ROLES = {
  hull: "the main body, along the centre line (x 0), running front to back (z from about -1.2 to 1.2), y about 0.2 to 0.7. Usually long cylinders/boxes with turn forward",
  nose: "the very front, z from about 1.0 to 2.0, joined to the hull. A cone with turn forward is classic",
  cockpit: "on top of the hull toward the front, y about 0.6 to 0.9, z about 0.2 to 0.9. Glass parts can glow",
  wings: "out to both sides of the hull (x from about ±0.4 to ±1.8), mirrored left and right, thin (small h), around y 0.3",
  engines: "the back, z about -1.0 to -1.9. Cylinders or cones with turn back, often in pairs, with glowing exhausts",
  fins: "on top or at the back (tail fins, stabilisers), thin, mirrored if they're on the sides",
  extras: "anything else you want on it (antennas, lights, stripes, cargo pods, guns, landing legs), attached to the hull, wings or engines",
};
const SHIP_SHAPES = ["box", "cylinder", "ball", "cone"];
function cleanShipParts(list, max) {
  return (Array.isArray(list) ? list : []).filter((p) => SHIP_SHAPES.includes(p?.shape)).slice(0, max).map((p) => ({
    shape: p.shape, turn: TURNS.includes(p.turn) ? p.turn : "up",
    w: num(p.w, 0.03, 3, 0.5), h: num(p.h, 0.03, 3, 0.5), d: num(p.d, 0.03, 3, 0.5),
    x: num(p.x, -2.2, 2.2, 0), y: num(p.y, 0, 2, 0.4), z: num(p.z, -2.2, 2.2, 0),
    color: HEX.test(p.color) ? p.color : "#cfc8bc", glow: num(p.glow, 0, 1, 0),
  }));
}
const extentOf = (p) => { const len = p.turn === "forward" || p.turn === "back" ? p.h : p.d, tall = p.turn === "up" ? p.h : p.turn === "side" ? p.w : p.d, wide = p.turn === "side" ? p.h : p.w; return { x0: p.x - wide / 2, x1: p.x + wide / 2, y0: p.y - tall / 2, y1: p.y + tall / 2, z0: p.z - len / 2, z1: p.z + len / 2 }; };
// Does it have the basics of a ship: longer front-to-back than it is tall, with something at the front and something at the back?
export function looksLikeShip(parts) {
  if (parts.length < 4) return false;
  const e = parts.map(extentOf);
  const z0 = Math.min(...e.map((b) => b.z0)), z1 = Math.max(...e.map((b) => b.z1)), y0 = Math.min(...e.map((b) => b.y0)), y1 = Math.max(...e.map((b) => b.y1));
  return z1 - z0 >= 1.6 && z1 - z0 > (y1 - y0) * 1.2 && e.some((b) => b.z1 > 0.8) && e.some((b) => b.z0 < -0.8);
}

export async function planShip(sheetText, idea, ship) {
  const r = await askJSON(sheetText, `You're designing how your ship, ${ship.name}, looks. It's all up to you: its style, size, colours and every part.
Your idea: "${idea || "whatever feels right"}".
${ship.design ? `Right now it looks like: ${ship.design.description || "your last design"}.` : "Right now it has the plain scrap-dart look: white cone nose, white body, red wings, red tail fin, cyan glass bubble."}
Think it through like a ship designer. A ship's parts are: ${Object.keys(SHIP_ROLES).join(", ")}. For each part you want, say what it looks like.
Return JSON:
{"name": "the ship's name, or empty to keep ${ship.name}", "description": "one sentence in your voice about how it looks", "colors": ["#rrggbb", "#rrggbb"],
 "parts": [{"role": "${Object.keys(SHIP_ROLES).join("|")}", "details": "what this part looks like"}]}
Include at least a hull, a nose, a cockpit, wings and engines (you can skip fins or extras).`, { temperature: 0.85 }).catch(() => null);
  const parts = (Array.isArray(r?.parts) ? r.parts : []).filter((p) => SHIP_ROLES[p?.role]).slice(0, 8);
  for (const role of ["hull", "nose", "cockpit", "wings", "engines"]) if (!parts.some((p) => p.role === role)) parts.push({ role, details: "" });
  const order = Object.keys(SHIP_ROLES);
  parts.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  return { name: String(r?.name || "").trim().slice(0, 40), description: String(r?.description || idea || "").slice(0, 200), colors: (r?.colors || []).filter((c) => HEX.test(c)).slice(0, 4), parts: parts.map((p) => ({ role: p.role, details: String(p.details || "").slice(0, 200) })) };
}

export async function buildShipPart(sheetText, plan, part, soFar) {
  const placed = soFar.slice(-24).map((p) => `${p.shape}${p.turn !== "up" ? `(${p.turn})` : ""} ${p.w}x${p.h}x${p.d} at (${p.x}, ${p.y}, ${p.z})`).join("; ");
  const r = await askJSON(sheetText, `You're building your ship "${plan.name || "your ship"}": ${plan.description}. Colours: ${plan.colors.join(", ") || "your choice"}.
Ship space: the nose points toward +z, y is up (y 0 is the bottom), x is left/right, the centre line is x 0. Sizes in metres; x, y, z is the centre of each shape.
"turn" says which way a cone or cylinder points: up, forward (toward the nose), back, or side.
Already built: ${placed || "nothing yet"}.
Now build the ${part.role.toUpperCase()}${part.details ? `: ${part.details}` : ""}.
Where it goes: ${SHIP_ROLES[part.role]}. Make it fit onto what's already built.
Return JSON: {"parts": [{"shape": "box|cylinder|ball|cone", "turn": "forward", "w": 0.5, "h": 0.5, "d": 0.5, "x": 0, "y": 0.4, "z": 0, "color": "#rrggbb", "glow": 0}]}
Use 1 to 8 shapes for this part.`, { temperature: 0.7 }).catch(() => null);
  return cleanShipParts(r?.parts, 8);
}

// A last honest look: does it look like what he meant to make? He can take pieces off and add new ones.
export async function reviewDesign(sheetText, what, description, parts, space) {
  const list = parts.slice(0, 70).map((p, i) => (p.model ? `${i}: ${p.name} model at (${p.x}, ${p.y}, ${p.z})` : `${i}: ${p.shape}${p.turn && p.turn !== "up" ? `(${p.turn})` : ""} ${p.w}x${p.h}x${p.d} at (${p.x}, ${p.y}, ${p.z}) ${p.color}`)).join("\n");
  const r = await askJSON(sheetText, `You just built ${what}: ${description}.
${space}
Its pieces (number: shape, size w x h x d, position, colour):
${list}
Picture it from the side and from above. Does it really look like ${what}? Are any pieces floating, in the wrong place, too big, or missing?
Return JSON: {"looks_right": true, "remove": [piece numbers to take off], "add": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 0.3, "h": 0.3, "d": 0.3, "x": 0, "y": 0.5, "z": 0, "color": "#rrggbb", "glow": 0}], "why": "one short sentence"}`, { temperature: 0.5 }).catch(() => null);
  if (!r) return { parts, changed: false };
  const drop = new Set((Array.isArray(r.remove) ? r.remove : []).map(Number).filter((n) => Number.isInteger(n)));
  const kept = parts.filter((_, i) => !drop.has(i) || drop.size > parts.length / 3); // never let one review wipe out most of it
  return { parts: [...kept, ...r.add?.length ? (space.includes("nose") ? cleanShipParts(r.add, 10) : allParts(r.add, 10)) : []], changed: drop.size > 0 || Boolean(r.add?.length), why: String(r.why || "").slice(0, 160) };
}

// ---------- building with real thought: plan first, then build it piece by piece ----------
// 1. He thinks it through: what it's for, how big, its colours, and the parts it's made of.
export async function planBuild(sheetText, idea, place, stash, found = []) {
  const r = await askJSON(sheetText, `You've decided to build something and put it in the world: "${idea}".
Where: ${PLACES[place]?.name || "near Hangar Bay 3"}. Parts in your stash: ${stash.map((p) => p.what).join(", ") || "just scrap"}.
${found.length ? `Models you found in your library that you could use: ${found.map((m) => m.name).join(", ")}.` : ""}
Before building, think it through properly, like a real builder. What is it for? How big is it (you're about 1 metre tall)? What does it look like, what colours and materials? What are all the main parts it's made of, and where does each one go?
Return JSON:
{"name": "what you call it", "description": "one sentence in your voice", "purpose": "what it's for", "place": "${Object.keys(PLACES).join("|")}",
 "size": {"width": 3, "depth": 2, "height": 2}, "colors": ["#rrggbb", "#rrggbb"],
 "components": [{"name": "e.g. base platform", "details": "what it looks like and what's on it", "where": "where it sits on the build"}]}
List 4 to 8 components.`, { temperature: 0.8 }).catch(() => null);
  if (!r?.components?.length) return null;
  const n = (v, lo, hi, d) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  return {
    name: String(r.name || idea).slice(0, 50), description: String(r.description || "").slice(0, 200), purpose: String(r.purpose || "").slice(0, 160),
    place: PLACES[r.place] ? r.place : place,
    size: { width: n(r.size?.width, 0.5, 8, 3), depth: n(r.size?.depth, 0.5, 8, 2), height: n(r.size?.height, 0.3, 6, 2) },
    colors: (Array.isArray(r.colors) ? r.colors : []).filter((c) => HEX.test(c)).slice(0, 5),
    components: r.components.slice(0, 8).map((c) => ({ name: String(c.name || "part").slice(0, 50), details: String(c.details || "").slice(0, 200), where: String(c.where || "").slice(0, 120) })),
  };
}

// 2. Then he builds each part of his plan in detail, one at a time, fitting it to what's already there.
export async function buildComponent(sheetText, plan, comp, partsSoFar, found = []) {
  const placed = partsSoFar.slice(-30).map((p) => (p.model ? `${p.name} model at (${p.x}, ${p.y}, ${p.z}), ${p.height} tall` : `${p.shape} ${p.w}x${p.h}x${p.d} at (${p.x}, ${p.y}, ${p.z})`)).join("; ");
  const r = await askJSON(sheetText, `You're building "${plan.name}" (${plan.description}). Overall size about ${plan.size.width} wide (x), ${plan.size.depth} deep (z), ${plan.size.height} tall (y), centred on x 0, z 0, standing on y 0. Colours: ${plan.colors.join(", ") || "your choice"}.
Your plan's parts: ${plan.components.map((c) => c.name).join(", ")}.
Already built: ${placed || "nothing yet"}.
Now build this part in detail: "${comp.name}": ${comp.details}${comp.where ? `, ${comp.where}` : ""}.
Use as many simple shapes as it needs to look right (frames, panels, edges, bolts, handles, lights, trims...). Sizes in metres; x, y, z is the centre of each shape; y is height above the ground.
"turn" says which way a cone or cylinder points: up, forward, back, or side.${modelsText(found)}
Return JSON: {"parts": [{"shape": "box|cylinder|ball|cone", "turn": "up", "w": 0.5, "h": 0.5, "d": 0.5, "x": 0, "y": 0.25, "z": 0, "color": "#rrggbb", "glow": 0, "spin": false}]}
Use 3 to 14 parts for this one piece.`, { temperature: 0.8 }).catch(() => null);
  return allParts(r?.parts, 14);
}

// Find a free spot near the place, away from its buildings and from other things he built.
export function spotFor(place, builds) {
  const P = PLACES[place] || PLACES.hangar;
  // Start close to the place and spread further out as the area fills up.
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 5 + i * 0.35;
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
  if ((works.projects || []).length) parts.push(`BIG PROJECTS YOU'RE BUILDING: ${works.projects.map((p) => `${p.id}: ${p.name} (${p.progress}% built, near ${PLACES[p.place]?.name || "the outpost"})`).join("; ")}.`);
  if (hasLibrary()) parts.push(`YOUR MODEL LIBRARY: ${catalog().length} ready-made 3D models (free, by Kenney) you can search and use whenever you build or add to something.`);
  return parts.join("\n");
}

export { chance, pick };
