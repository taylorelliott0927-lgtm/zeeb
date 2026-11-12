// Fast-forward Zeeb's life offline, with no AI and no internet, to test everything.
// Usage: node brain/simulate.js [ticks] [minutesBetweenTicks]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ticks = Number(process.argv[2] || 60);
const every = Number(process.argv[3] || 6);
const dir = process.env.ZEEB_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "zeeb-sim-"));
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(path.join(dir, "character.json"))) fs.copyFileSync(path.join(here, "..", "data", "character.json"), path.join(dir, "character.json"));
let t = Date.now();
for (let i = 0; i < ticks; i++) {
  execFileSync(process.execPath, [path.join(here, "tick.js")], {
    env: { ...process.env, MOCK: "1", ZEEB_DATA_DIR: dir, ZEEB_NOW: String(t), GITHUB_TOKEN: "" },
    stdio: i % 10 === 0 ? "inherit" : "ignore",
  });
  t += every * 60000;
}
console.log("simulated data is in", dir);
