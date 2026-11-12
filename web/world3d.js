// Rustwell Outpost in 3D. Zeeb's body runs here in your browser every frame;
// his decisions arrive from the brain every few minutes.
import { Geo, M4, Node, Renderer } from "./engine.js";

export const PLACES = {
  hangar: { name: "Hangar Bay 3", x: 0, z: 0 },
  cantina: { name: "Dented Moon Cantina", x: 15, z: -7 },
  market: { name: "Junk Market", x: -13, z: -8 },
  tower: { name: "Comms Tower", x: 9, z: 15 },
  depot: { name: "Fuel Depot", x: -11, z: 11 },
  ridge: { name: "Dune Ridge", x: 0, z: -26 },
};

// Where exactly he stands for each action, relative to the place.
const SPOTS = {
  nap_dock: [-2.2, 0, -1.5], sleep: [-2.2, 0, -1.5], work_dart: [1.6, 0, 0.2], compose_tune: [-1.5, 0, 1.2],
  drink_oil: [2.2, 0, 2], fix_job: [2, 0, 3], scavenge: [-2, 0, 3.2], cantina_band: [0, 0, 4], chat_patrons: [2.5, 0, 3.6],
  browse_wire: [0, 0, -2.6], read_news: [0, 0, -2.6], send_signal: [1.8, 0, -1.8], reply_notes: [-1.8, 0, -2.4],
  watch_suns: [0, 0, 0], wander: [0, 0, 4],
};

const C = {
  sand: [0.86, 0.68, 0.46], sandDark: [0.74, 0.55, 0.36], rust: [0.82, 0.38, 0.18], brass: [0.86, 0.66, 0.3],
  metal: [0.55, 0.56, 0.6], dark: [0.2, 0.2, 0.24], cyan: [0.3, 0.95, 1.0], warm: [1.0, 0.72, 0.35],
  white: [0.92, 0.9, 0.86], red: [0.95, 0.25, 0.2], teal: [0.25, 0.6, 0.6], purple: [0.55, 0.35, 0.65],
};

export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const dunes = 1.3 * Math.sin(x * 0.07 + 1.3) * Math.cos(z * 0.06) + 0.7 * Math.sin(x * 0.13 + z * 0.05) + 0.4 * Math.cos(z * 0.17 - x * 0.04);
  const out = smooth(22, 48, r);
  const ridge = 5.5 * Math.exp(-((z + 30) ** 2) / 50 - (x * x) / 260);
  return 0.15 * Math.sin(x * 0.4) * Math.cos(z * 0.35) + dunes * (0.15 + 0.85 * out) + out * 2.5 + ridge;
}
function smooth(a, b, v) { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); }
const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };

export class World {
  constructor(canvas, labelLayer) {
    this.r = new Renderer(canvas);
    this.canvas = canvas;
    this.labels = labelLayer;
    this.root = new Node();
    this.meshes = {};
    this.lights = [];
    this.t = 0;
    this.state = null;
    this.whistleT = -10;
    this.cam = { fov: 0.9, eye: [12, 8, 16], target: [0, 1, 0] };
    this.mode = "follow"; // or "walk"
    this.orbit = { yaw: 0.6, pitch: 0.38, dist: 11 };
    this.walker = { x: 6, z: 18, yaw: Math.PI, pitch: -0.05 };
    this.keys = new Set();
    this.build();
    this.controls();
  }

  m(name, geo) { return (this.meshes[name] ||= this.r.mesh(geo)); }
  put(parent, mesh, opts) { const n = new Node(mesh, opts); parent.add(n); return n; }
  at(x, z, dy = 0) { return [x, groundHeight(x, z) + dy, z]; }

  build() {
    const R = this.root, m = (n, g) => this.m(n, g);
    const box = m("box", Geo.box()), cyl = m("cyl", Geo.cyl(0.5, 0.5, 1, 14)), cone = m("cone", Geo.cyl(0, 0.5, 1, 12));
    const ball = m("ball", Geo.sphere(0.5, 14, 9)), rough = m("rough", Geo.sphere(0.5, 7, 5));
    this.put(R, m("ground", Geo.ground(220, 110, groundHeight)), { color: C.sand });

    // Rocks scattered in the dunes
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, d = 20 + rnd() * 70, x = Math.cos(a) * d, z = Math.sin(a) * d, s = 0.6 + rnd() * 2.4;
      this.put(R, rough, { pos: this.at(x, z, s * 0.15), scale: [s, s * 0.6, s * (0.7 + rnd() * 0.6)], rot: [0, rnd() * 6, 0], color: mix3(C.sandDark, [0.55, 0.42, 0.33], rnd()) });
    }

    // Hangar Bay 3: a big half-pipe with an open front
    const H = PLACES.hangar, hy = groundHeight(H.x, H.z);
    const hangar = this.put(R, null, { pos: [H.x, hy, H.z] });
    // salvaged hangar: a skeleton of arched ribs with a solid roof only over the back, so you can see inside
    const rib = m("hangarRib", Geo.cyl(4.2, 4.2, 0.3, 18, Math.PI, false));
    for (let zz = 2.8; zz > -5; zz -= 1.9) this.put(hangar, rib, { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, zz], color: C.rust });
    this.put(hangar, m("hangarRoof", Geo.cyl(4.15, 4.15, 2.2, 18, Math.PI, false)), { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, -4.9], color: [0.62, 0.58, 0.55] });
    for (const sx of [-1, 1]) this.put(hangar, box, { pos: [sx * 2.9, 2.95, -1.5], scale: [0.12, 0.12, 9], rot: [0, 0, sx * -0.8], color: C.metal });
    this.put(hangar, box, { pos: [0, 0.05, -1.5], scale: [8.6, 0.1, 9.2], color: [0.45, 0.43, 0.42] });
    this.put(hangar, m("halfDisc", Geo.cyl(4.2, 4.2, 0.2, 18, Math.PI, true)), { rot: [-Math.PI / 2, 0, 0], pos: [0, 0, -6], color: [0.52, 0.48, 0.46] });
    for (const sx of [-1, 1]) this.put(hangar, box, { pos: [sx * 4.1, 1.2, 3], scale: [0.35, 2.4, 0.35], color: C.rust });
    this.put(hangar, box, { pos: [1.6, 0.5, -1.4], scale: [2.6, 1, 1.2], color: [0.5, 0.36, 0.25] }); // workbench
    this.dock = this.put(hangar, box, { pos: [-2.2, 0.35, -2.6], scale: [1.4, 0.7, 1.4], color: C.dark });
    this.dockLight = this.put(hangar, box, { pos: [-2.2, 0.75, -2.6], scale: [0.9, 0.06, 0.9], color: C.cyan, emissive: 1 });
    this.hangarLamp = this.put(hangar, ball, { pos: [0, 3.9, -1.5], scale: [0.4, 0.4, 0.4], color: C.warm, emissive: 1 });
    this.lights.push(this.hangarLamp);
    // The Little Dart, built up piece by piece as progress grows
    this.dart = this.put(hangar, null, { pos: [1.4, 0.6, 1.6], rot: [0, -0.5, 0] });
    this.dartParts = [
      this.put(this.dart, cone, { pos: [0, 0.3, 0.9], rot: [Math.PI / 2, 0, 0], scale: [0.7, 1.1, 0.7], color: C.white }),
      this.put(this.dart, cyl, { pos: [0, 0.3, 0], rot: [Math.PI / 2, 0, 0], scale: [0.7, 1.0, 0.7], color: C.white }),
      this.put(this.dart, box, { pos: [0, 0.25, -0.1], scale: [2.6, 0.08, 0.7], color: C.red }),
      this.put(this.dart, cyl, { pos: [0, 0.3, -0.65], rot: [Math.PI / 2, 0, 0], scale: [0.45, 0.4, 0.45], color: C.dark }),
      this.put(this.dart, box, { pos: [0, 0.6, -0.4], scale: [0.08, 0.5, 0.5], color: C.red }),
      this.put(this.dart, ball, { pos: [0, 0.55, 0.35], scale: [0.4, 0.25, 0.5], color: C.cyan, emissive: 0.5 }),
    ];

    // Dented Moon cantina: a squat dome with a glowing sign
    const Ca = PLACES.cantina;
    const cantina = this.put(R, null, { pos: this.at(Ca.x, Ca.z) });
    this.put(cantina, ball, { pos: [0, 0, 0], scale: [8, 6, 8], color: [0.82, 0.7, 0.55] });
    this.put(cantina, cyl, { pos: [0, 0.2, 3.7], scale: [2.4, 0.4, 1.4], color: [0.7, 0.58, 0.45] });
    this.put(cantina, box, { pos: [0, 1.1, 3.95], scale: [1.4, 2.0, 0.3], color: C.dark });
    this.cantinaSign = this.put(cantina, box, { pos: [0, 2.6, 3.7], scale: [2.6, 0.5, 0.2], color: C.purple, emissive: 1, rot: [-0.25, 0, 0] });
    this.put(cantina, ball, { pos: [0, 3.1, 0], scale: [1.2, 0.8, 1.2], color: C.metal });
    this.lights.push(this.cantinaSign);

    // Junk market: stalls with awnings and junk piles
    const Ma = PLACES.market;
    const market = this.put(R, null, { pos: this.at(Ma.x, Ma.z) });
    [[-2.5, 0, C.teal], [2.5, 0.2, C.red], [0, -3, C.brass]].forEach(([x, z, col], i) => {
      for (const [px, pz] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) this.put(market, box, { pos: [x + px, 1, z + pz], scale: [0.12, 2, 0.12], color: C.metal });
      this.put(market, box, { pos: [x, 2.05, z], scale: [2.5, 0.12, 2.0], rot: [0, 0, i % 2 ? 0.08 : -0.08], color: col });
      this.put(market, box, { pos: [x, 0.45, z], scale: [2, 0.9, 1.2], color: [0.45, 0.33, 0.24] });
    });
    for (let i = 0; i < 9; i++) this.put(market, rough, { pos: [-4 + rnd() * 8, 0.3, 2.5 + rnd() * 2.5], scale: [1 + rnd() * 1.4, 0.7 + rnd(), 1 + rnd()], rot: [rnd(), rnd() * 6, rnd()], color: mix3(C.metal, C.rust, rnd()) });

    // Comms tower: lattice mast, big dish, blinking light
    const T = PLACES.tower;
    const tower = this.put(R, null, { pos: this.at(T.x, T.z) });
    this.put(tower, box, { pos: [0, 0.9, 0], scale: [3.6, 1.8, 3.2], color: [0.6, 0.6, 0.62] });
    this.put(tower, box, { pos: [0, 0.9, 1.62], scale: [1.0, 1.4, 0.1], color: C.dark });
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) this.put(tower, box, { pos: [x * 0.6, 6, z * 0.6], scale: [0.14, 9, 0.14], rot: [z * 0.05, 0, -x * 0.05], color: C.metal });
    for (let y = 3; y < 10; y += 1.6) this.put(tower, box, { pos: [0, y, 0], scale: [0.95, 0.1, 0.95], color: C.metal });
    this.towerDish = this.put(tower, null, { pos: [0, 10.2, 0] });
    this.put(this.towerDish, m("dish", Geo.cyl(1.6, 0.25, 0.7, 16)), { rot: [-0.7, 0, 0], color: C.white });
    this.towerLight = this.put(tower, ball, { pos: [0, 11, 0], scale: [0.35, 0.35, 0.35], color: C.red, emissive: 1 });

    // Fuel depot: tanks and a hose
    const D = PLACES.depot;
    const depot = this.put(R, null, { pos: this.at(D.x, D.z) });
    [[-1.8, 0, 1.6], [1.6, -0.5, 1.3], [0, 2.2, 1.0]].forEach(([x, z, s]) => {
      this.put(depot, cyl, { pos: [x, 1.4 * s, z], scale: [2.2 * s, 2.8 * s, 2.2 * s], color: [0.78, 0.76, 0.7] });
      this.put(depot, ball, { pos: [x, 2.8 * s, z], scale: [2.2 * s, 1 * s, 2.2 * s], color: [0.78, 0.76, 0.7] });
      this.put(depot, cyl, { pos: [x, 1.4 * s, z], scale: [2.25 * s, 0.25, 2.25 * s], color: C.red });
    });
    this.put(depot, box, { pos: [2.6, 0.7, 2.4], scale: [0.7, 1.4, 0.5], color: C.brass });
    // a cargo hauler bot (Zeeb's "rival"), just standing there being shiny
    this.hauler = this.put(depot, null, { pos: [-3.4, 0, 3] });
    this.put(this.hauler, box, { pos: [0, 1.1, 0], scale: [1.4, 1.6, 1.0], color: [0.3, 0.5, 0.75] });
    this.put(this.hauler, box, { pos: [0, 2.1, 0.1], scale: [0.8, 0.5, 0.7], color: [0.3, 0.5, 0.75] });
    this.put(this.hauler, box, { pos: [0, 2.15, 0.46], scale: [0.5, 0.12, 0.05], color: C.warm, emissive: 1 });
    for (const sx of [-0.45, 0.45]) this.put(this.hauler, box, { pos: [sx, 0.2, 0], scale: [0.35, 0.4, 1.1], color: C.dark });

    // A parked freighter just past the hangar, for atmosphere
    const fr = this.put(R, null, { pos: this.at(-22, -18, 1.8), rot: [0, 0.7, 0.05] });
    this.put(fr, ball, { scale: [6, 2.2, 11], color: [0.66, 0.66, 0.68] });
    this.put(fr, box, { pos: [0, 0.6, -3], scale: [10, 0.4, 3], color: [0.55, 0.55, 0.58] });
    this.put(fr, ball, { pos: [0, 0.9, 4], scale: [1.8, 1, 2], color: C.cyan, emissive: 0.4 });
    for (const sx of [-2, 2]) this.put(fr, cyl, { pos: [sx, -1.4, 0], scale: [0.3, 1.4, 0.3], color: C.dark });

    // Lamp posts along the paths
    for (const [x, z] of [[5, 6], [-5, 5], [8, -4], [-7, -3], [4, 12], [-6, 9], [0, -12], [0, -18]]) {
      this.put(R, cyl, { pos: this.at(x, z, 1.3), scale: [0.12, 2.6, 0.12], color: C.dark });
      const l = this.put(R, ball, { pos: this.at(x, z, 2.7), scale: [0.35, 0.35, 0.35], color: C.warm, emissive: 1 });
      this.lights.push(l);
    }

    // Zeeb: a squat rust-orange bot, cyan visor, brass listening dish, hovering on a little thruster
    this.zeeb = this.put(R, null, { pos: this.at(2, 4, 0.9) });
    const z = this.zeeb;
    this.zBody = this.put(z, null);
    this.put(this.zBody, ball, { scale: [1.15, 0.95, 1.05], color: C.rust });
    this.put(this.zBody, cyl, { pos: [0, -0.12, 0], scale: [1.18, 0.16, 1.08], color: C.dark });
    this.visor = this.put(this.zBody, box, { pos: [0, 0.14, 0.47], scale: [0.66, 0.13, 0.12], rot: [-0.15, 0, 0], color: C.cyan, emissive: 1 });
    this.put(this.zBody, box, { pos: [0, 0.14, 0.42], scale: [0.78, 0.24, 0.1], rot: [-0.15, 0, 0], color: C.dark });
    this.put(this.zBody, cyl, { pos: [0, 0.6, 0], scale: [0.07, 0.35, 0.07], color: C.metal });
    this.zDish = this.put(this.zBody, null, { pos: [0, 0.8, 0] });
    this.put(this.zDish, m("zdish", Geo.cyl(0.42, 0.08, 0.16, 14)), { color: C.brass });
    this.put(this.zDish, ball, { pos: [0, 0.12, 0], scale: [0.09, 0.09, 0.09], color: C.red, emissive: 1 });
    this.arms = [-1, 1].map((sx) => {
      const pivot = this.put(this.zBody, null, { pos: [sx * 0.58, 0, 0.05] });
      this.put(pivot, box, { pos: [sx * 0.12, -0.12, 0.12], scale: [0.12, 0.12, 0.42], color: C.metal });
      this.put(pivot, box, { pos: [sx * 0.12, -0.12, 0.36], scale: [0.18, 0.08, 0.1], color: C.brass });
      return pivot;
    });
    this.put(this.zBody, cyl, { pos: [0, -0.5, 0], scale: [0.36, 0.2, 0.36], color: C.metal });
    this.flame = this.put(this.zBody, cone, { pos: [0, -0.75, 0], rot: [Math.PI, 0, 0], scale: [0.3, 0.35, 0.3], color: C.cyan, emissive: 1 });
    this.shadow = this.put(R, m("disc", Geo.cyl(0.5, 0.5, 0.02, 16)), { color: [0.55, 0.42, 0.3], scale: [1.1, 1, 1.1] });

    // His friend (only exists if Zeeb decides to build one): a frame on the hangar floor while building, then a bot of their own.
    this.friendFrame = this.put(hangar, null, { pos: [-2.4, 0, 1.8], visible: false });
    this.frameParts = [
      this.put(this.friendFrame, cyl, { pos: [0, 0.15, 0], scale: [0.7, 0.3, 0.7], color: C.dark }),
      this.put(this.friendFrame, cyl, { pos: [0, 0.75, 0], scale: [0.55, 0.9, 0.55], color: C.metal }),
      this.put(this.friendFrame, ball, { pos: [0, 1.45, 0], scale: [0.6, 0.55, 0.6], color: C.metal }),
      this.put(this.friendFrame, ball, { pos: [0, 1.48, 0.27], scale: [0.2, 0.2, 0.1], color: [0.3, 0.3, 0.3] }),
    ];
    this.buddy = this.put(R, null, { pos: this.at(-2, 4, 0.9), visible: false, scale: [0.85, 0.85, 0.85] });
    this.bBody = this.put(this.buddy, null);
    this.bShell = this.put(this.bBody, cyl, { pos: [0, 0.1, 0], scale: [0.7, 1.0, 0.7], color: [0.4, 0.7, 0.65] });
    this.put(this.bBody, cyl, { pos: [0, -0.35, 0], scale: [0.76, 0.12, 0.76], color: C.dark });
    this.bHead = this.put(this.bBody, ball, { pos: [0, 0.85, 0], scale: [0.75, 0.68, 0.75], color: [0.4, 0.7, 0.65] });
    this.bEye = this.put(this.bBody, ball, { pos: [0, 0.88, 0.31], scale: [0.3, 0.3, 0.14], color: [1, 0.8, 0.4], emissive: 1 });
    this.put(this.bBody, cyl, { pos: [0, 1.32, 0], scale: [0.05, 0.3, 0.05], color: C.metal });
    this.bTip = this.put(this.bBody, ball, { pos: [0, 1.5, 0], scale: [0.12, 0.12, 0.12], color: [1, 0.8, 0.4], emissive: 1 });
    this.bFlame = this.put(this.bBody, cone, { pos: [0, -0.6, 0], rot: [Math.PI, 0, 0], scale: [0.25, 0.3, 0.25], color: [1, 0.8, 0.4], emissive: 1 });
    this.bShadow = this.put(R, this.meshes.disc, { color: [0.55, 0.42, 0.3], visible: false });
    this.buddyPos = { x: -2, z: 4, yaw: 0 };
    this.buddyTarget = { x: -2, z: 4 };
    this.buddyBubble = document.createElement("div");
    this.buddyBubble.className = "bubble";
    this.labels.appendChild(this.buddyBubble);
    z.scale = [0.85, 0.85, 0.85];

    this.zeebPos = { x: 2, z: 4, yaw: 0 };
    this.target = { x: 2, z: 4 };
    this.wanderT = 0;

    // Labels above each place
    this.placeLabels = Object.entries(PLACES).map(([k, p]) => {
      const el = document.createElement("div");
      el.className = "place-label";
      el.textContent = p.name;
      this.labels.appendChild(el);
      const h = { hangar: 5.6, cantina: 5.4, market: 3.4, tower: 12, depot: 4.2, ridge: 2.2 }[k];
      return { el, pos: this.at(p.x, p.z, h) };
    });
    this.bubble = document.createElement("div");
    this.bubble.className = "bubble";
    this.labels.appendChild(this.bubble);
  }

  controls() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
    c.addEventListener("pointerup", () => (drag = null));
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) * 0.005, dy = (e.clientY - drag.y) * 0.005;
      drag = { x: e.clientX, y: e.clientY };
      if (this.mode === "follow") {
        this.orbit.yaw -= dx;
        this.orbit.pitch = Math.min(1.3, Math.max(0.05, this.orbit.pitch + dy));
      } else {
        this.walker.yaw -= dx;
        this.walker.pitch = Math.min(0.9, Math.max(-0.9, this.walker.pitch - dy));
      }
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.orbit.dist = Math.min(40, Math.max(4, this.orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)));
    }, { passive: false });
    window.addEventListener("keydown", (e) => {
      if (e.target.closest?.("input, textarea")) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(k)) {
        if (this.mode !== "walk") this.setMode("walk");
        this.keys.add(k);
      }
      if (k === "e") this.whistle();
      if (k === "f") this.setMode("follow");
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
  }

  setMode(mode) {
    if (mode === "walk" && this.mode !== "walk") {
      // start walking from where the camera is
      this.walker.x = this.cam.eye[0]; this.walker.z = this.cam.eye[2];
      this.walker.yaw = Math.atan2(this.cam.target[0] - this.cam.eye[0], this.cam.target[2] - this.cam.eye[2]);
      this.walker.pitch = -0.1;
    }
    this.mode = mode;
    this.onMode?.(mode);
  }

  whistle() {
    this.whistleT = this.t;
    const ctx = (this.audio ||= new (window.AudioContext || window.webkitAudioContext)());
    const tone = (f, t0, d, type = "sine") => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + t0;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.start(t); o.stop(t + d + 0.05);
    };
    tone(880, 0, 0.25); tone(1320, 0.18, 0.35);
    // Zeeb answers with his three-note tune
    tone(660, 0.8, 0.12, "square"); tone(990, 0.95, 0.12, "square"); tone(1320, 1.1, 0.22, "square");
  }

  setFriend(f) {
    this.friend = f;
    const stage = f?.stage || "none";
    this.friendFrame.visible = stage === "building";
    if (stage === "building") {
      const n = Math.max(1, Math.ceil(((f.project?.progress || 0) / 100) * this.frameParts.length));
      this.frameParts.forEach((p, i) => (p.visible = i < n));
    }
    const alive = stage === "alive" && f.state;
    this.buddy.visible = Boolean(alive);
    this.bShadow.visible = Boolean(alive);
    if (!alive) return;
    const hex = (h, d) => (/^#[0-9a-f]{6}$/i.test(h || "") ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) : d);
    const body = hex(f.sheet?.colors?.body, [0.4, 0.7, 0.65]), eye = hex(f.sheet?.colors?.eye, [1, 0.8, 0.4]);
    this.bShell.color = body; this.bHead.color = body; this.bEye.color = eye; this.bTip.color = eye; this.bFlame.color = eye;
    const st = f.state, place = PLACES[st.place] || PLACES.hangar;
    const action = st.asleep ? "sleep" : st.action;
    const off = SPOTS[action] || [0, 0, 4];
    // stand beside Zeeb when hanging out, otherwise a step to the side of the usual spot
    this.buddyTarget = action === "hang_out" && this.state ? { x: this.target.x + 1.6, z: this.target.z + 0.4 } : { x: place.x + off[0] + 1.4, z: place.z + off[2] + 0.8 };
    if (!this.buddyPlaced) { this.buddyPos.x = this.buddyTarget.x; this.buddyPos.z = this.buddyTarget.z; this.buddyPlaced = true; }
  }

  setState(s) {
    const first = !this.state;
    this.state = s;
    const action = s.asleep ? "sleep" : s.action;
    const place = PLACES[s.place] || PLACES.hangar;
    const off = SPOTS[action] || [0, 0, 4];
    this.target = { x: place.x + off[0], z: place.z + off[2] };
    if (first) { this.zeebPos.x = this.target.x; this.zeebPos.z = this.target.z + 1; }
    const p = s.works?.dart?.progress ?? 0;
    const built = Math.ceil((p / 100) * this.dartParts.length);
    this.dartParts.forEach((n, i) => (n.visible = i < Math.max(1, built)));
  }

  env() {
    const s = this.state;
    // Town time runs continuously in your browser between brain ticks.
    let hour = 12;
    if (s?.epoch) {
      const dayMs = (s.townDayMinutes || 180) * 60000;
      hour = (((Date.now() - s.epoch) % dayMs) / dayMs) * 24;
    }
    this.hour = hour;
    const sunAng = ((hour - 5) / 15) * Math.PI; // sunrise 5:00, sunset 20:00: long days, short nights
    const sunA = norm([-Math.cos(sunAng) * 0.9, Math.sin(sunAng), -0.35]);
    const sunB = norm([-Math.cos(sunAng - 0.32) * 0.9, Math.sin(sunAng - 0.32) * 0.85, -0.5]);
    const elev = Math.max(sunA[1], sunB[1]);
    const day = smooth(-0.12, 0.25, elev);
    const golden = Math.max(0, 1 - Math.abs(elev - 0.08) * 6) * (elev > -0.15 ? 1 : 0);
    const nightTop = [0.03, 0.04, 0.12], dayTop = [0.38, 0.6, 0.85];
    const nightHor = [0.1, 0.08, 0.2], dayHor = [0.93, 0.83, 0.68], goldHor = [1.0, 0.52, 0.28];
    let skyTop = mix3(nightTop, dayTop, day), skyHorizon = mix3(mix3(nightHor, dayHor, day), goldHor, golden * 0.85);
    let fog = mix3(skyHorizon, C.sand, 0.25 * day), fogDensity = 0.006, haze = 0.35;
    const weather = s?.weather?.kind;
    if (weather === "sandstorm") { fog = mix3([0.72, 0.52, 0.32], fog, 0.3); fogDensity = 0.075; haze = 0.95; skyTop = mix3(skyTop, fog, 0.7); }
    else if (weather === "windy" || weather === "hazy") { fogDensity = 0.016; haze = 0.6; }
    else if (weather === "rare rain") { fog = mix3(fog, [0.5, 0.55, 0.62], 0.6); skyTop = mix3(skyTop, [0.45, 0.5, 0.58], 0.6); fogDensity = 0.02; }
    const lightDir = sunA[1] > -0.05 ? sunA : norm([0.3, 0.8, 0.2]);
    const lightColor = mix3([0.12, 0.14, 0.28], mix3([0.95, 0.84, 0.7], [1.15, 0.6, 0.38], golden), day);
    const ambient = mix3([0.12, 0.12, 0.22], [0.22, 0.2, 0.2], day);
    this.night = 1 - day;
    return { skyTop, skyHorizon, sunA, sunB, sunSky: mix3([0.3, 0.2, 0.2], [1.0, 0.9, 0.7], day), fog, fogDensity, haze, stars: (1 - day) * (weather === "sandstorm" ? 0.1 : 1), light: lightDir, lightColor, ambient, groundBounce: mix3([0.05, 0.04, 0.06], [0.45, 0.33, 0.22], day) };
  }

  animate(dt) {
    this.t += dt;
    const t = this.t, s = this.state || {};
    const action = s.asleep ? "sleep" : s.action;
    const zp = this.zeebPos;

    // Wander a little around his current spot so he never looks frozen
    this.wanderT -= dt;
    let tx = this.target.x, tz = this.target.z;
    const idleWander = ["wander", "chat_patrons", "scavenge", "fix_job"].includes(action);
    if (idleWander) {
      if (this.wanderT <= 0) { this.wanderT = 3 + Math.random() * 4; this.jitter = [(Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3]; }
      tx += this.jitter?.[0] || 0; tz += this.jitter?.[1] || 0;
    }
    const dx = tx - zp.x, dz = tz - zp.z, dist = Math.hypot(dx, dz);
    const moving = dist > 0.15;
    if (moving) {
      const step = Math.min(dist, dt * (dist > 8 ? 4.2 : 2.4));
      zp.x += (dx / dist) * step; zp.z += (dz / dist) * step;
      zp.yaw = turn(zp.yaw, Math.atan2(dx, dz), dt * 5);
    } else {
      let face = zp.yaw;
      if (action === "watch_suns") face = Math.atan2(0.9, -0.35);
      else if (["work_dart"].includes(action)) face = Math.atan2(-0.2, 1.4);
      else if (["browse_wire", "read_news", "reply_notes", "send_signal"].includes(action)) face = 0;
      else if (action === "sleep" || action === "nap_dock") face = Math.PI;
      zp.yaw = turn(zp.yaw, face, dt * 2);
    }
    // whistle: look at the viewer for a few seconds
    const whistled = t - this.whistleT < 3.5;
    if (whistled) zp.yaw = turn(zp.yaw, Math.atan2(this.cam.eye[0] - zp.x, this.cam.eye[2] - zp.z), dt * 6);

    const resting = !moving && (action === "sleep" || action === "nap_dock");
    const hover = resting ? 0.35 : 0.95 + Math.sin(t * 2.2) * 0.08;
    const gy = groundHeight(zp.x, zp.z);
    this.zeeb.pos = [zp.x, lerp(this.zeeb.pos[1] || gy + hover, gy + hover, Math.min(1, dt * 4)), zp.z];
    this.zeeb.rot = [moving ? 0.18 : 0, zp.yaw, Math.sin(t * 1.3) * 0.04];
    this.shadow.pos = [zp.x, gy + 0.03, zp.z];

    // per-activity body language
    const b = this.zBody, [la, ra] = this.arms;
    b.pos = [0, 0, 0]; b.rot = [0, 0, 0]; la.rot = [0, 0, 0]; ra.rot = [0, 0, 0];
    this.zDish.rot = [0, t * 0.4, 0];
    if (!moving) {
      if (action === "work_dart" || action === "fix_job") { la.rot = [Math.sin(t * 9) * 0.5, 0, 0]; ra.rot = [Math.cos(t * 7) * 0.5, 0, 0]; b.rot = [0.15, 0, 0]; }
      else if (action === "compose_tune" || action === "cantina_band") { b.pos = [0, Math.abs(Math.sin(t * 5)) * 0.18, 0]; b.rot = [0, 0, Math.sin(t * 2.5) * 0.15]; }
      else if (["browse_wire", "read_news", "send_signal", "reply_notes"].includes(action)) { this.zDish.rot = [-0.6, t * (action === "send_signal" ? 3 : 1), 0]; }
      else if (action === "watch_suns") { b.rot = [-0.2, 0, 0]; this.zDish.rot = [-0.3, 0, 0]; }
      else if (action === "drink_oil") { b.rot = [0.3 + Math.sin(t * 2) * 0.1, 0, 0]; ra.rot = [-0.9, 0, 0]; }
      else if (action === "scavenge") { b.rot = [0.35 + Math.sin(t * 3) * 0.15, 0, 0]; la.rot = [0.6, 0, 0]; ra.rot = [0.6, 0, 0]; }
      else if (action === "chat_patrons") { b.rot = [0, Math.sin(t * 1.5) * 0.3, 0]; ra.rot = [Math.sin(t * 4) * 0.4 - 0.3, 0, 0]; }
      else if (resting) { b.rot = [0.15, 0, 0]; this.zDish.rot = [0.25, 0, 0]; }
    }
    if (whistled) { b.pos = [0, Math.abs(Math.sin((t - this.whistleT) * 8)) * 0.25 * Math.max(0, 1.5 - (t - this.whistleT)), 0]; this.zDish.rot = [0, t * 4, 0]; }
    const blink = Math.sin(t * 0.7) > 0.985 ? 0.15 : 1;
    this.visor.emissive = resting ? 0.15 : 1;
    this.visor.color = resting ? [0.1, 0.35, 0.4] : whistled ? [0.6, 1, 1] : C.cyan;
    this.visor.scale = [0.66, 0.13 * blink, 0.12];
    this.flame.visible = !resting;
    this.flame.scale = [0.3, 0.3 + Math.sin(t * 30) * 0.06, 0.3];

    // world bits
    this.towerDish.rot = [0, t * 0.15, 0];
    this.towerLight.emissive = Math.sin(t * 3) > 0 ? 1 : 0.1;
    this.dockLight.emissive = 0.5 + 0.5 * Math.sin(t * 2);
    for (const l of this.lights) { l.emissive = 0.15 + 0.85 * (this.night ?? 0); }
    this.cantinaSign.emissive = 0.4 + 0.6 * (this.night ?? 0);

    this.animateBuddy(dt);
    this.updateCamera(dt);
  }

  animateBuddy(dt) {
    if (!this.buddy.visible) return;
    const t = this.t, bp = this.buddyPos, st = this.friend.state;
    const dx = this.buddyTarget.x - bp.x, dz = this.buddyTarget.z - bp.z, dist = Math.hypot(dx, dz);
    const moving = dist > 0.15;
    if (moving) {
      const step = Math.min(dist, dt * (dist > 8 ? 3.8 : 2.2));
      bp.x += (dx / dist) * step; bp.z += (dz / dist) * step;
      bp.yaw = turn(bp.yaw, Math.atan2(dx, dz), dt * 5);
    } else if (st.action === "hang_out") {
      bp.yaw = turn(bp.yaw, Math.atan2(this.zeebPos.x - bp.x, this.zeebPos.z - bp.z), dt * 3);
    }
    const resting = !moving && st.asleep;
    const gy = groundHeight(bp.x, bp.z);
    this.buddy.pos = [bp.x, gy + (resting ? 0.45 : 1.0 + Math.sin(t * 2.6 + 1) * 0.09), bp.z];
    this.buddy.rot = [moving ? 0.15 : 0, bp.yaw, Math.sin(t * 1.1 + 2) * 0.05];
    this.bShadow.pos = [bp.x, gy + 0.03, bp.z];
    this.bShadow.scale = [0.9, 1, 0.9];
    this.bEye.emissive = resting ? 0.1 : 1;
    this.bFlame.visible = !resting;
    this.bBody.pos = [0, !moving && ["cantina_band", "hang_out"].includes(st.action) ? Math.abs(Math.sin(t * 4)) * 0.12 : 0, 0];
  }

  updateCamera(dt) {
    const zp = this.zeebPos, gy = groundHeight(zp.x, zp.z);
    if (this.mode === "fixed") return;
    if (this.mode === "follow") {
      this.orbit.yaw += dt * 0.03; // slow drift
      const o = this.orbit;
      const target = [zp.x, gy + 1.4, zp.z];
      const eye = [zp.x + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, gy + 1.4 + Math.sin(o.pitch) * o.dist, zp.z + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist];
      eye[1] = Math.max(eye[1], groundHeight(eye[0], eye[2]) + 0.8);
      const k = Math.min(1, dt * 3);
      this.cam.eye = this.cam.eye.map((v, i) => lerp(v, eye[i], k));
      this.cam.target = this.cam.target.map((v, i) => lerp(v, target[i], k));
    } else {
      const w = this.walker, sp = 6 * dt;
      if (this.keys.has("a")) w.yaw += dt * 1.8;
      if (this.keys.has("d")) w.yaw -= dt * 1.8;
      const fwd = (this.keys.has("w") ? 1 : 0) - (this.keys.has("s") ? 1 : 0);
      w.x += Math.sin(w.yaw) * fwd * sp; w.z += Math.cos(w.yaw) * fwd * sp;
      const lim = 95; w.x = Math.max(-lim, Math.min(lim, w.x)); w.z = Math.max(-lim, Math.min(lim, w.z));
      const ey = groundHeight(w.x, w.z) + 1.7;
      this.cam.eye = [w.x, ey, w.z];
      this.cam.target = [w.x + Math.sin(w.yaw) * Math.cos(w.pitch), ey + Math.sin(w.pitch), w.z + Math.cos(w.yaw) * Math.cos(w.pitch)];
    }
  }

  frame(dt) {
    const env = this.env();
    this.animate(dt);
    this.r.render(this.root, this.cam, env);
    // labels
    for (const l of this.placeLabels) {
      const p = this.r.project(l.pos);
      const d = Math.hypot(l.pos[0] - this.cam.eye[0], l.pos[2] - this.cam.eye[2]);
      if (!p || d > 70) { l.el.style.display = "none"; continue; }
      l.el.style.display = "";
      l.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      l.el.style.opacity = String(Math.max(0.25, 1 - d / 70));
    }
    const s = this.state || {};
    const whistled = this.t - this.whistleT < 3.5;
    const f = this.friend;
    if (this.buddy.visible && f?.state) {
      const bt = f.state.asleep ? "zzz" : f.state.say || "";
      const bq = this.r.project([this.buddy.pos[0], this.buddy.pos[1] + 2.5, this.buddy.pos[2]]);
      if (bt && bq) { this.buddyBubble.textContent = bt; this.buddyBubble.style.display = ""; this.buddyBubble.style.transform = `translate(${bq.x}px, ${bq.y}px) translate(-50%, -100%)`; }
      else this.buddyBubble.style.display = "none";
    } else this.buddyBubble.style.display = "none";
    const text = whistled ? "bweep? oh, hi!" : s.asleep ? "zzz" : s.say || "";
    const bp = this.r.project([this.zeeb.pos[0], this.zeeb.pos[1] + 1.5, this.zeeb.pos[2]]);
    if (text && bp) {
      this.bubble.textContent = text;
      this.bubble.style.display = "";
      this.bubble.style.transform = `translate(${bp.x}px, ${bp.y}px) translate(-50%, -100%)`;
    } else this.bubble.style.display = "none";
  }

  start() {
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try { this.frame(dt); } catch (e) { console.error(e); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function turn(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

export { M4 };
