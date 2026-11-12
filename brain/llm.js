// Zeeb's link to an AI model. It tries, in order:
//   1. your own PC's AI through Ollama (when OLLAMA_URL is set, i.e. the heartbeat is running on your PC)
//   2. Google Gemini's free tier (when GEMINI_API_KEY is set)
// If neither answers, the caller falls back to simple rules so Zeeb never freezes.
import { fetchWithTimeout, log } from "./util.js";

const KEY = process.env.GEMINI_API_KEY || "";
const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
let model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
let discovered = false;
let geminiOut = false; // hit the free limit during this heartbeat

const OLLAMA_URL = (process.env.OLLAMA_URL || "").replace(/\/$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
// Unload the model from the graphics card right after each answer, so games get all the memory back.
const OLLAMA_KEEP = process.env.OLLAMA_KEEP_ALIVE || "20s";
let ollamaDown = false;

let lastBrain = "";
const mock = () => process.env.MOCK === "1";

export const useModel = (m) => { if (m && !process.env.GEMINI_MODEL_FORCE) model = m; };
export const currentModel = () => model;
export const hasBrain = () => !mock() && Boolean(OLLAMA_URL || KEY);
export const modelName = () => lastBrain || (hasBrain() ? (OLLAMA_URL ? `your PC (${OLLAMA_MODEL})` : model) : "rules (no AI key)");

// Model names change over time. If ours disappears, pick the newest free "flash" model.
async function discoverModel() {
  discovered = true;
  const res = await fetchWithTimeout(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY } });
  if (!res.ok) return false;
  const list = (await res.json()).models || [];
  const ok = list
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n));
  ok.sort((a, b) => {
    const va = parseFloat(a.split("-")[1]), vb = parseFloat(b.split("-")[1]);
    if (vb !== va) return vb - va;
    return a.includes("lite") - b.includes("lite");
  });
  if (!ok.length) return false;
  log(`model ${model} unavailable, switching to ${ok[0]}`);
  model = ok[0];
  return true;
}

function parseJSON(text) {
  const t = (text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("model did not return JSON");
  }
}

async function askOllama(system, user, temperature) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          format: "json",
          stream: false,
          keep_alive: OLLAMA_KEEP,
          options: { temperature: Math.min(temperature, 0.9), num_ctx: 8192 },
        }),
      }, 240000);
      if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const out = parseJSON(data?.message?.content || "");
      lastBrain = `your PC (${OLLAMA_MODEL})`;
      return out;
    } catch (e) {
      log(`PC brain attempt ${attempt + 1} failed:`, e.message);
      if (/ECONNREFUSED|fetch failed/i.test(e.message)) { ollamaDown = true; return null; }
    }
  }
  return null;
}

async function askGemini(system, user, temperature) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { responseMimeType: "application/json", temperature, maxOutputTokens: 4096 },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${BASE}/models/${model}:generateContent`,
        { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) },
        45000
      );
      if (res.status === 404 && !discovered && (await discoverModel())) continue;
      if (res.status === 429) {
        log("Gemini free limit reached for now");
        geminiOut = true;
        return null;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      const out = parseJSON(text);
      lastBrain = model;
      return out;
    } catch (e) {
      log(`Gemini attempt ${attempt + 1} failed:`, e.message);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

export async function askJSON(system, user, { temperature = 1.0 } = {}) {
  if (!hasBrain()) return null;
  if (OLLAMA_URL && !ollamaDown) {
    const r = await askOllama(system, user, temperature);
    if (r) return r;
  }
  if (KEY && !geminiOut) {
    const r = await askGemini(system, user, temperature);
    if (r) return r;
  }
  return null;
}
