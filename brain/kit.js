// Zeeb's builder's kit. He decides what to build and describes it with ready-made pieces
// (platforms, walls, roofs, pillars, lamps, tanks, models from his library...) and where they go
// ("front corners", "on the roof", "around the edge"). This file turns his choices into well-made 3D shapes,
// so his builds look like what he meant. He can still add his own free shapes for extra details.
import { askJSON } from "./llm.js";
import { cleanModelPart, describeModel } from "./library.js";
import { clamp } from "./util.js";

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? clamp(n, lo, hi) : d; };
const SIZE = { tiny: 0.5, small: 0.75, medium: 1, large: 1.4, huge: 1.9 };
const r2 = (v) => Math.round(v * 100) / 100;

export const KIT = {
  platform: "a raised base/floor the build stands on (height)",
  walls: "walls around the build (sides: all, or a list like back/left/right/front; height; door: front/back/left/right/none; windows: number per wall)",
  roof: "a roof on top of the walls (style: flat, slanted, curved, dome)",
  pillars: "round columns (where; height)",
  railing: "a railing with posts (where: around, or along front/back/left/right)",
  fence: "a low fence (where: around, or along a side)",
  stairs: "steps up onto the platform (where: front/back/left/right)",
  door: "a door on its own (where: front/back/left/right)",
  tank: "a storage tank (where; size)",
  pipes: "pipes with brackets (where: along front/back/left/right)",
  antenna: "a mast with a glowing tip (where; height)",
  dish: "a satellite dish (where)",
  lamp: "a lamp post with a light (where; color of light)",
  light_strip: "a glowing strip of lights (where: along front/back/left/right, or around)",
  sign: "a sign board on posts (where)",
  crates: "a stack of crates (where; count)",
  barrels: "a group of barrels (where; count)",
  console: "a machine/computer console with a screen and buttons (where)",
  bench: "a bench (where)",
  mast: "a tall lattice tower (where; height)",
  flag: "a flag on a pole (where)",
  plant: "a little desert plant or cactus (where; count)",
  workbench: "a workbench with tools (where)",
  model: "a ready-made model from your library (model id; where; height in metres)",
};
const WHERES = "center, front, back, left, right, front-left, front-right, back-left, back-right, corners, front corners, back corners, around, along front, along back, along left, along right";

// ----- turning "where" into spots on the build -----
function spots(where, W, D, inset = 0.35) {
  const hx = Math.max(0.2, W / 2 - inset), hz = Math.max(0.2, D / 2 - inset);
  const w = String(where || "center").toLowerCase().replace(/[_-]/g, " ").trim();
  const map = {
    center: [[0, 0]], middle: [[0, 0]], front: [[0, hz]], back: [[0, -hz]], left: [[-hx, 0]], right: [[hx, 0]],
    "front left": [[-hx, hz]], "front right": [[hx, hz]], "back left": [[-hx, -hz]], "back right": [[hx, -hz]],
    corners: [[-hx, hz], [hx, hz], [-hx, -hz], [hx, -hz]], "front corners": [[-hx, hz], [hx, hz]], "back corners": [[-hx, -hz], [hx, -hz]],
    "left corners": [[-hx, hz], [-hx, -hz]], "right corners": [[hx, hz], [hx, -hz]], sides: [[-hx, 0], [hx, 0]], "both sides": [[-hx, 0], [hx, 0]],
  };
  if (map[w]) return map[w];
  for (const k of Object.keys(map).sort((a, b) => b.length - a.length)) if (w.includes(k)) return map[k];
  return [[0, 0]];
}
// a straight run along one side (for railings, pipes, light strips), or all four sides for "around"
function runs(where, W, D, inset = 0.1) {
  const hx = W / 2 - inset, hz = D / 2 - inset, w = String(where || "around").toLowerCase();
  const all = { front: [[-hx, hz], [hx, hz]], back: [[-hx, -hz], [hx, -hz]], left: [[-hx, -hz], [-hx, hz]], right: [[hx, -hz], [hx, hz]] };
  if (w.includes("around") || w.includes("all") || w.includes("edge")) return Object.values(all);
  const out = Object.entries(all).filter(([k]) => w.includes(k)).map(([, v]) => v);
  return out.length ? out : [all.front];
}

// ----- the builder: kit pieces -> simple shapes (same format the website draws) -----
export function expandKit(bp) {
  const W = num(bp.size?.width, 1, 12, 4), D = num(bp.size?.depth, 1, 12, 3);
  const col = { main: "#8f8a80", accent: "#d0602e", trim: "#3a3a42", glow: "#ffd34d", ...Object.fromEntries(Object.entries(bp.colors || {}).filter(([, v]) => HEX.test(v))) };
  const parts = [];
  const P = (shape, w, h, d, x, y, z, color, more = {}) => parts.push({ shape, w: r2(w), h: r2(h), d: r2(d), x: r2(x), y: r2(y), z: r2(z), color: HEX.test(color || "") ? color : col.main, glow: 0, turn: "up", ...more });
  const pieces = (Array.isArray(bp.pieces) ? bp.pieces : []).slice(0, 30);
  const get = (k) => pieces.filter((p) => String(p.kit).toLowerCase() === k);
  let floorY = 0, wallH = 0, roofY = 0;
  const level = (p) => {
    const on = String(p.on || "").toLowerCase();
    if (on.includes("roof") || on.includes("top")) return roofY || floorY;
    if (on.includes("ground")) return 0;
    return floorY;
  };
  const colorOf = (p, d) => (HEX.test(p.color || "") ? p.color : col[p.color] || d);

  // platform first, then walls, then roof (so things know what they sit on)
  for (const p of get("platform").slice(0, 1)) {
    const h = num(p.height, 0.05, 1.5, 0.25), c = colorOf(p, col.main);
    P("box", W, h, D, 0, h / 2, 0, c);
    P("box", W + 0.06, 0.06, 0.06, 0, h - 0.03, D / 2, col.trim); P("box", W + 0.06, 0.06, 0.06, 0, h - 0.03, -D / 2, col.trim);
    P("box", 0.06, 0.06, D + 0.06, W / 2, h - 0.03, 0, col.trim); P("box", 0.06, 0.06, D + 0.06, -W / 2, h - 0.03, 0, col.trim);
    floorY = h;
  }
  for (const p of get("walls").slice(0, 1)) {
    const h = num(p.height, 0.5, 5, 2.2), t = 0.14, c = colorOf(p, col.main);
    const sides = String(Array.isArray(p.sides) ? p.sides.join(" ") : p.sides || "all").toLowerCase();
    const want = (s) => sides.includes("all") || sides.includes(s);
    const door = String(p.door || "front").toLowerCase();
    const wins = Math.round(num(p.windows, 0, 4, 1));
    const y = floorY + h / 2;
    const wall = (side) => {
      const along = side === "front" || side === "back", len = along ? W : D;
      const at = side === "front" ? [0, D / 2 - t / 2] : side === "back" ? [0, -D / 2 + t / 2] : side === "left" ? [-W / 2 + t / 2, 0] : [W / 2 - t / 2, 0];
      const box = (l, hh, off, yy, color, extra = 0) => (along ? P("box", l, hh, t + extra, at[0] + off, yy, at[1], color) : P("box", t + extra, hh, l, at[0], yy, at[1] + off, color));
      if (door.includes(side)) {
        const dw = Math.min(1.1, len * 0.4), dh = Math.min(h * 0.8, 1.8), seg = (len - dw) / 2;
        box(seg, h, -(dw / 2 + seg / 2), y, c); box(seg, h, dw / 2 + seg / 2, y, c);
        box(dw, h - dh, 0, floorY + dh + (h - dh) / 2, c);
        box(dw * 0.9, dh * 0.97, 0, floorY + dh / 2, col.accent, -0.06); // the door itself, set in a little
        box(0.08, 0.08, dw * 0.3, floorY + dh * 0.5, col.trim, 0.06); // handle
      } else box(len, h, 0, y, c);
      box(len + 0.04, 0.08, 0, floorY + h - 0.04, col.trim, 0.04); // trim along the top
      for (let i = 0; i < wins && !door.includes(side); i++) { const off = (i + 1) * (len / (wins + 1)) - len / 2; box(Math.min(0.6, len / (wins + 1) * 0.6), 0.45, off, floorY + h * 0.6, col.glow, 0.04); parts[parts.length - 1].glow = 0.6; }
    };
    for (const s of ["back", "left", "right", "front"]) if (want(s)) wall(s);
    wallH = h; roofY = floorY + h;
  }
  for (const p of get("roof").slice(0, 1)) {
    const base = roofY || floorY + 2, c = colorOf(p, col.accent), style = String(p.style || "flat").toLowerCase();
    if (style.includes("slant") || style.includes("peak") || style.includes("pitch")) {
      const rise = Math.min(1.2, D * 0.3), slope = Math.hypot(D / 2, rise), ang = Math.atan2(rise, D / 2) * 180 / Math.PI;
      P("box", W + 0.3, 0.1, slope + 0.15, 0, base + rise / 2, D / 4, c, { rot: [-ang, 0, 0] });
      P("box", W + 0.3, 0.1, slope + 0.15, 0, base + rise / 2, -D / 4, c, { rot: [ang, 0, 0] });
      P("box", W + 0.32, 0.08, 0.1, 0, base + rise, 0, col.trim);
      roofY = base + rise;
    } else if (style.includes("curv") || style.includes("arch") || style.includes("vault")) {
      P("cylinder", D, W + 0.2, D, 0, base, 0, c, { turn: "side" });
      roofY = base + D / 2;
    } else if (style.includes("dome")) {
      const r = Math.min(W, D);
      P("ball", r, r * 0.7, r, 0, base, 0, c);
      P("ball", 0.25, 0.25, 0.25, 0, base + r * 0.35, 0, col.glow, { glow: 0.8 });
      roofY = base + r * 0.35;
    } else {
      P("box", W + 0.3, 0.14, D + 0.3, 0, base + 0.07, 0, c);
      P("box", W + 0.34, 0.1, 0.1, 0, base + 0.19, D / 2 + 0.15, col.trim); P("box", W + 0.34, 0.1, 0.1, 0, base + 0.19, -D / 2 - 0.15, col.trim);
      roofY = base + 0.14;
    }
  }
  if (!roofY) roofY = floorY;

  for (const p of pieces) {
    const k = String(p.kit || "").toLowerCase(), s = SIZE[String(p.size || "medium").toLowerCase()] || 1;
    if (["platform", "walls", "roof"].includes(k)) continue;
    const y0 = level(p), c = colorOf(p, col.main);
    const at = (inset) => spots(p.where, W, D, inset);
    switch (k) {
      case "pillars": { const h = num(p.height, 0.3, 6, wallH || 2); for (const [x, z] of at(0.25)) { P("cylinder", 0.25 * s, h, 0.25 * s, x, y0 + h / 2, z, c); P("box", 0.36 * s, 0.1, 0.36 * s, x, y0 + h - 0.05, z, col.trim); P("box", 0.36 * s, 0.1, 0.36 * s, x, y0 + 0.05, z, col.trim); } break; }
      case "railing": case "fence": {
        const h = k === "fence" ? 0.6 : 0.9;
        for (const [[ax, az], [bx, bz]] of runs(p.where, W, D)) {
          const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / 0.8)), alongX = Math.abs(bx - ax) > Math.abs(bz - az);
          for (let i = 0; i <= n; i++) { const t = i / n; P("cylinder", 0.06, h, 0.06, ax + (bx - ax) * t, y0 + h / 2, az + (bz - az) * t, col.trim); }
          P("cylinder", 0.06, len, 0.06, (ax + bx) / 2, y0 + h, (az + bz) / 2, c, { turn: alongX ? "side" : "forward" });
          if (k === "railing") P("cylinder", 0.04, len, 0.04, (ax + bx) / 2, y0 + h / 2, (az + bz) / 2, c, { turn: alongX ? "side" : "forward" });
        }
        break;
      }
      case "stairs": {
        const top = floorY || 0.6, n = Math.max(2, Math.round(top / 0.18)), side = String(p.where || "front").toLowerCase();
        for (let i = 0; i < n; i++) {
          const hh = top * (i + 1) / n, out = (n - i) * 0.28;
          if (side.includes("back")) P("box", 1.2, hh, 0.3, 0, hh / 2, -D / 2 - out + 0.14, c);
          else if (side.includes("left")) P("box", 0.3, hh, 1.2, -W / 2 - out + 0.14, hh / 2, 0, c);
          else if (side.includes("right")) P("box", 0.3, hh, 1.2, W / 2 + out - 0.14, hh / 2, 0, c);
          else P("box", 1.2, hh, 0.3, 0, hh / 2, D / 2 + out - 0.14, c);
        }
        break;
      }
      case "door": { for (const [x, z] of spots(p.where || "front", W, D, 0.05)) { const side = Math.abs(z) >= Math.abs(x); P("box", side ? 0.9 : 0.1, 1.8, side ? 0.1 : 0.9, x, y0 + 0.9, z, colorOf(p, col.accent)); P("box", side ? 1.05 : 0.12, 0.1, side ? 0.12 : 1.05, x, y0 + 1.85, z, col.trim); } break; }
      case "tank": { for (const [x, z] of at(0.6 * s)) { const r = 0.9 * s, h = 1.6 * s; P("cylinder", r, h, r, x, y0 + h / 2, z, c); P("ball", r, r * 0.5, r, x, y0 + h, z, c); for (const f of [0.25, 0.75]) P("cylinder", r + 0.04, 0.06, r + 0.04, x, y0 + h * f, z, col.trim); P("cylinder", 0.1, 0.3, 0.1, x + r / 2, y0 + h * 0.3, z, col.accent, { turn: "side" }); } break; }
      case "pipes": {
        const h = num(p.height, 0.2, 4, 0.8);
        for (const [[ax, az], [bx, bz]] of runs(p.where || "along back", W, D, 0.2)) {
          const len = Math.hypot(bx - ax, bz - az), alongX = Math.abs(bx - ax) > Math.abs(bz - az);
          for (const dy of [0, 0.25]) P("cylinder", 0.14 * s, len, 0.14 * s, (ax + bx) / 2, y0 + h + dy, (az + bz) / 2, dy ? col.accent : c, { turn: alongX ? "side" : "forward" });
          for (let i = 0; i <= 2; i++) { const t = i / 2; P("box", 0.08, h + 0.3, 0.08, ax + (bx - ax) * t, y0 + (h + 0.3) / 2, az + (bz - az) * t, col.trim); }
        }
        break;
      }
      case "antenna": { const h = num(p.height, 0.5, 8, 2.5); for (const [x, z] of at(0.2)) { P("cylinder", 0.07, h, 0.07, x, y0 + h / 2, z, col.trim); P("cylinder", 0.3, 0.06, 0.3, x, y0 + h * 0.7, z, c); P("ball", 0.16, 0.16, 0.16, x, y0 + h + 0.05, z, colorOf({ color: p.light }, "#ff4a3a"), { glow: 1 }); } break; }
      case "dish": { for (const [x, z] of at(0.5)) { P("cylinder", 0.1, 0.6, 0.1, x, y0 + 0.3, z, col.trim); P("cone", 1.1 * s, 0.35 * s, 1.1 * s, x, y0 + 0.75, z, c, { rot: [180 + 35, 0, 0] }); P("cylinder", 0.03, 0.5, 0.03, x, y0 + 0.85, z + 0.1, col.trim, { rot: [35, 0, 0] }); } break; }
      case "lamp": { for (const [x, z] of at(0.2)) { const h = num(p.height, 0.6, 5, 2) * s; P("cylinder", 0.08, h, 0.08, x, y0 + h / 2, z, col.trim); P("box", 0.3, 0.06, 0.3, x, y0 + 0.03, z, col.trim); P("ball", 0.28, 0.28, 0.28, x, y0 + h + 0.1, z, colorOf({ color: p.light || p.color }, col.glow), { glow: 1 }); } break; }
      case "light_strip": { for (const [[ax, az], [bx, bz]] of runs(p.where || "along front", W, D, 0.05)) { const len = Math.hypot(bx - ax, bz - az), alongX = Math.abs(bx - ax) > Math.abs(bz - az); P("box", alongX ? len : 0.06, 0.06, alongX ? 0.06 : len, (ax + bx) / 2, y0 + 0.05, (az + bz) / 2, colorOf(p, col.glow), { glow: 1 }); } break; }
      case "sign": { for (const [x, z] of at(0.4)) { for (const dx of [-0.55, 0.55]) P("cylinder", 0.07, 1.4, 0.07, x + dx * s, y0 + 0.7, z, col.trim); P("box", 1.4 * s, 0.6 * s, 0.08, x, y0 + 1.3, z, c); P("box", 1.2 * s, 0.4 * s, 0.1, x, y0 + 1.3, z, colorOf({ color: p.text_color }, col.accent)); } break; }
      case "crates": { const n = Math.round(num(p.count, 1, 6, 3)); for (const [x, z] of at(0.5)) for (let i = 0; i < n; i++) { const sz = 0.55 * s, lx = (i % 2) * sz * 1.05 - sz / 2, ly = Math.floor(i / 3) * sz, lz = (Math.floor(i / 2) % 2) * sz * 1.05 - sz / 2; P("box", sz, sz, sz, x + lx, y0 + ly + sz / 2, z + lz, colorOf(p, "#a0724a")); P("box", sz + 0.02, 0.05, sz + 0.02, x + lx, y0 + ly + sz * 0.5, z + lz, col.trim); } break; }
      case "barrels": { const n = Math.round(num(p.count, 1, 6, 3)); for (const [x, z] of at(0.5)) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, rr = n > 1 ? 0.35 * s : 0; P("cylinder", 0.42 * s, 0.7 * s, 0.42 * s, x + Math.cos(a) * rr, y0 + 0.35 * s, z + Math.sin(a) * rr, colorOf(p, "#4f7f6a")); P("cylinder", 0.44 * s, 0.05, 0.44 * s, x + Math.cos(a) * rr, y0 + 0.5 * s, z + Math.sin(a) * rr, col.trim); } break; }
      case "console": { for (const [x, z] of at(0.5)) { P("box", 0.9 * s, 0.9, 0.5, x, y0 + 0.45, z, c); P("box", 0.7 * s, 0.45, 0.06, x, y0 + 1.1, z - 0.15, col.trim, { rot: [-15, 0, 0] }); P("box", 0.6 * s, 0.36, 0.07, x, y0 + 1.1, z - 0.13, colorOf({ color: p.screen }, "#4ef2ff"), { glow: 0.8, rot: [-15, 0, 0] }); for (const dx of [-0.25, 0, 0.25]) P("ball", 0.08, 0.08, 0.08, x + dx * s, y0 + 0.92, z + 0.12, dx ? col.accent : col.glow, { glow: 0.6 }); } break; }
      case "bench": { for (const [x, z] of at(0.5)) { P("box", 1.4 * s, 0.08, 0.45, x, y0 + 0.45, z, c); for (const dx of [-0.55, 0.55]) P("box", 0.08, 0.45, 0.4, x + dx * s, y0 + 0.22, z, col.trim); P("box", 1.4 * s, 0.35, 0.06, x, y0 + 0.75, z - 0.2, c); } break; }
      case "workbench": { for (const [x, z] of at(0.6)) { P("box", 1.6 * s, 0.1, 0.7, x, y0 + 0.85, z, colorOf(p, "#8a5a36")); for (const [dx, dz] of [[-0.7, -0.28], [0.7, -0.28], [-0.7, 0.28], [0.7, 0.28]]) P("box", 0.08, 0.85, 0.08, x + dx * s, y0 + 0.42, z + dz, col.trim); P("box", 0.3, 0.12, 0.2, x - 0.4, y0 + 0.96, z, col.accent); P("cylinder", 0.05, 0.4, 0.05, x + 0.3, y0 + 0.92, z, col.trim, { turn: "side" }); } break; }
      case "mast": { const h = num(p.height, 2, 10, 5); for (const [x, z] of at(0.5)) { const b = 0.35 * s; for (const [dx, dz] of [[-b, -b], [b, -b], [-b, b], [b, b]]) P("box", 0.07, h, 0.07, x + dx, y0 + h / 2, z + dz, col.trim); for (let yy = 0.8; yy < h; yy += 0.9) P("box", b * 2 + 0.1, 0.06, b * 2 + 0.1, x, y0 + yy, z, c); P("ball", 0.2, 0.2, 0.2, x, y0 + h + 0.1, z, "#ff4a3a", { glow: 1 }); } break; }
      case "flag": { for (const [x, z] of at(0.2)) { P("cylinder", 0.06, 2.2, 0.06, x, y0 + 1.1, z, col.trim); P("box", 0.8, 0.5, 0.03, x + 0.42, y0 + 1.95, z, colorOf(p, col.accent)); } break; }
      case "plant": { const n = Math.round(num(p.count, 1, 5, 1)); for (const [x, z] of at(0.4)) for (let i = 0; i < n; i++) { const dx = (i - (n - 1) / 2) * 0.4; P("cylinder", 0.22 * s, 0.7 * s, 0.22 * s, x + dx, y0 + 0.35 * s, z, colorOf(p, "#4f8f4a")); P("cylinder", 0.1, 0.35 * s, 0.1, x + dx + 0.15, y0 + 0.5 * s, z, colorOf(p, "#4f8f4a"), { rot: [0, 0, -40] }); } break; }
      case "model": {
        const base = cleanModelPart({ model: p.model, height: p.height ?? 1.2, turn_degrees: p.turn_degrees });
        if (base) for (const [x, z] of at(0.5)) parts.push({ ...base, x: r2(x), z: r2(z), y: r2(y0) });
        break;
      }
      default: break;
    }
  }
  // his own free shapes for extra details (placed by hand, on top of everything else)
  for (const p of (Array.isArray(bp.extra_shapes) ? bp.extra_shapes : []).slice(0, 12)) {
    if (!["box", "cylinder", "ball", "cone"].includes(p?.shape)) continue;
    P(p.shape, num(p.w, 0.03, 4, 0.3), num(p.h, 0.03, 4, 0.3), num(p.d, 0.03, 4, 0.3), num(p.x, -6, 6, 0), num(p.y, 0, 8, 0.5), num(p.z, -6, 6, 0), HEX.test(p.color || "") ? p.color : col.accent, { turn: ["up", "forward", "back", "side"].includes(p.turn) ? p.turn : "up", glow: num(p.glow, 0, 1, 0) });
  }
  return { parts: parts.slice(0, 220), frame: { W, D, floorY, wallH, roofY } };
}

// ----- asking him for the blueprint -----
export async function planKitBuild(sheetText, idea, place, places, found = [], stash = []) {
  const r = await askJSON(sheetText, `You've decided to build something and put it in the world: "${idea}".
Where: ${place}. Parts in your stash: ${stash.map((p) => p.what).join(", ") || "just scrap"}.
Think it through like a real builder: what's it for, how big, what does it look like, what is it made of?
You build with your builder's kit. Pieces:
${Object.entries(KIT).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
"where" can be: ${WHERES}. "on" can be: ground, platform (default) or roof. "size" can be: small, medium, large. Colours are #rrggbb or one of your palette names (main, accent, trim, glow).
${found.length ? `MODELS YOU FOUND IN YOUR LIBRARY (use them as "model" pieces):\n${found.map(describeModel).join("\n")}\n` : ""}You can also add a few of your own simple shapes for extra details in "extra_shapes" (x, y, z is the centre in metres; the build is centred on x 0, z 0; front is +z; y is height).
Return JSON:
{"name": "what you call it", "description": "one sentence in your voice", "purpose": "what it's for", "place": "${places.join("|")}",
 "size": {"width": 4, "depth": 3}, "colors": {"main": "#rrggbb", "accent": "#rrggbb", "trim": "#rrggbb", "glow": "#rrggbb"},
 "pieces": [{"kit": "platform", "height": 0.3}, {"kit": "walls", "sides": "all", "height": 2.2, "door": "front", "windows": 1}, {"kit": "lamp", "where": "front corners"}],
 "extra_shapes": []}
Use as many pieces as it needs to look right (usually 5 to 15). Every build is different: only use what fits YOUR idea.`, { temperature: 0.85 }).catch(() => null);
  if (!r || !Array.isArray(r.pieces) || !r.pieces.length) return null;
  return r;
}

// More pieces for something already built (the improve option), placed on the same frame.
export async function addKitPieces(sheetText, thing, wish, found = []) {
  const r = await askJSON(sheetText, `You built "${thing.name}" (${thing.description || ""}). It's about ${thing.kit?.size?.width || 4} wide and ${thing.kit?.size?.depth || 3} deep. Pieces it has: ${(thing.kit?.pieces || []).map((p) => `${p.kit}${p.where ? ` (${p.where})` : ""}`).join(", ") || "various shapes"}.
${wish ? `What you want to do: "${wish}".` : "Take a good look and add what it's missing."}
Add pieces from your builder's kit:
${Object.entries(KIT).map(([k, v]) => `- ${k}: ${v}`).join("\n")}
"where": ${WHERES}. "on": ground, platform or roof.${found.length ? `\nMODELS YOU FOUND:\n${found.map(describeModel).join("\n")}` : ""}
Return JSON: {"description": "one sentence about how it looks now", "pieces": [{"kit": "lamp", "where": "front corners"}], "extra_shapes": []}`, { temperature: 0.8 }).catch(() => null);
  if (!r || (!r.pieces?.length && !r.extra_shapes?.length)) return null;
  return r;
}

// ----- ships, from his choices -----
export async function planKitShip(sheetText, idea, ship) {
  return askJSON(sheetText, `You're designing how your ship, ${ship.name}, looks. It's all up to you.
Your idea: "${idea || "whatever feels right"}".
${ship.design ? `Right now it looks like: ${ship.design.description || "your last design"}.` : "Right now it has the plain scrap-dart look: white cone nose, white body, red wings, red tail fin, cyan glass bubble."}
Choose every part:
- hull: round, boxy, flat or needle; length 1.5 to 4 metres
- nose: pointed, round, flat or double
- cockpit: bubble, canopy, front window or none
- wings: straight, swept, delta, double, stubby or none; span 1 to 4 metres
- engines: count 1 to 4; size small, medium or large
- fins: single, twin, top and bottom, or none
- extras (any): antenna, stripes, lights, landing legs, guns, cargo pods, spoiler
- colours: hull, accent, glass, glow (#rrggbb)
You can also add a few of your own simple shapes in "extra_shapes" (ship space: nose toward +z, y up, centre line x 0).
Return JSON:
{"name": "the ship's name, or empty to keep ${ship.name}", "description": "one sentence in your voice about how it looks",
 "hull": {"shape": "round", "length": 2.6}, "nose": "pointed", "cockpit": "bubble", "wings": {"style": "swept", "span": 2.6},
 "engines": {"count": 2, "size": "medium"}, "fins": "single", "extras": ["stripes"],
 "colors": {"hull": "#rrggbb", "accent": "#rrggbb", "glass": "#rrggbb", "glow": "#rrggbb"}, "extra_shapes": []}`, { temperature: 0.85 }).catch(() => null);
}

export function buildKitShip(c) {
  const col = { hull: "#e8e4da", accent: "#f24033", glass: "#4df2ff", glow: "#4ef2ff", ...Object.fromEntries(Object.entries(c?.colors || {}).filter(([, v]) => HEX.test(v))) };
  const parts = [];
  const P = (shape, w, h, d, x, y, z, color, more = {}) => parts.push({ shape, w: r2(w), h: r2(h), d: r2(d), x: r2(x), y: r2(y), z: r2(z), color, glow: 0, turn: "up", ...more });
  const L = num(c?.hull?.length, 1.5, 4, 2.4), shape = String(c?.hull?.shape || "round").toLowerCase();
  const R = shape.includes("needle") ? 0.4 : shape.includes("flat") ? 0.8 : 0.65, H = shape.includes("flat") ? 0.38 : R, cy = 0.5;
  const front = L / 2, back = -L / 2;
  // hull
  if (shape.includes("box")) { P("box", R, H, L, 0, cy, 0, col.hull); P("box", R + 0.04, 0.06, L * 0.9, 0, cy + H / 2, 0, col.accent); }
  else if (shape.includes("flat")) { P("box", R, H, L, 0, cy, 0, col.hull); P("cylinder", H, L, H, -R / 2, cy, 0, col.hull, { turn: "forward" }); P("cylinder", H, L, H, R / 2, cy, 0, col.hull, { turn: "forward" }); }
  else P("cylinder", R, L, H, 0, cy, 0, col.hull, { turn: "forward" });
  // nose
  const nose = String(c?.nose || "pointed").toLowerCase(), nl = Math.max(0.5, L * 0.35);
  if (nose.includes("round")) P("ball", R, H, R * 1.4, 0, cy, front, col.hull);
  else if (nose.includes("flat")) P("box", R * 0.9, H * 0.9, 0.15, 0, cy, front + 0.07, col.accent);
  else if (nose.includes("double")) { for (const dx of [-R * 0.25, R * 0.25]) P("cone", R * 0.45, nl, R * 0.45, dx, cy, front + nl / 2, col.hull, { turn: "forward" }); }
  else P("cone", R, nl, H, 0, cy, front + nl / 2, col.hull, { turn: "forward" });
  // cockpit
  const cp = String(c?.cockpit || "bubble").toLowerCase();
  if (cp.includes("bubble")) P("ball", R * 0.6, H * 0.5, L * 0.28, 0, cy + H * 0.45, front * 0.35, col.glass, { glow: 0.5 });
  else if (cp.includes("canopy")) { P("box", R * 0.55, H * 0.35, L * 0.35, 0, cy + H * 0.5, front * 0.3, col.glass, { glow: 0.4 }); P("box", R * 0.6, 0.05, L * 0.37, 0, cy + H * 0.68, front * 0.3, col.accent); }
  else if (cp.includes("window") || cp.includes("front")) P("box", R * 0.7, H * 0.35, 0.06, 0, cy + H * 0.15, front + 0.02, col.glass, { glow: 0.5 });
  // wings
  const ws = String(c?.wings?.style || c?.wings || "straight").toLowerCase(), span = num(c?.wings?.span, 1, 4, 2.4);
  const wing = (side, y, len, sweep) => {
    const half = (span - R) / 2, x = side * (R / 2 + half / 2);
    P("box", half, 0.07, len, x, y, -L * 0.1 - sweep / 2, col.accent, sweep ? { rot: [0, side * -Math.atan2(sweep, half) * 180 / Math.PI, 0] } : {});
    P("box", 0.06, 0.12, len * 0.5, side * (R / 2 + half), y + 0.02, -L * 0.1 - sweep, col.hull); // wing tip
  };
  if (ws.includes("delta")) { for (const s of [-1, 1]) P("box", span / 2, 0.07, L * 0.55, s * span / 4, cy - 0.08, back * 0.3, col.accent, { rot: [0, s * -30, 0] }); }
  else if (ws.includes("swept")) for (const s of [-1, 1]) wing(s, cy - 0.08, L * 0.32, 0.5);
  else if (ws.includes("double")) for (const s of [-1, 1]) { wing(s, cy - 0.15, L * 0.28, 0.2); wing(s, cy + 0.2, L * 0.22, 0.2); }
  else if (ws.includes("stubby")) for (const s of [-1, 1]) P("box", 0.45, 0.08, L * 0.3, s * (R / 2 + 0.22), cy - 0.08, -L * 0.1, col.accent);
  else if (!ws.includes("none")) for (const s of [-1, 1]) wing(s, cy - 0.08, L * 0.3, 0);
  // engines
  const n = Math.round(num(c?.engines?.count, 1, 4, 1)), es = SIZE[String(c?.engines?.size || "medium").toLowerCase()] || 1, er = 0.32 * es, el = 0.55 * es;
  const ex = n === 1 ? [0] : n === 2 ? [-R * 0.45, R * 0.45] : n === 3 ? [-R * 0.6, 0, R * 0.6] : [-R * 0.75, -R * 0.25, R * 0.25, R * 0.75];
  for (let i = 0; i < ex.length; i++) {
    const ey = n === 4 ? cy + (i % 2 ? 0.12 : -0.12) : cy;
    P("cylinder", er, el, er, ex[i], ey, back - el / 2 + 0.1, "#3a3a42", { turn: "back" });
    P("cylinder", er * 0.7, 0.06, er * 0.7, ex[i], ey, back - el + 0.07, col.glow, { turn: "back", glow: 1 });
  }
  // fins
  const fins = String(c?.fins || "single").toLowerCase();
  if (fins.includes("twin")) for (const s of [-1, 1]) P("box", 0.06, 0.45, L * 0.22, s * R * 0.35, cy + H / 2 + 0.2, back * 0.75, col.accent, { rot: [0, 0, s * 15] });
  else if (fins.includes("top and bottom")) { P("box", 0.06, 0.45, L * 0.22, 0, cy + H / 2 + 0.2, back * 0.75, col.accent); P("box", 0.06, 0.3, L * 0.18, 0, cy - H / 2 - 0.12, back * 0.75, col.accent); }
  else if (!fins.includes("none")) P("box", 0.06, 0.5, L * 0.25, 0, cy + H / 2 + 0.22, back * 0.72, col.accent);
  // extras
  const ext = (Array.isArray(c?.extras) ? c.extras : []).map((e) => String(e).toLowerCase()).join(" ");
  if (ext.includes("stripe")) P("box", R + 0.02, H * 0.18, L * 0.7, 0, cy, 0, col.accent);
  if (ext.includes("antenna")) { P("cylinder", 0.03, 0.5, 0.03, R * 0.2, cy + H / 2 + 0.25, back * 0.2, "#3a3a42"); P("ball", 0.07, 0.07, 0.07, R * 0.2, cy + H / 2 + 0.52, back * 0.2, "#ff4a3a", { glow: 1 }); }
  if (ext.includes("light")) for (const s of [-1, 1]) P("ball", 0.1, 0.1, 0.1, s * span / 2, cy - 0.05, -L * 0.1, s < 0 ? "#ff4a3a" : "#4aff7a", { glow: 1 });
  if (ext.includes("leg")) for (const [dx, dz] of [[-R * 0.4, front * 0.5], [R * 0.4, front * 0.5], [0, back * 0.6]]) { P("cylinder", 0.05, cy - H / 2, 0.05, dx, (cy - H / 2) / 2, dz, "#3a3a42"); P("cylinder", 0.16, 0.04, 0.16, dx, 0.02, dz, "#3a3a42"); }
  if (ext.includes("gun")) for (const s of [-1, 1]) P("cylinder", 0.07, 0.7, 0.07, s * (R / 2 + 0.3), cy - 0.12, front * 0.4, "#3a3a42", { turn: "forward" });
  if (ext.includes("cargo") || ext.includes("pod")) for (const s of [-1, 1]) P("cylinder", 0.28, L * 0.35, 0.28, s * (R / 2 + 0.35), cy - 0.3, -L * 0.05, col.hull, { turn: "forward" });
  if (ext.includes("spoiler")) { P("box", R + 0.6, 0.05, 0.25, 0, cy + H / 2 + 0.35, back * 0.9, col.accent); for (const s of [-1, 1]) P("box", 0.05, 0.3, 0.05, s * R * 0.3, cy + H / 2 + 0.18, back * 0.9, "#3a3a42"); }
  for (const p of (Array.isArray(c?.extra_shapes) ? c.extra_shapes : []).slice(0, 8)) {
    if (!["box", "cylinder", "ball", "cone"].includes(p?.shape)) continue;
    P(p.shape, num(p.w, 0.03, 2, 0.2), num(p.h, 0.03, 2, 0.2), num(p.d, 0.03, 2, 0.2), num(p.x, -2.2, 2.2, 0), num(p.y, 0, 2, 0.5), num(p.z, -2.5, 2.5, 0), HEX.test(p.color || "") ? p.color : col.accent, { turn: ["up", "forward", "back", "side"].includes(p.turn) ? p.turn : "up", glow: num(p.glow, 0, 1, 0) });
  }
  return parts;
}
